import { MODULE_ID } from "./config.mjs";

/*
 * Where everything lives:
 * - Quests, maps and factions are the GM's, kept in world settings.
 * - Journal notes and map markers belong to whoever wrote them, kept on that person's own User. Players may
 *   always update their own User, so they can write notes and place markers without a GM online.
 * Every entry has an id; user-owned entries also report their author's user id.
 */

/** Collections the GM keeps in world settings. */
export const WORLD_KINDS = ["quests", "maps", "factions"];

/** Collections each user keeps on their own User document. */
export const USER_KINDS = ["notes", "pins"];

const listeners = new Set();

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

  Hooks.on("updateUser", (user, changes) => {
    const flags = changes.flags?.[MODULE_ID];
    if ( !flags ) return;
    for ( const kind of [...USER_KINDS, "tracked"] ) {
      if ( kind in flags ) emit(kind, user.id);
    }
  });
}

/** Call a function whenever any collection changes, with the collection and the user who changed it. */
export function onChange(fn) {
  listeners.add(fn);
}

function emit(kind, userId) {
  for ( const fn of listeners ) fn(kind, userId);
}

/* -------------------------------------------- */
/*  Reading                                     */
/* -------------------------------------------- */

/** Every entry of a collection, as copies that are safe to change. */
export function all(kind) {
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

export function get(kind, id) {
  if ( !id ) return null;
  if ( WORLD_KINDS.includes(kind) ) {
    const entry = game.settings.get(MODULE_ID, kind)?.[id];
    return entry ? foundry.utils.deepClone(entry) : null;
  }
  return all(kind).find(e => e.id === id) ?? null;
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

/** GMs see everything; players see what's been revealed, what's shared, and what they wrote. */
export function isVisible(kind, entry, user=game.user) {
  if ( !entry ) return false;
  if ( user.isGM ) return true;
  if ( WORLD_KINDS.includes(kind) ) return !!entry.visible;
  return !!entry.shared || (entry.author === user.id);
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
/*  Tracked quests                              */
/* -------------------------------------------- */

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
