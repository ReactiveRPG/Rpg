// Player settings, stored only on this phone.

import { db } from './db.js';

export const DEFAULT_SETTINGS = {
  provider: 'gemini',          // narrator provider
  geminiKey: '',
  gmModel: 'gemini-3.5-flash-lite',  // referee and narrator, every turn
  worldModel: 'gemini-3.8-flash',    // world-building and summaries
  gmDailyLimit: 500,
  worldDailyLimit: 20,
  textSize: 'medium',
  undoEnabled: true,
  showDice: true,
  autoToneDown: true,
  replyLength: 'medium',
  pcUrl: '',          // home PC address, e.g. https://my-pc.tail1234.ts.net
  pcModel: '',        // model loaded in LM Studio
  pcKey: '',          // optional, only if the PC server asks for one
};

let cache = null;

export async function loadSettings() {
  if (!cache) {
    const saved = (await db.get('kv', 'settings')) || {};
    cache = { ...DEFAULT_SETTINGS, ...saved };
  }
  return cache;
}

export async function saveSettings(patch) {
  const current = await loadSettings();
  cache = { ...current, ...patch };
  await db.put('kv', 'settings', cache);
  applyTextSize(cache.textSize);
  return cache;
}

export function applyTextSize(size) {
  document.documentElement.dataset.textSize = size;
}
