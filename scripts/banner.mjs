import { MODULE_ID, L, standingTier, BESTIARY_FACTS } from "./config.mjs";
import * as store from "./store.mjs";
import { plainText, docSync, knows } from "./helpers.mjs";
import { playSound } from "./sounds.mjs";
import { showNotice } from "./notice.mjs";

/*
 * When the GM starts, updates, completes or fails a quest, or promotes your character in a faction, a title
 * fades in across the top of the screen as in the Elder Scrolls games: "Quest Started", the quest's name, and
 * a line of detail. Each client compares what it could see before a change with what it sees after.
 */

/** How long each banner stays, in milliseconds (matches the animation in the stylesheet). */
const DURATION = 4800;

/** The longest line of detail shown under a title. */
const DETAIL_LENGTH = 140;

/** The longest text shown in a quest pop-up. */
const POPUP_LENGTH = 260;

let seen = null;
const queue = [];
let showing = false;

export function initBanners() {
  seen = snapshot();
  store.onChange((kind, userId) => {
    if ( !["quests", "factions", "letters", "titles", "bestiary"].includes(kind) ) return;
    const before = seen;
    seen = snapshot();
    // Whoever made the change already knows about it.
    if ( (userId === game.user.id) || !game.settings.get(MODULE_ID, "announce") ) return;
    if ( kind === "letters" ) return letterArrivals(before.letters, seen.letters);
    if ( kind === "bestiary" ) return creatureNews(before.bestiary, seen.bestiary);
    if ( kind === "titles" ) return titleAwards(before.titles, seen.titles);
    const events = kind === "quests" ? questEvents(before.quests, seen.quests, seen.factions)
      : factionEvents(before.factions, seen.factions);
    for ( const event of events ) announce(event);
  });
}

/** The world’s clock moved: letters held back for this day arrive. */
export function onWorldTime() {
  const before = seen;
  seen = snapshot();
  if ( game.settings.get(MODULE_ID, "announce") ) letterArrivals(before.letters, seen.letters);
}

/** A creature the party has just met, and each fact about one that's just been revealed to this player. */
function creatureNews(before, after) {
  if ( game.user.isGM ) return;
  const t = key => game.i18n.localize(`${L}.Banners.${key}`);
  for ( const creature of after.values() ) {
    const prev = before.get(creature.id);
    const name = creature.name || game.i18n.localize(`${L}.Untitled`);
    if ( !prev ) {
      announce({ label: t("NewCreature"), title: name, icon: "fa-solid fa-dragon" });
      continue;
    }
    for ( const fact of BESTIARY_FACTS ) {
      if ( knows(creature, fact.key) && !knows(prev, fact.key) ) {
        announce({ label: t("Learned"), title: name, detail: game.i18n.localize(`${L}.Bestiary.Facts.${fact.key}`), icon: fact.icon });
      }
    }
  }
}

/** A pop-up for each letter that has just reached this player, unless they’ve already read it. */
function letterArrivals(before, after) {
  if ( game.user.isGM ) return;
  const read = new Set(store.readLetters());
  for ( const letter of after.values() ) {
    if ( before.has(letter.id) || read.has(letter.id) ) continue;
    showNotice({
      label: game.i18n.localize(`${L}.Notice.Letter`),
      title: letter.title || "",
      detail: letter.sender ? game.i18n.format(`${L}.Notice.From`, { name: letter.sender }) : "",
      img: letter.img,
      icon: "fa-solid fa-envelope",
      open: { section: "journal", id: letter.id },
      openLabel: game.i18n.localize(`${L}.Notice.ReadLetter`)
    });
  }
}

/** A pop-up when one of this player’s characters earns a title. */
function titleAwards(before, after) {
  if ( game.user.isGM ) return;
  for ( const title of after.values() ) {
    if ( before.has(title.id) ) continue;
    const actor = docSync(title.uuid);
    if ( !actor?.isOwner ) continue;
    showNotice({
      label: game.i18n.localize(`${L}.Notice.Title`),
      title: title.name || "",
      detail: [actor.name, title.reason].filter(Boolean).join(" · "),
      icon: title.icon || "fa-solid fa-crown",
      open: { section: "renown", id: title.uuid },
      openLabel: game.i18n.localize(`${L}.Notice.ViewRenown`)
    });
  }
}

/**
 * Show a banner, after any already showing. A quest added, completed or failed (an event with a popup) shows
 * Oblivion's pop-up instead, unless the player has turned pop-ups off.
 */
export function announce({ label, title, detail, tone="gold", icon="fa-solid fa-scroll-old", popup }) {
  if ( popup && game.settings.get(MODULE_ID, "questPopups") ) return showNotice({ title, tone, icon, ...popup });
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
  playSound("quest");
  setTimeout(() => {
    el.remove();
    next();
  }, DURATION);
}

/* -------------------------------------------- */

function snapshot() {
  const visible = kind => new Map(store.all(kind).filter(e => store.isVisible(kind, e)).map(e => [e.id, e]));
  return {
    quests: visible("quests"), factions: visible("factions"), letters: visible("letters"), titles: visible("titles"),
    bestiary: visible("bestiary")
  };
}

const t = key => game.i18n.localize(`${L}.Banners.${key}`);
const clip = (text, length=DETAIL_LENGTH) => (text.length > length ? `${text.slice(0, length - 1)}…` : text);

function questEvents(before, after, factions) {
  const events = [];
  for ( const quest of after.values() ) {
    const prev = before.get(quest.id);
    const status = quest.status ?? "active";
    const title = quest.title || "";
    const shownObjectives = q => (q?.objectives ?? []).filter(o => !o.hidden);
    const shownLog = q => (q?.log ?? []).filter(e => !e.hidden);

    // What the pop-up shows: the quest's picture (or its faction's emblem), and a line about it.
    const latest = shownLog(quest).sort((a, b) => (b.date ?? 0) - (a.date ?? 0))[0];
    const about = clip(plainText(quest.description) || shownObjectives(quest).find(o => !o.done)?.text || "", POPUP_LENGTH);
    const popup = (labelKey, detail) => ({
      label: game.i18n.localize(`${L}.Notice.${labelKey}`),
      detail,
      img: quest.img || factions.get(quest.faction)?.img || "",
      open: { section: "quests", id: quest.id }
    });

    if ( !prev ) {
      if ( status === "active" ) {
        const first = shownObjectives(quest).find(o => !o.done);
        events.push({ label: t("Started"), title, detail: first?.text, icon: "fa-solid fa-scroll-old", popup: popup("Added", about) });
      }
      continue;
    }

    const prevStatus = prev.status ?? "active";
    if ( status !== prevStatus ) {
      const ending = latest ? clip(plainText(latest.text), POPUP_LENGTH) : about;
      if ( status === "completed" ) {
        events.push({ label: t("Completed"), title, tone: "green", icon: "fa-solid fa-circle-check", popup: popup("Completed", ending) });
      }
      else if ( status === "failed" ) {
        events.push({ label: t("Failed"), title, tone: "red", icon: "fa-solid fa-circle-xmark", popup: popup("Failed", ending) });
      }
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
      const joined = (member.rank ?? 0) >= 0;
      if ( (!was || ((was.rank ?? 0) < 0)) && joined ) {
        events.push({ label: t("Joined"), title: faction.name, detail: `${name} · ${ranks[member.rank] ?? ""}`, icon: "fa-solid fa-chess-rook" });
      } else if ( was && joined && ((member.rank ?? 0) > (was.rank ?? 0)) ) {
        events.push({ label: t("Promoted"), title: ranks[member.rank] ?? "", detail: `${name} · ${faction.name}`, icon: "fa-solid fa-crown" });
      }
      // A character's own standing crossing into another tier.
      const before = Number.isFinite(was?.standing) ? was.standing : null;
      const after = Number.isFinite(member.standing) ? member.standing : null;
      if ( (before !== null) && (after !== null) && (standingTier(before) !== standingTier(after)) ) {
        const rising = after > before;
        events.push({
          label: t(rising ? "StandingUp" : "StandingDown"),
          title: game.i18n.localize(`${L}.Factions.Tiers.${standingTier(after)}`),
          detail: `${name} · ${faction.name}`,
          tone: rising ? "green" : "red",
          icon: rising ? "fa-solid fa-arrow-trend-up" : "fa-solid fa-arrow-trend-down"
        });
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
