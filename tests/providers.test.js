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

const blockedBody = { promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } };
const pcBody = { choices: [{ message: { content: 'From the PC.' }, finish_reason: 'stop' }] };

function fakeNet({ geminiBlocks = true, pcUp = true } = {}) {
  const calls = [];
  globalThis.fetch = async (url) => {
    if (url.includes('generativelanguage')) {
      calls.push('gemini');
      return { status: 200, json: async () => (geminiBlocks ? blockedBody : okBody) };
    }
    calls.push('pc');
    if (!pcUp) throw new TypeError('Failed to fetch');
    return { status: 200, json: async () => pcBody };
  };
  return calls;
}

test('auto mode: what Gemini blocks goes to the home PC', async () => {
  const realFetch = globalThis.fetch;
  try {
    await saveSettings({ provider: 'auto', geminiKey: 'k', pcUrl: 'https://pc.ts.net', gmModel: 'lite' });
    let calls = fakeNet();
    let r = await ask({ messages: [{ role: 'user', text: 'hi' }] });
    assert.equal(r.ok, true);
    assert.equal(r.text, 'From the PC.');
    assert.equal(r.via, 'pc');
    assert.equal(r.switched, true);
    assert.deepEqual(calls, ['gemini', 'pc']);

    calls = fakeNet({ geminiBlocks: false });
    r = await ask({ messages: [{ role: 'user', text: 'hi' }] });
    assert.equal(r.via, 'gemini');
    assert.deepEqual(calls, ['gemini']);

    calls = fakeNet();
    r = await ask({ messages: [{ role: 'user', text: 'hi' }], preferPc: true });
    assert.equal(r.via, 'pc');
    assert.ok(!r.switched);
    assert.deepEqual(calls, ['pc'], 'a scene on the PC skips Gemini');

    calls = fakeNet({ pcUp: false });
    r = await ask({ messages: [{ role: 'user', text: 'hi' }] });
    assert.equal(r.kind, 'blocked');
    assert.match(r.message, /home PC could not be reached/);
  } finally {
    globalThis.fetch = realFetch;
    await saveSettings({ provider: 'gemini' });
  }
});
