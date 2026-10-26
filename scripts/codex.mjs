import { MODULE_ID, PATH, L, SECTION_IDS, SECTION_ICONS } from "./config.mjs";
import * as store from "./store.mjs";
import { playSound } from "./sounds.mjs";
import quests from "./sections/quests.mjs";
import journal from "./sections/journal.mjs";
import maps from "./sections/maps.mjs";
import factions from "./sections/factions.mjs";
import bestiary from "./sections/bestiary.mjs";
import notices from "./sections/notices.mjs";
import renown from "./sections/renown.mjs";
import merchants from "./sections/merchants.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Each section is a self-contained module: its template, the context it prepares, its actions and anything it wires up
 * after rendering. Adding a fifth means writing one more of these and listing it here.
 */
export const SECTIONS = { quests, journal, bestiary, notices, maps, factions, renown, merchants };

/** The world setting that switches a section on or off: showQuests, showJournal, showMaps, showFactions. */
export function sectionSetting(id) {
  return `show${id[0].toUpperCase()}${id.slice(1)}`;
}

/** The sections switched on in this world, in tab order. */
export function enabledSections() {
  return SECTION_IDS.filter(id => game.settings.get(MODULE_ID, sectionSetting(id)));
}

/** Which sections show each collection, so a change only re-renders the book when the open section uses it. */
const SHOWN_IN = {
  quests: ["quests", "maps", "factions", "renown"],
  notes: ["journal"],
  pins: ["maps", "quests"],
  maps: ["maps", "quests"],
  factions: ["factions", "quests", "maps", "renown", "merchants"],
  tracked: ["quests", "maps"],
  letters: ["journal"],
  readLetters: ["journal"],
  titles: ["renown"],
  merchants: ["merchants"],
  bestiary: ["bestiary"],
  notices: ["notices"],
  noticeRegions: ["notices"],
  time: ["journal", "renown", "merchants"]
};

/** How long the book takes to fade away, in milliseconds. */
const CLOSE_DURATION = 160;

/**
 * The book: full screen over the game, an open spread of parchment pages under a leather bar of tabs, as Simple
 * Quest and Oblivion's journal fill the screen. Only one is ever open. Windows (editors, pictures, dialogs) open
 * above it.
 */
export default class Codex extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @type {Codex|null} */
  static #instance = null;

  static get instance() {
    return this.#instance ??= new this();
  }

  /** The window if it has been opened before, without creating it. */
  static get existing() {
    return this.#instance;
  }

  static DEFAULT_OPTIONS = {
    id: "witchwind-codex",
    classes: ["wws", "wws-codex"],
    window: { frame: false, positioned: false },
    actions: Object.assign({ section: Codex.#onSection }, ...Object.values(SECTIONS).map(s => s.actions))
  };

  /** Re-render after a change to a collection, if the open section shows it. */
  static refresh(kind) {
    const app = this.#instance;
    if ( app?.rendered && (!kind || SHOWN_IN[kind]?.includes(app.section)) ) app.#scheduleRender();
  }

  #scheduleRender = foundry.utils.debounce(() => {
    if ( this.rendered && !this.#closing ) this.render();
  }, 50);

  static PARTS = {
    book: {
      template: `${PATH}/templates/codex.hbs`,
      templates: Object.values(SECTIONS).map(s => s.template),
      scrollable: [".wws-list-scroll", ".wws-detail-scroll"]
    }
  };

  /** The open section. */
  section = game.settings.get(MODULE_ID, "lastSection");

  /** The chosen entry in each section, by section id. */
  selected = {};

  /** The chosen list filter in each section. */
  filters = {};

  /** Search text in each section. */
  search = {};

  /** Map viewer state: the view of each map, the open marker, placing mode and labels. */
  mapViews = {};
  openPin = null;
  placing = false;
  mapLabels = true;
  focusPin = null;
  mapViewer = null;

  /** The focused text box and its caret, carried across a re-render so typing isn't interrupted. */
  #focus = null;

  /** What the last render showed, to tell which animation this one should play. */
  #shown = {};

  /** True while fading away. */
  #closing = false;

  get title() {
    return game.i18n.localize(`${L}.Sections.${this.section}`);
  }

  /* -------------------------------------------- */
  /*  Opening                                     */
  /* -------------------------------------------- */

  /** Open the window at a section, and optionally at one entry in it. */
  open(section, id) {
    const sections = enabledSections();
    if ( section && sections.includes(section) ) this.section = section;
    if ( id ) {
      this.selected[this.section] = id;
      this.#revealInList(this.section, id);
    }
    this.placing = false;
    return this.render({ force: true });
  }

  /** Open or close the book. */
  toggle(section) {
    if ( this.#closing ) return;
    if ( this.rendered && (!section || (section === this.section)) ) return this.close();
    return this.open(section);
  }

  /** Choose the next (1) or previous (-1) entry in the open list, as the arrow keys do. */
  step(delta) {
    const rows = Array.from(this.element?.querySelectorAll(
      ".wws-page-list button.wws-row[data-id], .wws-map-list button.wws-map-thumb[data-id], .wws-board button.wws-notice-card[data-id]") ?? []);
    if ( !rows.length ) return;
    const current = rows.findIndex(r => r.classList.contains("selected"));
    const next = rows[Math.clamp(current + delta, 0, rows.length - 1)] ?? rows[0];
    if ( !next.classList.contains("selected") ) next.click();
  }

  /** Move to the next (1) or previous (-1) tab, wrapping around. */
  stepTab(delta) {
    const sections = enabledSections();
    if ( sections.length < 2 ) return;
    const next = sections[(sections.indexOf(this.section) + delta + sections.length) % sections.length];
    this.element?.querySelector(`.wws-tab[data-section="${next}"]`)?.click();
  }

  /** Fade the overlay away, then close without core's window-collapsing transition. */
  async close(options={}) {
    if ( !this.rendered || this.#closing ) return this;
    this.#closing = true;
    playSound("close");
    try {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if ( !reduced && (options.animate !== false) ) {
        const fade = this.element.animate([{ opacity: 1 }, { opacity: 0, transform: "scale(1.01)" }],
          { duration: CLOSE_DURATION, easing: "ease-in", fill: "forwards" });
        // A page that isn't being drawn never finishes its animations, so don't wait on it for long.
        await Promise.race([fade.finished, new Promise(r => setTimeout(r, CLOSE_DURATION + 60))]);
      }
      return await super.close({ ...options, animate: false });
    } finally {
      this.#closing = false;
    }
  }

  /** Jump to a marker on its map, centered, with its card open. */
  showPin(pin) {
    this.selected.maps = pin.map;
    this.openPin = pin.id;
    this.focusPin = pin;
    if ( this.mapViews[pin.map] ) delete this.mapViews[pin.map];
    return this.open("maps");
  }

  /** Make sure a chosen entry isn't hidden by the section's list filter. */
  #revealInList(section, id) {
    if ( section === "quests" ) {
      const quest = store.get("quests", id);
      if ( quest && (this.filters.quests !== "updates") ) this.filters.quests = quest.status ?? "active";
    }
    if ( section === "journal" ) {
      this.filters.journal = "all";
      this.search.journal = "";
    }
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const sections = enabledSections();
    if ( !sections.includes(this.section) ) this.section = sections[0] ?? null;
    const section = SECTIONS[this.section];
    return {
      isGM: game.user.isGM,
      tabs: sections.map(id => ({
        id,
        icon: SECTION_ICONS[id],
        label: `${L}.Sections.${id}`,
        active: id === this.section
      })),
      sectionId: this.section,
      sectionTemplate: section?.template,
      page: section ? await section.prepare(this) : null
    };
  }

  /** @override */
  async _preRender(context, options) {
    await super._preRender(context, options);
    const active = this.element?.ownerDocument.activeElement;
    if ( active?.matches?.("input[data-focus-key]") && this.element.contains(active) ) {
      this.#focus = { key: active.dataset.focusKey, start: active.selectionStart, end: active.selectionEnd };
    } else this.#focus = null;
  }

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.element.setAttribute("role", "dialog");
    this.element.setAttribute("aria-modal", "true");
    this.element.setAttribute("aria-label", game.i18n.localize(`${L}.Title`));
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const el = this.element;
    el.dataset.section = this.section ?? "";
    const animation = el.dataset.animate = this.#animationFor(options);
    SECTIONS[this.section]?.onRender?.(this, el);

    // The book opens with its own sound and turns a page for each new tab or entry.
    if ( animation === "open" ) playSound("open");
    else if ( ["section", "entry", "list"].includes(animation) ) playSound("page");
    if ( animation === "entry" ) {
      el.querySelector(".wws-page-list .selected, .wws-map-thumb.selected")?.scrollIntoView({ block: "nearest" });
    }

    // Search boxes re-render the list as you type, keeping the caret where it was.
    for ( const input of this.element.querySelectorAll("input[data-focus-key]") ) {
      input.addEventListener("input", foundry.utils.debounce(() => {
        this.search[input.dataset.focusKey] = input.value;
        this.render();
      }, 200));
    }
    if ( this.#focus ) {
      const input = this.element.querySelector(`input[data-focus-key="${this.#focus.key}"]`);
      input?.focus();
      input?.setSelectionRange?.(this.#focus.start, this.#focus.end);
      this.#focus = null;
    }
  }

  /**
   * Which entrance this render plays: the whole book on opening, the pages on changing tab, the right page on
   * choosing another entry, the card on opening a marker. Re-renders for data changes play nothing, so ticking an
   * objective doesn't make the page flicker.
   */
  #animationFor(options) {
    const shown = { section: this.section, entry: this.selected[this.section], pin: this.openPin, filter: this.filters[this.section] };
    const before = this.#shown;
    const requested = this.nextAnimation;
    this.#shown = shown;
    this.nextAnimation = null;
    if ( options.isFirstRender ) return "open";
    if ( shown.section !== before.section ) return "section";
    if ( shown.filter !== before.filter ) return "list";
    if ( shown.entry !== before.entry ) return "entry";
    if ( shown.pin && (shown.pin !== before.pin) ) return "card";
    return requested ?? "";
  }

  /** An entrance for the next render only, such as "panel" when the map legend opens or "steps" when steps unfold. */
  nextAnimation = null;

  /** @override */
  _onClose(options) {
    super._onClose(options);
    this.mapViewer?.resizeObserver.disconnect();
    this.mapViewer = null;
    this.mapImage = null;
    this.placing = false;
    this.#shown = {};
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  static #onSection(event, target) {
    const section = target.dataset.section;
    if ( !SECTIONS[section] || (section === this.section) ) return;
    this.section = section;
    this.placing = false;
    game.settings.set(MODULE_ID, "lastSection", section);
    this.render();
  }
}
