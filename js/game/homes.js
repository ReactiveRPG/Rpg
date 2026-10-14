// The player character's home: a place marked as theirs, owned or rented.
// A rented home has a landlord (a card, or just a name until they turn up)
// and a rent deal, which the game master sees every turn like any other deal.

import { makePlace, makePerson, connectPlaces, newId, findPersonByName } from './state.js';
import { money } from './packet.js';
import { shortDate } from './clock.js';

const str = (v, max) => String(v ?? '').trim().slice(0, max);

/**
 * Adds a home.
 *   data: { name, type, region, description, kind: 'owned'|'rented', travelMinutes,
 *           rent, rentEvery: 'week'|'month', rentDue, landlord: { name, sex, ... } | 'a name' | '' }
 *   before: true for a home the character had before the story began
 * Returns { place, landlord, deal }.
 */
export function addHome(world, data, { before = false } = {}) {
  const kind = data.kind === 'owned' ? 'owned' : 'rented';
  const place = makePlace(world, {
    name: str(data.name, 100) || 'Home', type: str(data.type, 60) || 'home', region: data.region,
    description: data.description,
  });
  if (world.currentPlaceId && world.currentPlaceId !== place.id) connectPlaces(world, world.currentPlaceId, place.id, data.travelMinutes || 20);

  let landlord = null;
  let landlordName = '';
  if (kind === 'rented') {
    const l = data.landlord;
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
    place.owner = landlordName;
  } else {
    place.owner = world.people[world.playerId]?.fixed.name || 'the player';
  }
  place.home = { kind, landlordId: landlord ? landlord.id : null, landlordName, since: before ? 'before the story' : shortDate(world) };

  let deal = null;
  if (kind === 'rented') {
    const rent = Math.max(0, Math.round(Number(data.rent) || 0));
    const every = data.rentEvery === 'week' ? 'week' : 'month';
    const who = landlordName || 'the landlord';
    const terms = rent
      ? `Rent for ${place.name}: ${money(world, rent)} a ${every}, paid to ${who}.`
      : `Rent for ${place.name}, paid to ${who}: the amount is not settled yet; when it matters, make it a fair ${every}ly rent for this setting.`;
    deal = {
      id: newId(world, 'd'), personId: landlord ? landlord.id : null, withName: who, homeId: place.id,
      terms, due: str(data.rentDue, 120) || (every === 'week' ? 'every week' : 'the 1st of each month'),
      status: 'open', made: before ? 'before the story' : shortDate(world), madeTurn: world.turn, notes: [],
    };
    world.deals = world.deals || [];
    world.deals.push(deal);
  }
  return { place, landlord, deal };
}

export function homes(world) {
  return Object.values(world.places).filter((pl) => pl.home);
}
