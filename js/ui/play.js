// The Play screen: story log, action box, Undo, and a header with date,
// time, place and a one-line body status.

import { h, prose, toast, hiddenTimes, whenVisible, INTERRUPTED } from './dom.js';
import { loadSettings } from '../settings.js';
import { playTurn, summarise, redoRecord, editLastReply } from '../game/turn.js';
import { stripCodes } from '../game/ai.js';
import { undoTurns, player, currentPlace } from '../game/state.js';
import { saveWorld, loadWorld, savePendingTurn, loadPendingTurn, clearPendingTurn } from '../game/saves.js';
import { db } from '../db.js';
import { formatDate, formatTime, dateParts } from '../game/clock.js';
import { carriedWeight, weightLimits } from '../game/inventory.js';
import { money } from '../game/packet.js';
import { openInventory } from './inventory-screen.js';
import { openPeople } from './people-screen.js';
import { openPlace } from './place-screen.js';
import { openConsole } from './console-screen.js';
import { openDeals } from './deals-screen.js';
import { openSettings } from './settings-screen.js';

/**
 * ctx: { world, setWorld(world), goHome() }
 */
export async function renderPlay(root, ctx) {
  const settings = await loadSettings();
  let busy = false;
  let pending = null;      // dice kept from a failed narration
  // What a turn in progress shows, kept so the log can be redrawn mid-turn.
  const inFlight = { action: null, roll: null, waiting: null, clock: null };

  const header = h('div.play-head');
  const menu = h('nav.menu-row',
    h('button.chip', { type: 'button', onclick: () => openInventory(ctx, refresh) }, 'Inventory'),
    h('button.chip', { type: 'button', onclick: () => openPeople(ctx) }, 'People'),
    h('button.chip', { type: 'button', onclick: () => openPlace(ctx, refresh) }, 'Here'),
    h('button.chip', { type: 'button', onclick: () => openDeals(ctx, refresh) }, 'Deals'),
    h('button.chip', { type: 'button', onclick: () => (busy ? toast('Wait for this turn to finish first') : ctx.goHome()) }, 'Worlds'),
    h('button.chip', { type: 'button', onclick: () => openConsole(ctx) }, 'Console'),
    h('button.chip', { type: 'button', onclick: () => openSettings({ onClose: settingsClosed }), 'aria-label': 'Settings' }, '⚙ Settings'));
  const log = h('div.log');
  const input = h('textarea', { rows: 2, placeholder: 'What do you do?', enterkeyhint: 'send' });
  const sendBtn = h('button.primary', { type: 'button', onclick: () => (busy ? cancelTurn() : submit()) }, 'Send');
  let cancelCtrl = null;   // stops the request in flight
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
        : e.via === 'pc' ? 'Written on your home PC while this scene continues.'
        : e.via === 'pc-rescued' ? 'Written on your home PC: Gemini was busy.' : null;
      return h('div.msg.gm', prose(stripCodes(e.text)), note ? h('p.footnote', note) : null, e.edited ? h('p.footnote', 'Edited by you.') : null);
    }
    if (e.kind === 'roll') return settings.showDice ? h('div.msg.roll', e.text) : null;
    if (e.kind === 'system') {
      // A record that failed on the newest turn can be asked for again.
      const canRedo = e.recordRetry && e.turn === ctx.world.turn;
      return h('div.msg.system', e.text, canRedo
        ? h('div', { style: { marginTop: '0.4em' } }, h('button.small', { type: 'button', onclick: (ev) => updateRecord(e, ev.currentTarget) }, 'Update the record'))
        : null);
    }
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
    // While waiting, Send becomes Cancel.
    sendBtn.textContent = on ? 'Cancel' : 'Send';
    sendBtn.classList.toggle('primary', !on);
    undoBtn.disabled = on;
    inFlight.waiting?.remove();
    clearInterval(inFlight.clock);
    inFlight.waiting = on ? h('div.msg.waiting', text) : null;
    if (on) {
      // After a while, count the seconds so a slow reply is not mistaken for a stuck one.
      const started = Date.now();
      const el = inFlight.waiting;
      inFlight.clock = setInterval(() => {
        const s = Math.round((Date.now() - started) / 1000);
        if (s >= 10) el.textContent = `${text} ${s}s`;
      }, 1000);
    }
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

  function showProblem(res, action, { rewrite = false, restoreOnFail = null } = {}) {
    const box = h('div.problem',
      h('p', res.error.message || 'Something went wrong.'),
      h('div.row',
        h('button', { type: 'button', onclick: () => { box.remove(); submit(action, { rewrite, resend: true, restoreOnFail }); } }, 'Resend'),
        h('button', { type: 'button', onclick: () => { box.remove(); pending = null; input.value = action; input.focus(); } }, 'Rephrase'),
        restoreOnFail ? h('button', { type: 'button', onclick: async () => {
          box.remove();
          ctx.setWorld(restoreOnFail);
          await saveWorld(restoreOnFail);
          refresh();
          toast('The original turn is back');
        } }, 'Keep the original') : null));
    log.append(box);
    log.scrollTop = log.scrollHeight;
  }

  async function submit(text, { rewrite = false, resend = false, retries = 0, restoreOnFail = null } = {}) {
    if (busy) return;
    const action = (text ?? input.value).trim();
    if (!action) return;
    if (!resend) pending = null;
    input.value = '';
    log.querySelector('.undo-panel')?.remove();
    log.querySelectorAll('.problem').forEach((n) => n.remove());
    inFlight.action = h('div.msg.player', rewrite ? '✎ ' + action : action);
    log.append(inFlight.action);
    setBusy(true, rewrite ? 'The narrator is rewriting the scene…' : 'The referee is weighing it…');

    // Saved before sending, so a turn cut off by leaving the app can be picked up again.
    const w = ctx.world;
    const ctrl = new AbortController();
    cancelCtrl = ctrl;
    const hiddenBefore = hiddenTimes();
    let hiddenAtRecord = hiddenBefore;
    const note = (p) => savePendingTurn({ worldId: w.id, baseTurn: w.turn, action, rewrite, pending: p }).catch(() => {});
    await note(resend ? pending : null);

    let res;
    try {
      res = await playTurn(w, action, {
        rewrite,
        pending: resend ? pending : null,
        length: settings.replyLength,
        signal: ctrl.signal,
        // The record step was cut off by leaving the app: wait until it is back, then ask again.
        retryRecord: async (r) => {
          if (hiddenTimes() === hiddenAtRecord && !document.hidden) return false;
          if (!INTERRUPTED.includes(r.kind)) return false;
          setBusy(true, 'Picking up the record where you left off…');
          await whenVisible();
          return !ctrl.signal.aborted;
        },
        onStage: (stage, roll, info) => {
          if (stage === 'narrator') {
            if (info) { pending = info; note(info); }
            if (roll && settings.showDice && !inFlight.roll) {
              inFlight.roll = h('div.msg.roll', `${roll.skill || roll.attribute}: rolled ${roll.die}…`);
              inFlight.action?.after(inFlight.roll);
            }
            setBusy(true, 'The narrator is writing…');
          }
          if (stage === 'clerk') { hiddenAtRecord = hiddenTimes(); setBusy(true, 'Updating the record…'); }
          if (stage === 'status') setBusy(true, info);
        },
      });
    } catch (err) {
      // A fault in the game's own code must never leave the screen stuck. Put the
      // world back to its last save, keep the details for the Console, and say so.
      console.error(err);
      await db.put('kv', 'lastError', { at: Date.now(), action, message: String(err && err.message || err), stack: String(err && err.stack || '') }).catch(() => {});
      const saved = await loadWorld(w.id).catch(() => null);
      if (saved && ctx.world === w) ctx.setWorld(saved);
      res = { ok: false, error: { kind: 'crash', message: `The game hit an error of its own: "${err && err.message}". Nothing from this turn was kept. Please tap Console → Last error → Copy and send it to Claude.` } };
    }

    cancelCtrl = null;
    if (!res.ok && ctrl.signal.aborted) {
      // Cancelled by the player: nothing happened; the action goes back in the box.
      setBusy(false);
      await clearPendingTurn();
      if (restoreOnFail) {
        // A rewrite from Undo was cancelled: the original turn comes back.
        ctx.setWorld(restoreOnFail);
        await saveWorld(restoreOnFail);
        refresh();
      } else {
        input.value = action;
      }
      toast('Cancelled. Nothing in your game changed.');
      return;
    }
    if (!res.ok) {
      pending = res.pending || pending;
      // Cut off because the app was in the background: carry on once it is back.
      if (retries < 2 && hiddenTimes() > hiddenBefore && INTERRUPTED.includes(res.error.kind)) {
        setBusy(true, 'Picking up where you left off…');
        await whenVisible();
        setBusy(false);
        return submit(action, { rewrite, resend: true, retries: retries + 1, restoreOnFail });
      }
      setBusy(false);
      await clearPendingTurn();
      if (res.error.kind === 'crash') refresh();
      showProblem(res, action, { rewrite, restoreOnFail });
      return;
    }
    setBusy(false);
    pending = null;
    await saveWorld(w);
    await clearPendingTurn();
    if (ctx.world === w) refresh();
    backgroundSummary();
  }

  async function updateRecord(entry, btn) {
    if (busy) { toast('Wait for this turn to finish first'); return; }
    const w = ctx.world;
    btn.disabled = true;
    const ctrl = new AbortController();
    cancelCtrl = ctrl;
    setBusy(true, 'Updating the record…');
    let res;
    try {
      res = await redoRecord(w, entry, { signal: ctrl.signal });
    } catch (err) {
      console.error(err);
      res = { ok: false, error: { kind: 'crash', message: String(err && err.message || err) } };
    }
    cancelCtrl = null;
    setBusy(false);
    if (!res.ok) {
      btn.disabled = false;
      toast(ctrl.signal.aborted ? 'Cancelled.' : `Could not update the record: ${res.error.message || res.error.kind}`, 5000);
      return;
    }
    await saveWorld(w);
    if (ctx.world === w) refresh();
    toast(`Record updated${res.applied.length ? ` (${res.applied.length} change${res.applied.length === 1 ? '' : 's'})` : ''}`);
  }

  function cancelTurn() {
    if (cancelCtrl) cancelCtrl.abort();
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

  // ----- Undo: nothing is removed until the player picks what to do -----
  function startUndo() {
    if (busy) return;
    const w = ctx.world;
    if (!w.turn || !(w.snapshots || []).length) { toast('Nothing to undo'); return; }
    log.querySelector('.undo-panel')?.remove();
    log.querySelectorAll('.problem').forEach((n) => n.remove());
    const panel = h('div.notice.undo-panel');
    const close = () => panel.remove();
    const back = h('button', { type: 'button', onclick: () => menu() }, 'Back');
    const show = (...nodes) => { panel.replaceChildren(...nodes); log.scrollTop = log.scrollHeight; };

    function menu() {
      show(h('p', 'Change the last turn:'),
        h('div.undo-choices',
          h('button', { type: 'button', onclick: editReply }, 'Edit the reply'),
          h('button', { type: 'button', onclick: rewrite }, 'Rewrite what happens'),
          h('button', { type: 'button', onclick: takeBack }, 'Take back the turn'),
          h('button', { type: 'button', onclick: close }, 'Cancel')));
    }

    function editReply() {
      const gm = [...ctx.world.log].reverse().find((e) => e.turn === ctx.world.turn && e.kind === 'gm');
      if (!gm) { toast('There is no story reply to edit'); return; }
      const box = h('textarea', { rows: 10 });
      box.value = stripCodes(gm.text);
      const tick = h('input', { type: 'checkbox', checked: true });
      const save = h('button.primary', { type: 'button', onclick: async () => {
        const text = box.value.trim();
        if (!text) { toast('The reply cannot be empty'); return; }
        if (text === stripCodes(gm.text)) { close(); return; }
        save.disabled = true;
        const w = ctx.world;
        const ctrl = new AbortController();
        if (tick.checked) { cancelCtrl = ctrl; setBusy(true, 'Updating the record…'); }
        let res;
        try {
          res = await editLastReply(w, text, { updateRecord: tick.checked, signal: ctrl.signal });
        } catch (err) {
          console.error(err);
          res = { ok: false, error: { kind: 'crash', message: String(err && err.message || err) } };
        }
        if (tick.checked) { cancelCtrl = null; setBusy(false); }
        save.disabled = false;
        if (!res.ok) {
          toast(ctrl.signal.aborted ? 'Cancelled. Nothing changed.' : `Could not save: ${res.error.message || res.error.kind}`, 6000);
          return;
        }
        if (ctx.world === w) ctx.setWorld(res.world);
        await saveWorld(res.world);
        refresh();
        toast(tick.checked ? 'Reply edited and the record updated' : 'Reply edited');
      } }, 'Save');
      const handFixes = ctx.world.log.some((e) => e.turn === ctx.world.turn && e.kind === 'system' && !e.recordRetry);
      show(h('p', 'Edit the last reply:'), box,
        h('label.switch', 'Update the record too', tick),
        h('p.hint', 'Re-reads your edited version so money, items and people match it. Untick for wording-only fixes.'),
        handFixes ? h('p.hint', 'Fixes you made by hand since this turn (in Inventory, Here or Deals) are undone when the record is updated; redo them afterwards if still needed.') : null,
        h('div.row', save, back));
      box.focus();
    }

    function rewrite() {
      const box = h('textarea', { rows: 3, placeholder: 'What should have happened instead?' });
      show(h('p', 'The narrator rewrites the last turn from what you type. It happens exactly as written, with no dice roll.'), box,
        h('div.row',
          h('button.primary', { type: 'button', onclick: async () => {
            const text = box.value.trim();
            if (!text) { toast('Type what should have happened'); return; }
            const original = ctx.world;
            const before = undoTurns(original, 1);
            if (!before) { toast('Nothing to undo'); return; }
            close();
            ctx.setWorld(before);
            await saveWorld(before);
            refresh();
            submit(text, { rewrite: true, restoreOnFail: original });
          } }, 'Send'),
          back));
      box.focus();
    }

    function takeBack() {
      const max = (ctx.world.snapshots || []).length;
      const count = h('input', { type: 'number', min: 1, max, value: 1, inputmode: 'numeric', style: { width: '5em' } });
      show(h('p', 'Remove the last turn completely. Your action goes back in the box so you can change it and resend.'),
        h('label', `How many turns to take back (up to ${max})`, count),
        h('div.row',
          h('button.primary', { type: 'button', onclick: async () => {
            const w = ctx.world;
            const n = Math.min(max, Math.max(1, parseInt(count.value, 10) || 1));
            const before = undoTurns(w, n);
            if (!before) { toast('Nothing to undo'); return; }
            const first = w.log.find((e) => e.turn === before.turn + 1 && e.kind === 'player');
            close();
            ctx.setWorld(before);
            await saveWorld(before);
            pending = null;
            refresh();
            if (first) { input.value = first.text; input.focus(); }
            toast(`${n} turn${n === 1 ? '' : 's'} taken back`);
          } }, 'Take back'),
          back));
    }

    menu();
    log.append(panel);
    log.scrollTop = log.scrollHeight;
  }

  root.replaceChildren(h('div.play', header, menu, log, bar));
  refresh();
  if (!ctx.world.log.length) log.append(h('div.msg.system', 'The story has not started yet.'));
  resumeIfNeeded();
}
