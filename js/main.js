import { h, toast } from './ui/dom.js';
import { loadSettings, saveSettings, applyTextSize } from './settings.js';
import { requestPersistence } from './db.js';
import { addSettingsSection } from './ui/settings-screen.js';
import { renderHome } from './ui/home.js';
import { renderPlay } from './ui/play.js';
import { currentWorldId, loadWorld, exportBackup, importBackup, downloadJson } from './game/saves.js';

const app = {
  root: null,
  world: null,
  home() {
    this.world = null;
    renderHome(this.root, this);
  },
  play(world) {
    if (!world) return this.home();
    this.world = world;
    const ctx = {
      get world() { return app.world; },
      setWorld: (w) => { app.world = w; },
      goHome: () => app.home(),
    };
    renderPlay(this.root, ctx);
  },
};

function gameSettings() {
  const sw = (key, label, hint) => {
    const box = h('input', { type: 'checkbox' });
    loadSettings().then((s) => { box.checked = !!s[key]; });
    box.addEventListener('change', () => saveSettings({ [key]: box.checked }));
    return [h('label.switch', label, box), hint ? h('p.hint', hint) : null];
  };
  return h('section',
    h('h3', 'Game'),
    sw('showDice', 'Show dice rolls', 'Shows each check, e.g. "Lockpicking: rolled 14 + 3 = 17 vs 15 — success".'),
    sw('undoEnabled', 'Undo button', 'Turn off for a no-takebacks game.'));
}

function backupSettings() {
  const file = h('input', { type: 'file', accept: 'application/json,.json', style: { display: 'none' } });
  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (!f) return;
    try {
      const n = await importBackup(JSON.parse(await f.text()));
      toast(`Restored ${n} world${n === 1 ? '' : 's'}`);
      if (!app.world) app.home();
    } catch (err) {
      toast(`Could not import: ${err.message}`, 5000);
    }
    file.value = '';
  });
  return h('section',
    h('h3', 'Backups'),
    h('p.hint', 'Saves live in this browser. Clearing the browser\'s site data deletes them, so export a backup now and then. Your key is never put in a backup.'),
    h('div.row',
      h('button', { type: 'button', onclick: async () => downloadJson(await exportBackup(), `living-world-backup-${new Date().toISOString().slice(0, 10)}.json`) }, 'Export backup'),
      h('button', { type: 'button', onclick: () => file.click() }, 'Import backup')),
    file);
}

async function boot() {
  app.root = document.getElementById('app');
  const s = await loadSettings();
  applyTextSize(s.textSize);
  requestPersistence();
  addSettingsSection(gameSettings);
  addSettingsSection(backupSettings);

  const id = await currentWorldId();
  const world = id ? await loadWorld(id).catch(() => null) : null;
  if (world && world.playerId) app.play(world);
  else app.home();
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

boot().catch((err) => {
  document.getElementById('app').replaceChildren(
    h('div.problem', h('p', 'The game could not start: ' + (err && err.message ? err.message : err))));
  console.error(err);
});
