import { MODULE_ID, CURRENCIES, STANDING_TIERS } from "./config.mjs";
import * as store from "./store.mjs";
import { worldNow } from "./helpers.mjs";
import { dayOf } from "./calendar.mjs";
import { partyMembers, primaryParty } from "./party.mjs";
import { titleOf } from "./scene-titles.mjs";
import { handle, request } from "./socket.mjs";

/*
 * The chronicle: the campaign's numbers. Most are read from what the book already keeps: foes slain and battles from
 * the bestiary's encounters, quests completed, creatures discovered and location cards revealed. The rest the active
 * GM's client counts into the world's record as they happen:
 * - sessions: a player arriving when nobody has played for a few hours starts the next one;
 * - gold earned: the party's purses growing, counted a moment after they change, so coin passed between them nets out;
 * - each character's critical hits and fumbles on attack rolls;
 * - the scenes the party arrives at, each one a place found (those with a title card, so battle maps can be left out).
 * For a campaign the book joined late, the GM can set where each count starts.
 */

/** A player arriving this long after anyone last played starts a new session, in milliseconds. */
const SESSION_GAP = 4 * 60 * 60 * 1000;

/** How often the record notes that people are still playing, in milliseconds. */
const HEARTBEAT = 10 * 60 * 1000;

/** How many sessions the record keeps the dates of. */
const SESSIONS_KEPT = 60;

/** Each coin's worth in gold pieces, where the system doesn't say. */
const PER_GOLD = { pp: 0.1, gp: 1, ep: 2, sp: 10, cp: 100 };

const active = () => game.user.isActiveGM;

export function registerChronicle() {
  // A player arriving starts a session if it's been long enough; while anyone plays, the record says so now and then.
  Hooks.on("userConnected", (user, connected) => {
    if ( connected && !user.isGM ) keepTime();
  });
  setInterval(keepTime, HEARTBEAT);

  const countPurses = foundry.utils.debounce(countGold, 1500);
  Hooks.on("updateActor", (actor, changes) => {
    if ( active() && foundry.utils.hasProperty(changes, "system.currency") && inParty(actor) ) countPurses();
  });

  Hooks.on("createChatMessage", onRoll);

  // Each player's own screen says where they've arrived; the GM's client checks it's so before writing it down: the
  // scene everyone is on, or the one the player's client has told everyone it's viewing (which can come a moment later).
  handle("arrive", async ({ sceneId }, user) => {
    const there = () => !!game.scenes?.get(sceneId)?.active || (user.viewedScene === sceneId);
    if ( user.isGM ) return;
    if ( !there() ) await new Promise(resolve => setTimeout(resolve, 2000));
    if ( there() ) arrive(game.scenes?.get(sceneId));
  });
  Hooks.on("canvasReady", canvas => {
    if ( !game.user.isGM && canvas?.scene ) request("arrive", { sceneId: canvas.scene.id }).catch(() => {});
  });

  if ( !active() ) return;
  begin();
  keepTime();
  for ( const user of game.users ) {
    if ( user.active && !user.isGM ) arrive(game.scenes?.get(user.viewedScene));
  }
}

/* -------------------------------------------- */
/*  Counting                                    */
/* -------------------------------------------- */

/** The first time: the days are counted from today, and the purses as they are. */
function begin() {
  const record = store.chronicle();
  if ( Number.isFinite(record.began) && record.purses ) return;
  store.updateChronicle(c => {
    if ( !Number.isFinite(c.began) ) c.began = dayOf();
    c.purses ??= purses();
  });
}

/** Start a session if a player is here after a long enough gap, and note that people are playing. */
function keepTime() {
  if ( !active() || !game.users.some(u => u.active && !u.isGM) ) return;
  const now = Date.now();
  const last = Number(store.chronicle().lastActive) || 0;
  const fresh = (now - last) > SESSION_GAP;
  if ( !fresh && ((now - last) < (HEARTBEAT / 2)) ) return;
  store.updateChronicle(c => {
    if ( (now - (Number(c.lastActive) || 0)) > SESSION_GAP ) {
      c.sessions = (Number(c.sessions) || 0) + 1;
      c.sessionLog = [...(c.sessionLog ?? []), { at: now, time: worldNow() }].slice(-SESSIONS_KEPT);
    }
    c.lastActive = now;
  });
}

function inParty(actor) {
  return !!actor && (partyMembers().includes(actor) || (actor === primaryParty()));
}

/** Coins in gold pieces. */
function inGold(currency) {
  return CURRENCIES.reduce((sum, id) => {
    const per = Number(CONFIG.DND5E?.currencies?.[id]?.conversion) || PER_GOLD[id];
    return sum + ((Number(currency?.[id]) || 0) / per);
  }, 0);
}

/** Each of the party's purses in gold, by character (and the party's own, in dnd5e's party actor). */
function purses() {
  const holders = [...partyMembers(), primaryParty()].filter(a => a?.system?.currency);
  return Object.fromEntries(holders.map(a => [a.uuid, Math.round(inGold(a.system.currency) * 100) / 100]));
}

/**
 * What the purses gained since they were last counted. Only purses counted before are compared, so a character who
 * joins doesn't bring their coin in as earnings; spending isn't taken off what was earned.
 */
function countGold() {
  const now = purses();
  return store.updateChronicle(c => {
    const was = c.purses ?? {};
    let gained = 0;
    for ( const [uuid, gold] of Object.entries(now) ) {
      if ( uuid in was ) gained += gold - was[uuid];
    }
    c.purses = now;
    if ( gained > 0.004 ) c.gold = Math.round(((Number(c.gold) || 0) + gained) * 100) / 100;
  });
}

/** A critical hit or a fumble on a party character's attack roll. */
function onRoll(message) {
  if ( !active() || (message.flags?.dnd5e?.roll?.type !== "attack") ) return;
  const roll = message.rolls?.[0];
  const crit = roll?.isCritical === true;
  const fumble = roll?.isFumble === true;
  if ( !crit && !fumble ) return;
  const speaker = message.speaker ?? {};
  const actor = ChatMessage.implementation?.getSpeakerActor?.(speaker) ?? game.actors?.get(speaker.actor);
  if ( !inParty(actor) ) return;
  store.updateChronicle(c => {
    const rolls = (c.rolls ??= {});
    const mine = (rolls[actor.uuid] ??= { crits: 0, fumbles: 0 });
    if ( crit ) mine.crits = (mine.crits ?? 0) + 1;
    if ( fumble ) mine.fumbles = (mine.fumbles ?? 0) + 1;
  });
}

/**
 * Whether arriving at a scene finds a place: it has a title card that isn't turned off, and when the world shows only
 * written cards, a written one.
 */
function isPlace(scene) {
  const card = titleOf(scene);
  if ( !card.title || !card.enabled ) return false;
  return (game.settings.get(MODULE_ID, "sceneTitles") === "all") || card.written;
}

const placeKey = name => name.toLowerCase().replace(/\s+/g, " ").trim();

/** The party arrived at a scene: a place found, the first time. */
function arrive(scene) {
  if ( !active() || !scene || !isPlace(scene) ) return;
  const name = titleOf(scene).title;
  const key = placeKey(name);
  if ( store.chronicle().places?.[key] ) return;
  store.updateChronicle(c => {
    c.places ??= {};
    if ( c.places[key] ) return false;
    c.places[key] = { name, scene: scene.id, time: worldNow() };
  });
}

/* -------------------------------------------- */
/*  The numbers                                 */
/* -------------------------------------------- */

/** A creature's kind, as the bestiary keys it: "dragon", "undead". */
export function kindOf(creature) {
  return String(creature.typeKey || String(creature.type ?? "").split(/[\s(]/)[0]).trim().toLowerCase();
}

/** A challenge rating as a number, fractions included. */
function crValue(cr) {
  const text = String(cr ?? "").trim();
  if ( text.includes("/") ) {
    const [a, b] = text.split("/").map(Number);
    return b ? a / b : 0;
  }
  return Number(text) || 0;
}

/**
 * Every number the chronicle shows and the trophies count from. Counts from before the book kept them are added in.
 * Places are the location cards revealed and the scenes arrived at, each name once.
 */
export function tally() {
  const record = store.chronicle();
  const earlier = record.earlier ?? {};
  const add = key => Math.max(0, Number(earlier[key]) || 0);

  let kills = 0;
  let topCR = 0;
  const killsOf = {};
  const battles = new Set();
  const slain = [];
  const creatures = store.all("bestiary");
  for ( const creature of creatures ) {
    let count = 0;
    for ( const encounter of creature.encounters ?? [] ) {
      count += encounter.slain?.length ?? 0;
      if ( encounter.combat ) battles.add(encounter.combat);
    }
    if ( !count ) continue;
    kills += count;
    const kind = kindOf(creature);
    if ( kind ) killsOf[kind] = (killsOf[kind] ?? 0) + count;
    topCR = Math.max(topCR, crValue(creature.cr));
    slain.push({ id: creature.id, name: creature.name, img: creature.img, count, visible: !!creature.visible });
  }

  const places = new Map();
  for ( const l of store.all("locations").filter(l => l.visible && l.title) ) {
    places.set(placeKey(l.title), { name: l.title, time: null, location: l.id });
  }
  for ( const [key, place] of Object.entries(record.places ?? {}) ) {
    if ( !places.has(key) ) places.set(key, { name: place.name, time: place.time ?? null, scene: place.scene });
  }

  const rolls = record.rolls ?? {};
  const sum = key => Object.values(rolls).reduce((n, r) => n + (Number(r?.[key]) || 0), 0);
  const factions = store.all("factions").filter(f => f.visible);
  const today = dayOf();
  const began = Number.isFinite(record.began) ? record.began : today;

  return {
    began,
    days: Math.max(0, today - began),
    sessions: Math.max(0, Number(record.sessions) || 0),
    sessionLog: record.sessionLog ?? [],
    gold: Math.max(0, Number(record.gold) || 0),
    kills: kills + add("kills"),
    killsOf,
    topCR,
    slain: slain.sort((a, b) => b.count - a.count),
    battles: battles.size + add("battles"),
    quests: store.all("quests").filter(q => q.visible && (q.status === "completed")).length + add("quests"),
    creatures: creatures.filter(c => c.visible).length + add("creatures"),
    places: places.size + add("places"),
    placeList: [...places.values()],
    rolls,
    crits: sum("crits"),
    fumbles: sum("fumbles"),
    standing: factions.length ? Math.max(...factions.map(f => Number(f.standing) || 0)) : null,
    earlier
  };
}

/** The standing a tier begins at. */
export function tierStart(tier) {
  return STANDING_TIERS.find(t => t.id === tier)?.min ?? 75;
}
