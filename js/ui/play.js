// The Play screen: story log, action box, Undo, and a header with date,
// time, place and a one-line body status.

import { h, prose, toast } from './dom.js';
import { loadSettings } from '../settings.js';
import { db } from '../db.js';
import { playTurn, summarise } from '../game/turn.js';
import { undoTurns, player, currentPlace } from '../game/state.js';
import { saveWorld } from '../game/saves.js';
import { formatDate, formatTime, dateParts } from '../game/clock.js';
import { carriedWeight, weightLimits } from '../game/inventory.js';
import { money } from '../game/packet.js';
import { openInventory } from './inventory-screen.js';
import { openPeople } from './people-screen.js';
import { openPlace } from './place-screen.js';
import { openConsole } from './console-screen.js';
import { openSettings } from './settings-screen.js';

/**
 * ctx: { world, setWorld(world), goHome() }
 */
export async function renderPlay(root, ctx) {
  const settings = await loadSettings();
  let busy = false;
  let pending = null;      // dice kept from a failed narration
  let redo = null;         // the world before the last Undo, to put it back

  const header = h('div.play-head');
  const menu = h('nav.menu-row',
    h('button.chip', { type: 'button', onclick: () => openInventory(ctx, refresh) }, 'Inventory'),
    h('button.chip', { type: 'button', onclick: () => openPeople(ctx) }, 'People'),
    h('button.chip', { type: 'button', onclick: () => openPlace(ctx) }, 'Here'),
    h('button.chip', { type: 'button', onclick: () => ctx.goHome() }, 'Worlds'),
    h('button.chip', { type: 'button', onclick: () => openConsole(ctx) }, 'Console'),
    h('button.chip', { type: 'button', onclick: () => openSettings({ onClose: () => renderPlay(root, ctx) }), 'aria-label': 'Settings' }, '⚙ Settings'));
  const log = h('div.log');
  const input = h('textarea', { rows: 2, placeholder: 'What do you do?', enterkeyhint: 'send' });
  const sendBtn = h('button.primary', { type: 'button', onclick: () => submit() }, 'Send');
  const undoBtn = h('button', { type: 'button', onclick: () => startUndo() }, 'Undo');
  const bar = h('div.action-bar', settings.undoEnabled ? undoBtn : null, input, sendBtn);

  function renderHeader() {
    const w = ctx.world;
    const p = player(w);
    const d = dateParts(w);
    const place = currentPlace(w);
    const lim = weightLimits(w, p.id);
    const wt = carriedWeight(w, p.id);
    const load = wt > lim.hardCap ? 'cannot move' : wt > lim.limit ? 'overloaded' : `${wt.toFixed(1)}/${lim.limit.toFixed(0)} kg`;
    header.replaceChildren(
      h('div.when', h('strong', formatTime(d.hour, d.minute)), ' · ', formatDate(w)),
      h('div.where', place ? place.name : 'Somewhere'),
      h('div.status-line', `${p.fixed.name} · unhurt · ${load} · ${money(w, p.money)}`));
  }

  function entryEl(e) {
    if (e.kind === 'player') return h('div.msg.player', e.rewrite ? '✎ ' + e.text : e.text);
    if (e.kind === 'gm') return h('div.msg.gm', prose(e.text), e.toned ? h('p.hint', e.toned >= 3 ? 'Scene closed: Google\'s filter blocked every version of it.' : 'Toned down: Google\'s filter blocked the full version.') : null);
    if (e.kind === 'roll') return settings.showDice ? h('div.msg.roll', e.text) : null;
    if (e.kind === 'system') return h('div.msg.system', e.text);
    return null;
  }

  function renderLog() {
    const w = ctx.world;
    const nodes = w.log.slice(-200).map(entryEl).filter(Boolean);
    if (w.log.length > 200) nodes.unshift(h('div.msg.system', 'Earlier story is kept in the save and the running summary.'));
    log.replaceChildren(...nodes);
    log.scrollTop = log.scrollHeight;
  }

  function refresh() {
    renderHeader();
    renderLog();
  }

  function setBusy(on, text) {
    busy = on;
    sendBtn.disabled = on;
    undoBtn.disabled = on;
    log.querySelector('.msg.waiting')?.remove();
    if (on) {
      log.append(h('div.msg.waiting', text));
      log.scrollTop = log.scrollHeight;
    }
  }

  function showProblem(res, action, { rewrite = false } = {}) {
    const box = h('div.problem',
      h('p', res.error.message || 'Something went wrong.'),
      res.error.kind === 'blocked' ? h('p.hint', 'The game already tried twice. This filter is Google\'s own and cannot be switched off; it sometimes fires on ordinary scenes. "Resend toned down" keeps what happens but describes the most graphic moments briefly, for this one reply only.') : null,
      h('div.row',
        h('button', { type: 'button', onclick: () => { box.remove(); submit(action, { rewrite, resend: true }); } }, 'Resend'),
        res.error.kind === 'blocked' ? h('button', { type: 'button', onclick: () => { box.remove(); submit(action, { rewrite, resend: true, toneDown: true }); } }, 'Resend toned down') : null,
        h('button', { type: 'button', onclick: () => { box.remove(); pending = null; input.value = action; input.focus(); } }, 'Rephrase')));
    log.append(box);
    log.scrollTop = log.scrollHeight;
  }

  async function submit(text, { rewrite = false, resend = false, toneDown = false } = {}) {
    if (busy) return;
    const action = (text ?? input.value).trim();
    if (!action) return;
    if (!resend) pending = null;
    redo = null;
    input.value = '';
    log.querySelector('.undo-panel')?.remove();
    log.querySelectorAll('.problem').forEach((n) => n.remove());
    log.append(h('div.msg.player.pending-action', rewrite ? '✎ ' + action : action));
    setBusy(true, rewrite ? 'The narrator is rewriting the scene…' : 'The referee is weighing it…');

    const res = await playTurn(ctx.world, action, {
      rewrite,
      pending: resend ? pending : null,
      toneDown,
      autoToneDown: settings.autoToneDown,
      onStage: (stage, roll) => {
        if (stage === 'toning') setBusy(true, 'Blocked by Google\'s filter; retrying toned down…');
        if (stage === 'narrator') {
          if (roll && settings.showDice) log.querySelector('.pending-action')?.after(h('div.msg.roll.pending-roll', `${roll.skill || roll.attribute}: rolled ${roll.die}…`));
          setBusy(true, 'The narrator is writing…');
        }
      },
    });
    setBusy(false);
    log.querySelector('.pending-roll')?.remove();
    if (res.attempts && res.attempts.length) {
      db.put('kv', 'lastBlocks', { at: Date.now(), action, attempts: res.attempts, ok: res.ok, toned: res.toned }).catch(() => {});
    }
    if (!res.ok) {
      log.querySelector('.pending-action')?.remove();
      pending = res.pending || null;
      showProblem(res, action, { rewrite });
      return;
    }
    pending = null;
    await saveWorld(ctx.world);
    refresh();
    backgroundSummary();
  }

  async function backgroundSummary() {
    const w = ctx.world;
    const patch = await summarise(w);
    if (patch && ctx.world === w && w.turn >= patch.summaryUpTo) {
      Object.assign(w, patch);
      await saveWorld(w);
    }
  }

  async function startUndo() {
    if (busy) return;
    const back = undoTurns(ctx.world, 1);
    if (!back) { toast('Nothing to undo'); return; }
    redo = ctx.world;
    ctx.setWorld(back);
    await saveWorld(back);
    refresh();
    showUndoPanel();
  }

  function showUndoPanel() {
    const box = h('textarea', { rows: 2, placeholder: 'Empty: just remove it · "back 2": remove more · or type what should have happened instead' });
    const panel = h('div.notice.undo-panel',
      h('p', 'Turn removed. What next?'),
      box,
      h('div.row',
        h('button.primary', { type: 'button', onclick: () => finishUndo(box.value) }, 'Done'),
        h('button', { type: 'button', onclick: () => putBack() }, 'Put it back')));
    log.append(panel);
    log.scrollTop = log.scrollHeight;
    box.focus();
  }

  async function putBack() {
    if (!redo) return;
    ctx.setWorld(redo);
    redo = null;
    await saveWorld(ctx.world);
    refresh();
  }

  async function finishUndo(text) {
    const t = text.trim();
    log.querySelector('.undo-panel')?.remove();
    const m = t.match(/^(?:back|undo)?\s*(\d+)\s*(?:turns?)?$/i);
    if (!t) { redo = null; input.focus(); return; }
    if (m) {
      const more = Math.max(0, parseInt(m[1], 10) - 1);
      if (more > 0) {
        const back = undoTurns(ctx.world, more);
        if (back) { ctx.setWorld(back); await saveWorld(back); }
      }
      redo = null;
      refresh();
      toast(`${parseInt(m[1], 10)} turn${m[1] === '1' ? '' : 's'} removed`);
      return;
    }
    redo = null;
    submit(t, { rewrite: true });
  }

  root.replaceChildren(h('div.play', header, menu, log, bar));
  refresh();
  if (!ctx.world.log.length) log.append(h('div.msg.system', 'The story has not started yet.'));
}
