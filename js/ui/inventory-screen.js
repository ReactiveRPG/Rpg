// Inventory: a table outside the chat. Item, quantity, weight, value, where
// it is carried. Rows sort by tapping a column and filter by container.

import { h, overlay, toast } from './dom.js';
import { carriedItems, carriedWeight, weightLimits, slotLabel, hiddenLevel, SEARCH_LEVELS, SLOTS, INSIDE, SIZES, canPlace, findPlace, dependentSlotsInUse, directlyHeld, whereIs } from '../game/inventory.js';
import { player, currentPlace, makeItem } from '../game/state.js';
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
      h('div.row',
        h('button.small', { type: 'button', onclick: () => openFinder(ctx, () => { render(); onChange && onChange(); }) }, 'Where is everything?'),
        h('button.small', { type: 'button', onclick: () => openAddItem(ctx, () => { render(); onChange && onChange(); }) }, 'Add an item you have')),
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
  const mine = !it.gone && whereIs(w, it).group === 'you';
  // Moving by hand is for what you carry or what lies here; anything else is brought to you first.
  const movable = !it.gone && (mine || it.holder === w.currentPlaceId);
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
      h('dt', 'Where'), h('dd', mine ? slotLabel(it.slot, w, it) : whereIs(w, it).label),
      it.slot ? [h('dt', 'Found by'), h('dd', SEARCH_LEVELS[hiddenLevel(w, it)])] : null,
      it.source ? [h('dt', 'Came from'), h('dd', it.source)] : null),
    isCashLike(w, it) ? cashSection() : null,
    !mine && it.holder !== w.currentPlaceId ? h('div.notice',
      h('p', `Where it is: ${whereIs(w, it).label}.`),
      h('button.primary', { type: 'button', onclick: async () => {
        const note = bringToMe(w, it);
        await saveWorld(w);
        panel.close();
        onDone();
        toast(note);
      } }, it.gone ? 'Bring it back to me' : 'Bring it to me')) : null,
    movable ? [
      h('h3.sub', 'Move to'),
      h('p.hint', 'Moving things around here is free. To hide something while someone watches, type it as an action instead.'),
      targets.map((t) => h('button.list-btn', { type: 'button', disabled: !t.ok, onclick: () => move(t) }, t.label, t.ok ? null : h('small', t.reason))),
    ] : null,
    // Corrections, for when the story and the inventory disagree.
    h('h3.sub', 'Fix the record'),
    !it.gone ? [
      h('p.hint', 'If the story says this item changed hands or is gone but the game missed it, set it right here.'),
      w.present.filter((id) => w.people[id] && !w.people[id].dead && id !== it.holder).map((id) => h('button.list-btn', {
        type: 'button',
        onclick: () => correct({ op: 'move_item', itemId: it.id, to: id }, `${it.name}: now with ${w.people[id].fixed.name}.`),
      }, `Handed over to ${w.people[id].fixed.name}`)),
      h('button.list-btn.danger', {
        type: 'button',
        onclick: () => { if (confirm(`Remove ${it.name} from the game? (It was used up, lost, or should never have been there.)`)) correct({ op: 'use_up_item', itemId: it.id, qty: it.qty, reason: 'removed by the player' }, `${it.name}: removed.`); },
      }, 'Remove from the game'),
    ] : null,
    h('button.list-btn', { type: 'button', onclick: () => { panel.close(); openEditItem(ctx, it, onDone); } }, 'Edit this item (name, size, tags…)'));
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

/** Puts an item (even a gone one) back on the player, or on the ground here if there is no room. Returns a note. */
function bringToMe(w, it) {
  const p = player(w);
  const wasGone = it.gone;
  const from = whereIs(w, it).label;
  if (it.gone) { it.gone = false; delete it.goneReason; it.qty = Math.max(1, it.qty || 0); }
  it.holder = null; it.slot = null;
  const spot = findPlace(w, it, p.id);
  if (spot) { it.holder = spot.holder; it.slot = spot.slot; }
  else { it.holder = w.currentPlaceId; it.slot = null; }
  const where = spot ? (spot.slot === INSIDE ? `in ${w.items[spot.holder].name}` : SLOTS[spot.slot].label.toLowerCase()) : 'on the ground here (no room on you)';
  const note = `${it.name}: ${wasGone ? 'brought back' : 'brought to you'} (was ${from}), now ${where}.`;
  w.log.push({ turn: w.turn, kind: 'system', text: note });
  return note;
}

/** Every item in the game, grouped by where it is, with a search box. */
function openFinder(ctx, onDone) {
  const w = ctx.world;
  const search = h('input', { type: 'search', placeholder: 'Search, e.g. .38 or gun', autocapitalize: 'off' });
  const list = h('div');
  const GROUPS = [['you', 'On you'], ['place', 'At places'], ['person', 'With other people'], ['gone', 'Gone'], ['lost', 'Lost track of']];
  function render() {
    const q = search.value.trim().toLowerCase();
    const items = Object.values(w.items).filter((i) => !q || i.name.toLowerCase().includes(q) || (i.tags || []).some((t) => t.includes(q)));
    const rows = items.map((it) => ({ it, where: whereIs(w, it) }));
    list.replaceChildren(...GROUPS.map(([g, title]) => {
      const mine = rows.filter((r) => r.where.group === g).sort((a, b) => a.it.name.localeCompare(b.it.name));
      if (!mine.length) return null;
      return h('div', h('h3.sub', `${title} (${mine.length})`),
        mine.map(({ it, where }) => h('button.list-btn', { type: 'button', onclick: () => { panel.close(); openItem(ctx, it, onDone); } },
          it.name + (it.qty > 1 ? ` ×${it.qty}` : ''),
          h('small', [where.label, it.source === 'starting gear' ? 'starting gear' : ''].filter(Boolean).join(' · ')))));
    }).filter(Boolean));
    if (!list.childNodes.length) list.append(h('p.hint', 'Nothing matches.'));
  }
  search.addEventListener('input', render);
  render();
  const panel = overlay('Where is everything?', h('div',
    h('p.hint', 'Every item the game knows about, wherever it is. Tap one to bring it to you, edit it, or remove it.'),
    search, list));
}

/** The fields for an item: name, quantity, size, weight, value, tags. */
function itemFields(it = {}) {
  const name = h('input', { value: it.name || '', placeholder: 'e.g. .38 revolver' });
  const qty = h('input', { type: 'number', min: 1, value: it.qty || 1, inputmode: 'numeric', style: { width: '6em' } });
  const size = h('select', SIZES.map((sz) => h('option', { value: sz, selected: (it.size || 'small') === sz }, sz)));
  const weight = h('input', { type: 'number', min: 0, step: 0.1, value: it.weight ?? '', placeholder: 'kg', inputmode: 'decimal', style: { width: '6em' } });
  const value = h('input', { type: 'number', min: 0, value: it.value ?? '', placeholder: 'each', inputmode: 'numeric', style: { width: '6em' } });
  const tags = h('input', { value: (it.tags || []).join(', '), placeholder: 'e.g. weapon, gun', autocapitalize: 'off' });
  const el = h('div',
    h('label', 'Name', name),
    h('div.row', h('label', 'How many', qty), h('label', 'Size', size)),
    h('div.row', h('label', 'Weight (kg each)', weight), h('label', 'Value (each)', value)),
    h('label', 'Tags', tags),
    h('p.hint', 'Tags help the game: "weapon" for weapons, "bag" or "container" for things that hold others, "pants"/"jacket"/"boots" etc. for clothing.'));
  const values = () => ({
    name: name.value.trim().slice(0, 80), qty: Math.max(1, Math.round(Number(qty.value) || 1)), size: size.value,
    weight: Math.max(0, Number(weight.value) || 0), value: Math.max(0, Math.round(Number(value.value) || 0)),
    tags: [...new Set(tags.value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 8),
  });
  return { el, values, focus: () => name.focus() };
}

function openEditItem(ctx, it, onDone) {
  const w = ctx.world;
  const f = itemFields(it);
  const save = async () => {
    const v = f.values();
    if (!v.name) { toast('Give it a name'); return; }
    if (isCashLike(w, v)) { toast('Money is not an item: use Fix money instead'); return; }
    const was = it.name;
    Object.assign(it, v);
    w.log.push({ turn: w.turn, kind: 'system', text: was === it.name ? `${it.name}: edited by you.` : `${was}: renamed by you to ${it.name}.` });
    await saveWorld(w);
    panel.close();
    onDone();
  };
  const panel = overlay(`Edit ${it.name}`, h('div.settings', f.el,
    h('div.row', h('button.primary', { type: 'button', onclick: save }, 'Save'), h('button', { type: 'button', onclick: () => panel.close() }, 'Cancel'))));
}

/** Something the story gave the character that the record never got. */
function openAddItem(ctx, onDone) {
  const w = ctx.world;
  const p = player(w);
  const f = itemFields();
  const where = h('select',
    h('option', { value: '' }, 'Wherever it fits'),
    Object.entries(SLOTS).map(([id, d]) => h('option', { value: id }, d.label)));
  const save = async () => {
    const v = f.values();
    if (!v.name) { toast('Give it a name'); return; }
    if (isCashLike(w, v)) { toast('Money is not an item: use Fix money instead'); return; }
    const it = makeItem(w, { ...v, source: 'added by you' }, null, null);
    const want = where.value && canPlace(w, it, p.id, where.value).ok ? { holder: p.id, slot: where.value } : null;
    if (where.value && !want) toast(`${SLOTS[where.value].label}: ${canPlace(w, it, p.id, where.value).reason}; put somewhere else`, 5000);
    const spot = want || findPlace(w, it, p.id);
    if (spot) { it.holder = spot.holder; it.slot = spot.slot; }
    else { it.holder = w.currentPlaceId; it.slot = null; }
    w.log.push({ turn: w.turn, kind: 'system', text: `${it.name}: added by you, ${spot ? slotLabel(it.slot, w, it).toLowerCase() : 'on the ground here (no room on you)'}.` });
    await saveWorld(w);
    panel.close();
    onDone();
  };
  const panel = overlay('Add an item you have', h('div.settings',
    h('p.hint', 'For something the story gave you that the inventory is missing.'),
    f.el, h('label', 'Where you carry it', where),
    h('div.row', h('button.primary', { type: 'button', onclick: save }, 'Add'), h('button', { type: 'button', onclick: () => panel.close() }, 'Cancel'))));
  f.focus();
}
