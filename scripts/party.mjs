import { MODULE_ID, PATH } from "./config.mjs";
import { openSheet, loc } from "./helpers.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** How small and large the frame can be set, as a multiple of its normal size, and how far − and + move it. */
export const PARTY_SCALE = { min: 0.6, max: 1.8, step: 0.1 };

/** How long a changed number takes to count to its new value, in milliseconds; the bars glide for about as long. */
const COUNT_DURATION = 500;

/** How a character is faring, from their share of hit points. Each is a class on their box. */
const STATES = ["ok", "hurt", "low", "down", "none"];

/**
 * The party frame: a box for each character in the manner of Final Fantasy's party boxes, with their portrait, name,
 * hit points and temporary hit points, under the party's name, in a column at the left of the screen or in a row.
 * Each player shows or hides it, sets its size and layout, and can drag it by its title. A player sees the numbers
 * only for characters they can observe; for the others, just the bars.
 *
 * A change of hit points doesn't redraw the frame. That character's box is changed in place: its bars glide to the
 * new values on the compositor and its numbers count to them. The frame redraws only when the party, a name or a
 * picture changes.
 */
export default class Party extends HandlebarsApplicationMixin(ApplicationV2) {

  static #instance = null;

  static get instance() {
    return this.#instance ??= new this();
  }

  static DEFAULT_OPTIONS = {
    id: "witchwind-party",
    classes: ["wws", "wws-party"],
    tag: "aside",
    window: { frame: false, positioned: false },
    actions: {
      partyRename: Party.#onRename,
      partySheet: Party.#onSheet,
      partySize: Party.#onSize,
      partyCollapse: Party.#onCollapse,
      partyHide: Party.#onHide
    }
  };

  static PARTS = {
    frame: { template: `${PATH}/templates/party.hbs` }
  };

  /** Show, refresh or hide the frame to match the setting. */
  static refresh() {
    if ( game.settings.get(MODULE_ID, "party") ) this.instance.render({ force: true });
    else if ( this.#instance?.rendered ) this.#instance.close({ animate: false });
  }

  /**
   * Keep the frame current. Hit points change one box in place; a change to who's in the party, or to a member's name
   * or picture, redraws the frame, once after a burst of changes.
   */
  static register() {
    const redraw = foundry.utils.debounce(() => this.refresh(), 60);
    const shown = () => game.settings.get(MODULE_ID, "party");
    Hooks.on("updateActor", (actor, changes) => {
      if ( !shown() ) return;
      if ( ("ownership" in changes) || (actor.type === "group") ) return redraw();
      const party = this.#instance;
      if ( !party?.rendered || !party.#memberIds.has(actor.id) ) return;
      if ( ("name" in changes) || ("img" in changes) ) return redraw();
      if ( changes.system?.attributes?.hp !== undefined ) party.#updateMember(actor);
      if ( changes.system?.attributes?.exhaustion !== undefined ) party.#updateEffects(actor);
    });
    // Conditions and other effects change one box's icons in place.
    const onEffect = effect => {
      const actor = (effect.parent?.documentName === "Actor") ? effect.parent : effect.parent?.parent;
      const party = this.#instance;
      if ( shown() && actor && party?.rendered && party.#memberIds.has(actor.id) ) party.#updateEffects(actor);
    };
    for ( const hook of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect"] ) Hooks.on(hook, onEffect);
    for ( const hook of ["createActor", "deleteActor"] ) Hooks.on(hook, () => shown() && redraw());
    Hooks.on("updateUser", (user, changes) => {
      if ( shown() && ("character" in changes) ) redraw();
    });
  }

  /** The ids of the characters on the frame, and what each one's box shows. */
  #memberIds = new Set();
  #shown = new Map();

  /** @override */
  async _prepareContext(options) {
    const scale = Math.clamp(Number(game.settings.get(MODULE_ID, "partyScale")) || 1, PARTY_SCALE.min, PARTY_SCALE.max);
    const members = partyMembers().map(cardOf);
    this.#memberIds = new Set(members.map(m => m.id));
    this.#shown = new Map(members.map(m => [m.id, m]));
    return {
      title: partyName(),
      canRename: game.user.isGM,
      members,
      empty: !members.length,
      scale,
      atMin: scale <= PARTY_SCALE.min,
      atMax: scale >= PARTY_SCALE.max,
      row: game.settings.get(MODULE_ID, "partyLayout") === "row",
      collapsed: game.settings.get(MODULE_ID, "partyCollapsed")
    };
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const { left, top } = game.settings.get(MODULE_ID, "partyPosition") ?? {};
    if ( Number.isFinite(left) && Number.isFinite(top) ) this.#moveTo(left, top);
    else this.#placeBesideControls();
    this.element.querySelector(".wws-party-head")?.addEventListener("pointerdown", this.#onDragStart.bind(this));
  }

  /**
   * Bring one character's box up to date in place. The bars take their new length from custom properties on the box,
   * so they glide by CSS transitions; the numbers count to their new values, and the box flashes for a hit or a heal.
   */
  #updateMember(actor) {
    const box = this.element?.querySelector(`.wws-party-member[data-actor-id="${actor.id}"]`);
    const was = this.#shown.get(actor.id);
    if ( !box || !was ) return;
    const card = cardOf(actor);
    this.#shown.set(actor.id, card);
    if ( card.hasHp !== was.hasHp ) return this.render();

    box.classList.remove(...STATES.map(s => `wws-hp-${s}`));
    box.classList.add(`wws-hp-${card.state}`);
    box.classList.toggle("wws-rising", card.value > was.value);
    box.style.setProperty("--wws-hp", card.ratio);
    box.style.setProperty("--wws-temp", card.tempRatio);
    box.querySelector(".wws-party-temp-row")?.classList.toggle("wws-party-none", !card.temp);
    setMeter(box.querySelector(".wws-party-hp-bar"), card, card.value, card.pct);
    setMeter(box.querySelector(".wws-party-temp-bar"), card, card.temp, Math.round(card.tempRatio * 1000) / 10);
    if ( card.showNumbers ) {
      countTo(box.querySelector(".wws-party-hp-value"), was.value, card.value);
      countTo(box.querySelector(".wws-party-temp-value"), was.temp, card.temp);
      const max = box.querySelector(".wws-party-max");
      if ( max ) max.textContent = `/${card.max}`;
    }
    if ( card.value !== was.value ) flash(box, card.value < was.value ? "hit" : "heal");
  }

  /** Bring one character's effect icons up to date in place; any that are new pop in. */
  #updateEffects(actor) {
    const row = this.element?.querySelector(`.wws-party-member[data-actor-id="${actor.id}"] .wws-party-effects`);
    if ( !row ) return;
    const before = new Set(Array.from(row.children, li => li.dataset.effectId));
    row.replaceChildren(...effectsOf(actor).map(effect => effectNode(effect, !before.has(effect.id))));
  }

  /** Where it starts until it's dragged: just right of the scene controls, level with their top. */
  #placeBesideControls() {
    const controls = document.getElementById("scene-controls")?.getBoundingClientRect();
    if ( controls?.width ) this.#moveTo(controls.right + 12, controls.top);
  }

  /** Place the frame, kept inside the screen. */
  #moveTo(left, top) {
    const el = this.element;
    const maxLeft = Math.max(0, window.innerWidth - el.offsetWidth);
    const maxTop = Math.max(0, window.innerHeight - 40);
    el.style.left = `${Math.clamp(left, 0, maxLeft)}px`;
    el.style.top = `${Math.clamp(top, 0, maxTop)}px`;
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
      game.settings.set(MODULE_ID, "partyPosition", { left: el.offsetLeft, top: el.offsetTop });
    };
    head.addEventListener("pointermove", onMove);
    head.addEventListener("pointerup", onUp);
  }

  /* -------------------------------------------- */

  /** The GM names the party for everyone; an empty name goes back to the default. */
  static async #onRename() {
    if ( !game.user.isGM ) return;
    const escape = foundry.utils.escapeHTML;
    const name = await foundry.applications.api.DialogV2.prompt({
      window: { title: loc("Party.Rename"), icon: "fa-solid fa-users" },
      classes: ["wws", "wws-dialog"],
      content: `<p>${loc("Party.RenameHint")}</p>
        <input type="text" name="name" value="${escape(game.settings.get(MODULE_ID, "partyName"))}"
               placeholder="${escape(partyName(false))}" aria-label="${escape(loc("Party.Rename"))}" autofocus>`,
      ok: { label: loc("Save"), icon: "fa-solid fa-check", callback: (event, button) => button.form.elements.name.value },
      rejectClose: false,
      modal: true
    });
    if ( typeof name === "string" ) await game.settings.set(MODULE_ID, "partyName", name.trim());
  }

  static #onSheet(event, target) {
    return openSheet(target.dataset.uuid);
  }

  /** One step smaller or larger, within the frame's range. */
  static #onSize(event, target) {
    const current = Number(game.settings.get(MODULE_ID, "partyScale")) || 1;
    const next = Math.round((current + (Number(target.dataset.delta) * PARTY_SCALE.step)) * 10) / 10;
    return game.settings.set(MODULE_ID, "partyScale", Math.clamp(next, PARTY_SCALE.min, PARTY_SCALE.max));
  }

  static #onCollapse() {
    return game.settings.set(MODULE_ID, "partyCollapsed", !game.settings.get(MODULE_ID, "partyCollapsed"));
  }

  static #onHide() {
    return game.settings.set(MODULE_ID, "party", false);
  }
}

/* -------------------------------------------- */

/**
 * The party: the members of dnd5e's primary party if one is set, otherwise the characters assigned to players,
 * otherwise every character a player owns.
 */
export function partyMembers() {
  const listed = (primaryParty()?.system?.members ?? []).map(m => m?.actor ?? m).filter(a => a?.documentName === "Actor");
  if ( listed.length ) return [...new Set(listed)];
  const assigned = game.users.filter(u => !u.isGM && u.character).map(u => u.character);
  if ( assigned.length ) return [...new Set(assigned)];
  return game.actors.filter(a => a.hasPlayerOwner && (a.type === "character"));
}

/**
 * The name over the frame: the one the GM gave it, otherwise the primary party's name, otherwise "Party". With
 * custom false, the default it would fall back to.
 */
function partyName(custom=true) {
  const given = custom ? String(game.settings.get(MODULE_ID, "partyName") ?? "").trim() : "";
  return given || primaryParty()?.name || loc("Party.Title");
}

/** dnd5e's primary party, if the system has one and it's set. */
function primaryParty() {
  try {
    return game.actors.party ?? game.settings.get("dnd5e", "primaryParty")?.actor ?? null;
  } catch {
    return null;
  }
}

/** One character's box: picture, name, and hit points and temporary hit points, with the numbers if the viewer may see them. */
function cardOf(actor) {
  const hp = actor.system?.attributes?.hp;
  const max = Math.max(0, Number(hp?.effectiveMax ?? ((Number(hp?.max) || 0) + (Number(hp?.tempmax) || 0))) || 0);
  const value = Math.clamp(Number(hp?.value) || 0, 0, max);
  const temp = Math.max(0, Number(hp?.temp) || 0);
  const ratio = max ? Math.round((value / max) * 1000) / 1000 : 0;
  const tempRatio = max ? Math.min(1, Math.round((temp / max) * 1000) / 1000) : 0;
  const pct = Math.round(ratio * 1000) / 10;
  let state = "ok";
  if ( !max ) state = "none";
  else if ( value <= 0 ) state = "down";
  else if ( pct <= 25 ) state = "low";
  else if ( pct <= 50 ) state = "hurt";
  return {
    id: actor.id,
    uuid: actor.uuid,
    name: actor.name,
    img: actor.img,
    hasHp: max > 0,
    showNumbers: game.user.isGM || actor.testUserPermission(game.user, "OBSERVER"),
    canOpen: actor.testUserPermission(game.user, "LIMITED"),
    value,
    max,
    temp,
    ratio,
    tempRatio,
    pct,
    tempPct: Math.round(tempRatio * 1000) / 10,
    state,
    effects: effectsOf(actor)
  };
}

/**
 * The effects showing on a character, as their token shows them: conditions such as Charmed or Prone, and effects
 * that last a while, such as Bless or Concentrating. Exhaustion carries its level. Names are escaped for tooltips,
 * which Foundry shows as HTML.
 */
function effectsOf(actor) {
  const exhaustion = Number(actor.system?.attributes?.exhaustion) || 0;
  return Array.from(actor.temporaryEffects ?? []).flatMap(effect => {
    const img = effect.img ?? effect.icon;
    if ( !img ) return [];
    const name = effect.name ?? "";
    return [{
      id: effect.uuid ?? effect.id,
      img,
      name,
      tooltip: foundry.utils.escapeHTML(name),
      level: (exhaustion && effect.statuses?.has?.("exhaustion")) ? exhaustion : null
    }];
  });
}

/** One effect's icon, built for an in-place update as the template builds it for a full one. */
function effectNode({ id, img, name, tooltip, level }, fresh) {
  const li = document.createElement("li");
  li.className = fresh ? "wws-party-effect wws-new" : "wws-party-effect";
  li.dataset.effectId = id;
  li.dataset.tooltip = tooltip;
  const icon = document.createElement("img");
  icon.src = img;
  icon.alt = name;
  li.append(icon);
  if ( level ) {
    const badge = document.createElement("span");
    badge.className = "wws-party-effect-level";
    badge.textContent = level;
    li.append(badge);
  }
  return li;
}

/** A bar's value for screen readers: the number if the viewer may see it, otherwise a percentage. */
function setMeter(bar, card, value, pct) {
  if ( !bar ) return;
  bar.setAttribute("aria-valuemax", card.showNumbers ? card.max : 100);
  bar.setAttribute("aria-valuenow", card.showNumbers ? value : pct);
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Which count each number is running, so a newer change takes over from an older one. */
const counting = new WeakMap();

/** Count a number to its new value over a moment, easing out as the bars do. */
function countTo(el, from, to) {
  if ( !el ) return;
  if ( (from === to) || reducedMotion() ) {
    el.textContent = String(to);
    return;
  }
  const run = {};
  counting.set(el, run);
  const start = performance.now();
  const step = now => {
    if ( counting.get(el) !== run ) return;
    const t = Math.min(1, (now - start) / COUNT_DURATION);
    el.textContent = String(Math.round(from + ((to - from) * (1 - ((1 - t) ** 3)))));
    if ( t < 1 ) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** Flash a box red for a hit or green for healing, once. Only an overlay's opacity moves. */
function flash(box, kind) {
  const el = box.querySelector(".wws-party-flash");
  if ( !el || reducedMotion() ) return;
  el.dataset.kind = kind;
  el.animate([{ opacity: 0.5 }, { opacity: 0 }], { duration: 650, easing: "ease-out" });
}
