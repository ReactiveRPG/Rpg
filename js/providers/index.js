// Provider layer. The rest of the game asks for "a game-master reply" or
// "a world-building reply" and never talks to a specific service directly,
// so a provider can be swapped in Settings without touching game code.

import { loadSettings } from '../settings.js';
import { recordRequest, usedToday } from '../usage.js';
import { createGeminiProvider, compactSchema } from './gemini.js';
import { createOpenAICompatProvider } from './openai-compat.js';

let settingsRef = null;

const narrators = {
  gemini: createGeminiProvider({ getKey: () => (settingsRef ? settingsRef.geminiKey.trim() : '') }),
  pc: createOpenAICompatProvider({
    getBase: () => (settingsRef ? settingsRef.pcUrl : ''),
    getKey: () => (settingsRef ? (settingsRef.pcKey || '').trim() : ''),
  }),
};

export const NARRATOR_PROVIDERS = Object.values(narrators).map((p) => ({ id: p.id, label: p.label }));

/** The chosen text provider, or a specific one by id. */
export async function getNarrator(id) {
  settingsRef = await loadSettings();
  return narrators[id || settingsRef.provider] || narrators.gemini;
}

const RETRY_DELAYS_MS = [2000, 5000];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Busy or broken servers (5xx) and dropped connections are worth a quiet retry. */
const transient = (r) => r.kind === 'server' || r.kind === 'network';

/**
 * Ask the text provider for a reply.
 *   job: 'gm' (referee and narrator, every turn) or 'world' (world-building, summaries)
 * Busy-server errors are retried quietly a couple of times. World jobs fall
 * back to the game-master model once the bigger model's daily allowance is
 * spent, or when it stays busy or reports its limit was hit.
 * Resolves to the provider result plus { model, fellBack }. Never throws.
 */
export async function ask({ job = 'gm', ...req }) {
  const narrator = await getNarrator();
  const s = settingsRef;
  const onPc = narrator.id === 'pc';
  // The home PC runs one model for every job and has no daily allowance.
  let model = onPc ? (s.pcModel || '') : job === 'world' ? s.worldModel : s.gmModel;
  let fellBack = false;
  if (!onPc && job === 'world' && (await usedToday(s.worldModel)) >= s.worldDailyLimit) {
    model = s.gmModel;
    fellBack = true;
  }

  const attempt = async (m) => {
    let r = await narrator.generate({ ...req, model: m });
    if (r.status && r.status !== 429) await recordRequest(m);
    for (const [i, delay] of RETRY_DELAYS_MS.entries()) {
      // An unreachable PC will not answer a few seconds later either.
      if (!transient(r) || (onPc && r.kind === 'network')) break;
      await sleep(delay);
      // The last retry asks for plain JSON with the shape described in words,
      // in case the strict answer format is what the server is choking on.
      const last = i === RETRY_DELAYS_MS.length - 1;
      const loose = last && req.json && req.json !== true
        ? { ...req, json: true, system: `${req.system || ''}\n\nReply with JSON only, shaped like this schema:\n${JSON.stringify(compactSchema(req.json))}` }
        : req;
      r = await narrator.generate({ ...loose, model: m });
      if (r.status && r.status !== 429) await recordRequest(m);
    }
    return r;
  };

  let result = await attempt(model);
  if (result.kind === 'blocked') {
    result = await narrator.generate({ ...req, model });
    if (result.status && result.status !== 429) await recordRequest(model);
  }
  if (!onPc && job === 'world' && !fellBack && (result.kind === 'rate_limit' || transient(result))) {
    model = s.gmModel;
    fellBack = true;
    result = await attempt(model);
  }
  return { ...result, model, fellBack };
}
