import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOpenAICompatProvider, interpretChat, toJsonSchema, cleanBase, extractJson } from '../js/providers/openai-compat.js';

const reply = (content, finish = 'stop') => ({ choices: [{ message: { content }, finish_reason: finish }] });

test('address is cleaned up', () => {
  assert.equal(cleanBase('my-pc.tail1.ts.net/'), 'https://my-pc.tail1.ts.net');
  assert.equal(cleanBase('https://x.ts.net/v1'), 'https://x.ts.net');
  assert.equal(cleanBase('http://192.168.1.5:1234'), 'http://192.168.1.5:1234');
});

test('json replies are read even with chatter or thinking around them', () => {
  assert.deepEqual(interpretChat(200, reply('<think>hmm</think>\n{"prose":"Hi","changes":[]}'), { json: true }).data, { prose: 'Hi', changes: [] });
  assert.deepEqual(extractJson('Sure! Here it is:\n```json\n{"a":1}\n```'), { a: 1 });
  assert.equal(interpretChat(200, reply('no json here'), { json: true }).kind, 'bad_json');
  assert.equal(interpretChat(200, reply('   '), {}).kind, 'empty');
});

test('schemas are converted to standard JSON Schema', () => {
  const s = toJsonSchema({ type: 'OBJECT', properties: { k: { type: 'STRING', format: 'enum', enum: ['a'] } }, required: ['k'] });
  assert.deepEqual(s, { type: 'object', properties: { k: { type: 'string', enum: ['a'] } }, required: ['k'] });
});

test('sends an OpenAI-style request and retries without an answer shape if refused', async () => {
  const bodies = [];
  const fetchFn = async (url, opts) => {
    assert.equal(url, 'https://pc.ts.net/v1/chat/completions');
    const b = JSON.parse(opts.body);
    bodies.push(b);
    if (b.response_format) return { status: 400, json: async () => ({ error: 'response_format not supported' }) };
    return { status: 200, json: async () => reply('{"prose":"Rain.","changes":[]}') };
  };
  const p = createOpenAICompatProvider({ getBase: () => 'pc.ts.net', fetchFn });
  const r = await p.generate({ model: 'rp-12b', system: 'sys', messages: [{ role: 'user', text: 'hi' }], json: true, temperature: 0.9, maxTokens: 100 });
  assert.equal(r.ok, true);
  assert.equal(r.data.prose, 'Rain.');
  assert.equal(bodies[0].messages[0].role, 'system');
  assert.equal(bodies[0].model, 'rp-12b');
  assert.equal(bodies[0].max_tokens, 100);
  assert.equal(bodies[0].response_format.type, 'json_schema');
  assert.equal(bodies[1].response_format, undefined);
});

test('unreachable PC gives a plain explanation', async () => {
  const p = createOpenAICompatProvider({ getBase: () => 'https://pc.ts.net', fetchFn: async () => { throw new TypeError('Failed to fetch'); } });
  const r = await p.generate({ messages: [{ role: 'user', text: 'hi' }] });
  assert.equal(r.kind, 'network');
  assert.match(r.message, /Tailscale/);
});

test('lists loaded models', async () => {
  const p = createOpenAICompatProvider({ getBase: () => 'https://pc.ts.net', fetchFn: async () => ({ status: 200, json: async () => ({ data: [{ id: 'rocinante-12b' }, { id: 'text-embedding-nomic' }] }) }) });
  const r = await p.listModels();
  assert.deepEqual(r.models.map((m) => m.id), ['rocinante-12b']);
});
