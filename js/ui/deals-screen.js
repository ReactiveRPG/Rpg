// Deals and promises: what was agreed, with whom, and whether it is still open.
// The record-keeper writes these from the story; the player can close one by hand.

import { h, overlay } from './dom.js';
import { saveWorld } from '../game/saves.js';
import { applyChanges } from '../game/changes.js';

export function openDeals(ctx, onChange) {
  const body = h('div');
  let panel;

  async function setStatus(d, status) {
    const w = ctx.world;
    applyChanges(w, [{ op: 'deal_update', dealId: d.id, status, note: status === 'open' ? 'reopened by the player' : `marked ${status} by the player` }], { trusted: true });
    w.log.push({ turn: w.turn, kind: 'system', text: `Deal with ${d.withName || 'someone'}: ${status === 'open' ? 'reopened' : `marked ${status}`}.` });
    await saveWorld(w);
    render();
    onChange && onChange();
  }

  function dealCard(d) {
    return h('div.card-block',
      h('h3', `${d.withName || 'Someone'} · ${d.status}`),
      h('p', d.terms),
      h('p.hint', `Made ${d.made}${d.due ? ` · due ${d.due}` : ''}${d.closed ? ` · closed ${d.closed}` : ''}`),
      d.notes.length ? h('ul.plain', d.notes.map((n) => h('li', h('small', n)))) : null,
      h('div.row', d.status === 'open'
        ? [h('button.small', { type: 'button', onclick: () => setStatus(d, 'done') }, 'Mark done'),
          h('button.small.danger', { type: 'button', onclick: () => setStatus(d, 'broken') }, 'Mark broken')]
        : h('button.small', { type: 'button', onclick: () => setStatus(d, 'open') }, 'Reopen')));
  }

  function render() {
    const deals = ctx.world.deals || [];
    const open = deals.filter((d) => d.status === 'open');
    const closed = deals.filter((d) => d.status !== 'open').reverse();
    body.replaceChildren(...[
      h('p.hint', 'Agreements, jobs, debts and promises. The game master is reminded of every open one each turn.'),
      open.length ? open.map(dealCard) : h('p', 'No open deals.'),
      closed.length ? h('h3.sub', 'Finished and broken') : null,
      ...closed.slice(0, 30).map(dealCard),
    ].flat().filter(Boolean));
  }

  render();
  panel = overlay('Deals and promises', body);
  return panel;
}
