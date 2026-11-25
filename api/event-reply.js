import { buildMessages, eventChatLimits, suggestions } from '../health.mjs';

const inFlight = new Map();
const cooldown = new Map();
const unavailable = 'IA temporariamente indisponível.';

function error(status, message, headers = {}) {
  return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

async function generate(messages, key, signal = AbortSignal.timeout(18000)) {
  const response = await fetch('https://coarena.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemini-3-8-flash',
      messages,
      reasoning_effort: 'low',
      max_tokens: 1600,
    }),
    signal,
  });
  if (!response.ok) {
    console.warn('Coarena event request failed', { status: response.status });
    throw new Error('Provider unavailable');
  }
  const choice = (await response.json()).choices?.[0];
  const reply = choice?.message?.content;
  if (typeof reply !== 'string' || !reply.trim() || (choice.finish_reason && choice.finish_reason !== 'stop')) {
    throw new Error('Incomplete provider reply');
  }
  return reply;
}

function validText(text, limit) {
  return typeof text === 'string' && text.length <= limit && Boolean(text.trim());
}

async function chat(request, { origin, search }, key) {
  if (search) return error(400, 'Envie a pergunta no corpo da requisição.');
  const caller = request.headers.get('origin');
  if (caller && caller !== origin) return error(403, 'Origem indisponível.');
  const type = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (type !== 'application/json') return error(415, 'Envie a pergunta em JSON.');

  let payload;
  try {
    const body = await request.arrayBuffer();
    if (body.byteLength > 65536) return error(413, 'Mensagem muito longa.');
    payload = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return error(400, 'Mensagem inválida.');
  }
  const { message, history = [] } = payload ?? {};
  if (
    !validText(message, eventChatLimits.question) ||
    !Array.isArray(history) ||
    history.length > eventChatLimits.history ||
    history.length % 2 !== 0 ||
    !history.every((turn, index) => {
      const isAnswer = index % 2 === 1;
      return turn?.role === (isAnswer ? 'assistant' : 'user') &&
        validText(turn.content, isAnswer ? eventChatLimits.answer : eventChatLimits.question);
    })
  ) {
    return error(400, 'Mensagem ou histórico inválido.');
  }
  if (!key) return error(503, unavailable);
  const turns = history.map(({ role, content }) => ({ role, content }));
  try {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(18000)]);
    signal.throwIfAborted();
    const reply = await generate(buildMessages(turns, message.trim(), { openChat: true }), key, signal);
    return Response.json({ reply }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return error(502, unavailable);
  }
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== '/api/event-reply') return error(404, 'Rota indisponível.');
    const key = process.env.COARENA_API_KEY;
    if (request.method === 'POST') return chat(request, url, key);
    if (request.method !== 'GET') return error(405, 'Método indisponível.', { Allow: 'GET, POST' });
    const query = url.search;
    const topic = query.slice('?topic='.length);
    if (!Object.hasOwn(suggestions, topic) || query !== `?topic=${topic}`) {
      return error(400, 'Tema indisponível.');
    }
    if (!key || (cooldown.get(topic) ?? 0) > Date.now()) return error(503, unavailable);

    if (!inFlight.has(topic)) {
      inFlight.set(topic, generate(buildMessages([], suggestions[topic].prompt), key).catch(() => {
        cooldown.set(topic, Date.now() + 30000);
        return null;
      }).finally(() => inFlight.delete(topic)));
    }
    const reply = await inFlight.get(topic);
    if (!reply) return error(502, unavailable);

    return Response.json({ reply }, {
      headers: {
        'Cache-Control': 'public, max-age=120',
        'Vercel-CDN-Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      },
    });
  },
};
