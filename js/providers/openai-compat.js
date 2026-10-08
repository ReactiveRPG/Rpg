// Home PC text provider. Talks to a model running on the player's own computer
// through the OpenAI-style API that LM Studio, Ollama and similar programs offer.
// Nothing here leaves the player's own devices.

import { salvageNarration } from './gemini.js';

function fail(kind, message, extra = {}) {
  return { ok: false, kind, message, ...extra };
}

/** Converts the game's answer shapes (Gemini style) into standard JSON Schema. */
export function toJsonSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  const out = {};
  if (schema.type) out.type = String(schema.type).toLowerCase();
  if (schema.description) out.description = schema.description;
  if (schema.enum) out.enum = schema.enum;
  if (schema.properties) out.properties = Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, toJsonSchema(v)]));
  if (schema.required) out.required = schema.required;
  if (schema.items) out.items = toJsonSchema(schema.items);
  return out;
}

/** The narrator's reply: free-form change objects, so only the outer shape is fixed. */
const NARRATION_SHAPE = {
  type: 'object',
  properties: { prose: { type: 'string' }, changes: { type: 'array', items: { type: 'object' } } },
  required: ['prose', 'changes'],
};

export function cleanBase(url) {
  let u = String(url || '').trim().replace(/\/+$/, '');
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u.replace(/\/v1$/, '');
}

function stripThinking(text) {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*<\/think>/i, '').trim();
}

/** Pulls the JSON object out of a reply that may have chatter or fences around it. */
export function extractJson(text) {
  const t = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  try { return JSON.parse(t); } catch { /* look for an object inside */ }
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(t.slice(start, end + 1)); } catch { /* fall through */ }
  }
  return undefined;
}

/** Turns an HTTP status and body into the same result shape the Gemini provider gives. Pure. */
export function interpretChat(status, body, { json } = {}) {
  const apiMsg = body?.error?.message || (typeof body?.error === 'string' ? body.error : '');
  if (status === 401 || status === 403) return fail('bad_key', 'Your PC refused the request. If you set an API key in its server, put the same key in Settings.', { detail: apiMsg });
  if (status === 404) return fail('bad_model', `Your PC does not have that model loaded. Open Settings and tap "Check connection" to pick one. ${apiMsg}`.trim(), { detail: apiMsg });
  if (status >= 500) return fail('server', `Your PC's model server had a problem (code ${status}). ${apiMsg}`.trim(), { detail: apiMsg, retryable: true });
  if (status !== 200) return fail('error', `Your PC's model server returned an error (code ${status}). ${apiMsg}`.trim(), { detail: apiMsg, retryable: true });
  const choice = body?.choices?.[0];
  const raw = choice?.message?.content ?? choice?.text ?? '';
  const text = stripThinking(String(raw));
  if (!text) return fail('empty', 'The model on your PC sent back an empty reply. Nothing in your game changed. Resend to try again.', { retryable: true });
  const truncated = choice?.finish_reason === 'length';
  if (json) {
    const data = extractJson(text);
    if (data !== undefined && data !== null && typeof data === 'object') return { ok: true, text, data, truncated };
    const rescued = salvageNarration(text);
    if (rescued) return { ok: true, text, data: rescued, truncated, salvaged: true };
    return fail('bad_json', truncated
      ? 'The model on your PC ran out of room before finishing. Resend, or raise the context length in LM Studio.'
      : 'The model on your PC sent back a reply the game could not read. Resend to try again.', { detail: text.slice(0, 500), retryable: true });
  }
  return { ok: true, text, truncated };
}

export function createOpenAICompatProvider({ getBase, getKey = () => '', fetchFn = (...a) => fetch(...a) }) {
  const headers = () => {
    const h = { 'Content-Type': 'application/json' };
    if (getKey()) h.Authorization = `Bearer ${getKey()}`;
    return h;
  };
  const unreachable = (base) => fail('network',
    `Could not reach your PC at ${base}. Check that the PC is on, LM Studio's server is running with CORS on, and Tailscale is connected on both the PC and this phone.`,
    { retryable: true });

  return {
    id: 'pc',
    label: 'Home PC (LM Studio)',

    async generate(req) {
      const base = cleanBase(getBase());
      if (!base) return fail('no_key', 'No home PC address yet. Open Settings and enter it.');
      const messages = [];
      if (req.system) messages.push({ role: 'system', content: req.system });
      for (const m of req.messages) messages.push({ role: m.role === 'model' ? 'assistant' : 'user', content: m.text });
      const body = { messages, stream: false };
      if (req.model) body.model = req.model;
      if (req.temperature != null) body.temperature = req.temperature;
      if (req.maxTokens) body.max_tokens = req.maxTokens;
      if (req.json) {
        const schema = req.json === true ? NARRATION_SHAPE : toJsonSchema(req.json);
        body.response_format = { type: 'json_schema', json_schema: { name: 'reply', schema } };
      }
      const post = (b) => fetchFn(`${base}/v1/chat/completions`, { method: 'POST', headers: headers(), body: JSON.stringify(b), signal: req.signal });
      try {
        let res = await post(body);
        let parsed = await res.json().catch(() => null);
        // Some servers do not support answer shapes: ask again with the shape only in words.
        if (res.status === 400 && body.response_format) {
          delete body.response_format;
          messages[0] = { ...messages[0], content: `${messages[0].content}\n\nReply with a single JSON object only, no other text.` };
          res = await post(body);
          parsed = await res.json().catch(() => null);
        }
        return { ...interpretChat(res.status, parsed, req), status: res.status };
      } catch (err) {
        if (err && err.name === 'AbortError') return fail('aborted', 'Request cancelled.');
        return { ...unreachable(base), detail: String(err) };
      }
    },

    async listModels() {
      const base = cleanBase(getBase());
      if (!base) return fail('no_key', 'Enter your PC\'s address first.');
      try {
        const res = await fetchFn(`${base}/v1/models`, { headers: headers() });
        const body = await res.json().catch(() => null);
        if (res.status !== 200) return interpretChat(res.status, body, {});
        const models = (body?.data || []).map((m) => ({ id: m.id, name: m.id }))
          .filter((m) => !/embed/i.test(m.id));
        return { ok: true, models };
      } catch (err) {
        return { ...unreachable(base), detail: String(err) };
      }
    },
  };
}
