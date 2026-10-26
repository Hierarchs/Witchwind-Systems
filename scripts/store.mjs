import { MODULE_ID, QUEST_KINDS } from "./config.mjs";

/*
 * Where everything lives:
 * - Quests, maps and factions are the GM's, kept in world settings.
 * - Journal notes and map markers belong to whoever wrote them, kept on that person's own User. Players may
 *   always update their own User, so they can write notes and place markers without a GM online.
 * Every entry has an id; user-owned entries also report their author's user id.
 */

/** Collections the GM keeps in world settings. */
export const WORLD_KINDS = ["quests", "maps", "factions", "letters", "titles", "merchants"];

/** Collections each user keeps on their own User document. */
export const USER_KINDS = ["notes", "pins"];

const listeners = new Set();

/**
 * Each collection, copied out of its settings or flags once per change rather than on every read: a single render
 * reads the same collections many times. Entries in it are shared, so they're treated as read-only; get() hands
 * out a private copy for anything that will be changed.
 */
const cache = new Map();

/* -------------------------------------------- */
/*  Setup                                       */
/* -------------------------------------------- */

export function registerData() {
  for ( const kind of WORLD_KINDS ) {
    game.settings.register(MODULE_ID, kind, {
      scope: "world",
      config: false,
      type: Object,
      default: {},
      onChange: (value, options, userId) => emit(kind, userId)
    });
  }

  // The GM's own quest groups, in order. Empty means the four defaults.
  game.settings.register(MODULE_ID, "questGroups", {
    scope: "world",
    config: false,
    type: Array,
    default: [],
    onChange: (value, options, userId) => emit("quests", userId)
  });

  Hooks.on("updateUser", (user, changes) => {
    const flags = changes.flags?.[MODULE_ID];
    if ( !flags ) return;
    for ( const kind of [...USER_KINDS, "tracked", "readLetters"] ) {
      if ( kind in flags ) emit(kind, user.id);
    }
  });

  // A user arriving or leaving brings or takes their notes and markers with them.
  for ( const hook of ["createUser", "deleteUser"] ) {
    Hooks.on(hook, user => USER_KINDS.forEach(kind => emit(kind, user.id)));
  }
}

/** Call a function whenever any collection changes, with the collection and the user who changed it. */
export function onChange(fn) {
  listeners.add(fn);
}

function emit(kind, userId) {
  cache.delete(kind);
  for ( const fn of listeners ) fn(kind, userId);
}

/* -------------------------------------------- */
/*  Reading                                     */
/* -------------------------------------------- */

/** Every entry of a collection. The array is new each call; the entries are shared and must not be changed. */
export function all(kind) {
  if ( !cache.has(kind) ) cache.set(kind, read(kind));
  return [...cache.get(kind)];
}

function read(kind) {
  if ( WORLD_KINDS.includes(kind) ) {
    return Object.values(foundry.utils.deepClone(game.settings.get(MODULE_ID, kind) ?? {}));
  }
  const entries = [];
  for ( const user of game.users ) {
    const owned = user.getFlag(MODULE_ID, kind) ?? {};
    for ( const [id, entry] of Object.entries(owned) ) {
      if ( entry ) entries.push({ ...foundry.utils.deepClone(entry), id, author: user.id });
    }
  }
  return entries;
}

/** One entry, as a private copy that's safe to change. */
export function get(kind, id) {
  if ( !id ) return null;
  if ( WORLD_KINDS.includes(kind) ) {
    const entry = game.settings.get(MODULE_ID, kind)?.[id];
    return entry ? foundry.utils.deepClone(entry) : null;
  }
  const entry = all(kind).find(e => e.id === id);
  return entry ? foundry.utils.deepClone(entry) : null;
}

/* -------------------------------------------- */
/*  Permissions                                 */
/* -------------------------------------------- */

export function canCreate(kind) {
  if ( game.user.isGM ) return true;
  if ( kind === "notes" ) return game.settings.get(MODULE_ID, "playerNotes");
  if ( kind === "pins" ) return game.settings.get(MODULE_ID, "playerPins");
  return false;
}

/** GMs can change anything; players can change what they wrote. */
export function canEdit(kind, entry) {
  if ( game.user.isGM ) return true;
  return USER_KINDS.includes(kind) && (entry?.author === game.user.id);
}

/**
 * GMs see everything; players see what's been revealed or shared, and what they wrote. A revealed or shared entry
 * with a list of viewers is only for those players.
 */
export function isVisible(kind, entry, user=game.user) {
  if ( !entry ) return false;
  if ( user.isGM ) return true;
  const allowed = !entry.viewers?.length || entry.viewers.includes(user.id);
  // A letter sent for a later day stays out of sight until the world's clock reaches it.
  if ( (kind === "letters") && entry.arrival && ((game.time?.worldTime ?? 0) < entry.arrival) ) return false;
  if ( WORLD_KINDS.includes(kind) ) return !!entry.visible && allowed;
  return (entry.author === user.id) || (!!entry.shared && allowed);
}

/* -------------------------------------------- */
/*  Writing                                     */
/* -------------------------------------------- */

/*
 * World writes replace the whole setting, so they are made one after another: a second change made before
 * the first has reached the server would otherwise start from the old value and undo it.
 */
let queue = Promise.resolve();

function serial(fn) {
  const result = queue.then(fn);
  queue = result.catch(() => {});
  return result;
}

function writeWorld(kind, mutate) {
  return serial(async () => {
    const data = foundry.utils.deepClone(game.settings.get(MODULE_ID, kind) ?? {});
    const result = mutate(data);
    await game.settings.set(MODULE_ID, kind, data);
    return result;
  });
}

function ownerOf(kind, id) {
  return game.users.find(u => u.getFlag(MODULE_ID, kind)?.[id]) ?? null;
}

/** Create an entry and return its id. User-owned entries are written to the current user. */
export async function create(kind, data) {
  const id = foundry.utils.randomID();
  const now = Date.now();
  const entry = { ...data, id, created: now, updated: now };
  delete entry.author;
  if ( WORLD_KINDS.includes(kind) ) await writeWorld(kind, all => { all[id] = entry; });
  else await game.user.update({ flags: { [MODULE_ID]: { [kind]: { [id]: entry } } } });
  return id;
}

/**
 * Merge changes into an entry. Entries are flat, so each changed field (lists included) replaces the old one whole.
 * A GM may change another user's entries; a player only their own.
 */
export async function update(kind, id, changes) {
  changes = { ...changes, updated: Date.now() };
  delete changes.id;
  delete changes.author;
  if ( WORLD_KINDS.includes(kind) ) {
    return writeWorld(kind, all => {
      if ( all[id] ) Object.assign(all[id], changes);
    });
  }
  const user = ownerOf(kind, id);
  if ( !user ) return;
  return user.update({ flags: { [MODULE_ID]: { [kind]: { [id]: changes } } } });
}

/** Change several entries of a GM collection in one write, as reordering quests does. */
export async function updateMany(kind, changesById) {
  const now = Date.now();
  return writeWorld(kind, all => {
    for ( const [id, changes] of Object.entries(changesById) ) {
      if ( all[id] ) Object.assign(all[id], changes, { updated: now });
    }
  });
}

/** Create several GM entries in one write, keeping any ids they bring (so imported chains stay linked). */
export async function createMany(kind, entries) {
  const now = Date.now();
  const made = entries.map(data => ({ created: now, ...data, id: data.id ?? foundry.utils.randomID(), updated: now }));
  await writeWorld(kind, all => { for ( const entry of made ) all[entry.id] = entry; });
  return made.map(e => e.id);
}

/**
 * Write notes or markers back to their writers, as importing a backup does: each to the user who wrote it, or to
 * the importing GM if that user isn't in this world. Replacing first clears every user's entries of that kind.
 */
export async function importOwned(kind, entries, replace) {
  const byUser = new Map();
  for ( const entry of entries ) {
    const user = game.users.get(entry.author) ?? game.user;
    if ( !byUser.has(user) ) byUser.set(user, {});
    const { author, ...data } = entry;
    byUser.get(user)[entry.id] = data;
  }
  for ( const user of game.users ) {
    const owned = byUser.get(user) ?? {};
    if ( !replace && foundry.utils.isEmpty(owned) ) continue;
    const value = replace ? foundry.data.operators.ForcedReplacement.create(owned) : owned;
    await user.update({ flags: { [MODULE_ID]: { [kind]: value } } });
  }
}

/** Replace a whole GM collection, as importing a backup does. GM only. */
export async function replaceWorld(kind, entries) {
  return writeWorld(kind, all => {
    for ( const id of Object.keys(all) ) delete all[id];
    for ( const entry of entries ) if ( entry?.id ) all[entry.id] = entry;
  });
}

export async function remove(kind, id) {
  if ( WORLD_KINDS.includes(kind) ) return writeWorld(kind, all => { delete all[id]; });
  const user = ownerOf(kind, id);
  if ( !user ) return;
  return user.update({ flags: { [MODULE_ID]: { [kind]: { [id]: new foundry.data.operators.ForcedDeletion() } } } });
}

/** Remove every marker on a map, whoever placed it. Only a GM can do this for other users' markers. */
export async function removePinsOnMap(mapId) {
  for ( const user of game.users ) {
    const pins = user.getFlag(MODULE_ID, "pins") ?? {};
    const doomed = Object.entries(pins).filter(([, pin]) => pin?.map === mapId).map(([id]) => id);
    if ( !doomed.length ) continue;
    const deletion = Object.fromEntries(doomed.map(id => [id, new foundry.data.operators.ForcedDeletion()]));
    await user.update({ flags: { [MODULE_ID]: { pins: deletion } } });
  }
}

/* -------------------------------------------- */
/*  Quest groups                                */
/* -------------------------------------------- */

/** The quest groups in order, each { id, name }; a blank name shows the default group's translated name. */
export function questGroups() {
  const groups = game.settings.get(MODULE_ID, "questGroups");
  if ( Array.isArray(groups) && groups.length ) return foundry.utils.deepClone(groups);
  return QUEST_KINDS.map(id => ({ id, name: "" }));
}

export function setQuestGroups(groups) {
  return game.settings.set(MODULE_ID, "questGroups", groups);
}

/* -------------------------------------------- */
/*  Tracked quests                              */
/* -------------------------------------------- */

/** Letters a user has opened, so new ones can be marked unread. */
export function readLetters(user=game.user) {
  return user.getFlag(MODULE_ID, "readLetters") ?? [];
}

export async function markRead(letterId) {
  const read = readLetters();
  if ( read.includes(letterId) ) return;
  return game.user.setFlag(MODULE_ID, "readLetters", [...read, letterId]);
}

/** Quests a user follows in the on-screen tracker, kept on the User so it follows them between devices. */
export function tracked(user=game.user) {
  return user.getFlag(MODULE_ID, "tracked") ?? [];
}

export async function toggleTracked(questId, force) {
  const list = tracked();
  const on = force ?? !list.includes(questId);
  const next = on ? [...new Set([...list, questId])] : list.filter(id => id !== questId);
  return game.user.setFlag(MODULE_ID, "tracked", next);
}
