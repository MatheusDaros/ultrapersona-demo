import assert from 'node:assert/strict';
import { suggestions } from '../health.mjs';

const deployUrl = process.argv[2];
assert.ok(deployUrl, 'Informe a URL do deploy. Exemplo: npm run smoke:event -- https://ultrapersona-saude.vercel.app');
const target = new URL(deployUrl);
assert.ok(['http:', 'https:'].includes(target.protocol), 'Informe uma URL HTTP ou HTTPS.');

async function get(path) {
  const response = await fetch(new URL(path, target.origin), {
    redirect: 'error',
    signal: AbortSignal.timeout(28000),
  });
  assert.equal(response.status, 200, `${path} retornou HTTP ${response.status}`);
  return response;
}

const index = await get('/');
assert.ok((await index.text()).includes('<title>UltraPersona Saúde'), 'Página da demo ausente.');
const config = await get('/event-config.mjs');
assert.ok(/^export const eventBackend = true;\s*$/.test(await config.text()), 'Modo evento desativado.');

for (const topic of Object.keys(suggestions)) {
  const response = await get(`/api/event-reply?topic=${topic}`);
  const result = await response.json();
  assert.ok(typeof result?.reply === 'string' && result.reply.trim(), `Resposta ausente para ${topic}.`);
  console.log(`${topic}: resposta confirmada em ${target.origin}`);
}
