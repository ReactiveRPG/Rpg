// Gemini text provider. Talks to Google's Generative Language API straight
// from the phone; the key is sent in a header and never leaves the device
// any other way.

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

// All four adjustable safety categories are switched off on every request.
export const SAFETY_CATEGORIES = [
  'HARM_CATEGORY_HARASSMENT',
  'HARM_CATEGORY_HATE_SPEECH',
  'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  'HARM_CATEGORY_DANGEROUS_CONTENT',
];

export function safetySettings(threshold = 'OFF') {
  return SAFETY_CATEGORIES.map((category) => ({ category, threshold }));
}

const BLOCK_REASONS = new Set([
  'SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION', 'IMAGE_SAFETY', 'LANGUAGE', 'OTHER',
]);

export function buildBody({ system, messages, json, temperature, maxTokens }, threshold = 'OFF') {
  const body = {
    contents: messages.map((m) => ({ role: m.role === 'model' ? 'model' : 'user', parts: [{ text: m.text }] })),
    safetySettings: safetySettings(threshold),
    generationConfig: {},
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (temperature != null) body.generationConfig.temperature = temperature;
  if (maxTokens) body.generationConfig.maxOutputTokens = maxTokens;
  if (json) {
    body.generationConfig.responseMimeType = 'application/json';
    if (json !== true) body.generationConfig.responseSchema = json;
  }
  return body;
}

function fail(kind, message, extra = {}) {
  return { ok: false, kind, message, ...extra };
}

/** Turns an HTTP status and parsed body into a plain-language result. Pure, so it can be tested. */
export function interpretResponse(status, body, { model, json } = {}) {
  const apiMsg = body && body.error && body.error.message ? body.error.message : '';
  if (status === 400 && /api key/i.test(apiMsg)) {
    return fail('bad_key', 'Gemini did not accept your key. Open Settings and check it was pasted in full.', { detail: apiMsg });
  }
  if (status === 401 || status === 403) {
    return fail('bad_key', 'Gemini refused the key (it may be wrong, or not allowed to use this model). Open Settings and check it.', { detail: apiMsg });
  }
  if (status === 404) {
    return fail('bad_model', `Gemini does not recognise the model "${model}". Open Settings and tap "Check key" to pick from the list.`, { detail: apiMsg });
  }
  if (status === 429) {
    return fail('rate_limit', "Gemini's free limit was hit. Wait a minute and resend. If it keeps happening, today's allowance is used up until midnight US Pacific time.", { detail: apiMsg, retryable: true });
  }
  if (status >= 500) {
    return fail('server', `Gemini's servers had a problem (code ${status}). Wait a moment and resend.`, { detail: apiMsg, retryable: true });
  }
  if (status !== 200) {
    return fail('error', `Gemini returned an error (code ${status}). ${apiMsg}`.trim(), { detail: apiMsg, retryable: true });
  }

  const feedback = body && body.promptFeedback;
  if (feedback && feedback.blockReason) {
    return fail('blocked', `Gemini blocked the request before replying (reason: ${feedback.blockReason}). Nothing in your game changed. Resend, or rephrase it.`, { reason: feedback.blockReason, retryable: true });
  }
  const cand = body && body.candidates && body.candidates[0];
  if (!cand) {
    return fail('empty', 'Gemini sent back an empty reply. Nothing in your game changed. Resend, or rephrase it.', { retryable: true });
  }
  const finish = cand.finishReason || '';
  const text = ((cand.content && cand.content.parts) || [])
    .filter((p) => typeof p.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join('')
    .trim();
  if (BLOCK_REASONS.has(finish) && !text) {
    return fail('blocked', `Gemini blocked the reply (reason: ${finish}). Nothing in your game changed. Resend, or rephrase it.`, { reason: finish, retryable: true });
  }
  if (BLOCK_REASONS.has(finish) && finish !== 'OTHER') {
    // Cut off part-way by a filter: a partial reply is worse than none.
    return fail('blocked', `Gemini stopped the reply part-way (reason: ${finish}). Nothing in your game changed. Resend, or rephrase it.`, { reason: finish, retryable: true });
  }
  if (!text) {
    return fail('empty', 'Gemini sent back an empty reply. Nothing in your game changed. Resend, or rephrase it.', { retryable: true });
  }
  const truncated = finish === 'MAX_TOKENS';
  if (json) {
    try {
      return { ok: true, text, data: JSON.parse(stripFences(text)), finishReason: finish, truncated };
    } catch {
      return fail('bad_json', truncated
        ? 'Gemini ran out of room before finishing its reply. Resend to try again.'
        : 'Gemini sent back a reply the game could not read. Resend to try again.', { detail: text.slice(0, 500), retryable: true });
    }
  }
  return { ok: true, text, finishReason: finish, truncated, usage: body.usageMetadata };
}

/** A shorter description of a schema, for putting in a prompt. */
export function compactSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  if (schema.type === 'OBJECT') return Object.fromEntries(Object.entries(schema.properties || {}).map(([k, v]) => [k, compactSchema(v)]));
  if (schema.type === 'ARRAY') return [compactSchema(schema.items)];
  if (schema.enum) return schema.enum.join(' | ');
  return `${schema.type.toLowerCase()}${schema.description ? ': ' + schema.description : ''}`;
}

function stripFences(text) {
  const m = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return m ? m[1] : text;
}

export function createGeminiProvider({ getKey, fetchFn = (...a) => fetch(...a) }) {
  async function post(model, body, signal) {
    const res = await fetchFn(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': getKey() },
      body: JSON.stringify(body),
      signal,
    });
    let parsed = null;
    try { parsed = await res.json(); } catch { /* empty or non-JSON body */ }
    return { status: res.status, body: parsed };
  }

  return {
    id: 'gemini',
    label: 'Google Gemini',

    /** One request. Resolves to { ok, text, data? } or { ok:false, kind, message }. Never throws. */
    async generate(req) {
      if (!getKey()) return fail('no_key', 'No Gemini key yet. Open Settings and paste your key.');
      try {
        let r = await post(req.model, buildBody(req, 'OFF'), req.signal);
        // Older models reject the OFF threshold; BLOCK_NONE is the next most open setting.
        let threshold = 'OFF';
        if (r.status === 400 && /threshold/i.test(r.body?.error?.message || '')) {
          threshold = 'BLOCK_NONE';
          r = await post(req.model, buildBody(req, threshold), req.signal);
        }
        // If the model refuses the answer format, ask for plain JSON and describe the shape in words.
        if (r.status === 400 && req.json && req.json !== true && !/api key/i.test(r.body?.error?.message || '')) {
          const loose = { ...req, json: true, system: `${req.system || ''}\n\nReply with JSON only, shaped like this schema:\n${JSON.stringify(compactSchema(req.json))}` };
          r = await post(req.model, buildBody(loose, threshold), req.signal);
        }
        return { ...interpretResponse(r.status, r.body, req), status: r.status };
      } catch (err) {
        if (err && err.name === 'AbortError') return fail('aborted', 'Request cancelled.');
        return fail('network', 'Could not reach Gemini. Check the phone is online, then resend.', { retryable: true, detail: String(err) });
      }
    },

    /** Models this key can use for text, newest names first. */
    async listModels() {
      if (!getKey()) return fail('no_key', 'No Gemini key yet.');
      try {
        const res = await fetchFn(`${BASE}/models?pageSize=1000`, { headers: { 'x-goog-api-key': getKey() } });
        const body = await res.json().catch(() => null);
        if (res.status !== 200) return interpretResponse(res.status, body, {});
        const models = (body.models || [])
          .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
          .map((m) => ({ id: m.name.replace(/^models\//, ''), name: m.displayName || m.name }))
          .sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }));
        return { ok: true, models };
      } catch (err) {
        return fail('network', 'Could not reach Gemini. Check the phone is online.', { detail: String(err) });
      }
    },
  };
}

/**
 * Picks the best model id from a list: the highest-numbered "gemini-X-flash-lite"
 * for the game master, or plain "gemini-X-flash" for world-building.
 * Skips preview/experimental/special-purpose variants when a stable one exists.
 */
export function pickModel(ids, kind) {
  const special = /(tts|image|audio|live|embedding|vision|thinking|native|computer|robotics)/;
  const candidates = ids.filter((id) => {
    if (!/^gemini-\d/.test(id) || special.test(id)) return false;
    const isLite = /flash-lite/.test(id);
    if (kind === 'gm') return isLite;
    return /flash/.test(id) && !isLite;
  });
  const version = (id) => parseFloat((id.match(/^gemini-(\d+(?:\.\d+)?)/) || [])[1] || '0');
  const unstable = (id) => /(preview|exp|latest|\d{2}-\d{2}|-\d{3}$)/.test(id);
  candidates.sort((a, b) => version(b) - version(a) || unstable(a) - unstable(b) || a.length - b.length);
  return candidates[0] || null;
}
