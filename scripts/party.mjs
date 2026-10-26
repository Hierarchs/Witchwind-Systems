import { MODULE_ID, PATH } from "./config.mjs";
import { openSheet, loc } from "./helpers.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** How small and large the frame can be set, as a multiple of its normal size, and how far − and + move it. */
export const PARTY_SCALE = { min: 0.6, max: 1.8, step: 0.1 };

/**
 * The party frame: each character's portrait, name, hit points and temporary hit points, in a small leather card at
 * the left of the screen beside the scene controls. Each player shows or hides it, sets its size, and can drag it by
 * its title. A player sees the numbers only for characters they can observe; for the others, just the bar.
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
   * Redraw when something on a card changes: a character's hit points, name or picture, who is in the party, or
   * which character a player has. A burst of changes (a fireball, a long rest) redraws once.
   */
  static register() {
    const redraw = foundry.utils.debounce(() => this.refresh(), 60);
    const shown = () => game.settings.get(MODULE_ID, "party");
    Hooks.on("updateActor", (actor, changes) => {
      if ( !shown() ) return;
      const onCard = ("name" in changes) || ("img" in changes) || (changes.system?.attributes?.hp !== undefined);
      const inParty = ("ownership" in changes) || (actor.type === "group");
      if ( inParty || (onCard && partyMembers().includes(actor)) ) redraw();
    });
    for ( const hook of ["createActor", "deleteActor"] ) Hooks.on(hook, () => shown() && redraw());
    Hooks.on("updateUser", (user, changes) => {
      if ( shown() && ("character" in changes) ) redraw();
    });
  }

  /** What each card showed last time, by actor id, so a change slides the bar from where it was. */
  #shown = new Map();

  /** @override */
  async _prepareContext(options) {
    const scale = Math.clamp(Number(game.settings.get(MODULE_ID, "partyScale")) || 1, PARTY_SCALE.min, PARTY_SCALE.max);
    const before = this.#shown;
    this.#shown = new Map();
    const members = partyMembers().map(actor => {
      const card = cardOf(actor);
      const was = before.get(actor.id);
      if ( was && card.hasHp ) {
        card.slide = was.pct !== card.pct;
        card.fromPct = was.pct;
        card.slideTemp = was.tempPct !== card.tempPct;
        card.fromTemp = was.tempPct;
        if ( card.value < was.value ) card.change = "hit";
        else if ( card.value > was.value ) card.change = "heal";
      }
      this.#shown.set(actor.id, { pct: card.pct, tempPct: card.tempPct, value: card.value });
      return card;
    });
    return {
      title: partyName(),
      canRename: game.user.isGM,
      members,
      empty: !members.length,
      scale,
      atMin: scale <= PARTY_SCALE.min,
      atMax: scale >= PARTY_SCALE.max,
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

/** One character's card: picture, name, and hit points as a bar, with the numbers if the viewer may see them. */
function cardOf(actor) {
  const hp = actor.system?.attributes?.hp;
  const max = Math.max(0, Number(hp?.effectiveMax ?? ((Number(hp?.max) || 0) + (Number(hp?.tempmax) || 0))) || 0);
  const value = Math.clamp(Number(hp?.value) || 0, 0, max);
  const temp = Math.max(0, Number(hp?.temp) || 0);
  const pct = max ? Math.round((value / max) * 1000) / 10 : 0;
  const tempPct = max ? Math.min(100, Math.round((temp / max) * 1000) / 10) : 0;
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
    pct,
    tempPct,
    state
  };
}
