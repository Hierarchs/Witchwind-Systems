import { MODULE_ID, L, SECTION_IDS, XERSERAYA_CALENDAR } from "./config.mjs";
import * as store from "./store.mjs";
import Codex, { enabledSections, sectionSetting } from "./codex.mjs";
import Tracker from "./tracker.mjs";
import { registerSocket, listen } from "./socket.mjs";
import { registerUploads } from "./uploads.mjs";
import { initBanners, announce, onWorldTime } from "./banner.mjs";
import { registerSheet } from "./sheet.mjs";
import { registerNoticeBoard } from "./sections/notices.mjs";
import { restockDue } from "./sections/merchants.mjs";
import { registerSounds, playSound } from "./sounds.mjs";
import { showNotice } from "./notice.mjs";
import DataManager from "./data.mjs";
import { SECTION_KINDS, resolveKind } from "./helpers.mjs";

/* -------------------------------------------- */
/*  Settings and keys                           */
/* -------------------------------------------- */

Hooks.once("init", () => {
  store.registerData();

  // The world's calendar: Xerseraya's, unless the GM keeps Foundry's own (or another calendar module's).
  game.settings.register(MODULE_ID, "calendar", {
    name: `${L}.Settings.Calendar.Name`,
    hint: `${L}.Settings.Calendar.Hint`,
    scope: "world",
    config: true,
    type: String,
    choices: { xerseraya: `${L}.Settings.Calendar.Choices.xerseraya`, world: `${L}.Settings.Calendar.Choices.world` },
    default: "xerseraya",
    requiresReload: true
  });
  if ( game.settings.get(MODULE_ID, "calendar") === "xerseraya" ) {
    CONFIG.time.worldCalendarConfig = XERSERAYA_CALENDAR;
    game.time?.initializeCalendar?.();
  }

  const register = (key, data) => game.settings.register(MODULE_ID, key, data);
  const refreshAll = () => {
    Codex.refresh();
    Tracker.refresh();
    ui.controls?.render({ reset: true });
  };

  // World: which tabs the table uses, and what players may add.
  for ( const id of SECTION_IDS ) {
    register(sectionSetting(id), {
      name: `${L}.Settings.Sections.${id}.Name`,
      hint: `${L}.Settings.Sections.${id}.Hint`,
      scope: "world",
      config: true,
      type: Boolean,
      default: true,
      onChange: refreshAll
    });
  }

  register("playerNotes", {
    name: `${L}.Settings.PlayerNotes.Name`,
    hint: `${L}.Settings.PlayerNotes.Hint`,
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: refreshAll
  });

  register("playerPins", {
    name: `${L}.Settings.PlayerPins.Name`,
    hint: `${L}.Settings.PlayerPins.Hint`,
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: refreshAll
  });

  register("announce", {
    name: `${L}.Settings.Announce.Name`,
    hint: `${L}.Settings.Announce.Hint`,
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  // Client: each player's own tracker and window.
  register("tracker", {
    name: `${L}.Settings.Tracker.Name`,
    hint: `${L}.Settings.Tracker.Hint`,
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => Tracker.refresh()
  });

  register("sheetRenown", {
    name: `${L}.Settings.SheetRenown.Name`,
    hint: `${L}.Settings.SheetRenown.Hint`,
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

  register("questPopups", {
    name: `${L}.Settings.QuestPopups.Name`,
    hint: `${L}.Settings.QuestPopups.Hint`,
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

  registerSounds();

  // Backups, restores and journal imports, behind a button in Configure Settings.
  game.settings.registerMenu(MODULE_ID, "data", {
    name: `${L}.Data.Title`,
    label: `${L}.Data.Open`,
    hint: `${L}.Data.Hint`,
    icon: "fa-solid fa-box-archive",
    type: DataManager,
    restricted: true
  });

  register("trackerCollapsed", { scope: "client", config: false, type: Boolean, default: false, onChange: () => Tracker.refresh() });
  register("trackerPosition", { scope: "client", config: false, type: Object, default: {} });
  register("lastSection", { scope: "client", config: false, type: String, default: "quests" });

  // J opens the book where you left it, as in the Elder Scrolls games; M opens it at the map.
  const keys = { toggle: "KeyJ", quests: null, journal: null, bestiary: null, notices: null, maps: "KeyM", factions: null, renown: null, merchants: null };
  for ( const [action, key] of Object.entries(keys) ) {
    game.keybindings.register(MODULE_ID, action, {
      name: `${L}.Keys.${action}`,
      editable: key ? [{ key }] : [],
      onDown: () => {
        if ( !enabledSections().length ) return false;
        Codex.instance.toggle(action === "toggle" ? undefined : action);
        return true;
      }
    });
  }

  // Escape closes the book, and the arrow keys browse it, while it's open and no window is. Core's own Escape closes
  // framed windows first, so those are left to it; the book closes on the next press. Taking the keys here also
  // keeps them from opening core's main menu or panning the canvas underneath.
  const bookKey = fn => () => {
    if ( !Codex.existing?.rendered ) return false;
    const framed = Array.from(foundry.applications.instances.values()).some(app => app.hasFrame && app.rendered);
    if ( framed || Object.keys(ui.windows ?? {}).length ) return false;
    fn(Codex.existing);
    return true;
  };
  const bookKeys = {
    dismiss: { keys: [], uneditable: ["Escape"], fn: book => book.close() },
    nextEntry: { keys: ["ArrowDown"], fn: book => book.step(1) },
    previousEntry: { keys: ["ArrowUp"], fn: book => book.step(-1) },
    nextTab: { keys: ["ArrowRight"], fn: book => book.stepTab(1) },
    previousTab: { keys: ["ArrowLeft"], fn: book => book.stepTab(-1) }
  };
  for ( const [action, { keys, uneditable = [], fn }] of Object.entries(bookKeys) ) {
    game.keybindings.register(MODULE_ID, action, {
      name: `${L}.Keys.${action}`,
      editable: keys.map(key => ({ key })),
      uneditable: uneditable.map(key => ({ key })),
      precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY,
      repeat: action !== "dismiss",
      onDown: bookKey(fn)
    });
  }
});

/* -------------------------------------------- */
/*  Buttons that open it                        */
/* -------------------------------------------- */

// A button among the token tools on the left, always there for players and GMs alike.
Hooks.on("getSceneControlButtons", controls => {
  const tokens = controls.tokens;
  if ( !tokens ) return;
  tokens.tools.witchwindSystems = {
    name: "witchwindSystems",
    title: `${L}.Open`,
    icon: "fa-solid fa-book-open-cover",
    order: Object.keys(tokens.tools).length,
    button: true,
    visible: enabledSections().length > 0,
    onChange: () => Codex.instance.toggle()
  };
});

// And one at the top of the Journal tab, which works even with no scene open.
Hooks.on("renderJournalDirectory", (app, html) => {
  const header = html.querySelector(".directory-header");
  if ( !header || header.querySelector(".wws-launch") || !enabledSections().length ) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "wws-launch";
  button.innerHTML = `<i class="fa-solid fa-book-open-cover" inert></i><span></span>`;
  button.querySelector("span").textContent = game.i18n.localize(`${L}.Open`);
  button.addEventListener("click", () => Codex.instance.open());
  header.prepend(button);
});

/* -------------------------------------------- */
/*  Ready                                       */
/* -------------------------------------------- */

Hooks.once("ready", () => {
  registerSocket();
  registerUploads();
  initBanners();

  // A GM's "Show to players" opens the entry for everyone who can see it.
  listen("show", ({ section, id }) => {
    const kind = resolveKind(section, id);
    if ( !enabledSections().includes(section) || !store.isVisible(kind, store.get(kind, id)) ) return;
    if ( section === "maps" ) Codex.instance.openPin = null;
    Codex.instance.open(section, id);
  });

  // Re-render only what a change touches: the book when its open section shows that collection, the tracker when
  // quests or this user's tracked quests change. Other users' tracking changes nothing here.
  const refreshTracker = foundry.utils.debounce(() => Tracker.refresh(), 50);
  store.onChange((kind, userId) => {
    if ( (kind === "tracked") && (userId !== game.user.id) ) return;
    Codex.refresh(kind);
    if ( (kind === "quests") || (kind === "tracked") ) refreshTracker();
  });
  Tracker.refresh();
  registerSheet();
  registerNoticeBoard();

  // As the world's clock moves, held-back letters arrive and merchants restock.
  Hooks.on("updateWorldTime", () => {
    onWorldTime();
    Codex.refresh("time");
    restockDue();
  });

  game.modules.get(MODULE_ID).api = {
    /** Open the window, optionally at a section ("quests", "journal", "maps", "factions") and an entry's id. */
    open: (section, id) => Codex.instance.open(section, id),
    toggle: section => Codex.instance.toggle(section),
    close: () => Codex.existing?.close(),
    /** Show an Elder Scrolls style banner on this client: { label, title, detail }. */
    announce,
    /** Show an Oblivion style quest pop-up on this client: { label, title, detail, img, questId }. */
    notice: showNotice,
    /** Play one of the module's sounds on this client: "open", "close", "page" or "quest". */
    playSound,
    store
  };
});
