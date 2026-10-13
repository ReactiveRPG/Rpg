// Provider layer. The rest of the game asks for "a game-master reply" or
// "a world-building reply" and never talks to a specific service directly,
// so a provider can be swapped in Settings without touching game code.

import { loadSettings } from '../settings.js';
import { recordRequest, usedToday } from '../usage.js';
import { createGeminiProvider, compactSchema } from './gemini.js';
import { createOpenAICompatProvider } from './openai-compat.js';
import { db } from '../db.js';

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

// ----- Request log, for the Console -----
const REQUEST_LOG_SIZE = 80;
let requestLog = null;
export async function getRequestLog() {
  if (!requestLog) requestLog = (await db.get('kv', 'requestLog').catch(() => null)) || [];
  return requestLog;
}
async function logRequest(entry) {
  const log = await getRequestLog();
  log.push(entry);
  if (log.length > REQUEST_LOG_SIZE) log.splice(0, log.length - REQUEST_LOG_SIZE);
  db.put('kv', 'requestLog', log).catch(() => {});
}

/** Gemini is busy, slow or broken rather than refusing: worth asking another model. */
const overloaded = (r) => ['timeout', 'server', 'network', 'rate_limit', 'empty', 'bad_json'].includes(r.kind);
export const niceModel = (id) => String(id || '').replace(/^gemini-/, 'Gemini ').replace(/-flash-lite\b/, ' Flash-Lite').replace(/-flash\b/, ' Flash').replace(/-pro\b/, ' Pro').replace(/-(?!Lite)/g, ' ');

/**
 * One request to one provider: retries busy servers, and for Gemini handles
 * the world model's daily allowance and fallback to the game-master model.
 *   req.label      what the request is for, shown in the Console's request log
 *   req.retries    quiet retries on a busy server (default 2)
 *   req.timeoutMs  time limit per try
 *   req.model      a specific model instead of the one Settings picks
 */
async function askProvider(narrator, s, { job = 'gm', label, retries = 2, model: forced, ...req }) {
  const onPc = narrator.id === 'pc';
  // The home PC runs one model for every job and has no daily allowance.
  let model = onPc ? (s.pcModel || '') : forced || (job === 'world' ? s.worldModel : s.gmModel);
  let fellBack = false;
  if (!onPc && !forced && job === 'world' && (await usedToday(s.worldModel)) >= s.worldDailyLimit) {
    model = s.gmModel;
    fellBack = true;
  }

  // World-building replies are long; give Gemini a little more time for them.
  const timeoutMs = req.timeoutMs || (onPc ? undefined : job === 'world' ? 120000 : 75000);
  const call = async (m, r) => {
    const t0 = Date.now();
    const res = await narrator.generate({ ...r, timeoutMs, model: m });
    if (res.status && res.status !== 429) await recordRequest(m);
    const u = res.usage || {};
    logRequest({
      at: t0, label: label || job, via: narrator.id, model: m || '(loaded model)', seconds: Math.round((Date.now() - t0) / 100) / 10,
      result: res.ok ? 'ok' : res.kind, status: res.status, stop: res.finishReason || '',
      tokensIn: u.promptTokenCount ?? u.prompt_tokens, tokensOut: u.candidatesTokenCount ?? u.completion_tokens, thinking: u.thoughtsTokenCount,
    });
    return res;
  };
  const attempt = async (m) => {
    let r = await call(m, req);
    for (const [i, delay] of RETRY_DELAYS_MS.slice(0, retries).entries()) {
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
      r = await call(m, loose);
    }
    return r;
  };

  let result = await attempt(model);
  if (!onPc && !forced && job === 'world' && !fellBack && (result.kind === 'rate_limit' || transient(result))) {
    model = s.gmModel;
    fellBack = true;
    result = await attempt(model);
  }
  return { ...result, model, fellBack, via: narrator.id };
}

/**
 * Ask for a reply from the service chosen in Settings.
 *   job: 'gm' (referee, narrator, record-keeper) or 'world' (world-building, summaries)
 *   preferPc: in Auto mode, go to the home PC first (a scene Gemini declined is still going)
 *   onNote: called with a short message when the game switches to another model
 * When Gemini's game-master model is busy or not answering, a game-master
 * request is asked again of the other Gemini model, then of the home PC if it
 * is set up. Auto mode also sends what Gemini blocks to the home PC.
 * Resolves to the result plus { model, fellBack, via, auto, switched, rescued }. Never throws.
 */
export async function ask({ preferPc = false, onNote = () => {}, ...req }) {
  const s = await loadSettings();
  settingsRef = s;
  const auto = s.provider === 'auto';
  if (s.provider === 'pc') return askProvider(narrators.pc, s, req);
  const canPc = !!(s.pcUrl || '').trim();

  // A scene Gemini declined stays on the PC; if the PC is not answering, Gemini takes over.
  if (auto && preferPc && canPc) {
    const r = await askProvider(narrators.pc, s, req);
    if (r.ok || r.kind === 'aborted' || !(pcDown(r) || r.kind === 'server')) return { ...r, auto: true };
  }

  let r = await askProvider(narrators.gemini, s, req);

  // Busy or silent: ask the other Gemini model, then the home PC, before giving up.
  if ((req.job || 'gm') === 'gm' && overloaded(r) && !req.signal?.aborted) {
    const first = r;
    if (s.worldModel && s.worldModel !== s.gmModel) {
      onNote(`${niceModel(s.gmModel)} is not answering; asking ${niceModel(s.worldModel)}…`);
      const r2 = await askProvider(narrators.gemini, s, { ...req, model: s.worldModel, retries: 0 });
      if (r2.ok || !overloaded(r2)) return { ...r2, auto, fellBack: true };
      r = r2;
    }
    if (canPc && !req.signal?.aborted) {
      onNote('Gemini is busy; asking your home PC…');
      const r3 = await askProvider(narrators.pc, s, { ...req, retries: 0 });
      if (r3.ok || r3.kind === 'aborted') return { ...r3, auto, rescued: true };
    }
    if (r.kind !== 'aborted') {
      return { ...first, auto, message: `Google's servers are busy or not answering right now${s.worldModel !== s.gmModel ? ' (both Gemini models tried)' : ''}${canPc ? ', and your home PC could not take over' : ''}. Nothing in your game changed. Wait a little and resend.` };
    }
    return { ...r, auto };
  }

  if (auto && r.kind === 'blocked' && canPc) {
    const pc = await askProvider(narrators.pc, s, req);
    if (pc.ok || pc.kind === 'aborted') return { ...pc, auto: true, switched: true };
    return { ...r, auto: true, message: `${r.message} Your home PC could not take over: ${pc.message}` };
  }
  return { ...r, auto };
}
