export const MODULE_ID = "witchwind-systems";
export const PATH = `modules/${MODULE_ID}`;

/** Localization root for every string the module shows. */
export const L = "WITCHWIND_SYSTEMS";

/** The four sections, in the order of the tabs along the bottom of the window. */
export const SECTION_IDS = ["quests", "journal", "calendar", "bestiary", "notices", "maps", "factions", "merchants", "chronicle"];

export const SECTION_ICONS = {
  quests: "fa-solid fa-scroll-old",
  journal: "fa-solid fa-feather-pointed",
  calendar: "fa-solid fa-calendar-days",
  bestiary: "fa-solid fa-dragon",
  notices: "fa-solid fa-thumbtack",
  maps: "fa-solid fa-map",
  factions: "fa-solid fa-chess-rook",
  merchants: "fa-solid fa-scale-balanced",
  chronicle: "fa-solid fa-trophy"
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

/**
 * The looks a location card can take, after the games each suits; Witchwind's own leather and gold first, as the
 * default. Each is a class (wws-theme-<id>) that sets the card's colours, type and dressing.
 */
export const LOCATION_THEMES = ["witchwind", "dusk", "tome", "holo", "bound", "horizon", "woodcut", "dossier", "terminal",
  "frontier", "neon", "ink", "gothic"];

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

/*
 * Knowledge checks: which skill recalls what about each kind of creature, as the Monster Manual suggests, the
 * skills a GM can choose from instead, and the order a check reveals facts in, the most telling first.
 */
export const KNOWLEDGE_SKILLS = {
  aberration: "arc", construct: "arc", dragon: "arc", elemental: "arc", fey: "arc", monstrosity: "arc",
  beast: "nat", ooze: "nat", plant: "nat",
  celestial: "rel", fiend: "rel", undead: "rel",
  giant: "his", humanoid: "his"
};

export const KNOWLEDGE_SKILL_IDS = ["arc", "his", "nat", "rel"];

export const KNOWLEDGE_ORDER = ["basics", "lore", "threat", "resistances", "defense", "attacks", "traits", "abilities",
  "movement", "skills", "languages", "habitat", "tactics"];

/** A check that meets the DC recalls one fact, and one more for each full this-many points over it. */
export const KNOWLEDGE_STEP = 5;

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

/** How much more (or less) a faction's merchants charge the party at each standing, in percent. */
export const STANDING_PRICES = { hated: 50, hostile: 30, unfriendly: 15, neutral: 0, friendly: -5, trusted: -10, revered: -20 };

/* -------------------------------------------- */
/*  Rewards and the calendar                    */
/* -------------------------------------------- */

/** dnd5e's coins, most valuable first. */
export const CURRENCIES = ["pp", "gp", "ep", "sp", "cp"];

/** A moon's eight phases, from new round to new again. */
export const MOON_PHASES = ["new", "waxingCrescent", "firstQuarter", "waxingGibbous", "full", "waningGibbous", "lastQuarter",
  "waningCrescent"];

/* -------------------------------------------- */
/*  Trophies                                    */
/* -------------------------------------------- */

/** A trophy's metal, the plainest first. */
export const TROPHY_TIERS = ["bronze", "silver", "gold"];

/**
 * What unlocks a trophy: one of the chronicle's counts reaching the trophy's number, or the GM's own award. Rolls are
 * counted for each character, so trophies for them (and the GM's own) can be earned by each character in turn; the
 * rest are the party's, earned once.
 */
export const TROPHY_RULES = ["kills", "killsOf", "killCR", "battles", "crits", "fumbles", "quests", "places", "creatures", "gold",
  "days", "sessions", "standing", "manual"];

export const TROPHY_EACH = ["crits", "fumbles", "manual"];

/** The marks a trophy can carry. */
export const TROPHY_ICONS = ["fa-solid fa-trophy", "fa-solid fa-medal", "fa-solid fa-award", "fa-solid fa-crown", "fa-solid fa-star",
  "fa-solid fa-droplet", "fa-solid fa-skull", "fa-solid fa-skull-crossbones", "fa-solid fa-dragon", "fa-solid fa-ghost",
  "fa-solid fa-mountain", "fa-solid fa-dice-d20", "fa-solid fa-bullseye", "fa-solid fa-face-dizzy", "fa-solid fa-shield-halved",
  "fa-solid fa-hand-fist", "fa-solid fa-scroll", "fa-solid fa-signs-post", "fa-solid fa-map-location-dot", "fa-solid fa-paw",
  "fa-solid fa-coins", "fa-solid fa-gem", "fa-solid fa-hourglass-half", "fa-solid fa-fire", "fa-solid fa-heart",
  "fa-solid fa-book-skull", "fa-solid fa-flag", "fa-solid fa-chess-king"];

/** The chronicle's counts the GM can start from, for what happened before the book kept count. */
export const EARLIER_COUNTS = ["kills", "battles", "quests", "places", "creatures"];

/** The marks a calendar event can carry. */
export const EVENT_ICONS = ["fa-solid fa-star", "fa-solid fa-champagne-glasses", "fa-solid fa-place-of-worship",
  "fa-solid fa-crown", "fa-solid fa-skull", "fa-solid fa-sun", "fa-solid fa-moon", "fa-solid fa-leaf", "fa-solid fa-snowflake",
  "fa-solid fa-coins", "fa-solid fa-flag", "fa-solid fa-circle"];
