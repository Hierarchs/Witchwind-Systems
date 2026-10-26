import { MODULE_ID, L } from "./config.mjs";
import * as store from "./store.mjs";
import { factionPlaces } from "./sections/renown.mjs";

/*
 * On dnd5e character and NPC sheets: a small Renown card in the sidebar with the character's titles and their
 * rank and standing in each faction they're known to. Each opens the book at it.
 */

export function registerSheet() {
  Hooks.on("renderCharacterActorSheet", onRenderSheet);
  Hooks.on("renderNPCActorSheet", onRenderSheet);

  // Titles and factions change what the card shows, so open sheets are redrawn when they do.
  store.onChange(kind => {
    if ( !["titles", "factions"].includes(kind) ) return;
    for ( const app of foundry.applications.instances.values() ) {
      if ( app.rendered && (app.document?.documentName === "Actor") && app.element.querySelector(".wws-sheet-renown") ) app.render();
    }
  });
}

function onRenderSheet(app, element) {
  const actor = app.document;
  if ( !actor || !game.settings.get(MODULE_ID, "sheetRenown") ) return;
  element.querySelector(".wws-sheet-renown")?.remove();

  const titles = !game.settings.get(MODULE_ID, "showRenown") ? [] : store.all("titles")
    .filter(t => (t.uuid === actor.uuid) && store.isVisible("titles", t)).sort((a, b) => (b.date ?? 0) - (a.date ?? 0));
  const places = game.settings.get(MODULE_ID, "showFactions") ? factionPlaces(actor.uuid) : [];
  if ( !titles.length && !places.length ) return;

  const t = key => game.i18n.localize(`${L}.${key}`);
  const card = document.createElement("section");
  card.className = "wws wws-sheet-renown";
  const head = document.createElement("h3");
  head.innerHTML = `<i class="fa-solid fa-crown" inert></i> <span></span>`;
  head.querySelector("span").textContent = t("Sections.renown");
  card.append(head);

  const open = (section, id) => () => game.modules.get(MODULE_ID).api.open(section, id);
  if ( titles.length ) {
    const list = document.createElement("ul");
    list.className = "wws-sheet-titles";
    for ( const title of titles ) {
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.innerHTML = `<i inert></i> <span></span>`;
      button.querySelector("i").className = title.icon || "fa-solid fa-crown";
      button.querySelector("span").textContent = title.name;
      if ( title.reason ) button.dataset.tooltip = title.reason;
      button.addEventListener("click", open("renown", actor.uuid));
      li.append(button);
      list.append(li);
    }
    card.append(list);
  }

  if ( places.length ) {
    const list = document.createElement("ul");
    list.className = "wws-sheet-factions";
    for ( const place of places ) {
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.innerHTML = `<span class="wws-sheet-emblem"></span><span class="wws-sheet-faction"><strong></strong><span></span></span>
        <span class="wws-tier wws-tier-${place.tier}"></span>`;
      const emblem = button.querySelector(".wws-sheet-emblem");
      if ( place.img ) {
        const img = document.createElement("img");
        img.src = place.img;
        img.alt = "";
        emblem.append(img);
      } else emblem.innerHTML = `<i class="fa-solid fa-chess-rook" inert></i>`;
      button.querySelector("strong").textContent = place.name;
      button.querySelector(".wws-sheet-faction > span").textContent = place.rankName;
      button.querySelector(".wws-tier").textContent = place.tierLabel;
      button.dataset.tooltip = `${place.tierLabel} (${place.standingLabel})`;
      button.addEventListener("click", open("factions", place.id));
      li.append(button);
      list.append(li);
    }
    card.append(list);
  }

  // In the sheet's sidebar, under its first card; on sheets laid out otherwise, at the top of the content.
  const sidebar = element.querySelector(".sidebar");
  const anchor = sidebar?.querySelector(":scope > .card");
  if ( anchor ) anchor.after(card);
  else if ( sidebar ) sidebar.prepend(card);
  else element.querySelector(".window-content")?.prepend(card);
}
