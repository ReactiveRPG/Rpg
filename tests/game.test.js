import { test } from 'node:test';
import assert from 'node:assert/strict';
import { check } from '../js/game/dice.js';
import { worldFromPremise, addCharacter, normaliseChoices } from '../js/game/creation.js';
import { canPlace, findPlace, carriedItems, carriedWeight, dependentSlotsInUse } from '../js/game/inventory.js';
import { makeItem, undoTurns, pushSnapshot } from '../js/game/state.js';
import { applyChanges } from '../js/game/changes.js';
import { playTurn, normaliseRuling } from '../js/game/turn.js';
import { formatDateTime, durationSeconds } from '../js/game/clock.js';
import { buildPacket } from '../js/game/packet.js';

const seq = (...vals) => { let i = 0; return () => vals[i++ % vals.length]; };
const d20 = (n) => (n - 1) / 20 + 0.001; // rng value that rolls n on a d20

function newGame() {
  const w = worldFromPremise({
    title: 'Saltmarsh', setting: 'A rainy harbour town.', currency: { name: 'penny', plural: 'pennies' },
    startDate: { year: 1247, month: 3, day: 4, hour: 21 },
    startPlace: { name: 'The Drowned Rat', type: 'tavern', region: 'Lower Quays', description: 'A low smoky taproom.' },
    nearbyPlaces: [{ name: 'Harbour Wall', type: 'street', description: 'Wet stone.', travelMinutes: 5 }],
    priceCatalogue: [{ name: 'ale', value: 2 }],
  }, 'rainy harbour');
  const choices = normaliseChoices({ name: 'Ada Venn', sex: 'female', age: 29, looks: 'Short, scarred lip.', background: 'Ex-sailor turned smuggler.' });
  addCharacter(w, choices, {
    backstory: 'You ran salt.', attributes: { strength: 1, agility: 2, toughness: 1, wits: 1, charm: 0, nerve: 9 },
    skills: [{ name: 'Lockpicking', level: 3 }, { name: 'Blades', level: 7 }, { name: 'Made up', level: 2 }],
    money: 40,
    gear: [
      { name: 'Knife', size: 'small', weight: 0.3, tags: ['weapon'], slot: 'belt' },
      { name: 'Lockpicks', size: 'tiny', weight: 0.1, tags: ['tool'], slot: 'pants_pockets' },
      { name: 'Wool trousers', size: 'medium', weight: 0.8, tags: ['pants', 'clothing'], slot: 'worn' },
      { name: 'Oilskin jacket', size: 'medium', weight: 1.5, tags: ['jacket', 'clothing'], slot: 'worn' },
      { name: 'Anvil', size: 'huge', weight: 60, slot: 'pants_pockets' },
    ],
    ally: { name: 'Tomas Reed', sex: 'male', pronouns: 'he/him', age: 50, looks: 'Grey beard.', role: 'old captain', why: 'Saved his ship.' },
    enemy: { name: 'Mirela Dusk', sex: 'female', pronouns: 'she/her', age: 35, looks: 'Tall.', role: 'customs officer', why: 'You humiliated her.' },
  });
  return w;
}

test('checks: natural 20 and 1, success at a cost', () => {
  assert.equal(check({ difficulty: 30 }, seq(d20(20))).outcome, 'success');
  assert.equal(check({ skillLevel: 10, attributeMod: 3, difficulty: 5 }, seq(d20(1))).outcome, 'failure');
  assert.equal(check({ skillLevel: 2, attributeMod: 1, difficulty: 15 }, seq(d20(12))).outcome, 'success'); // 15
  assert.equal(check({ skillLevel: 2, attributeMod: 1, difficulty: 15 }, seq(d20(9))).outcome, 'success_at_cost'); // 12
  assert.equal(check({ skillLevel: 2, attributeMod: 1, difficulty: 15 }, seq(d20(8))).outcome, 'failure'); // 11
});

test('character creation keeps player choices and clamps numbers', () => {
  const w = newGame();
  const p = w.people[w.playerId];
  assert.equal(p.fixed.name, 'Ada Venn');
  assert.equal(p.fixed.pronouns, 'she/her');
  assert.equal(p.attributes.nerve, 3);
  assert.equal(p.skills.Blades, 4);
  assert.equal(p.skills['Made up'], undefined);
  const items = carriedItems(w, p.id).map((i) => `${i.name}@${i.slot}`);
  assert.ok(items.includes('Lockpicks@pants_pockets'));
  assert.ok(items.includes('Knife@belt'));
  // The anvil does not fit in a pocket; it lands in both hands rather than the pocket.
  const anvil = Object.values(w.items).find((i) => i.name === 'Anvil');
  assert.notEqual(anvil.slot, 'pants_pockets');
  assert.equal(Object.values(w.people).length, 3);
});

test('slots: size, count, needs clothing, mouth and cavity', () => {
  const w = newGame();
  const pid = w.playerId;
  const pistol = makeItem(w, { name: 'Pistol', size: 'small', tags: ['weapon'] }, null, null);
  const coin = makeItem(w, { name: 'Coin', size: 'tiny' }, null, null);
  const book = makeItem(w, { name: 'Book', size: 'medium' }, null, null);
  assert.equal(canPlace(w, coin, pid, 'mouth').ok, true);
  assert.equal(canPlace(w, pistol, pid, 'mouth').ok, false);
  assert.equal(canPlace(w, pistol, pid, 'cavity').ok, true);
  assert.equal(canPlace(w, book, pid, 'pants_pockets').ok, false);
  assert.equal(canPlace(w, book, pid, 'pant_leg_left').ok, false, 'pant leg holds weapons only');
  assert.equal(canPlace(w, pistol, pid, 'pant_leg_left').ok, true);
  assert.equal(canPlace(w, coin, pid, 'foot_left').ok, false, 'no socks or boots worn');
  const trousers = Object.values(w.items).find((i) => i.name === 'Wool trousers');
  assert.deepEqual(dependentSlotsInUse(w, trousers), ['Pants pockets', 'Belt or waistband']);
});

test('changes: fixed facts, item sources, reach, money, dead stay dead', () => {
  const w = newGame();
  const ally = Object.values(w.people).find((p) => p.fixed.name === 'Tomas Reed');
  const r = applyChanges(w, [
    { op: 'person_update', personId: ally.id, field: 'sex', newValue: 'female' },
    { op: 'person_update', personId: ally.id, field: 'mood', newValue: 'angry' },
    { op: 'new_item', name: 'Gold bar', to: 'player' },
    { op: 'new_item', name: 'Mug of ale', to: 'player', source: 'bought from barkeep', size: 'medium', weight: 0.6, tags: ['drink'] },
    { op: 'pay', from: w.playerId, amount: 2, reason: 'ale' },
    { op: 'pay', from: w.playerId, amount: 999 },
    { op: 'person_dies', personId: 'Tomas Reed', reason: 'stabbed' },
    { op: 'person_enters', personId: ally.id },
    { op: 'relationship', personId: ally.id, aspect: 'trust', direction: 'up', change: 'major' },
    { op: 'person_dies', personId: w.playerId },
    { op: 'teleport' },
  ]);
  const reasons = r.rejected.map((x) => x.reason).join(' | ');
  assert.equal(ally.fixed.sex, 'male');
  assert.equal(ally.life.mood, 'angry');
  assert.match(reasons, /fixed fact/);
  assert.match(reasons, /without a source/);
  assert.match(reasons, /not enough money/);
  assert.match(reasons, /Tomas Reed is dead/);
  assert.match(reasons, /cannot die/);
  assert.match(reasons, /unknown change/);
  assert.equal(w.people[w.playerId].money, 38);
  assert.ok(ally.dead);
  assert.ok(Object.values(w.items).some((i) => i.name === 'Mug of ale' && i.holder !== w.currentPlaceId));
});

test('items cannot be used after they are gone or when not here', () => {
  const w = newGame();
  const picks = Object.values(w.items).find((i) => i.name === 'Lockpicks');
  let r = applyChanges(w, [{ op: 'use_up_item', itemId: picks.id, reason: 'snapped' }]);
  assert.equal(r.applied.length, 1);
  r = applyChanges(w, [{ op: 'move_item', itemId: picks.id, to: 'here' }]);
  assert.match(r.rejected[0].reason, /gone/);
  const far = Object.values(w.places).find((p) => p.name === 'Harbour Wall');
  const coin = makeItem(w, { name: 'Lost coin', size: 'tiny' }, far.id, null);
  r = applyChanges(w, [{ op: 'move_item', itemId: coin.id, to: 'player' }]);
  assert.match(r.rejected[0].reason, /not here/);
});

test('undo restores everything, and only the last 20 turns', () => {
  const w = newGame();
  const before = JSON.stringify({ ...w, snapshots: undefined });
  pushSnapshot(w);
  w.clock += 999; w.people[w.playerId].money = 0; w.turn = 1;
  const back = undoTurns(w, 1);
  assert.equal(JSON.stringify({ ...back, snapshots: undefined, updatedAt: w.updatedAt }), JSON.stringify({ ...JSON.parse(before), snapshots: undefined, updatedAt: w.updatedAt }));
  for (let i = 0; i < 25; i++) pushSnapshot(w);
  assert.equal(w.snapshots.length, 20);
});

test('a full turn with a fake AI: referee, roll, narrator, changes, clock', async () => {
  const w = newGame();
  const startClock = w.clock;
  const calls = [];
  const ask = async (req) => {
    calls.push(req);
    if (calls.length === 1) {
      return { ok: true, data: { possible: true, needsCheck: true, skill: 'Lockpicking', attribute: 'agility', difficulty: 15, duration: 'task', kind: 'other', note: '' } };
    }
    return { ok: true, data: { prose: 'The lock gives.', changes: [
      { op: 'new_person', name: 'Bren', sex: 'male', pronouns: 'he/him', age: 40, looks: 'Bald.', role: 'barkeep' },
      { op: 'history', personId: 'Bren', text: 'Watched the player pick the cellar lock.' },
      { op: 'person_update', personId: 'Bren', field: 'pronouns', newValue: 'she/her' },
    ] } };
  };
  const r = await playTurn(w, 'I pick the cellar lock', { ask, rng: seq(d20(10), 0.5) });
  assert.equal(r.ok, true);
  assert.equal(r.roll.total, 10 + 3 + 2);
  assert.equal(r.roll.outcome, 'success');
  assert.equal(w.turn, 1);
  assert.ok(w.clock - startClock >= 15 * 60 && w.clock - startClock <= 30 * 60);
  const bren = Object.values(w.people).find((p) => p.fixed.name === 'Bren');
  assert.equal(bren.fixed.pronouns, 'he/him');
  assert.equal(bren.history.length, 1);
  assert.ok(w.present.includes(bren.id));
  assert.equal(w.rejected.length, 1);
  assert.equal(w.snapshots.length, 1);
  assert.match(calls[1].messages[0].text, /SUCCEEDS/);
  // Undo takes it all back.
  const back = undoTurns(w, 1);
  assert.equal(back.turn, 0);
  assert.equal(back.clock, startClock);
  assert.ok(!Object.values(back.people).some((p) => p.fixed.name === 'Bren'));
});

test('a failed narration keeps the dice for the resend', async () => {
  const w = newGame();
  let n = 0;
  const ask = async () => {
    n++;
    if (n === 1) return { ok: true, data: { possible: true, needsCheck: true, skill: 'Lockpicking', difficulty: 15, duration: 'short', kind: 'other' } };
    if (n === 2) return { ok: false, kind: 'blocked', message: 'blocked' };
    return { ok: true, data: { prose: 'Done.', changes: [] } };
  };
  const first = await playTurn(w, 'pick it', { ask, rng: seq(d20(2)) });
  assert.equal(first.ok, false);
  assert.equal(w.turn, 0, 'nothing changed');
  const second = await playTurn(w, 'pick it', { ask, pending: first.pending, rng: seq(d20(20)) });
  assert.equal(second.ok, true);
  assert.equal(second.roll.die, 2, 'same roll as before');
  assert.equal(n, 3, 'referee not asked again');
});

test('rewrite is canon: no referee, no roll, relaxed item sources', async () => {
  const w = newGame();
  const reqs = [];
  const ask = async (req) => { reqs.push(req); return { ok: true, data: { prose: 'She laughs and hands you a key.', changes: [{ op: 'new_item', name: 'Brass key', size: 'tiny', tags: ['key'], to: 'player' }] } }; };
  const r = await playTurn(w, 'Mirela laughs and hands me a key', { ask, rewrite: true });
  assert.equal(r.ok, true);
  assert.equal(reqs.length, 1);
  assert.equal(r.roll, undefined);
  assert.ok(Object.values(w.items).some((i) => i.name === 'Brass key' && !i.gone));
});

test('clock and durations', () => {
  const w = newGame();
  assert.equal(formatDateTime(w), 'Saturday, March 4, 1247 · 9:00 pm'.replace('Saturday', formatDateTime(w).split(',')[0]));
  assert.match(formatDateTime(w), /March 4, 1247 · 9:00 pm$/);
  assert.equal(durationSeconds('instant'), 0);
  const m = durationSeconds('moment');
  assert.ok(m >= 5 && m <= 15);
  assert.equal(durationSeconds('long', 120), 7200);
});

test('packet carries fixed facts, inventory and hiding', () => {
  const w = newGame();
  const ally = Object.values(w.people).find((p) => p.fixed.name === 'Tomas Reed');
  w.present.push(ally.id);
  const text = buildPacket(w);
  assert.match(text, /Ada Venn — female, pronouns she\/her, age 29 \(adult\)/);
  assert.match(text, /Tomas Reed — male, pronouns he\/him/);
  assert.match(text, /Lockpicks .*Pants pockets \[found by any pat-down\]/);
  assert.match(text, /Saved his ship/);
});

test('normaliseRuling guards bad referee data', () => {
  const w = newGame();
  const r = normaliseRuling(w, { possible: true, needsCheck: true, skill: 'Flying', difficulty: 99, duration: 'forever' });
  assert.equal(r.skill, null);
  assert.equal(r.difficulty, 30);
  assert.equal(r.duration, 'moment');
});

test('findPlace puts things somewhere sensible', () => {
  const w = newGame();
  const pid = w.playerId;
  const rifle = makeItem(w, { name: 'Rifle', size: 'large', tags: ['weapon', 'strap'] }, null, null);
  assert.deepEqual(findPlace(w, rifle, pid), { holder: pid, slot: 'back' });
  assert.ok(carriedWeight(w, pid) > 0);
});

test('clothing destroyed drops what was in its pockets', () => {
  const w = newGame();
  const trousers = Object.values(w.items).find((i) => i.name === 'Wool trousers');
  const picks = Object.values(w.items).find((i) => i.name === 'Lockpicks');
  const r = applyChanges(w, [{ op: 'use_up_item', itemId: trousers.id, reason: 'torn to rags' }]);
  assert.equal(r.applied.length, 1);
  assert.equal(picks.holder, w.currentPlaceId);
});
