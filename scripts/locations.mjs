import { MODULE_ID, PATH, L, LOCATION_THEMES } from "./config.mjs";
import * as store from "./store.mjs";
import { openEditor } from "./editor.mjs";
import { enrich, loc, confirmDelete } from "./helpers.mjs";
import { broadcast, listen } from "./socket.mjs";
import { playSound } from "./sounds.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/*
 * Location cards: a place written up once, with a theme, a picture or a few, tags and a few lines, and pinned
 * wherever it's needed: on any scene's canvas, and on markers on the book's maps. Clicking one shows its card;
 * double-clicking opens the gallery, with every picture and the full text. The GM can show it to the players.
 */

export const CARD_TEMPLATE = `${PATH}/templates/location-card.hbs`;

/** A press on a marker that moves less than this many pixels is a click, not a drag. */
const DRAG_THRESHOLD = 4;

const themeOf = location => (LOCATION_THEMES.includes(location?.theme) ? location.theme : LOCATION_THEMES[0]);

/** Everything the card and the gallery show of a location. */
export async function locationView(location) {
  const images = [location.img, ...(location.images ?? [])].filter(Boolean);
  const title = location.title || loc("Untitled");
  return {
    id: location.id,
    theme: themeOf(location),
    title,
    initial: Array.from(title)[0] ?? "",
    kicker: location.kicker ?? "",
    chips: (location.chips ?? []).filter(c => c.label || c.value),
    body: await enrich(location.body ?? ""),
    caption: location.caption ?? "",
    images,
    cover: images[0] ?? "",
    dots: (images.length > 1) ? images.slice(0, 6).map((src, i) => ({ on: i === 0 })) : [],
    hasJournal: !!location.journal,
    hidden: !location.visible,
    isGM: game.user.isGM,
    stamp: loc("Locations.Stamp")
  };
}

/** Fade the foot of a card's text where it runs on past the card, and only then. */
export function markClipped(root) {
  for ( const body of root?.querySelectorAll?.(".wws-loc .wws-loc-body") ?? [] ) {
    body.classList.toggle("wws-clipped", body.scrollHeight > (body.clientHeight + 1));
  }
}

/** Change a location card, in the editor. */
export function editLocation(id) {
  const location = store.get("locations", id);
  if ( !location ) return;
  openEditor("location", {
    entry: location,
    title: loc("Locations.Edit", { name: location.title || loc("Untitled") }),
    onSave: data => store.update("locations", id, data)
  });
}

/** Show a location to the players: reveal it if it's hidden, then open its gallery on every screen. */
export async function showLocation(id) {
  const location = store.get("locations", id);
  if ( !game.user.isGM || !location ) return;
  if ( !location.visible ) await store.update("locations", id, { visible: true });
  broadcast("showLocation", { id });
  ui.notifications.info(loc("ShownToPlayers"));
}

/** Open the journal entry or page a location is linked to, at that page. */
async function openJournal(uuid) {
  const doc = uuid ? await foundry.utils.fromUuid(uuid).catch(() => null) : null;
  if ( !doc ) return ui.notifications.warn(loc("Locations.JournalMissing"));
  const entry = (doc.documentName === "JournalEntryPage") ? doc.parent : doc;
  if ( !entry?.testUserPermission?.(game.user, "LIMITED") ) return ui.notifications.warn(loc("Errors.NoPermission"));
  entry.sheet?.render({ force: true, pageId: (entry === doc) ? undefined : doc.id });
}

/* -------------------------------------------- */
/*  The card on the scene                       */
/* -------------------------------------------- */

/** The one card open over the scene, and the marker it belongs to. */
const popup = { el: null, id: null, anchor: null };

/** Show a location's card beside its marker. Clicking the same marker again closes it. */
export async function showCard(id, anchor) {
  if ( (popup.id === id) && (popup.anchor === anchor) ) return hideCard();
  const location = store.get("locations", id);
  if ( !location || !store.isVisible("locations", location) ) return hideCard();
  const html = await foundry.applications.handlebars.renderTemplate(CARD_TEMPLATE, await locationView(location));
  hideCard();
  const el = document.createElement("div");
  el.className = "wws wws-loc-popup";
  el.innerHTML = html;
  el.addEventListener("dblclick", () => LocationGallery.open(id));
  el.querySelector("[data-action=locationGallery]")?.addEventListener("click", () => LocationGallery.open(id));
  document.body.append(el);
  Object.assign(popup, { el, id, anchor });
  document.addEventListener("pointerdown", onOutsideCard, true);
  markClipped(el);
  placeCard();
}

export function hideCard() {
  popup.el?.remove();
  Object.assign(popup, { el: null, id: null, anchor: null });
  document.removeEventListener("pointerdown", onOutsideCard, true);
}

/** A press anywhere but the card or a marker closes the card. */
function onOutsideCard(event) {
  if ( !popup.el || popup.el.contains(event.target) || event.target.closest?.(".wws-loc-marker") ) return;
  hideCard();
}

/** Keep the open card beside its marker, on whichever side has room, inside the screen. */
function placeCard() {
  const { el, anchor } = popup;
  if ( !el ) return;
  if ( !anchor?.isConnected ) return hideCard();
  const a = anchor.getBoundingClientRect();
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const gap = 14;
  let left = a.right + gap;
  if ( (left + w) > (window.innerWidth - 8) ) left = a.left - gap - w;
  left = Math.clamp(left, 8, Math.max(8, window.innerWidth - w - 8));
  const top = Math.clamp(a.top + (a.height / 2) - (h / 2), 8, Math.max(8, window.innerHeight - h - 8));
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

/* -------------------------------------------- */
/*  The gallery                                 */
/* -------------------------------------------- */

/**
 * A location's pictures, large, with its full text beside them: arrows and thumbnails to go through the pictures,
 * the linked journal, and for the GM a button to show it to the players. While it's open, Escape closes it and the
 * arrow keys turn the pictures, before anything else on the page hears them.
 */
export class LocationGallery extends HandlebarsApplicationMixin(ApplicationV2) {

  static #instance = null;

  static DEFAULT_OPTIONS = {
    id: "witchwind-gallery",
    classes: ["wws", "wws-gallery"],
    window: { frame: false, positioned: false },
    actions: {
      galleryClose: LocationGallery.#onClose,
      galleryPrev: LocationGallery.#onPrev,
      galleryNext: LocationGallery.#onNext,
      galleryPick: LocationGallery.#onPick,
      galleryJournal: LocationGallery.#onJournal,
      galleryShow: LocationGallery.#onShow
    }
  };

  static PARTS = {
    gallery: { template: `${PATH}/templates/location-gallery.hbs` }
  };

  static get isOpen() {
    return !!this.#instance?.rendered;
  }

  /** Open the gallery at one of a location's pictures, the first unless told otherwise. */
  static open(id, index=0) {
    const location = store.get("locations", id);
    if ( !location || !store.isVisible("locations", location) ) return;
    hideCard();
    const app = this.#instance ??= new this();
    app.locationId = id;
    app.index = index;
    return app.render({ force: true });
  }

  /** Redraw after the open location changes, or close if it's gone or hidden. */
  static refresh() {
    const app = this.#instance;
    if ( !app?.rendered ) return;
    const location = store.get("locations", app.locationId);
    if ( !location || !store.isVisible("locations", location) ) return app.close();
    app.render();
  }

  locationId = null;
  index = 0;
  #onKey = this.#keydown.bind(this);

  /** @override */
  async _prepareContext(options) {
    const view = await locationView(store.get("locations", this.locationId));
    const count = view.images.length;
    this.index = count ? (((this.index % count) + count) % count) : 0;
    return {
      ...view,
      current: view.images[this.index] ?? "",
      many: count > 1,
      thumbs: view.images.map((src, index) => ({ src, index, on: index === this.index })),
      position: (count > 1) ? loc("Locations.Position", { n: this.index + 1, of: count }) : ""
    };
  }

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    window.addEventListener("keydown", this.#onKey, true);
    playSound("page");
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.element.querySelector(".wws-gallery-close")?.focus({ preventScroll: true });
  }

  /** @override */
  _onClose(options) {
    super._onClose(options);
    window.removeEventListener("keydown", this.#onKey, true);
  }

  #keydown(event) {
    const keys = { Escape: () => this.close(), ArrowLeft: () => this.#step(-1), ArrowRight: () => this.#step(1) };
    const run = keys[event.key];
    if ( !run || event.target.closest?.("input, textarea, [contenteditable]") ) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    run();
  }

  /** Turn to another picture, with a page turn when there's more than one to turn to. */
  #turnTo(index) {
    const location = store.get("locations", this.locationId);
    const count = [location?.img, ...(location?.images ?? [])].filter(Boolean).length;
    if ( (count > 1) && (index !== this.index) ) playSound("page");
    this.index = index;
    this.render();
  }

  #step(delta) {
    this.#turnTo(this.index + delta);
  }

  static #onClose() {
    return this.close();
  }

  static #onPrev() {
    this.#step(-1);
  }

  static #onNext() {
    this.#step(1);
  }

  static #onPick(event, target) {
    this.#turnTo(Number(target.dataset.index) || 0);
  }

  static #onJournal() {
    return openJournal(store.get("locations", this.locationId)?.journal);
  }

  static #onShow() {
    return showLocation(this.locationId);
  }
}

/* -------------------------------------------- */
/*  Markers on the scene                        */
/* -------------------------------------------- */

/*
 * Location markers on the scene's canvas live in a layer of the page laid over the canvas and moved with it, so a
 * pan or a zoom is one transform on the layer, and each marker keeps its size on screen. Where each marker stands is
 * kept in the scene's flags, as [{ id, location, x, y }] in the scene's pixels; the card itself is a world entry.
 */
const scene = { layer: null, catcher: null, view: { left: 0, top: 0 }, placing: false };

/** The markers on a scene. */
function placements(doc=globalThis.canvas?.scene) {
  const list = doc?.getFlag(MODULE_ID, "locations");
  return Array.isArray(list) ? list : [];
}

function savePlacements(doc, list) {
  return doc.setFlag(MODULE_ID, "locations", list);
}

/** The canvas's pan and zoom as a scale and an offset, read from the stage itself so it's current during a pan. */
function stageTransform() {
  const stage = globalThis.canvas.stage;
  const s = stage.scale.x || 1;
  return { s, tx: stage.position.x - (stage.pivot.x * s), ty: stage.position.y - (stage.pivot.y * s) };
}

/** A point on the screen as a point in the scene. */
function toScene(clientX, clientY) {
  const { s, tx, ty } = stageTransform();
  return { x: (clientX - scene.view.left - tx) / s, y: (clientY - scene.view.top - ty) / s };
}

/** Where the canvas sits on the page, measured when the scene is drawn and when the window resizes. */
function measureView() {
  const view = globalThis.canvas?.app?.view ?? globalThis.canvas?.app?.canvas ?? document.getElementById("board");
  const r = view?.getBoundingClientRect?.();
  scene.view = r ? { left: r.left, top: r.top } : { left: 0, top: 0 };
}

/** The layer over the canvas, made the first time it's needed, just above the canvas and below the interface. */
function ensureLayer() {
  if ( scene.layer?.isConnected ) return scene.layer;
  const layer = document.createElement("div");
  layer.id = "witchwind-locations";
  layer.className = "wws";
  const board = document.getElementById("board");
  if ( board ) board.after(layer);
  else document.body.prepend(layer);
  scene.layer = layer;
  return layer;
}

/** Move the layer with the canvas: one transform, and the zoom for the markers to keep their size. */
function alignLayer() {
  const layer = scene.layer;
  if ( !layer?.isConnected || !globalThis.canvas?.ready ) return;
  const { s, tx, ty } = stageTransform();
  layer.style.transform = `translate(${scene.view.left + tx}px, ${scene.view.top + ty}px) scale(${s})`;
  layer.style.setProperty("--wws-zoom", s);
  if ( popup.el ) placeCard();
}

/** Build the markers for the scene in view: each card the viewer may see, the GM's hidden ones dimmed. */
function drawMarkers() {
  if ( !globalThis.canvas?.ready || !globalThis.canvas.scene ) return clearMarkers();
  const layer = ensureLayer();
  const nodes = [];
  for ( const p of placements() ) {
    const location = store.get("locations", p.location);
    if ( location && store.isVisible("locations", location) ) nodes.push(markerNode(p, location));
  }
  layer.replaceChildren(...nodes);
  alignLayer();
  // Keep an open card on its marker, if the marker is still there.
  if ( popup.el ) {
    const anchor = layer.querySelector(`[data-placement="${popup.anchor?.dataset.placement}"]`);
    if ( anchor ) {
      popup.anchor = anchor;
      placeCard();
    }
    else hideCard();
  }
}

function clearMarkers() {
  hideCard();
  setPlacing(false);
  scene.layer?.replaceChildren();
}

function markerNode(p, location) {
  const title = location.title || loc("Untitled");
  const button = document.createElement("button");
  button.type = "button";
  button.className = `wws-loc-marker wws-theme-${themeOf(location)}${location.visible ? "" : " wws-hidden-marker"}`;
  button.dataset.placement = p.id;
  button.dataset.location = location.id;
  button.dataset.tooltip = foundry.utils.escapeHTML(title);
  button.setAttribute("aria-label", title);
  button.style.left = `${p.x}px`;
  button.style.top = `${p.y}px`;
  button.innerHTML = `<i class="fa-solid fa-diamond" inert></i>`;
  button.addEventListener("pointerdown", onMarkerDown);
  button.addEventListener("dblclick", () => LocationGallery.open(location.id));
  if ( game.user.isGM ) button.addEventListener("contextmenu", onMarkerMenu);
  return button;
}

/** A click on a marker opens its card; the GM can also drag it somewhere else on the scene. */
function onMarkerDown(event) {
  if ( event.button !== 0 ) return;
  const marker = event.currentTarget;
  const start = { x: event.clientX, y: event.clientY };
  const doc = globalThis.canvas.scene;
  let moved = false;
  marker.setPointerCapture(event.pointerId);

  const onMove = ev => {
    if ( !game.user.isGM ) return;
    if ( !moved && (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_THRESHOLD) ) return;
    moved = true;
    const p = toScene(ev.clientX, ev.clientY);
    marker.style.left = `${p.x}px`;
    marker.style.top = `${p.y}px`;
    marker.classList.add("dragging");
    if ( popup.anchor === marker ) placeCard();
  };

  const onUp = ev => {
    marker.removeEventListener("pointermove", onMove);
    marker.removeEventListener("pointerup", onUp);
    marker.removeEventListener("pointercancel", onUp);
    marker.classList.remove("dragging");
    if ( ev.type === "pointercancel" ) return;
    if ( moved ) {
      const p = toScene(ev.clientX, ev.clientY);
      const id = marker.dataset.placement;
      return savePlacements(doc, placements(doc).map(m => ((m.id === id) ? { ...m, x: Math.round(p.x), y: Math.round(p.y) } : m)));
    }
    showCard(marker.dataset.location, marker);
  };

  marker.addEventListener("pointermove", onMove);
  marker.addEventListener("pointerup", onUp);
  marker.addEventListener("pointercancel", onUp);
}

/** The GM's menu on a marker: change the card, show it, hide it, or take it off this scene. */
function onMarkerMenu(event) {
  event.preventDefault();
  const marker = event.currentTarget;
  const location = store.get("locations", marker.dataset.location);
  const doc = globalThis.canvas.scene;
  if ( !location || !doc ) return;
  const id = marker.dataset.placement;
  openMenu(event.clientX, event.clientY, location.title || loc("Untitled"), [
    { icon: "fa-solid fa-pen-to-square", label: loc("Edit"), run: () => editLocation(location.id) },
    { icon: "fa-solid fa-images", label: loc("Locations.Gallery"), run: () => LocationGallery.open(location.id) },
    { icon: "fa-solid fa-bullhorn", label: loc("ShowToPlayers"), run: () => showLocation(location.id) },
    {
      icon: location.visible ? "fa-solid fa-eye-slash" : "fa-solid fa-eye",
      label: loc(location.visible ? "Hide" : "Reveal"),
      run: () => store.update("locations", location.id, { visible: !location.visible })
    },
    {
      icon: "fa-solid fa-xmark",
      label: loc("Locations.Remove"),
      run: () => savePlacements(doc, placements(doc).filter(m => m.id !== id))
    },
    {
      icon: "fa-solid fa-trash",
      label: loc("Locations.Delete"),
      danger: true,
      run: async () => {
        if ( !await confirmDelete(location.title) ) return;
        await savePlacements(doc, placements(doc).filter(m => m.location !== location.id));
        await store.remove("locations", location.id);
      }
    }
  ]);
}

/* -------------------------------------------- */
/*  Placing a card                              */
/* -------------------------------------------- */

export function isPlacing() {
  return scene.placing;
}

/**
 * Turn placing on or off. While it's on, a click on the canvas offers to put a card there; Escape or a right-click
 * stops. fromControls says the scene controls' own switch did it, so they needn't be redrawn to match.
 */
export function setPlacing(on, { fromControls=false }={}) {
  on = !!on && game.user.isGM && !!globalThis.canvas?.ready && !!globalThis.canvas.scene;
  if ( on === scene.placing ) return;
  scene.placing = on;
  if ( on ) {
    const catcher = document.createElement("div");
    catcher.id = "witchwind-locations-catcher";
    catcher.className = "wws";
    catcher.innerHTML = `<p class="wws-loc-placing-hint"><i class="fa-solid fa-map-location-dot" inert></i> <span></span></p>`;
    catcher.querySelector("span").textContent = loc("Locations.PlaceHint");
    catcher.addEventListener("click", onPlaceClick);
    catcher.addEventListener("contextmenu", event => {
      event.preventDefault();
      setPlacing(false);
    });
    ensureLayer().after(catcher);
    scene.catcher = catcher;
    window.addEventListener("keydown", onPlaceKey, true);
  }
  else {
    scene.catcher?.remove();
    scene.catcher = null;
    window.removeEventListener("keydown", onPlaceKey, true);
  }
  if ( !fromControls ) ui.controls?.render?.({ reset: true });
}

function onPlaceKey(event) {
  if ( event.key !== "Escape" ) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  setPlacing(false);
}

/** A click while placing: put an existing card there, or write a new one. */
function onPlaceClick(event) {
  const doc = globalThis.canvas.scene;
  const point = toScene(event.clientX, event.clientY);
  setPlacing(false);
  const cards = store.all("locations").sort((a, b) => (a.title ?? "").localeCompare(b.title ?? ""));
  openMenu(event.clientX, event.clientY, loc("Locations.Choose"), [
    { icon: "fa-solid fa-plus", label: loc("Locations.NewCard"), run: () => newCardAt(doc, point) },
    ...cards.map(c => ({
      icon: "fa-solid fa-diamond",
      label: c.title || loc("Untitled"),
      theme: themeOf(c),
      run: () => placeAt(doc, c.id, point)
    }))
  ]);
}

function placeAt(doc, locationId, { x, y }) {
  const list = [...placements(doc), { id: foundry.utils.randomID(), location: locationId, x: Math.round(x), y: Math.round(y) }];
  return savePlacements(doc, list);
}

function newCardAt(doc, point) {
  openEditor("location", {
    entry: { theme: LOCATION_THEMES[0], visible: false },
    title: loc("Locations.New"),
    onSave: async data => placeAt(doc, await store.create("locations", data), point)
  });
}

/* -------------------------------------------- */
/*  A small menu                                */
/* -------------------------------------------- */

let menuEl = null;

/** A small menu at a point on the screen, closed by choosing from it, clicking elsewhere, or Escape. */
function openMenu(clientX, clientY, title, items) {
  closeMenu();
  const menu = document.createElement("div");
  menu.className = "wws wws-loc-menu";
  menu.setAttribute("role", "menu");
  if ( title ) {
    const head = document.createElement("p");
    head.className = "wws-loc-menu-title";
    head.textContent = title;
    menu.append(head);
  }
  for ( const item of items ) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    if ( item.theme ) button.classList.add(`wws-theme-${item.theme}`);
    if ( item.danger ) button.classList.add("wws-bad");
    button.innerHTML = `<i class="${item.icon}" inert></i> <span></span>`;
    button.querySelector("span").textContent = item.label;
    button.addEventListener("click", () => {
      closeMenu();
      item.run();
    });
    menu.append(button);
  }
  document.body.append(menu);
  menu.style.left = `${Math.clamp(clientX, 8, Math.max(8, window.innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${Math.clamp(clientY, 8, Math.max(8, window.innerHeight - menu.offsetHeight - 8))}px`;
  menuEl = menu;
  menu.querySelector("button")?.focus({ preventScroll: true });
  setTimeout(() => document.addEventListener("pointerdown", onOutsideMenu, true));
  window.addEventListener("keydown", onMenuKey, true);
}

function closeMenu() {
  menuEl?.remove();
  menuEl = null;
  document.removeEventListener("pointerdown", onOutsideMenu, true);
  window.removeEventListener("keydown", onMenuKey, true);
}

function onOutsideMenu(event) {
  if ( menuEl && !menuEl.contains(event.target) ) closeMenu();
}

function onMenuKey(event) {
  if ( event.key !== "Escape" ) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  closeMenu();
}

/* -------------------------------------------- */

/** Draw the markers with each scene, keep them on the canvas as it moves, and listen for cards shown to the table. */
export function registerLocations() {
  Hooks.on("canvasReady", () => {
    measureView();
    drawMarkers();
  });
  Hooks.on("canvasPan", () => alignLayer());
  Hooks.on("canvasTearDown", () => clearMarkers());
  Hooks.on("updateScene", (doc, changes) => {
    if ( (doc.id === globalThis.canvas?.scene?.id) && ("flags" in changes) ) drawMarkers();
  });
  store.onChange(kind => {
    if ( kind !== "locations" ) return;
    drawMarkers();
    LocationGallery.refresh();
  });
  window.addEventListener("resize", foundry.utils.debounce(() => {
    measureView();
    alignLayer();
  }, 100));
  listen("showLocation", ({ id }) => LocationGallery.open(id));
  if ( globalThis.canvas?.ready ) {
    measureView();
    drawMarkers();
  }
}
