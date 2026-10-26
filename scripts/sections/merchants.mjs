import { PATH } from "../config.mjs";
import * as store from "../store.mjs";
import { openEditor } from "../editor.mjs";
import { enrich, asHTML, loc, confirmDelete, openSheet, showToPlayers, viewerNames, worldDate, worldNow, secondsPerDay, byName } from "../helpers.mjs";

/*
 * Merchants: who sells what, for how much, and how many are left. Players browse; the GM edits stock or marks a
 * sale from the page. A merchant can restock every so many days of the world's calendar.
 */
export default {
  id: "merchants",
  template: `${PATH}/templates/sections/merchants.hbs`,

  async prepare(app) {
    const merchants = store.all("merchants").filter(m => store.isVisible("merchants", m)).sort(byName);
    if ( !merchants.some(m => m.id === app.selected.merchants) ) app.selected.merchants = merchants[0]?.id ?? null;
    const merchant = merchants.find(m => m.id === app.selected.merchants);
    return {
      rows: merchants.map(m => ({
        id: m.id, name: m.name || loc("Untitled"), img: m.img, location: m.location, hidden: !m.visible,
        selected: m.id === app.selected.merchants
      })),
      empty: !merchants.length,
      canCreate: game.user.isGM,
      merchant: merchant ? await detail(merchant) : null
    };
  },

  actions: {
    merchantSelect(event, target) {
      this.selected.merchants = target.dataset.id;
      this.render();
    },

    merchantNew() {
      openEditor("merchant", {
        entry: { currency: "gp", visible: false },
        title: loc("Merchants.New"),
        onSave: async data => {
          this.selected.merchants = await store.create("merchants", { ...data, restockedAt: worldNow() });
        }
      });
    },

    merchantEdit(event, target) {
      const merchant = store.get("merchants", target.dataset.id);
      if ( !merchant ) return;
      openEditor("merchant", {
        entry: merchant,
        title: loc("Merchants.Edit", { name: merchant.name }),
        onSave: data => store.update("merchants", merchant.id, data)
      });
    },

    async merchantDelete(event, target) {
      const merchant = store.get("merchants", target.dataset.id);
      if ( merchant && await confirmDelete(merchant.name) ) await store.remove("merchants", merchant.id);
    },

    merchantReveal(event, target) {
      const merchant = store.get("merchants", target.dataset.id);
      if ( merchant ) return store.update("merchants", merchant.id, { visible: !merchant.visible });
    },

    merchantShow(event, target) {
      return showToPlayers("merchants", target.dataset.id);
    },

    /** One sold (-1) or one more in stock (+1). */
    merchantCount(event, target) {
      const merchant = store.get("merchants", target.dataset.id);
      const item = merchant?.stock?.find(s => s.id === target.dataset.item);
      if ( !item || (item.qty === null) || (item.qty === undefined) ) return;
      item.qty = Math.max(0, item.qty + Number(target.dataset.delta));
      return store.update("merchants", merchant.id, { stock: merchant.stock });
    },

    merchantRestock(event, target) {
      const merchant = store.get("merchants", target.dataset.id);
      if ( merchant ) return store.update("merchants", merchant.id, restocked(merchant));
    },

    merchantItem(event, target) {
      return openSheet(target.dataset.uuid);
    },

    merchantFaction(event, target) {
      this.open("factions", target.dataset.faction);
    }
  }
};

/* -------------------------------------------- */

async function detail(merchant) {
  const currency = merchant.currency || "gp";
  const faction = store.get("factions", merchant.faction);
  const days = Number(merchant.restockDays) || 0;
  return {
    ...merchant,
    name: merchant.name || loc("Untitled"),
    hidden: !merchant.visible,
    viewers: game.user.isGM ? viewerNames(merchant) : "",
    description: await enrich(asHTML(merchant.description)),
    faction: store.isVisible("factions", faction) ? { id: faction.id, name: faction.name } : null,
    stock: (merchant.stock ?? []).map(s => ({
      ...s,
      priceLabel: `${Number(s.price ?? 0).toLocaleString(game.i18n.lang)} ${currency}`,
      counted: Number.isFinite(s.qty),
      out: Number.isFinite(s.qty) && (s.qty <= 0)
    })),
    restock: days ? { days, next: worldDate((merchant.restockedAt ?? worldNow()) + (days * secondsPerDay())) } : null
  };
}

/** A merchant's stock refilled to each item's usual amount, as of now. */
function restocked(merchant) {
  const stock = (merchant.stock ?? []).map(s => (Number.isFinite(s.max) ? { ...s, qty: s.max } : s));
  return { stock, restockedAt: worldNow() };
}

/** Restock every merchant whose restocking day has come. Run by the active GM as the world's clock moves. */
export async function restockDue() {
  if ( !game.user.isActiveGM ) return;
  const now = worldNow();
  const due = store.all("merchants").filter(m => {
    const days = Number(m.restockDays) || 0;
    return days && (now >= ((m.restockedAt ?? now) + (days * secondsPerDay())));
  });
  if ( due.length ) await store.updateMany("merchants", Object.fromEntries(due.map(m => [m.id, restocked(m)])));
}
