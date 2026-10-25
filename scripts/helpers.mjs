import { L } from "./config.mjs";
import * as store from "./store.mjs";
import { broadcast } from "./socket.mjs";

/** The collection behind each section. */
export const SECTION_KINDS = { quests: "quests", journal: "notes", maps: "maps", factions: "factions" };

/** Open an entry on every player's screen, revealing it first if it was hidden. GM only. */
export async function showToPlayers(section, id) {
  const kind = SECTION_KINDS[section];
  const entry = store.get(kind, id);
  if ( !game.user.isGM || !entry ) return;
  if ( kind === "notes" ) {
    if ( !entry.shared ) await store.update(kind, id, { shared: true });
  }
  else if ( !entry.visible ) await store.update(kind, id, { visible: true });
  broadcast("show", { section, id });
  ui.notifications.info(loc("ShownToPlayers"));
}

/** Clean stored HTML (it may have come from any player) and enrich its links and rolls for display. */
export async function enrich(html) {
  if ( !html ) return "";
  const TextEditor = foundry.applications.ux.TextEditor.implementation;
  return TextEditor.enrichHTML(foundry.utils.cleanHTML(html), { secrets: game.user.isGM });
}

/** Plain text typed into a text box, as paragraphs of HTML; text that's already HTML is left alone. */
export function asHTML(text) {
  if ( !text ) return "";
  if ( /<[a-z][\s\S]*>/i.test(text) ) return text;
  return text.split(/\r?\n\s*\r?\n/).map(p => `<p>${foundry.utils.escapeHTML(p.trim()).replace(/\r?\n/g, "<br>")}</p>`).join("");
}

/** The text of some HTML, for searching and short previews. */
export function plainText(html) {
  const div = document.createElement("div");
  div.innerHTML = html ?? "";
  return (div.textContent ?? "").replace(/\s+/g, " ").trim();
}

export function formatDate(ms) {
  if ( !ms ) return "";
  return new Date(ms).toLocaleDateString(game.i18n.lang, { day: "numeric", month: "short", year: "numeric" });
}

export function loc(key, data) {
  return data ? game.i18n.format(`${L}.${key}`, data) : game.i18n.localize(`${L}.${key}`);
}

/** Name and color of the user who wrote something. */
export function authorOf(userId) {
  const user = game.users.get(userId);
  return { name: user?.name ?? loc("Unknown"), color: user?.color?.css ?? "#8a7d66", isGM: !!user?.isGM };
}

/** Ask before deleting something. Resolves true only if confirmed. */
export async function confirmDelete(name) {
  const result = await foundry.applications.api.DialogV2.confirm({
    window: { title: loc("Delete.Title"), icon: "fa-solid fa-trash" },
    classes: ["wws", "wws-dialog"],
    content: `<p>${loc("Delete.Body", { name: foundry.utils.escapeHTML(name || loc("Untitled")) })}</p>`,
    rejectClose: false,
    modal: true
  });
  return result === true;
}

/** The world document behind a uuid, or null for a missing, unloaded or malformed one. */
export function docSync(uuid) {
  if ( !uuid ) return null;
  try {
    return foundry.utils.fromUuidSync(uuid) ?? null;
  } catch {
    return null;
  }
}

/** Open the sheet of the document behind a uuid, if the user may see it. */
export async function openSheet(uuid) {
  if ( !uuid ) return;
  const doc = await foundry.utils.fromUuid(uuid);
  if ( doc?.testUserPermission?.(game.user, "LIMITED") ) doc.sheet?.render({ force: true });
  else if ( doc ) ui.notifications.warn(loc("Errors.NoPermission"));
}

/** A picture in a lightbox, which a GM can share with everyone from its header. */
export function showImage(src, title) {
  if ( !src ) return;
  const ImagePopout = foundry.applications.apps.ImagePopout;
  new ImagePopout({ src, window: { title }, showTitle: true }).render({ force: true });
}

export const byTitle = (a, b) => (a.title ?? "").localeCompare(b.title ?? "");
export const byName = (a, b) => (a.name ?? "").localeCompare(b.name ?? "");
