import { PATH, L, difficultyOf } from "../config.mjs";
import * as store from "../store.mjs";
import { openEditor } from "../editor.mjs";
import { handle, request } from "../socket.mjs";
import { enrich, loc, confirmDelete, viewerNames, worldDate, worldNow } from "../helpers.mjs";

/*
 * The notice board: contracts and bounties pinned up under their regions. The GM posts them and says who's asking,
 * how dangerous the job is and what it pays. A player takes one, and the GM's client turns it into a quest.
 */

/** The region filter that shows every notice. */
const ALL = "all";

export default {
  id: "notices",
  template: `${PATH}/templates/sections/notices.hbs`,

  async prepare(app) {
    const isGM = game.user.isGM;
    const regions = store.noticeRegions();
    const regionName = new Map(regions.map(r => [r.id, r.name]));
    const region = regionName.has(app.filters.notices) ? app.filters.notices : ALL;
    const all = store.all("notices").filter(n => store.isVisible("notices", n)).sort((a, b) => (b.sentAt ?? 0) - (a.sentAt ?? 0));
    const shown = all.filter(n => (region === ALL) || (n.region === region));
    if ( !shown.some(n => n.id === app.selected.notices) ) app.selected.notices = shown[0]?.id ?? null;
    const notice = shown.find(n => n.id === app.selected.notices);
    const changes = changesIn(all);

    return {
      isGM,
      canManage: isGM,
      regions: [
        { id: ALL, name: loc("Notices.AllRegions"), count: all.length, active: region === ALL },
        ...regions.map(r => ({ id: r.id, name: r.name, count: all.filter(n => n.region === r.id).length, active: r.id === region }))
      ],
      notices: shown.map(n => ({ ...cardOf(n, regionName, changes), selected: n.id === app.selected.notices })),
      empty: !shown.length,
      notice: notice ? await detail(notice, regionName) : null
    };
  },

  actions: {
    noticeRegion(event, target) {
      this.filters.notices = target.dataset.region;
      this.render();
    },

    noticeSelect(event, target) {
      this.selected.notices = target.dataset.id;
      this.render();
    },

    noticeNew() {
      if ( !game.user.isGM ) return;
      const current = store.noticeRegions().some(r => r.id === this.filters.notices) ? this.filters.notices : "";
      openEditor("notice", {
        entry: { region: current, difficulty: "easy", visible: false },
        title: loc("Notices.New"),
        onSave: async data => {
          this.selected.notices = await store.create("notices", { ...data, sentAt: worldNow() });
        }
      });
    },

    noticeEdit(event, target) {
      const notice = store.get("notices", target.dataset.id);
      if ( !notice ) return;
      openEditor("notice", {
        entry: notice,
        title: loc("Notices.Edit", { name: notice.title || loc("Untitled") }),
        onSave: data => store.update("notices", notice.id, data)
      });
    },

    async noticeDelete(event, target) {
      const notice = store.get("notices", target.dataset.id);
      if ( notice && await confirmDelete(notice.title) ) await store.remove("notices", notice.id);
    },

    noticeVisible(event, target) {
      const notice = store.get("notices", target.dataset.id);
      if ( notice ) return store.update("notices", notice.id, { visible: !notice.visible });
    },

    /** Take a notice down, or put it back up, while nobody has taken it. */
    noticeClose(event, target) {
      const notice = store.get("notices", target.dataset.id);
      if ( !notice || notice.taker || (notice.status === "taken") ) return;
      return store.update("notices", notice.id, { status: notice.status === "closed" ? "open" : "closed" });
    },

    noticeRegions() {
      openEditor("regions", {
        entry: { id: "regions", regions: store.noticeRegions() },
        title: loc("Notices.Regions"),
        onSave: data => store.setNoticeRegions(data.regions ?? [])
      });
    },

    /** A player takes the notice: the GM's client makes it a quest and marks the notice taken. */
    noticeTake(event, target) {
      request("takeNotice", { id: target.dataset.id })
        .then(() => ui.notifications.info(loc("Notices.Taken")))
        .catch(err => ui.notifications.error(err.message));
    }
  }
};

/* -------------------------------------------- */

/** The GM's side of taking a notice: it becomes a quest, and the notice is marked as taken by that player. */
export async function takeNotice({ id }, user) {
  const notice = store.get("notices", id);
  if ( !notice || (statusOf(notice) !== "open") ) throw new Error(loc("Notices.NotOpen"));
  const questId = await store.create("quests", {
    title: notice.title || loc("Untitled"),
    kind: store.questGroups()[0]?.id,
    status: "active",
    visible: true,
    viewers: notice.viewers ?? [],
    giverName: notice.requester ?? "",
    faction: notice.faction ?? "",
    description: notice.body ?? "",
    objectives: [],
    log: [],
    rewards: notice.reward ? [{ id: foundry.utils.randomID(), name: notice.reward, qty: 1 }] : []
  });
  await store.update("notices", id, { status: "taken", taker: user.id, quest: questId });
  return { questId };
}

/** Make the board's relay for taking notices work on the GM's client. */
export function registerNoticeBoard() {
  handle("takeNotice", takeNotice);
}

/* -------------------------------------------- */

function isExpired(n) {
  return !!n.expires && (worldNow() >= n.expires);
}

/** Open, taken, expired or taken down: what a player sees on the notice. */
function statusOf(n) {
  if ( n.status === "closed" ) return "closed";
  if ( n.taker || (n.status === "taken") ) return "taken";
  if ( isExpired(n) ) return "expired";
  return "open";
}

/** A small, stable tilt for each notice, so the board looks pinned up by hand rather than in a grid. */
function hashOf(id) {
  return [...String(id)].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
}

function tiltOf(id) {
  return hashOf(id) % 7 - 3;
}

/** Which of the two slip parchments a notice is pinned on. */
function paperOf(id) {
  return hashOf(id) % 2 ? "b" : "a";
}

/** The status each notice had when the board last drew it, and whether the board has drawn any yet. */
const drawn = new Map();
let primed = false;

/** Notices pinned up, or changed, since the board last drew them: "arrived" or "updated", by id. */
function changesIn(notices) {
  const changes = new Map();
  for ( const n of notices ) {
    const status = statusOf(n);
    const before = drawn.get(n.id);
    if ( primed && (before === undefined) ) changes.set(n.id, "arrived");
    else if ( primed && (before !== status) ) changes.set(n.id, "updated");
    drawn.set(n.id, status);
  }
  primed = true;
  return changes;
}

function cardOf(n, regionName, changes) {
  const diff = difficultyOf(n.difficulty);
  const status = statusOf(n);
  return {
    id: n.id,
    title: n.title || loc("Untitled"),
    reward: n.reward ?? "",
    region: regionName.get(n.region) ?? "",
    diffColor: diff.color,
    diffLabel: loc(`Notices.Difficulty.${diff.id}`),
    tilt: tiltOf(n.id),
    paper: paperOf(n.id),
    change: changes.get(n.id) ?? "",
    status,
    statusLabel: loc(`Notices.Status.${status}`),
    hidden: !n.visible
  };
}

async function detail(n, regionName) {
  const isGM = game.user.isGM;
  const status = statusOf(n);
  const diff = difficultyOf(n.difficulty);
  const faction = store.get("factions", n.faction);
  return {
    id: n.id,
    title: n.title || loc("Untitled"),
    reward: n.reward ?? "",
    requester: n.requester ?? "",
    faction: (faction && store.isVisible("factions", faction)) ? faction.name : "",
    region: regionName.get(n.region) ?? "",
    diffColor: diff.color,
    diffLabel: loc(`Notices.Difficulty.${diff.id}`),
    status,
    statusLabel: loc(`Notices.Status.${status}`),
    isClosed: status === "closed",
    takenBy: n.taker ? (game.users.get(n.taker)?.name ?? "") : "",
    postedLabel: n.sentAt ? worldDate(n.sentAt) : "",
    endsLabel: n.expires
      ? (isExpired(n) ? loc("Notices.Expired") : loc("Notices.Until", { date: worldDate(n.expires) }))
      : loc("Notices.NoEnd"),
    canTake: !isGM && (status === "open"),
    hidden: !n.visible,
    viewers: isGM ? viewerNames(n) : "",
    body: await enrich(n.body ?? "")
  };
}
