// Provider layer. The rest of the game asks for "a game-master reply" or
// "a world-building reply" and never talks to a specific service directly,
// so a provider can be swapped in Settings without touching game code.

import { loadSettings } from '../settings.js';
import { recordRequest, usedToday } from '../usage.js';
import { createGeminiProvider } from './gemini.js';

let settingsRef = null;

const narrators = {
  gemini: createGeminiProvider({ getKey: () => (settingsRef ? settingsRef.geminiKey.trim() : '') }),
};

export const NARRATOR_PROVIDERS = Object.values(narrators).map((p) => ({ id: p.id, label: p.label }));

export async function getNarrator() {
  settingsRef = await loadSettings();
  return narrators[settingsRef.provider] || narrators.gemini;
}

/**
 * Ask the text provider for a reply.
 *   job: 'gm' (referee and narrator, every turn) or 'world' (world-building, summaries)
 * World jobs fall back to the game-master model once the bigger model's daily
 * allowance is spent, or when it reports its limit was hit.
 * Resolves to the provider result plus { model, fellBack }. Never throws.
 */
export async function ask({ job = 'gm', ...req }) {
  const narrator = await getNarrator();
  const s = settingsRef;
  let model = job === 'world' ? s.worldModel : s.gmModel;
  let fellBack = false;
  if (job === 'world' && (await usedToday(s.worldModel)) >= s.worldDailyLimit) {
    model = s.gmModel;
    fellBack = true;
  }
  let result = await narrator.generate({ ...req, model });
  if (result.status && result.status !== 429) await recordRequest(model);
  if (job === 'world' && !fellBack && result.kind === 'rate_limit') {
    model = s.gmModel;
    fellBack = true;
    result = await narrator.generate({ ...req, model });
    if (result.status && result.status !== 429) await recordRequest(model);
  }
  return { ...result, model, fellBack };
}
