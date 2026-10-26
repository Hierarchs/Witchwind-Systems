import { L } from "./config.mjs";
import * as store from "./store.mjs";
import { broadcast } from "./socket.mjs";

/** The collection behind each section. */
export const SECTION_KINDS = {
  quests: "quests", journal: "notes", bestiary: "bestiary", notices: "notices", maps: "maps", factions: "factions", merchants: "merchants"
};

/** The collection an entry lives in: the journal holds both notes and letters. */
export function resolveKind(section, id) {
  if ( (section === "journal") && !store.get("notes", id) && store.get("letters", id) ) return "letters";
  return SECTION_KINDS[section];
}

/**
 * Whether a player knows a fact about a creature. Each fact lists "*" (everyone) or the ids of the players it's
 * been revealed to. The GM knows everything.
 */
export function knows(entry, key, user=game.user) {
  if ( user.isGM ) return true;
  const who = entry?.knowledge?.[key] ?? [];
  return who.includes("*") || who.includes(user.id);
}

/** Open an entry on every player's screen, revealing it first if it was hidden. GM only. */
export async function showToPlayers(section, id) {
  const kind = resolveKind(section, id);
  const entry = store.get(kind, id);
  if ( !game.user.isGM || !entry ) return;
  if ( kind === "notes" ) {
    if ( !entry.shared ) await store.update(kind, id, { shared: true });
  }
  else if ( !entry.visible ) await store.update(kind, id, { visible: true });
  broadcast("show", { section, id });
  ui.notifications.info(loc("ShownToPlayers"));
}

/** How many enriched texts and plain-text extracts are remembered. */
const MEMO_SIZE = 400;

/** Remember a function's results by their string argument, forgetting the oldest past MEMO_SIZE. */
function memo(fn) {
  const results = new Map();
  return text => {
    if ( results.has(text) ) return results.get(text);
    const result = fn(text);
    results.set(text, result);
    if ( results.size > MEMO_SIZE ) results.delete(results.keys().next().value);
    return result;
  };
}

/**
 * Clean stored HTML (it may have come from any player) and enrich its links and rolls for display. Each text is
 * enriched once and remembered, since every re-render would otherwise enrich every description and entry again.
 */
const enrichOnce = memo(html => {
  const TextEditor = foundry.applications.ux.TextEditor.implementation;
  const cleaned = foundry.utils.cleanHTML(html);
  return TextEditor.enrichHTML(cleaned, { secrets: game.user.isGM }).catch(() => cleaned);
});

export async function enrich(html) {
  return html ? enrichOnce(html) : "";
}

/** Plain text typed into a text box, as paragraphs of HTML; text that's already HTML is left alone. */
export function asHTML(text) {
  if ( !text ) return "";
  if ( /<[a-z][\s\S]*>/i.test(text) ) return text;
  return text.split(/\r?\n\s*\r?\n/).map(p => `<p>${foundry.utils.escapeHTML(p.trim()).replace(/\r?\n/g, "<br>")}</p>`).join("");
}

/** The text of some HTML, for searching and short previews. Parsed without running anything, and remembered. */
const parser = new DOMParser();
const plainTextOnce = memo(html => {
  const text = parser.parseFromString(html, "text/html").body.textContent ?? "";
  return text.replace(/\s+/g, " ").trim();
});

export function plainText(html) {
  return html ? plainTextOnce(html) : "";
}

/** The world's time now, in seconds. */
export function worldNow() {
  return game.time?.worldTime ?? 0;
}

/** Seconds in a day of the world's calendar. */
export function secondsPerDay() {
  const d = game.time?.calendar?.days;
  const seconds = d ? d.hoursPerDay * d.minutesPerHour * d.secondsPerMinute : 0;
  return seconds > 0 ? seconds : 86400;
}

/** A world time as a date in the world's calendar, Oblivion style ("Highsun, 27th of First Harvest, 433"). */
export function worldDate(time=worldNow()) {
  try {
    const calendar = game.time.calendar;
    const c = calendar.timeToComponents(time);
    const month = calendar.months?.values?.[c.month];
    const weekday = calendar.days?.values?.[c.dayOfWeek];
    const day = c.dayOfMonth + 1;
    if ( month && Number.isFinite(day) ) {
      const data = { day: ordinal(day), month: game.i18n.localize(month.name), year: c.year };
      if ( weekday ) return game.i18n.format(`${L}.Notice.DateWeekday`, { ...data, weekday: game.i18n.localize(weekday.name) });
      return game.i18n.format(`${L}.Notice.Date`, data);
    }
  } catch {}
  return formatDate(Date.now());
}

function ordinal(n) {
  const suffixes = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${suffixes[(v - 20) % 10] ?? suffixes[v] ?? suffixes[0]}`;
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

/** The names of the players an entry is limited to, or "" when it isn't limited. */
export function viewerNames(entry) {
  return (entry?.viewers ?? []).map(id => game.users.get(id)?.name).filter(Boolean).join(", ");
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

/** The party's characters, and anyone else who holds a title. */
export function partyCharacters(titles=store.all("titles")) {
  const people = new Map();
  for ( const actor of game.actors?.filter(a => a.hasPlayerOwner) ?? [] ) {
    people.set(actor.uuid, { uuid: actor.uuid, name: actor.name, img: actor.img });
  }
  for ( const t of titles ) {
    if ( people.has(t.uuid) ) continue;
    const actor = docSync(t.uuid);
    if ( actor ) people.set(t.uuid, { uuid: t.uuid, name: actor.name, img: actor.img });
  }
  return [...people.values()].sort(byName);
}

/** Days from now until a world time, rounded up; 0 for now or the past. */
export function daysUntil(time) {
  return time ? Math.max(0, Math.ceil((time - worldNow()) / secondsPerDay())) : 0;
}
