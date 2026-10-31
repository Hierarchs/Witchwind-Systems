import { MODULE_ID, KNOWLEDGE_ORDER, KNOWLEDGE_STEP, KNOWLEDGE_SKILL_IDS } from "./config.mjs";
import * as store from "./store.mjs";
import { request, handle } from "./socket.mjs";
import { knows, loc } from "./helpers.mjs";
import { dayOf } from "./calendar.mjs";
import { creatureForActor, skillFor, dcFor, factHasContent } from "./sections/bestiary.mjs";
import { skillLabel } from "./editor.mjs";

/*
 * Knowledge checks. A player rolls the skill a creature calls for (Arcana for a dragon, Religion for the undead, and
 * so on), from the creature's page with Recall Lore, or from their sheet with one of its tokens targeted. Meeting the
 * DC recalls one fact, and each full 5 over it one more, the most telling first. The active GM's client reads the
 * roll from its chat message and reveals what was recalled, so no player's screen decides what they learn. Each
 * character gets one try at each creature a day.
 */

/** A Recall Lore roll waiting for its chat message: { creatureId, actorId, until }. */
let pending = null;

/** How long Recall Lore waits for its roll, in milliseconds. */
const PENDING_TIME = 120000;

export function registerKnowledge() {
  handle("knowledgeCheck", resolveCheck);
  Hooks.on("createChatMessage", message => onMessage(message));
}

/** Roll to recall what's known of a creature, from its page. */
export async function recallLore(creatureId) {
  const creature = store.get("bestiary", creatureId);
  if ( !creature ) return;
  const actor = await chooseCharacter();
  if ( !actor ) return ui.notifications.warn(loc("Knowledge.NoCharacter"));
  pending = { creatureId, actorId: actor.id, until: Date.now() + PENDING_TIME };
  const skill = skillFor(creature);
  try {
    // dnd5e 4 and later take a roll configuration; earlier versions the skill's id.
    const modern = Number.parseInt(game.system?.version ?? "0") >= 4;
    const rolled = await (modern ? actor.rollSkill({ skill }) : actor.rollSkill(skill));
    if ( !rolled ) pending = null;
  } catch(err) {
    pending = null;
    console.error(`${MODULE_ID} | Couldn't roll ${skill} for ${actor.name}`, err);
  }
}

/** The character who tries: the player's own, or one they choose of those they own. */
async function chooseCharacter() {
  if ( game.user.character?.isOwner ) return game.user.character;
  const owned = game.actors.filter(a => a.isOwner && (a.type === "character"));
  if ( owned.length < 2 ) return owned[0] ?? null;
  const id = await foundry.applications.api.DialogV2.wait({
    window: { title: loc("Knowledge.Who"), icon: "fa-solid fa-brain" },
    classes: ["wws", "wws-dialog"],
    content: `<p>${loc("Knowledge.WhoHint")}</p>`,
    buttons: owned.map(a => ({ action: a.id, label: a.name })),
    rejectClose: false
  });
  return game.actors.get(id) ?? null;
}

/* -------------------------------------------- */

const skillOf = message => message?.flags?.dnd5e?.roll?.skillId ?? message?.flags?.dnd5e?.roll?.skill ?? null;
const authorOf = message => message?.author ?? message?.user ?? null;

/**
 * A skill roll made here: if it's a knowledge skill and is about a creature (the one Recall Lore was for, or a
 * creature's token this user has targeted), ask the GM what it recalls.
 */
function onMessage(message) {
  if ( !game.settings.get(MODULE_ID, "knowledgeChecks") ) return;
  if ( authorOf(message)?.id !== game.user.id ) return;
  if ( !KNOWLEDGE_SKILL_IDS.includes(skillOf(message)) ) return;
  const actorId = message.speaker?.actor;
  let payload;
  if ( pending && (pending.until > Date.now()) && (pending.actorId === actorId) ) {
    payload = { messageId: message.id, creatureId: pending.creatureId };
    pending = null;
  } else {
    const token = Array.from(game.user.targets ?? []).find(t => t.actor && !t.actor.hasPlayerOwner);
    if ( !token ) return;
    payload = { messageId: message.id, tokenUuid: token.document?.uuid };
  }
  const result = game.user.isGM ? resolveCheck(payload, game.user) : request("knowledgeCheck", payload);
  Promise.resolve(result).then(tell).catch(err => console.warn(`${MODULE_ID} | Knowledge check failed`, err));
}

/** Tell the player how it went. What they learned arrives as banners; the rest is a note. */
function tell(outcome) {
  const name = outcome?.name;
  switch ( outcome?.result ) {
    case "learned":
      if ( !game.settings.get(MODULE_ID, "announce") ) ui.notifications.info(loc("Knowledge.Learned", { name, facts: outcome.facts.join(", ") }));
      break;
    case "failed": return ui.notifications.info(loc("Knowledge.Failed", { name }));
    case "tried": return ui.notifications.info(loc("Knowledge.Tried", { name }));
    case "all": return ui.notifications.info(loc("Knowledge.All", { name }));
  }
}

/* -------------------------------------------- */

/**
 * Settle a knowledge check, on the active GM's client. The roll is read from its chat message, which must be the
 * asking player's own; a GM's roll for a character teaches that character's players.
 */
async function resolveCheck({ messageId, creatureId, tokenUuid }, user) {
  const message = game.messages?.get(messageId);
  if ( !message || (authorOf(message)?.id !== user.id) ) return { result: "invalid" };
  const skill = skillOf(message);
  const total = Number(message.rolls?.[0]?.total);
  if ( !KNOWLEDGE_SKILL_IDS.includes(skill) || !Number.isFinite(total) ) return { result: "invalid" };

  let creature = creatureId ? store.get("bestiary", creatureId) : null;
  if ( !creature && tokenUuid ) {
    const token = await foundry.utils.fromUuid(tokenUuid).catch(() => null);
    if ( token?.actor && !token.actor.hasPlayerOwner ) creature = await creatureForActor(token.actor, { create: true });
  }
  if ( !creature ) return { result: "none" };
  if ( skillFor(creature) !== skill ) return { result: "wrongSkill" };

  const actor = game.actors.get(message.speaker?.actor);
  const learners = user.isGM ? game.users.filter(u => !u.isGM && actor?.testUserPermission?.(u, "OWNER")) : [user];
  if ( !learners.length ) return { result: "none" };

  // A creature they've never seen named stays "this creature" until they learn something of it.
  const named = (creature.visible && learners.every(u => store.isVisible("bestiary", creature, u))) ? creature.name : loc("Knowledge.ThisCreature");
  const unknown = KNOWLEDGE_ORDER.filter(key => factHasContent(creature, key) && learners.some(u => !knows(creature, key, u)));
  if ( !unknown.length ) return { result: "all", name: named };
  const today = dayOf();
  if ( learners.some(u => creature.checks?.[u.id] === today) ) return { result: "tried", name: named };

  const dc = dcFor(creature);
  const count = total >= dc ? 1 + Math.floor((total - dc) / KNOWLEDGE_STEP) : 0;
  const learned = unknown.slice(0, count);
  const party = game.settings.get(MODULE_ID, "knowledgeShare") === "party";
  const knowledge = foundry.utils.deepClone(creature.knowledge ?? {});
  for ( const key of learned ) {
    knowledge[key] = party ? ["*"] : [...new Set([...(knowledge[key] ?? []), ...learners.map(u => u.id)])];
  }
  const checks = { ...(creature.checks ?? {}), ...Object.fromEntries(learners.map(u => [u.id, today])) };
  await store.update("bestiary", creature.id, { knowledge, checks, ...(learned.length ? { visible: true } : {}) });

  const facts = learned.map(key => loc(`Bestiary.Facts.${key}`));
  await report({ creature, learners, actor, skill, total, dc, facts });
  return learned.length ? { result: "learned", name: creature.name, facts } : { result: "failed", name: named };
}

/** A note to the GMs of how the check went: who tried, what they rolled against what, and what they recalled. */
function report({ creature, learners, actor, skill, total, dc, facts }) {
  const esc = foundry.utils.escapeHTML;
  const who = actor?.name ?? learners.map(u => u.name).join(", ");
  const outcome = facts.length ? loc("Knowledge.ReportLearned", { facts: facts.join(", ") }) : loc("Knowledge.ReportNothing");
  const content = `<div class="wws wws-knowledge-card">
    <header><i class="fa-solid fa-brain" inert></i><span>${esc(loc("Knowledge.CardLabel"))}</span><strong>${esc(creature.name ?? "")}</strong></header>
    <p>${esc(loc("Knowledge.Report", { who, skill: skillLabel(skill), total, dc }))}</p>
    <p class="wws-knowledge-outcome">${esc(outcome)}</p>
  </div>`;
  return ChatMessage.implementation.create({
    content,
    whisper: game.users.filter(u => u.isGM).map(u => u.id),
    speaker: { alias: loc("Knowledge.Speaker") }
  });
}
