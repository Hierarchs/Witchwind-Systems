import { PATH, L, TROPHY_ICONS, STANDING_TIERS, EARLIER_COUNTS } from "../config.mjs";
import * as store from "../store.mjs";
import { openEditor } from "../editor.mjs";
import { loc, confirmDelete, openSheet, worldDate, formatDate, formatNumber, docSync } from "../helpers.mjs";
import { tally } from "../chronicle.mjs";
import { progressOf, award, revoke, earnerName, tierOf, isEach, kindLabel, creatureKinds } from "../trophies.mjs";
import { partyMembers } from "../party.mjs";
import { startOfDay } from "../calendar.mjs";

/*
 * The Chronicle tab, in two modes as the Standing tab has: Trophies, the party's achievements (earned ones first, with
 * when and by whom, then the locked ones, closest first, with how far the party has to go), and Records, the
 * campaign's numbers: sessions, days, foes slain, gold earned and places found, and the details behind them.
 */

/** How many of the most slain creatures, places found and sessions the Records page lists. */
const SLAIN_SHOWN = 6;
const PLACES_SHOWN = 8;
const SESSIONS_SHOWN = 6;

export default {
  id: "chronicle",
  template: `${PATH}/templates/sections/chronicle.hbs`,

  async prepare(app) {
    const mode = (app.filters.chronicle === "records") ? "records" : "trophies";
    const t = tally();
    const trophies = shownTrophies();
    const counted = trophies.filter(tr => tr.enabled !== false);
    const earned = counted.filter(tr => tr.earned?.length).length;
    const page = (mode === "records") ? recordsPage(t, counted, earned) : trophiesPage(app, t, trophies);
    return {
      ...page,
      mode,
      isRecords: mode === "records",
      canEdit: game.user.isGM,
      earned,
      total: counted.length,
      earnedPercent: counted.length ? Math.round((earned / counted.length) * 100) : 0,
      modes: [
        { filter: "trophies", label: `${L}.Chronicle.Modes.trophies`, hint: `${L}.Chronicle.Modes.trophiesHint`, icon: "fa-solid fa-trophy",
          count: `${earned}/${counted.length}`, active: mode === "trophies" },
        { filter: "records", label: `${L}.Chronicle.Modes.records`, hint: `${L}.Chronicle.Modes.recordsHint`, icon: "fa-solid fa-book-open",
          active: mode === "records" }
      ]
    };
  },

  actions: {
    chronicleMode(event, target) {
      this.filters.chronicle = target.dataset.filter;
      this.render();
    },

    trophySelect(event, target) {
      this.selected.chronicle = target.dataset.id;
      this.render();
    },

    trophyNew() {
      openEditor("trophy", {
        entry: { rule: "kills", count: 10, tier: "bronze", icon: TROPHY_ICONS[0], enabled: true },
        title: loc("Trophies.New"),
        extra: { kinds: creatureKinds() },
        onSave: async data => {
          const sort = Math.max(0, ...store.all("trophies").map(tr => tr.sort ?? 0)) + 1;
          this.filters.chronicle = "trophies";
          this.selected.chronicle = await store.create("trophies", { ...data, visible: true, sort, earned: [], barred: [] });
        }
      });
    },

    trophyEdit(event, target) {
      const trophy = store.get("trophies", target.dataset.id);
      if ( !trophy ) return;
      openEditor("trophy", {
        entry: trophy,
        title: loc("Trophies.Edit", { name: trophy.name }),
        extra: { kinds: creatureKinds() },
        onSave: data => store.update("trophies", trophy.id, data)
      });
    },

    async trophyDelete(event, target) {
      const trophy = store.get("trophies", target.dataset.id);
      if ( trophy && await confirmDelete(trophy.name) ) await store.remove("trophies", trophy.id);
    },

    trophyToggle(event, target) {
      const trophy = store.get("trophies", target.dataset.id);
      if ( trophy ) return store.update("trophies", trophy.id, { enabled: trophy.enabled === false });
    },

    async trophyAward(event, target) {
      const trophy = store.get("trophies", target.dataset.id);
      if ( !trophy ) return;
      if ( !isEach(trophy) ) return award(trophy.id);
      const uuids = await pickCharacters(trophy);
      if ( uuids?.length ) await award(trophy.id, uuids);
    },

    /** Take a trophy back: from one character (data-uuid), from the party (an empty data-uuid), or from everyone. */
    trophyRevoke(event, target) {
      const uuid = target.dataset.uuid;
      return revoke(target.dataset.id, (uuid === undefined) ? undefined : (uuid || null));
    },

    recordsEdit() {
      const record = store.chronicle();
      openEditor("records", {
        entry: { id: "records", began: record.began, sessions: record.sessions ?? 0, gold: record.gold ?? 0, earlier: record.earlier ?? {} },
        title: loc("Chronicle.EditRecords"),
        onSave: data => store.updateChronicle(c => {
          if ( Number.isFinite(data.began) ) c.began = data.began;
          c.sessions = Math.max(0, Math.round(Number(data.sessions) || 0));
          c.gold = Math.max(0, Math.round((Number(data.gold) || 0) * 100) / 100);
          c.earlier = data.earlier;
        })
      });
    },

    chronicleCreature(event, target) {
      this.open("bestiary", target.dataset.id);
    },

    chronicleSheet(event, target) {
      return openSheet(target.dataset.uuid);
    }
  }
};

/* -------------------------------------------- */
/*  Trophies                                    */
/* -------------------------------------------- */

const fmt = n => formatNumber(n);
const signed = n => (n > 0 ? `+${n}` : String(n));

/** The trophies this user sees: every one for the GM, those switched on for players. */
function shownTrophies() {
  return store.all("trophies").filter(tr => game.user.isGM || (tr.enabled !== false));
}

/** Who earned a trophy and when, latest first. */
function earnedList(trophy) {
  return (trophy.earned ?? []).map(e => {
    const actor = e.uuid ? docSync(e.uuid) : null;
    return {
      uuid: e.uuid ?? "",
      party: !e.uuid,
      name: earnerName(e.uuid),
      img: actor?.img ?? "",
      dateLabel: worldDate(e.time ?? 0),
      session: e.session || null,
      real: e.real ?? 0
    };
  }).sort((a, b) => b.real - a.real);
}

/** How far a trophy is from unlocking, in words: "Slain 7 of 25". */
function progressLabel(trophy, p) {
  const value = (trophy.rule === "standing") ? signed(p.value) : fmt((trophy.rule === "gold") ? Math.floor(p.value) : p.value);
  const target = (trophy.rule === "standing") ? signed(p.target) : fmt(p.target);
  return loc(`Trophies.Progress.${trophy.rule}`, { value, target, kind: kindLabel(trophy.param) });
}

/** A trophy as its row and page show it. A secret one stays a question mark to players until it's earned. */
function trophyView(trophy, t) {
  const earned = earnedList(trophy);
  const isEarned = earned.length > 0;
  const masked = !game.user.isGM && !!trophy.secret && !isEarned;
  const tier = tierOf(trophy);
  let progress = null;
  if ( !isEarned && !masked && (trophy.rule !== "manual") ) {
    const p = progressOf(trophy, t);
    progress = { ...p, label: progressLabel(trophy, p) };
  }
  return {
    id: trophy.id,
    name: masked ? loc("Trophies.Secret") : (trophy.name || loc("Untitled")),
    description: masked ? loc("Trophies.SecretHint") : (trophy.description ?? ""),
    icon: masked ? "fa-solid fa-question" : (trophy.icon || "fa-solid fa-trophy"),
    img: masked ? "" : (trophy.img ?? ""),
    tier,
    tierLabel: `${L}.Trophies.Tiers.${tier}`,
    earned,
    isEarned,
    masked,
    progress,
    each: !masked && isEach(trophy),
    secret: !!trophy.secret,
    off: trophy.enabled === false,
    latest: earned[0]?.real ?? 0,
    sort: trophy.sort ?? 0
  };
}

/** Earned trophies first, the latest at the top; then the locked ones, closest first; secrets and switched off last. */
function byShowing(a, b) {
  const rank = v => (v.off ? 3 : (v.isEarned ? 0 : (v.masked ? 2 : 1)));
  return (rank(a) - rank(b)) || (b.latest - a.latest) || ((b.progress?.percent ?? 0) - (a.progress?.percent ?? 0)) || (a.sort - b.sort);
}

function trophiesPage(app, t, trophies) {
  const views = trophies.map(tr => trophyView(tr, t)).sort(byShowing);
  if ( !views.some(v => v.id === app.selected.chronicle) ) app.selected.chronicle = views[0]?.id ?? null;
  const rows = views.map(v => ({
    ...v,
    selected: v.id === app.selected.chronicle,
    sub: v.isEarned ? (v.each ? v.earned.map(e => e.name).join(", ") : v.earned[0].dateLabel) : (v.progress?.label ?? v.description)
  }));
  const chosen = trophies.find(tr => tr.id === app.selected.chronicle);
  return { rows, empty: !rows.length, trophy: chosen ? detail(chosen, t) : null };
}

/** The chosen trophy's page: who earned it and when, how far along each character is, and for the GM what unlocks it. */
function detail(trophy, t) {
  const view = trophyView(trophy, t);
  const isGM = game.user.isGM;
  let characters = [];
  if ( view.each ) {
    const people = new Map(partyMembers().map(a => [a.uuid, { uuid: a.uuid, name: a.name, img: a.img }]));
    for ( const e of view.earned ) if ( !people.has(e.uuid) ) people.set(e.uuid, { uuid: e.uuid, name: e.name, img: e.img });
    characters = [...people.values()].map(person => {
      const has = view.earned.find(e => e.uuid === person.uuid);
      let progress = null;
      if ( !has && (trophy.rule !== "manual") ) {
        const p = progressOf(trophy, t, person.uuid);
        progress = { percent: p.percent, label: `${fmt(p.value)} / ${fmt(p.target)}` };
      }
      return { ...person, earned: !!has, dateLabel: has?.dateLabel ?? "", session: has?.session ?? null, progress };
    });
  }
  return {
    ...view,
    characters,
    party: !view.each ? view.earned[0] ?? null : null,
    rule: isGM ? ruleText(trophy) : "",
    canAward: isGM && !view.off && (!view.isEarned || view.each)
  };
}

/** What unlocks a trophy, for the GM: "Foes slain: 25", "Foes of one kind slain: 10 (Undead)". */
function ruleText(trophy) {
  const rule = loc(`Trophies.Rules.${trophy.rule}`);
  let text = rule;
  if ( trophy.rule === "standing" ) {
    const tier = STANDING_TIERS.find(s => s.id === trophy.param)?.id ?? "revered";
    text = `${rule}: ${loc(`Factions.Tiers.${tier}`)}`;
  }
  else if ( trophy.rule === "killsOf" ) text = `${rule}: ${fmt(trophy.count ?? 0)} (${kindLabel(trophy.param)})`;
  else if ( trophy.rule !== "manual" ) text = `${rule}: ${fmt(trophy.count ?? 0)}`;
  return isEach(trophy) ? `${text} · ${loc("Trophies.EachShort")}` : text;
}

/** Ask the GM which characters earn a trophy each character can earn. Resolves with their uuids. */
async function pickCharacters(trophy) {
  const have = new Set((trophy.earned ?? []).map(e => e.uuid));
  const people = partyMembers().filter(a => !have.has(a.uuid));
  if ( !people.length ) {
    ui.notifications.info(loc("Trophies.AllHaveIt"));
    return [];
  }
  const esc = foundry.utils.escapeHTML;
  const boxes = people.map(a => `<label class="wws-toggle"><input type="checkbox" name="uuid" value="${esc(a.uuid)}" checked>
    <span>${esc(a.name)}</span></label>`).join("");
  return foundry.applications.api.DialogV2.prompt({
    window: { title: loc("Trophies.Award"), icon: "fa-solid fa-trophy" },
    classes: ["wws", "wws-dialog"],
    content: `<p>${esc(loc("Trophies.AwardTo", { name: trophy.name ?? "" }))}</p><div class="wws-award-list">${boxes}</div>`,
    ok: {
      label: loc("Trophies.Award"),
      icon: "fa-solid fa-trophy",
      callback: (event, button) => Array.from(button.form.querySelectorAll("input[name=uuid]:checked"), el => el.value)
    },
    rejectClose: false,
    modal: true
  });
}

/* -------------------------------------------- */
/*  Records                                     */
/* -------------------------------------------- */

function recordsPage(t, trophies, earned) {
  const stat = (key, icon, value, sub="") => ({ key, icon, value, sub, label: loc(`Chronicle.Stats.${key}`) });
  const last = t.sessionLog.at(-1);
  const headline = [
    stat("sessions", "fa-solid fa-fire", fmt(t.sessions), last ? loc("Chronicle.LastPlayed", { date: formatDate(last.at) }) : ""),
    stat("days", "fa-solid fa-sun", fmt(t.days), loc("Chronicle.Since", { date: worldDate(startOfDay(t.began)) })),
    stat("kills", "fa-solid fa-skull", fmt(t.kills)),
    stat("gold", "fa-solid fa-coins", fmt(Math.floor(t.gold)), loc("Chronicle.GoldPieces")),
    stat("places", "fa-solid fa-map-location-dot", fmt(t.places))
  ];
  const minor = [
    stat("battles", "fa-solid fa-shield-halved", fmt(t.battles)),
    stat("quests", "fa-solid fa-scroll", fmt(t.quests)),
    stat("creatures", "fa-solid fa-paw", fmt(t.creatures)),
    stat("crits", "fa-solid fa-dice-d20", fmt(t.crits)),
    stat("fumbles", "fa-solid fa-face-dizzy", fmt(t.fumbles)),
    stat("trophies", "fa-solid fa-trophy", `${earned} / ${trophies.length}`)
  ];

  const sessions = t.sessionLog.map((s, i) => ({
    number: t.sessions - (t.sessionLog.length - 1 - i),
    date: formatDate(s.at),
    world: worldDate(s.time ?? 0)
  })).filter(s => s.number > 0).reverse().slice(0, SESSIONS_SHOWN);

  const places = [...t.placeList].sort((a, b) => (b.time ?? -Infinity) - (a.time ?? -Infinity)).slice(0, PLACES_SHOWN)
    .map(p => ({ name: p.name, dateLabel: Number.isFinite(p.time) ? worldDate(p.time) : "" }));

  return {
    headline,
    minor,
    slain: t.slain.filter(s => game.user.isGM || s.visible).slice(0, SLAIN_SHOWN),
    party: partyMembers().map(a => ({
      uuid: a.uuid,
      name: a.name,
      img: a.img,
      crits: fmt(t.rolls[a.uuid]?.crits ?? 0),
      fumbles: fmt(t.rolls[a.uuid]?.fumbles ?? 0),
      trophies: trophies.filter(tr => tr.earned?.some(e => e.uuid === a.uuid)).length
    })),
    places,
    morePlaces: Math.max(0, t.placeList.length - PLACES_SHOWN),
    sessions,
    earlier: EARLIER_COUNTS.some(key => Number(t.earlier?.[key]) > 0)
  };
}
