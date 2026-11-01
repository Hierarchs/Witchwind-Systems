import { MODULE_ID, PATH, L } from "./config.mjs";

/*
 * Sound effects: the book opening and closing, a page turning on each new tab or entry, a fanfare for quest
 * banners and a chime for each trophy unlocked. The module brings its own; the GM can choose others (any audio on
 * the server) or clear one to silence it, and each player can turn them down or off.
 */

/** Each sound's world setting, holding a file path. */
const SOUNDS = {
  open: "soundOpen",
  close: "soundClose",
  page: "soundPage",
  page2: "soundPage2",
  quest: "soundQuest",
  achievement: "soundAchievement"
};

/** The sounds that come with the module, played until the GM chooses others. */
const DEFAULTS = {
  open: `${PATH}/sounds/book-open.wav`,
  close: `${PATH}/sounds/book-close.wav`,
  page: `${PATH}/sounds/page-1.wav`,
  page2: `${PATH}/sounds/page-2.wav`,
  quest: `${PATH}/sounds/quest.mp3`,
  achievement: `${PATH}/sounds/achievement.wav`
};

/** Page turns closer together than this are skipped, so flicking through a list doesn't stutter. */
const PAGE_GAP = 140;

/** How long after the world is ready the book's sounds are loaded, in milliseconds, to keep out of its way. */
const PRELOAD_DELAY = 5000;

let lastPage = 0;

export function registerSounds() {
  for ( const [key, setting] of Object.entries(SOUNDS) ) {
    game.settings.register(MODULE_ID, setting, {
      name: `${L}.Settings.Sounds.${key}.Name`,
      hint: `${L}.Settings.Sounds.${key}.Hint`,
      scope: "world",
      config: true,
      type: String,
      default: DEFAULTS[key],
      filePicker: "audio"
    });
  }

  game.settings.register(MODULE_ID, "soundVolume", {
    name: `${L}.Settings.Sounds.Volume.Name`,
    hint: `${L}.Settings.Sounds.Volume.Hint`,
    scope: "client",
    config: true,
    type: Number,
    range: { min: 0, max: 1, step: 0.05 },
    default: 0.6
  });

  // Whether the empty boxes from before the module brought its own sounds have been filled; see fillEmptySounds.
  game.settings.register(MODULE_ID, "soundsFilled", { scope: "world", config: false, type: Boolean, default: false });
}

/**
 * Before 0.11.0 each sound's default was an empty box, and saving the settings stored it, so those worlds kept the
 * silence after the module began bringing its own sounds: a stored value outlasts a new default. Once per world, the
 * active GM fills the empty boxes with the module's sounds; after that, an emptied box is silence again.
 */
export async function fillEmptySounds() {
  if ( !game.user.isActiveGM || game.settings.get(MODULE_ID, "soundsFilled") ) return;
  for ( const [key, setting] of Object.entries(SOUNDS) ) {
    if ( !game.settings.get(MODULE_ID, setting) ) await game.settings.set(MODULE_ID, setting, DEFAULTS[key]);
  }
  await game.settings.set(MODULE_ID, "soundsFilled", true);
}

/**
 * Load the book's own sounds (opening, closing and the page turns) a little after the world is ready, so the first
 * page turned doesn't wait on its file. They're small; the fanfare and the chime load the first time they play.
 */
export function preloadSounds() {
  const helper = foundry.audio?.AudioHelper;
  if ( !helper?.preloadSound || !game.settings.get(MODULE_ID, "soundVolume") ) return;
  setTimeout(() => {
    for ( const key of ["open", "close", "page", "page2"] ) {
      const src = game.settings.get(MODULE_ID, SOUNDS[key]);
      if ( src ) Promise.resolve().then(() => helper.preloadSound(src)).catch(() => {});
    }
  }, PRELOAD_DELAY);
}

/** Play one of the sounds on this client only: "open", "close", "page" (either page turn), "quest" or "achievement". */
export function playSound(key) {
  const volume = game.settings.get(MODULE_ID, "soundVolume");
  if ( !volume ) return;
  let src;
  if ( key === "page" ) {
    const now = Date.now();
    if ( (now - lastPage) < PAGE_GAP ) return;
    lastPage = now;
    const pages = [SOUNDS.page, SOUNDS.page2].map(s => game.settings.get(MODULE_ID, s)).filter(Boolean);
    src = pages[Math.floor(Math.random() * pages.length)];
  }
  else src = game.settings.get(MODULE_ID, SOUNDS[key]);
  if ( !src ) return;
  const warn = err => console.warn(`${MODULE_ID} | Couldn't play ${src}`, err);
  try {
    Promise.resolve(foundry.audio.AudioHelper.play({ src, volume, autoplay: true, loop: false }, false)).catch(warn);
  } catch(err) {
    warn(err);
  }
}
