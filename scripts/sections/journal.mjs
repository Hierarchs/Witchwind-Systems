import { PATH, L, NOTE_KINDS, NOTE_ICONS, LETTER_ICONS } from "../config.mjs";
import * as store from "../store.mjs";
import { openEditor } from "../editor.mjs";
import { uploadImage, readTextFile } from "../uploads.mjs";
import { enrich, plainText, formatDate, loc, authorOf, confirmDelete, showImage, showToPlayers, viewerNames, worldDate, worldNow } from "../helpers.mjs";

/*
 * The journal, in two tabs. Notes are the table's own: the session notes everyone writes and can share. Letters are
 * in-world things the GM writes and hands out: letters, books, notices and orders, which a player receives or finds.
 * A letter can be held back for a later day, and players see which they haven't opened (store.isVisible, markRead).
 */

/** The filter that switches the journal to its letters tab. The other filters are note filters. */
const LETTERS = "letters";

const ICONS = { all: "fa-solid fa-book-open", mine: "fa-solid fa-user-pen" };

export default {
  id: "journal",
  template: `${PATH}/templates/sections/journal.hbs`,

  async prepare(app) {
    const isGM = game.user.isGM;
    const notes = store.all("notes").filter(n => store.isVisible("notes", n));
    const letters = store.all("letters").filter(l => store.isVisible("letters", l));
    const read = new Set(store.readLetters());
    const filters = ["all", "mine", ...NOTE_KINDS];
    const filter = [...filters, LETTERS].includes(app.filters.journal) ? app.filters.journal : "all";
    const mode = (filter === LETTERS) ? LETTERS : "notes";
    const search = (app.search.journal ?? "").trim().toLowerCase();
    const matches = text => !search || text.toLowerCase().includes(search);

    const noteShown = n => (filter === "all") || ((filter === "mine") ? (n.author === game.user.id) : (kindOf(n) === filter));
    const items = (mode === LETTERS
      ? letters.filter(l => matches(`${l.title} ${l.sender ?? ""} ${plainText(l.body)}`))
        .map(l => ({ type: "letter", id: l.id, time: sentOn(l), l }))
      : notes.filter(noteShown).filter(n => matches(`${n.title} ${plainText(n.body)}`))
        .map(n => ({ type: "note", id: n.id, time: n.updated ?? 0, n }))
    ).sort((a, b) => b.time - a.time);

    if ( !items.some(i => i.id === app.selected.journal) ) app.selected.journal = items[0]?.id ?? null;
    const sel = app.selected.journal;

    const rows = items.map(({ type, n, l, time }) => (type === "note") ? {
      type,
      id: n.id,
      title: n.title || loc("Untitled"),
      icon: NOTE_ICONS[kindOf(n)],
      author: authorOf(n.author),
      dateLabel: formatDate(n.updated),
      img: n.img,
      private: !n.shared,
      restricted: !!n.shared && !!n.viewers?.length,
      selected: n.id === sel
    } : {
      type,
      id: l.id,
      title: l.title || loc("Untitled"),
      icon: LETTER_ICONS[l.kind] ?? LETTER_ICONS.letter,
      img: l.img,
      sender: l.sender,
      dateLabel: worldDate(time),
      unread: !isGM && !read.has(l.id),
      pending: isGM && pending(l),
      selected: l.id === sel
    });

    const noteCount = id => {
      if ( id === "all" ) return notes.length;
      if ( id === "mine" ) return notes.filter(n => n.author === game.user.id).length;
      return notes.filter(n => kindOf(n) === id).length;
    };
    const modes = [
      { id: "notes", filter: "all", label: `${L}.Journal.Modes.notes`, hint: `${L}.Journal.Modes.notesHint`, icon: NOTE_ICONS.general,
        count: notes.length, active: mode === "notes" },
      { id: LETTERS, filter: LETTERS, label: `${L}.Journal.Modes.letters`, hint: `${L}.Journal.Modes.lettersHint`, icon: LETTER_ICONS.letter,
        count: letters.length, unread: isGM ? 0 : letters.filter(l => !read.has(l.id)).length, active: mode === LETTERS }
    ];
    const noteFilters = (mode === "notes") ? filters.map(id => ({
      id,
      icon: ICONS[id] ?? NOTE_ICONS[id],
      label: `${L}.Journal.Kinds.${id}`,
      count: noteCount(id),
      active: id === filter
    })) : [];

    const selected = items.find(i => i.id === sel);
    return {
      mode,
      isLetters: mode === LETTERS,
      modes,
      filters: noteFilters,
      rows,
      search: app.search.journal ?? "",
      empty: !rows.length,
      canCreate: store.canCreate("notes"),
      canLetter: isGM,
      note: selected?.type === "note" ? await detail(selected.n) : null,
      letter: selected?.type === "letter" ? await letterDetail(selected.l, read) : null
    };
  },

  /** Drop a picture or a text file anywhere on the notes to start a note from it; open a letter marks it read. */
  onRender(app, element) {
    const unread = element.querySelector(".wws-letter[data-unread]")?.dataset.id;
    if ( unread ) store.markRead(unread);

    const page = element.querySelector(".wws-journal");
    if ( !page || (page.dataset.mode !== "notes") || !store.canCreate("notes") ) return;
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

    /** Letters are the GM's: a new one arrives now, or on a later day if the GM sets it. */
    letterNew() {
      if ( !game.user.isGM ) return;
      openEditor("letter", {
        entry: { kind: "letter", visible: true },
        title: loc("Letters.New"),
        onSave: async data => {
          this.selected.journal = await store.create("letters", { ...data, sentAt: worldNow() });
        }
      });
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
    },

    letterEdit(event, target) {
      const letter = store.get("letters", target.dataset.id);
      if ( !letter ) return;
      openEditor("letter", {
        entry: letter,
        title: loc("Letters.Edit", { name: letter.title }),
        onSave: data => store.update("letters", letter.id, data)
      });
    },

    async letterDelete(event, target) {
      const letter = store.get("letters", target.dataset.id);
      if ( letter && await confirmDelete(letter.title) ) await store.remove("letters", letter.id);
    },

    /** Deliver a held-back or hidden letter right away. */
    letterDeliver(event, target) {
      return store.update("letters", target.dataset.id, { visible: true, arrival: null, sentAt: worldNow() });
    },

    letterShow(event, target) {
      return showToPlayers("journal", target.dataset.id);
    }
  }
};

/* -------------------------------------------- */

const kindOf = n => n.kind ?? "general";

/** When a letter reaches its reader: its arrival day if it has one, otherwise when it was sent. */
const sentOn = l => l.arrival ?? l.sentAt ?? 0;

/** A letter the players can't see yet: hidden, or held back for a day still to come. */
const pending = l => !l.visible || ((l.arrival ?? 0) > worldNow());

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

async function letterDetail(letter, read) {
  const isGM = game.user.isGM;
  const kind = letter.kind ?? "letter";
  return {
    ...letter,
    title: letter.title || loc("Untitled"),
    body: await enrich(letter.body),
    icon: LETTER_ICONS[kind] ?? LETTER_ICONS.letter,
    kindLabel: `${L}.Letters.Kinds.${kind}`,
    dateLabel: worldDate(sentOn(letter)),
    arrivesLabel: (isGM && (letter.arrival ?? 0) > worldNow()) ? worldDate(letter.arrival) : null,
    hidden: !letter.visible,
    viewers: isGM ? viewerNames(letter) : "",
    unread: !isGM && !read.has(letter.id)
  };
}
