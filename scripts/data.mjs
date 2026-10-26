import { MODULE_ID, PATH, L } from "./config.mjs";
import * as store from "./store.mjs";
import { loc } from "./helpers.mjs";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/** Collections a backup holds. */
const WORLD = store.WORLD_KINDS;
const OWNED = store.USER_KINDS;

/**
 * Backups and imports, from Configure Settings: download everything as one JSON file, restore one, or turn a folder
 * of journal entries (Simple Quest's, or your own) into quests.
 */
export default class DataManager extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "witchwind-data",
    classes: ["wws", "wws-editor", "wws-data"],
    window: { title: `${L}.Data.Title`, icon: "fa-solid fa-box-archive" },
    position: { width: 540, height: "auto" },
    actions: {
      exportData: DataManager.#onExport,
      importData: DataManager.#onImportClick,
      importJournal: DataManager.#onImportJournal
    }
  };

  static PARTS = {
    body: { template: `${PATH}/templates/data.hbs` }
  };

  /** @override */
  async _prepareContext(options) {
    const path = folder => (folder.folder ? `${path(folder.folder)} / ` : "") + folder.name;
    return {
      counts: Object.fromEntries([...WORLD, ...OWNED].map(kind => [kind, store.all(kind).length])),
      folders: game.folders.filter(f => f.type === "JournalEntry")
        .map(f => ({ id: f.id, name: path(f) })).sort((a, b) => a.name.localeCompare(b.name))
    };
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const input = this.element.querySelector("input[type=file][data-import-backup]");
    input?.addEventListener("change", async () => {
      const file = input.files?.[0];
      input.value = "";
      if ( file ) await this.#importBackup(file);
    });
  }

  /* -------------------------------------------- */
  /*  Backup                                      */
  /* -------------------------------------------- */

  static #onExport() {
    const data = {
      module: MODULE_ID,
      version: game.modules.get(MODULE_ID)?.version,
      world: game.world?.id,
      exported: new Date().toISOString(),
      questGroups: store.questGroups(),
      noticeRegions: store.noticeRegions()
    };
    for ( const kind of [...WORLD, ...OWNED] ) data[kind] = store.all(kind);
    const date = new Date().toISOString().slice(0, 10);
    foundry.utils.saveDataToFile(JSON.stringify(data, null, 2), "application/json",
      `witchwind-systems-${game.world?.id ?? "world"}-${date}.json`);
  }

  static #onImportClick() {
    this.element.querySelector("input[type=file][data-import-backup]")?.click();
  }

  async #importBackup(file) {
    let data;
    try {
      data = JSON.parse(await foundry.utils.readTextFromFile(file));
    } catch {
      return ui.notifications.error(loc("Data.BadFile"));
    }
    if ( data?.module !== MODULE_ID ) return ui.notifications.error(loc("Data.BadFile"));
    const replace = this.element.querySelector("input[name=replace]")?.checked ?? true;
    const confirmed = await DialogV2.confirm({
      window: { title: loc("Data.Restore"), icon: "fa-solid fa-box-open" },
      classes: ["wws", "wws-dialog"],
      content: `<p>${loc(replace ? "Data.ConfirmReplace" : "Data.ConfirmMerge", { date: data.exported?.slice(0, 10) ?? "?" })}</p>`,
      rejectClose: false,
      modal: true
    });
    if ( confirmed !== true ) return;

    for ( const kind of WORLD ) {
      const incoming = Array.isArray(data[kind]) ? data[kind] : [];
      const kept = replace ? [] : store.all(kind).filter(e => !incoming.some(i => i.id === e.id));
      await store.replaceWorld(kind, [...kept, ...incoming].map(e => foundry.utils.deepClone(e)));
    }
    if ( Array.isArray(data.questGroups) && data.questGroups.length ) await store.setQuestGroups(data.questGroups);
    if ( Array.isArray(data.noticeRegions) && data.noticeRegions.length ) await store.setNoticeRegions(data.noticeRegions);
    for ( const kind of OWNED ) await store.importOwned(kind, Array.isArray(data[kind]) ? data[kind] : [], replace);
    ui.notifications.info(loc("Data.Restored"));
    this.render();
  }

  /* -------------------------------------------- */
  /*  Journal import                              */
  /* -------------------------------------------- */

  /**
   * Each journal entry in the folder (and the folders inside it) becomes a quest: its first text page the details,
   * each further text page a step of it, and any checklist items its objectives. A folder named for completed or
   * failed quests sets their status, and entries players can see are revealed.
   */
  static async #onImportJournal() {
    const folder = game.folders.get(this.element.querySelector("select[name=folder]")?.value);
    if ( !folder ) return;
    const kind = store.questGroups()[0]?.id;
    const quests = [];
    let sort = Math.max(0, ...store.all("quests").map(q => q.sort ?? 0));
    const walk = (f, status) => {
      const own = statusFromName(f.name) ?? status;
      for ( const entry of game.journal.filter(j => j.folder?.id === f.id) ) {
        const visible = (entry.ownership?.default ?? 0) >= 1;
        const pages = entry.pages.contents.filter(p => p.type === "text").sort((a, b) => a.sort - b.sort);
        const id = foundry.utils.randomID();
        quests.push({ id, title: entry.name, status: own, visible, kind, sort: ++sort, ...fromPage(pages[0]) });
        pages.slice(1).forEach((page, i) => {
          quests.push({ title: page.name, parent: id, status: own, visible, kind, sort: i + 1, ...fromPage(page) });
        });
      }
      for ( const sub of game.folders.filter(x => (x.type === "JournalEntry") && (x.folder?.id === f.id)) ) walk(sub, own);
    };
    walk(folder, "active");
    if ( !quests.length ) return ui.notifications.warn(loc("Data.NothingToImport"));
    await store.createMany("quests", quests);
    ui.notifications.info(loc("Data.Imported", { count: quests.length }));
    this.render();
  }
}

/** "Completed" or "Failed" in a folder's name sets the status of the quests inside it. */
function statusFromName(name) {
  if ( /complet|finish|done/i.test(name) ) return "completed";
  if ( /fail/i.test(name) ) return "failed";
  return null;
}

/** A journal page's text as a quest's details, with its checklist items lifted out as objectives. */
function fromPage(page) {
  const html = page?.text?.content ?? "";
  if ( !html ) return { description: "", objectives: [] };
  const doc = new DOMParser().parseFromString(html, "text/html");
  const objectives = [];
  for ( const li of doc.querySelectorAll("li") ) {
    const box = li.querySelector("input[type=checkbox]");
    if ( !box ) continue;
    const text = li.textContent.replace(/\s+/g, " ").trim();
    if ( text ) objectives.push({ id: foundry.utils.randomID(), text, done: box.checked || box.hasAttribute("checked") });
    const list = li.parentElement;
    li.remove();
    if ( list && !list.children.length ) list.remove();
  }
  return { description: doc.body.innerHTML.trim(), objectives };
}
