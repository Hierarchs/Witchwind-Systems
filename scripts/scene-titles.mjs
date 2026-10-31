import { MODULE_ID, L } from "./config.mjs";
import { openEditor } from "./editor.mjs";
import { broadcast, listen } from "./socket.mjs";
import { loc } from "./helpers.mjs";

/*
 * Scene title cards: on arriving at a scene, its name fades in large over the screen with its region above it and a
 * line beneath, as the Elder Scrolls and Souls games announce a place, then fades away. The GM gives each scene its
 * card (name, region, a line) from the Scenes sidebar, can turn it off for a scene, and can show it to everyone at any
 * time. The card is kept in the scene's flags.
 */

/** How long a card stays, from its first fade to the last, in milliseconds (the stylesheet's animation runs as long). */
const DURATION = 6400;

let shownScene = null;

export function registerSceneTitles() {
  shownScene = globalThis.canvas?.scene?.id ?? null;
  // A new scene, not the same one drawn again; the first scene of a session is where the player already was.
  Hooks.on("canvasReady", canvas => {
    const scene = canvas?.scene;
    if ( !scene || (scene.id === shownScene) ) return;
    shownScene = scene.id;
    showTitle(scene);
  });
  listen("sceneTitle", ({ sceneId }) => {
    const scene = game.scenes?.get(sceneId);
    if ( scene ) showTitle(scene, { force: true });
  });

  // The GM's two entries in the Scenes sidebar's menu: write the card, and show it now. (v13 and later name the hook
  // for the document; earlier versions for the directory.)
  const addEntries = (app, options) => {
    if ( !game.user.isGM || options.some(o => o.wwsSceneTitle) ) return;
    options.push(
      { name: `${L}.SceneTitles.Edit`, icon: '<i class="fa-solid fa-heading"></i>', wwsSceneTitle: true,
        condition: li => !!sceneOf(li), callback: li => editTitle(sceneOf(li)) },
      { name: `${L}.SceneTitles.Show`, icon: '<i class="fa-solid fa-display"></i>', wwsSceneTitle: true,
        condition: li => !!sceneOf(li), callback: li => showToEveryone(sceneOf(li)) }
    );
  };
  Hooks.on("getSceneContextOptions", addEntries);
  Hooks.on("getSceneDirectoryEntryContext", addEntries);
}

/** The scene a sidebar entry stands for, whichever version of the sidebar it's from. */
function sceneOf(li) {
  const el = li?.dataset ? li : li?.[0];
  const id = el?.dataset?.entryId ?? el?.dataset?.documentId;
  return id ? game.scenes?.get(id) : null;
}

/** A scene's card as it's shown: its own words, or the scene's name. */
export function titleOf(scene) {
  const card = scene?.getFlag?.(MODULE_ID, "title") ?? {};
  return {
    title: String(card.title || scene?.navName || scene?.name || "").trim(),
    region: String(card.region ?? "").trim(),
    line: String(card.line ?? "").trim(),
    enabled: card.enabled !== false,
    written: !!(card.title || card.region || card.line)
  };
}

/** Show a scene's title card on this screen, unless it's switched off here, for the world, or for the scene. */
export function showTitle(scene, { force=false }={}) {
  const card = titleOf(scene);
  if ( !card.title || !game.settings.get(MODULE_ID, "sceneTitlesShow") ) return;
  const mode = game.settings.get(MODULE_ID, "sceneTitles");
  if ( !force && ((mode === "off") || !card.enabled || ((mode === "written") && !card.written)) ) return;

  document.querySelector(".wws-scene-title")?.remove();
  const el = document.createElement("div");
  el.className = "wws wws-scene-title";
  el.setAttribute("role", "status");
  el.innerHTML = `<span class="wws-st-region"></span><h1 class="wws-st-name"></h1>
    <span class="wws-st-rule" aria-hidden="true"><span></span></span><span class="wws-st-line"></span>`;
  const set = (selector, text) => {
    const part = el.querySelector(selector);
    if ( text ) part.textContent = text;
    else part.remove();
  };
  set(".wws-st-region", card.region);
  set(".wws-st-name", card.title);
  set(".wws-st-line", card.line);
  document.body.append(el);
  setTimeout(() => el.remove(), DURATION + 100);
}

/** Show a scene's card on every screen, as the GM's menu entry and the scene control do. */
export function showToEveryone(scene=globalThis.canvas?.scene) {
  if ( !game.user.isGM || !scene ) return;
  broadcast("sceneTitle", { sceneId: scene.id });
  showTitle(scene, { force: true });
}

/** Write a scene's title card, in the editor. */
export function editTitle(scene) {
  if ( !scene ) return;
  const card = scene.getFlag(MODULE_ID, "title") ?? {};
  openEditor("sceneTitle", {
    entry: { id: scene.id, title: card.title ?? "", region: card.region ?? "", line: card.line ?? "", enabled: card.enabled !== false },
    title: loc("SceneTitles.EditTitle", { name: scene.navName || scene.name }),
    extra: { sceneName: scene.navName || scene.name },
    onSave: data => scene.setFlag(MODULE_ID, "title", {
      title: data.title ?? "", region: data.region ?? "", line: data.line ?? "", enabled: !!data.enabled
    })
  });
}
