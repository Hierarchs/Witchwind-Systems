import { MODULE_ID, PATH, L } from "./config.mjs";

/*
 * Sound effects: the book opening and closing, a page turning on each new tab or entry, and a fanfare for quest
 * banners. The module brings its own; the GM can choose others (any audio on the server) or clear one to silence it,
 * and each player can turn them down or off.
 */

/** Each sound's world setting, holding a file path. */
const SOUNDS = {
  open: "soundOpen",
  close: "soundClose",
  page: "soundPage",
  page2: "soundPage2",
  quest: "soundQuest"
};

/** The sounds that come with the module, played until the GM chooses others. */
const DEFAULTS = {
  open: `${PATH}/sounds/book-open.wav`,
  close: `${PATH}/sounds/book-close.wav`,
  page: `${PATH}/sounds/page-1.wav`,
  page2: `${PATH}/sounds/page-2.wav`,
  quest: `${PATH}/sounds/quest.mp3`
};

/** Page turns closer together than this are skipped, so flicking through a list doesn't stutter. */
const PAGE_GAP = 140;

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
}

/** Play one of the sounds on this client only: "open", "close", "page" (either page turn) or "quest". */
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
