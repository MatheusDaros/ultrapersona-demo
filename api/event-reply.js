import { buildMessages, suggestions } from '../health.mjs';

const inFlight = new Map();
const cooldown = new Map();

function error(status, message, headers = {}) {
  return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

async function generate(topic, key) {
  const response = await fetch('https://coarena.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemini-3-8-flash',
      messages: buildMessages([], suggestions[topic].prompt),
      reasoning_effort: 'low',
      max_tokens: 1600,
    }),
    signal: AbortSignal.timeout(18000),
  });
  if (!response.ok) {
    console.warn('Coarena event request failed', { topic, status: response.status });
    throw new Error('Provider unavailable');
  }
  const choice = (await response.json()).choices?.[0];
  const reply = choice?.message?.content;
  if (typeof reply !== 'string' || !reply.trim() || (choice.finish_reason && choice.finish_reason !== 'stop')) {
    throw new Error('Incomplete provider reply');
  }
  return reply;
}

export default {
  async fetch(request) {
    if (request.method !== 'GET') return error(405, 'Método indisponível.', { Allow: 'GET' });
    const { pathname, search: query } = new URL(request.url);
    if (pathname !== '/api/event-reply') return error(404, 'Rota indisponível.');
    const topic = query.slice('?topic='.length);
    if (!Object.hasOwn(suggestions, topic) || query !== `?topic=${topic}`) {
      return error(400, 'Tema indisponível.');
    }
    const key = process.env.COARENA_API_KEY;
    if (!key || (cooldown.get(topic) ?? 0) > Date.now()) return error(503, 'IA temporariamente indisponível.');

    if (!inFlight.has(topic)) {
      inFlight.set(topic, generate(topic, key).catch(() => {
        cooldown.set(topic, Date.now() + 30000);
        return null;
      }).finally(() => inFlight.delete(topic)));
    }
    const reply = await inFlight.get(topic);
    if (!reply) return error(502, 'IA temporariamente indisponível.');

    return Response.json({ reply }, {
      headers: {
        'Cache-Control': 'public, max-age=120',
        'Vercel-CDN-Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      },
    });
  },
};
