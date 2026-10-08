// Step 6 of a turn: the narrator proposes changes, and the code checks each
// one against the rules. Valid changes are applied; invalid ones are dropped
// and logged. Nothing the AI says is true until it passes here.

import { FIXED_FACTS, MUTABLE_PERSON_FIELDS, RELATION_ASPECTS, RELATION_STEPS, DEFAULT_PRONOUNS } from './rules.js';
import { clamp } from './dice.js';
import { makePerson, makePlace, makeItem, connectPlaces, normSex, findPersonByName, findPlaceByName } from './state.js';
import { canPlace, findPlace, carrierOf, isPerson, isPlace, isItem, directlyHeld, dependentSlotsInUse, slotAvailable, SLOTS, INSIDE, SIZES } from './inventory.js';
import { shortDate } from './clock.js';

export const CHANGE_OPS = [
  'move_item', 'new_item', 'use_up_item', 'pay',
  'new_person', 'person_update', 'person_enters', 'person_leaves', 'person_dies',
  'relationship', 'history',
  'new_place', 'player_moves', 'place_update', 'scene_state',
];

const PLACE_FIELDS = ['state', 'owner', 'usual'];
const MAX_CHANGES = 30;

/** Looks up a person by id, or by exact name. */
function person(world, ref) {
  if (!ref) return null;
  if (['player', 'me', 'you'].includes(String(ref).toLowerCase())) return world.people[world.playerId];
  return world.people[ref] || findPersonByName(world, ref);
}

function place(world, ref) {
  if (!ref) return null;
  return world.places[ref] || findPlaceByName(world, ref);
}

/** Items the player could reach right now: carried, on the ground here, or on someone present. */
export function reachableItemIds(world) {
  const holders = new Set([world.playerId, world.currentPlaceId, ...world.present]);
  const ids = new Set();
  for (const it of Object.values(world.items)) {
    if (it.gone) continue;
    let cur = it;
    for (let g = 0; cur && g < 20; g++) {
      if (holders.has(cur.holder)) { ids.add(it.id); break; }
      cur = world.items[cur.holder];
    }
  }
  return ids;
}

function item(world, ref, preferReachable = true) {
  if (!ref) return null;
  if (world.items[ref]) return world.items[ref];
  const n = String(ref).trim().toLowerCase();
  const matches = Object.values(world.items).filter((i) => !i.gone && i.name.toLowerCase() === n);
  if (!preferReachable) return matches[0] || null;
  const reach = reachableItemIds(world);
  return matches.find((i) => reach.has(i.id)) || matches[0] || null;
}

/** Resolves a destination: person, place, or container item. Returns an id or null. */
function holderRef(world, ref) {
  if (!ref) return null;
  if (ref === 'here' || ref === 'ground' || ref === 'floor') return world.currentPlaceId;
  if (ref === 'player' || ref === 'me' || ref === 'you') return world.playerId;
  const p = person(world, ref); if (p) return p.id;
  const l = place(world, ref); if (l) return l.id;
  const i = item(world, ref); if (i) return i.id;
  return null;
}

/** Puts an item at a destination, choosing a slot if needed. Returns { ok, note?, reason? }. */
function placeItem(world, it, holderId, slot) {
  if (isPlace(world, holderId)) { it.holder = holderId; it.slot = null; return { ok: true }; }
  if (isItem(world, holderId)) {
    const r = canPlace(world, it, holderId, INSIDE);
    if (!r.ok) return r;
    it.holder = holderId; it.slot = INSIDE; return { ok: true };
  }
  if (isPerson(world, holderId)) {
    if (slot && SLOTS[slot]) {
      const r = canPlace(world, it, holderId, slot);
      if (r.ok) { it.holder = holderId; it.slot = slot; return { ok: true }; }
      const alt = findPlace(world, it, holderId);
      if (alt) { it.holder = alt.holder; it.slot = alt.slot; return { ok: true, note: `${r.reason}; put ${altLabel(world, alt)} instead` }; }
      return r;
    }
    const spot = findPlace(world, it, holderId);
    if (!spot) return { ok: false, reason: `nowhere on ${world.people[holderId].fixed.name} for ${it.name} (${it.size})` };
    it.holder = spot.holder; it.slot = spot.slot;
    return { ok: true };
  }
  return { ok: false, reason: 'unknown destination' };
}

function altLabel(world, spot) {
  if (spot.slot === INSIDE) return `in ${world.items[spot.holder].name}`;
  return `in ${SLOTS[spot.slot].label.toLowerCase()}`;
}

/**
 * Checks and applies a list of proposed changes.
 *   trusted: true for Rewrite text, which becomes canon without plausibility checks.
 * Returns { applied: [{change, note?}], rejected: [{change, reason}] }.
 */
export function applyChanges(world, changes, { trusted = false } = {}) {
  const applied = [];
  const rejected = [];
  const list = Array.isArray(changes) ? changes.slice(0, MAX_CHANGES) : [];
  for (const change of list) {
    let res;
    try {
      res = applyOne(world, change || {}, trusted);
    } catch (err) {
      res = { ok: false, reason: `error: ${err.message}` };
    }
    if (res.ok) applied.push({ change, note: res.note });
    else rejected.push({ change, reason: res.reason });
  }
  if (Array.isArray(changes) && changes.length > MAX_CHANGES) {
    rejected.push({ change: { op: '(extra)' }, reason: `only the first ${MAX_CHANGES} changes are accepted` });
  }
  return { applied, rejected };
}

function no(reason) { return { ok: false, reason }; }

function applyOne(world, c, trusted) {
  switch (c.op) {
    case 'new_item': {
      if (!c.name) return no('new item has no name');
      if (!trusted && !String(c.source || '').trim()) return no('items cannot appear without a source');
      const dest = holderRef(world, c.to) || world.currentPlaceId;
      const destPerson = world.people[dest];
      if (destPerson && destPerson.dead) return no(`${destPerson.fixed.name} is dead`);
      const it = makeItem(world, {
        name: c.name, qty: c.qty, weight: clamp(Number(c.weight) || 0, 0, 2000), value: c.value,
        size: SIZES.includes(c.size) ? c.size : 'small', tags: c.tags, source: c.source || (trusted ? 'rewrite' : ''),
        capacity: c.capacity,
      }, null, null);
      const r = placeItem(world, it, dest, c.slot);
      if (!r.ok) {
        if (isPerson(world, dest)) {
          // No room on the person: it ends up on the ground here instead.
          it.holder = world.currentPlaceId; it.slot = null;
          return { ok: true, note: `${r.reason}; left on the ground` };
        }
        delete world.items[it.id];
        return no(r.reason);
      }
      return { ok: true, note: r.note };
    }

    case 'move_item': {
      const it = item(world, c.itemId || c.name);
      if (!it) return no(`no such item "${c.itemId || c.name}"`);
      if (it.gone) return no(`${it.name} is gone`);
      if (!trusted && !reachableItemIds(world).has(it.id)) return no(`${it.name} is not here`);
      const dest = holderRef(world, c.to);
      if (!dest) return no(`unknown destination "${c.to}"`);
      const deps = dependentSlotsInUse(world, it);
      if (deps.length && !(isPerson(world, dest) && dest === it.holder && c.slot === 'worn')) {
        return no(`empty ${deps.join(', ').toLowerCase()} before taking off ${it.name}`);
      }
      const prev = { holder: it.holder, slot: it.slot };
      // Splitting a stack: move only part of it.
      const qty = Math.round(Number(c.qty) || 0);
      if (qty > 0 && qty < it.qty) {
        const part = makeItem(world, { ...it, qty }, null, null);
        part.source = it.source;
        const r = placeItem(world, part, dest, c.slot);
        if (!r.ok) { delete world.items[part.id]; return no(r.reason); }
        it.qty -= qty;
        return { ok: true, note: r.note };
      }
      it.holder = null; it.slot = null;
      const r = placeItem(world, it, dest, c.slot);
      if (!r.ok) { it.holder = prev.holder; it.slot = prev.slot; return no(r.reason); }
      return { ok: true, note: r.note };
    }

    case 'use_up_item': {
      const it = item(world, c.itemId || c.name);
      if (!it) return no(`no such item "${c.itemId || c.name}"`);
      if (it.gone) return no(`${it.name} is already gone`);
      if (!trusted && !reachableItemIds(world).has(it.id)) return no(`${it.name} is not here`);
      const qty = Math.max(1, Math.round(Number(c.qty) || 1));
      if (qty > it.qty) return no(`only ${it.qty} ${it.name} left`);
      it.qty -= qty;
      if (it.qty <= 0) {
        it.qty = 0;
        it.gone = true;
        it.goneReason = String(c.reason || 'used up').slice(0, 120);
        // Whatever was inside falls out where it was.
        const spill = carrierOf(world, it) ? world.currentPlaceId : it.holder;
        for (const inner of directlyHeld(world, it.id)) {
          inner.holder = spill;
          inner.slot = isItem(world, spill) ? INSIDE : null;
        }
        // Clothing that is gone takes its pockets with it: what was in them falls to the ground.
        if (it.slot === 'worn' && isPerson(world, it.holder)) {
          for (const other of directlyHeld(world, it.holder)) {
            if (SLOTS[other.slot] && !slotAvailable(world, it.holder, other.slot, other)) {
              other.holder = world.currentPlaceId;
              other.slot = null;
            }
          }
        }
      }
      return { ok: true };
    }

    case 'pay': {
      const amount = Math.round(Number(c.amount));
      if (!(amount > 0)) return no('payment needs a positive amount');
      const from = person(world, c.from);
      const to = person(world, c.to);
      if (!from && !to) return no('payment needs a payer or a payee');
      if (from && from.dead) return no(`${from.fixed.name} is dead`);
      if (to && to.dead) return no(`${to.fixed.name} is dead`);
      if (from && from.isPlayer && from.money < amount && !trusted) return no(`not enough money (has ${from.money}, needs ${amount})`);
      if (from && (from.isPlayer || from.moneyTracked)) from.money = Math.max(0, from.money - amount);
      if (to && (to.isPlayer || to.moneyTracked)) to.money += amount;
      return { ok: true };
    }

    case 'new_person': {
      if (!c.name) return no('new person has no name');
      const existing = findPersonByName(world, c.name);
      if (existing) {
        if (existing.dead && !trusted) return no(`${existing.fixed.name} is dead`);
        if (!existing.isPlayer && !world.present.includes(existing.id)) world.present.push(existing.id);
        return { ok: true, note: `already carded as ${existing.id}; marked present` };
      }
      const sex = normSex(c.sex);
      const p = makePerson(world, {
        name: c.name, sex, pronouns: c.pronouns || DEFAULT_PRONOUNS[sex], age: c.age, looks: c.looks, voice: c.voice,
        role: c.role, job: c.job, mood: c.mood, goal: c.goal,
      });
      p.firstMet = world.clock;
      world.present.push(p.id);
      return { ok: true, note: `carded as ${p.id}` };
    }

    case 'person_update': {
      const p = person(world, c.personId);
      if (!p) return no(`no such person "${c.personId}"`);
      const field = String(c.field || '');
      if (FIXED_FACTS.includes(field) || ['age', 'gender', 'birth', 'appearance'].includes(field)) return no(`${field} is a fixed fact and cannot change`);
      if (field === 'dead' || field === 'alive') return no('life and death change only through person_dies');
      if (!MUTABLE_PERSON_FIELDS.includes(field)) return no(`unknown field "${field}"`);
      if (p.dead && !trusted) return no(`${p.fixed.name} is dead`);
      p.life[field] = String(c.newValue || '').slice(0, 300);
      return { ok: true };
    }

    case 'person_enters': {
      const p = person(world, c.personId);
      if (!p) return no(`no such person "${c.personId}" (use new_person for someone new)`);
      if (p.isPlayer) return no('the player is always present');
      if (p.dead && !trusted) return no(`${p.fixed.name} is dead`);
      if (!world.present.includes(p.id)) world.present.push(p.id);
      return { ok: true };
    }

    case 'person_leaves': {
      const p = person(world, c.personId);
      if (!p) return no(`no such person "${c.personId}"`);
      world.present = world.present.filter((id) => id !== p.id);
      return { ok: true };
    }

    case 'person_dies': {
      const p = person(world, c.personId);
      if (!p) return no(`no such person "${c.personId}"`);
      if (p.dead) return { ok: true, note: 'already dead' };
      if (p.isPlayer && !trusted) return no('the player character cannot die until the body rules exist (stage 3)');
      p.dead = true;
      p.deathNote = `${shortDate(world)}: ${String(c.reason || '').slice(0, 200)}`;
      return { ok: true };
    }

    case 'relationship': {
      const p = person(world, c.personId);
      if (!p) return no(`no such person "${c.personId}"`);
      if (p.isPlayer) return no('relationships are toward the player, not the player themself');
      if (p.dead) return no(`${p.fixed.name} is dead`);
      if (!RELATION_ASPECTS.includes(c.aspect)) return no(`unknown relationship aspect "${c.aspect}"`);
      const step = RELATION_STEPS[c.change] || RELATION_STEPS[c.size] || RELATION_STEPS.slight;
      const sign = c.direction === 'down' ? -1 : 1;
      p.relationship[c.aspect] = clamp(p.relationship[c.aspect] + sign * step, -100, 100);
      return { ok: true };
    }

    case 'history': {
      const p = person(world, c.personId);
      if (!p) return no(`no such person "${c.personId}"`);
      if (p.isPlayer) return no('shared history is kept on the other person\'s card');
      // The code stamps the date itself; drop one the narrator wrote in.
      const text = String(c.text || '').trim().replace(/^[A-Z][a-z]{2,8}\.? \d{1,2},? \d{3,4}\s*[:—-]\s*/, '').slice(0, 300);
      if (!text) return no('empty history entry');
      p.history.push({ date: shortDate(world), clock: world.clock, turn: world.turn, text });
      return { ok: true };
    }

    case 'new_place': {
      if (!c.name) return no('new place has no name');
      const existing = findPlaceByName(world, c.name);
      if (existing) return { ok: true, note: `already exists as ${existing.id}` };
      const pl = makePlace(world, {
        name: c.name, type: c.type, region: c.region || (world.places[world.currentPlaceId] || {}).region,
        description: c.description, owner: c.owner, usual: c.usual, soundTags: c.soundTags,
      });
      if (world.currentPlaceId) connectPlaces(world, world.currentPlaceId, pl.id, c.travelMinutes);
      return { ok: true, note: `created as ${pl.id}` };
    }

    case 'player_moves': {
      const pl = place(world, c.placeId);
      if (!pl) return no(`no such place "${c.placeId}" (create it with new_place first)`);
      if (pl.id === world.currentPlaceId) return { ok: true, note: 'already here' };
      if (world.currentPlaceId) connectPlaces(world, world.currentPlaceId, pl.id, c.travelMinutes);
      world.currentPlaceId = pl.id;
      // People stay behind unless the narrator says they come along.
      world.present = [];
      world.sceneState = '';
      if (!pl.firstVisit) pl.firstVisit = world.clock;
      return { ok: true };
    }

    case 'place_update': {
      const pl = place(world, c.placeId) || world.places[world.currentPlaceId];
      if (!pl) return no(`no such place "${c.placeId}"`);
      if (!PLACE_FIELDS.includes(c.field)) return no(`place ${c.field || '(no field)'} cannot change (only ${PLACE_FIELDS.join(', ')})`);
      if (c.field === 'state' && !['open', 'closed', 'abandoned'].includes(c.newValue)) return no('state must be open, closed or abandoned');
      pl[c.field] = String(c.newValue || '').slice(0, 400);
      return { ok: true };
    }

    case 'scene_state': {
      const text = String(c.text || '').trim().slice(0, 500);
      if (!text) return no('empty scene state');
      world.sceneState = text;
      return { ok: true };
    }

    default:
      return no(`unknown change "${c.op}"`);
  }
}

