import { MODULE_ID, TROPHY_RULES, TROPHY_EACH, TROPHY_TIERS, KNOWLEDGE_SKILLS } from "./config.mjs";
import * as store from "./store.mjs";
import { tally, tierStart } from "./chronicle.mjs";
import { worldNow, docSync, loc } from "./helpers.mjs";
import { partyName } from "./party.mjs";
import { playSound } from "./sounds.mjs";

/*
 * Trophies (achievements): each unlocks when one of the chronicle's counts reaches its number (twenty-five foes slain,
 * a dragon, ten quests) or when the GM awards it. Most are the party's, earned once; those for rolls can be earned by
 * each character in turn. Only the active GM's client unlocks them. Every screen at the table then shows the unlock,
 * an Xbox style pop-up with its own sound, and the trophy takes its place in the book. A GM can take one back; it then
 * stays locked for them until it's awarded again.
 */

/** How long each pop-up stays, in milliseconds (the stylesheet's animation runs as long). */
const TOAST = 5200;

/** Unlocks older than this when they reach a screen (a restored backup) aren't popped up, in milliseconds. */
const FRESH = 2 * 60 * 1000;

/** The book's own trophies, set up the first time a GM opens a world with them. Names come from the language file. */
const DEFAULTS = [
  { key: "firstBlood", rule: "kills", count: 1, tier: "bronze", icon: "fa-solid fa-droplet" },
  { key: "seasoned", rule: "kills", count: 25, tier: "silver", icon: "fa-solid fa-skull" },
  { key: "hundred", rule: "kills", count: 100, tier: "gold", icon: "fa-solid fa-skull-crossbones" },
  { key: "firstCritical", rule: "crits", count: 1, each: true, tier: "bronze", icon: "fa-solid fa-dice-d20" },
  { key: "deadeye", rule: "crits", count: 10, each: true, tier: "silver", icon: "fa-solid fa-bullseye" },
  { key: "butterfingers", rule: "fumbles", count: 1, each: true, tier: "bronze", icon: "fa-solid fa-face-dizzy", secret: true },
  { key: "dragonslayer", rule: "killsOf", param: "dragon", count: 1, tier: "gold", icon: "fa-solid fa-dragon" },
  { key: "gravewarden", rule: "killsOf", param: "undead", count: 10, tier: "silver", icon: "fa-solid fa-ghost" },
  { key: "againstTheOdds", rule: "killCR", count: 10, tier: "gold", icon: "fa-solid fa-mountain" },
  { key: "battleHardened", rule: "battles", count: 10, tier: "silver", icon: "fa-solid fa-shield-halved" },
  { key: "firstQuest", rule: "quests", count: 1, tier: "bronze", icon: "fa-solid fa-scroll" },
  { key: "heroForHire", rule: "quests", count: 10, tier: "silver", icon: "fa-solid fa-medal" },
  { key: "wanderer", rule: "places", count: 3, tier: "bronze", icon: "fa-solid fa-signs-post" },
  { key: "wellTravelled", rule: "places", count: 15, tier: "silver", icon: "fa-solid fa-map-location-dot" },
  { key: "naturalist", rule: "creatures", count: 10, tier: "bronze", icon: "fa-solid fa-paw" },
  { key: "moneybags", rule: "gold", count: 1000, tier: "silver", icon: "fa-solid fa-coins" },
  { key: "hoard", rule: "gold", count: 10000, tier: "gold", icon: "fa-solid fa-gem" },
  { key: "longRoad", rule: "days", count: 100, tier: "silver", icon: "fa-solid fa-hourglass-half" },
  { key: "oldFriends", rule: "sessions", count: 10, tier: "silver", icon: "fa-solid fa-fire" },
  { key: "revered", rule: "standing", param: "revered", count: 1, tier: "gold", icon: "fa-solid fa-crown" }
];

/** The collections whose changes can unlock something. */
const WATCHED = ["bestiary", "quests", "locations", "factions", "chronicle", "trophies"];

export function registerTrophies() {
  watchUnlocks();
  const check = foundry.utils.debounce(() => checkTrophies(), 400);
  store.onChange(kind => {
    if ( WATCHED.includes(kind) ) check();
  });
  Hooks.on("updateWorldTime", check);
  // The first time, what the party has already done is unlocked quietly, rather than a pop-up for each.
  return seed().then(seeded => checkTrophies({ quiet: seeded }));
}

/** Set up the book's own trophies, once per world. Resolves true if it did. */
async function seed() {
  if ( !game.user.isActiveGM || game.settings.get(MODULE_ID, "trophiesSeeded") ) return false;
  await store.createMany("trophies", DEFAULTS.map(({ key, ...d }, sort) => ({
    ...d,
    builtin: key,
    name: loc(`Trophies.Defaults.${key}.Name`),
    description: loc(`Trophies.Defaults.${key}.Description`),
    each: !!d.each,
    secret: !!d.secret,
    enabled: true,
    visible: true,
    sort,
    earned: [],
    barred: []
  })));
  await game.settings.set(MODULE_ID, "trophiesSeeded", true);
  return true;
}

/* -------------------------------------------- */
/*  Unlocking                                   */
/* -------------------------------------------- */

/** Whether each character earns a trophy in turn, rather than the party once. */
export const isEach = trophy => !!trophy?.each && TROPHY_EACH.includes(trophy.rule);

/** A kind of creature as it reads: "Dragon". */
export function kindLabel(kind) {
  if ( !kind ) return "";
  const label = CONFIG.DND5E?.creatureTypes?.[kind]?.label;
  return label ? game.i18n.localize(label) : kind.charAt(0).toUpperCase() + kind.slice(1);
}

/** The kinds of creature a trophy can be for, as the system lists them. */
export function creatureKinds() {
  const kinds = Object.keys(CONFIG.DND5E?.creatureTypes ?? KNOWLEDGE_SKILLS);
  return kinds.map(id => ({ id, label: kindLabel(id) })).sort((a, b) => a.label.localeCompare(b.label));
}

/** The number a trophy's count must reach; for standing, where the tier begins. */
function targetOf(trophy) {
  if ( trophy.rule === "standing" ) return tierStart(trophy.param || "revered");
  if ( trophy.rule === "killCR" ) return Math.max(0, Number(trophy.count) || 0);
  return Math.max(1, Number(trophy.count) || 1);
}

/** Where a trophy's count stands, for the party or (for rolls) one character; with no character, the furthest along. */
function valueOf(trophy, t, uuid) {
  switch ( trophy.rule ) {
    case "killsOf": return t.killsOf[trophy.param] ?? 0;
    case "killCR": return t.topCR;
    case "standing": return t.standing ?? -100;
    case "manual": return 0;
    case "crits":
    case "fumbles": {
      if ( uuid ) return Number(t.rolls[uuid]?.[trophy.rule]) || 0;
      if ( !isEach(trophy) ) return t[trophy.rule];
      return Math.max(0, ...Object.values(t.rolls).map(r => Number(r?.[trophy.rule]) || 0));
    }
    default: return Number(t[trophy.rule]) || 0;
  }
}

/** How far a trophy is from unlocking: { value, target, percent, met }. Standing runs from -100. */
export function progressOf(trophy, t=tally(), uuid) {
  const value = valueOf(trophy, t, uuid);
  const target = targetOf(trophy);
  const floor = (trophy.rule === "standing") ? -100 : 0;
  const span = Math.max(1, target - floor);
  return {
    value,
    target,
    percent: Math.round(Math.clamp((value - floor) / span, 0, 1) * 100),
    met: (trophy.rule !== "manual") && (value >= target) && ((trophy.rule !== "killCR") || (t.kills > 0))
  };
}

let checking = Promise.resolve();

/**
 * Unlock whatever the party (or each character) has now earned. Only the active GM's client does, one check after
 * another. Quiet unlocks are marked so no screen pops them up.
 */
export function checkTrophies({ quiet=false }={}) {
  checking = checking.then(() => unlockEarned(quiet)).catch(err => console.error(`${MODULE_ID} | Couldn't check the trophies`, err));
  return checking;
}

async function unlockEarned(quiet) {
  if ( !game.user.isActiveGM || !game.settings.get(MODULE_ID, "achievements") ) return;
  const t = tally();
  const stamp = { time: worldNow(), real: Date.now(), session: t.sessions, ...(quiet ? { quiet: true } : {}) };
  const changes = {};
  for ( const trophy of store.all("trophies") ) {
    if ( (trophy.enabled === false) || (trophy.rule === "manual") || !TROPHY_RULES.includes(trophy.rule) ) continue;
    const earned = trophy.earned ?? [];
    const barred = trophy.barred ?? [];
    const has = key => barred.includes(key) || earned.some(e => (e.uuid ?? "party") === key);
    const fresh = [];
    if ( isEach(trophy) ) {
      for ( const uuid of Object.keys(t.rolls) ) {
        if ( !has(uuid) && progressOf(trophy, t, uuid).met ) fresh.push({ uuid, ...stamp });
      }
    }
    else if ( !has("party") && progressOf(trophy, t).met ) fresh.push({ uuid: null, ...stamp });
    if ( fresh.length ) changes[trophy.id] = { earned: [...earned, ...fresh] };
  }
  if ( !foundry.utils.isEmpty(changes) ) await store.updateMany("trophies", changes);
}

/** Award a trophy by hand, to the party or to some characters. GM only. */
export async function award(trophyId, uuids=[]) {
  const trophy = store.get("trophies", trophyId);
  if ( !trophy || !game.user.isGM ) return;
  const to = (isEach(trophy) && uuids.length) ? uuids : [null];
  const earned = trophy.earned ?? [];
  const stamp = { time: worldNow(), real: Date.now(), session: tally().sessions };
  for ( const uuid of to ) {
    if ( !earned.some(e => (e.uuid ?? null) === uuid) ) earned.push({ uuid, ...stamp });
  }
  const keys = to.map(uuid => uuid ?? "party");
  const barred = (trophy.barred ?? []).filter(key => !keys.includes(key));
  return store.update("trophies", trophyId, { earned, barred });
}

/**
 * Take a trophy back from one character, or from everyone. It stays locked for them, even if what earned it still
 * stands, until the GM awards it again. GM only.
 */
export async function revoke(trophyId, uuid) {
  const trophy = store.get("trophies", trophyId);
  if ( !trophy || !game.user.isGM ) return;
  const taken = (trophy.earned ?? []).filter(e => (uuid === undefined) || ((e.uuid ?? null) === uuid));
  const earned = (trophy.earned ?? []).filter(e => !taken.includes(e));
  const barred = [...new Set([...(trophy.barred ?? []), ...taken.map(e => e.uuid ?? "party")])];
  return store.update("trophies", trophyId, { earned, barred });
}

/* -------------------------------------------- */
/*  The pop-up                                  */
/* -------------------------------------------- */

let known = null;
const queue = [];
let showing = false;

const keysOf = trophy => new Set((trophy.earned ?? []).map(e => e.uuid ?? "party"));

/** Watch for unlocks on every screen, and pop each one up. */
function watchUnlocks() {
  known = new Map(store.all("trophies").map(t => [t.id, keysOf(t)]));
  store.onChange(kind => {
    if ( kind !== "trophies" ) return;
    const before = known;
    const trophies = store.all("trophies");
    known = new Map(trophies.map(t => [t.id, keysOf(t)]));
    if ( !game.settings.get(MODULE_ID, "achievements") ) return;
    for ( const trophy of trophies ) {
      if ( trophy.enabled === false ) continue;
      const had = before.get(trophy.id) ?? new Set();
      for ( const earned of trophy.earned ?? [] ) {
        if ( had.has(earned.uuid ?? "party") || earned.quiet || ((Date.now() - (earned.real ?? 0)) > FRESH) ) continue;
        queue.push({ trophy, earned });
      }
    }
    if ( !showing ) next();
  });
}

/** Who earned it: a character's name, or the party's. */
export function earnerName(uuid) {
  return uuid ? (docSync(uuid)?.name ?? loc("Unknown")) : partyName();
}

export function tierOf(trophy) {
  return TROPHY_TIERS.includes(trophy?.tier) ? trophy.tier : "bronze";
}

function next() {
  const item = queue.shift();
  if ( !item ) {
    showing = false;
    return;
  }
  showing = true;
  const { trophy, earned } = item;
  const el = document.createElement("div");
  el.className = `wws wws-trophy-toast wws-tier-${tierOf(trophy)}`;
  el.setAttribute("role", "status");
  el.innerHTML = `<button type="button" class="wws-trophy-toast-card">
      <span class="wws-medal wws-medal-${tierOf(trophy)}"></span>
      <span class="wws-trophy-toast-text">
        <span class="wws-trophy-toast-label"></span>
        <strong class="wws-trophy-toast-name"></strong>
        <span class="wws-trophy-toast-who"></span>
      </span>
    </button>`;

  // Set as text, never as HTML: the GM's trophies can say anything.
  const medal = el.querySelector(".wws-medal");
  if ( trophy.img ) {
    const img = document.createElement("img");
    img.src = trophy.img;
    img.alt = "";
    medal.append(img);
  } else {
    const icon = document.createElement("i");
    icon.className = trophy.icon || "fa-solid fa-trophy";
    icon.inert = true;
    medal.append(icon);
  }
  el.querySelector(".wws-trophy-toast-label").textContent = loc("Trophies.Unlocked");
  el.querySelector(".wws-trophy-toast-name").textContent = trophy.name || loc("Untitled");
  el.querySelector(".wws-trophy-toast-who").textContent = earnerName(earned.uuid);
  el.querySelector("button").addEventListener("click", () => {
    game.modules.get(MODULE_ID).api?.open("chronicle", trophy.id);
    el.remove();
  });
  document.body.append(el);
  playSound("achievement");
  setTimeout(() => {
    el.remove();
    next();
  }, TOAST + 100);
}
