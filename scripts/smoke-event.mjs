import assert from 'node:assert/strict';
import { suggestions } from '../health.mjs';

const deployUrl = process.argv[2];
assert.ok(deployUrl, 'Informe a URL do deploy. Exemplo: npm run smoke:event -- https://ultrapersona-saude.vercel.app');
const target = new URL(deployUrl);
assert.ok(['http:', 'https:'].includes(target.protocol), 'Informe uma URL HTTP ou HTTPS.');

async function getResponse(path, options) {
  const response = await fetch(new URL(path, target.origin), {
    ...options,
    redirect: 'error',
    signal: AbortSignal.timeout(28000),
  });
  assert.equal(response.status, 200, `${path} retornou HTTP ${response.status}`);
  return response;
}

const index = await getResponse('/');
assert.ok((await index.text()).includes('<title>UltraPersona Saúde'), 'Página da demo ausente.');
const config = await getResponse('/event-config.mjs');
assert.ok(/^export const eventBackend = true;\s*$/.test(await config.text()), 'Modo evento desativado.');

const chat = await getResponse('/api/event-reply', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: target.origin },
  body: JSON.stringify({ message: 'Qual é a capital do Japão? Responda só com o nome da cidade.' }),
});
assert.match(chat.headers.get('Cache-Control') ?? '', /\bno-store\b/, 'Chat livre sem proteção contra cache.');
const { reply } = await chat.json();
assert.ok(typeof reply === 'string' && /t[óo]quio|tokyo/i.test(reply), 'O chat livre não respondeu à pergunta geral.');
console.log(`Chat livre: resposta confirmada em ${target.origin}`);

for (const topic of Object.keys(suggestions)) {
  const response = await getResponse(`/api/event-reply?topic=${topic}`);
  const result = await response.json();
  assert.ok(typeof result?.reply === 'string' && result.reply.trim(), `Resposta ausente para ${topic}.`);
  console.log(`${topic}: resposta confirmada em ${target.origin}`);
}
