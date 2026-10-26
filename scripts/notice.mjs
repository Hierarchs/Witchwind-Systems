import { MODULE_ID, L } from "./config.mjs";
import { playSound } from "./sounds.mjs";
import { formatDate } from "./helpers.mjs";

/*
 * Oblivion's "Quest added" box, in Witchwind's leather and parchment: the quest's icon, name and the date in the
 * world's own calendar, a line about it, and Continue. It waits for Continue (or Enter or Esc), and one follows
 * another when several arrive together. View Quest opens the book at it.
 */

/** How long the box takes to fade away, in milliseconds. */
const CLOSE_DURATION = 160;

const queue = [];
let showing = false;

/** Queue a pop-up: { label, title, detail, img, icon, questId, tone }. */
export function showNotice(notice) {
  queue.push(notice);
  if ( !showing ) next();
}

function next() {
  const notice = queue.shift();
  if ( !notice ) {
    showing = false;
    return;
  }
  showing = true;
  const returnFocus = document.activeElement;
  const shade = document.createElement("div");
  shade.className = `wws wws-notice-shade wws-tone-${notice.tone ?? "gold"}`;
  const id = `wws-notice-${foundry.utils.randomID()}`;
  shade.innerHTML = `
    <section class="wws-notice" role="alertdialog" aria-modal="true" aria-labelledby="${id}">
      <div class="wws-notice-page">
        <h2 class="wws-notice-label" id="${id}"></h2>
        <div class="wws-notice-quest">
          <span class="wws-notice-icon"></span>
          <div class="wws-notice-heading">
            <h3 class="wws-notice-title"></h3>
            <p class="wws-notice-date"></p>
          </div>
        </div>
        <p class="wws-notice-text"></p>
        <footer class="wws-notice-buttons">
          <button type="button" class="wws-button" data-notice="view"></button>
          <button type="button" class="wws-ink" data-notice="continue"></button>
        </footer>
      </div>
    </section>`;

  // Everything shown is set as text, never as HTML: titles and entries can come from anyone at the table.
  const t = key => game.i18n.localize(`${L}.Notice.${key}`);
  shade.querySelector(".wws-notice-label").textContent = notice.label;
  shade.querySelector(".wws-notice-title").textContent = notice.title;
  shade.querySelector(".wws-notice-date").textContent = worldDate();
  const text = shade.querySelector(".wws-notice-text");
  if ( notice.detail ) text.textContent = notice.detail;
  else text.remove();
  const icon = shade.querySelector(".wws-notice-icon");
  if ( notice.img ) {
    const img = document.createElement("img");
    img.src = notice.img;
    img.alt = "";
    icon.append(img);
  } else {
    const i = document.createElement("i");
    i.className = notice.icon ?? "fa-solid fa-scroll-old";
    icon.append(i);
  }
  const view = shade.querySelector("[data-notice=view]");
  view.textContent = t("View");
  if ( !notice.questId ) view.remove();
  const proceed = shade.querySelector("[data-notice=continue]");
  proceed.textContent = t("Continue");

  // Enter and Esc continue, and go no further: Foundry would otherwise open its menu or act on the canvas.
  const onKey = event => {
    if ( !["Escape", "Enter"].includes(event.key) ) return;
    if ( (event.key === "Enter") && (event.target === view) ) return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };

  const close = async (openQuest=false) => {
    window.removeEventListener("keydown", onKey, { capture: true });
    shade.style.pointerEvents = "none";
    if ( !window.matchMedia("(prefers-reduced-motion: reduce)").matches ) {
      const fade = shade.animate([{ opacity: 1 }, { opacity: 0 }], { duration: CLOSE_DURATION, easing: "ease-in", fill: "forwards" });
      await Promise.race([fade.finished, new Promise(r => setTimeout(r, CLOSE_DURATION + 60))]);
    }
    shade.remove();
    if ( openQuest ) game.modules.get(MODULE_ID).api.open("quests", notice.questId);
    else if ( returnFocus?.isConnected ) returnFocus.focus?.();
    next();
  };

  proceed.addEventListener("click", () => close());
  view.addEventListener("click", () => close(true));
  window.addEventListener("keydown", onKey, { capture: true });
  document.body.append(shade);
  proceed.focus();
  playSound("quest");
}

/** Today in the world's calendar, Oblivion style ("27th of Last Seed, 433"), or the real date if there's none. */
function worldDate() {
  try {
    const calendar = game.time.calendar;
    const c = calendar.timeToComponents(game.time.worldTime);
    const month = calendar.months?.values?.[c.month];
    const day = c.dayOfMonth + 1;
    if ( month && Number.isFinite(day) ) {
      return game.i18n.format(`${L}.Notice.Date`, { day: ordinal(day), month: game.i18n.localize(month.name), year: c.year });
    }
  } catch {}
  return formatDate(Date.now());
}

function ordinal(n) {
  const suffixes = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${suffixes[(v - 20) % 10] ?? suffixes[v] ?? suffixes[0]}`;
}
