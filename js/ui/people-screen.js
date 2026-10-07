// People: everyone carded. Tap a name for the full card.

import { h, overlay } from './dom.js';
import { ageOf } from '../game/state.js';
import { formatDate } from '../game/clock.js';
import { carriedItems } from '../game/inventory.js';

function relationSummary(r) {
  return `T ${r.trust} · F ${r.fear} · A ${r.attraction} · R ${r.respect}`;
}

export function openPeople(ctx) {
  const w = ctx.world;
  const people = Object.values(w.people).filter((p) => !p.isPlayer)
    .sort((a, b) => (w.present.includes(b.id) - w.present.includes(a.id)) || ((b.lastSeen ?? -1) - (a.lastSeen ?? -1)));
  const body = h('div',
    h('div.table-wrap', h('table.sheet',
      h('thead', h('tr', h('th', 'Name'), h('th', 'Role'), h('th', 'Relationship'), h('th', 'Last seen'))),
      h('tbody', people.length ? people.map((p) => h('tr', { onclick: () => openCard(ctx, p) },
        h('td', h('strong', p.fixed.name), p.dead ? h('small.dim', ' (dead)') : w.present.includes(p.id) ? h('small.dim', ' (here)') : null),
        h('td', p.life.role || p.life.job || ''),
        h('td', h('small', relationSummary(p.relationship))),
        h('td', h('small', w.present.includes(p.id) ? 'now' : p.lastSeen != null ? formatDate(w, p.lastSeen) : '—'))))
        : h('tr', h('td', { colSpan: 4 }, 'Nobody yet.'))))),
    h('p.hint', 'T trust · F fear · A attraction · R respect, each from −100 to 100.'),
    h('button.list-btn', { type: 'button', onclick: () => openCard(ctx, w.people[w.playerId]) }, 'Your own card'));
  overlay('People', body);
}

export function openCard(ctx, p) {
  const w = ctx.world;
  const life = Object.entries(p.life).filter(([, v]) => v);
  const visible = carriedItems(w, p.id);
  const body = h('div',
    h('div.card-block',
      h('h3', 'Fixed facts'),
      h('dl.kv',
        h('dt', 'Sex'), h('dd', p.fixed.sex),
        h('dt', 'Pronouns'), h('dd', p.fixed.pronouns),
        h('dt', 'Age'), h('dd', ageOf(w, p)),
        h('dt', 'Looks'), h('dd', p.fixed.looks || '—'),
        p.fixed.voice ? [h('dt', 'Voice'), h('dd', p.fixed.voice)] : null),
      h('p.hint', 'Portrait: comes in stage 7.')),
    p.dead ? h('div.card-block', h('h3', 'Dead'), h('p', p.deathNote)) : null,
    life.length ? h('div.card-block', h('h3', 'Life'), h('dl.kv', life.map(([k, v]) => [h('dt', k), h('dd', v)]))) : null,
    p.isPlayer && p.background ? h('div.card-block', h('h3', 'Background'), p.background.split(/\n{2,}/).map((t) => h('p', t))) : null,
    !p.isPlayer ? h('div.card-block', h('h3', 'Toward you'),
      h('dl.kv', ...['trust', 'fear', 'attraction', 'respect'].flatMap((k) => [h('dt', k), h('dd', p.relationship[k])]))) : null,
    !p.isPlayer ? h('div.card-block', h('h3', 'Shared history'),
      p.history.length ? h('ul.plain', p.history.map((x) => h('li', h('small.dim', x.date + ' — '), x.text))) : h('p.hint', 'Nothing yet.')) : null,
    visible.length && !p.isPlayer ? h('div.card-block', h('h3', 'Known to carry'), h('p', visible.map((i) => i.name).join(', '))) : null);
  overlay(p.fixed.name, body);
}
