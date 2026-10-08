// Step 2 of a turn: the scene packet. Everything the AI needs to know is put
// in front of it every turn, so it never has to remember anything.

import { formatDateTime, dateParts, partOfDay } from './clock.js';
import { ageOf, player, currentPlace } from './state.js';
import { carriedItems, directlyHeld, slotLabel, hiddenLevel, SEARCH_LEVELS, carriedWeight, weightLimits } from './inventory.js';

const RECENT_TURNS = 6;
const HISTORY_LINES = 10;

export function money(world, amount) {
  const c = world.premise.currency || {};
  const n = Number(amount) || 0;
  const name = n === 1 ? (c.name || 'coin') : (c.plural || c.name || 'coins');
  return `${n} ${name}`;
}

function itemLine(world, it, withHiding = true) {
  const bits = [`[${it.id}] ${it.name}`];
  if (it.qty > 1) bits.push(`×${it.qty}`);
  bits.push(`(${it.size}, ${+(it.weight * it.qty).toFixed(2)} kg${it.tags.length ? ', ' + it.tags.join('/') : ''}${it.condition && it.condition !== 'good' ? ', ' + it.condition : ''})`);
  if (it.holder !== undefined) {
    const where = slotLabel(it.slot, world, it);
    if (where) bits.push(`— ${where}`);
  }
  if (withHiding && it.slot) bits.push(`[found by ${SEARCH_LEVELS[hiddenLevel(world, it)]}]`);
  return bits.join(' ');
}

export function personBlock(world, p, { full = true } = {}) {
  const lines = [];
  const age = ageOf(world, p);
  lines.push(`[${p.id}] ${p.fixed.name} — ${p.fixed.sex}, pronouns ${p.fixed.pronouns}, age ${age}${age >= 18 ? ' (adult)' : ''}${p.dead ? ', DEAD' : ''}`);
  if (p.fixed.looks) lines.push(`  Looks: ${p.fixed.looks}`);
  if (p.fixed.voice) lines.push(`  Voice and manner: ${p.fixed.voice}`);
  const life = Object.entries(p.life).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('; ');
  if (life) lines.push(`  ${life}`);
  if (!full) return lines.join('\n');
  if (!p.isPlayer) {
    const r = p.relationship;
    lines.push(`  Toward the player: trust ${r.trust}, fear ${r.fear}, attraction ${r.attraction}, respect ${r.respect} (−100 to 100)`);
    const hist = p.history.slice(-HISTORY_LINES);
    if (hist.length) lines.push('  Shared history with the player:', ...hist.map((h) => `   - ${h.date}: ${h.text}`));
    else lines.push('  Shared history with the player: none yet (they have not dealt with the player before)');
    const visible = carriedItems(world, p.id).filter((i) => hiddenLevel(world, i) === 0);
    if (visible.length) lines.push(`  Visibly carrying: ${visible.map((i) => `[${i.id}] ${i.name}${i.qty > 1 ? ' ×' + i.qty : ''}`).join(', ')}`);
  }
  if (p.dead && p.deathNote) lines.push(`  Died: ${p.deathNote}`);
  return lines.join('\n');
}

export function playerBlock(world) {
  const p = player(world);
  const lines = [personBlock(world, p)];
  if (p.background) lines.push(`  Background: ${p.background}`);
  lines.push(`  Money: ${money(world, p.money)}`);
  lines.push(`  Body: unhurt (detailed wounds come in a later version of the game)`);
  lines.push(`  Attributes (modifiers): ${Object.entries(p.attributes).map(([k, v]) => `${k} ${v >= 0 ? '+' : ''}${v}`).join(', ')}`);
  const skills = Object.entries(p.skills).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${v}`);
  lines.push(`  Skills (0–10; any skill not listed is 0): ${skills.join(', ') || 'none trained'}`);
  const items = carriedItems(world, p.id);
  lines.push('  Carrying (the character has nothing else):');
  if (items.length) lines.push(...items.map((i) => '   - ' + itemLine(world, i)));
  else lines.push('   - nothing');
  const w = carriedWeight(world, p.id);
  const lim = weightLimits(world, p.id);
  lines.push(`  Load: ${w.toFixed(1)} kg of ${lim.limit.toFixed(0)} kg comfortable limit`);
  return lines.join('\n');
}

export function placeBlock(world) {
  const pl = currentPlace(world);
  if (!pl) return 'PLACE: unknown';
  const lines = [`PLACE [${pl.id}] ${pl.name} — ${[pl.type, pl.region, pl.state].filter(Boolean).join(', ')}`];
  if (pl.description) lines.push(`  ${pl.description}`);
  if (pl.owner) lines.push(`  Owner: ${pl.owner}`);
  if (pl.usual) lines.push(`  Usually here: ${pl.usual}`);
  if (pl.connections.length) {
    lines.push(`  Known routes: ${pl.connections.map((c) => `[${c.placeId}] ${world.places[c.placeId]?.name} (${c.minutes} min)`).join('; ')}`);
  }
  const loose = directlyHeld(world, pl.id);
  if (loose.length) lines.push('  Items here (not carried by anyone):', ...loose.map((i) => '   - ' + itemLine(world, i, false)));
  return lines.join('\n');
}

export function premiseBlock(world) {
  const pr = world.premise;
  const lines = [`WORLD: ${pr.title}`];
  if (pr.setting) lines.push(`  ${pr.setting}`);
  const facts = [pr.era && `Era: ${pr.era}`, pr.technology && `Technology/magic: ${pr.technology}`, pr.medicine && `Medicine: ${pr.medicine}`, pr.law && `Law: ${pr.law}`].filter(Boolean);
  if (facts.length) lines.push('  ' + facts.join('. '));
  const c = pr.currency || {};
  if (c.name) lines.push(`  Currency: ${c.plural || c.name}${c.note ? ' (' + c.note + ')' : ''}`);
  if (pr.priceCatalogue && pr.priceCatalogue.length) {
    lines.push(`  Typical prices: ${pr.priceCatalogue.slice(0, 40).map((x) => `${x.name} ${x.value}`).join(', ')}`);
  }
  return lines.join('\n');
}

function recentTurns(world) {
  // Group the log into turns and keep the last few, trimmed.
  const out = [];
  const byTurn = new Map();
  for (const e of world.log) {
    if (!byTurn.has(e.turn)) byTurn.set(e.turn, []);
    byTurn.get(e.turn).push(e);
  }
  const turns = [...byTurn.keys()].sort((a, b) => a - b).slice(-RECENT_TURNS);
  for (const t of turns) {
    for (const e of byTurn.get(t)) {
      if (e.kind === 'player') out.push(`PLAYER: ${e.text}`);
      else if (e.kind === 'gm') out.push(`NARRATOR: ${trim(e.text, 900)}`);
      else if (e.kind === 'roll') out.push(`(${e.text})`);
    }
  }
  return out.join('\n');
}

function trim(text, n) {
  return text.length > n ? text.slice(0, n) + '…' : text;
}

/** What the last few actions of the same kind produced, so the narrator does not repeat them. */
export function similarBlock(world, kind) {
  const same = world.recent.filter((r) => r.kind === kind).slice(-3);
  if (!same.length) return '';
  return 'EARLIER ACTIONS OF THE SAME KIND (do not repeat these outcomes; the situation must change or resolve):\n' +
    same.map((r) => `- turn ${r.turn}: "${trim(r.action, 160)}" → ${trim(r.outcome, 260)}`).join('\n');
}

export function buildPacket(world, { kind, lean = false } = {}) {
  const p = dateParts(world);
  const parts = [
    `DATE AND TIME: ${formatDateTime(world)} (${partOfDay(p.hour)})`,
    premiseBlock(world),
    placeBlock(world),
    'THE PLAYER CHARACTER:\n' + playerBlock(world),
  ];
  const present = world.present.map((id) => world.people[id]).filter(Boolean);
  parts.push(present.length
    ? 'OTHERS PRESENT (carded people):\n' + present.map((x) => personBlock(world, x)).join('\n')
    : 'OTHERS PRESENT: no carded people. Unnamed crowd members may exist if the place would have them.');
  const absent = Object.values(world.people).filter((x) => !x.isPlayer && !world.present.includes(x.id));
  if (absent.length) {
    parts.push('OTHER CARDED PEOPLE (not here; use person_enters with their id if they arrive):\n' +
      absent.map((x) => `[${x.id}] ${x.fixed.name} — ${x.fixed.sex}, ${x.fixed.pronouns}${x.life.role ? ', ' + x.life.role : ''}${x.dead ? ', DEAD' : ''}`).join('\n'));
  }
  if (lean) {
    parts.push('LAST FEW TURNS: left out of this request because a content filter blocked it. Continue the scene from the cards above (their shared history says what has been agreed and done).');
    return parts.join('\n\n');
  }
  if (world.summary) parts.push('STORY SO FAR:\n' + world.summary);
  const recent = recentTurns(world);
  if (recent) parts.push('LAST FEW TURNS:\n' + recent);
  const similar = kind ? similarBlock(world, kind) : '';
  if (similar) parts.push(similar);
  return parts.join('\n\n');
}
