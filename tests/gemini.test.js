import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpretResponse, buildBody, pickModel, createGeminiProvider } from '../js/providers/gemini.js';

const ok = (text, finishReason = 'STOP') => ({ candidates: [{ content: { parts: [{ text }] }, finishReason }] });

test('normal reply', () => {
  const r = interpretResponse(200, ok('Rain hammers the dock.'));
  assert.equal(r.ok, true);
  assert.equal(r.text, 'Rain hammers the dock.');
});

test('thought parts are dropped', () => {
  const r = interpretResponse(200, { candidates: [{ content: { parts: [{ text: 'hmm', thought: true }, { text: 'Hello.' }] }, finishReason: 'STOP' }] });
  assert.equal(r.text, 'Hello.');
});

test('prompt blocked is reported plainly', () => {
  const r = interpretResponse(200, { promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } });
  assert.equal(r.ok, false);
  assert.equal(r.kind, 'blocked');
  assert.match(r.message, /PROHIBITED_CONTENT/);
});

test('reply blocked by safety is reported', () => {
  const r = interpretResponse(200, { candidates: [{ finishReason: 'SAFETY' }] });
  assert.equal(r.kind, 'blocked');
});

test('partial reply cut by filter is rejected', () => {
  const r = interpretResponse(200, ok('Half a sent', 'PROHIBITED_CONTENT'));
  assert.equal(r.kind, 'blocked');
});

test('empty reply is reported', () => {
  assert.equal(interpretResponse(200, { candidates: [] }).kind, 'empty');
  assert.equal(interpretResponse(200, ok('   ')).kind, 'empty');
  assert.equal(interpretResponse(200, null).kind, 'empty');
});

test('http errors become plain words', () => {
  assert.equal(interpretResponse(400, { error: { message: 'API key not valid. Please pass a valid API key.' } }).kind, 'bad_key');
  assert.equal(interpretResponse(429, {}).kind, 'rate_limit');
  assert.equal(interpretResponse(404, {}, { model: 'x' }).kind, 'bad_model');
  assert.equal(interpretResponse(503, {}).kind, 'server');
});

test('json replies are parsed, fenced or not', () => {
  assert.deepEqual(interpretResponse(200, ok('{"a":1}'), { json: true }).data, { a: 1 });
  assert.deepEqual(interpretResponse(200, ok('```json\n{"a":2}\n```'), { json: true }).data, { a: 2 });
  assert.equal(interpretResponse(200, ok('{"a":'), { json: true }).kind, 'bad_json');
});

test('every request turns all four safety categories off', () => {
  const body = buildBody({ system: 'sys', messages: [{ role: 'user', text: 'hi' }] });
  assert.equal(body.safetySettings.length, 4);
  assert.ok(body.safetySettings.every((s) => s.threshold === 'OFF'));
  assert.equal(body.systemInstruction.parts[0].text, 'sys');
});

test('falls back to BLOCK_NONE if OFF is rejected', async () => {
  const seen = [];
  const fetchFn = async (url, opts) => {
    const body = JSON.parse(opts.body);
    seen.push(body.safetySettings[0].threshold);
    if (body.safetySettings[0].threshold === 'OFF') {
      return { status: 400, json: async () => ({ error: { message: 'Invalid threshold value' } }) };
    }
    return { status: 200, json: async () => ok('Fine.') };
  };
  const p = createGeminiProvider({ getKey: () => 'k', fetchFn });
  const r = await p.generate({ model: 'm', messages: [{ role: 'user', text: 'hi' }] });
  assert.deepEqual(seen, ['OFF', 'BLOCK_NONE']);
  assert.equal(r.ok, true);
});

test('network failure never throws', async () => {
  const p = createGeminiProvider({ getKey: () => 'k', fetchFn: async () => { throw new TypeError('Failed to fetch'); } });
  const r = await p.generate({ model: 'm', messages: [{ role: 'user', text: 'hi' }] });
  assert.equal(r.kind, 'network');
});

test('missing key is reported', async () => {
  const p = createGeminiProvider({ getKey: () => '' });
  assert.equal((await p.generate({ model: 'm', messages: [] })).kind, 'no_key');
});

test('pickModel prefers newest stable lite / flash', () => {
  const ids = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3.5-flash-lite-preview-09-2026',
    'gemini-3.8-flash', 'gemini-3.8-flash-image', 'gemini-3.8-pro', 'gemini-3.5-flash-tts', 'gemma-3-27b-it'];
  assert.equal(pickModel(ids, 'gm'), 'gemini-3.5-flash-lite');
  assert.equal(pickModel(ids, 'world'), 'gemini-3.8-flash');
  assert.equal(pickModel(['gemini-3.5-flash-lite-preview'], 'gm'), 'gemini-3.5-flash-lite-preview');
  assert.equal(pickModel(['gemma-3'], 'gm'), null);
});
