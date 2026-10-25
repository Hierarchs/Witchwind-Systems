import { PATH, L, QUEST_KINDS, QUEST_STATUSES } from "../config.mjs";
import * as store from "../store.mjs";
import { openEditor } from "../editor.mjs";
import { enrich, asHTML, plainText, formatDate, loc, confirmDelete, openSheet, showToPlayers, byTitle } from "../helpers.mjs";

/** The list filters across the top of the left page, as in Oblivion: current, completed, failed, recent updates. */
const FILTERS = ["active", "completed", "failed", "updates"];

/** How many entries Recent Updates shows. */
const UPDATES_SHOWN = 30;

export default {
  id: "quests",
  template: `${PATH}/templates/sections/quests.hbs`,

  async prepare(app) {
    const tracked = store.tracked();
    const quests = store.all("quests").filter(q => store.isVisible("quests", q));
    const filter = FILTERS.includes(app.filters.quests) ? app.filters.quests : "active";
    const counts = Object.fromEntries(QUEST_STATUSES.map(s => [s, quests.filter(q => statusOf(q) === s).length]));
    const filters = FILTERS.map(id => ({ id, label: `${L}.Quests.Filters.${id}`, count: counts[id], active: id === filter }));

    let groups = [];
    let updates = [];
    if ( filter === "updates" ) updates = recentUpdates(quests);
    else {
      const shown = quests.filter(q => statusOf(q) === filter);
      groups = QUEST_KINDS.map(kind => ({
        kind,
        label: `${L}.Quests.Kinds.${kind}`,
        quests: shown.filter(q => kindOf(q) === kind).sort(byTitle).map(q => ({
          id: q.id,
          title: q.title || loc("Untitled"),
          location: q.location,
          tracked: tracked.includes(q.id),
          hidden: !q.visible,
          selected: q.id === app.selected.quests
        }))
      })).filter(g => g.quests.length);
    }

    // Keep the chosen quest while it's listed; otherwise show the first one.
    const listed = filter === "updates" ? updates.map(u => u.quest) : groups.flatMap(g => g.quests.map(q => q.id));
    if ( !listed.includes(app.selected.quests) ) app.selected.quests = listed[0] ?? null;
    for ( const group of groups ) for ( const q of group.quests ) q.selected = q.id === app.selected.quests;
    for ( const u of updates ) u.selected = u.quest === app.selected.quests;

    const quest = quests.find(q => q.id === app.selected.quests);
    return {
      filters,
      groups,
      updates,
      isUpdates: filter === "updates",
      empty: !listed.length,
      emptyLabel: `${L}.Quests.Empty.${filter}`,
      canCreate: game.user.isGM,
      quest: quest ? await detail(quest, tracked) : null
    };
  },

  actions: {
    questFilter(event, target) {
      this.filters.quests = target.dataset.filter;
      this.render();
    },

    questSelect(event, target) {
      this.selected.quests = target.dataset.id;
      this.render();
    },

    questNew() {
      openEditor("quest", {
        title: loc("Quests.New"),
        onSave: async data => {
          const id = await store.create("quests", data);
          this.selected.quests = id;
          this.filters.quests = data.status;
        }
      });
    },

    questEdit(event, target) {
      const quest = store.get("quests", target.dataset.id);
      if ( !quest ) return;
      openEditor("quest", {
        entry: quest,
        title: loc("Quests.Edit", { name: quest.title }),
        onSave: data => store.update("quests", quest.id, data)
      });
    },

    async questDelete(event, target) {
      const quest = store.get("quests", target.dataset.id);
      if ( quest && await confirmDelete(quest.title) ) await store.remove("quests", quest.id);
    },

    questTrack(event, target) {
      return store.toggleTracked(target.dataset.id);
    },

    questStatus(event, target) {
      const status = target.dataset.status;
      this.filters.quests = status;
      return store.update("quests", target.dataset.id, { status });
    },

    questReveal(event, target) {
      const quest = store.get("quests", target.dataset.id);
      if ( quest ) return store.update("quests", quest.id, { visible: !quest.visible });
    },

    /** Tick an objective off, or untick it. */
    questObjective(event, target) {
      if ( !game.user.isGM ) return;
      return changeRow(target, "objectives", o => {
        o.done = !o.done;
        if ( o.done ) o.failed = false;
      });
    },

    questObjectiveFail(event, target) {
      return changeRow(target, "objectives", o => {
        o.failed = !o.failed;
        if ( o.failed ) o.done = false;
      });
    },

    questObjectiveHide(event, target) {
      return changeRow(target, "objectives", o => { o.hidden = !o.hidden; });
    },

    questEntryHide(event, target) {
      return changeRow(target, "log", e => { e.hidden = !e.hidden; });
    },

    /** Add a dated entry to the quest's journal, newest first, as Elder Scrolls quests grow as they're played. */
    questEntry(event, target) {
      const quest = store.get("quests", target.dataset.id);
      if ( !quest ) return;
      openEditor("entry", {
        entry: { id: `${quest.id}-entry` },
        title: loc("Quests.AddEntryTo", { name: quest.title }),
        onSave: ({ text, hidden }) => {
          if ( !text ) return;
          const fresh = store.get("quests", quest.id);
          const log = [...(fresh?.log ?? []), { id: foundry.utils.randomID(), text, hidden, date: Date.now() }];
          return store.update("quests", quest.id, { log });
        }
      });
    },

    questGiver(event, target) {
      return openSheet(target.dataset.uuid);
    },

    questReward(event, target) {
      return openSheet(target.dataset.uuid);
    },

    questMap(event, target) {
      const pin = store.get("pins", target.dataset.pin);
      if ( pin ) this.showPin(pin);
    },

    questFaction(event, target) {
      this.open("factions", target.dataset.faction);
    },

    questShow(event, target) {
      return showToPlayers("quests", target.dataset.id);
    }
  }
};

/* -------------------------------------------- */

const statusOf = q => q.status ?? "active";
const kindOf = q => q.kind ?? "side";

async function detail(quest, tracked) {
  const isGM = game.user.isGM;
  const status = statusOf(quest);

  const objectives = (quest.objectives ?? []).filter(o => isGM || !o.hidden).map(o => ({
    ...o,
    state: o.failed ? "failed" : (o.done ? "done" : "open")
  }));

  const log = await Promise.all((quest.log ?? []).filter(e => isGM || !e.hidden)
    .sort((a, b) => (b.date ?? 0) - (a.date ?? 0))
    .map(async e => ({ ...e, html: await enrich(asHTML(e.text)), dateLabel: formatDate(e.date) })));

  const faction = store.get("factions", quest.faction);
  const pin = store.all("pins").find(p => (p.quest === quest.id) && store.isVisible("pins", p)
    && store.isVisible("maps", store.get("maps", p.map)));

  return {
    ...quest,
    title: quest.title || loc("Untitled"),
    status,
    statusLabel: `${L}.Quests.Status.${status}`,
    kindLabel: `${L}.Quests.Kinds.${kindOf(quest)}`,
    isActive: status === "active",
    isTracked: tracked.includes(quest.id),
    hidden: !quest.visible,
    description: await enrich(quest.description),
    gmNotes: isGM ? await enrich(quest.gmNotes) : "",
    objectives,
    hasObjectives: objectives.length > 0,
    log,
    rewards: quest.rewards ?? [],
    giver: (quest.giverName || quest.giverImg) ? { name: quest.giverName, img: quest.giverImg, uuid: quest.giverUuid } : null,
    faction: store.isVisible("factions", faction) ? { id: faction.id, name: faction.name, img: faction.img } : null,
    pin: pin ? pin.id : null
  };
}

/** Every revealed journal entry of every quest, newest first, as Oblivion's Recent Updates. */
function recentUpdates(quests) {
  const isGM = game.user.isGM;
  const updates = [];
  for ( const quest of quests ) {
    for ( const entry of quest.log ?? [] ) {
      if ( entry.hidden && !isGM ) continue;
      updates.push({
        quest: quest.id,
        title: quest.title || loc("Untitled"),
        text: plainText(entry.text),
        date: entry.date ?? 0,
        dateLabel: formatDate(entry.date),
        status: statusOf(quest)
      });
    }
  }
  return updates.sort((a, b) => b.date - a.date).slice(0, UPDATES_SHOWN);
}

/** Change one row of a quest's objectives or log, found by the clicked element's data-id and data-row. */
function changeRow(target, list, change) {
  if ( !game.user.isGM ) return;
  const quest = store.get("quests", target.dataset.id);
  const row = quest?.[list]?.find(r => r.id === target.dataset.row);
  if ( !row ) return;
  change(row);
  return store.update("quests", quest.id, { [list]: quest[list] });
}
