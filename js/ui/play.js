// The Play screen: story log, action box, Undo, and a header with date,
// time, place and a one-line body status.

import { h, prose, toast, hiddenTimes, whenVisible, INTERRUPTED } from './dom.js';
import { loadSettings } from '../settings.js';
import { playTurn, summarise } from '../game/turn.js';
import { undoTurns, player, currentPlace } from '../game/state.js';
import { saveWorld, savePendingTurn, loadPendingTurn, clearPendingTurn } from '../game/saves.js';
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
  // What a turn in progress shows, kept so the log can be redrawn mid-turn.
  const inFlight = { action: null, roll: null, waiting: null };

  const header = h('div.play-head');
  const menu = h('nav.menu-row',
    h('button.chip', { type: 'button', onclick: () => openInventory(ctx, refresh) }, 'Inventory'),
    h('button.chip', { type: 'button', onclick: () => openPeople(ctx) }, 'People'),
    h('button.chip', { type: 'button', onclick: () => openPlace(ctx) }, 'Here'),
    h('button.chip', { type: 'button', onclick: () => (busy ? toast('Wait for this turn to finish first') : ctx.goHome()) }, 'Worlds'),
    h('button.chip', { type: 'button', onclick: () => openConsole(ctx) }, 'Console'),
    h('button.chip', { type: 'button', onclick: () => openSettings({ onClose: settingsClosed }), 'aria-label': 'Settings' }, '⚙ Settings'));
  const log = h('div.log');
  const input = h('textarea', { rows: 2, placeholder: 'What do you do?', enterkeyhint: 'send' });
  const sendBtn = h('button.primary', { type: 'button', onclick: () => submit() }, 'Send');
  const undoBtn = h('button', { type: 'button', onclick: () => startUndo() }, 'Undo');
  const bar = h('div.action-bar', undoBtn, input, sendBtn);
  undoBtn.style.display = settings.undoEnabled ? '' : 'none';

  // Settings changes apply to this screen without rebuilding it, so a turn in
  // progress carries on undisturbed.
  async function settingsClosed() {
    Object.assign(settings, await loadSettings());
    undoBtn.style.display = settings.undoEnabled ? '' : 'none';
    refresh();
  }

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
    if (e.kind === 'gm') {
      const note = e.via === 'pc-switched' ? 'Written on your home PC: Gemini declined this part.'
        : e.via === 'pc' ? 'Written on your home PC while this scene continues.' : null;
      return h('div.msg.gm', prose(e.text), note ? h('p.footnote', note) : null);
    }
    if (e.kind === 'roll') return settings.showDice ? h('div.msg.roll', e.text) : null;
    if (e.kind === 'system') return h('div.msg.system', e.text);
    return null;
  }

  function renderLog() {
    const w = ctx.world;
    const nodes = w.log.slice(-200).map(entryEl).filter(Boolean);
    if (w.log.length > 200) nodes.unshift(h('div.msg.system', 'Earlier story is kept in the save and the running summary.'));
    log.replaceChildren(...nodes, ...[inFlight.action, inFlight.roll, inFlight.waiting].filter(Boolean));
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
    inFlight.waiting?.remove();
    inFlight.waiting = on ? h('div.msg.waiting', text) : null;
    if (on) {
      log.append(inFlight.waiting);
      log.scrollTop = log.scrollHeight;
    } else {
      inFlight.action?.remove();
      inFlight.roll?.remove();
      inFlight.action = null;
      inFlight.roll = null;
    }
  }

  function showProblem(res, action, { rewrite = false } = {}) {
    const box = h('div.problem',
      h('p', res.error.message || 'Something went wrong.'),
      h('div.row',
        h('button', { type: 'button', onclick: () => { box.remove(); submit(action, { rewrite, resend: true }); } }, 'Resend'),
        h('button', { type: 'button', onclick: () => { box.remove(); pending = null; input.value = action; input.focus(); } }, 'Rephrase')));
    log.append(box);
    log.scrollTop = log.scrollHeight;
  }

  async function submit(text, { rewrite = false, resend = false, retries = 0 } = {}) {
    if (busy) return;
    const action = (text ?? input.value).trim();
    if (!action) return;
    if (!resend) pending = null;
    redo = null;
    input.value = '';
    log.querySelector('.undo-panel')?.remove();
    log.querySelectorAll('.problem').forEach((n) => n.remove());
    inFlight.action = h('div.msg.player', rewrite ? '✎ ' + action : action);
    log.append(inFlight.action);
    setBusy(true, rewrite ? 'The narrator is rewriting the scene…' : 'The referee is weighing it…');

    // Saved before sending, so a turn cut off by leaving the app can be picked up again.
    const w = ctx.world;
    const hiddenBefore = hiddenTimes();
    const note = (p) => savePendingTurn({ worldId: w.id, baseTurn: w.turn, action, rewrite, pending: p }).catch(() => {});
    await note(resend ? pending : null);

    const res = await playTurn(w, action, {
      rewrite,
      pending: resend ? pending : null,
      length: settings.replyLength,
      onStage: (stage, roll, info) => {
        if (stage === 'narrator') {
          if (info) { pending = info; note(info); }
          if (roll && settings.showDice && !inFlight.roll) {
            inFlight.roll = h('div.msg.roll', `${roll.skill || roll.attribute}: rolled ${roll.die}…`);
            inFlight.action?.after(inFlight.roll);
          }
          setBusy(true, 'The narrator is writing…');
        }
      },
    });

    if (!res.ok) {
      pending = res.pending || pending;
      // Cut off because the app was in the background: carry on once it is back.
      if (retries < 2 && hiddenTimes() > hiddenBefore && INTERRUPTED.includes(res.error.kind)) {
        setBusy(true, 'Picking up where you left off…');
        await whenVisible();
        setBusy(false);
        return submit(action, { rewrite, resend: true, retries: retries + 1 });
      }
      setBusy(false);
      await clearPendingTurn();
      showProblem(res, action, { rewrite });
      return;
    }
    setBusy(false);
    pending = null;
    await saveWorld(w);
    await clearPendingTurn();
    if (ctx.world === w) refresh();
    backgroundSummary();
  }

  /** After the app was closed mid-turn: finish that turn instead of losing it. */
  async function resumeIfNeeded() {
    const pt = await loadPendingTurn().catch(() => null);
    if (!pt || pt.worldId !== ctx.world.id) return;
    if (ctx.world.turn !== pt.baseTurn) { await clearPendingTurn(); return; }
    pending = pt.pending || null;
    toast('Resuming your last turn…');
    submit(pt.action, { rewrite: pt.rewrite, resend: true });
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
  resumeIfNeeded();
}
