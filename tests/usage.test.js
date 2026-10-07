import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bump, countFor, pacificDate } from '../js/usage.js';

test('counts per model per Pacific day', () => {
  const t1 = new Date('2026-10-07T20:00:00Z'); // Oct 7, 1pm Pacific
  let u = bump(null, 'lite', t1);
  u = bump(u, 'lite', t1);
  u = bump(u, 'flash', t1);
  assert.equal(countFor(u, 'lite', t1), 2);
  assert.equal(countFor(u, 'flash', t1), 1);
});

test('resets at midnight Pacific, not UTC', () => {
  const lateUtc = new Date('2026-10-08T02:00:00Z'); // still Oct 7 in Pacific
  const u = bump(null, 'lite', new Date('2026-10-07T20:00:00Z'));
  assert.equal(pacificDate(lateUtc), '2026-10-07');
  assert.equal(countFor(u, 'lite', lateUtc), 1);
  const nextDay = new Date('2026-10-08T08:00:00Z'); // Oct 8, 1am Pacific
  assert.equal(countFor(u, 'lite', nextDay), 0);
  assert.equal(countFor(bump(u, 'lite', nextDay), 'lite', nextDay), 1);
});
