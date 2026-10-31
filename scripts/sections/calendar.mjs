import { PATH, EVENT_ICONS, MOON_PHASES, PIN_COLORS } from "../config.mjs";
import * as store from "../store.mjs";
import { openEditor } from "../editor.mjs";
import { enrich, asHTML, loc, confirmDelete } from "../helpers.mjs";
import {
  dayOf, dateOf, dayFromDate, daysInMonth, months, weekdays, dayLabel, relativeDay, eventOn, eventsOn, eventColor,
  moonsOn, moonMark, moonPath, newDay
} from "../calendar.mjs";

/** How many days ahead Coming Up looks, and how much it lists. */
const UPCOMING_DAYS = 30;
const UPCOMING_SHOWN = 8;

/** The most marks a day of the month shows before "+2". */
const MARKS_SHOWN = 3;

/*
 * The calendar: the month on the left page, the chosen day on the right, with its holidays and events, each moon's
 * phase, the quests due that day and, for the GM, the letters arriving. The GM moves the world on a day at a time.
 */
export default {
  id: "calendar",
  template: `${PATH}/templates/sections/calendar.hbs`,

  async prepare(app) {
    const isGM = game.user.isGM;
    const today = dayOf();

    // An event opened by its id shows the day it next falls on. When the clock moves on, a chosen day that was today
    // follows today, month and all.
    if ( typeof app.selected.calendar === "string" ) {
      app.selected.calendar = nextDayOf(store.get("events", app.selected.calendar), today) ?? today;
      app.calendarMonth = null;
    }
    const followed = app.calendarToday;
    if ( !Number.isFinite(app.selected.calendar) ) app.selected.calendar = today;
    else if ( Number.isFinite(followed) && (followed !== today) && (app.selected.calendar === followed) ) {
      app.selected.calendar = today;
      app.calendarMonth = null;
    }
    app.calendarToday = today;
    const selected = app.selected.calendar;
    const shown = app.calendarMonth ??= monthOf(selected);

    const monthList = months();
    const events = store.all("events").filter(e => store.isVisible("events", e));
    const quests = store.all("quests").filter(q => store.isVisible("quests", q) && hasDeadline(q));
    const letters = isGM ? store.all("letters").filter(l => l.arrival) : [];
    const moons = store.moons();

    // The month: blank days to the first weekday, then each day with its marks.
    const week = Math.max(1, weekdays().length || 7);
    const first = dayFromDate({ year: shown.year, month: shown.month, day: 1 });
    const lead = ((dateOf(first)?.weekday ?? 0) % week + week) % week;
    const cells = Array.from({ length: lead }, () => ({ blank: true }));
    for ( let d = 1; d <= daysInMonth(shown.year, shown.month); d++ ) {
      const day = first + d - 1;
      const date = { year: shown.year, month: shown.month, day: d };
      const marks = [
        ...events.filter(e => eventOn(e, date)).map(e => ({ icon: e.icon || EVENT_ICONS[0], color: eventColor(e), label: e.title })),
        ...quests.filter(q => Number(q.deadline) === day).map(q => ({ icon: "fa-solid fa-hourglass-half", color: "", label: q.title, deadline: true })),
        ...letters.filter(l => dayOf(l.arrival) === day).map(l => ({ icon: "fa-solid fa-envelope", color: "", label: l.title }))
      ];
      cells.push({
        day: d,
        dayNumber: day,
        label: dayLabel(day),
        today: day === today,
        selected: day === selected,
        past: day < today,
        moons: moons.map(m => ({ m, phase: moonMark(m, day) })).filter(x => x.phase >= 0).slice(0, 2)
          .map(({ m, phase }) => ({ path: moonPath(phase / MOON_PHASES.length, 10), color: moonColor(m) })),
        marks: marks.slice(0, MARKS_SHOWN),
        more: Math.max(0, marks.length - MARKS_SHOWN),
        tooltip: marks.map(m => m.label).filter(Boolean).join(" · ")
      });
    }
    while ( cells.length % week ) cells.push({ blank: true });

    return {
      isGM,
      monthName: monthList[shown.month]?.name ?? "",
      year: shown.year,
      weekdays: weekdays(),
      week,
      cells,
      todayLabel: dayLabel(today),
      showingToday: (shown.year === dateOf(today)?.year) && (shown.month === dateOf(today)?.month),
      hasMoons: moons.length > 0,
      day: await dayDetail(selected, today, quests, letters),
      upcoming: upcoming(today, events, quests)
    };
  },

  actions: {
    /** The month before (-1) or after (1) the one shown. */
    calendarMonth(event, target) {
      const count = months().length || 12;
      let { year, month } = this.calendarMonth ?? monthOf(dayOf());
      month += Number(target.dataset.delta) || 0;
      if ( month < 0 ) { month = count - 1; year -= 1; }
      else if ( month >= count ) { month = 0; year += 1; }
      this.calendarMonth = { year, month };
      this.filters.calendar = `${year}-${month}`;
      this.render();
    },

    calendarToday() {
      goTo(this, dayOf());
    },

    calendarDay(event, target) {
      this.selected.calendar = Number(target.dataset.day);
      this.render();
    },

    /** A day from Coming Up, with its month. */
    calendarGo(event, target) {
      goTo(this, Number(target.dataset.day));
    },

    calendarNewDay() {
      return newDay();
    },

    calendarEventNew() {
      const date = dateOf(this.selected.calendar) ?? dateOf(dayOf());
      openEditor("event", {
        entry: { month: date.month, day: date.day, year: date.year, yearly: false, visible: true, color: "gold", icon: EVENT_ICONS[0] },
        title: loc("Calendar.NewEvent"),
        onSave: data => store.create("events", data)
      });
    },

    calendarEventEdit(event, target) {
      const entry = store.get("events", target.dataset.id);
      if ( !entry ) return;
      openEditor("event", {
        entry,
        title: loc("Calendar.EditEvent", { name: entry.title }),
        onSave: data => store.update("events", entry.id, data)
      });
    },

    async calendarEventDelete(event, target) {
      const entry = store.get("events", target.dataset.id);
      if ( entry && await confirmDelete(entry.title) ) await store.remove("events", entry.id);
    },

    calendarEventVisible(event, target) {
      const entry = store.get("events", target.dataset.id);
      if ( entry ) return store.update("events", entry.id, { visible: !entry.visible });
    },

    calendarMoons() {
      openEditor("moons", {
        entry: { id: "moons", moons: store.moons() },
        title: loc("Calendar.EditMoons"),
        onSave: data => store.setMoons(data.moons)
      });
    },

    calendarQuest(event, target) {
      this.open("quests", target.dataset.id);
    },

    calendarLetter(event, target) {
      this.open("journal", target.dataset.id);
    }
  }
};

/* -------------------------------------------- */

const hasDeadline = q => (q.deadline !== null) && (q.deadline !== undefined) && (q.deadline !== "") && Number.isFinite(Number(q.deadline));

function monthOf(day) {
  const date = dateOf(day);
  return date ? { year: date.year, month: date.month } : { year: 0, month: 0 };
}

const moonColor = moon => PIN_COLORS[moon.color] ?? PIN_COLORS.ivory;

/** Choose a day and show its month. */
function goTo(app, day) {
  app.selected.calendar = day;
  app.calendarMonth = monthOf(day);
  app.filters.calendar = `${app.calendarMonth.year}-${app.calendarMonth.month}`;
  app.render();
}

/** The next day an event falls on, from today: this year's (or next year's) for a holiday, its own date otherwise. */
function nextDayOf(event, today) {
  if ( !event ) return null;
  if ( !event.yearly ) return dayFromDate({ year: event.year, month: event.month, day: event.day });
  const year = dateOf(today)?.year ?? 0;
  const day = dayFromDate({ year, month: event.month, day: event.day });
  return day >= today ? day : dayFromDate({ year: year + 1, month: event.month, day: event.day });
}

/** Everything on one day, for the right-hand page. */
async function dayDetail(day, today, quests, letters) {
  const events = await Promise.all(eventsOn(day).map(async e => ({
    id: e.id,
    title: e.title || loc("Untitled"),
    yearly: !!e.yearly,
    icon: e.icon || EVENT_ICONS[0],
    color: eventColor(e),
    hidden: !e.visible,
    description: await enrich(asHTML(e.description ?? ""))
  })));
  const due = quests.filter(q => Number(q.deadline) === day).map(q => ({
    id: q.id, title: q.title || loc("Untitled"), status: q.status ?? "active"
  }));
  const arriving = letters.filter(l => dayOf(l.arrival) === day).map(l => ({ id: l.id, title: l.title || loc("Untitled") }));
  return {
    number: day,
    label: dayLabel(day),
    relative: relativeDay(day, today),
    isToday: day === today,
    moons: moonsOn(day),
    events,
    due,
    arriving,
    empty: !events.length && !due.length && !arriving.length
  };
}

/** What's coming in the next month: holidays, events and quest deadlines, soonest first. */
function upcoming(today, events, quests) {
  const items = [];
  for ( let day = today + 1; (day <= today + UPCOMING_DAYS) && (items.length < UPCOMING_SHOWN); day++ ) {
    const date = dateOf(day);
    for ( const e of events.filter(e => eventOn(e, date)) ) {
      items.push({ day, when: relativeDay(day, today), title: e.title || loc("Untitled"), icon: e.icon || EVENT_ICONS[0], color: eventColor(e) });
    }
    for ( const q of quests.filter(q => (Number(q.deadline) === day) && ((q.status ?? "active") === "active")) ) {
      items.push({ day, when: relativeDay(day, today), title: q.title || loc("Untitled"), icon: "fa-solid fa-hourglass-half", deadline: true });
    }
  }
  return items.slice(0, UPCOMING_SHOWN);
}
