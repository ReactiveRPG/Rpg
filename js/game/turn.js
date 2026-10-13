// One turn, in order:
//  1. the player types an action      5. narrator request
//  2. the code builds a scene packet  6. the code checks and applies changes
//  3. referee request (data only)     7. the clock advances
//  4. the code rolls the dice         8. snapshot for undo (the caller saves)

import { ask as defaultAsk } from '../providers/index.js';
import { buildPacket } from './packet.js';
import { refereeRequest, narratorRequest, clerkRequest, proseFrom, summaryRequest } from './ai.js';
import { applyChanges, applyPresent } from './changes.js';
import { check, clamp, OUTCOME_LABEL } from './dice.js';
import { durationSeconds, describeSpan } from './clock.js';
import { pushSnapshot, player } from './state.js';
import { skillTable, ATTRIBUTES, ACTION_KINDS, DURATIONS, DIFFICULTY_MIN, DIFFICULTY_MAX } from './rules.js';

const MAX_REJECTED_LOG = 300;
const MAX_RECENT = 40;
/** In Auto mode, how many turns stay on the home PC after Gemini declines one. */
export const PC_STICKY_TURNS = 6;

/** Cleans up the referee's answer so the code can trust its shape. */
export function normaliseRuling(world, data) {
  const table = skillTable(world);
  const d = data || {};
  const skill = d.skill && d.skill !== 'none' && table[d.skill] ? d.skill : null;
  const attribute = ATTRIBUTES.includes(d.attribute) ? d.attribute : (skill ? table[skill].attribute : 'wits');
  const reason = String(d.reason || '').trim().slice(0, 300);
  // "Not possible" must come with a reason; without one it is a model glitch,
  // and the action goes ahead as an ordinary attempt.
  const possible = d.possible !== false || !reason;
  return {
    possible,
    reason: possible ? '' : reason,
    needsCheck: !!d.needsCheck && possible,
    skill,
    attribute,
    difficulty: clamp(Math.round(Number(d.difficulty) || 10), DIFFICULTY_MIN, DIFFICULTY_MAX),
    duration: DURATIONS[d.duration] ? d.duration : 'moment',
    minutes: Math.max(0, Number(d.minutes) || 0),
    kind: ACTION_KINDS.includes(d.kind) ? d.kind : 'other',
    note: String(d.note || '').slice(0, 300),
  };
}

/** Rolls the check the referee asked for, if any. */
export function resolve(world, ruling, rng) {
  if (!ruling.possible || !ruling.needsCheck) return null;
  const p = player(world);
  const roll = check({
    skillLevel: ruling.skill ? p.skills[ruling.skill] || 0 : 0,
    attributeMod: p.attributes[ruling.attribute] || 0,
    difficulty: ruling.difficulty,
  }, rng);
  return { ...roll, skill: ruling.skill, attribute: ruling.attribute };
}

export function rollText(roll) {
  const what = roll.skill ? `${roll.skill}` : `${roll.attribute[0].toUpperCase()}${roll.attribute.slice(1)}`;
  const mods = [roll.skillLevel ? `+ ${roll.skillLevel} skill` : '', roll.attributeMod ? `${roll.attributeMod > 0 ? '+' : '−'} ${Math.abs(roll.attributeMod)} ${roll.attribute}` : ''].filter(Boolean).join(' ');
  const nat = roll.natural === 20 ? ' (natural 20)' : roll.natural === 1 ? ' (natural 1)' : '';
  return `${what}: rolled ${roll.die}${mods ? ' ' + mods : ''} = ${roll.total} vs ${roll.difficulty} — ${OUTCOME_LABEL[roll.outcome]}${nat}`;
}

function rulingText(ruling, roll, seconds) {
  const lines = ["THE CODE'S RULING (final):"];
  if (!ruling.possible) {
    lines.push(`NOT POSSIBLE: ${ruling.reason || 'the character cannot do this right now'}. Narrate the attempt running into that.`);
  } else if (roll) {
    lines.push(`Check: ${rollText(roll)}.`);
    if (roll.outcome === 'success') lines.push('The attempt SUCCEEDS.');
    else if (roll.outcome === 'success_at_cost') lines.push('The attempt SUCCEEDS AT A COST: it works, but something goes wrong, is lost, or is noticed.');
    else lines.push('The attempt FAILS. Show the failure and its natural consequence.');
  } else {
    lines.push('No check needed: the action happens as an ordinary attempt (other people still react as they choose).');
  }
  lines.push(`Time taken: about ${describeSpan(seconds)} (${ruling.duration}). Narrate only this span.`);
  if (ruling.note) lines.push(`Referee note: ${ruling.note}`);
  return lines.join('\n');
}

/**
 * Plays one turn. Mutates `world` only on success.
 *   pending: a ruling from an earlier attempt whose narration failed, so a
 *            resend uses the same dice instead of rolling again.
 *   rewrite: the action is canon text from the Rewrite box: no referee, no roll.
 * Resolves to { ok: true, ... } or { ok: false, error, pending }.
 */
export async function playTurn(world, action, { rewrite = false, pending = null, length = 'medium', ask = defaultAsk, rng, signal, onStage = () => {} } = {}) {
  let ruling;
  let roll;
  let seconds;
  let refereeRaw = null;
  let ref = null;
  // Auto mode: a scene Gemini declined stays on the home PC for a few turns.
  const preferPc = (world.pcUntilTurn || 0) > world.turn;

  if (rewrite) {
    ruling = { possible: true, needsCheck: false, duration: 'short', kind: 'other', note: '' };
  } else if (pending && pending.action === action) {
    ({ ruling, roll, seconds, refereeRaw } = pending);
  } else {
    onStage('referee');
    ref = await ask({ ...refereeRequest(world, buildPacket(world), action), preferPc, signal, onNote: (m) => onStage('status', null, m) });
    if (!ref.ok) return { ok: false, error: ref, stage: 'referee' };
    refereeRaw = ref.data;
    ruling = normaliseRuling(world, ref.data);
    roll = resolve(world, ruling, rng);
    seconds = durationSeconds(ruling.duration, ruling.minutes, rng);
  }

  const packet = buildPacket(world, { kind: ruling.kind });
  let actionText;
  let rulingBlock;
  if (rewrite) {
    actionText = `CANON — the player has rewritten what happens next. This text is true; there is no roll:\n"${action}"`;
    rulingBlock = 'Narrate this happening, exactly as written, consistent with every card. Propose the changes it implies. Also narrate only the time it takes.';
  } else {
    actionText = `PLAYER'S ACTION (an attempt, not a fact): "${action}"`;
    rulingBlock = rulingText(ruling, roll, seconds);
  }
  onStage('narrator', roll, rewrite ? null : { action, ruling, roll, seconds, refereeRaw });
  const nar = await ask({ ...narratorRequest(world, packet, actionText, rulingBlock, { length }), preferPc, signal, onNote: (m) => onStage('status', null, m) });
  if (!nar.ok) return { ok: false, error: nar, stage: 'narrator', pending: rewrite ? null : { action, ruling, roll, seconds, refereeRaw } };

  const prose = proseFrom(nar);
  if (!prose) {
    return { ok: false, stage: 'narrator', pending: rewrite ? null : { action, ruling, roll, seconds, refereeRaw },
      error: { ok: false, kind: 'empty', message: 'The game master sent back an empty scene. Nothing in your game changed. Resend, or rephrase it.' } };
  }

  // The record-keeper reads the new narration and lists what changed.
  onStage('clerk', roll);
  const clerk = await ask({ ...clerkRequest(world, packet, actionText, rulingBlock, prose), preferPc, signal, onNote: (m) => onStage('status', null, m) });
  if (!clerk.ok && clerk.kind === 'aborted') return { ok: false, error: clerk, stage: 'clerk', pending: rewrite ? null : { action, ruling, roll, seconds, refereeRaw } };

  // From here on the turn is accepted.
  pushSnapshot(world);
  world.turn += 1;
  const t = world.turn;
  world.log.push({ turn: t, kind: 'player', text: action, rewrite: rewrite || undefined });
  if (roll) world.log.push({ turn: t, kind: 'roll', text: rollText(roll), roll });
  else if (!ruling.possible) world.log.push({ turn: t, kind: 'roll', text: `Not possible: ${ruling.reason}` });

  const { applied, rejected, recordFailed } = keepRecord(world, clerk, { trusted: rewrite });
  for (const r of rejected) world.rejected.push({ turn: t, change: r.change, reason: r.reason });
  if (world.rejected.length > MAX_REJECTED_LOG) world.rejected.splice(0, world.rejected.length - MAX_REJECTED_LOG);

  const switched = nar.switched || (ref && ref.switched) || clerk.switched;
  if (switched) world.pcUntilTurn = t + PC_STICKY_TURNS;
  const via = nar.via === 'pc' && nar.rescued ? 'pc-rescued'
    : nar.auto && nar.via === 'pc' ? (nar.switched ? 'pc-switched' : 'pc') : undefined;
  world.log.push({ turn: t, kind: 'gm', text: prose, via });
  if (recordFailed) world.log.push({ turn: t, kind: 'system', text: `The record could not be updated this turn (${clerk.message || 'no reply'}). If money, items or people are now wrong, fix them in Inventory or Here, or Undo and resend.` });

  if (seconds === undefined) seconds = durationSeconds(ruling.duration, ruling.minutes, rng);
  world.clock += seconds;
  for (const id of world.present) if (world.people[id]) world.people[id].lastSeen = world.clock;

  world.recent.push({ turn: t, kind: ruling.kind, action, outcome: prose.replace(/\s+/g, ' ').slice(0, 300) });
  if (world.recent.length > MAX_RECENT) world.recent.splice(0, world.recent.length - MAX_RECENT);
  world.debug = { referee: refereeRaw, ruling, roll, narrator: prose, record: clerk.ok ? clerk.data : { failed: clerk.message }, applied, rejected, models: { narrator: nar.model, record: clerk.model } };
  world.updatedAt = Date.now();

  return { ok: true, ruling, roll, applied, rejected, seconds, recordFailed };
}

/**
 * Applies the record-keeper's answer: its changes, who is present, and positions.
 * A failed or unreadable answer leaves the facts as they were, flagged for the player.
 */
export function keepRecord(world, clerk, { trusted = false } = {}) {
  if (!clerk || !clerk.ok || !clerk.data || typeof clerk.data !== 'object') {
    return { applied: [], rejected: [], recordFailed: true };
  }
  const d = clerk.data;
  const changes = Array.isArray(d.changes) ? [...d.changes] : [];
  if (typeof d.scene_state === 'string' && d.scene_state.trim()) changes.push({ op: 'scene_state', text: d.scene_state });
  const { applied, rejected } = applyChanges(world, changes, { trusted });
  // Who is here comes last, after any moves and new people in this same reply.
  if (Array.isArray(d.present)) {
    const { dropped } = applyPresent(world, d.present);
    for (const x of dropped) rejected.push({ change: { op: 'present', ref: x.ref }, reason: x.reason });
  }
  return { applied, rejected, recordFailed: false };
}

/** The opening scene, after character creation. Not undoable (there is nothing before it). */
export async function playOpening(world, { ask = defaultAsk } = {}) {
  const packet = buildPacket(world);
  const action = 'OPENING SCENE: the game begins.';
  const ruling = 'Introduce the player character at the starting place and time: what they see, hear and smell, who is around, and the situation they are in. Bring in the ally or enemy only if they would plausibly be here. Do not act or speak for the character. End on the scene, not a question. Name anyone who matters.';
  const nar = await ask(narratorRequest(world, packet, action, ruling));
  if (!nar.ok) return { ok: false, error: nar };
  const prose = proseFrom(nar);
  if (!prose) return { ok: false, error: { kind: 'empty', message: 'The game master sent back an empty scene. Try again.' } };
  const clerk = await ask(clerkRequest(world, packet, action, ruling, prose));
  const { applied, rejected, recordFailed } = keepRecord(world, clerk);
  for (const r of rejected) world.rejected.push({ turn: 0, change: r.change, reason: r.reason });
  world.log.push({ turn: 0, kind: 'gm', text: prose });
  if (recordFailed) world.log.push({ turn: 0, kind: 'system', text: 'The record could not be updated for the opening scene; people in it may not be carded yet.' });
  world.debug = { narrator: prose, record: clerk.ok ? clerk.data : { failed: clerk.message }, applied, rejected };
  return { ok: true };
}

const SUMMARY_EVERY = 12;
const KEEP_RECENT = 6;

/**
 * Folds older turns into the running summary. Runs in the background after a
 * turn; returns a patch to apply, or null if nothing is due.
 */
export async function summarise(world, { ask = defaultAsk } = {}) {
  const upTo = world.turn - KEEP_RECENT;
  if (upTo - (world.summaryUpTo || 0) < SUMMARY_EVERY) return null;
  const entries = world.log.filter((e) => e.turn > (world.summaryUpTo || 0) && e.turn <= upTo && e.kind !== 'roll');
  if (!entries.length) return null;
  const text = entries.map((e) => (e.kind === 'player' ? `Player: ${e.text}` : e.text)).join('\n');
  const res = await ask(summaryRequest(world, world.summary, text));
  if (!res.ok) return null;
  return { summary: res.text.slice(0, 4000), summaryUpTo: upTo };
}
