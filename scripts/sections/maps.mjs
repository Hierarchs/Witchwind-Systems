import { PATH, L, PIN_ICONS, PIN_COLORS } from "../config.mjs";
import * as store from "../store.mjs";
import { openEditor } from "../editor.mjs";
import { uploadImage, canBrowse } from "../uploads.mjs";
import { loc, authorOf, confirmDelete, showToPlayers, viewerNames, byName } from "../helpers.mjs";

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 4;

/** A press that moves less than this many pixels is a click, not a drag. */
const DRAG_THRESHOLD = 4;

/** Room kept clear for the column of map tools along the stage's right edge. */
const TOOLS_WIDTH = 56;

export default {
  id: "maps",
  template: `${PATH}/templates/sections/maps.hbs`,

  async prepare(app) {
    const isGM = game.user.isGM;
    const maps = store.all("maps").filter(m => store.isVisible("maps", m))
      .sort((a, b) => ((a.sort ?? 0) - (b.sort ?? 0)) || byName(a, b));
    if ( !maps.some(m => m.id === app.selected.maps) ) app.selected.maps = maps[0]?.id ?? null;
    const map = maps.find(m => m.id === app.selected.maps);

    const tracked = new Set(store.tracked());
    const quests = new Map(store.all("quests").filter(q => store.isVisible("quests", q)).map(q => [q.id, q]));
    const onMap = map ? store.all("pins").filter(p => (p.map === map.id) && store.isVisible("pins", p)) : [];

    // The legend: each kind of marker on this map, which can be hidden from view.
    const hiddenIcons = app.mapHiddenIcons ??= new Set();
    const legend = Object.keys(PIN_ICONS).map(id => ({
      id,
      icon: PIN_ICONS[id],
      label: `${L}.Maps.Icons.${id}`,
      count: onMap.filter(p => iconKey(p) === id).length,
      hidden: hiddenIcons.has(id)
    })).filter(l => l.count);

    // Searching dims every marker whose name and notes don't match.
    const search = (app.search.maps ?? "").trim().toLowerCase();
    const matches = p => `${p.label ?? ""} ${p.text ?? ""}`.toLowerCase().includes(search);

    const pins = onMap.filter(p => !hiddenIcons.has(iconKey(p))).map(p => ({
      ...p,
      icon: PIN_ICONS[iconKey(p)],
      color: PIN_COLORS[p.color] ?? PIN_COLORS.gold,
      x: (p.x ?? 0.5) * 100,
      y: (p.y ?? 0.5) * 100,
      tracked: tracked.has(p.quest) && (quests.get(p.quest)?.status ?? "active") === "active",
      private: !p.shared,
      canEdit: store.canEdit("pins", p),
      open: p.id === app.openPin,
      match: !!search && matches(p),
      dim: !!search && !matches(p)
    }));
    if ( !pins.some(p => p.open) ) app.openPin = null;

    const open = pins.find(p => p.open);
    return {
      maps: maps.map(m => ({ id: m.id, name: m.name || loc("Untitled"), img: m.img, hidden: !m.visible, selected: m.id === map?.id })),
      map: map ? { ...map, name: map.name || loc("Untitled"), hidden: !map.visible, viewers: isGM ? viewerNames(map) : "" } : null,
      pins,
      legend,
      showLegend: !!app.mapLegend && (legend.length > 0),
      search: app.search.maps ?? "",
      matchCount: search ? pins.filter(p => p.match).length : null,
      card: open ? pinCard(open, quests) : null,
      labels: app.mapLabels,
      placing: app.placing,
      canPlace: !!map && store.canCreate("pins"),
      isGM,
      canBrowse: isGM && canBrowse()
    };
  },

  onRender(app, element) {
    const stage = element.querySelector(".wws-map-stage");
    if ( stage ) new MapViewer(app, stage);

    // Enter in the marker search jumps to the first match and opens its card.
    element.querySelector("input[data-focus-key=maps]")?.addEventListener("keydown", event => {
      if ( event.key !== "Enter" ) return;
      event.preventDefault();
      const id = element.querySelector(".wws-pin.match")?.dataset.id;
      const pin = id ? store.get("pins", id) : null;
      if ( !pin ) return;
      app.search.maps = event.target.value;
      app.showPin(pin);
    });

    // Upload pictures as new maps, from the Upload button or dropped onto the list of maps.
    const list = element.querySelector(".wws-map-list");
    if ( !list || !game.user.isGM ) return;
    const upload = async files => {
      files = Array.from(files ?? []).filter(f => f.type.startsWith("image/"));
      if ( !files.length ) return;
      ui.notifications.info(loc("Maps.Uploading"));
      for ( const file of files ) {
        try {
          const img = await uploadImage(file, "maps");
          app.selected.maps = await createMap(img, file.name);
        } catch(err) {
          ui.notifications.error(err.message);
        }
      }
    };
    const input = element.querySelector("input[type=file][data-map-upload]");
    input?.addEventListener("change", () => {
      upload(input.files);
      input.value = "";
    });
    list.addEventListener("dragover", event => {
      if ( !event.dataTransfer?.types?.includes("Files") ) return;
      event.preventDefault();
      list.classList.add("wws-drop-over");
    });
    list.addEventListener("dragleave", event => {
      if ( !list.contains(event.relatedTarget) ) list.classList.remove("wws-drop-over");
    });
    list.addEventListener("drop", event => {
      list.classList.remove("wws-drop-over");
      if ( !event.dataTransfer?.files?.length ) return;
      event.preventDefault();
      upload(event.dataTransfer.files);
    });
  },

  actions: {
    mapSelect(event, target) {
      this.selected.maps = target.dataset.id;
      this.openPin = null;
      this.placing = false;
      this.render();
    },

    /** Pick a picture already on the server, or upload one in the file picker, for a new map. */
    mapNew() {
      const FilePicker = foundry.applications.apps.FilePicker.implementation;
      new FilePicker({
        type: "image",
        callback: async path => {
          this.selected.maps = await createMap(path, path.split("/").pop());
        }
      }).render({ force: true });
    },

    mapUpload() {
      const input = this.element.querySelector("input[type=file][data-map-upload]");
      input?.click();
    },

    mapEdit(event, target) {
      const map = store.get("maps", target.dataset.id);
      if ( !map ) return;
      openEditor("map", {
        entry: map,
        title: loc("Maps.Edit", { name: map.name }),
        onSave: data => store.update("maps", map.id, data)
      });
    },

    async mapDelete(event, target) {
      const map = store.get("maps", target.dataset.id);
      if ( !map || !await confirmDelete(map.name) ) return;
      await store.removePinsOnMap(map.id);
      await store.remove("maps", map.id);
    },

    mapReveal(event, target) {
      const map = store.get("maps", target.dataset.id);
      if ( map ) return store.update("maps", map.id, { visible: !map.visible });
    },

    mapShow(event, target) {
      return showToPlayers("maps", target.dataset.id);
    },

    mapZoom(event, target) {
      this.mapViewer?.zoomBy(Number(target.dataset.step) || 1);
    },

    mapFit() {
      this.mapViewer?.fit();
    },

    mapLabels(event, target) {
      this.mapLabels = !this.mapLabels;
      this.element.querySelector(".wws-map-stage")?.classList.toggle("wws-labels", this.mapLabels);
      target.setAttribute("aria-pressed", String(this.mapLabels));
    },

    mapLegendToggle() {
      this.mapLegend = !this.mapLegend;
      if ( this.mapLegend ) this.nextAnimation = "panel";
      this.render();
    },

    /** Hide or show every marker with one icon. */
    mapLegend(event, target) {
      const hidden = this.mapHiddenIcons ??= new Set();
      const icon = target.dataset.icon;
      if ( hidden.has(icon) ) hidden.delete(icon);
      else hidden.add(icon);
      this.render();
    },

    pinNote(event, target) {
      this.open("journal", target.dataset.note);
    },

    mapPlace() {
      this.placing = !this.placing;
      if ( this.placing ) this.nextAnimation = "panel";
      this.openPin = null;
      this.render();
    },

    pinEdit(event, target) {
      const pin = store.get("pins", target.dataset.id);
      if ( !pin || !store.canEdit("pins", pin) ) return;
      openEditor("pin", {
        entry: pin,
        title: loc("Maps.EditPin", { name: pin.label || loc("Untitled") }),
        onSave: data => store.update("pins", pin.id, data)
      });
    },

    async pinDelete(event, target) {
      const pin = store.get("pins", target.dataset.id);
      if ( !pin || !store.canEdit("pins", pin) || !await confirmDelete(pin.label) ) return;
      this.openPin = null;
      await store.remove("pins", pin.id);
    },

    pinClose() {
      this.openPin = null;
      this.render();
    },

    pinQuest(event, target) {
      this.open("quests", target.dataset.quest);
    },

    pinFaction(event, target) {
      this.open("factions", target.dataset.faction);
    }
  }
};

/* -------------------------------------------- */

async function createMap(img, filename) {
  const name = filename.replace(/\.[^.]+$/, "").replace(/^[a-z0-9]{6}-/i, "").replace(/[-_]+/g, " ").trim();
  const sort = Math.max(0, ...store.all("maps").map(m => m.sort ?? 0)) + 1;
  return store.create("maps", { name: name ? name[0].toUpperCase() + name.slice(1) : loc("Untitled"), img, visible: false, sort });
}

const iconKey = pin => (pin.icon in PIN_ICONS ? pin.icon : "location");

function pinCard(pin, quests) {
  const quest = quests.get(pin.quest);
  const faction = store.get("factions", pin.faction);
  return {
    ...pin,
    label: pin.label || loc("Untitled"),
    author: authorOf(pin.author),
    quest: quest ? { id: quest.id, title: quest.title } : null,
    faction: store.isVisible("factions", faction) ? { id: faction.id, name: faction.name } : null,
    notes: store.all("notes").filter(n => (n.pin === pin.id) && store.isVisible("notes", n))
      .map(n => ({ id: n.id, title: n.title || loc("Untitled") })),
    viewers: pin.shared ? viewerNames(pin) : ""
  };
}

/* -------------------------------------------- */
/*  Viewer                                      */
/* -------------------------------------------- */

/**
 * Pans and zooms the map, places markers and drags them. Built afresh on every render; the view itself
 * (offset and zoom per map) is kept on the window so it survives re-renders.
 */
class MapViewer {
  constructor(app, stage) {
    this.app = app;
    this.stage = stage;
    this.layer = stage.querySelector(".wws-map-layer");
    this.image = stage.querySelector(".wws-map-image");
    this.card = stage.querySelector(".wws-pin-card");
    this.mapId = stage.dataset.map;
    app.mapViewer?.resizeObserver.disconnect();
    if ( app.mapViewer?.frame ) cancelAnimationFrame(app.mapViewer.frame);
    app.mapViewer = this;
    stage.classList.toggle("wws-labels", !!app.mapLabels);

    // Keep the picture already decoded by the last render, so a large map doesn't blink out and decode again
    // every time anything on the page changes.
    const kept = app.mapImage;
    if ( kept && (kept !== this.image) && kept.complete && kept.naturalWidth && (kept.src === this.image.src) ) {
      this.image.replaceWith(kept);
      this.image = kept;
    }
    app.mapImage = this.image;

    stage.addEventListener("wheel", this.#onWheel.bind(this), { passive: false });
    stage.addEventListener("pointerdown", this.#onPointerDown.bind(this));
    stage.addEventListener("dblclick", this.#onDoubleClick.bind(this));
    this.resizeObserver = new ResizeObserver(() => this.#placeCard());
    this.resizeObserver.observe(stage);

    if ( this.image.complete && this.image.naturalWidth ) this.#ready();
    else this.image.addEventListener("load", () => this.#ready(), { once: true });
  }

  get view() {
    return this.app.mapViews[this.mapId];
  }

  #ready() {
    this.width = this.image.naturalWidth;
    this.height = this.image.naturalHeight;
    this.layer.style.width = `${this.width}px`;
    this.layer.style.height = `${this.height}px`;
    if ( !this.view ) this.fit();
    else this.#apply();
    if ( this.app.focusPin ) {
      this.centerOn(this.app.focusPin);
      this.app.focusPin = null;
    }
    this.stage.classList.add("wws-ready");
  }

  #apply() {
    const { x, y, scale } = this.view;
    this.layer.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    this.layer.style.setProperty("--wws-zoom", String(scale));
    this.#placeCard();
  }

  /**
   * Apply the view on the next frame. Wheel and pointer events can arrive several times a frame; drawing once per
   * frame keeps panning and zooming smooth on large maps.
   */
  #schedule() {
    if ( this.frame ) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      if ( this.view ) this.#apply();
    });
  }

  fit() {
    if ( !this.width ) return;
    const { clientWidth: w, clientHeight: h } = this.stage;
    const scale = Math.clamp(Math.min(w / this.width, h / this.height), MIN_ZOOM, MAX_ZOOM);
    this.app.mapViews[this.mapId] = { scale, x: (w - (this.width * scale)) / 2, y: (h - (this.height * scale)) / 2 };
    this.#apply();
  }

  /** Zoom around a point on the stage (its center by default). */
  zoomBy(factor, cx=this.stage.clientWidth / 2, cy=this.stage.clientHeight / 2) {
    if ( !this.view ) return;
    const { x, y, scale } = this.view;
    const next = Math.clamp(scale * factor, MIN_ZOOM, MAX_ZOOM);
    const k = next / scale;
    this.app.mapViews[this.mapId] = { scale: next, x: cx - ((cx - x) * k), y: cy - ((cy - y) * k) };
    this.#schedule();
  }

  /** Bring a marker to the middle of the stage, zooming in to at least full size. */
  centerOn(pin) {
    if ( !this.width ) return;
    const scale = Math.max(this.view?.scale ?? 1, 1);
    const px = (pin.x ?? 0.5) * this.width * scale;
    const py = (pin.y ?? 0.5) * this.height * scale;
    this.app.mapViews[this.mapId] = {
      scale, x: (this.stage.clientWidth / 2) - px, y: (this.stage.clientHeight / 2) - py
    };
    this.#apply();
  }

  /** The point under the cursor, as fractions of the map's width and height. */
  #toMap(event) {
    const rect = this.layer.getBoundingClientRect();
    return {
      x: Math.clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: Math.clamp((event.clientY - rect.top) / rect.height, 0, 1)
    };
  }

  /** Keep the open marker's card beside its marker, inside the stage. */
  #placeCard() {
    if ( !this.card || !this.view || !this.width ) return;
    const pin = this.layer.querySelector(".wws-pin.open");
    if ( !pin ) return;
    const { x, y, scale } = this.view;
    const px = x + ((parseFloat(pin.style.left) / 100) * this.width * scale);
    const py = y + ((parseFloat(pin.style.top) / 100) * this.height * scale);
    const w = this.card.offsetWidth;
    const h = this.card.offsetHeight;
    const width = this.stage.clientWidth;
    // Beside the marker on its right, or on its left where the right would run into the map tools.
    let left = px + 22;
    if ( (left + w) > (width - TOOLS_WIDTH) ) left = px - 22 - w;
    left = Math.clamp(left, 8, Math.max(8, width - w - 8));
    const top = Math.clamp(py - (h / 2), 8, Math.max(8, this.stage.clientHeight - h - 8));
    this.card.style.left = `${left}px`;
    this.card.style.top = `${top}px`;
    this.card.hidden = false;
  }

  #onWheel(event) {
    if ( event.target.closest(".wws-pin-card, .wws-map-tools, .wws-legend") ) return;
    event.preventDefault();
    const rect = this.stage.getBoundingClientRect();
    this.zoomBy(event.deltaY < 0 ? 1.15 : (1 / 1.15), event.clientX - rect.left, event.clientY - rect.top);
  }

  #onPointerDown(event) {
    if ( (event.button !== 0) || !this.view ) return;
    if ( event.target.closest(".wws-pin-card, .wws-map-tools, .wws-legend") ) return;
    const pinEl = event.target.closest(".wws-pin");
    const start = { x: event.clientX, y: event.clientY, view: { ...this.view } };
    let moved = false;
    this.stage.setPointerCapture(event.pointerId);

    const pin = pinEl ? store.get("pins", pinEl.dataset.id) : null;
    const canDrag = pin && store.canEdit("pins", pin);

    const onMove = ev => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if ( !moved && (Math.hypot(dx, dy) < DRAG_THRESHOLD) ) return;
      moved = true;
      if ( pinEl ) {
        if ( !canDrag ) return;
        const p = this.#toMap(ev);
        pinEl.style.left = `${p.x * 100}%`;
        pinEl.style.top = `${p.y * 100}%`;
        pinEl.classList.add("dragging");
        this.#placeCard();
      } else {
        this.app.mapViews[this.mapId] = { ...start.view, x: start.view.x + dx, y: start.view.y + dy };
        this.#schedule();
        this.stage.classList.add("panning");
      }
    };

    const onUp = async ev => {
      this.stage.removeEventListener("pointermove", onMove);
      this.stage.removeEventListener("pointerup", onUp);
      this.stage.removeEventListener("pointercancel", onUp);
      this.stage.classList.remove("panning");
      if ( this.stage.hasPointerCapture(ev.pointerId) ) this.stage.releasePointerCapture(ev.pointerId);

      // Dragged a marker: save where it landed.
      if ( moved && pinEl && canDrag ) {
        const p = this.#toMap(ev);
        await store.update("pins", pin.id, { x: p.x, y: p.y });
        return;
      }
      if ( moved ) return;

      // Clicked a marker: open or close its card.
      if ( pinEl ) {
        this.app.openPin = this.app.openPin === pinEl.dataset.id ? null : pinEl.dataset.id;
        this.app.render();
        return;
      }

      // Clicked the map: place a marker if placing, otherwise close any open card.
      if ( this.app.placing ) this.#newPin(this.#toMap(ev));
      else if ( this.app.openPin ) {
        this.app.openPin = null;
        this.app.render();
      }
    };

    this.stage.addEventListener("pointermove", onMove);
    this.stage.addEventListener("pointerup", onUp);
    this.stage.addEventListener("pointercancel", onUp);
  }

  #onDoubleClick(event) {
    if ( event.target.closest(".wws-pin, .wws-pin-card, .wws-map-tools, .wws-legend") ) return;
    if ( !store.canCreate("pins") ) return;
    this.#newPin(this.#toMap(event));
  }

  #newPin({ x, y }) {
    const app = this.app;
    const map = this.mapId;
    app.placing = false;
    openEditor("pin", {
      entry: { map, x, y, shared: true },
      title: loc("Maps.NewPin"),
      onSave: async data => {
        app.openPin = await store.create("pins", { ...data, map, x, y });
      }
    });
    app.render();
  }
}
