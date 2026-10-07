// Home: the list of worlds (one save slot each), and the way into a new game.

import { h } from './dom.js';
import { loadSettings } from '../settings.js';
import { listWorlds, loadWorld, deleteWorld } from '../game/saves.js';
import { openSettings } from './settings-screen.js';
import { renderNewGame } from './new-game.js';

export async function renderHome(root, app) {
  const s = await loadSettings();
  const worlds = await listWorlds();
  const when = (t) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

  const content = h('div.page',
    h('h1.big-title', 'Living World'),
    !s.geminiKey ? h('div.notice',
      h('p', 'Welcome. To play, the game needs a Gemini key.'),
      h('button.primary', { type: 'button', onclick: () => openSettings({ onClose: () => renderHome(root, app) }) }, 'Open Settings')) : null,
    h('button.primary.wide', { type: 'button', disabled: !s.geminiKey, onclick: () => renderNewGame(root, app) }, 'New world'),
    worlds.length ? h('h3.sub', 'Your worlds') : null,
    worlds.map((w) => h('div.world-row',
      h('button.list-btn', { type: 'button', onclick: async () => app.play(await loadWorld(w.id)) },
        w.name, h('small', `${w.player || 'No character yet'} · turn ${w.turn} · ${when(w.updatedAt)}`)),
      h('button.small.danger', { type: 'button', onclick: async () => {
        if (confirm(`Delete "${w.name}" for good? This cannot be undone. (Export a backup in Settings first if unsure.)`)) {
          await deleteWorld(w.id);
          renderHome(root, app);
        }
      } }, 'Delete'))),
    h('p.hint.center', h('button.small', { type: 'button', onclick: () => openSettings({ onClose: () => renderHome(root, app) }) }, '⚙ Settings')));
  root.replaceChildren(content);
}
