import { MODULE_ID, PATH, CURRENCIES } from "./config.mjs";
import * as store from "./store.mjs";
import { loc, docSync } from "./helpers.mjs";
import { partyMembers } from "./party.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/*
 * Quest rewards: experience, coins and items set on a quest, and handed to the party when it's completed. The GM who
 * completes a quest is asked who gets what; then each character's sheet gets its experience and coins, and the
 * items are copied in. A card in the chat says who got what.
 */

/** Whether a quest has anything to hand out. */
export function hasRewards(quest) {
  return !!((quest?.rewards?.length) || (Number(quest?.xp) > 0) || Object.values(quest?.coins ?? {}).some(n => n > 0));
}

/** A quest's coins as a list of { id, amount, label }, most valuable first. */
export function coinList(coins) {
  return CURRENCIES.filter(id => Number(coins?.[id]) > 0).map(id => ({ id, amount: Number(coins[id]), label: `${Number(coins[id]).toLocaleString(game.i18n.lang)} ${currencyName(id)}` }));
}

function currencyName(id) {
  const label = CONFIG.DND5E?.currencies?.[id]?.abbreviation;
  return label ? game.i18n.localize(label) : id;
}

/** Ask the GM how to hand out a quest's rewards. */
export function offerRewards(questId) {
  if ( !game.user.isGM || !hasRewards(store.get("quests", questId)) ) return;
  const id = `${MODULE_ID}-rewards-${questId}`;
  const open = foundry.applications.instances.get(id);
  if ( open ) return open.bringToFront();
  return new RewardsDialog({ id, questId }).render({ force: true });
}

/** Offer the rewards whenever this GM completes a quest that has some and hasn't handed them out yet. */
export function registerRewards() {
  let statuses = snapshot();
  store.onChange((kind, userId) => {
    if ( kind !== "quests" ) return;
    const before = statuses;
    statuses = snapshot();
    if ( !game.user.isGM || (userId !== game.user.id) ) return;
    for ( const [id, status] of statuses ) {
      if ( (status !== "completed") || (before.get(id) === "completed") || !before.has(id) ) continue;
      const quest = store.get("quests", id);
      if ( hasRewards(quest) && !quest.rewarded ) offerRewards(id);
    }
  });
}

const snapshot = () => new Map(store.all("quests").map(q => [q.id, q.status ?? "active"]));

/* -------------------------------------------- */

class RewardsDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ questId, ...options }) {
    super(options);
    this.questId = questId;
  }

  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["wws", "wws-editor", "wws-rewards-dialog"],
    window: { icon: "fa-solid fa-hand-holding-heart" },
    position: { width: 500, height: "auto" },
    form: { handler: RewardsDialog.#onSubmit, closeOnSubmit: true },
    actions: { rewardsLater: RewardsDialog.#onLater }
  };

  static PARTS = {
    form: { template: `${PATH}/templates/rewards.hbs` }
  };

  get title() {
    return loc("Rewards.Title", { name: store.get("quests", this.questId)?.title || loc("Untitled") });
  }

  /** @override */
  async _prepareContext(options) {
    const quest = store.get("quests", this.questId) ?? {};
    const people = partyMembers().map(a => ({ uuid: a.uuid, name: a.name, img: a.img }));
    const coins = coinList(quest.coins);
    return {
      title: quest.title || loc("Untitled"),
      people,
      xp: Number(quest.xp) || 0,
      coins,
      coinsLabel: coins.map(c => c.label).join(", "),
      items: (quest.rewards ?? []).map((r, index) => ({ ...r, index, canGive: !!r.uuid })),
      rewarded: !!quest.rewarded
    };
  }

  static async #onSubmit(event, form) {
    const recipients = Array.from(form.querySelectorAll("input[name=to]:checked"), el => el.value);
    const items = Object.fromEntries(Array.from(form.querySelectorAll("select[data-item]"), el => [el.dataset.item, el.value]));
    await grant(this.questId, { recipients, splitXp: !!form.querySelector("input[name=splitXp]")?.checked, items });
  }

  static #onLater() {
    return this.close();
  }
}

/* -------------------------------------------- */

/**
 * Hand a quest's rewards out: the experience to each character (or split between them), the coins shared out evenly
 * with any left over going to the first, and each item to whoever the GM chose.
 */
async function grant(questId, { recipients, splitXp, items }) {
  const quest = store.get("quests", questId);
  if ( !quest ) return;
  const actors = recipients.map(uuid => docSync(uuid)).filter(a => a?.isOwner);
  const got = new Map(actors.map(a => [a, []]));

  const xp = Number(quest.xp) || 0;
  const changes = new Map(actors.map(a => [a, {}]));
  if ( xp && actors.length ) {
    const each = splitXp ? Math.floor(xp / actors.length) : xp;
    for ( const actor of actors ) {
      const current = Number(foundry.utils.getProperty(actor, "system.details.xp.value")) || 0;
      changes.get(actor)["system.details.xp.value"] = current + each;
      if ( each ) got.get(actor).push(loc("Rewards.XPAmount", { n: each.toLocaleString(game.i18n.lang) }));
    }
  }
  for ( const { id, amount } of coinList(quest.coins) ) {
    if ( !actors.length ) break;
    const share = Math.floor(amount / actors.length);
    actors.forEach((actor, i) => {
      const n = share + ((i === 0) ? amount - (share * actors.length) : 0);
      if ( !n ) return;
      const current = Number(foundry.utils.getProperty(actor, `system.currency.${id}`)) || 0;
      changes.get(actor)[`system.currency.${id}`] = current + n;
      got.get(actor).push(`${n.toLocaleString(game.i18n.lang)} ${currencyName(id)}`);
    });
  }
  for ( const [actor, change] of changes ) if ( !foundry.utils.isEmpty(change) ) await actor.update(change);

  // Items are copied from the sidebar or compendium item they were dropped from.
  const kept = [];
  for ( const [index, uuid] of Object.entries(items) ) {
    const reward = quest.rewards?.[Number(index)];
    const actor = actors.find(a => a.uuid === uuid);
    if ( !reward ) continue;
    const qty = Number(reward.qty) || 1;
    const named = qty > 1 ? `${reward.name} ×${qty}` : reward.name;
    const source = (actor && reward.uuid) ? await foundry.utils.fromUuid(reward.uuid).catch(() => null) : null;
    if ( !actor || !source ) {
      kept.push(named);
      continue;
    }
    const data = source.toObject();
    delete data._id;
    if ( foundry.utils.hasProperty(data, "system.quantity") ) foundry.utils.setProperty(data, "system.quantity", qty);
    await actor.createEmbeddedDocuments("Item", [data]);
    got.get(actor).push(named);
  }

  await store.update("quests", questId, { rewarded: Date.now() });
  await announce(quest, got, kept);
}

/** A card in the chat: the quest, and what each character received. */
async function announce(quest, got, kept) {
  const esc = foundry.utils.escapeHTML;
  const rows = [...got].filter(([, list]) => list.length).map(([actor, list]) => `
    <li><img src="${esc(actor.img ?? "")}" alt=""><span class="wws-reward-name">${esc(actor.name)}</span>
    <span class="wws-reward-got">${list.map(esc).join(" · ")}</span></li>`).join("");
  const content = `<div class="wws wws-reward-card">
    <header><i class="fa-solid fa-hand-holding-heart" inert></i><span>${esc(loc("Rewards.CardLabel"))}</span>
    <strong>${esc(quest.title || loc("Untitled"))}</strong></header>
    ${rows ? `<ul>${rows}</ul>` : ""}
    ${kept.length ? `<p class="wws-reward-kept">${esc(loc("Rewards.ByHand", { items: kept.join(", ") }))}</p>` : ""}
  </div>`;
  return ChatMessage.implementation.create({ content, speaker: { alias: loc("Rewards.Speaker") } });
}
