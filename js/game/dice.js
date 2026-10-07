// Dice. The code rolls; the AI never does.

import { COST_MARGIN, DIFFICULTY_MIN, DIFFICULTY_MAX, ATTRIBUTE_MIN, ATTRIBUTE_MAX, SKILL_MIN, SKILL_MAX } from './rules.js';

/** Random float in [0, 1) from the browser's secure generator when available. */
export function random() {
  if (globalThis.crypto && crypto.getRandomValues) {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0] / 2 ** 32;
  }
  return Math.random();
}

export function rollDie(sides, rng = random) {
  return 1 + Math.floor(rng() * sides);
}

/** Whole number between min and max inclusive. */
export function between(min, max, rng = random) {
  return min + Math.floor(rng() * (max - min + 1));
}

export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/**
 * A check: d20 + skill level + attribute modifier against a difficulty.
 * Natural 20 always succeeds, natural 1 always fails, and missing by
 * COST_MARGIN or less is a success at a cost.
 * Returns { die, skillLevel, attributeMod, total, difficulty, outcome, natural }.
 *   outcome: 'success' | 'success_at_cost' | 'failure'
 */
export function check({ skillLevel = 0, attributeMod = 0, difficulty }, rng = random) {
  const die = rollDie(20, rng);
  const lvl = clamp(Math.round(skillLevel) || 0, SKILL_MIN, SKILL_MAX);
  const mod = clamp(Math.round(attributeMod) || 0, ATTRIBUTE_MIN, ATTRIBUTE_MAX);
  const dc = clamp(Math.round(difficulty) || 10, DIFFICULTY_MIN, DIFFICULTY_MAX);
  const total = die + lvl + mod;
  let outcome;
  let natural = null;
  if (die === 20) { outcome = 'success'; natural = 20; }
  else if (die === 1) { outcome = 'failure'; natural = 1; }
  else if (total >= dc) outcome = 'success';
  else if (dc - total <= COST_MARGIN) outcome = 'success_at_cost';
  else outcome = 'failure';
  return { die, skillLevel: lvl, attributeMod: mod, total, difficulty: dc, outcome, natural };
}

export const OUTCOME_LABEL = {
  success: 'success',
  success_at_cost: 'success at a cost',
  failure: 'failure',
};
