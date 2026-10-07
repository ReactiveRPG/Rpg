import { test } from 'node:test';
import assert from 'node:assert/strict';

// Minimal browser stand-ins so the provider layer can run in Node.
const store = new Map();
globalThis.indexedDB = undefined;
const { db } = await import('../js/db.js');
db.get = async (s, k) => store.get(s + k);
db.put = async (s, k, v) => { store.set(s + k, v); };
globalThis.document = { documentElement: { dataset: {} } };

const { saveSettings } = await import('../js/settings.js');
const { ask } = await import('../js/providers/index.js');

const okBody = { candidates: [{ content: { parts: [{ text: 'Fine.' }] }, finishReason: 'STOP' }] };

test('busy server is retried, then world jobs fall back to the game-master model', async () => {
  await saveSettings({ geminiKey: 'k', gmModel: 'lite', worldModel: 'big' });
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const model = url.match(/models\/([^:]+):/)[1];
    seen.push(model);
    if (model === 'big') return { status: 503, json: async () => ({ error: { message: 'The model is overloaded.' } }) };
    return { status: 200, json: async () => okBody };
  };
  const realTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn) => realTimeout(fn, 0);
  try {
    const r = await ask({ job: 'world', messages: [{ role: 'user', text: 'hi' }] });
    assert.equal(r.ok, true);
    assert.equal(r.model, 'lite');
    assert.equal(r.fellBack, true);
    assert.deepEqual(seen, ['big', 'big', 'big', 'lite']);
  } finally {
    globalThis.fetch = realFetch;
    globalThis.setTimeout = realTimeout;
  }
});
