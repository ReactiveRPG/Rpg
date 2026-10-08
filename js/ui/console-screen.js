// Developer console: raw game state and the log of rejected AI changes.
// For tuning during the build.

import { h, overlay, toast } from './dom.js';
import { db } from '../db.js';

export function openConsole(ctx) {
  const w = ctx.world;
  let tab = 'rejected';
  let blocks = null;
  db.get('kv', 'lastBlocks').then((b) => { blocks = b || null; if (tab === 'blocks') render(); });
  const body = h('div');

  const copy = async (text) => {
    try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Could not copy'); }
  };

  function render() {
    const tabs = h('div.chips', [['rejected', `Rejected (${w.rejected.length})`], ['blocks', 'Blocks'], ['last', 'Last turn'], ['state', 'State']].map(([id, label]) =>
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
    } else if (tab === 'blocks') {
      const LEVELS = ['normal', 'explicit moments brief', 'recent story left out', 'scene closed, details left out'];
      content = blocks ? h('div',
        h('p', `Last blocked turn: "${blocks.action}" — ${new Date(blocks.at).toLocaleString()}. ${blocks.ok ? `Got through at step ${blocks.toned}.` : 'Never got through.'}`),
        h('div.table-wrap', h('table.sheet',
          h('thead', h('tr', h('th', 'Step'), h('th', 'Blocked in'), h('th', 'Reason'))),
          h('tbody', blocks.attempts.map((a) => h('tr', h('td', `${a.level}: ${LEVELS[a.level] || ''}`), h('td', a.where === 'request' ? 'what was sent' : a.where === 'reply' ? 'Gemini\'s reply' : a.where), h('td', a.reason)))))),
        h('button', { type: 'button', onclick: () => copy(JSON.stringify(blocks, null, 2)) }, 'Copy'))
        : h('p.hint', 'No blocked turns recorded yet.');
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
