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

export const NARRATOR_PROVIDERS = [...Object.values(narrators).map((p) => ({ id: p.id, label: p.label })), { id: 'auto', label: 'Auto' }];

/** The chosen text provider, or a specific one by id. */
export async function getNarrator(id) {
  settingsRef = await loadSettings();
  return narrators[id || settingsRef.provider] || narrators.gemini;
}

const RETRY_DELAYS_MS = [2000, 5000];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Busy or broken servers (5xx), dropped connections and stalls are worth a quiet retry. */
const transient = (r) => r.kind === 'server' || r.kind === 'network' || r.kind === 'timeout';
/** The home PC is off, asleep, or LM Studio's server is not answering: retrying will not help. */
const pcDown = (r) => r.kind === 'network' || r.kind === 'timeout' || r.status === 502 || r.status === 504;
const cancelled = () => ({ ok: false, kind: 'aborted', message: 'Request cancelled.' });

/**
 * One request to one provider: retries busy servers, and for Gemini handles
 * the world model's daily allowance and fallback to the game-master model.
 */
async function askProvider(narrator, s, { job = 'gm', ...req }) {
  const onPc = narrator.id === 'pc';
  // The home PC runs one model for every job and has no daily allowance.
  let model = onPc ? (s.pcModel || '') : job === 'world' ? s.worldModel : s.gmModel;
  let fellBack = false;
  if (!onPc && job === 'world' && (await usedToday(s.worldModel)) >= s.worldDailyLimit) {
    model = s.gmModel;
    fellBack = true;
  }

  // World-building replies are long; give Gemini a little more time for them.
  const timeoutMs = req.timeoutMs || (onPc ? undefined : job === 'world' ? 120000 : 75000);
  const attempt = async (m) => {
    let r = await narrator.generate({ ...req, timeoutMs, model: m });
    if (r.status && r.status !== 429) await recordRequest(m);
    for (const [i, delay] of RETRY_DELAYS_MS.entries()) {
      // A PC that is off or not serving will not answer a few seconds later either.
      if (!transient(r) || (onPc && pcDown(r))) break;
      await sleep(delay);
      if (req.signal?.aborted) return cancelled();
      // The last retry asks for plain JSON with the shape described in words,
      // in case the strict answer format is what the server is choking on.
      const last = i === RETRY_DELAYS_MS.length - 1;
      const loose = last && req.json && req.json !== true
        ? { ...req, json: true, system: `${req.system || ''}\n\nReply with JSON only, shaped like this schema:\n${JSON.stringify(compactSchema(req.json))}` }
        : req;
      r = await narrator.generate({ ...loose, timeoutMs, model: m });
      if (r.status && r.status !== 429) await recordRequest(m);
    }
    return r;
  };

  let result = await attempt(model);
  if (!onPc && job === 'world' && !fellBack && (result.kind === 'rate_limit' || transient(result))) {
    model = s.gmModel;
    fellBack = true;
    result = await attempt(model);
  }
  return { ...result, model, fellBack, via: narrator.id };
}

/**
 * Ask for a reply from the service chosen in Settings.
 *   job: 'gm' (referee and narrator, every turn) or 'world' (world-building, summaries)
 *   preferPc: in Auto mode, go to the home PC first (a scene Gemini declined is still going)
 * Auto mode runs on Gemini and sends a request Gemini blocks to the home PC
 * instead; if the PC is preferred but unreachable, Gemini is used.
 * Resolves to the result plus { model, fellBack, via, auto, switched }. Never throws.
 */
export async function ask({ preferPc = false, ...req }) {
  const s = await loadSettings();
  settingsRef = s;
  if (s.provider !== 'auto') {
    return askProvider(narrators[s.provider] || narrators.gemini, s, req);
  }
  const canPc = !!(s.pcUrl || '').trim();
  // A scene Gemini declined stays on the PC; if the PC is not answering, Gemini takes over.
  if (preferPc && canPc) {
    const r = await askProvider(narrators.pc, s, req);
    if (r.ok || r.kind === 'aborted' || !(pcDown(r) || r.kind === 'server')) return { ...r, auto: true };
  }
  const r = await askProvider(narrators.gemini, s, req);
  if (r.kind === 'blocked' && canPc) {
    const pc = await askProvider(narrators.pc, s, req);
    if (pc.ok || pc.kind === 'aborted') return { ...pc, auto: true, switched: true };
    return { ...r, auto: true, message: `${r.message} Your home PC could not take over: ${pc.message}` };
  }
  return { ...r, auto: true };
}
