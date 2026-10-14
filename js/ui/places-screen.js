// Places: every place the game knows, with a card for each and the controls
// for marking, changing or ending the player's home by hand.

import { h, overlay } from './dom.js';
import { directlyHeld } from '../game/inventory.js';
import { saveWorld } from '../game/saves.js';
import { makeHome, endHome, updateRent, rentDeals } from '../game/homes.js';
import { openAddPlace } from './place-screen.js';

function homeLabel(pl) {
  if (!pl.home) return '';
  return pl.home.kind === 'owned' ? 'Your home (owned)' : `Your home (rented${pl.home.landlordName ? ' from ' + pl.home.landlordName : ''})`;
}

/** Travel time from where the player is, if a route is known. */
function fromHere(w, pl) {
  if (pl.id === w.currentPlaceId) return 'you are here';
  const here = w.places[w.currentPlaceId];
  const c = here && here.connections.find((x) => x.placeId === pl.id);
  return c ? `${c.minutes} min from here` : '';
}

export function openPlaces(ctx, onChange) {
  const body = h('div');
  const changed = () => { render(); onChange && onChange(); };
  function render() {
    const w = ctx.world;
    const rank = (pl) => (pl.id === w.currentPlaceId ? 0 : pl.home ? 1 : 2);
    const list = Object.values(w.places).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    body.replaceChildren(
      h('p.hint', 'Every place the game knows. Tap one to see its card or to make it your home. To go somewhere, type it as an action.'),
      ...list.map((pl) => h('button.list-btn', { type: 'button', onclick: () => openPlaceCard(ctx, pl, changed) },
        pl.name,
        h('small', [pl.home ? '🏠 ' + homeLabel(pl) : '', [pl.type, pl.region].filter(Boolean).join(' · '), fromHere(w, pl)].filter(Boolean).join(' · ')))),
      h('div.row', h('button', { type: 'button', onclick: () => { panel.close(); openAddPlace(ctx, onChange); } }, 'Add a place you know')));
  }
  render();
  const panel = overlay('Places', body);
  return panel;
}

/** The fields for a rented home: landlord, rent, how often, when due. */
function rentFields(w, pl) {
  const deal = rentDeals(w, pl)[0];
  const landlord = h('input', { value: pl.home?.landlordName || '', placeholder: 'Optional: e.g. Mrs. Russo' });
  const rent = h('input', { type: 'number', min: 0, inputmode: 'numeric', value: deal?.rent || '', placeholder: 'Optional', style: { width: '8em' } });
  const every = h('select', h('option', { value: 'month', selected: deal?.rentEvery !== 'week' }, 'a month'), h('option', { value: 'week', selected: deal?.rentEvery === 'week' }, 'a week'));
  const due = h('input', { value: deal?.due || '', placeholder: 'Optional: e.g. the 1st of each month' });
  const el = h('div',
    h('label', 'Landlord', landlord, h('small.dim', ' Leave blank and the game invents one when it matters.')),
    h('div.row', h('label', 'Rent', rent), every),
    h('p.hint', 'Leave the rent blank and the game picks a fair amount for the setting.'),
    h('label', 'Due', due));
  return { el, values: () => ({ landlord: landlord.value.trim(), rent: Number(rent.value) || 0, rentEvery: every.value, rentDue: due.value.trim() }) };
}

export function openPlaceCard(ctx, pl, onChange) {
  const w = ctx.world;
  const ground = directlyHeld(w, pl.id);
  const homeBox = h('div.card-block');
  const done = async (note) => {
    w.log.push({ turn: w.turn, kind: 'system', text: note });
    await saveWorld(w);
    panel.close();
    onChange && onChange();
    openPlaceCard(ctx, pl, onChange);
  };

  function homeView() {
    if (!pl.home) {
      homeBox.replaceChildren(h('h3', 'Home'),
        h('p.hint', 'Not your home.'),
        h('button', { type: 'button', onclick: makeForm }, 'Make this my home'));
      return;
    }
    const deal = rentDeals(w, pl)[0];
    homeBox.replaceChildren(h('h3', 'Home'),
      h('p', homeLabel(pl) + (pl.home.since ? `, since ${pl.home.since}` : '')),
      deal ? h('p.hint', `${deal.terms} Due: ${deal.due}.`) : null,
      h('div.row',
        pl.home.kind === 'rented' ? h('button', { type: 'button', onclick: rentForm }, 'Change landlord or rent') : null,
        h('button', { type: 'button', onclick: endForm }, 'No longer my home')));
  }

  function makeForm() {
    const kind = h('select', h('option', { value: 'rented' }, 'I rent it'), h('option', { value: 'owned' }, 'I own it'));
    const rent = rentFields(w, pl);
    kind.addEventListener('change', () => { rent.el.style.display = kind.value === 'rented' ? '' : 'none'; });
    homeBox.replaceChildren(h('h3', 'Make this my home'), h('label', 'How do you hold it?', kind), rent.el,
      h('div.row',
        h('button.primary', { type: 'button', onclick: () => {
          makeHome(w, pl, { kind: kind.value, ...(kind.value === 'rented' ? rent.values() : {}) });
          done(`${pl.name} is now your home (${kind.value}).`);
        } }, 'Save'),
        h('button', { type: 'button', onclick: homeView }, 'Cancel')));
  }

  function rentForm() {
    const rent = rentFields(w, pl);
    homeBox.replaceChildren(h('h3', 'Change landlord or rent'), rent.el,
      h('div.row',
        h('button.primary', { type: 'button', onclick: () => {
          updateRent(w, pl, rent.values());
          done(`Rent for ${pl.name} updated.`);
        } }, 'Save'),
        h('button', { type: 'button', onclick: homeView }, 'Cancel')));
  }

  function endForm() {
    const deal = rentDeals(w, pl)[0];
    const close = h('input', { type: 'checkbox', checked: true });
    homeBox.replaceChildren(h('h3', 'No longer my home'),
      h('p.hint', `${pl.name} stays on the list as a place you know.`),
      deal ? h('label.switch', 'Mark the rent deal as done', close) : null,
      h('div.row',
        h('button.primary', { type: 'button', onclick: () => {
          endHome(w, pl, { closeRent: !deal || close.checked });
          done(`${pl.name} is no longer your home.`);
        } }, 'Confirm'),
        h('button', { type: 'button', onclick: homeView }, 'Cancel')));
  }

  homeView();
  const body = h('div',
    h('div.card-block',
      h('h3', [pl.type, pl.region].filter(Boolean).join(' · ') || 'Place'),
      pl.description ? h('p', pl.description) : null,
      h('dl.kv',
        h('dt', 'State'), h('dd', pl.state),
        pl.owner ? [h('dt', 'Owner'), h('dd', pl.owner)] : null,
        pl.usual ? [h('dt', 'Usually'), h('dd', pl.usual)] : null,
        fromHere(w, pl) ? [h('dt', 'Distance'), h('dd', fromHere(w, pl))] : null)),
    homeBox,
    h('div.card-block', h('h3', 'Routes from here'),
      pl.connections.length ? h('ul.plain', pl.connections.map((c) => h('li', `${w.places[c.placeId]?.name} — ${c.minutes} min`))) : h('p.hint', 'None known yet.')),
    ground.length ? h('div.card-block', h('h3', 'Left here'), h('p', ground.map((i) => i.name + (i.qty > 1 ? ` ×${i.qty}` : '')).join(', '))) : null);
  const panel = overlay(pl.name, body);
  return panel;
}
