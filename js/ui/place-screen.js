// The current place card: description, who is here, routes, items on the ground.

import { h, overlay } from './dom.js';
import { currentPlace } from '../game/state.js';
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
    ground.length ? h('div.card-block', h('h3', 'On the ground'), h('p', ground.map((i) => i.name + (i.qty > 1 ? ` ×${i.qty}` : '')).join(', '))) : null,
    h('p.hint', 'The full map comes in stage 4. Place pictures come in stage 7.'));
  const panel = overlay(pl.name, body);
  return panel;
}
