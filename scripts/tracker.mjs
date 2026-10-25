import { MODULE_ID, PATH, L } from "./config.mjs";
import * as store from "./store.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The quests you're following and what's left to do in each, in a small steel card on the screen, as the
 * Elder Scrolls games keep your current objective in view. Drag it by its title to move it.
 */
export default class Tracker extends HandlebarsApplicationMixin(ApplicationV2) {

  static #instance = null;

  static get instance() {
    return this.#instance ??= new this();
  }

  static DEFAULT_OPTIONS = {
    id: "witchwind-tracker",
    classes: ["wws", "wws-tracker"],
    tag: "aside",
    window: { frame: false, positioned: false },
    actions: {
      trackerOpen: Tracker.#onOpen,
      trackerCollapse: Tracker.#onCollapse,
      trackerUntrack: Tracker.#onUntrack
    }
  };

  static PARTS = {
    list: { template: `${PATH}/templates/tracker.hbs` }
  };

  /** Show, refresh or hide the tracker to match the setting and what's tracked. */
  static refresh() {
    const show = game.settings.get(MODULE_ID, "tracker") && game.settings.get(MODULE_ID, "showQuests");
    if ( show ) this.instance.render({ force: true });
    else if ( this.#instance?.rendered ) this.#instance.close();
  }

  /** @override */
  async _prepareContext(options) {
    const quests = store.tracked()
      .map(id => store.get("quests", id))
      .filter(q => store.isVisible("quests", q) && ((q.status ?? "active") === "active"))
      .map(q => ({
        id: q.id,
        title: q.title,
        objectives: (q.objectives ?? []).filter(o => !o.hidden && !o.done && !o.failed),
        location: q.location
      }));
    return { quests, collapsed: game.settings.get(MODULE_ID, "trackerCollapsed") };
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const el = this.element;
    el.hidden = !context.quests.length;
    const { left, top } = game.settings.get(MODULE_ID, "trackerPosition") ?? {};
    if ( Number.isFinite(left) && Number.isFinite(top) ) this.#moveTo(left, top);
    el.querySelector(".wws-tracker-head")?.addEventListener("pointerdown", this.#onDragStart.bind(this));
  }

  /** Place the card, kept inside the screen. */
  #moveTo(left, top) {
    const el = this.element;
    const maxLeft = Math.max(0, window.innerWidth - el.offsetWidth);
    const maxTop = Math.max(0, window.innerHeight - 40);
    el.style.left = `${Math.clamp(left, 0, maxLeft)}px`;
    el.style.top = `${Math.clamp(top, 0, maxTop)}px`;
    el.style.right = "auto";
  }

  #onDragStart(event) {
    if ( (event.button !== 0) || event.target.closest("button") ) return;
    const el = this.element;
    const rect = el.getBoundingClientRect();
    const offset = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const head = event.currentTarget;
    head.setPointerCapture(event.pointerId);
    el.classList.add("dragging");
    const onMove = ev => this.#moveTo(ev.clientX - offset.x, ev.clientY - offset.y);
    const onUp = () => {
      head.removeEventListener("pointermove", onMove);
      head.removeEventListener("pointerup", onUp);
      el.classList.remove("dragging");
      game.settings.set(MODULE_ID, "trackerPosition", { left: el.offsetLeft, top: el.offsetTop });
    };
    head.addEventListener("pointermove", onMove);
    head.addEventListener("pointerup", onUp);
  }

  /* -------------------------------------------- */

  static #onOpen(event, target) {
    game.modules.get(MODULE_ID).api.open("quests", target.dataset.id);
  }

  static #onCollapse() {
    const collapsed = !game.settings.get(MODULE_ID, "trackerCollapsed");
    game.settings.set(MODULE_ID, "trackerCollapsed", collapsed);
  }

  static #onUntrack(event, target) {
    store.toggleTracked(target.dataset.id, false);
  }
}
