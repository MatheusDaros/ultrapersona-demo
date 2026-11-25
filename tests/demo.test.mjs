import assert from 'node:assert/strict';
import test from 'node:test';
import { metrics, suggestions, demoReply, buildMessages } from '../health.mjs';
import { parseCompletion, availableModels } from '../coarena.mjs';

test('dashboard averages agree with the fictional week and its suggestions', () => {
  assert.deepEqual(metrics.map(({ value }) => value), ['6h 18min', '4.260', '3/5']);
  for (const metric of metrics) assert.equal(metric.values.length, 7);
  assert.match(suggestions.sleep.reason, /6h 18min/);
  assert.match(suggestions.movement.reason, /4\.260/);
});

test('the local assistant answers demo topics and declines unsupported or clinical questions', () => {
  assert.match(demoReply('Como melhorar meu sono?'), /22h45/);
  assert.match(demoReply('Monte uma caminhada', 'movement'), /segunda/);
  assert.match(demoReply('Como posso me movimentar mais?'), /4\.260/);
  assert.match(demoReply('O que fazer para ter noites melhores?'), /22h45/);
  assert.match(demoReply('Como posso ter mais energia nas manhãs?'), /2\/5 na quinta/);
  assert.match(demoReply('Dormir melhor tomando remédio?'), /organizar hábitos/);
  assert.match(demoReply('Posso caminhar depois de desmaiar?'), /profissional de saúde/);
  assert.doesNotMatch(demoReply('Como melhorar meu sono? Sinto falta de ar.'), /22h45/);
  assert.match(demoReply('Qual é a capital do Japão?'), /sono, movimento e energia/);
});

test('the live completion body has a fictional system context and caps prior turns', () => {
  const history = Array.from({ length: 24 }, (_, i) => ({
    role: i % 2 ? 'assistant' : 'user',
    content: String(i),
  }));
  const messages = buildMessages(history, 'Vamos planejar a semana');
  assert.equal(messages.length, 14);
  assert.equal(messages[0].role, 'system');
  assert.match(messages[0].content, /Marina/);
  assert.match(messages[0].content, /6h 18min/);
  assert.deepEqual(messages[1], history[12]);
  assert.deepEqual(messages.at(-1), { role: 'user', content: 'Vamos planejar a semana' });
});

test('completion decoding handles split CRLF and UTF-8 sequences', async () => {
  const bytes = new TextEncoder().encode(
    ': ping\r\n\r\ndata: {"choices":[{"delta":{"content":"Olá, "}}]}\r\n\r\n' +
    'data: {"choices":[{"delta":{"content":"Marina!"}}]}\n\ndata: [DONE]',
  );
  const body = new ReadableStream({
    start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  });
  const deltas = [];
  assert.equal(await parseCompletion(new Response(body), (delta) => deltas.push(delta)), 'Olá, Marina!');
  assert.deepEqual(deltas, ['Olá, ', 'Marina!']);
});

test('empty and provider error streams fail visibly', async () => {
  await assert.rejects(parseCompletion(new Response('data: [DONE]\n\n'), () => {}), /sem texto/);
  await assert.rejects(
    parseCompletion(new Response('data: {"error":{"message":"untrusted"}}\n\n'), () => {}),
    /interrompida pela API/,
  );
});

test('a stop finish reason completes a reply even without a DONE sentinel', async () => {
  const response = new Response(
    'data: {"choices":[{"delta":{"content":"Olá, Marina!"}}]}\n\n' +
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
  );
  assert.equal(await parseCompletion(response, () => {}), 'Olá, Marina!');
});

test('a disconnected or truncated stream is not a completed reply', async () => {
  const partial = new Response('data: {"choices":[{"delta":{"content":"Uma sugestão"}}]}\n\n');
  await assert.rejects(parseCompletion(partial, () => {}), /concluir a resposta/);

  const truncated = new Response(
    'data: {"choices":[{"delta":{"content":"Uma sugestão"},"finish_reason":"length"}]}\n\n' +
    'data: [DONE]\n\n',
  );
  await assert.rejects(parseCompletion(truncated, () => {}), /limite de tamanho/);
});

test('only non-deprecated models with valid ids can be selected', () => {
  assert.deepEqual(availableModels({ data: [
    null, { id: 'old', lifecycle: 'deprecated' }, { id: '' },
    { id: 'current', display_name: 'Atual', lifecycle: 'active' },
  ] }), [{ id: 'current', name: 'Atual' }]);
  assert.deepEqual(availableModels({ data: 'unexpected' }), []);
});
