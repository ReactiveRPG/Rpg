// Inventory: a table outside the chat. Item, quantity, weight, value, where
// it is carried. Rows sort by tapping a column and filter by container.

import { h, overlay, toast } from './dom.js';
import { carriedItems, carriedWeight, weightLimits, slotLabel, hiddenLevel, SEARCH_LEVELS, SLOTS, INSIDE, canPlace, dependentSlotsInUse, directlyHeld } from '../game/inventory.js';
import { player, currentPlace } from '../game/state.js';
import { saveWorld } from '../game/saves.js';
import { money } from '../game/packet.js';
import { applyChanges } from '../game/changes.js';
import { isCashLike, cashAmount } from '../game/money.js';

const COLUMNS = [
  { key: 'name', label: 'Item', get: (it) => it.name.toLowerCase() },
  { key: 'qty', label: 'Qty', num: true, get: (it) => it.qty },
  { key: 'weight', label: 'kg', num: true, get: (it) => it.weight * it.qty },
  { key: 'value', label: 'Value', num: true, get: (it) => it.value * it.qty },
  { key: 'where', label: 'Where', get: (it, w) => slotLabel(it.slot, w, it) },
];

export function openInventory(ctx, onChange) {
  let sortKey = 'where';
  let sortDir = 1;
  let filter = 'all';
  const body = h('div');

  function render() {
    const w = ctx.world;
    const p = player(w);
    const all = carriedItems(w, p.id);
    const bags = all.filter((i) => (i.tags || []).includes('bag') || (i.tags || []).includes('container'));
    const filters = [['all', 'All'], ['body', 'On body'], ...bags.map((b) => [b.id, b.name])];
    let rows = all;
    if (filter === 'body') rows = all.filter((i) => i.holder === p.id);
    else if (filter !== 'all') rows = all.filter((i) => i.holder === filter);
    const col = COLUMNS.find((c) => c.key === sortKey);
    rows = [...rows].sort((a, b) => {
      const x = col.get(a, w); const y = col.get(b, w);
      return (x > y ? 1 : x < y ? -1 : 0) * sortDir;
    });
    const lim = weightLimits(w, p.id);
    const total = carriedWeight(w, p.id);
    const ground = directlyHeld(w, w.currentPlaceId);
    const cashItems = all.filter((i) => isCashLike(w, i));

    body.replaceChildren(...[
      h('div.chips', filters.map(([id, label]) => h('button.chip', { type: 'button', class: filter === id ? 'chip on' : 'chip', onclick: () => { filter = id; render(); } }, label))),
      h('div.table-wrap', h('table.sheet',
        h('thead', h('tr', COLUMNS.map((c) => h('th', {
          class: c.num ? 'num' : '',
          onclick: () => { if (sortKey === c.key) sortDir = -sortDir; else { sortKey = c.key; sortDir = 1; } render(); },
        }, c.label + (sortKey === c.key ? (sortDir > 0 ? ' ▲' : ' ▼') : ''))))),
        h('tbody', rows.length ? rows.map((it) => h('tr', { onclick: () => openItem(ctx, it, () => { render(); onChange && onChange(); }) },
          h('td', it.name, it.condition && it.condition !== 'good' ? h('small.dim', ` (${it.condition})`) : null),
          h('td.num', it.qty),
          h('td.num', +(it.weight * it.qty).toFixed(2)),
          h('td.num', it.value * it.qty),
          h('td', slotLabel(it.slot, w, it)))) : h('tr', h('td', { colSpan: 5 }, 'Nothing.'))),
        h('tfoot', h('tr',
          h('td', { colSpan: 2 }, 'Total'),
          h('td.num', { class: total > lim.limit ? 'num bad' : 'num' }, total.toFixed(1)),
          h('td', { colSpan: 2 }, `of ${lim.limit.toFixed(0)} kg${total > lim.hardCap ? ' — too heavy to move' : total > lim.limit ? ' — overloaded, slower' : ''}`))))),
      h('div.row', h('p.hint', `Money: ${money(w, p.money)}. Tap an item to see where it is hidden or move it.`),
        h('button.small', { type: 'button', onclick: () => fixMoney() }, 'Fix money')),
      moneyBox,
      cashItems.length ? h('div.notice',
        h('p', `Money stored as an item: ${cashItems.map((i) => i.name + (i.qty > 1 ? ` ×${i.qty}` : '')).join(', ')}.`),
        h('p.hint', 'Money only counts in your money total. Tap the item to add it to your money or remove it.')) : null,
      ground.length ? h('div',
        h('h3.sub', `On the ground at ${currentPlace(w)?.name || 'this place'}`),
        h('div.table-wrap', h('table.sheet', h('tbody', ground.map((it) => h('tr', { onclick: () => openItem(ctx, it, () => { render(); onChange && onChange(); }) },
          h('td', it.name), h('td.num', it.qty), h('td.num', +(it.weight * it.qty).toFixed(2)))))))) : null,
    ].filter(Boolean));
  }

  // Setting money by hand, for when the record got it wrong.
  const moneyBox = h('div');
  function fixMoney() {
    const w = ctx.world;
    const p = player(w);
    const box = h('input', { type: 'number', min: 0, value: p.money, inputmode: 'numeric', style: { width: '8em' } });
    moneyBox.replaceChildren(h('div.notice',
      h('label', 'How much money should you have?', box),
      h('div.row',
        h('button.primary', { type: 'button', onclick: async () => {
          const n = Math.max(0, Math.round(Number(box.value)));
          if (!Number.isFinite(n)) { toast('Enter a number'); return; }
          const was = p.money;
          moneyBox.replaceChildren();
          if (n === was) return;
          p.money = n;
          w.log.push({ turn: w.turn, kind: 'system', money: true, text: `Money set by you: ${money(w, was)} → ${money(w, n)}.` });
          await saveWorld(w);
          render();
          onChange && onChange();
        } }, 'Save'),
        h('button', { type: 'button', onclick: () => moneyBox.replaceChildren() }, 'Cancel'))));
    box.focus();
  }

  render();
  return overlay('Inventory', body);
}

/** Details of one item, with a list of places it can be moved to right now. */
function openItem(ctx, it, onDone) {
  const w = ctx.world;
  const p = player(w);
  const targets = [];
  for (const slot of Object.keys(SLOTS)) {
    if (it.holder === p.id && it.slot === slot) continue;
    const r = canPlace(w, it, p.id, slot);
    targets.push({ label: SLOTS[slot].label, holder: p.id, slot, ok: r.ok, reason: r.reason });
  }
  for (const bag of carriedItems(w, p.id).filter((i) => (i.tags || []).includes('bag') || (i.tags || []).includes('container'))) {
    if (bag.id === it.id || it.holder === bag.id) continue;
    const r = canPlace(w, it, bag.id, INSIDE);
    targets.push({ label: `In ${bag.name}`, holder: bag.id, slot: INSIDE, ok: r.ok, reason: r.reason });
  }
  if (it.holder !== w.currentPlaceId) targets.push({ label: 'Put down here', holder: w.currentPlaceId, slot: null, ok: true });

  const deps = dependentSlotsInUse(w, it);
  let panel;
  const move = async (t) => {
    if (deps.length && t.slot !== 'worn') { toast(`Empty ${deps.join(', ').toLowerCase()} first`); return; }
    const from = slotLabel(it.slot, w, it) || 'the ground';
    it.holder = t.holder;
    it.slot = t.slot;
    w.log.push({ turn: w.turn, kind: 'system', text: `${it.name}: ${from} → ${t.label.toLowerCase()}.` });
    await saveWorld(w);
    panel.close();
    onDone();
  };

  const body = h('div',
    h('dl.kv',
      h('dt', 'Quantity'), h('dd', it.qty),
      h('dt', 'Size'), h('dd', it.size),
      h('dt', 'Weight'), h('dd', `${it.weight} kg each`),
      h('dt', 'Value'), h('dd', money(w, it.value) + ' each'),
      h('dt', 'Condition'), h('dd', it.condition),
      it.tags.length ? [h('dt', 'Tags'), h('dd', it.tags.join(', '))] : null,
      it.capacity ? [h('dt', 'Room inside'), h('dd', it.capacity)] : null,
      h('dt', 'Where'), h('dd', slotLabel(it.slot, w, it) || 'on the ground'),
      it.slot ? [h('dt', 'Found by'), h('dd', SEARCH_LEVELS[hiddenLevel(w, it)])] : null,
      it.source ? [h('dt', 'Came from'), h('dd', it.source)] : null),
    isCashLike(w, it) ? cashSection() : null,
    h('h3.sub', 'Move to'),
    h('p.hint', 'Moving things around here is free. To hide something while someone watches, type it as an action instead.'),
    targets.map((t) => h('button.list-btn', { type: 'button', disabled: !t.ok, onclick: () => move(t) }, t.label, t.ok ? null : h('small', t.reason))),
    // Corrections, for when the story and the inventory disagree.
    h('h3.sub', 'Fix the record'),
    h('p.hint', 'If the story says this item changed hands or is gone but the game missed it, set it right here.'),
    w.present.filter((id) => w.people[id] && !w.people[id].dead).map((id) => h('button.list-btn', {
      type: 'button',
      onclick: () => correct({ op: 'move_item', itemId: it.id, to: id }, `${it.name}: now with ${w.people[id].fixed.name}.`),
    }, `Handed over to ${w.people[id].fixed.name}`)),
    h('button.list-btn.danger', {
      type: 'button',
      onclick: () => { if (confirm(`Remove ${it.name} from the game? (It was used up, lost, or should never have been there.)`)) correct({ op: 'use_up_item', itemId: it.id, qty: it.qty, reason: 'removed by the player' }, `${it.name}: removed.`); },
    }, 'Remove from the game'));
  function cashSection() {
    const amount = h('input', { type: 'number', min: 0, value: cashAmount(it), inputmode: 'numeric', style: { width: '8em' } });
    return h('div.notice',
      h('h3', 'This is money'),
      h('p.hint', 'Money belongs in your money total, not in your inventory. Check the amount, then add it.'),
      h('label', 'Amount', amount),
      h('button.primary', { type: 'button', onclick: async () => {
        const n = Math.max(0, Math.round(Number(amount.value) || 0));
        const was = p.money;
        p.money += n;
        it.gone = true;
        it.goneReason = 'added to money';
        w.log.push({ turn: w.turn, kind: 'system', money: true, text: `Money +${money(w, n)}: "${it.name}" added to your money. ${money(w, was)} → ${money(w, p.money)}.` });
        await saveWorld(w);
        panel.close();
        onDone();
      } }, 'Add to my money and remove this item'));
  }
  async function correct(change, note) {
    const { rejected } = applyChanges(w, [change], { trusted: true });
    if (rejected.length) { toast(`Could not do that: ${rejected[0].reason}`, 5000); return; }
    w.log.push({ turn: w.turn, kind: 'system', text: note });
    await saveWorld(w);
    panel.close();
    onDone();
  }
  panel = overlay(it.name, body);
}
