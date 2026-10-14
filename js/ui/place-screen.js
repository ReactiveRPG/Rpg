// The current place card: description, who is here, routes, items on the ground.

import { h, overlay, toast } from './dom.js';
import { currentPlace, makePlace, connectPlaces, findPlaceByName } from '../game/state.js';
import { addHome, homes } from '../game/homes.js';
import { directlyHeld } from '../game/inventory.js';
import { openCard } from './people-screen.js';
import { saveWorld } from '../game/saves.js';

export function openPlace(ctx, onChange) {
  const w = ctx.world;
  const pl = currentPlace(w);
  if (!pl) return overlay('Here', h('p', 'Nowhere in particular.'));
  const here = w.present.map((id) => w.people[id]).filter(Boolean);
  const ground = directlyHeld(w, pl.id);
  const body = h('div',
    h('div.card-block',
      h('h3', [pl.type, pl.region].filter(Boolean).join(' · ') || 'Place'),
      h('p', pl.description || ''),
      h('dl.kv',
        h('dt', 'State'), h('dd', pl.state),
        pl.owner ? [h('dt', 'Owner'), h('dd', pl.owner)] : null,
        pl.usual ? [h('dt', 'Usually'), h('dd', pl.usual)] : null,
        pl.soundTags.length ? [h('dt', 'Sounds'), h('dd', pl.soundTags.join(', '))] : null)),
    w.sceneState ? h('div.card-block', h('h3', 'Positions right now'), h('p', w.sceneState)) : null,
    h('div.card-block', h('h3', 'People here'),
      here.length ? here.map((p) => h('div.world-row',
        h('button.list-btn', { type: 'button', onclick: () => openCard(ctx, p) }, p.fixed.name, h('small', p.life.role || '')),
        // A correction for when the game still lists someone who is not with you.
        h('button.small', { type: 'button', onclick: async () => {
          w.present = w.present.filter((id) => id !== p.id);
          w.log.push({ turn: w.turn, kind: 'system', text: `${p.fixed.name} is not here.` });
          await saveWorld(w);
          panel.close();
          onChange && onChange();
          openPlace(ctx, onChange);
        } }, 'Not here'))) : h('p.hint', 'No one you know.')),
    h('div.card-block', h('h3', 'Known routes'),
      pl.connections.length ? h('ul.plain', pl.connections.map((c) => h('li', `${w.places[c.placeId]?.name} — ${c.minutes} min`))) : h('p.hint', 'None known yet.')),
    h('div.card-block', h('h3', 'Your home'),
      homes(w).length ? h('ul.plain', homes(w).map((x) => h('li', `${x.name} — ${x.home.kind === 'owned' ? 'owned' : `rented${x.home.landlordName ? ' from ' + x.home.landlordName : ''}`}${x.id === w.currentPlaceId ? ' (you are here)' : ''}`)))
        : h('p.hint', 'None recorded. If your character has a home, add it below so the game master never forgets it.'),
      h('button', { type: 'button', onclick: () => { panel.close(); openAddPlace(ctx, onChange); } }, 'Add a place you know')),
    ground.length ? h('div.card-block', h('h3', 'On the ground'), h('p', ground.map((i) => i.name + (i.qty > 1 ? ` ×${i.qty}` : '')).join(', '))) : null,
    h('p.hint', 'The full map comes in stage 4. Place pictures come in stage 7.'));
  const panel = overlay(pl.name, body);
  return panel;
}

/** A place the character knows that the game has not recorded yet, such as their home. */
export function openAddPlace(ctx, onChange) {
  const w = ctx.world;
  const field = (label, el, hint) => h('label', label, el, hint ? h('small.dim', ' ' + hint) : null);
  const name = h('input', { placeholder: 'e.g. My apartment, 212 Delancey Street' });
  const type = h('input', { placeholder: 'apartment, bar, workshop…' });
  const desc = h('textarea', { rows: 2, placeholder: 'Optional: what it is like' });
  const minutes = h('input', { type: 'number', min: 1, value: 20, inputmode: 'numeric', style: { width: '6em' } });
  const kind = h('select', h('option', { value: '' }, 'No, just a place I know'), h('option', { value: 'rented' }, 'Yes, I rent it'), h('option', { value: 'owned' }, 'Yes, I own it'));
  const landlord = h('input', { placeholder: 'Optional: e.g. Mrs. Russo, the old woman downstairs' });
  const rent = h('input', { type: 'number', min: 0, inputmode: 'numeric', placeholder: 'Optional', style: { width: '8em' } });
  const every = h('select', h('option', { value: 'month' }, 'a month'), h('option', { value: 'week' }, 'a week'));
  const due = h('input', { placeholder: 'Optional: e.g. the 1st of each month' });
  const rentBox = h('div', { style: { display: 'none' } },
    field('Landlord', landlord, 'Leave blank and the game will invent one when it matters.'),
    h('div.row', field('Rent', rent), every),
    h('p.hint', 'Leave the rent blank and the game picks a fair amount for the setting.'),
    field('Due', due));
  kind.addEventListener('change', () => { rentBox.style.display = kind.value === 'rented' ? '' : 'none'; });

  const save = async () => {
    const n = name.value.trim();
    if (!n) { toast('Give the place a name'); return; }
    if (findPlaceByName(w, n)) { toast('A place with that name already exists'); return; }
    let pl;
    if (kind.value) {
      ({ place: pl } = addHome(w, {
        name: n, type: type.value.trim(), description: desc.value.trim(), kind: kind.value, travelMinutes: Number(minutes.value) || 20,
        landlord: landlord.value.trim(), rent: Number(rent.value) || 0, rentEvery: every.value, rentDue: due.value.trim(),
      }));
    } else {
      pl = makePlace(w, { name: n, type: type.value.trim(), description: desc.value.trim() });
      connectPlaces(w, w.currentPlaceId, pl.id, Number(minutes.value) || 20);
    }
    w.log.push({ turn: w.turn, kind: 'system', text: `Added ${kind.value ? 'your home' : 'a place you know'}: ${pl.name}.` });
    await saveWorld(w);
    panel.close();
    toast(kind.value ? 'Home added' : 'Place added');
    onChange && onChange();
  };

  const body = h('div.settings',
    h('p.hint', 'For somewhere your character already knows but the game has not recorded, such as your home or workplace.'),
    field('Name', name), field('What kind of place', type), field('Description', desc),
    field('Minutes from here', minutes),
    field('Is it your home?', kind),
    rentBox,
    h('div.row', h('button.primary', { type: 'button', onclick: save }, 'Add'), h('button', { type: 'button', onclick: () => panel.close() }, 'Cancel')));
  const panel = overlay('Add a place you know', body);
  name.focus();
  return panel;
}
