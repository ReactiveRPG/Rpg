// Items, carry slots, size and weight. The code decides what fits where;
// this is what keeps an anvil out of a pocket.

import { carryLimit, HARD_CAP_FACTOR } from './rules.js';

export const SIZES = ['tiny', 'small', 'medium', 'large', 'huge'];
export const sizeRank = (s) => Math.max(0, SIZES.indexOf(s));
/** Room an item takes inside a bag. */
export const BAG_UNITS = { tiny: 0.25, small: 1, medium: 3, large: 8, huge: 25 };

/** How hard a slot is to find in a search, from easiest to hardest. */
export const SEARCH_LEVELS = [
  'in plain sight', 'any pat-down', 'a pat-down, usually', 'a careful pat-down',
  'opened in any search', 'only a strip search', 'only a cavity search',
];

export const CLOTHING_TAGS = ['pants', 'jacket', 'belt', 'socks', 'boots', 'strap', 'sheath', 'bag', 'clothing', 'armour', 'hat', 'shirt', 'dress', 'coat', 'gloves'];

/**
 * Carry slots on a person.
 *   needs:    the slot exists only if something worn has one of these tags
 *   maxSize:  largest size that fits
 *   count:    how many separate items (a stack counts once)
 *   search:   index into SEARCH_LEVELS
 */
export const SLOTS = {
  worn:           { label: 'Worn', maxSize: 'large', count: 99, search: 0 },
  hand_left:      { label: 'Left hand', maxSize: 'large', count: 1, search: 0 },
  hand_right:     { label: 'Right hand', maxSize: 'large', count: 1, search: 0 },
  both_hands:     { label: 'Both hands', maxSize: 'huge', count: 1, search: 0 },
  pants_pockets:  { label: 'Pants pockets', needs: ['pants'], maxSize: 'small', count: 4, search: 1 },
  jacket_pockets: { label: 'Jacket pockets', needs: ['jacket', 'coat'], maxSize: 'small', count: 6, search: 1 },
  inside_jacket:  { label: 'Tucked inside jacket', needs: ['jacket', 'coat'], maxSize: 'medium', count: 1, search: 2 },
  belt:           { label: 'Belt or waistband', needs: ['belt', 'pants'], maxSize: 'medium', count: 2, search: 2 },
  pant_leg_left:  { label: 'Left pant leg', needs: ['pants'], maxSize: 'medium', count: 1, search: 3, onlyTag: 'weapon' },
  pant_leg_right: { label: 'Right pant leg', needs: ['pants'], maxSize: 'medium', count: 1, search: 3, onlyTag: 'weapon' },
  foot_left:      { label: 'Left sock or boot', needs: ['socks', 'boots'], maxSize: 'small', count: 1, search: 3 },
  foot_right:     { label: 'Right sock or boot', needs: ['socks', 'boots'], maxSize: 'small', count: 1, search: 3 },
  back:           { label: 'Slung on back', needs: ['strap', 'sheath'], maxSize: 'large', count: 1, search: 0, ownStrapOk: true },
  mouth:          { label: 'Mouth', maxSize: 'tiny', count: 1, search: 5, note: 'Speech is impaired' },
  cavity:         { label: 'Body cavity', maxSize: 'small', count: 1, search: 6, note: 'Slow to place and retrieve' },
};
/** Inside a container item (a bag). */
export const INSIDE = 'inside';
export const INSIDE_SEARCH = 4;

export function slotLabel(slot, world, item) {
  if (slot === INSIDE && item) {
    const bag = world.items[item.holder];
    return bag ? `In ${bag.name}` : 'Inside';
  }
  return (SLOTS[slot] && SLOTS[slot].label) || slot || '';
}

export function isPerson(world, id) { return !!(world.people && world.people[id]); }
export function isPlace(world, id) { return !!(world.places && world.places[id]); }
export function isItem(world, id) { return !!(world.items && world.items[id]); }

export function liveItems(world) {
  return Object.values(world.items || {}).filter((i) => !i.gone);
}

/** Items whose holder is this id (not recursive). */
export function directlyHeld(world, holderId) {
  return liveItems(world).filter((i) => i.holder === holderId);
}

/** Every item a person carries, including bag contents. */
export function carriedItems(world, personId) {
  const out = [];
  const walk = (holderId) => {
    for (const it of directlyHeld(world, holderId)) {
      out.push(it);
      walk(it.id);
    }
  };
  walk(personId);
  return out;
}

/** The person ultimately carrying an item (through bags), or null. */
export function carrierOf(world, item) {
  let cur = item;
  for (let guard = 0; cur && guard < 20; guard++) {
    if (isPerson(world, cur.holder)) return cur.holder;
    cur = world.items[cur.holder];
  }
  return null;
}

export function itemWeight(item) {
  return (Number(item.weight) || 0) * (Number(item.qty) || 1);
}

export function carriedWeight(world, personId) {
  return carriedItems(world, personId).reduce((sum, it) => sum + itemWeight(it), 0);
}

export function weightLimits(world, personId) {
  const p = world.people[personId];
  const limit = carryLimit(p && p.attributes ? p.attributes.strength : 0);
  return { limit, hardCap: limit * HARD_CAP_FACTOR };
}

function hasTag(item, tag) { return (item.tags || []).includes(tag); }

function wornTags(world, personId) {
  const tags = new Set();
  for (const it of directlyHeld(world, personId)) {
    if (it.slot === 'worn') (it.tags || []).forEach((t) => tags.add(t));
  }
  return tags;
}

/** Whether a slot exists on this person right now (e.g. pockets need pants). */
export function slotAvailable(world, personId, slot, item) {
  const def = SLOTS[slot];
  if (!def) return false;
  if (!def.needs) return true;
  const person = world.people[personId];
  const worn = wornTags(world, personId);
  // People other than the player are assumed normally dressed until their clothes are tracked.
  if (person && !person.isPlayer && worn.size === 0) return true;
  if (def.needs.some((t) => worn.has(t))) return true;
  if (def.ownStrapOk && item && (hasTag(item, 'strap') || hasTag(item, 'sheath'))) return true;
  return false;
}

/** Room used inside a bag, in bag units. */
export function bagUsed(world, bagId, exceptId) {
  return directlyHeld(world, bagId)
    .filter((i) => i.id !== exceptId)
    .reduce((sum, i) => sum + BAG_UNITS[i.size || 'small'], 0);
}

/**
 * Can `item` go to holder/slot? Returns { ok: true } or { ok: false, reason }.
 * Holder may be a person (needs a slot), a place (no slot), or a bag item (slot 'inside').
 */
export function canPlace(world, item, holderId, slot) {
  const size = item.size || 'small';
  if (isPlace(world, holderId)) return { ok: true };

  if (isItem(world, holderId)) {
    const bag = world.items[holderId];
    if (bag.gone) return { ok: false, reason: `${bag.name} is gone` };
    if (!hasTag(bag, 'bag') && !hasTag(bag, 'container')) return { ok: false, reason: `${bag.name} is not a container` };
    if (bag.id === item.id) return { ok: false, reason: 'an item cannot go inside itself' };
    // No putting a bag inside something it contains.
    for (let cur = bag; cur; cur = world.items[cur.holder]) {
      if (cur.id === item.id) return { ok: false, reason: 'an item cannot go inside itself' };
    }
    if (sizeRank(size) > sizeRank('large')) return { ok: false, reason: `${item.name} is too big for any bag` };
    if (sizeRank(size) >= sizeRank(bag.size || 'medium')) return { ok: false, reason: `${item.name} is too big for ${bag.name}` };
    const cap = Number(bag.capacity) || 10;
    if (bagUsed(world, bag.id, item.id) + BAG_UNITS[size] > cap) return { ok: false, reason: `${bag.name} is full` };
    return { ok: true };
  }

  if (!isPerson(world, holderId)) return { ok: false, reason: 'no such person, place or container' };
  const person = world.people[holderId];
  if (person.dead && !person.isPlayer) {
    // Bodies can still hold what they had; nothing new is handed to the dead.
    return { ok: false, reason: `${person.fixed.name} is dead` };
  }
  const def = SLOTS[slot];
  if (!def) return { ok: false, reason: `unknown slot "${slot}"` };
  if (slot === 'worn') {
    if (!(item.tags || []).some((t) => CLOTHING_TAGS.includes(t))) return { ok: false, reason: `${item.name} is not something you wear` };
  }
  if (!slotAvailable(world, holderId, slot, item)) {
    return { ok: false, reason: `${def.label} needs ${def.needs.join(' or ')}` };
  }
  if (sizeRank(size) > sizeRank(def.maxSize)) return { ok: false, reason: `${item.name} (${size}) is too big for ${def.label.toLowerCase()}` };
  if (def.onlyTag && !hasTag(item, def.onlyTag)) return { ok: false, reason: `${def.label} only holds a ${def.onlyTag}` };
  const others = directlyHeld(world, holderId).filter((i) => i.id !== item.id);
  const inSlot = others.filter((i) => i.slot === slot);
  if (inSlot.length >= def.count) return { ok: false, reason: `${def.label} is full` };
  if (slot === 'both_hands' && others.some((i) => i.slot === 'hand_left' || i.slot === 'hand_right')) {
    return { ok: false, reason: 'both hands must be empty' };
  }
  if ((slot === 'hand_left' || slot === 'hand_right') && others.some((i) => i.slot === 'both_hands')) {
    return { ok: false, reason: 'both hands are full' };
  }
  return { ok: true };
}

/** Preferred slots to try for an item, most natural first. */
function slotPreference(item) {
  if ((item.tags || []).some((t) => CLOTHING_TAGS.includes(t)) && !hasTag(item, 'weapon')) return ['worn', 'hand_right', 'hand_left'];
  switch (item.size || 'small') {
    case 'tiny': return ['pants_pockets', 'jacket_pockets', INSIDE, 'belt', 'hand_right', 'hand_left'];
    case 'small': return ['pants_pockets', 'jacket_pockets', 'belt', INSIDE, 'inside_jacket', 'hand_right', 'hand_left'];
    case 'medium': return ['belt', 'inside_jacket', INSIDE, 'hand_right', 'hand_left', 'back'];
    case 'large': return ['back', INSIDE, 'hand_right', 'hand_left'];
    default: return ['both_hands'];
  }
}

/**
 * Finds somewhere on a person for an item. Returns { holder, slot } or null.
 * Tries the requested slot first, then natural places, then any bag carried.
 */
export function findPlace(world, item, personId, wanted) {
  if (wanted && wanted !== INSIDE && canPlace(world, item, personId, wanted).ok) return { holder: personId, slot: wanted };
  const bags = carriedItems(world, personId).filter((i) => (hasTag(i, 'bag') || hasTag(i, 'container')) && i.id !== item.id);
  for (const slot of slotPreference(item)) {
    if (slot === INSIDE) {
      for (const bag of bags) if (canPlace(world, item, bag.id, INSIDE).ok) return { holder: bag.id, slot: INSIDE };
    } else if (canPlace(world, item, personId, slot).ok) {
      return { holder: personId, slot };
    }
  }
  return null;
}

/** Search level of an item: the hardest-to-find layer it sits behind. */
export function hiddenLevel(world, item) {
  if (SLOTS[item.slot]) return SLOTS[item.slot].search;
  if (item.slot === INSIDE) {
    const bag = world.items[item.holder];
    return Math.max(INSIDE_SEARCH, bag ? hiddenLevel(world, bag) : 0);
  }
  return 0;
}

/** Slots that would stop existing if `item` were taken off, and still hold things. */
export function dependentSlotsInUse(world, item) {
  if (item.slot !== 'worn') return [];
  const personId = item.holder;
  const others = directlyHeld(world, personId).filter((i) => i.id !== item.id);
  const remainingWorn = new Set(others.filter((i) => i.slot === 'worn').flatMap((i) => i.tags || []));
  const out = [];
  for (const [slot, def] of Object.entries(SLOTS)) {
    if (!def.needs || !def.needs.some((t) => hasTag(item, t))) continue;
    if (def.needs.some((t) => remainingWorn.has(t))) continue;
    const used = others.filter((i) => i.slot === slot && !(def.ownStrapOk && (hasTag(i, 'strap') || hasTag(i, 'sheath'))));
    if (used.length) out.push(def.label);
  }
  return out;
}
