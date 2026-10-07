import { h } from './ui/dom.js';
import { loadSettings, applyTextSize } from './settings.js';
import { requestPersistence } from './db.js';
import { openSettings } from './ui/settings-screen.js';
import { renderTestChat } from './ui/test-chat.js';

async function boot() {
  const app = document.getElementById('app');
  const s = await loadSettings();
  applyTextSize(s.textSize);
  requestPersistence();

  const screen = h('main.screen');
  const header = h('header.top',
    h('div.title', 'Living World'),
    h('nav.menu',
      h('button.icon-btn', { type: 'button', onclick: () => openSettings(), 'aria-label': 'Settings' }, '⚙')));
  app.replaceChildren(header, screen);
  await renderTestChat(screen);
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

boot().catch((err) => {
  document.getElementById('app').replaceChildren(
    h('div.problem', h('p', 'The game could not start: ' + (err && err.message ? err.message : err))));
  console.error(err);
});
