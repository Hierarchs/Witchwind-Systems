import { MODULE_ID } from "./config.mjs";
import * as store from "./store.mjs";
import { worldNow, loc } from "./helpers.mjs";
import { creatureForActor } from "./sections/bestiary.mjs";

/*
 * The bestiary keeps itself from the combat tracker. When a fight starts, each creature the party faces (anything
 * that isn't theirs or friendly to them) is added to the bestiary if it isn't there yet, and an encounter is logged
 * at the scene, one for each fight. Each one that falls, at 0 hit points or marked defeated, is counted as slain.
 * Only the active GM's client writes, one change after another.
 */

let chain = Promise.resolve();
const serial = fn => (chain = chain.then(fn).catch(err => console.error(`${MODULE_ID} | Couldn't log the combat`, err)));

const active = () => game.user.isActiveGM && game.settings.get(MODULE_ID, "combatLog");

export function registerEncounters() {
  // A fight's first round, or a later one for a combat that started before this client was the active GM.
  Hooks.on("updateCombat", (combat, changes) => {
    if ( active() && ("round" in changes) && combat.started ) serial(() => logCombatants(combat, combat.combatants.contents));
  });
  Hooks.on("createCombatant", combatant => {
    if ( active() && combatant.combat?.started ) serial(() => logCombatants(combatant.combat, [combatant]));
  });
  Hooks.on("updateCombatant", (combatant, changes) => {
    if ( active() && (changes.defeated === true) ) serial(() => slain(combatant));
  });
  Hooks.on("updateActor", (actor, changes) => {
    const hp = foundry.utils.getProperty(changes, "system.attributes.hp.value");
    if ( !active() || (hp === undefined) || (hp > 0) ) return;
    for ( const combatant of combatantsOf(actor) ) serial(() => slain(combatant));
  });
}

/** Whether a combatant is one the party is fighting: not a player's, not a character, not friendly. */
function isFoe(combatant) {
  const actor = combatant?.actor;
  if ( !actor || actor.hasPlayerOwner || ["character", "group", "vehicle"].includes(actor.type) ) return false;
  return (combatant.token?.disposition ?? -1) !== (CONST.TOKEN_DISPOSITIONS?.FRIENDLY ?? 1);
}

/** The combatants of started fights that an actor stands for. */
function combatantsOf(actor) {
  const found = [];
  for ( const combat of game.combats ?? [] ) {
    if ( !combat.started ) continue;
    for ( const c of combat.combatants ) {
      const same = (c.actor === actor) || (actor.isToken ? (c.tokenId === actor.token?.id) : ((c.actorId === actor.id) && c.token?.actorLink));
      if ( same ) found.push(c);
    }
  }
  return found;
}

function placeOf(combat) {
  const scene = combat.scene ?? game.scenes?.viewed;
  return scene?.navName || scene?.name || loc("Bestiary.UnknownPlace");
}

/** Log an encounter for each kind of creature in a fight, once. */
async function logCombatants(combat, combatants) {
  const done = new Set();
  for ( const combatant of combatants ) {
    if ( !isFoe(combatant) ) continue;
    const creature = await creatureForActor(combatant.actor, { create: true });
    if ( !creature || done.has(creature.id) ) continue;
    done.add(creature.id);
    await withEncounter(creature.id, combat);
  }
}

/** Count a fallen combatant as slain, once. */
async function slain(combatant) {
  if ( !isFoe(combatant) || !combatant.combat ) return;
  const creature = await creatureForActor(combatant.actor, { create: true });
  if ( !creature ) return;
  await withEncounter(creature.id, combatant.combat, encounter => {
    encounter.slain ??= [];
    if ( encounter.slain.includes(combatant.id) ) return false;
    encounter.slain.push(combatant.id);
    return true;
  });
}

/**
 * A creature's encounter for a fight, logged if it isn't yet, and changed by a function that says whether it changed
 * anything. Logging the first encounter reveals the creature and its basics, as logging one by hand does.
 */
async function withEncounter(creatureId, combat, change) {
  const creature = store.get("bestiary", creatureId);
  if ( !creature ) return;
  const encounters = creature.encounters ?? [];
  let encounter = encounters.find(e => e.combat === combat.id);
  const isNew = !encounter;
  if ( isNew ) {
    encounter = { id: foundry.utils.randomID(), date: worldNow(), place: placeOf(combat), combat: combat.id, slain: [] };
    encounters.push(encounter);
  }
  const changed = change?.(encounter) ?? false;
  if ( !isNew && !changed ) return;
  const knowledge = { ...(creature.knowledge ?? {}) };
  if ( !knowledge.basics?.length ) knowledge.basics = ["*"];
  await store.update("bestiary", creatureId, { encounters, knowledge, visible: true });
}
