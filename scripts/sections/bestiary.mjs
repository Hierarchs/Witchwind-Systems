import { PATH, L, BESTIARY_FACTS } from "../config.mjs";
import * as store from "../store.mjs";
import { openEditor } from "../editor.mjs";
import { enrich, loc, confirmDelete, knows, worldDate, worldNow, byName } from "../helpers.mjs";

/*
 * The bestiary: creatures the party has met. A creature is copied from its monster in the compendium, not linked to
 * it, so the record stays whole if the compendium changes. The GM can refresh it from the compendium later, keeping
 * whatever the table has learned. Each fact is revealed on its own, to everyone or to chosen players.
 */
export default {
  id: "bestiary",
  template: `${PATH}/templates/sections/bestiary.hbs`,

  async prepare(app) {
    const isGM = game.user.isGM;
    const creatures = store.all("bestiary").filter(c => store.isVisible("bestiary", c)).sort(byName);
    const search = (app.search.bestiary ?? "").trim().toLowerCase();
    const listed = creatures.filter(c => !search || `${c.name} ${knows(c, "basics") ? c.type ?? "" : ""}`.toLowerCase().includes(search));
    if ( !listed.some(c => c.id === app.selected.bestiary) ) app.selected.bestiary = listed[0]?.id ?? null;
    const creature = listed.find(c => c.id === app.selected.bestiary);

    return {
      isGM,
      search: app.search.bestiary ?? "",
      empty: !listed.length,
      rows: listed.map(c => ({
        id: c.id,
        name: c.name || loc("Untitled"),
        img: c.img,
        type: knows(c, "basics") ? c.type : "",
        encountered: (c.encounters ?? []).length,
        hidden: !c.visible,
        selected: c.id === app.selected.bestiary
      })),
      creature: creature ? await detail(creature) : null
    };
  },

  /** A GM drops a monster from the compendium onto the page to add it to the bestiary. */
  onRender(app, element) {
    const page = element.querySelector(".wws-bestiary");
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
      if ( (data?.type !== "Actor") || !data.uuid ) return;
      event.preventDefault();
      const actor = await foundry.utils.fromUuid(data.uuid);
      if ( !actor ) return;
      app.selected.bestiary = await importCreature(actor);
      app.search.bestiary = "";
      app.render();
    });
  },

  actions: {
    bestiarySelect(event, target) {
      this.selected.bestiary = target.dataset.id;
      this.render();
    },

    bestiaryEdit(event, target) {
      const creature = store.get("bestiary", target.dataset.id);
      if ( !creature ) return;
      openEditor("creature", {
        entry: creature,
        title: loc("Bestiary.Edit", { name: creature.name }),
        onSave: data => store.update("bestiary", creature.id, data)
      });
    },

    async bestiaryDelete(event, target) {
      const creature = store.get("bestiary", target.dataset.id);
      if ( creature && await confirmDelete(creature.name) ) await store.remove("bestiary", creature.id);
    },

    bestiaryVisible(event, target) {
      const creature = store.get("bestiary", target.dataset.id);
      if ( creature ) return store.update("bestiary", creature.id, { visible: !creature.visible });
    },

    /** Logging an encounter records that the party met the creature, so its basics are known to everyone. */
    bestiaryEncounter(event, target) {
      const creature = store.get("bestiary", target.dataset.id);
      if ( !creature ) return;
      openEditor("entry", {
        entry: { id: `${creature.id}-encounter` },
        title: loc("Bestiary.LogEncounter", { name: creature.name }),
        onSave: ({ text }) => {
          if ( !text ) return;
          const fresh = store.get("bestiary", creature.id);
          const encounters = [...(fresh?.encounters ?? []), { id: foundry.utils.randomID(), date: worldNow(), place: text }];
          const knowledge = { ...(fresh?.knowledge ?? {}) };
          if ( !knowledge.basics ) knowledge.basics = ["*"];
          return store.update("bestiary", creature.id, { encounters, knowledge, visible: true });
        }
      });
    },

    /**
     * Reveal one fact to everyone, or to one player (toggling their name on and off). Revealing to everyone clears
     * the individual choices, and hiding a fact clears them all.
     */
    bestiaryShare(event, target) {
      const creature = store.get("bestiary", target.dataset.id);
      const key = target.dataset.key;
      const who = target.dataset.user;
      if ( !creature || !key || !who ) return;
      const current = creature.knowledge?.[key] ?? [];
      let next;
      if ( who === "*" ) next = current.includes("*") ? [] : ["*"];
      else {
        const players = current.filter(id => id !== "*");
        next = players.includes(who) ? players.filter(id => id !== who) : [...players, who];
      }
      return store.update("bestiary", creature.id, { knowledge: { ...creature.knowledge, [key]: next } });
    },

    /** Bring a creature's stats up to date with its compendium entry, keeping what the table has learned. */
    async bestiaryRefresh(event, target) {
      const creature = store.get("bestiary", target.dataset.id);
      if ( !creature ) return;
      if ( !creature.sourceUuid ) return ui.notifications.warn(loc("Bestiary.NoSource"));
      const actor = await foundry.utils.fromUuid(creature.sourceUuid);
      if ( !actor ) return ui.notifications.warn(loc("Bestiary.SourceMissing"));
      await store.update("bestiary", creature.id, snapshotCreature(actor));
      ui.notifications.info(loc("Bestiary.Updated", { name: creature.name }));
    }
  }
};

/* -------------------------------------------- */
/*  Copying a creature in                       */
/* -------------------------------------------- */

const titleCase = s => String(s ?? "").replace(/[_-]+/g, " ").replace(/\b\w/g, c => c.toUpperCase());
const FRACTIONS = { 0.125: "1/8", 0.25: "1/4", 0.5: "1/2" };
const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];

/** A monster's biography: the description in its compendium entry, public or not. */
const biographyOf = details => details?.biography?.value || details?.biography?.public || "";

/** The first picture in a biography, which is usually the monster's large artwork. */
function firstImage(html) {
  if ( !html ) return "";
  return new DOMParser().parseFromString(html, "text/html").querySelector("img")?.getAttribute("src") ?? "";
}

/** A list of trait names from dnd5e's collection or set of keys, such as damage types. */
const traitList = v => Array.from(v?.value ?? v ?? []).filter(x => typeof x === "string").map(titleCase);

function skillName(key) {
  const label = CONFIG.DND5E?.skills?.[key]?.label;
  return label ? game.i18n.localize(label) : titleCase(key);
}

/**
 * A creature's stat block, copied out of its actor. dnd5e keeps these in different places from version to version,
 * so each field is read where it's found and left empty where it isn't.
 */
export function snapshotCreature(actor) {
  const s = actor.system ?? {};
  const attrs = s.attributes ?? {};
  const traits = s.traits ?? {};
  const details = s.details ?? {};
  const items = actor.items?.contents ?? Array.from(actor.items ?? []);
  const named = type => items.filter(i => i.type === type).map(i => i.name).filter(Boolean);

  const moves = ["walk", "fly", "swim", "climb", "burrow"].filter(k => Number(attrs.movement?.[k]) > 0)
    .map(k => `${titleCase(k)} ${attrs.movement[k]} ${attrs.movement.units ?? "ft"}`);
  const senses = ["darkvision", "blindsight", "tremorsense", "truesight"].filter(k => Number(attrs.senses?.[k]) > 0)
    .map(k => `${titleCase(k)} ${attrs.senses[k]} ${attrs.senses.units ?? "ft"}`);
  const skills = Object.entries(s.skills ?? {}).filter(([, v]) => (v?.value ?? 0) > 0)
    .map(([k, v]) => `${skillName(k)}${Number.isFinite(v.total) ? ` ${v.total >= 0 ? "+" : ""}${v.total}` : ""}`);
  const abilities = Object.fromEntries(ABILITIES.map(k => [k, s.abilities?.[k]?.value ?? 10]));
  const base = details.type?.custom || titleCase(details.type?.value);
  const type = details.type?.subtype ? `${base} (${titleCase(details.type.subtype)})` : base;

  return {
    name: actor.name ?? "",
    img: actor.img ?? "",
    art: firstImage(biographyOf(details)) || actor.img || "",
    biography: biographyOf(details),
    type,
    size: traits.size ?? details.size ?? "",
    cr: FRACTIONS[details.cr] ?? details.cr ?? "",
    ac: attrs.ac?.value ?? attrs.ac?.flat ?? "",
    hp: attrs.hp?.max ?? attrs.hp?.value ?? "",
    speed: moves.join(", "),
    senses: senses.join(", "),
    abilities,
    skills,
    languages: [...traitList(traits.languages), traits.languages?.custom].filter(Boolean),
    resistances: traitList(traits.dr),
    vulnerabilities: traitList(traits.dv),
    immunities: traitList(traits.di),
    conditionImmunities: traitList(traits.ci),
    attacks: named("weapon"),
    traits: named("feat"),
    spells: named("spell")
  };
}

/** Add a monster to the bestiary, or refresh the one already copied from it. Returns its id. */
export async function importCreature(actor) {
  const stats = snapshotCreature(actor);
  const existing = store.all("bestiary").find(c => c.sourceUuid === actor.uuid);
  if ( existing ) {
    await store.update("bestiary", existing.id, stats);
    ui.notifications.info(loc("Bestiary.Updated", { name: stats.name }));
    return existing.id;
  }
  const id = await store.create("bestiary", {
    ...stats,
    sourceUuid: actor.uuid,
    visible: false,
    knowledge: {},
    encounters: [],
    lore: "",
    tactics: "",
    habitat: ""
  });
  ui.notifications.info(loc("Bestiary.Added", { name: stats.name }));
  return id;
}

/* -------------------------------------------- */
/*  The record                                  */
/* -------------------------------------------- */

const label = name => loc(`Bestiary.Lines.${name}`);

const SIZES = ["tiny", "sm", "med", "lg", "huge", "grg"];
function sizeLabel(size) {
  return SIZES.includes(size) ? loc(`Bestiary.Sizes.${size}`) : titleCase(size);
}

/** The rows a fact shows: each with its label and value, empty ones left out. */
function lines(c, key) {
  const rows = [];
  const add = (name, value) => {
    const text = Array.isArray(value) ? value.join(", ") : (value ?? "");
    if ( String(text).trim() ) rows.push({ label: label(name), value: String(text) });
  };
  switch ( key ) {
    case "basics":
      add("type", c.type);
      add("size", sizeLabel(c.size));
      break;
    case "threat":
      add("cr", c.cr);
      break;
    case "defense":
      add("ac", c.ac);
      add("hp", c.hp);
      break;
    case "movement":
      add("speed", c.speed);
      add("senses", c.senses);
      break;
    case "abilities":
      for ( const k of ABILITIES ) {
        if ( c.abilities?.[k] === undefined ) continue;
        const mod = Math.floor((c.abilities[k] - 10) / 2);
        rows.push({ label: k.toUpperCase(), value: `${c.abilities[k]} (${mod >= 0 ? "+" : ""}${mod})` });
      }
      break;
    case "resistances":
      add("resistances", c.resistances);
      add("vulnerabilities", c.vulnerabilities);
      add("immunities", c.immunities);
      add("conditionImmunities", c.conditionImmunities);
      break;
    case "languages":
      add("languages", c.languages);
      break;
    case "skills":
      add("skills", c.skills);
      break;
    case "attacks":
      add("attacks", c.attacks);
      break;
    case "traits":
      add("traits", c.traits);
      add("spells", c.spells);
      break;
    case "habitat":
      add("habitat", c.habitat);
      break;
    default:
      break;
  }
  return rows;
}

/** The text a fact shows: the lore is the compendium's biography, with the table's own lore written after it. */
function textFor(c, key) {
  if ( key === "lore" ) return [c.biography, c.lore].filter(Boolean).join("");
  return c[key] ?? "";
}

/** The players who can see a fact, as chips for the GM to switch. */
function playerChoices(c, key) {
  const who = c.knowledge?.[key] ?? [];
  return game.users.filter(u => !u.isGM).map(u => ({
    id: u.id,
    name: u.name,
    color: u.color?.css ?? "#8a7d66",
    on: who.includes(u.id)
  }));
}

async function detail(c) {
  const isGM = game.user.isGM;
  const encounters = c.encounters ?? [];
  // The header and the list only name the creature's kind once its basics are known, like everything else.
  const facts = await Promise.all(BESTIARY_FACTS.map(async fact => {
    const known = knows(c, fact.key);
    const who = c.knowledge?.[fact.key] ?? [];
    const everyone = who.includes("*");
    const shared = everyone || who.some(id => id !== "*");
    // Hidden facts aren't even prepared for players, so nothing they shouldn't see reaches their screen.
    const show = known || isGM;
    const isText = fact.key === "lore" || fact.key === "tactics";
    return {
      key: fact.key,
      icon: fact.icon,
      label: loc(`Bestiary.Facts.${fact.key}`),
      known,
      hiddenFromPlayers: isGM && !shared,
      wide: isText,
      everyone,
      players: isGM ? playerChoices(c, fact.key) : [],
      lines: show && !isText ? lines(c, fact.key) : [],
      html: show && isText ? await enrich(textFor(c, fact.key)) : ""
    };
  }));
  // Only what the page prints: the facts carry everything else, and each one is filled in only when it may be seen.
  return {
    id: c.id,
    img: c.img,
    art: c.art || c.img || "",
    name: c.name || loc("Untitled"),
    hidden: !c.visible,
    encounteredCount: encounters.length,
    encounters: encounters.slice().sort((a, b) => (b.date ?? 0) - (a.date ?? 0))
      .map(e => ({ id: e.id, place: e.place, dateLabel: worldDate(e.date ?? 0) })),
    typeLabel: (isGM || knows(c, "basics")) ? (c.type ?? "") : "",
    sizeLabel: (isGM || knows(c, "basics")) ? sizeLabel(c.size) : "",
    canRefresh: isGM && !!c.sourceUuid,
    facts
  };
}
