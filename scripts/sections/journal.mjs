import { PATH, L, NOTE_KINDS, NOTE_ICONS } from "../config.mjs";
import * as store from "../store.mjs";
import { openEditor } from "../editor.mjs";
import { uploadImage, readTextFile } from "../uploads.mjs";
import { enrich, plainText, formatDate, loc, authorOf, confirmDelete, showImage, showToPlayers, viewerNames } from "../helpers.mjs";

export default {
  id: "journal",
  template: `${PATH}/templates/sections/journal.hbs`,

  async prepare(app) {
    const notes = store.all("notes").filter(n => store.isVisible("notes", n));
    const filter = ["all", "mine", ...NOTE_KINDS].includes(app.filters.journal) ? app.filters.journal : "all";
    const search = (app.search.journal ?? "").trim().toLowerCase();

    const filters = ["all", ...NOTE_KINDS].map(id => ({
      id,
      icon: NOTE_ICONS[id] ?? "fa-solid fa-book-open",
      label: `${L}.Journal.Kinds.${id}`,
      count: id === "all" ? notes.length : notes.filter(n => kindOf(n) === id).length,
      active: id === filter
    }));
    filters.push({
      id: "mine",
      icon: "fa-solid fa-user-pen",
      label: `${L}.Journal.Kinds.mine`,
      count: notes.filter(n => n.author === game.user.id).length,
      active: filter === "mine"
    });

    const listed = notes
      .filter(n => (filter === "all") || (filter === "mine" ? n.author === game.user.id : kindOf(n) === filter))
      .filter(n => !search || `${n.title} ${plainText(n.body)}`.toLowerCase().includes(search))
      .sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0));

    if ( !listed.some(n => n.id === app.selected.journal) ) app.selected.journal = listed[0]?.id ?? null;

    const rows = listed.map(n => ({
      id: n.id,
      title: n.title || loc("Untitled"),
      icon: NOTE_ICONS[kindOf(n)],
      author: authorOf(n.author),
      dateLabel: formatDate(n.updated),
      img: n.img,
      private: !n.shared,
      restricted: !!n.shared && !!n.viewers?.length,
      selected: n.id === app.selected.journal
    }));

    const note = listed.find(n => n.id === app.selected.journal);
    return {
      filters,
      rows,
      search: app.search.journal ?? "",
      empty: !rows.length,
      canCreate: store.canCreate("notes"),
      note: note ? await detail(note) : null
    };
  },

  /** Drop a picture or a text file anywhere on the journal to start a note from it. */
  onRender(app, element) {
    const page = element.querySelector(".wws-journal");
    if ( !page || !store.canCreate("notes") ) return;
    page.addEventListener("dragover", event => {
      if ( !event.dataTransfer?.types?.includes("Files") ) return;
      event.preventDefault();
      page.classList.add("wws-drop-over");
    });
    page.addEventListener("dragleave", event => {
      if ( !page.contains(event.relatedTarget) ) page.classList.remove("wws-drop-over");
    });
    page.addEventListener("drop", async event => {
      page.classList.remove("wws-drop-over");
      const file = event.dataTransfer?.files?.[0];
      if ( !file ) return;
      event.preventDefault();
      const entry = { title: file.name.replace(/\.[^.]+$/, ""), shared: true };
      try {
        if ( file.type.startsWith("image/") ) {
          ui.notifications.info(loc("Journal.Uploading"));
          entry.img = await uploadImage(file, "notes");
          entry.kind = "general";
        }
        else if ( /\.(txt|md|markdown|html?)$/i.test(file.name) ) entry.body = await readTextFile(file);
        else return ui.notifications.warn(loc("Errors.FileType"));
      } catch(err) {
        return ui.notifications.error(err.message);
      }
      newNote(app, entry);
    });
  },

  actions: {
    noteFilter(event, target) {
      this.filters.journal = target.dataset.filter;
      this.render();
    },

    noteSelect(event, target) {
      this.selected.journal = target.dataset.id;
      this.render();
    },

    noteNew() {
      const kind = NOTE_KINDS.includes(this.filters.journal) ? this.filters.journal : "general";
      newNote(this, { kind, shared: true });
    },

    noteEdit(event, target) {
      const note = store.get("notes", target.dataset.id);
      if ( !note || !store.canEdit("notes", note) ) return;
      openEditor("note", {
        entry: note,
        title: loc("Journal.Edit", { name: note.title || loc("Untitled") }),
        onSave: data => store.update("notes", note.id, data)
      });
    },

    async noteDelete(event, target) {
      const note = store.get("notes", target.dataset.id);
      if ( note && store.canEdit("notes", note) && await confirmDelete(note.title) ) await store.remove("notes", note.id);
    },

    noteImage(event, target) {
      const note = store.get("notes", target.dataset.id);
      if ( note ) showImage(note.img, note.title);
    },

    noteShow(event, target) {
      return showToPlayers("journal", target.dataset.id);
    },

    noteQuest(event, target) {
      this.open("quests", target.dataset.quest);
    },

    noteFaction(event, target) {
      this.open("factions", target.dataset.faction);
    },

    notePin(event, target) {
      const pin = store.get("pins", target.dataset.pin);
      if ( pin ) this.showPin(pin);
    }
  }
};

/* -------------------------------------------- */

const kindOf = n => n.kind ?? "general";

function newNote(app, entry) {
  openEditor("note", {
    entry,
    title: loc("Journal.New"),
    onSave: async data => {
      app.selected.journal = await store.create("notes", data);
      app.search.journal = "";
    }
  });
}

async function detail(note) {
  const kind = kindOf(note);
  const quest = store.get("quests", note.quest);
  const faction = store.get("factions", note.faction);
  const pin = store.all("pins").find(p => p.id === note.pin);
  const map = pin ? store.get("maps", pin.map) : null;
  return {
    ...note,
    links: {
      quest: store.isVisible("quests", quest) ? { id: quest.id, title: quest.title } : null,
      faction: store.isVisible("factions", faction) ? { id: faction.id, name: faction.name } : null,
      pin: (store.isVisible("pins", pin) && store.isVisible("maps", map)) ? { id: pin.id, label: pin.label || loc("Untitled") } : null
    },
    viewers: note.shared ? viewerNames(note) : "",
    title: note.title || loc("Untitled"),
    body: await enrich(note.body),
    author: authorOf(note.author),
    dateLabel: formatDate(note.created),
    editedLabel: (note.updated - note.created) > 60000 ? formatDate(note.updated) : null,
    kindLabel: `${L}.Journal.Kinds.${kind}`,
    icon: NOTE_ICONS[kind],
    private: !note.shared,
    canEdit: store.canEdit("notes", note),
    // A GM may show the table a shared note or one of their own, never a player's private one.
    canShow: game.user.isGM && (!!note.shared || (note.author === game.user.id))
  };
}
