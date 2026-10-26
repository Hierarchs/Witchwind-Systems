import { PATH, L, QUEST_STATUSES } from "../config.mjs";
import * as store from "../store.mjs";
import { openEditor } from "../editor.mjs";
import { enrich, asHTML, plainText, formatDate, loc, confirmDelete, openSheet, showToPlayers, viewerNames, byTitle } from "../helpers.mjs";

/** The list filters across the top of the left page, as in Oblivion: current, completed, failed, recent updates. */
const FILTERS = ["active", "completed", "failed", "updates"];

/** How many entries Recent Updates shows. */
const UPDATES_SHOWN = 30;

/** The drag data type for reordering quests, so other drops onto the list are ignored. */
const DRAG_TYPE = "application/x-witchwind-quest";

export default {
  id: "quests",
  template: `${PATH}/templates/sections/quests.hbs`,

  async prepare(app) {
    const tracked = store.tracked();
    const quests = store.all("quests").filter(q => store.isVisible("quests", q));
    const filter = FILTERS.includes(app.filters.quests) ? app.filters.quests : "active";
    const counts = Object.fromEntries(QUEST_STATUSES.map(s => [s, quests.filter(q => statusOf(q) === s).length]));
    const filters = FILTERS.map(id => ({ id, label: `${L}.Quests.Filters.${id}`, count: counts[id], active: id === filter }));
    const groups = store.questGroups();

    let lists = [];
    let updates = [];
    if ( filter === "updates" ) updates = recentUpdates(quests);
    else lists = groupedList(quests.filter(q => statusOf(q) === filter), groups, tracked, app, filter === "active");

    // Keep the chosen quest while it's listed; otherwise show the first one.
    const listed = filter === "updates" ? updates.map(u => u.quest) : lists.flatMap(g => g.quests.map(q => q.id));
    if ( !listed.includes(app.selected.quests) ) app.selected.quests = listed[0] ?? null;
    for ( const group of lists ) for ( const q of group.quests ) q.selected = q.id === app.selected.quests;
    for ( const u of updates ) u.selected = u.quest === app.selected.quests;

    const quest = quests.find(q => q.id === app.selected.quests);
    return {
      filters,
      groups: lists,
      updates,
      isUpdates: filter === "updates",
      empty: !listed.length,
      emptyLabel: `${L}.Quests.Empty.${filter}`,
      canCreate: game.user.isGM,
      quest: quest ? await detail(quest, quests, groups, tracked, app) : null
    };
  },

  /** GMs drag quests to reorder them, onto another quest to sit before it, or onto a group's heading to join it. */
  onRender(app, element) {
    if ( !game.user.isGM ) return;
    const list = element.querySelector(".wws-quests .wws-list-scroll");
    if ( !list ) return;
    list.addEventListener("dragstart", event => {
      const row = event.target.closest("[data-drag-quest]");
      if ( !row ) return;
      event.dataTransfer.setData(DRAG_TYPE, row.dataset.dragQuest);
      event.dataTransfer.effectAllowed = "move";
      row.classList.add("dragging");
    });
    list.addEventListener("dragend", () => list.querySelectorAll(".dragging, .wws-drop-before, .wws-drop-into")
      .forEach(el => el.classList.remove("dragging", "wws-drop-before", "wws-drop-into")));
    list.addEventListener("dragover", event => {
      if ( !event.dataTransfer.types.includes(DRAG_TYPE) ) return;
      const target = event.target.closest("[data-drop-quest], [data-drop-group]");
      if ( !target ) return;
      event.preventDefault();
      list.querySelectorAll(".wws-drop-before, .wws-drop-into").forEach(el => el.classList.remove("wws-drop-before", "wws-drop-into"));
      target.classList.add(target.dataset.dropGroup ? "wws-drop-into" : "wws-drop-before");
    });
    list.addEventListener("drop", event => {
      const id = event.dataTransfer.getData(DRAG_TYPE);
      const target = event.target.closest("[data-drop-quest], [data-drop-group]");
      if ( !id || !target ) return;
      event.preventDefault();
      if ( target.dataset.dropGroup ) moveToGroup(id, target.dataset.dropGroup);
      else moveBefore(id, target.dataset.dropQuest);
    });
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

    /** Fold a quest's steps away under it, or show them again. */
    questCollapse(event, target) {
      const collapsed = this.collapsed ??= new Set();
      const id = target.dataset.id;
      if ( collapsed.has(id) ) {
        collapsed.delete(id);
        this.expandedQuest = id;
        this.nextAnimation = "steps";
      }
      else collapsed.add(id);
      this.render();
    },

    questNew(event, target) {
      const parent = target.dataset.parent ? store.get("quests", target.dataset.parent) : null;
      openEditor("quest", {
        entry: parent ? { parent: parent.id, kind: parent.kind, status: "active" } : {},
        title: loc("Quests.New"),
        onSave: async data => {
          const siblings = store.all("quests").filter(q => (q.kind === data.kind) && ((q.parent || "") === (data.parent || "")));
          data.sort = Math.max(0, ...siblings.map(q => q.sort ?? 0)) + 1;
          const id = await store.create("quests", data);
          this.selected.quests = id;
          this.filters.quests = data.status;
        }
      });
    },

    questGroups() {
      openEditor("groups", {
        entry: { id: "groups", groups: store.questGroups() },
        title: loc("Quests.EditGroups"),
        onSave: data => store.setQuestGroups(data.groups)
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
      if ( !quest || !await confirmDelete(quest.title) ) return;
      // Its steps move up to its own parent rather than vanishing with it.
      const steps = store.all("quests").filter(q => q.parent === quest.id);
      if ( steps.length ) await store.updateMany("quests", Object.fromEntries(steps.map(q => [q.id, { parent: quest.parent ?? "" }])));
      await store.remove("quests", quest.id);
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

    questNote(event, target) {
      this.open("journal", target.dataset.note);
    },

    questShow(event, target) {
      return showToPlayers("quests", target.dataset.id);
    }
  }
};

/* -------------------------------------------- */

const statusOf = q => q.status ?? "active";
const bySort = (a, b) => ((a.sort ?? 0) - (b.sort ?? 0)) || byTitle(a, b);

/** The group a quest belongs to: its own if that group still exists, otherwise the first. */
function groupOf(quest, groups) {
  return groups.some(g => g.id === quest.kind) ? quest.kind : groups[0]?.id;
}

export function groupName(group) {
  return group?.name || game.i18n.localize(`${L}.Quests.Kinds.${group?.id}`);
}

/**
 * Lists for each group, with each quest's steps folded under it. A step whose parent isn't in this list (another
 * status, or hidden) stands on its own.
 */
function groupedList(shown, groups, tracked, app, showEmpty) {
  const ids = new Set(shown.map(q => q.id));
  const isRoot = q => !q.parent || (q.parent === q.id) || !ids.has(q.parent);
  const collapsed = app.collapsed ?? new Set();
  const rows = (quest, depth, seen) => {
    if ( seen.has(quest.id) ) return [];
    seen.add(quest.id);
    const steps = shown.filter(q => (q.parent === quest.id) && (q.id !== quest.id)).sort(bySort);
    const row = {
      id: quest.id,
      title: quest.title || loc("Untitled"),
      location: quest.location,
      tracked: tracked.includes(quest.id),
      hidden: !quest.visible,
      restricted: !!quest.viewers?.length,
      depth,
      hasSteps: steps.length > 0,
      collapsed: collapsed.has(quest.id),
      appearing: !!quest.parent && (quest.parent === app.expandedQuest),
      stepCount: steps.length,
      stepsDone: steps.filter(s => statusOf(s) === "completed").length
    };
    if ( row.collapsed ) return [row];
    return [row, ...steps.flatMap(s => rows(s, depth + 1, seen))];
  };
  return groups.map(group => {
    const seen = new Set();
    const roots = shown.filter(q => isRoot(q) && (groupOf(q, groups) === group.id)).sort(bySort);
    return { id: group.id, label: groupName(group), quests: roots.flatMap(q => rows(q, 0, seen)) };
  // Empty groups stay visible to the GM on the Current list, so there's a heading to drag quests into.
  }).filter(g => g.quests.length || (showEmpty && game.user.isGM));
}

async function detail(quest, quests, groups, tracked, app) {
  const isGM = game.user.isGM;
  const status = statusOf(quest);

  // Compared with the last time this quest was shown, so a newly ticked objective or a new status can play once.
  const before = app.questShown?.id === quest.id ? app.questShown : null;
  app.questShown = { id: quest.id, status, done: new Set((quest.objectives ?? []).filter(o => o.done).map(o => o.id)) };

  const objectives = (quest.objectives ?? []).filter(o => isGM || !o.hidden).map(o => ({
    ...o,
    state: o.failed ? "failed" : (o.done ? "done" : "open"),
    fresh: !!before && o.done && !before.done.has(o.id)
  }));

  const log = await Promise.all((quest.log ?? []).filter(e => isGM || !e.hidden)
    .sort((a, b) => (b.date ?? 0) - (a.date ?? 0))
    .map(async e => ({ ...e, html: await enrich(asHTML(e.text)), dateLabel: formatDate(e.date) })));

  const faction = store.get("factions", quest.faction);
  const pin = store.all("pins").find(p => (p.quest === quest.id) && store.isVisible("pins", p)
    && store.isVisible("maps", store.get("maps", p.map)));
  const parent = quests.find(q => (q.id === quest.parent) && (q.id !== quest.id));
  const steps = quests.filter(q => (q.parent === quest.id) && (q.id !== quest.id)).sort(bySort)
    .map(q => ({ id: q.id, title: q.title || loc("Untitled"), status: statusOf(q) }));
  const notes = store.all("notes").filter(n => (n.quest === quest.id) && store.isVisible("notes", n))
    .map(n => ({ id: n.id, title: n.title || loc("Untitled") }));

  return {
    ...quest,
    title: quest.title || loc("Untitled"),
    status,
    statusLabel: `${L}.Quests.Status.${status}`,
    statusChanged: !!before && (before.status !== status),
    kindLabel: groupName(groups.find(g => g.id === groupOf(quest, groups))),
    isActive: status === "active",
    isTracked: tracked.includes(quest.id),
    hidden: !quest.visible,
    viewers: isGM ? viewerNames(quest) : "",
    description: await enrich(quest.description),
    gmNotes: isGM ? await enrich(quest.gmNotes) : "",
    objectives,
    hasObjectives: objectives.length > 0,
    log,
    rewards: quest.rewards ?? [],
    giver: (quest.giverName || quest.giverImg) ? { name: quest.giverName, img: quest.giverImg, uuid: quest.giverUuid } : null,
    faction: store.isVisible("factions", faction) ? { id: faction.id, name: faction.name, img: faction.img } : null,
    pin: pin ? pin.id : null,
    parent: parent ? { id: parent.id, title: parent.title || loc("Untitled") } : null,
    steps,
    notes
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

/* -------------------------------------------- */
/*  Reordering                                  */
/* -------------------------------------------- */

/** Is one quest somewhere among another's steps? Used so a quest is never moved under itself. */
function isWithin(id, ancestorId, all) {
  const seen = new Set();
  for ( let q = all.find(x => x.id === id); q?.parent && !seen.has(q.id); q = all.find(x => x.id === q.parent) ) {
    seen.add(q.id);
    if ( q.parent === ancestorId ) return true;
  }
  return false;
}

/** Put a quest just before another, alongside it: same group, same parent. Its siblings are renumbered in order. */
function moveBefore(id, targetId) {
  if ( id === targetId ) return;
  const all = store.all("quests");
  const target = all.find(q => q.id === targetId);
  if ( !target || isWithin(targetId, id, all) ) return;
  const groups = store.questGroups();
  const kind = groupOf(target, groups);
  const parent = target.parent || "";
  const siblings = all.filter(q => (q.id !== id) && (groupOf(q, groups) === kind) && ((q.parent || "") === parent)).sort(bySort);
  siblings.splice(siblings.findIndex(q => q.id === targetId), 0, { id });
  const changes = Object.fromEntries(siblings.map((q, i) => [q.id, { sort: i + 1 }]));
  Object.assign(changes[id], { kind, parent });
  return store.updateMany("quests", changes);
}

/** Move a quest to the end of a group, out of any chain. */
function moveToGroup(id, groupId) {
  const all = store.all("quests");
  const last = Math.max(0, ...all.filter(q => (q.kind === groupId) && !q.parent).map(q => q.sort ?? 0));
  return store.update("quests", id, { kind: groupId, parent: "", sort: last + 1 });
}
