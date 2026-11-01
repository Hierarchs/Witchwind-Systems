import { MODULE_ID } from "./config.mjs";
import { loc, openSheet } from "./helpers.mjs";
import { PARTY_SCALE } from "./party.mjs";

/*
 * The turn-order bar, after Baldur's Gate 3's: the fight's combatants in initiative order across the top of the
 * screen, starting with whoever's turn it is, as portraits in the party frame's leather and gold. Each frame's foot is
 * the colour of its side, and a thin bar under it shows its hit points to those who may see them, as its token's bars
 * would. The one whose turn it is stands larger in gold with its name beneath; the fallen grey out; where the next
 * round begins, a diamond with its number. When the turn passes, the portraits slide to their new places. A player
 * whose turn comes sees "Your Turn". Click a portrait to look at its token, double-click it for its sheet. Arrows under
 * the round move the turn back or on for the GM, and end a player's own turn.
 */

/** The most portraits shown; the rest are counted. */
const SHOWN = 16;

/** How long the portraits take to slide to their places, in milliseconds. */
const SLIDE = 380;

/** How long "Your Turn" stays, in milliseconds (the stylesheet's animation runs as long). */
const YOUR_TURN = 2400;

let bar = null;

/** Each combatant's hit points as last drawn, so a change glides from there. */
const drawn = new Map();

export function registerTurnOrder() {
  const refresh = foundry.utils.debounce(draw, 30);
  for ( const hook of ["createCombat", "deleteCombat", "combatStart", "createCombatant", "updateCombatant", "deleteCombatant", "canvasReady"] ) {
    Hooks.on(hook, refresh);
  }
  Hooks.on("updateCombat", (combat, changes) => {
    refresh();
    if ( ("turn" in changes) || ("round" in changes) ) yourTurn(combat);
  });
  Hooks.on("updateActor", (actor, changes) => {
    if ( !bar || !game.combat?.combatants.some(c => c.actor === actor || c.actorId === actor.id) ) return;
    if ( (changes.system?.attributes?.hp !== undefined) || ("name" in changes) || ("img" in changes) ) refresh();
  });
  Hooks.on("updateToken", token => {
    if ( bar && game.combat?.combatants.some(c => c.tokenId === token.id) ) refresh();
  });
  draw();
}

/** Show, redraw or hide the bar for the fight on the viewed scene. */
export function draw() {
  const combat = game.combat;
  const turns = combat?.turns ?? [];
  if ( !game.settings.get(MODULE_ID, "turnOrder") || !combat?.started || !turns.length ) {
    bar?.remove();
    bar = null;
    drawn.clear();
    return;
  }
  const current = Math.clamp(Number(combat.turn) || 0, 0, turns.length - 1);
  const ordered = [...turns.slice(current), ...turns.slice(0, current)];
  const items = [];
  ordered.forEach((c, i) => {
    if ( (current > 0) && (i === turns.length - current) ) items.push({ wrap: true, round: (combat.round ?? 0) + 1 });
    if ( c.visible !== false ) items.push(cardOf(c, i === 0));
  });
  // Trim to the most shown, never leaving a next-round diamond at the end.
  let cards = 0;
  const shown = items.filter(item => item.wrap || (++cards <= SHOWN));
  while ( shown.at(-1)?.wrap ) shown.pop();
  const more = Math.max(0, cards - SHOWN);

  const fresh = !bar;
  if ( fresh ) {
    bar = document.createElement("aside");
    bar.id = "witchwind-turns";
    bar.className = "wws wws-turns";
    bar.setAttribute("aria-label", loc("Turns.Title"));
    bar.addEventListener("click", onClick);
    bar.addEventListener("dblclick", onDoubleClick);
    bar.addEventListener("pointerover", event => hover(event, true));
    bar.addEventListener("pointerout", event => hover(event, false));
    bar.addEventListener("pointerenter", pin);
    bar.addEventListener("pointerleave", unpin);
    document.body.append(bar);
  }
  const scale = Math.clamp(Number(game.settings.get(MODULE_ID, "turnOrderScale")) || 1, PARTY_SCALE.min, PARTY_SCALE.max);
  bar.style.setProperty("--wws-turns-scale", scale);

  // Where each portrait stood, so it can slide from there to its new place.
  const before = new Map(Array.from(bar.querySelectorAll(".wws-turn[data-id]"), el => [el.dataset.id, el.getBoundingClientRect().left]));
  bar.innerHTML = html(combat, shown, more);
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  for ( const el of bar.querySelectorAll(".wws-turn[data-id]") ) {
    const id = el.dataset.id;
    const fill = el.querySelector(".wws-turn-fill");
    const ratio = Number(el.dataset.ratio);
    if ( fill ) {
      // Drawn where it was, then let go to where it is, so the bar glides.
      fill.style.setProperty("--wws-hp", String(drawn.get(id) ?? ratio));
      requestAnimationFrame(() => fill.style.setProperty("--wws-hp", String(ratio)));
    }
    drawn.set(id, ratio);
    if ( still || fresh ) continue;
    const was = before.get(id);
    const dx = (was === undefined) ? null : was - el.getBoundingClientRect().left;
    if ( dx === null ) el.animate([{ opacity: 0, transform: "translateY(-0.6em)" }, { opacity: 1, transform: "none" }], { duration: 260, easing: "ease-out" });
    else if ( Math.abs(dx) > 1 ) el.animate([{ transform: `translateX(${dx}px)` }, { transform: "none" }], { duration: SLIDE, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
  }
}

/** One combatant's portrait: who they are as far as this user may know, their side, and their hit points. */
function cardOf(c, current) {
  const actor = c.actor;
  const hp = actor?.system?.attributes?.hp;
  const max = Math.max(0, Number(hp?.effectiveMax ?? hp?.max) || 0);
  const value = Math.clamp(Number(hp?.value) || 0, 0, max);
  const ratio = max ? Math.round((value / max) * 1000) / 1000 : 0;
  const owner = !!c.isOwner;
  const modes = CONST.TOKEN_DISPLAY_MODES ?? {};
  const forAll = mode => [modes.HOVER ?? 30, modes.ALWAYS ?? 50].includes(mode);
  const disposition = c.token?.disposition;
  const D = CONST.TOKEN_DISPOSITIONS ?? {};
  let team = "hostile";
  if ( actor?.hasPlayerOwner ) team = "party";
  else if ( disposition === (D.FRIENDLY ?? 1) ) team = "friendly";
  else if ( disposition === (D.NEUTRAL ?? 0) ) team = "neutral";
  else if ( disposition === (D.SECRET ?? -2) ) team = game.user.isGM ? "secret" : "neutral";
  const pct = ratio * 100;
  return {
    id: c.id,
    name: (game.user.isGM || owner || forAll(c.token?.displayName)) ? (c.name ?? "") : "",
    img: c._source?.img || actor?.img || c.img || "icons/svg/mystery-man.svg",
    initiative: Number.isFinite(c.initiative) ? c.initiative : null,
    ratio,
    showBar: (max > 0) && (game.user.isGM || owner || forAll(c.token?.displayBars)),
    state: !max ? "none" : ((value <= 0) ? "down" : ((pct <= 25) ? "low" : ((pct <= 50) ? "hurt" : "ok"))),
    team,
    current,
    owner,
    defeated: !!(c.isDefeated ?? c.defeated),
    hidden: !!c.hidden
  };
}

function html(combat, items, more) {
  const esc = foundry.utils.escapeHTML;
  const cards = items.map(item => {
    if ( item.wrap ) return `<li class="wws-turns-wrap" aria-hidden="true"><span>${item.round}</span></li>`;
    const classes = ["wws-turn", `wws-team-${item.team}`, `wws-hp-${item.state}`];
    if ( item.current ) classes.push("wws-current");
    if ( item.defeated ) classes.push("wws-defeated");
    if ( item.hidden ) classes.push("wws-hidden");
    if ( item.owner ) classes.push("wws-mine");
    const tip = [item.name || loc("Turns.Unknown"), (item.initiative !== null) ? loc("Turns.Initiative", { n: item.initiative }) : ""].filter(Boolean).join(" · ");
    return `<li class="${classes.join(" ")}" data-id="${esc(item.id)}" data-ratio="${item.ratio}" data-tooltip="${esc(tip)}" data-tooltip-direction="DOWN">
      <span class="wws-turn-frame">
        <img src="${esc(item.img)}" alt="">
        ${item.defeated ? '<i class="fa-solid fa-skull wws-turn-skull" inert></i>' : ""}
        ${item.hidden ? '<i class="fa-solid fa-eye-slash wws-turn-hidden" inert></i>' : ""}
      </span>
      ${item.showBar ? '<span class="wws-turn-bar"><span class="wws-turn-fill"></span></span>' : '<span class="wws-turn-bar wws-turn-nobar"></span>'}
      ${(item.current && item.name) ? `<span class="wws-turn-name">${esc(item.name)}</span>` : ""}
    </li>`;
  }).join("");
  return `<div class="wws-turns-head">
      <div class="wws-turns-round"><span>${esc(loc("Turns.Round"))}</span><strong>${combat.round ?? 1}</strong></div>
      ${steps(combat)}
    </div>
    <ol class="wws-turns-list">${cards}${more ? `<li class="wws-turns-more">+${more}</li>` : ""}</ol>`;
}

/**
 * The arrows under the round, as the combat tracker's: back a turn and on a turn for the GM, and on for a player whose
 * turn it is, to end it. Back is off on the fight's first turn, which has nothing before it.
 */
function steps(combat) {
  const esc = foundry.utils.escapeHTML;
  const button = (step, icon, label, disabled=false) => `<button type="button" class="wws-turns-step" data-step="${step}"
    data-tooltip="${esc(label)}" data-tooltip-direction="DOWN" aria-label="${esc(label)}"${disabled ? " disabled" : ""}>
    <i class="fa-solid ${icon}" inert></i></button>`;
  let buttons = "";
  if ( game.user.isGM ) {
    const first = ((combat.round ?? 1) <= 1) && !combat.turn;
    buttons = button("previous", "fa-chevron-left", loc("Turns.Previous"), first) + button("next", "fa-chevron-right", loc("Turns.Next"));
  }
  else if ( combat.combatant?.isOwner ) buttons = button("next", "fa-chevron-right", loc("Turns.End"));
  return buttons ? `<div class="wws-turns-steps">${buttons}</div>` : "";
}

let stepping = false;

/** Move the fight back a turn or on one; a second click while the first is on its way is ignored. */
async function step(direction) {
  const combat = game.combat;
  if ( !combat?.started || stepping ) return;
  if ( !game.user.isGM && ((direction !== "next") || !combat.combatant?.isOwner) ) return;
  stepping = true;
  try {
    if ( direction === "previous" ) await combat.previousTurn();
    else await combat.nextTurn();
  } catch(err) {
    console.warn(`${MODULE_ID} | Couldn't change the turn`, err);
  } finally {
    stepping = false;
  }
}

/* -------------------------------------------- */

const combatantOf = el => {
  const id = el?.closest?.(".wws-turn[data-id]")?.dataset.id;
  return id ? game.combat?.combatants.get(id) : null;
};

/** An arrow moves the turn; a portrait looks at its combatant's token, and takes control of it if it's yours. */
function onClick(event) {
  const arrow = event.target.closest?.("button[data-step]");
  if ( arrow ) return step(arrow.dataset.step);
  const c = combatantOf(event.target);
  const token = c?.token?.object;
  if ( !token?.visible || !globalThis.canvas?.ready ) return;
  globalThis.canvas.animatePan({ x: token.center.x, y: token.center.y, duration: 250 });
  if ( c.isOwner ) token.control({ releaseOthers: !event.shiftKey });
}

function onDoubleClick(event) {
  const c = combatantOf(event.target);
  if ( c?.actor ) openSheet(c.actor.uuid);
}

/** Pointing at a portrait lights its token, as the combat tracker does. */
function hover(event, on) {
  const li = event.target.closest?.(".wws-turn[data-id]");
  if ( !li || li.contains(event.relatedTarget) ) return;
  const token = combatantOf(li)?.token?.object;
  if ( !token?.visible ) return;
  try {
    if ( on ) token._onHoverIn?.(event, { hoverOutOthers: true });
    else token._onHoverOut?.(event);
  } catch {}
}

/**
 * The bar is centred, so it moves as it grows or shrinks with each turn. While the pointer is over it, its left end
 * holds still instead, so the arrows stay under the pointer for the next click; when the pointer leaves, it glides
 * back to the middle.
 */
function pin() {
  if ( !bar || bar.classList.contains("wws-pinned") ) return;
  bar.style.left = `${bar.getBoundingClientRect().left}px`;
  bar.classList.add("wws-pinned");
}

function unpin() {
  if ( !bar?.classList.contains("wws-pinned") ) return;
  const was = bar.getBoundingClientRect().left;
  bar.style.left = "";
  bar.classList.remove("wws-pinned");
  const dx = was - bar.getBoundingClientRect().left;
  if ( (Math.abs(dx) < 1) || window.matchMedia("(prefers-reduced-motion: reduce)").matches ) return;
  bar.animate([{ translate: `calc(-50% + ${dx}px) 0` }, { translate: "-50% 0" }], { duration: 260, easing: "ease-out" });
}

/** "Your Turn", across the screen, for a player whose character's turn has come. */
function yourTurn(combat) {
  if ( (combat !== game.combat) || !combat.started || game.user.isGM || !game.settings.get(MODULE_ID, "turnOrder") ) return;
  const c = combat.combatant;
  if ( !c?.isOwner ) return;
  document.querySelector(".wws-your-turn")?.remove();
  const el = document.createElement("div");
  el.className = "wws wws-your-turn";
  el.setAttribute("role", "status");
  const esc = foundry.utils.escapeHTML;
  el.innerHTML = `<strong>${esc(loc("Turns.YourTurn"))}</strong><span>${esc(c.name ?? "")}</span>`;
  document.body.append(el);
  setTimeout(() => el.remove(), YOUR_TURN + 100);
}
