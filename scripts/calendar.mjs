import { MODULE_ID, L, MOON_PHASES, PIN_COLORS } from "./config.mjs";
import * as store from "./store.mjs";
import { worldNow, secondsPerDay, worldDate } from "./helpers.mjs";
import { announce } from "./banner.mjs";

/*
 * The world's calendar counted in days: day 0 is the first day of the world's clock, and events, quest deadlines and
 * moons are all reckoned in whole days from it. A date is { year, month, day }, the month counted from 0 as Foundry's
 * calendar counts it and the day of the month from 1, as people write it.
 */

const calendar = () => game.time?.calendar;

/** The day a world time falls on. */
export function dayOf(time=worldNow()) {
  return Math.floor(time / secondsPerDay());
}

/** The world time a day begins. */
export function startOfDay(day) {
  return day * secondsPerDay();
}

/** The calendar's months, each { index, name, days }. */
export function months() {
  return (calendar()?.months?.values ?? []).map((m, index) => ({
    index, name: game.i18n.localize(m.name ?? ""), days: Number(m.days) || 0
  }));
}

/** The calendar's weekdays, as short names. */
export function weekdays() {
  return (calendar()?.days?.values ?? []).map(d => game.i18n.localize(d.abbreviation || d.name || ""));
}

export function daysInMonth(year, month) {
  const m = calendar()?.months?.values?.[month];
  if ( !m ) return 30;
  const leap = !!calendar().isLeapYear?.(year);
  return (leap && Number.isFinite(m.leapDays)) ? m.leapDays : (Number(m.days) || 30);
}

/** The date a day falls on: { year, month, day, weekday }. */
export function dateOf(day) {
  try {
    const c = calendar()?.timeToComponents?.(startOfDay(day));
    if ( c && Number.isFinite(c.month) ) return { year: c.year, month: c.month, day: c.dayOfMonth + 1, weekday: c.dayOfWeek ?? 0 };
  } catch {}
  return null;
}

/** The day a date falls on. */
export function dayFromDate({ year, month, day }) {
  const cal = calendar();
  let dayOfYear = Math.max(1, day) - 1;
  for ( let m = 0; m < month; m++ ) dayOfYear += daysInMonth(year, m);
  if ( cal?.componentsToTime ) return dayOf(cal.componentsToTime({ year, day: dayOfYear, hour: 0, minute: 0, second: 0 }));
  // A calendar without Foundry's own conversion: whole years of the same length from its year zero.
  const perYear = cal?.days?.daysPerYear || 360;
  return ((year - (cal?.years?.yearZero ?? 0)) * perYear) + dayOfYear;
}

/** A day written out, as the book writes dates ("Highsun, 27th of First Harvest, 433"). */
export function dayLabel(day) {
  return worldDate(startOfDay(day));
}

/** How far a day is from today, in words: Today, Tomorrow, In 3 days, 2 days ago. */
export function relativeDay(day, today=dayOf()) {
  const n = day - today;
  if ( n === 0 ) return game.i18n.localize(`${L}.Calendar.Today`);
  if ( n === 1 ) return game.i18n.localize(`${L}.Calendar.Tomorrow`);
  if ( n === -1 ) return game.i18n.localize(`${L}.Calendar.Yesterday`);
  return n > 0 ? game.i18n.format(`${L}.Calendar.InDays`, { n }) : game.i18n.format(`${L}.Calendar.DaysAgo`, { n: -n });
}

/* -------------------------------------------- */
/*  Events                                      */
/* -------------------------------------------- */

/** Whether an event falls on a date: a holiday on its day every year, any other event on its one date. */
export function eventOn(event, date) {
  if ( !date || (event.month !== date.month) || (event.day !== date.day) ) return false;
  return event.yearly || (event.year === date.year);
}

/** The events this user may see on a day. */
export function eventsOn(day) {
  const date = dateOf(day);
  return store.all("events").filter(e => store.isVisible("events", e) && eventOn(e, date))
    .sort((a, b) => (b.yearly - a.yearly) || (a.title ?? "").localeCompare(b.title ?? ""));
}

/** An event's colour as a CSS value. */
export function eventColor(event) {
  return PIN_COLORS[event?.color] ?? PIN_COLORS.gold;
}

/* -------------------------------------------- */
/*  Moons                                       */
/* -------------------------------------------- */

const cycleOf = moon => Math.max(1, Number(moon.cycle) || 30);

/** How far through its cycle a moon is on a day, from 0 (new) through 0.5 (full) to nearly 1. */
export function moonFraction(moon, day) {
  const cycle = cycleOf(moon);
  return ((((day - (Number(moon.offset) || 0)) % cycle) + cycle) % cycle) / cycle;
}

/** The phase a moon shows on a day, by its index in MOON_PHASES. */
export function moonPhase(moon, day) {
  return Math.round(moonFraction(moon, day) * MOON_PHASES.length) % MOON_PHASES.length;
}

/** The offset that puts a moon at a phase today, for the editor's "Today it's…" choice. */
export function offsetFor(cycle, phase, today=dayOf()) {
  return today - ((phase / MOON_PHASES.length) * Math.max(1, Number(cycle) || 30));
}

/**
 * Whether a day is the one a moon is nearest to new, full or a quarter: the four days of each cycle worth marking on
 * the month. Returns that phase's index, or -1.
 */
export function moonMark(moon, day) {
  const distance = (d, target) => {
    const f = Math.abs(moonFraction(moon, d) - target);
    return Math.min(f, 1 - f);
  };
  for ( const index of [0, 2, 4, 6] ) {
    const target = index / MOON_PHASES.length;
    const here = distance(day, target);
    if ( (here <= distance(day - 1, target)) && (here < distance(day + 1, target)) && (here < 0.0625) ) return index;
  }
  return -1;
}

/**
 * An SVG path for the lit part of a moon at a point in its cycle, in a circle of radius r around 0,0: the lit half's
 * rim, then the line between light and dark back to the top. Waxing moons are lit on the right.
 */
export function moonPath(fraction, r=10) {
  const angle = 2 * Math.PI * fraction;
  const lit = (1 - Math.cos(angle)) / 2;
  const n = v => Math.round(v * 100) / 100;
  if ( lit < 0.02 ) return "";
  if ( lit > 0.98 ) return `M 0 ${-r} A ${r} ${r} 0 1 1 0 ${r} A ${r} ${r} 0 1 1 0 ${-r} Z`;
  const waxing = fraction < 0.5;
  const gibbous = lit > 0.5;
  const rx = n(r * Math.abs(Math.cos(angle)));
  return `M 0 ${-r} A ${r} ${r} 0 0 ${waxing ? 1 : 0} 0 ${r} A ${rx} ${r} 0 0 ${(waxing === gibbous) ? 1 : 0} 0 ${-r} Z`;
}

/** Each moon on a day, ready to draw: { name, phase, label, path, color }. */
export function moonsOn(day) {
  return store.moons().map(moon => {
    const phase = moonPhase(moon, day);
    return {
      id: moon.id,
      name: moon.name || game.i18n.localize(`${L}.Calendar.Moon`),
      phase: MOON_PHASES[phase],
      label: game.i18n.localize(`${L}.Calendar.Phases.${MOON_PHASES[phase]}`),
      path: moonPath(moonFraction(moon, day)),
      color: PIN_COLORS[moon.color] ?? PIN_COLORS.ivory
    };
  });
}

/* -------------------------------------------- */
/*  Deadlines                                   */
/* -------------------------------------------- */

/** A quest's deadline for its page: the day, how far off it is, and whether it's near or past. */
export function deadlineOf(quest, today=dayOf()) {
  const day = Number(quest?.deadline);
  if ( !Number.isFinite(day) || (quest.deadline === null) || (quest.deadline === "") ) return null;
  const left = day - today;
  const done = (quest.status ?? "active") !== "active";
  return {
    day,
    label: dayLabel(day),
    relative: relativeDay(day, today),
    state: done ? "done" : ((left < 0) ? "overdue" : ((left <= 2) ? "soon" : "due"))
  };
}

/* -------------------------------------------- */
/*  A new day                                   */
/* -------------------------------------------- */

let lastDay = null;

/**
 * As the world's clock passes into a new day, everyone sees it announced, with that day's holidays and full moons,
 * and any active quest whose deadline has just gone by.
 */
export function registerCalendar() {
  lastDay = dayOf();
  Hooks.on("updateWorldTime", () => {
    const today = dayOf();
    const before = lastDay;
    lastDay = today;
    if ( (today <= before) || !game.settings.get(MODULE_ID, "announce") ) return;
    announceDay(today, today - before);
    for ( const quest of store.all("quests") ) {
      const deadline = Number(quest.deadline);
      if ( !Number.isFinite(deadline) || (quest.deadline === null) || ((quest.status ?? "active") !== "active") ) continue;
      if ( !store.isVisible("quests", quest) ) continue;
      if ( (deadline < today) && (deadline >= before) ) {
        announce({ label: game.i18n.localize(`${L}.Banners.DeadlinePassed`), title: quest.title || "", tone: "red",
          icon: "fa-solid fa-hourglass-end" });
      }
    }
  });
}

function announceDay(today, passed) {
  const notes = [
    ...eventsOn(today).map(e => e.title).filter(Boolean),
    ...moonsOn(today).filter(m => m.phase === "full").map(m => game.i18n.format(`${L}.Calendar.FullMoon`, { name: m.name }))
  ];
  announce({
    label: passed > 1 ? game.i18n.format(`${L}.Banners.DaysPass`, { n: passed }) : game.i18n.localize(`${L}.Banners.NewDay`),
    title: dayLabel(today),
    detail: notes.join(" · "),
    icon: "fa-solid fa-sun"
  });
}

/** The GM's New Day: the clock moves on by one day. */
export function newDay() {
  if ( !game.user.isGM ) return;
  return game.time.advance(secondsPerDay());
}
