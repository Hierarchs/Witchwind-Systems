import { PATH, L, DEFAULT_RANKS, standingTier } from "../config.mjs";
import * as store from "../store.mjs";
import { openEditor } from "../editor.mjs";
import { enrich, loc, confirmDelete, openSheet, showToPlayers, docSync, viewerNames, byName, byTitle } from "../helpers.mjs";

/** How far one click of the standing arrows moves it. */
const STANDING_STEP = 5;

export default {
  id: "factions",
  template: `${PATH}/templates/sections/factions.hbs`,

  async prepare(app) {
    const factions = store.all("factions").filter(f => store.isVisible("factions", f)).sort(byName);
    if ( !factions.some(f => f.id === app.selected.factions) ) app.selected.factions = factions[0]?.id ?? null;

    const rows = factions.map(f => {
      const tier = standingTier(f.standing ?? 0);
      const yours = members(f).filter(m => m.yours).sort((a, b) => b.rank - a.rank)[0];
      return {
        id: f.id,
        name: f.name || loc("Untitled"),
        img: f.img,
        color: f.color,
        tier,
        tierLabel: `${L}.Factions.Tiers.${tier}`,
        yourRank: yours?.rankName,
        hidden: !f.visible,
        selected: f.id === app.selected.factions
      };
    });

    const faction = factions.find(f => f.id === app.selected.factions);
    return {
      rows,
      empty: !rows.length,
      canCreate: game.user.isGM,
      faction: faction ? await detail(faction, app) : null
    };
  },

  /** A GM can drop actors onto a faction's page to make them members. */
  onRender(app, element) {
    const page = element.querySelector(".wws-faction-page");
    if ( !page || !game.user.isGM ) return;
    page.addEventListener("dragover", event => {
      event.preventDefault();
      page.classList.add("wws-drop-over");
    });
    page.addEventListener("dragleave", event => {
      if ( !page.contains(event.relatedTarget) ) page.classList.remove("wws-drop-over");
    });
    page.addEventListener("drop", async event => {
      page.classList.remove("wws-drop-over");
      const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
      if ( data?.type !== "Actor" ) return;
      event.preventDefault();
      const actor = await foundry.utils.fromUuid(data.uuid);
      const faction = store.get("factions", page.dataset.id);
      if ( !actor || !faction ) return;
      const list = faction.members ?? [];
      if ( list.some(m => m.uuid === actor.uuid) ) return;
      list.push({ uuid: actor.uuid, name: actor.name, img: actor.img, rank: 0 });
      await store.update("factions", faction.id, { members: list });
    });
  },

  actions: {
    factionSelect(event, target) {
      this.selected.factions = target.dataset.id;
      this.render();
    },

    factionNew() {
      openEditor("faction", {
        entry: { ranks: [...DEFAULT_RANKS], standing: 0, color: "#c9a45c" },
        title: loc("Factions.New"),
        onSave: async data => {
          this.selected.factions = await store.create("factions", data);
        }
      });
    },

    factionEdit(event, target) {
      const faction = store.get("factions", target.dataset.id);
      if ( !faction ) return;
      openEditor("faction", {
        entry: faction,
        title: loc("Factions.Edit", { name: faction.name }),
        onSave: data => store.update("factions", faction.id, data)
      });
    },

    async factionDelete(event, target) {
      const faction = store.get("factions", target.dataset.id);
      if ( faction && await confirmDelete(faction.name) ) await store.remove("factions", faction.id);
    },

    factionReveal(event, target) {
      const faction = store.get("factions", target.dataset.id);
      if ( faction ) return store.update("factions", faction.id, { visible: !faction.visible });
    },

    factionStanding(event, target) {
      const faction = store.get("factions", target.dataset.id);
      if ( !faction ) return;
      const delta = Number(target.dataset.delta) * STANDING_STEP;
      const standing = Math.clamp((faction.standing ?? 0) + delta, -100, 100);
      return store.update("factions", faction.id, { standing });
    },

    /** Promote or demote a member one rank; promoting an outsider makes them a member at the lowest rank. */
    factionRank(event, target) {
      const faction = store.get("factions", target.dataset.id);
      const member = faction?.members?.find(m => m.uuid === target.dataset.uuid);
      if ( !member ) return;
      const top = ranksOf(faction).length - 1;
      member.rank = Math.clamp((member.rank ?? 0) + Number(target.dataset.delta), -1, top);
      return store.update("factions", faction.id, { members: faction.members });
    },

    /** Raise or lower one character's own standing, starting from the party's. */
    factionPersonal(event, target) {
      const faction = store.get("factions", target.dataset.id);
      const member = faction?.members?.find(m => m.uuid === target.dataset.uuid);
      if ( !member ) return;
      const from = Number.isFinite(member.standing) ? member.standing : (faction.standing ?? 0);
      member.standing = Math.clamp(from + (Number(target.dataset.delta) * STANDING_STEP), -100, 100);
      return store.update("factions", faction.id, { members: faction.members });
    },

    factionNote(event, target) {
      this.open("journal", target.dataset.note);
    },

    async factionMemberRemove(event, target) {
      const faction = store.get("factions", target.dataset.id);
      if ( !faction ) return;
      const members = (faction.members ?? []).filter(m => m.uuid !== target.dataset.uuid);
      return store.update("factions", faction.id, { members });
    },

    factionMember(event, target) {
      return openSheet(target.dataset.uuid);
    },

    factionGo(event, target) {
      this.selected.factions = target.dataset.faction;
      this.render();
    },

    factionQuest(event, target) {
      this.open("quests", target.dataset.quest);
    },

    factionShow(event, target) {
      return showToPlayers("factions", target.dataset.id);
    }
  }
};

/* -------------------------------------------- */

const ranksOf = f => (f.ranks?.length ? f.ranks : DEFAULT_RANKS);

/**
 * Characters the faction knows: members with a rank, or outsiders (rank -1) known only by their standing. Each has
 * their current name and picture, rank name, personal standing if they have one, and whether they're the viewer's.
 */
function members(faction) {
  const ranks = ranksOf(faction);
  return (faction.members ?? []).map(m => {
    const actor = docSync(m.uuid);
    const rank = (m.rank ?? 0) < 0 ? -1 : Math.min(m.rank ?? 0, ranks.length - 1);
    const personal = Number.isFinite(m.standing) ? Math.clamp(m.standing, -100, 100) : null;
    const standing = personal ?? Math.clamp(faction.standing ?? 0, -100, 100);
    return {
      uuid: m.uuid,
      name: actor?.name ?? m.name,
      img: actor?.img ?? m.img,
      rank,
      member: rank >= 0,
      rankName: rank >= 0 ? ranks[rank] : game.i18n.localize(`${L}.Factions.NotMember`),
      personal,
      standingLabel: standing > 0 ? `+${standing}` : String(standing),
      tier: standingTier(standing),
      tierLabel: `${L}.Factions.Tiers.${standingTier(standing)}`,
      yours: !game.user.isGM && !!actor?.isOwner
    };
  });
}

async function detail(faction, app) {
  const isGM = game.user.isGM;
  const ranks = ranksOf(faction);
  const list = members(faction);
  const standing = Math.clamp(faction.standing ?? 0, -100, 100);
  const tier = standingTier(standing);

  // Compared with the last time this faction was shown: the standing marker slides from where it was, and anyone
  // whose rank changed glows once.
  const before = app.factionShown?.id === faction.id ? app.factionShown : null;
  app.factionShown = { id: faction.id, standing, ranks: new Map(list.map(m => [m.uuid, m.rank])) };
  for ( const m of list ) m.moved = !!before && before.ranks.has(m.uuid) && (before.ranks.get(m.uuid) !== m.rank);
  const related = ids => (ids ?? []).map(id => store.get("factions", id))
    .filter(f => store.isVisible("factions", f)).map(f => ({ id: f.id, name: f.name, img: f.img }));
  const quests = store.all("quests").filter(q => (q.faction === faction.id) && store.isVisible("quests", q))
    .sort(byTitle).map(q => ({ id: q.id, title: q.title, status: q.status ?? "active" }));

  return {
    ...faction,
    name: faction.name || loc("Untitled"),
    hidden: !faction.visible,
    standing,
    standingLabel: standing > 0 ? `+${standing}` : String(standing),
    standingPercent: (standing + 100) / 2,
    standingFrom: (before && (before.standing !== standing)) ? (before.standing + 100) / 2 : null,
    tier,
    tierLabel: `${L}.Factions.Tiers.${tier}`,
    // Highest rank first, as a guild's ladder reads from the top.
    ranks: ranks.map((name, i) => ({
      index: i,
      number: i + 1,
      name,
      members: list.filter(m => m.rank === i),
      yours: list.some(m => m.yours && m.rank === i)
    })).reverse(),
    members: list,
    outsiders: list.filter(m => !m.member),
    yours: list.filter(m => m.yours),
    hasMembers: list.some(m => m.member),
    notes: store.all("notes").filter(n => (n.faction === faction.id) && store.isVisible("notes", n))
      .map(n => ({ id: n.id, title: n.title || loc("Untitled") })),
    viewers: isGM ? viewerNames(faction) : "",
    canPromote: isGM,
    topRank: ranks.length - 1,
    allies: related(faction.allies),
    rivals: related(faction.rivals),
    quests,
    description: await enrich(faction.description),
    gmNotes: isGM ? await enrich(faction.gmNotes) : ""
  };
}
