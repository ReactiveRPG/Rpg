// Game date and time. The clock is a count of seconds since midnight of the
// world's starting day; dates follow a 7-day week and the real month lengths,
// with the world's own month names when it has them.

import { DURATIONS } from './rules.js';
import { between } from './dice.js';

export const DEFAULT_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const DEFAULT_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Breaks the clock into calendar parts. */
export function dateParts(world, seconds = world.clock) {
  const start = world.premise.startDate || { year: 2000, month: 1, day: 1 };
  // Date.UTC handles month lengths and leap years; year offset keeps very old or fantasy years valid.
  const base = Date.UTC(2000, start.month - 1, start.day);
  const d = new Date(base + Math.floor(seconds / 86400) * 86400000);
  const secOfDay = ((seconds % 86400) + 86400) % 86400;
  return {
    year: start.year + (d.getUTCFullYear() - 2000),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    weekday: d.getUTCDay(),
    hour: Math.floor(secOfDay / 3600),
    minute: Math.floor((secOfDay % 3600) / 60),
    dayNumber: Math.floor(seconds / 86400),
  };
}

export function formatTime(hour, minute) {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'am' : 'pm'}`;
}

export function formatDate(world, seconds = world.clock) {
  const p = dateParts(world, seconds);
  const months = validNames(world.premise.monthNames, 12) || DEFAULT_MONTHS;
  const weekdays = validNames(world.premise.weekdayNames, 7) || DEFAULT_WEEKDAYS;
  return `${weekdays[p.weekday]}, ${months[p.month - 1]} ${p.day}, ${p.year}`;
}

export function formatDateTime(world, seconds = world.clock) {
  const p = dateParts(world, seconds);
  return `${formatDate(world, seconds)} · ${formatTime(p.hour, p.minute)}`;
}

/** Short date for history entries, e.g. "Mar 4, 1247". */
export function shortDate(world, seconds = world.clock) {
  const p = dateParts(world, seconds);
  const months = validNames(world.premise.monthNames, 12) || DEFAULT_MONTHS;
  return `${months[p.month - 1].slice(0, 3)} ${p.day}, ${p.year}`;
}

function validNames(list, n) {
  return Array.isArray(list) && list.length === n && list.every((x) => typeof x === 'string' && x.trim()) ? list : null;
}

/**
 * Seconds an action takes. The referee picks the class; the code picks the
 * exact time inside it. A hint in minutes is honoured if it falls inside the class.
 */
export function durationSeconds(cls, hintMinutes, rng) {
  const range = DURATIONS[cls] || DURATIONS.moment;
  const hint = Number(hintMinutes) * 60;
  if (hint && hint >= range[0] && hint <= range[1]) return Math.round(hint);
  if (cls === 'extended' && hint > range[1] && hint <= 7 * 86400) return Math.round(hint);
  return between(range[0], range[1], rng);
}

export function partOfDay(hour) {
  if (hour < 5) return 'night';
  if (hour < 8) return 'early morning';
  if (hour < 12) return 'morning';
  if (hour < 14) return 'midday';
  if (hour < 18) return 'afternoon';
  if (hour < 21) return 'evening';
  return 'night';
}

/** "3 days", "2 hours", "45 minutes" */
export function describeSpan(seconds) {
  if (seconds < 60) return `${seconds} seconds`;
  const m = Math.round(seconds / 60);
  if (m < 90) return `${m} minute${m === 1 ? '' : 's'}`;
  const h = Math.round(seconds / 3600);
  if (h < 36) return `${h} hour${h === 1 ? '' : 's'}`;
  const d = Math.round(seconds / 86400);
  return `${d} day${d === 1 ? '' : 's'}`;
}
