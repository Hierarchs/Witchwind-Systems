import { PATH, L, LETTER_ICONS } from "../config.mjs";
import * as store from "../store.mjs";
import { openEditor } from "../editor.mjs";
import { enrich, loc, confirmDelete, showToPlayers, viewerNames, worldDate, worldNow } from "../helpers.mjs";

/*
 * Letters, books, notices and orders the GM hands out. One can be held back for a later day: it arrives when the
 * world's clock reaches it, with a pop-up for whoever it's for. Players see which they haven't opened yet.
 */
export default {
  id: "letters",
  template: `${PATH}/templates/sections/letters.hbs`,

  async prepare(app) {
    const isGM = game.user.isGM;
    const read = new Set(store.readLetters());
    const now = worldNow();
    const sentOn = l => l.arrival ?? l.sentAt ?? 0;
    const all = store.all("letters").filter(l => store.isVisible("letters", l)).sort((a, b) => sentOn(b) - sentOn(a));
    const pending = l => !l.visible || ((l.arrival ?? 0) > now);

    const filters = isGM ? ["all", "pending"] : ["all", "unread"];
    const filter = filters.includes(app.filters.letters) ? app.filters.letters : "all";
    const listed = all.filter(l => (filter === "all") || (filter === "pending" ? pending(l) : !read.has(l.id)));
    if ( !listed.some(l => l.id === app.selected.letters) ) app.selected.letters = listed[0]?.id ?? null;

    const letter = listed.find(l => l.id === app.selected.letters);
    return {
      filters: filters.map(id => ({
        id,
        label: `${L}.Letters.Filters.${id}`,
        active: id === filter,
        count: id === "all" ? all.length : all.filter(l => (id === "pending" ? pending(l) : !read.has(l.id))).length
      })),
      rows: listed.map(l => ({
        id: l.id,
        title: l.title || loc("Untitled"),
        sender: l.sender,
        icon: LETTER_ICONS[l.kind] ?? LETTER_ICONS.letter,
        dateLabel: worldDate(sentOn(l)),
        unread: !isGM && !read.has(l.id),
        pending: isGM && pending(l),
        selected: l.id === app.selected.letters
      })),
      empty: !listed.length,
      canCreate: isGM,
      letter: letter ? {
        ...letter,
        title: letter.title || loc("Untitled"),
        body: await enrich(letter.body),
        icon: LETTER_ICONS[letter.kind] ?? LETTER_ICONS.letter,
        kindLabel: `${L}.Letters.Kinds.${letter.kind ?? "letter"}`,
        dateLabel: worldDate(sentOn(letter)),
        arrivesLabel: (isGM && ((letter.arrival ?? 0) > now)) ? worldDate(letter.arrival) : null,
        hidden: !letter.visible,
        viewers: isGM ? viewerNames(letter) : "",
        unread: !isGM && !read.has(letter.id)
      } : null
    };
  },

  /** Opening a letter marks it read. */
  onRender(app, element) {
    const id = element.querySelector(".wws-letter[data-unread]")?.dataset.id;
    if ( id ) store.markRead(id);
  },

  actions: {
    letterFilter(event, target) {
      this.filters.letters = target.dataset.filter;
      this.render();
    },

    letterSelect(event, target) {
      this.selected.letters = target.dataset.id;
      this.render();
    },

    letterNew() {
      openEditor("letter", {
        entry: { kind: "letter", visible: true },
        title: loc("Letters.New"),
        onSave: async data => {
          this.selected.letters = await store.create("letters", { ...data, sentAt: worldNow() });
        }
      });
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
      return showToPlayers("letters", target.dataset.id);
    }
  }
};

