// The player character's home: a place marked as theirs, owned or rented.
// A rented home has a landlord (a card, or just a name until they turn up)
// and a rent deal, which the game master sees every turn like any other deal.

import { makePlace, makePerson, connectPlaces, newId, findPersonByName } from './state.js';
import { money } from './packet.js';
import { shortDate } from './clock.js';

const str = (v, max) => String(v ?? '').trim().slice(0, max);

/**
 * Adds a new place and makes it the player's home.
 *   data: { name, type, region, description, kind: 'owned'|'rented', travelMinutes,
 *           rent, rentEvery: 'week'|'month', rentDue, landlord: { name, sex, ... } | 'a name' | '' }
 *   before: true for a home the character had before the story began
 * Returns { place, landlord, deal }.
 */
export function addHome(world, data, { before = false } = {}) {
  const place = makePlace(world, {
    name: str(data.name, 100) || 'Home', type: str(data.type, 60) || 'home', region: data.region,
    description: data.description,
  });
  if (world.currentPlaceId && world.currentPlaceId !== place.id) connectPlaces(world, world.currentPlaceId, place.id, data.travelMinutes || 20);
  return { place, ...makeHome(world, place, data, { before }) };
}

/** Makes an existing place the player's home (or changes how it is held). Returns { landlord, deal }. */
export function makeHome(world, place, data, { before = false } = {}) {
  const kind = data.kind === 'owned' ? 'owned' : 'rented';
  const since = place.home ? place.home.since : before ? 'before the story' : shortDate(world);
  let landlord = null;
  let landlordName = '';
  if (kind === 'rented') {
    ({ landlord, landlordName } = resolveLandlord(world, place, data.landlord, { before }));
    place.owner = landlordName;
  } else {
    place.owner = world.people[world.playerId]?.fixed.name || 'the player';
    // Owning the place ends any rent on it.
    for (const d of rentDeals(world, place)) closeDeal(world, d, 'done', 'the player now owns the place');
  }
  place.home = { kind, landlordId: landlord ? landlord.id : null, landlordName, since };
  const deal = kind === 'rented' ? setRentDeal(world, place, data, { before }) : null;
  return { landlord, deal };
}

/** Stops a place being the player's home; the rent deal can be closed with it. */
export function endHome(world, place, { closeRent = true } = {}) {
  if (!place.home) return;
  if (closeRent) for (const d of rentDeals(world, place)) closeDeal(world, d, 'done', 'no longer the player\'s home');
  if (place.owner === world.people[world.playerId]?.fixed.name) place.owner = '';
  delete place.home;
}

/** Changes the landlord and/or rent of a rented home, keeping one open rent deal in step. */
export function updateRent(world, place, data) {
  if (!place.home || place.home.kind !== 'rented') return null;
  if (data.landlord !== undefined && String(data.landlord).trim() !== place.home.landlordName) {
    const { landlord, landlordName } = resolveLandlord(world, place, data.landlord, {});
    place.home.landlordId = landlord ? landlord.id : null;
    place.home.landlordName = landlordName;
    place.owner = landlordName;
  }
  return setRentDeal(world, place, data, {});
}

export function rentDeals(world, place) {
  return (world.deals || []).filter((d) => d.homeId === place.id && d.status === 'open');
}

function closeDeal(world, d, status, why) {
  d.status = status;
  d.closed = shortDate(world);
  d.notes.push(`${shortDate(world)}: ${why}`);
}

function resolveLandlord(world, place, l, { before }) {
  let landlord = null;
  let landlordName = '';
  if (l && typeof l === 'object' && l.name) {
    // A full description (from character creation): a proper card.
    landlord = findPersonByName(world, l.name) || makePerson(world, { ...l, role: 'landlord' });
    if (!landlord.life.role) landlord.life.role = 'landlord';
    landlord.history.push({ date: before ? 'before the story' : shortDate(world), clock: world.clock, turn: world.turn, text: `Rents ${place.name} to the player.` });
  } else if (typeof l === 'string' && l.trim()) {
    // Just a name: the card is made when they first appear in the story.
    landlord = findPersonByName(world, l);
    landlordName = str(l, 80);
  }
  if (landlord) landlordName = landlord.fixed.name;
  return { landlord, landlordName };
}

/** Writes the rent deal for a rented home from its current landlord and the given rent. */
function setRentDeal(world, place, data, { before }) {
  const h = place.home;
  const rent = Math.max(0, Math.round(Number(data.rent) || 0));
  const every = data.rentEvery === 'week' ? 'week' : 'month';
  const who = h.landlordName || 'the landlord';
  const terms = rent
    ? `Rent for ${place.name}: ${money(world, rent)} a ${every}, paid to ${who}.`
    : `Rent for ${place.name}, paid to ${who}: the amount is not settled yet; when it matters, make it a fair ${every}ly rent for this setting.`;
  const due = str(data.rentDue, 120) || (every === 'week' ? 'every week' : 'the 1st of each month');
  world.deals = world.deals || [];
  const [existing, ...extra] = rentDeals(world, place);
  for (const d of extra) closeDeal(world, d, 'done', 'replaced by the current rent terms');
  if (existing) {
    if (existing.terms !== terms || existing.due !== due) existing.notes.push(`${shortDate(world)}: terms changed (was: ${existing.terms})`);
    Object.assign(existing, { terms, due, personId: h.landlordId, withName: who, rent, rentEvery: every });
    return existing;
  }
  const deal = {
    id: newId(world, 'd'), personId: h.landlordId, withName: who, homeId: place.id,
    terms, due, rent, rentEvery: every,
    status: 'open', made: before ? 'before the story' : shortDate(world), madeTurn: world.turn, notes: [],
  };
  world.deals.push(deal);
  return deal;
}

export function homes(world) {
  return Object.values(world.places).filter((pl) => pl.home);
}
