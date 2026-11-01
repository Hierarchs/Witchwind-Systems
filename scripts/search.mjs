import { L, SECTION_ICONS, LETTER_ICONS } from "./config.mjs";
import * as store from "./store.mjs";
import { plainText, loc, docSync, byTitle } from "./helpers.mjs";
import Codex, { enabledSections } from "./codex.mjs";
import { LocationGallery } from "./locations.mjs";
import { playSound } from "./sounds.mjs";

/*
 * Quick search: Ctrl+K anywhere opens a box to type into, and every quest, note, letter, person, creature, map,
 * marker, faction, merchant, notice, location card and calendar event this user can see is a keystroke away. Up and
 * Down choose, Enter opens it in the book (or the location's gallery), Esc closes. With nothing typed, it lists the
 * book's tabs. The list is built once each time the box opens, from what's already in memory.
 */

/** The most results listed at once. */
const SHOWN = 24;

/** How long the box takes to fade out, in milliseconds. */
const CLOSE_DURATION = 120;

let open = null;

export default class QuickSearch {
  static get isOpen() {
    return !!open;
  }

  static toggle() {
    return open ? open.close() : this.open();
  }

  static open() {
    if ( open ) return open.focus();
    open = new QuickSearch();
    open.render();
  }

  /** Everything findable, built when the box opens. */
  #index = entries();
  #results = [];
  #active = 0;
  #shade = null;
  #input = null;
  #list = null;
  #onKey = this.#keydown.bind(this);
  #returnFocus = document.activeElement;

  render() {
    const shade = this.#shade = document.createElement("div");
    shade.className = "wws wws-search-shade";
    shade.innerHTML = `
      <section class="wws-search-box" role="dialog" aria-modal="true">
        <label class="wws-search-field">
          <i class="fa-solid fa-magnifying-glass" inert></i>
          <input type="text" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="wws-search-results"
                 autocomplete="off" spellcheck="false">
          <kbd>Esc</kbd>
        </label>
        <ol class="wws-search-results" id="wws-search-results" role="listbox"></ol>
        <footer class="wws-search-foot"></footer>
      </section>`;
    const box = shade.querySelector(".wws-search-box");
    box.setAttribute("aria-label", loc("Search.Title"));
    this.#input = shade.querySelector("input");
    this.#input.placeholder = loc("Search.Placeholder");
    this.#list = shade.querySelector(".wws-search-results");
    shade.querySelector(".wws-search-foot").textContent = loc("Search.Hint");

    this.#input.addEventListener("input", () => this.#search());
    shade.addEventListener("pointerdown", event => {
      if ( !box.contains(event.target) ) this.close();
    });
    this.#list.addEventListener("click", event => {
      const row = event.target.closest("[data-index]");
      if ( row ) this.#choose(Number(row.dataset.index));
    });
    this.#list.addEventListener("pointermove", event => {
      const row = event.target.closest("[data-index]");
      if ( row && (Number(row.dataset.index) !== this.#active) ) this.#highlight(Number(row.dataset.index), false);
    });
    window.addEventListener("keydown", this.#onKey, true);
    document.body.append(shade);
    this.#search();
    this.focus();
  }

  focus() {
    this.#input?.focus();
    this.#input?.select();
  }

  async close() {
    if ( open !== this ) return;
    open = null;
    window.removeEventListener("keydown", this.#onKey, true);
    const shade = this.#shade;
    shade.style.pointerEvents = "none";
    if ( !window.matchMedia("(prefers-reduced-motion: reduce)").matches ) {
      const fade = shade.animate([{ opacity: 1 }, { opacity: 0 }], { duration: CLOSE_DURATION, easing: "ease-in", fill: "forwards" });
      await Promise.race([fade.finished, new Promise(r => setTimeout(r, CLOSE_DURATION + 60))]);
    }
    shade.remove();
    if ( this.#returnFocus?.isConnected ) this.#returnFocus.focus?.({ preventScroll: true });
  }

  /** The keys, taken before anything else on the page hears them while the box is open. */
  #keydown(event) {
    const key = event.key;
    const toggle = (key === "k" || key === "K") && (event.ctrlKey || event.metaKey);
    if ( !["Escape", "ArrowDown", "ArrowUp", "Enter", "PageDown", "PageUp"].includes(key) && !toggle ) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if ( (key === "Escape") || toggle ) return this.close();
    if ( key === "Enter" ) return this.#choose(this.#active);
    const step = { ArrowDown: 1, ArrowUp: -1, PageDown: 5, PageUp: -5 }[key];
    const count = this.#results.length;
    if ( !count ) return;
    const next = (Math.abs(step) === 1) ? (this.#active + step + count) % count : Math.clamp(this.#active + step, 0, count - 1);
    this.#highlight(next, true);
  }

  #search() {
    const query = this.#input.value.trim();
    this.#results = query ? find(this.#index, query) : sectionEntries();
    this.#active = 0;
    this.#draw(query);
  }

  #draw(query) {
    const terms = termsOf(query);
    const esc = foundry.utils.escapeHTML;
    this.#list.innerHTML = this.#results.map((r, i) => `
      <li class="wws-search-result${i === this.#active ? " active" : ""}" role="option" id="wws-search-${i}" data-index="${i}"
          aria-selected="${i === this.#active}">
        <span class="wws-search-icon">${r.img ? `<img src="${esc(r.img)}" alt="">` : `<i class="${esc(r.icon)}" inert></i>`}</span>
        <span class="wws-search-text">
          <span class="wws-search-title">${mark(r.title, terms)}</span>
          ${r.detail ? `<span class="wws-search-detail">${mark(r.detail, terms)}</span>` : ""}
        </span>
        <span class="wws-search-kind">${esc(r.kindLabel)}</span>
      </li>`).join("") || `<li class="wws-search-none">${esc(loc("Search.None"))}</li>`;
    this.#input.setAttribute("aria-activedescendant", this.#results.length ? `wws-search-${this.#active}` : "");
  }

  #highlight(index, scroll) {
    this.#list.querySelector(".active")?.classList.remove("active");
    this.#list.querySelector(`[aria-selected="true"]`)?.setAttribute("aria-selected", "false");
    this.#active = index;
    const row = this.#list.querySelector(`[data-index="${index}"]`);
    row?.classList.add("active");
    row?.setAttribute("aria-selected", "true");
    if ( scroll ) row?.scrollIntoView({ block: "nearest" });
    this.#input.setAttribute("aria-activedescendant", `wws-search-${index}`);
  }

  async #choose(index) {
    const result = this.#results[index];
    if ( !result ) return;
    await this.close();
    result.open();
  }
}

/* -------------------------------------------- */
/*  What can be found                           */
/* -------------------------------------------- */

const book = () => Codex.instance;
const visible = kind => store.all(kind).filter(e => store.isVisible(kind, e));

/** The book's tabs, for an empty search: a quick way to any of them. */
function sectionEntries() {
  return enabledSections().map(id => ({
    title: game.i18n.localize(`${L}.Sections.${id}`),
    detail: "",
    icon: SECTION_ICONS[id],
    kindLabel: loc("Search.Kinds.section"),
    open: () => book().open(id)
  }));
}

/** Everything this user can see, as search entries: { title, detail, text, icon, img, kind, open }. */
function entries() {
  const on = new Set(enabledSections());
  const list = [];
  const add = (kind, entry) => list.push({ ...entry, kind, kindLabel: loc(`Search.Kinds.${kind}`), title: entry.title || loc("Untitled") });

  if ( on.has("quests") ) for ( const q of visible("quests") ) {
    add("quest", { title: q.title, detail: [q.location, q.giverName].filter(Boolean).join(" · "), text: plainText(q.description),
      icon: SECTION_ICONS.quests, img: q.img, open: () => book().open("quests", q.id) });
  }
  if ( on.has("journal") ) {
    for ( const n of visible("notes") ) {
      add("note", { title: n.title, detail: game.i18n.localize(`${L}.Journal.Kinds.${n.kind ?? "general"}`), text: plainText(n.body),
        icon: SECTION_ICONS.journal, img: n.img, open: () => book().open("journal", n.id) });
    }
    for ( const l of visible("letters") ) {
      add("letter", { title: l.title, detail: l.sender ? loc("Notice.From", { name: l.sender }) : "", text: plainText(l.body),
        icon: LETTER_ICONS[l.kind] ?? LETTER_ICONS.letter, img: l.img, open: () => book().open("journal", l.id) });
    }
  }
  if ( on.has("bestiary") ) for ( const c of visible("bestiary") ) {
    const known = game.user.isGM || c.knowledge?.basics?.includes("*") || c.knowledge?.basics?.includes(game.user.id);
    add("creature", { title: c.name, detail: known ? (c.type ?? "") : "", text: "", icon: SECTION_ICONS.bestiary, img: c.img,
      open: () => book().open("bestiary", c.id) });
  }
  if ( on.has("maps") ) {
    const maps = new Map(visible("maps").map(m => [m.id, m]));
    for ( const m of maps.values() ) {
      add("map", { title: m.name, detail: "", text: "", icon: SECTION_ICONS.maps, img: m.img, open: () => book().open("maps", m.id) });
    }
    for ( const p of visible("pins").filter(p => maps.has(p.map)) ) {
      add("marker", { title: p.label, detail: maps.get(p.map).name ?? "", text: plainText(p.text), icon: "fa-solid fa-location-dot",
        open: () => book().showPin(p) });
    }
  }
  if ( on.has("factions") ) for ( const f of visible("factions") ) {
    add("faction", { title: f.name, detail: f.motto ?? "", text: plainText(f.description), icon: SECTION_ICONS.factions, img: f.img,
      open: () => book().open("factions", f.id) });
  }
  if ( on.has("merchants") ) for ( const m of visible("merchants") ) {
    add("merchant", { title: m.name, detail: m.location ?? "", text: (m.stock ?? []).map(s => s.name).join(" "),
      icon: SECTION_ICONS.merchants, img: m.img, open: () => book().open("merchants", m.id) });
  }
  if ( on.has("notices") ) for ( const n of visible("notices") ) {
    add("notice", { title: n.title, detail: [n.requester, n.reward].filter(Boolean).join(" · "), text: plainText(n.body),
      icon: SECTION_ICONS.notices, open: () => book().open("notices", n.id) });
  }
  if ( on.has("calendar") ) for ( const e of visible("events") ) {
    add("event", { title: e.title, detail: "", text: plainText(e.description ?? ""), icon: e.icon || SECTION_ICONS.calendar,
      open: () => book().open("calendar", e.id) });
  }
  // Trophies, but not a secret one a player hasn't earned yet, nor one the GM has switched off.
  if ( on.has("chronicle") ) for ( const t of store.all("trophies") ) {
    if ( !game.user.isGM && ((t.enabled === false) || (t.secret && !t.earned?.length)) ) continue;
    add("trophy", { title: t.name, detail: loc(`Trophies.Tiers.${t.tier ?? "bronze"}`), text: t.description ?? "",
      icon: t.icon || SECTION_ICONS.chronicle, img: t.img, open: () => book().open("chronicle", t.id) });
  }
  for ( const l of visible("locations") ) {
    add("location", { title: l.title, detail: l.kicker ?? "", text: plainText(l.body), icon: "fa-solid fa-map-location-dot",
      img: l.img, open: () => LocationGallery.open(l.id) });
  }
  for ( const person of people(on) ) add("person", person);
  return list;
}

/**
 * The people the party knows of: the members of the factions they can see, who aren't the players' own characters,
 * and the people who gave them quests. Each is listed once, and opens the faction or the quest they're known from.
 */
function people(on) {
  const found = new Map();
  const keyOf = (uuid, name) => uuid || String(name ?? "").trim().toLowerCase();
  if ( on.has("factions") ) for ( const f of visible("factions").sort(byName) ) {
    for ( const m of f.members ?? [] ) {
      const actor = docSync(m.uuid);
      if ( actor?.hasPlayerOwner ) continue;
      const key = keyOf(m.uuid, m.name);
      if ( !key || found.has(key) ) continue;
      const rank = (m.rank ?? 0) >= 0 ? (f.ranks?.[m.rank] ?? "") : "";
      found.set(key, { title: actor?.name ?? m.name, detail: [f.name, rank].filter(Boolean).join(" · "), text: "",
        icon: "fa-solid fa-user", img: m.img || actor?.img, open: () => book().open("factions", f.id) });
    }
  }
  if ( on.has("quests") ) for ( const q of visible("quests").sort(byTitle) ) {
    if ( !q.giverName ) continue;
    const key = keyOf(q.giverUuid, q.giverName);
    if ( found.has(key) ) continue;
    found.set(key, { title: q.giverName, detail: loc("Search.Gave", { quest: q.title || loc("Untitled") }), text: "",
      icon: "fa-solid fa-user", img: q.giverImg, open: () => book().open("quests", q.id) });
  }
  return found.values();
}

const byName = (a, b) => (a.name ?? "").localeCompare(b.name ?? "");

/* -------------------------------------------- */
/*  Matching                                    */
/* -------------------------------------------- */

const termsOf = query => query.toLowerCase().split(/\s+/).filter(Boolean);

/**
 * Entries matching every word typed, best first: a title that starts with the word, then one with a word starting
 * with it, then one containing it, then a match in the detail line, then one in the text.
 */
function find(index, query) {
  const terms = termsOf(query);
  const scored = [];
  for ( const entry of index ) {
    const title = entry.title.toLowerCase();
    const words = title.split(/[\s'’\-–,.:()]+/);
    const detail = (entry.detail ?? "").toLowerCase();
    const text = (entry.text ?? "").toLowerCase();
    let score = 0;
    for ( const term of terms ) {
      if ( title.startsWith(term) ) score += 40;
      else if ( words.some(w => w.startsWith(term)) ) score += 25;
      else if ( title.includes(term) ) score += 15;
      else if ( detail.includes(term) ) score += 6;
      else if ( text.includes(term) ) score += 2;
      else {
        score = 0;
        break;
      }
    }
    if ( score ) scored.push({ entry, score: score - (title.length / 100) });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, SHOWN).map(s => s.entry);
}

/** Text with each word typed marked, escaped for the page. */
function mark(text, terms) {
  const esc = foundry.utils.escapeHTML;
  if ( !terms.length ) return esc(text);
  const pattern = new RegExp(`(${terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return String(text).split(pattern).map((part, i) => (i % 2 ? `<mark>${esc(part)}</mark>` : esc(part))).join("");
}

/** The sound of the box opening is a page turning, as the book's own are. */
export function openSearch() {
  if ( !QuickSearch.isOpen ) playSound("page");
  QuickSearch.toggle();
}
