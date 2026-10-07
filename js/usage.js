// Counts requests sent to each model today. Google's free limits reset at
// midnight US Pacific time, so "today" is the Pacific calendar date.

import { db } from './db.js';

export function pacificDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

/** Pure: returns a new usage record with one more request for `model`. */
export function bump(usage, model, now = new Date()) {
  const date = pacificDate(now);
  const counts = usage && usage.date === date ? { ...usage.counts } : {};
  counts[model] = (counts[model] || 0) + 1;
  return { date, counts };
}

/** Pure: requests used today for `model`. */
export function countFor(usage, model, now = new Date()) {
  if (!usage || usage.date !== pacificDate(now)) return 0;
  return usage.counts[model] || 0;
}

const listeners = new Set();
export function onUsageChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function getUsage() {
  return (await db.get('kv', 'usage')) || null;
}

export async function recordRequest(model) {
  const next = bump(await getUsage(), model);
  await db.put('kv', 'usage', next);
  listeners.forEach((fn) => fn(next));
  return next;
}

export async function usedToday(model) {
  return countFor(await getUsage(), model);
}
