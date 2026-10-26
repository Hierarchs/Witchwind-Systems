import { PATH, L, DEFAULT_RANKS, standingTier } from "../config.mjs";
import * as store from "../store.mjs";
import { openEditor } from "../editor.mjs";
import { loc, confirmDelete, openSheet, worldDate, worldNow, partyCharacters } from "../helpers.mjs";

/*
 * Renown: each character's card, with the titles they've earned (and what earned them) and their place in each
 * faction. A title is awarded to one character with a reason, a date in the world's calendar, and optionally the
 * quest that earned it.
 */
export default {
  id: "renown",
  template: `${PATH}/templates/sections/renown.hbs`,

  async prepare(app) {
    const titles = store.all("titles").filter(t => store.isVisible("titles", t));
    const people = partyCharacters(titles);
    if ( !people.some(p => p.uuid === app.selected.renown) ) app.selected.renown = people[0]?.uuid ?? null;

    const rows = people.map(p => {
      const held = titles.filter(t => t.uuid === p.uuid).sort((a, b) => (b.date ?? 0) - (a.date ?? 0));
      return { ...p, count: held.length, latest: held[0]?.name, selected: p.uuid === app.selected.renown };
    });

    const person = people.find(p => p.uuid === app.selected.renown);
    return { rows, empty: !rows.length, isGM: game.user.isGM, person: person ? card(person, titles) : null };
  },

  actions: {
    renownSelect(event, target) {
      this.selected.renown = target.dataset.uuid;
      this.render();
    },

    titleGrant(event, target) {
      openEditor("title", {
        entry: { uuid: target.dataset.uuid, visible: true },
        title: loc("Renown.Grant"),
        onSave: async data => {
          await store.create("titles", { ...data, date: worldNow() });
          this.selected.renown = data.uuid;
        }
      });
    },

    titleEdit(event, target) {
      const title = store.get("titles", target.dataset.id);
      if ( !title ) return;
      openEditor("title", {
        entry: title,
        title: loc("Renown.Edit", { name: title.name }),
        onSave: data => store.update("titles", title.id, data)
      });
    },

    async titleDelete(event, target) {
      const title = store.get("titles", target.dataset.id);
      if ( title && await confirmDelete(title.name) ) await store.remove("titles", title.id);
    },

    renownSheet(event, target) {
      return openSheet(target.dataset.uuid);
    },

    renownFaction(event, target) {
      this.open("factions", target.dataset.faction);
    },

    renownQuest(event, target) {
      this.open("quests", target.dataset.quest);
    }
  }
};

/* -------------------------------------------- */

/** A character's titles, newest first, and their rank and standing in each faction they're known to. */
export function card(person, titles) {
  return {
    ...person,
    titles: titles.filter(t => t.uuid === person.uuid).sort((a, b) => (b.date ?? 0) - (a.date ?? 0)).map(t => {
      const quest = store.get("quests", t.quest);
      return {
        ...t,
        dateLabel: worldDate(t.date ?? 0),
        hidden: !t.visible,
        quest: store.isVisible("quests", quest) ? { id: quest.id, title: quest.title } : null
      };
    }),
    factions: factionPlaces(person.uuid)
  };
}

/** Each visible faction that knows a character: their rank (or "Not a member") and their standing tier. */
export function factionPlaces(uuid) {
  return store.all("factions").filter(f => store.isVisible("factions", f)).flatMap(f => {
    const m = (f.members ?? []).find(x => x.uuid === uuid);
    if ( !m ) return [];
    const ranks = f.ranks?.length ? f.ranks : DEFAULT_RANKS;
    const rank = (m.rank ?? 0) < 0 ? -1 : Math.min(m.rank ?? 0, ranks.length - 1);
    const standing = Math.clamp(Number.isFinite(m.standing) ? m.standing : (f.standing ?? 0), -100, 100);
    const tier = standingTier(standing);
    return [{
      id: f.id,
      name: f.name,
      img: f.img,
      rankName: rank >= 0 ? ranks[rank] : game.i18n.localize(`${L}.Factions.NotMember`),
      tier,
      tierLabel: game.i18n.localize(`${L}.Factions.Tiers.${tier}`),
      standingLabel: standing > 0 ? `+${standing}` : String(standing)
    }];
  });
}
