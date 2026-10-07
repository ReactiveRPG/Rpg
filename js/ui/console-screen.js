// Developer console: raw game state and the log of rejected AI changes.
// For tuning during the build.

import { h, overlay, toast } from './dom.js';

export function openConsole(ctx) {
  const w = ctx.world;
  let tab = 'rejected';
  const body = h('div');

  const copy = async (text) => {
    try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Could not copy'); }
  };

  function render() {
    const tabs = h('div.chips', [['rejected', `Rejected (${w.rejected.length})`], ['last', 'Last turn'], ['state', 'State']].map(([id, label]) =>
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
