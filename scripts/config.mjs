export const MODULE_ID = "witchwind-systems";
export const PATH = `modules/${MODULE_ID}`;

/** Localization root for every string the module shows. */
export const L = "WITCHWIND_SYSTEMS";

/** The four sections, in the order of the tabs along the bottom of the window. */
export const SECTION_IDS = ["quests", "journal", "bestiary", "notices", "maps", "factions", "renown", "merchants"];

export const SECTION_ICONS = {
  quests: "fa-solid fa-scroll-old",
  journal: "fa-solid fa-feather-pointed",
  bestiary: "fa-solid fa-dragon",
  notices: "fa-solid fa-thumbtack",
  maps: "fa-solid fa-map",
  factions: "fa-solid fa-chess-rook",
  renown: "fa-solid fa-crown",
  merchants: "fa-solid fa-scale-balanced"
};

/*
 * The bestiary: what the party can learn about a creature, one fact at a time. Each is revealed to everyone or to
 * chosen players, and shown in this order. "basics" is revealed as soon as the party meets the creature.
 */
/*
 * How dangerous a notice's job is, from the lowest to the highest. The colour is the notice's mark on the board and
 * the seal on its sheet; the colours are dark enough to read on parchment.
 */
export const NOTICE_DIFFICULTIES = [
  { id: "trivial", color: "#4f8f49" },
  { id: "easy", color: "#3f7fc4" },
  { id: "moderate", color: "#9a7a2c" },
  { id: "hard", color: "#c97d24" },
  { id: "deadly", color: "#8a2a1a" }
];

export function difficultyOf(id) {
  return NOTICE_DIFFICULTIES.find(d => d.id === id) ?? NOTICE_DIFFICULTIES[1];
}

export const BESTIARY_FACTS = [
  { key: "basics", icon: "fa-solid fa-paw" },
  { key: "threat", icon: "fa-solid fa-skull" },
  { key: "defense", icon: "fa-solid fa-shield-halved" },
  { key: "movement", icon: "fa-solid fa-shoe-prints" },
  { key: "abilities", icon: "fa-solid fa-dumbbell" },
  { key: "resistances", icon: "fa-solid fa-hand-sparkles" },
  { key: "languages", icon: "fa-solid fa-language" },
  { key: "skills", icon: "fa-solid fa-eye" },
  { key: "attacks", icon: "fa-solid fa-hand-fist" },
  { key: "traits", icon: "fa-solid fa-wand-magic-sparkles" },
  { key: "lore", icon: "fa-solid fa-book-open" },
  { key: "tactics", icon: "fa-solid fa-chess" },
  { key: "habitat", icon: "fa-solid fa-tree" }
];

/* -------------------------------------------- */
/*  The Xerseraya calendar                      */
/* -------------------------------------------- */

/** A week of seven days and twelve months of thirty days, with no leap years: 360 days a year. */
export const XERSERAYA_CALENDAR = {
  name: "The Xerseraya Calendar",
  description: "Seven days to the week, twelve months of thirty days.",
  years: { yearZero: 0, firstWeekday: 0, leapYear: null },
  months: {
    values: [
      ["First Light", "FLt"], ["Snow's End", "SnE"], ["Soils Break", "SoB"], ["Seeds Rest", "SeR"],
      ["Guiding Rain", "GRn"], ["Cloudbreak", "Clb"], ["Sun's Mantle", "SMn"], ["First Harvest", "FHv"],
      ["Harvest's End", "HvE"], ["Waning Sun", "WSn"], ["Flakefall", "Flk"], ["Last Light", "LLt"]
    ].map(([name, abbreviation], i) => ({ name, abbreviation, ordinal: i + 1, days: 30 }))
  },
  days: {
    values: [
      ["Dawnwake", "Daw"], ["Morrow", "Mor"], ["Highsun", "Hig"], ["Waning", "Wan"],
      ["Evenfall", "Eve"], ["Deepnight", "Dee"], ["Stillhour", "Sti"]
    ].map(([name, abbreviation], i) => ({ name, abbreviation, ordinal: i + 1 })),
    daysPerYear: 360,
    hoursPerDay: 24,
    minutesPerHour: 60,
    secondsPerMinute: 60
  },
  seasons: { values: [] }
};

/* -------------------------------------------- */
/*  Letters                                     */
/* -------------------------------------------- */

export const LETTER_KINDS = ["letter", "book", "notice", "orders"];

export const LETTER_ICONS = {
  letter: "fa-solid fa-envelope",
  book: "fa-solid fa-book",
  notice: "fa-solid fa-scroll",
  orders: "fa-solid fa-stamp"
};

/* -------------------------------------------- */
/*  Quests                                      */
/* -------------------------------------------- */

/** Quest groups, in the order they're listed. */
export const QUEST_KINDS = ["main", "side", "faction", "misc"];

export const QUEST_STATUSES = ["active", "completed", "failed"];

/* -------------------------------------------- */
/*  Journal                                     */
/* -------------------------------------------- */

export const NOTE_KINDS = ["general", "people", "places", "lore", "clues"];

export const NOTE_ICONS = {
  general: "fa-solid fa-feather",
  people: "fa-solid fa-user",
  places: "fa-solid fa-signs-post",
  lore: "fa-solid fa-book-sparkles",
  clues: "fa-solid fa-magnifying-glass"
};

/* -------------------------------------------- */
/*  Maps                                        */
/* -------------------------------------------- */

/** Marker icons offered when placing a pin (Font Awesome Pro, which Foundry ships). */
export const PIN_ICONS = {
  location: "fa-location-dot",
  city: "fa-city",
  village: "fa-house-chimney",
  castle: "fa-castle",
  tower: "fa-chess-rook",
  dungeon: "fa-dungeon",
  camp: "fa-campfire",
  tavern: "fa-mug-hot",
  temple: "fa-place-of-worship",
  shop: "fa-sack-dollar",
  port: "fa-anchor",
  forest: "fa-tree",
  mountain: "fa-mountain",
  ruins: "fa-monument",
  danger: "fa-skull",
  treasure: "fa-treasure-chest",
  quest: "fa-star",
  person: "fa-person",
  note: "fa-feather",
  flag: "fa-flag"
};

/** Marker colors: Witchwind's gold and its rarity colors. */
export const PIN_COLORS = {
  gold: "#c9a45c",
  ivory: "#efe3c8",
  red: "#c4473a",
  orange: "#c97d24",
  green: "#4f8f49",
  blue: "#3f7fc4",
  purple: "#8a62c0"
};

/* -------------------------------------------- */
/*  Factions                                    */
/* -------------------------------------------- */

/** Ranks a new faction starts with, lowest first. */
export const DEFAULT_RANKS = ["Initiate", "Member", "Veteran", "Officer", "Master"];

/** Standing runs from -100 to 100; each tier starts at its threshold. */
export const STANDING_TIERS = [
  { id: "hated", min: -100 },
  { id: "hostile", min: -75 },
  { id: "unfriendly", min: -40 },
  { id: "neutral", min: -10 },
  { id: "friendly", min: 10 },
  { id: "trusted", min: 40 },
  { id: "revered", min: 75 }
];

export function standingTier(value) {
  let tier = STANDING_TIERS[0];
  for ( const t of STANDING_TIERS ) if ( value >= t.min ) tier = t;
  return tier.id;
}
