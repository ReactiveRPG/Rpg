// The game state for one world, and the cards inside it. Everything here is
// plain data so it can be saved, copied for undo, and exported.

import { ATTRIBUTES, ATTRIBUTE_MIN, ATTRIBUTE_MAX, DEFAULT_PRONOUNS, SEXES, RELATION_ASPECTS, SKILL_MIN, SKILL_MAX } from './rules.js';
import { SIZES } from './inventory.js';
import { clamp } from './dice.js';

export const SAVE_VERSION = 1;
export const MAX_SNAPSHOTS = 20;

export function newId(world, prefix) {
  world.nextId = (world.nextId || 1) + 1;
  return `${prefix}${world.nextId - 1}`;
}

export function createWorld(premise) {
  return {
    version: SAVE_VERSION,
    id: `w${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
    name: premise.title || 'Untitled world',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    premise,
    clock: 0,
    turn: 0,
    nextId: 1,
    playerId: null,
    currentPlaceId: null,
    present: [],
    people: {},
    places: {},
    items: {},
    log: [],
    summary: '',
    summaryUpTo: 0,
    recent: [],
    rejected: [],
    debug: {},
    snapshots: [],
  };
}

const str = (v, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : v == null ? '' : String(v).slice(0, max));

export function normSex(sex) {
  const s = str(sex, 20).toLowerCase();
  if (SEXES.includes(s)) return s;
  if (/^(f|woman|girl)/.test(s)) return 'female';
  if (/^(m|man|boy)/.test(s)) return 'male';
  return 'other';
}

export function makePerson(world, data, { isPlayer = false, tier = 'known' } = {}) {
  const sex = normSex(data.sex);
  const age = clamp(parseInt(data.age, 10) || 30, 0, 200);
  const birthYear = (world.premise.startDate ? world.premise.startDate.year : 2000) - age;
  const attributes = {};
  for (const a of ATTRIBUTES) attributes[a] = clamp(Math.round(Number((data.attributes || {})[a]) || 0), ATTRIBUTE_MIN, ATTRIBUTE_MAX);
  const skills = {};
  for (const [k, v] of Object.entries(data.skills || {})) {
    const lvl = clamp(Math.round(Number(v) || 0), SKILL_MIN, SKILL_MAX);
    if (lvl > 0) skills[k] = lvl;
  }
  const person = {
    id: newId(world, 'p'),
    isPlayer,
    tier,
    fixed: {
      name: str(data.name, 80) || 'Unnamed',
      sex,
      pronouns: str(data.pronouns, 30) || DEFAULT_PRONOUNS[sex],
      birthYear,
      looks: str(data.looks, 600),
      voice: str(data.voice, 200),
    },
    life: {
      role: str(data.role, 120),
      job: str(data.job, 120),
      home: str(data.home, 120),
      workplace: str(data.workplace, 120),
      faction: str(data.faction, 120),
      mood: str(data.mood, 120),
      goal: str(data.goal, 300),
      status: '',
    },
    background: str(data.background, 1500),
    attributes,
    skills,
    money: Math.max(0, Math.round(Number(data.money) || 0)),
    relationship: Object.fromEntries(RELATION_ASPECTS.map((k) => [k, clamp(Math.round(Number((data.relationship || {})[k]) || 0), -100, 100)])),
    history: [],
    lastSeen: null,
    dead: false,
    deathNote: '',
  };
  world.people[person.id] = person;
  return person;
}

export function ageOf(world, person) {
  const y = world.premise.startDate ? world.premise.startDate.year : 2000;
  const elapsedYears = Math.floor(world.clock / (365.25 * 86400));
  return y + elapsedYears - person.fixed.birthYear;
}

export function makePlace(world, data) {
  const place = {
    id: newId(world, 'l'),
    name: str(data.name, 100) || 'Unnamed place',
    type: str(data.type, 60),
    region: str(data.region, 100),
    description: str(data.description, 1200),
    owner: str(data.owner, 120),
    state: ['open', 'closed', 'abandoned'].includes(data.state) ? data.state : 'open',
    usual: str(data.usual, 400),
    connections: [],
    soundTags: Array.isArray(data.soundTags) ? data.soundTags.map((t) => str(t, 30)).filter(Boolean).slice(0, 8) : [],
    image: null,
    firstVisit: null,
  };
  world.places[place.id] = place;
  return place;
}

export function connectPlaces(world, aId, bId, minutes) {
  const a = world.places[aId];
  const b = world.places[bId];
  if (!a || !b || aId === bId) return;
  const m = Math.max(1, Math.round(Number(minutes) || 10));
  if (!a.connections.some((c) => c.placeId === bId)) a.connections.push({ placeId: bId, minutes: m });
  if (!b.connections.some((c) => c.placeId === aId)) b.connections.push({ placeId: aId, minutes: m });
}

export function makeItem(world, data, holder, slot) {
  const item = {
    id: newId(world, 'i'),
    name: str(data.name, 80) || 'Thing',
    qty: Math.max(1, Math.round(Number(data.qty) || 1)),
    weight: Math.max(0, Math.round((Number(data.weight) || 0) * 1000) / 1000),
    value: Math.max(0, Math.round(Number(data.value) || 0)),
    size: SIZES.includes(data.size) ? data.size : 'small',
    condition: str(data.condition, 40) || 'good',
    tags: Array.isArray(data.tags) ? [...new Set(data.tags.map((t) => str(t, 20).toLowerCase()).filter(Boolean))].slice(0, 8) : [],
    capacity: data.capacity != null ? Math.max(0, Number(data.capacity) || 0) : undefined,
    holder,
    slot: slot || null,
    source: str(data.source, 160),
    gone: false,
  };
  if (item.capacity === undefined) delete item.capacity;
  world.items[item.id] = item;
  return item;
}

/** Copy of the world without its snapshot list, for undo. */
export function snapshotOf(world) {
  const { snapshots, ...rest } = world;
  return structuredCloneSafe(rest);
}

export function structuredCloneSafe(obj) {
  return typeof structuredClone === 'function' ? structuredClone(obj) : JSON.parse(JSON.stringify(obj));
}

export function pushSnapshot(world) {
  world.snapshots = world.snapshots || [];
  world.snapshots.push(snapshotOf(world));
  while (world.snapshots.length > MAX_SNAPSHOTS) world.snapshots.shift();
}

/**
 * Removes the last `n` turns. Returns the restored world (a new object), or
 * null if there is nothing to undo. Everything comes back: dice, time,
 * inventory, cards, log.
 */
export function undoTurns(world, n = 1) {
  const snaps = world.snapshots || [];
  if (!snaps.length) return null;
  const count = Math.min(Math.max(1, n), snaps.length);
  const restored = snaps[snaps.length - count];
  const remaining = snaps.slice(0, snaps.length - count);
  return { ...structuredCloneSafe(restored), snapshots: remaining, updatedAt: Date.now() };
}

/** Upgrades older saves to the current format. */
export function migrate(world) {
  if (!world || typeof world !== 'object') throw new Error('Not a save file');
  if (!world.version) world.version = 1;
  if (world.version > SAVE_VERSION) throw new Error('This save comes from a newer version of the game.');
  // Future: if (world.version === 1) { ...; world.version = 2; }
  return world;
}

export function player(world) { return world.people[world.playerId]; }
export function currentPlace(world) { return world.places[world.currentPlaceId]; }

export function findPersonByName(world, name) {
  const n = str(name, 80).toLowerCase();
  if (!n) return null;
  return Object.values(world.people).find((p) => p.fixed.name.toLowerCase() === n) || null;
}

export function findPlaceByName(world, name) {
  const n = str(name, 100).toLowerCase();
  if (!n) return null;
  return Object.values(world.places).find((p) => p.name.toLowerCase() === n) || null;
}
