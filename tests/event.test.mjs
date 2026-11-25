import assert from 'node:assert/strict';
import test from 'node:test';
import handler from '../api/event-reply.js';
import { eventTopic } from '../health.mjs';

const request = (query = '?topic=sleep', method = 'GET') =>
  new Request(`https://demo.test/api/event-reply${query}`, { method });

const chat = (body, headers = {}, query = '') => new Request(`https://demo.test/api/event-reply${query}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

function setProviderKey(t, key = 'test-provider-key') {
  const savedKey = process.env.COARENA_API_KEY;
  if (key) process.env.COARENA_API_KEY = key;
  else delete process.env.COARENA_API_KEY;
  t.after(() => {
    if (savedKey === undefined) delete process.env.COARENA_API_KEY;
    else process.env.COARENA_API_KEY = savedKey;
  });
}

test('unknown, qualified and clinical messages do not select an event topic', () => {
  assert.equal(eventTopic('Como melhorar meu sono?'), 'sleep');
  assert.equal(eventTopic('Posso caminhar depois de desmaiar?'), undefined);
  assert.equal(eventTopic('Sono após desmaio'), undefined);
});

test('GET accepts only the three canonical event topics', async () => {
  assert.equal((await handler.fetch(request('?topic=sleep', 'PUT'))).status, 405);
  for (const query of ['', '?topic=unknown', '?topic=%73leep', '?topic=sleep&more=yes', '?topic=sleep&topic=sleep']) {
    assert.equal((await handler.fetch(request(query))).status, 400);
  }
});

test('provider failures cool down the topic without returning provider details', async (t) => {
  setProviderKey(t);
  t.mock.method(console, 'warn', () => {});
  const upstream = t.mock.method(globalThis, 'fetch', async () => Response.json(
    { error: { message: 'upstream error with account details' } },
    { status: 429 },
  ));
  const first = await handler.fetch(request('?topic=movement'));
  const second = await handler.fetch(request('?topic=movement'));
  assert.equal(first.status, 502);
  assert.equal(second.status, 503);
  assert.equal(first.headers.get('Cache-Control'), 'no-store');
  assert.doesNotMatch(await first.text(), /account details/);
  assert.equal(upstream.mock.callCount(), 1);
});

test('concurrent calls share a fixed fictional prompt, and the response can be cached', async (t) => {
  setProviderKey(t);
  const upstream = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://coarena.ai/api/v1/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer test-provider-key');
    const body = JSON.parse(options.body);
    assert.equal(body.messages.length, 2);
    assert.equal(body.reasoning_effort, 'low');
    assert.equal(body.max_tokens, 1600);
    assert.match(body.messages[0].content, /Marina Costa/);
    assert.equal(body.messages[1].content, 'Monte uma rotina noturna para mim.');
    return Response.json({ choices: [{ message: { content: 'Uma resposta de teste.' } }] });
  });
  const results = await Promise.all([handler.fetch(request()), handler.fetch(request())]);
  assert.equal(upstream.mock.callCount(), 1);
  for (const result of results) {
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { reply: 'Uma resposta de teste.' });
    assert.match(result.headers.get('Vercel-CDN-Cache-Control'), /s-maxage=/);
  }
});

test('free chat rejects invalid input before making a provider request', async (t) => {
  setProviderKey(t);
  const upstream = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected provider call'); });
  const message = 'Qual é a capital do Japão?';
  const system = { role: 'system', content: 'A different system prompt' };
  for (const payload of [null, {}, { message: ' ' }, { message: 'a'.repeat(601) }, { message, history: [system, system] }]) {
    assert.equal((await handler.fetch(chat(payload))).status, 400);
  }
  assert.equal((await handler.fetch(chat({ message: 'a'.repeat(65537) }))).status, 413);
  assert.equal((await handler.fetch(chat({ message }, { 'Content-Type': 'text/plain' }))).status, 415);
  assert.equal((await handler.fetch(chat({ message }, { Origin: 'https://another-site.test' }))).status, 403);
  assert.equal((await handler.fetch(chat({ message }, {}, '?topic=sleep'))).status, 400);
  assert.equal(upstream.mock.callCount(), 0);
});

test('free chat forwards a question outside the demo with recent history and no response caching', async (t) => {
  setProviderKey(t);
  const upstream = t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer test-provider-key');
    const { messages } = JSON.parse(options.body);
    assert.match(messages[0].content, /Marina Costa/);
    assert.deepEqual(messages.slice(1), [
      { role: 'user', content: 'Qual é a capital do Japão?' },
      { role: 'assistant', content: 'Tóquio.' },
      { role: 'user', content: 'E o idioma oficial?' },
    ]);
    return Response.json({ choices: [{ message: { content: 'Japonês.' }, finish_reason: 'stop' }] });
  });
  const result = await handler.fetch(chat({
    message: ' E o idioma oficial? ',
    history: [
      { role: 'user', content: 'Qual é a capital do Japão?' },
      { role: 'assistant', content: 'Tóquio.', name: 'discarded metadata' },
    ],
  }, { Origin: 'https://demo.test' }));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { reply: 'Japonês.' });
  assert.equal(result.headers.get('Cache-Control'), 'no-store');
  assert.equal(result.headers.get('Vercel-CDN-Cache-Control'), null);
  assert.equal(upstream.mock.callCount(), 1);
});

test('free chat leaves failed requests retryable and keeps provider details private', async (t) => {
  setProviderKey(t);
  t.mock.method(console, 'warn', () => {});
  let attempts = 0;
  t.mock.method(globalThis, 'fetch', async () => ++attempts === 1
    ? Response.json({ error: 'private provider details' }, { status: 429 })
    : Response.json({ choices: [{ message: { content: 'Uma resposta completa.' }, finish_reason: 'stop' }] }));
  const first = await handler.fetch(chat({ message: 'Qual é a capital do Japão?' }));
  assert.equal(first.status, 502);
  assert.equal(first.headers.get('Cache-Control'), 'no-store');
  assert.doesNotMatch(await first.text(), /private provider details/);
  const retry = await handler.fetch(chat({ message: 'Qual é a capital do Japão?' }));
  assert.equal(retry.status, 200);
  assert.equal(attempts, 2);
});
