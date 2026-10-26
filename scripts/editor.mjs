import { MODULE_ID, PATH, L, PIN_ICONS, PIN_COLORS, QUEST_KINDS, QUEST_STATUSES, NOTE_KINDS, LETTER_KINDS, NOTICE_DIFFICULTIES, DEFAULT_RANKS } from "./config.mjs";
import * as store from "./store.mjs";
import { uploadImage, canUpload, canBrowse, readTextFile } from "./uploads.mjs";
import { worldNow, worldDate, secondsPerDay, daysUntil, partyCharacters } from "./helpers.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Width of each kind of editor. */
const WIDTHS = { quest: 720, faction: 720, note: 640, map: 460, pin: 460, entry: 480, groups: 440, letter: 640, title: 520, merchant: 760, creature: 640, notice: 640, regions: 440 };

/** Icons a title can carry. */
const TITLE_ICONS = ["fa-solid fa-crown", "fa-solid fa-medal", "fa-solid fa-award", "fa-solid fa-shield-halved",
  "fa-solid fa-star", "fa-solid fa-dragon", "fa-solid fa-skull", "fa-solid fa-feather-pointed", "fa-solid fa-hand-fist",
  "fa-solid fa-book-sparkles", "fa-solid fa-chess-rook", "fa-solid fa-gem"];

/** Which field says an entry is shown to players: GM collections are revealed, user-owned ones are shared. */
const VISIBILITY = {
  quest: { field: "visible", label: "Editor.VisibleQuest" },
  map: { field: "visible", label: "Editor.VisibleMap" },
  faction: { field: "visible", label: "Editor.VisibleFaction" },
  note: { field: "shared", label: "Editor.SharedNote" },
  pin: { field: "shared", label: "Editor.SharedPin" },
  letter: { field: "visible", label: "Editor.VisibleLetter" },
  merchant: { field: "visible", label: "Editor.VisibleMerchant" },
  creature: { field: "visible", label: "Editor.VisibleCreature" },
  notice: { field: "visible", label: "Editor.VisibleNotice" }
};

/** Where each kind of editor puts the pictures it uploads, inside the module's storage. */
const FOLDERS = { quest: "quests", faction: "factions", note: "notes", map: "maps", letter: "letters", merchant: "merchants", creature: "bestiary" };

/**
 * One small form window for writing or changing any entry: a quest, note, map, marker, faction or quest log entry.
 * The form is read by hand (see readForm) so lists of rows such as objectives come back as plain arrays.
 */
export class EntryEditor extends HandlebarsApplicationMixin(ApplicationV2) {
  /**
   * @param {object} config
   * @param {string} config.kind          quest, note, map, pin, faction or entry
   * @param {object} [config.entry]       The entry as it is now; empty for a new one
   * @param {string} config.title         Window title
   * @param {Function} config.onSave      Called with the form's data when it's saved
   */
  constructor({ kind, entry = {}, title, onSave, ...options }) {
    super(foundry.utils.mergeObject({ position: { width: WIDTHS[kind] ?? 560 } }, options));
    this.kind = kind;
    this.entry = foundry.utils.deepClone(entry);
    this.onSave = onSave;
    this.#title = title;
  }

  #title;

  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["wws", "wws-editor"],
    window: { icon: "fa-solid fa-feather-pointed", resizable: true },
    position: { height: "auto" },
    form: { handler: EntryEditor.#onSubmit, closeOnSubmit: true },
    actions: {
      addRow: EntryEditor.#onAddRow,
      removeRow: EntryEditor.#onRemoveRow,
      moveRow: EntryEditor.#onMoveRow,
      browseImage: EntryEditor.#onBrowseImage,
      uploadImage: EntryEditor.#onUploadImage,
      clearImage: EntryEditor.#onClearImage,
      clearGiver: EntryEditor.#onClearGiver,
      importText: EntryEditor.#onImportText,
      editorTab: EntryEditor.#onEditorTab,
      addParty: EntryEditor.#onAddParty
    }
  };

  get title() {
    return this.#title;
  }

  /** @override */
  _configureRenderParts(options) {
    return {
      form: {
        template: `${PATH}/templates/editors/${this.kind}.hbs`,
        templates: [`${PATH}/templates/editors/image.hbs`, `${PATH}/templates/editors/visibility.hbs`]
      }
    };
  }

  /** @override */
  async _prepareContext(options) {
    const entry = this.entry;
    const context = {
      entry,
      isGM: game.user.isGM,
      isNew: !entry.id,
      canUpload: canUpload(),
      canBrowse: canBrowse(),
      image: { name: "img", value: entry.img ?? "", folder: FOLDERS[this.kind] },
      visibility: visibilityContext(this.kind, entry)
    };
    switch ( this.kind ) {
      case "quest": {
        const groups = store.questGroups();
        const kind = groups.some(g => g.id === entry.kind) ? entry.kind : groups[0]?.id;
        context.kinds = groups.map(g => ({ id: g.id, label: g.name || `${L}.Quests.Kinds.${g.id}`, selected: g.id === kind }));
        context.statuses = QUEST_STATUSES.map(id => ({ id, label: `${L}.Quests.Status.${id}`, selected: (entry.status ?? "active") === id }));
        context.factions = factionChoices(entry.faction);
        context.parents = parentChoices(entry);
        context.objectives = entry.objectives ?? [];
        context.log = entry.log ?? [];
        context.rewards = entry.rewards ?? [];
        break;
      }
      case "note":
        context.kinds = NOTE_KINDS.map(id => ({ id, label: `${L}.Journal.Kinds.${id}`, selected: (entry.kind ?? "general") === id }));
        context.quests = store.all("quests").filter(q => store.isVisible("quests", q))
          .sort(byTitle).map(q => ({ id: q.id, title: q.title, selected: q.id === entry.quest }));
        context.factions = factionChoices(entry.faction);
        context.pins = pinChoices(entry.pin);
        break;
      case "letter":
        context.kinds = LETTER_KINDS.map(id => ({ id, label: `${L}.Letters.Kinds.${id}`, selected: (entry.kind ?? "letter") === id }));
        context.arriveIn = daysUntil(entry.arrival);
        context.today = worldDate();
        break;
      case "title": {
        const people = partyCharacters();
        context.people = people.map(p => ({ ...p, selected: p.uuid === entry.uuid }));
        context.icons = TITLE_ICONS.map(value => ({ value, checked: (entry.icon ?? TITLE_ICONS[0]) === value }));
        context.quests = store.all("quests").filter(q => store.isVisible("quests", q))
          .sort(byTitle).map(q => ({ id: q.id, title: q.title, selected: q.id === entry.quest }));
        break;
      }
      case "merchant":
        context.factions = factionChoices(entry.faction);
        context.stock = entry.stock ?? [];
        break;
      case "notice":
        context.regions = store.noticeRegions().map(r => ({ id: r.id, name: r.name, selected: entry.region === r.id }));
        context.difficulties = NOTICE_DIFFICULTIES.map(d => ({
          id: d.id, label: `${L}.Notices.Difficulty.${d.id}`, selected: (entry.difficulty ?? "easy") === d.id
        }));
        context.factions = factionChoices(entry.faction);
        context.expiresIn = daysUntil(entry.expires);
        break;
      case "regions":
        context.regions = (entry.regions ?? []).map(r => ({ ...r }));
        break;
      case "groups":
        context.groups = (entry.groups ?? []).map(g => ({ ...g, placeholder: game.i18n.localize(`${L}.Quests.Kinds.${g.id}`) }));
        break;
      case "pin":
        context.icons = Object.entries(PIN_ICONS).map(([id, icon]) => ({
          id, icon, label: `${L}.Maps.Icons.${id}`, checked: (entry.icon ?? "location") === id
        }));
        context.colors = Object.entries(PIN_COLORS).map(([id, value]) => ({
          id, value, label: `${L}.Maps.Colors.${id}`, checked: (entry.color ?? "gold") === id
        }));
        context.quests = store.all("quests").filter(q => store.isVisible("quests", q))
          .sort(byTitle).map(q => ({ id: q.id, title: q.title, selected: q.id === entry.quest }));
        context.factions = factionChoices(entry.faction);
        break;
      case "faction":
        context.ranksText = (entry.ranks ?? DEFAULT_RANKS).join("\n");
        context.standing = entry.standing ?? 0;
        context.others = store.all("factions").filter(f => f.id !== entry.id).sort(byName).map(f => ({
          id: f.id, name: f.name, ally: entry.allies?.includes(f.id), rival: entry.rivals?.includes(f.id)
        }));
        context.members = (entry.members ?? []).map(m => ({ ...m, ranks: rankChoices(entry.ranks, m.rank ?? 0) }));
        context.rankOptions = rankChoices(entry.ranks, 0);
        break;
    }
    return context;
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const form = this.element;
    for ( const zone of form.querySelectorAll("[data-drop]") ) {
      zone.addEventListener("dragover", event => {
        event.preventDefault();
        zone.classList.add("wws-drop-over");
      });
      zone.addEventListener("dragleave", () => zone.classList.remove("wws-drop-over"));
      zone.addEventListener("drop", event => {
        zone.classList.remove("wws-drop-over");
        this.#onDrop(event, zone.dataset.drop);
      });
    }
    form.querySelector("input[type=file][data-import]")?.addEventListener("change", this.#onImportFile.bind(this));
    form.querySelector("input[type=file][data-upload]")?.addEventListener("change", this.#onUploadFile.bind(this));
    form.querySelector("input[name=img]")?.addEventListener("change", event => this.#showImage(event.target.value));
    form.querySelector("input[name=standing]")?.addEventListener("input", event => {
      const out = form.querySelector("output[data-standing]");
      if ( out ) out.value = event.target.value;
    });
    form.querySelector("textarea[name=ranks]")?.addEventListener("change", () => this.#refreshRankOptions());
    form.querySelector("input[name=title], input[name=name], input[name=label]")?.focus();
  }

  /* -------------------------------------------- */
  /*  Form                                        */
  /* -------------------------------------------- */

  static async #onSubmit(event, form) {
    const data = readForm(form);
    if ( VISIBILITY[this.kind] ) data.viewers = Array.from(form.querySelectorAll("[data-viewer]:checked"), el => el.value);
    if ( this.kind === "letter" ) {
      // A letter held back arrives that many days from now; unchanged, it keeps the day it already had.
      const days = Math.max(0, Number(data.arriveIn) || 0);
      delete data.arriveIn;
      if ( days && (days === daysUntil(this.entry.arrival)) ) data.arrival = this.entry.arrival;
      else data.arrival = days ? worldNow() + (days * secondsPerDay()) : null;
    }
    if ( this.kind === "merchant" ) {
      const count = v => (Number.isFinite(v) ? Math.max(0, v) : null);
      data.restockDays = Math.max(0, Number(data.restockDays) || 0);
      data.stock = (data.stock ?? []).filter(s => s.name).map(s => ({
        ...s, id: s.id || foundry.utils.randomID(), price: Math.max(0, Number(s.price) || 0), qty: count(s.qty), max: count(s.max) ?? count(s.qty)
      }));
    }
    if ( this.kind === "notice" ) {
      // Stays up that many days from now; unchanged, it keeps the day it already had.
      const days = Math.max(0, Number(data.expiresIn) || 0);
      delete data.expiresIn;
      if ( days && (days === daysUntil(this.entry.expires)) ) data.expires = this.entry.expires;
      else data.expires = days ? worldNow() + (days * secondsPerDay()) : null;
      data.visible = !!data.visible;
      data.difficulty = data.difficulty || "easy";
    }
    if ( this.kind === "regions" ) {
      data.regions = (data.regions ?? [])
        .map(r => ({ id: r.id || foundry.utils.randomID(), name: String(r.name ?? "").trim() }))
        .filter(r => r.name);
    }
    if ( this.kind === "groups" ) {
      data.groups = (data.groups ?? []).map(g => ({ id: g.id || foundry.utils.randomID(), name: g.name ?? "" }));
      if ( !data.groups.length ) data.groups = QUEST_KINDS.map(id => ({ id, name: "" }));
    }
    if ( this.kind === "faction" ) {
      data.ranks = String(data.ranks ?? "").split(/\r?\n/).map(r => r.trim()).filter(Boolean);
      if ( !data.ranks.length ) data.ranks = [...DEFAULT_RANKS];
      data.allies = Array.from(form.querySelectorAll("[data-relation=ally]:checked"), el => el.value);
      data.rivals = Array.from(form.querySelectorAll("[data-relation=rival]:checked"), el => el.value);
      data.members = (data.members ?? []).map(m => ({
        ...m,
        rank: Number(m.rank) || 0,
        standing: Number.isFinite(m.standing) ? Math.clamp(m.standing, -100, 100) : null
      }));
    }
    if ( this.kind === "quest" ) {
      data.objectives = (data.objectives ?? []).filter(o => o.text).map(o => ({ ...o, id: o.id || foundry.utils.randomID() }));
      data.log = (data.log ?? []).filter(e => e.text).map(e => ({ ...e, id: e.id || foundry.utils.randomID(), date: Number(e.date) || Date.now() }));
      data.rewards = (data.rewards ?? []).filter(r => r.name).map(r => ({ ...r, qty: Number(r.qty) || 1 }));
    }
    await this.onSave?.(data);
  }

  /* -------------------------------------------- */
  /*  Rows                                        */
  /* -------------------------------------------- */

  static #onAddRow(event, target) {
    this.#addRow(target.dataset.list);
  }

  #addRow(list, values={}) {
    const template = this.element.querySelector(`template[data-row-template="${list}"]`);
    const rows = this.element.querySelector(`.wws-rows[data-list="${list}"]`);
    if ( !template || !rows ) return null;
    const row = template.content.firstElementChild.cloneNode(true);
    for ( const [field, value] of Object.entries(values) ) {
      const el = row.querySelector(`[data-field="${field}"]`);
      if ( el ) el.value = value;
      const img = row.querySelector(`img[data-show="${field}"]`);
      if ( img ) img.src = value;
      const text = row.querySelector(`[data-text="${field}"]`);
      if ( text ) text.textContent = value;
    }
    rows.append(row);
    row.querySelector("input[type=text], textarea")?.focus();
    return row;
  }

  static #onRemoveRow(event, target) {
    target.closest("[data-list-row]")?.remove();
  }

  static #onMoveRow(event, target) {
    const row = target.closest("[data-list-row]");
    if ( !row ) return;
    if ( target.dataset.direction === "up" ) row.previousElementSibling?.before(row);
    else row.nextElementSibling?.after(row);
  }

  /* -------------------------------------------- */
  /*  Pictures                                    */
  /* -------------------------------------------- */

  static #onBrowseImage(event, target) {
    const input = this.element.querySelector("input[name=img]");
    const FilePicker = foundry.applications.apps.FilePicker.implementation;
    new FilePicker({
      type: "image",
      current: input.value,
      callback: path => {
        input.value = path;
        this.#showImage(path);
      }
    }).render({ force: true });
  }

  static #onUploadImage(event, target) {
    this.element.querySelector("input[type=file][data-upload]")?.click();
  }

  static #onClearImage(event, target) {
    this.element.querySelector("input[name=img]").value = "";
    this.#showImage("");
  }

  async #onUploadFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if ( file ) await this.#upload(file);
  }

  async #upload(file) {
    const field = this.element.querySelector(".wws-image-field");
    field?.classList.add("wws-busy");
    try {
      const path = await uploadImage(file, FOLDERS[this.kind] ?? "misc");
      this.element.querySelector("input[name=img]").value = path;
      this.#showImage(path);
    } catch(err) {
      ui.notifications.error(err.message);
    } finally {
      field?.classList.remove("wws-busy");
    }
  }

  #showImage(path) {
    const preview = this.element.querySelector(".wws-image-field .wws-image-preview");
    if ( !preview ) return;
    preview.classList.toggle("empty", !path);
    preview.style.backgroundImage = path ? `url("${path}")` : "";
  }

  /* -------------------------------------------- */
  /*  Text files                                  */
  /* -------------------------------------------- */

  static #onImportText(event, target) {
    this.element.querySelector("input[type=file][data-import]")?.click();
  }

  async #onImportFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if ( file ) await this.#importText(file);
  }

  async #importText(file) {
    const html = await readTextFile(file);
    const editor = this.element.querySelector("prose-mirror[name=body]");
    if ( !editor ) return;
    const title = this.element.querySelector("input[name=title]");
    if ( title && !title.value ) title.value = file.name.replace(/\.[^.]+$/, "");
    editor.value = [editor.value, html].filter(Boolean).join("");
  }

  /* -------------------------------------------- */
  /*  Drag and drop                               */
  /* -------------------------------------------- */

  async #onDrop(event, zone) {
    event.preventDefault();
    // Pictures dropped on the picture field are uploaded; text files dropped on a note's text are imported into it.
    // (Foundry's own editor handles pictures dropped into the text.)
    const file = event.dataTransfer?.files?.[0];
    if ( file ) {
      if ( (zone === "image") && file.type.startsWith("image/") ) return this.#upload(file);
      if ( (zone === "body") && /\.(txt|md|markdown|html?)$/i.test(file.name) ) return this.#importText(file);
      return;
    }
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    if ( !data?.uuid ) return;
    const doc = await foundry.utils.fromUuid(data.uuid);
    if ( !doc ) return;
    switch ( zone ) {
      // An actor, item or anything else with a picture lends it to the picture field.
      case "image":
        if ( !doc.img ) return;
        this.element.querySelector("input[name=img]").value = doc.img;
        this.#showImage(doc.img);
        break;
      case "giver":
        if ( doc.documentName !== "Actor" ) return;
        this.#setGiver({ giverName: doc.name, giverImg: doc.img, giverUuid: doc.uuid });
        break;
      case "rewards":
        if ( doc.documentName !== "Item" ) return;
        this.#addRow("rewards", {
          name: doc.name, img: doc.img, uuid: doc.uuid, qty: doc.system?.quantity ?? 1, rarity: doc.system?.rarity ?? ""
        });
        break;
      case "stock":
        if ( doc.documentName !== "Item" ) return;
        this.#addRow("stock", { name: doc.name, img: doc.img, uuid: doc.uuid, rarity: doc.system?.rarity ?? "", price: doc.system?.price?.value ?? 0 });
        break;
      case "members":
        if ( doc.documentName !== "Actor" ) return;
        this.#addMember(doc);
        break;
    }
  }

  #setGiver({ giverName, giverImg, giverUuid }) {
    const form = this.element;
    form.querySelector("input[name=giverName]").value = giverName ?? "";
    form.querySelector("input[name=giverImg]").value = giverImg ?? "";
    form.querySelector("input[name=giverUuid]").value = giverUuid ?? "";
    const portrait = form.querySelector(".wws-giver img");
    if ( portrait ) {
      portrait.src = giverImg || "icons/svg/mystery-man.svg";
      portrait.hidden = !giverImg;
    }
  }

  static #onClearGiver(event, target) {
    this.#setGiver({});
  }

  /* -------------------------------------------- */
  /*  Factions                                    */
  /* -------------------------------------------- */

  #addMember(actor) {
    const rows = this.element.querySelector(".wws-rows[data-list=members]");
    const present = Array.from(rows.querySelectorAll("[data-field=uuid]"), el => el.value);
    if ( present.includes(actor.uuid) ) return;
    this.#addRow("members", { uuid: actor.uuid, name: actor.name, img: actor.img, rank: 0, standing: "" });
  }

  static #onAddParty(event, target) {
    for ( const actor of game.actors.filter(a => a.hasPlayerOwner) ) this.#addMember(actor);
  }

  /** Rewrite each member's rank choices after the list of ranks is edited. */
  #refreshRankOptions() {
    const ranks = String(this.element.querySelector("textarea[name=ranks]").value).split(/\r?\n/)
      .map(r => r.trim()).filter(Boolean);
    const selects = this.element.querySelectorAll("select[data-field=rank]");
    const template = this.element.querySelector("template[data-row-template=members]")?.content.querySelector("select[data-field=rank]");
    for ( const select of [...selects, template].filter(Boolean) ) {
      const current = Number(select.value) || 0;
      const outsider = new Option(game.i18n.localize(`${L}.Factions.NotMember`), "-1", false, current < 0);
      select.replaceChildren(outsider, ...ranks.map((rank, i) => new Option(rank, String(i), false,
        (current >= 0) && (i === Math.min(current, ranks.length - 1)))));
    }
  }

  /* -------------------------------------------- */
  /*  Tabs                                        */
  /* -------------------------------------------- */

  static #onEditorTab(event, target) {
    const tab = target.dataset.tab;
    for ( const el of this.element.querySelectorAll("[data-action=editorTab]") ) {
      el.classList.toggle("active", el.dataset.tab === tab);
      el.setAttribute("aria-pressed", String(el.dataset.tab === tab));
    }
    for ( const panel of this.element.querySelectorAll("[data-panel]") ) {
      panel.classList.toggle("active", panel.dataset.panel === tab);
    }
  }
}

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */

/** Open an editor for an entry, or bring forward the one already open for it. onSave receives the form's data. */
export function openEditor(kind, { entry, title, onSave }={}) {
  const existing = foundry.applications.instances.get(`${MODULE_ID}-editor-${kind}-${entry?.id ?? "new"}`);
  if ( existing ) {
    existing.bringToFront();
    return existing;
  }
  const app = new EntryEditor({ kind, entry, title, onSave, id: `${MODULE_ID}-editor-${kind}-${entry?.id ?? "new"}` });
  app.render({ force: true });
  return app;
}

/** Read every named field outside a row, and each row list as an array of objects. */
export function readForm(form) {
  const data = {};
  for ( const el of form.querySelectorAll("[name]") ) {
    if ( el.closest("[data-list-row]") ) continue;
    if ( (el.type === "radio") && !el.checked ) continue;
    data[el.name] = readValue(el);
  }
  // Only the lists themselves: their Add buttons carry data-list too, to say which list they add to.
  for ( const list of form.querySelectorAll(".wws-rows[data-list]") ) {
    data[list.dataset.list] = Array.from(list.querySelectorAll(":scope > [data-list-row]"), row => {
      const item = {};
      for ( const el of row.querySelectorAll("[data-field]") ) item[el.dataset.field] = readValue(el);
      return item;
    });
  }
  return data;
}

function readValue(el) {
  if ( el.type === "checkbox" ) return el.checked;
  if ( (el.type === "number") || (el.type === "range") ) return el.value === "" ? null : Number(el.value);
  const value = el.value ?? "";
  return typeof value === "string" ? value.trim() : value;
}

function factionChoices(selected) {
  return store.all("factions").sort(byName).map(f => ({ id: f.id, name: f.name, selected: f.id === selected }));
}

/** A faction's ranks as choices, after "Not a member" (-1) for characters the faction only knows by standing. */
function rankChoices(ranks, selected) {
  const outsider = { value: -1, name: game.i18n.localize(`${L}.Factions.NotMember`), selected: selected < 0 };
  return [outsider, ...(ranks?.length ? ranks : DEFAULT_RANKS).map((name, i) => ({ value: i, name, selected: i === selected }))];
}

/**
 * Who can see an entry: the reveal or share switch, and the players it can be limited to. A player sharing a note
 * or marker isn't offered themselves, since they always see their own.
 */
function visibilityContext(kind, entry) {
  const config = VISIBILITY[kind];
  if ( !config ) return null;
  const viewers = entry.viewers ?? [];
  const on = config.field === "shared" ? (entry.shared ?? true) : !!entry.visible;
  return {
    field: config.field,
    on,
    label: `${L}.${config.label}`,
    players: game.users.filter(u => !u.isGM && (u.id !== game.user.id)).map(u => ({
      id: u.id, name: u.name, color: u.color?.css ?? "#8a7d66", checked: viewers.includes(u.id)
    }))
  };
}

/** Quests this one could be a step of: any but itself and its own steps, so a chain never loops. */
function parentChoices(entry) {
  const all = store.all("quests");
  const below = new Set([entry.id]);
  for ( let grew = true; grew; ) {
    grew = false;
    for ( const q of all ) if ( q.parent && below.has(q.parent) && !below.has(q.id) ) { below.add(q.id); grew = true; }
  }
  return all.filter(q => !below.has(q.id)).sort(byTitle).map(q => ({ id: q.id, title: q.title, selected: q.id === entry.parent }));
}

/** Markers a note can point to, named with their map. */
function pinChoices(selected) {
  const maps = new Map(store.all("maps").filter(m => store.isVisible("maps", m)).map(m => [m.id, m]));
  return store.all("pins").filter(p => maps.has(p.map) && store.isVisible("pins", p))
    .map(p => ({ id: p.id, label: `${p.label || game.i18n.localize(`${L}.Untitled`)} · ${maps.get(p.map).name}`, selected: p.id === selected }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

const byTitle = (a, b) => (a.title ?? "").localeCompare(b.title ?? "");
const byName = (a, b) => (a.name ?? "").localeCompare(b.name ?? "");
