import assert from 'node:assert/strict';
import test from 'node:test';
import handler from '../api/event-reply.js';
import { eventTopic } from '../health.mjs';

const request = (query = '?topic=sleep', method = 'GET') =>
  new Request(`https://demo.test/api/event-reply${query}`, { method });

test('unknown, qualified and clinical messages do not select an event topic', () => {
  assert.equal(eventTopic('Como melhorar meu sono?'), 'sleep');
  assert.equal(eventTopic('Posso caminhar depois de desmaiar?'), undefined);
  assert.equal(eventTopic('Sono após desmaio'), undefined);
});

test('the endpoint accepts only canonical GETs for the three event topics', async () => {
  assert.equal((await handler.fetch(request('?topic=sleep', 'POST'))).status, 405);
  for (const query of ['', '?topic=unknown', '?topic=%73leep', '?topic=sleep&more=yes', '?topic=sleep&topic=sleep']) {
    assert.equal((await handler.fetch(request(query))).status, 400);
  }
});

test('provider failures cool down the topic without returning provider details', async (t) => {
  const savedKey = process.env.COARENA_API_KEY;
  process.env.COARENA_API_KEY = 'test-provider-key';
  t.after(() => {
    if (savedKey === undefined) delete process.env.COARENA_API_KEY;
    else process.env.COARENA_API_KEY = savedKey;
  });
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
  const savedKey = process.env.COARENA_API_KEY;
  process.env.COARENA_API_KEY = 'test-provider-key';
  t.after(() => {
    if (savedKey === undefined) delete process.env.COARENA_API_KEY;
    else process.env.COARENA_API_KEY = savedKey;
  });
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
