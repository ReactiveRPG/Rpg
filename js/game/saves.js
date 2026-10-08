// Saves: one slot per world, kept in the phone's browser storage. Export
// writes a backup file; Import restores one.

import { db } from '../db.js';
import { migrate, SAVE_VERSION } from './state.js';
import { loadSettings, saveSettings } from '../settings.js';

export async function saveWorld(world) {
  world.updatedAt = Date.now();
  await db.put('worlds', world.id, world);
  await db.put('kv', 'currentWorld', world.id);
}

export async function loadWorld(id) {
  const w = await db.get('worlds', id);
  return w ? migrate(w) : null;
}

export async function currentWorldId() {
  return db.get('kv', 'currentWorld');
}

export async function listWorlds() {
  const all = await db.all('worlds');
  return all
    .map((w) => ({ id: w.id, name: w.name, updatedAt: w.updatedAt, turn: w.turn, player: w.people?.[w.playerId]?.fixed?.name || '' }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteWorld(id) {
  await db.delete('worlds', id);
  if ((await currentWorldId()) === id) await db.delete('kv', 'currentWorld');
}

// ----- Work in progress, so leaving the app does not lose it -----

/** A turn that was sent but has not finished: { worldId, baseTurn, action, rewrite, pending }. */
export const savePendingTurn = (p) => db.put('kv', 'pendingTurn', p);
export const loadPendingTurn = () => db.get('kv', 'pendingTurn');
export const clearPendingTurn = () => db.delete('kv', 'pendingTurn');

/** A new game being created: { stage, description, world?, choices? }. */
export const saveDraft = (d) => db.put('kv', 'newGameDraft', { ...d, at: Date.now() });
export const loadDraft = () => db.get('kv', 'newGameDraft');
export const clearDraft = () => db.delete('kv', 'newGameDraft');

/** Everything as one backup object. The API key is left out on purpose. */
export async function exportBackup() {
  const worlds = await db.all('worlds');
  const { geminiKey, ...settings } = await loadSettings();
  void geminiKey;
  return { app: 'living-world', saveVersion: SAVE_VERSION, exportedAt: new Date().toISOString(), settings, worlds };
}

export function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Restores a backup. Worlds with the same id are replaced. Returns how many were restored. */
export async function importBackup(obj) {
  if (!obj || obj.app !== 'living-world' || !Array.isArray(obj.worlds)) throw new Error('This is not a Living World backup file.');
  let n = 0;
  for (const w of obj.worlds) {
    migrate(w);
    await db.put('worlds', w.id, w);
    n++;
  }
  if (obj.settings) {
    const { geminiKey, ...rest } = obj.settings;
    void geminiKey;
    await saveSettings(rest);
  }
  return n;
}
