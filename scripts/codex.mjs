import { MODULE_ID, PATH, L, SECTION_IDS, SECTION_ICONS } from "./config.mjs";
import * as store from "./store.mjs";
import quests from "./sections/quests.mjs";
import journal from "./sections/journal.mjs";
import maps from "./sections/maps.mjs";
import factions from "./sections/factions.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Each section is a self-contained module: its template, the context it prepares, its actions and anything it wires up
 * after rendering. Adding a fifth means writing one more of these and listing it here.
 */
export const SECTIONS = { quests, journal, maps, factions };

/** The world setting that switches a section on or off: showQuests, showJournal, showMaps, showFactions. */
export function sectionSetting(id) {
  return `show${id[0].toUpperCase()}${id.slice(1)}`;
}

/** The sections switched on in this world, in tab order. */
export function enabledSections() {
  return SECTION_IDS.filter(id => game.settings.get(MODULE_ID, sectionSetting(id)));
}

/**
 * The window: an open book of parchment pages in a leather cover, with Oblivion's row of tabs along the bottom.
 * Only one is ever open.
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
    window: { icon: "fa-solid fa-book-open-cover", resizable: true },
    position: { width: 1000, height: 720 },
    actions: Object.assign({ section: Codex.#onSection }, ...Object.values(SECTIONS).map(s => s.actions))
  };

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
    if ( this.rendered ) {
      if ( this.minimized ) this.maximize();
      this.bringToFront();
    }
    return this.render({ force: true });
  }

  /** Open or close the window. */
  toggle(section) {
    if ( this.rendered && (!section || (section === this.section)) ) return this.close();
    return this.open(section);
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
  async _onRender(context, options) {
    await super._onRender(context, options);
    if ( this.window.title ) this.window.title.textContent = this.title;
    this.element.dataset.section = this.section ?? "";
    SECTIONS[this.section]?.onRender?.(this, this.element);

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

  /** @override */
  _onClose(options) {
    super._onClose(options);
    this.mapViewer?.resizeObserver.disconnect();
    this.mapViewer = null;
    this.placing = false;
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
