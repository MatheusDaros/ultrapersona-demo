const BASE = 'https://coarena.ai/api/v1';

export function availableModels(response) {
  if (!Array.isArray(response?.data)) return [];
  return response.data
    .filter((model) => typeof model?.id === 'string' && model.id.trim() && model.lifecycle !== 'deprecated')
    .map((model) => ({
      id: model.id,
      name: typeof model.display_name === 'string' && model.display_name.trim() ? model.display_name : model.id,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

export async function verifyConnection(key, signal) {
  const result = await fetch(`${BASE}/key`, {
    headers: { Authorization: `Bearer ${key}` },
    signal,
  });
  if (result.status === 401 || result.status === 403) {
    throw new Error('A Coarena recusou esta chave ou ela não tem permissão.');
  }
  if (!result.ok) throw new Error(`Falha ao validar a chave (HTTP ${result.status}).`);

  const catalog = await fetch(`${BASE}/models`, { signal });
  if (!catalog.ok) throw new Error(`Falha ao carregar os modelos (HTTP ${catalog.status}).`);
  const models = availableModels(await catalog.json());
  if (!models.length) throw new Error('A Coarena não retornou modelos disponíveis.');
  return models;
}

export async function parseCompletion(response, onDelta) {
  if (!response.body) throw new Error('A API respondeu sem texto.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  let eventData = [];
  let finishReason;

  function readLine(line) {
    if (line.startsWith('data:')) {
      eventData.push(line.slice(5).trimStart());
      return false;
    }
    if (line || !eventData.length) return false;
    const data = eventData.join('\n').trim();
    eventData = [];
    if (data === '[DONE]') return true;
    if (!data) return false;
    let event;
    try { event = JSON.parse(data); }
    catch { throw new Error('A API enviou uma resposta inválida.'); }
    if (event?.error) throw new Error('A resposta foi interrompida pela API.');
    const choice = event?.choices?.[0];
    if (typeof choice?.finish_reason === 'string') finishReason = choice.finish_reason;
    const delta = choice?.delta?.content;
    if (typeof delta === 'string' && delta) {
      full += delta;
      onDelta(delta);
    }
    return false;
  }

  try {
    let finished = false;
    while (!finished) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() + '\n\n' : decoder.decode(value, { stream: true });
      let end = buffer.indexOf('\n');
      while (end !== -1) {
        finished = readLine(buffer.slice(0, end).replace(/\r$/, ''));
        buffer = buffer.slice(end + 1);
        if (finished) break;
        end = buffer.indexOf('\n');
      }
      if (done) break;
    }
    if (finishReason === 'length') throw new Error('A resposta atingiu o limite de tamanho.');
    if (finishReason && finishReason !== 'stop') throw new Error('A resposta foi interrompida pela API.');
    if (!finished && finishReason !== 'stop') throw new Error('A conexão terminou antes de concluir a resposta.');
    if (!full.trim()) throw new Error('A API respondeu sem texto.');
    return full;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function streamReply({ key, model, messages, signal, onDelta }) {
  const response = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: true, max_tokens: 1600 }),
    signal,
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error('A Coarena recusou a chave. Reconecte a IA para tentar novamente.');
  }
  if (!response.ok) throw new Error(`Falha ao obter resposta da Coarena (HTTP ${response.status}).`);
  return parseCompletion(response, onDelta);
}
