// Developer console: raw game state and the log of rejected AI changes.
// For tuning during the build.

import { h, overlay, toast } from './dom.js';
import { db } from '../db.js';
import { getRequestLog } from '../providers/index.js';

export function openConsole(ctx) {
  const w = ctx.world;
  let tab = 'requests';
  let lastError = null;
  let requests = [];
  getRequestLog().then((l) => { requests = l; if (tab === 'requests') render(); }).catch(() => {});
  db.get('kv', 'lastError').then((e) => { lastError = e || null; if (tab === 'error') render(); }).catch(() => {});
  const body = h('div');

  const copy = async (text) => {
    try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Could not copy'); }
  };

  function render() {
    const tabs = h('div.chips', [['requests', 'Requests'], ['rejected', `Rejected (${w.rejected.length})`], ['last', 'Last turn'], ['error', 'Last error'], ['state', 'State']].map(([id, label]) =>
      h('button.chip', { type: 'button', class: tab === id ? 'chip on' : 'chip', onclick: () => { tab = id; render(); } }, label)));
    let content;
    if (tab === 'rejected') {
      const rows = [...w.rejected].reverse().slice(0, 100);
      content = rows.length ? h('div.table-wrap', h('table.sheet',
        h('thead', h('tr', h('th', 'Turn'), h('th', 'Change'), h('th', 'Why rejected'))),
        h('tbody', rows.map((r) => h('tr',
          h('td.num', r.turn),
          h('td', h('small', h('code', JSON.stringify(r.change)))),
          h('td', r.reason))))))
        : h('p.hint', 'No rejected changes yet.');
    } else if (tab === 'requests') {
      // Newest first: what was asked, of whom, how long it took and how it ended.
      const rows = [...requests].reverse().slice(0, 60);
      const time = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
      content = rows.length ? h('div',
        h('p.hint', 'Newest first. Seconds is how long each request took; "stop" is why the model stopped; tokens are words-ish in and out.'),
        h('button', { type: 'button', onclick: () => copy(JSON.stringify(rows, null, 1)) }, 'Copy'),
        h('div.table-wrap', h('table.sheet.compact',
          h('thead', h('tr', h('th', 'Time'), h('th', 'For'), h('th', 'Model'), h('th.num', 'Secs'), h('th', 'Result'), h('th', 'Stop'), h('th.num', 'In/out'))),
          h('tbody', rows.map((r) => h('tr',
            h('td', h('small', time(r.at))),
            h('td', r.label),
            h('td', h('small', r.via === 'pc' ? 'PC' : String(r.model).replace(/^gemini-/, '').replace('flash-lite', 'Lite').replace(/-flash$/, ' Flash').replace(/-/g, ' '))),
            h('td.num', { class: r.seconds >= 20 ? 'num bad' : 'num' }, r.seconds),
            h('td', { class: r.result === 'ok' ? '' : 'bad' }, r.result + (r.status && r.status !== 200 ? ` (${r.status})` : '')),
            h('td', h('small', r.stop || '')),
            h('td.num', h('small', `${r.tokensIn ?? '?'}/${r.tokensOut ?? '?'}${r.thinking ? ` +${r.thinking} thinking` : ''}`))))))))
        : h('p.hint', 'No requests recorded yet.');
    } else if (tab === 'error') {
      const text = lastError ? JSON.stringify({ ...lastError, at: new Date(lastError.at).toISOString(), build: 29 }, null, 2) : '';
      content = lastError ? h('div', h('button', { type: 'button', onclick: () => copy(text) }, 'Copy'), h('pre.raw', text)) : h('p.hint', 'No errors recorded.');
    } else if (tab === 'last') {
      const text = JSON.stringify(w.debug || {}, null, 2);
      content = h('div', h('button', { type: 'button', onclick: () => copy(text) }, 'Copy'), h('pre.raw', text));
    } else {
      const { snapshots, log, ...rest } = w;
      const text = JSON.stringify({ ...rest, logEntries: log.length, snapshotCount: snapshots.length }, null, 2);
      content = h('div', h('button', { type: 'button', onclick: () => copy(text) }, 'Copy'), h('pre.raw', text));
    }
    body.replaceChildren(tabs, content);
  }
  render();
  overlay('Developer console', body);
}
