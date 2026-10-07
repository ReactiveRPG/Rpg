// New game: world premise, then the player's character, then the opening scene.

import { createWorld, makePerson, makePlace, makeItem, connectPlaces } from './state.js';
import { findPlace, canPlace, SLOTS, INSIDE, SIZES } from './inventory.js';
import { clamp } from './dice.js';
import { ATTRIBUTES, START_SKILL_MAX, skillTable, DEFAULT_PRONOUNS } from './rules.js';

/** Turns the world model's premise into a new world with its first places. */
export function worldFromPremise(data, description) {
  const d = data || {};
  const sd = d.startDate || {};
  const premise = {
    description: String(description || '').slice(0, 4000),
    title: String(d.title || 'Untitled world').slice(0, 80),
    setting: String(d.setting || '').slice(0, 2000),
    era: String(d.era || '').slice(0, 200),
    technology: String(d.technology || '').slice(0, 300),
    medicine: String(d.medicine || '').slice(0, 300),
    law: String(d.law || '').slice(0, 400),
    tone: String(d.tone || '').slice(0, 200),
    currency: {
      name: String(d.currency?.name || 'coin').slice(0, 30),
      plural: String(d.currency?.plural || d.currency?.name || 'coins').slice(0, 30),
      note: String(d.currency?.note || '').slice(0, 200),
    },
    monthNames: Array.isArray(d.monthNames) && d.monthNames.length === 12 ? d.monthNames.map(String) : null,
    weekdayNames: Array.isArray(d.weekdayNames) && d.weekdayNames.length === 7 ? d.weekdayNames.map(String) : null,
    startDate: {
      year: Number.isFinite(Number(sd.year)) ? Math.round(Number(sd.year)) : 2000,
      month: clamp(Math.round(Number(sd.month) || 1), 1, 12),
      day: clamp(Math.round(Number(sd.day) || 1), 1, 28),
    },
    artStyle: String(d.artStyle || '').slice(0, 300),
    priceCatalogue: (Array.isArray(d.priceCatalogue) ? d.priceCatalogue : []).filter((x) => x && x.name).slice(0, 80).map((x) => ({
      name: String(x.name).slice(0, 60),
      value: Math.max(0, Math.round(Number(x.value) || 0)),
      size: SIZES.includes(x.size) ? x.size : 'small',
      weight: Math.max(0, Number(x.weight) || 0),
      tags: Array.isArray(x.tags) ? x.tags.map(String).slice(0, 6) : [],
    })),
    extraSkills: (Array.isArray(d.extraSkills) ? d.extraSkills : []).filter((s) => s && s.name && ATTRIBUTES.includes(s.attribute)).slice(0, 6)
      .map((s) => ({ name: String(s.name).slice(0, 40), attribute: s.attribute, group: String(s.group || 'Setting').slice(0, 30) })),
  };
  const world = createWorld(premise);
  const start = makePlace(world, d.startPlace || { name: 'Somewhere' });
  start.firstVisit = 0;
  world.currentPlaceId = start.id;
  for (const np of (Array.isArray(d.nearbyPlaces) ? d.nearbyPlaces : []).slice(0, 6)) {
    if (!np || !np.name) continue;
    const pl = makePlace(world, np);
    connectPlaces(world, start.id, pl.id, np.travelMinutes || 15);
  }
  // The day starts at the given hour.
  world.clock = clamp(Math.round(Number(sd.hour) || 9), 0, 23) * 3600;
  return world;
}

/** Normalises what the player typed on the character screen. */
export function normaliseChoices(ch) {
  const sex = ['female', 'male', 'other'].includes(ch.sex) ? ch.sex : 'other';
  return {
    name: String(ch.name || '').trim().slice(0, 80),
    sex,
    pronouns: String(ch.pronouns || '').trim().slice(0, 30) || DEFAULT_PRONOUNS[sex],
    age: clamp(parseInt(ch.age, 10) || 25, 18, 120),
    looks: String(ch.looks || '').trim().slice(0, 600),
    background: String(ch.background || '').trim().slice(0, 400),
  };
}

/**
 * Builds the player, their gear, ally and enemy from the world model's answer.
 * The player's own choices (name, sex, age, looks) always win.
 */
export function addCharacter(world, choices, data) {
  const d = data || {};
  const table = skillTable(world);
  const skills = {};
  for (const s of Array.isArray(d.skills) ? d.skills : []) {
    if (s && table[s.name]) skills[s.name] = clamp(Math.round(Number(s.level) || 0), 0, START_SKILL_MAX);
  }
  const attributes = {};
  for (const a of ATTRIBUTES) attributes[a] = (d.attributes || {})[a];

  const p = makePerson(world, {
    ...choices,
    background: [choices.background, d.backstory].filter(Boolean).join('\n\n'),
    attributes,
    skills,
    money: clamp(Math.round(Number(d.money) || 0), 0, 1e7),
    role: 'the player character',
  }, { isPlayer: true, tier: 'close' });
  world.playerId = p.id;

  // Clothing first, so pockets exist before anything goes in them.
  const gear = (Array.isArray(d.gear) ? d.gear : []).filter((g) => g && g.name).slice(0, 25);
  const worn = gear.filter((g) => g.slot === 'worn');
  const rest = gear.filter((g) => g.slot !== 'worn');
  const bagsFirst = rest.sort((a, b) => hasBag(b) - hasBag(a));
  const dropped = [];
  for (const g of [...worn, ...bagsFirst]) {
    const it = makeItem(world, { ...g, source: 'starting gear' }, null, null);
    const wanted = SLOTS[g.slot] ? g.slot : null;
    let spot = null;
    if (g.slot === INSIDE) {
      const bag = Object.values(world.items).find((b) => b.holder === p.id && (b.tags || []).includes('bag') && canPlace(world, it, b.id, INSIDE).ok);
      if (bag) spot = { holder: bag.id, slot: INSIDE };
    }
    if (!spot) spot = findPlace(world, it, p.id, wanted);
    if (spot) { it.holder = spot.holder; it.slot = spot.slot; }
    else { it.holder = world.currentPlaceId; it.slot = null; dropped.push(it.name); }
  }

  const npc = (x, role) => {
    if (!x || !x.name) return null;
    const person = makePerson(world, { ...x, role: x.role || role, home: x.where || '' }, { tier: 'close' });
    person.life.goal = String(x.goal || '').slice(0, 300);
    person.history.push({ date: 'before the story', clock: 0, turn: 0, text: String(x.why || role).slice(0, 300) });
    return person;
  };
  const ally = npc(d.ally, 'ally');
  if (ally) Object.assign(ally.relationship, { trust: 40, respect: 25 });
  const enemy = npc(d.enemy, 'enemy');
  if (enemy) Object.assign(enemy.relationship, { trust: -40, respect: -10 });
  return { player: p, ally, enemy, dropped };
}

function hasBag(g) { return (g.tags || []).includes('bag') ? 1 : 0; }
