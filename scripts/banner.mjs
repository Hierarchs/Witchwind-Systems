import { MODULE_ID, L, standingTier } from "./config.mjs";
import * as store from "./store.mjs";
import { plainText, docSync } from "./helpers.mjs";

/*
 * When the GM starts, updates, completes or fails a quest, or promotes your character in a faction, a title
 * fades in across the top of the screen as in the Elder Scrolls games: "Quest Started", the quest's name, and
 * a line of detail. Each client compares what it could see before a change with what it sees after.
 */

/** How long each banner stays, in milliseconds (matches the animation in the stylesheet). */
const DURATION = 4800;

/** The longest line of detail shown under a title. */
const DETAIL_LENGTH = 140;

let seen = null;
const queue = [];
let showing = false;

export function initBanners() {
  seen = snapshot();
  store.onChange((kind, userId) => {
    if ( !["quests", "factions"].includes(kind) ) return;
    const before = seen;
    seen = snapshot();
    // Whoever made the change already knows about it.
    if ( (userId === game.user.id) || !game.settings.get(MODULE_ID, "announce") ) return;
    const events = kind === "quests" ? questEvents(before.quests, seen.quests) : factionEvents(before.factions, seen.factions);
    for ( const event of events ) announce(event);
  });
}

/** Show a banner, after any already showing. */
export function announce({ label, title, detail, tone="gold", icon="fa-solid fa-scroll-old" }) {
  queue.push({ label, title, detail, tone, icon });
  if ( !showing ) next();
}

function next() {
  const banner = queue.shift();
  if ( !banner ) {
    showing = false;
    return;
  }
  showing = true;
  const el = document.createElement("div");
  el.className = `wws wws-banner wws-tone-${banner.tone}`;
  el.setAttribute("role", "status");
  el.innerHTML = `<i class="wws-banner-icon"></i><span class="wws-banner-label"></span>
    <span class="wws-banner-title"></span><span class="wws-banner-detail"></span>`;
  el.querySelector(".wws-banner-icon").className = `wws-banner-icon ${banner.icon}`;
  el.querySelector(".wws-banner-label").textContent = banner.label;
  el.querySelector(".wws-banner-title").textContent = banner.title;
  const detail = el.querySelector(".wws-banner-detail");
  if ( banner.detail ) detail.textContent = banner.detail;
  else detail.remove();
  document.body.append(el);
  setTimeout(() => {
    el.remove();
    next();
  }, DURATION);
}

/* -------------------------------------------- */

function snapshot() {
  const visible = kind => new Map(store.all(kind).filter(e => store.isVisible(kind, e)).map(e => [e.id, e]));
  return { quests: visible("quests"), factions: visible("factions") };
}

const t = key => game.i18n.localize(`${L}.Banners.${key}`);
const clip = text => (text.length > DETAIL_LENGTH ? `${text.slice(0, DETAIL_LENGTH - 1)}…` : text);

function questEvents(before, after) {
  const events = [];
  for ( const quest of after.values() ) {
    const prev = before.get(quest.id);
    const status = quest.status ?? "active";
    const title = quest.title || "";
    const shownObjectives = q => (q?.objectives ?? []).filter(o => !o.hidden);
    const shownLog = q => (q?.log ?? []).filter(e => !e.hidden);

    if ( !prev ) {
      if ( status === "active" ) {
        const first = shownObjectives(quest).find(o => !o.done);
        events.push({ label: t("Started"), title, detail: first?.text, icon: "fa-solid fa-scroll-old" });
      }
      continue;
    }

    const prevStatus = prev.status ?? "active";
    if ( status !== prevStatus ) {
      if ( status === "completed" ) events.push({ label: t("Completed"), title, tone: "green", icon: "fa-solid fa-circle-check" });
      else if ( status === "failed" ) events.push({ label: t("Failed"), title, tone: "red", icon: "fa-solid fa-circle-xmark" });
      else events.push({ label: t("Updated"), title, icon: "fa-solid fa-scroll-old" });
      continue;
    }
    if ( status !== "active" ) continue;

    const old = new Map(shownObjectives(prev).map(o => [o.id, o]));
    const done = shownObjectives(quest).find(o => o.done && old.has(o.id) && !old.get(o.id).done);
    const added = shownObjectives(quest).find(o => !old.has(o.id) && !o.done);
    const oldLog = new Set(shownLog(prev).map(e => e.id));
    const entry = shownLog(quest).filter(e => !oldLog.has(e.id)).sort((a, b) => (b.date ?? 0) - (a.date ?? 0))[0];

    if ( done ) events.push({ label: t("ObjectiveDone"), title: done.text, detail: title, icon: "fa-solid fa-diamond" });
    if ( added ) events.push({ label: t("NewObjective"), title: added.text, detail: title, icon: "fa-regular fa-diamond" });
    else if ( entry && !done ) events.push({ label: t("Updated"), title, detail: clip(plainText(entry.text)), icon: "fa-solid fa-feather" });
  }
  return events;
}

/** Joining, promotions and changes of standing tier, for the viewer's own characters. Players only. */
function factionEvents(before, after) {
  if ( game.user.isGM ) return [];
  const events = [];
  const mine = f => (f?.members ?? []).filter(m => docSync(m.uuid)?.isOwner);
  for ( const faction of after.values() ) {
    const prev = before.get(faction.id);
    const ranks = faction.ranks ?? [];
    const old = new Map(mine(prev).map(m => [m.uuid, m]));
    for ( const member of mine(faction) ) {
      const was = old.get(member.uuid);
      const name = docSync(member.uuid)?.name ?? member.name;
      if ( !was ) {
        events.push({ label: t("Joined"), title: faction.name, detail: `${name} · ${ranks[member.rank] ?? ""}`, icon: "fa-solid fa-chess-rook" });
      } else if ( (member.rank ?? 0) > (was.rank ?? 0) ) {
        events.push({ label: t("Promoted"), title: ranks[member.rank] ?? "", detail: `${name} · ${faction.name}`, icon: "fa-solid fa-crown" });
      }
    }
    if ( prev && (standingTier(prev.standing ?? 0) !== standingTier(faction.standing ?? 0)) ) {
      const tier = standingTier(faction.standing ?? 0);
      const rising = (faction.standing ?? 0) > (prev.standing ?? 0);
      events.push({
        label: t(rising ? "StandingUp" : "StandingDown"),
        title: game.i18n.localize(`${L}.Factions.Tiers.${tier}`),
        detail: faction.name,
        tone: rising ? "green" : "red",
        icon: rising ? "fa-solid fa-arrow-trend-up" : "fa-solid fa-arrow-trend-down"
      });
    }
  }
  return events;
}
