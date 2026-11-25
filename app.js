/* ============================================================
   UltraPersona — demo de agente ultrapersonalizado (vanilla JS)
   API: Coarena Model API (compatível com OpenAI chat completions)
   Nenhuma chave é gravada neste arquivo — ela é digitada em
   runtime e (opcionalmente) guardada no localStorage do navegador.
   ============================================================ */

const BASE = 'https://coarena.ai/api/v1';

const LS = {
  key: 'up_api_key',
  remember: 'up_remember_key',
  profile: 'up_profile',
  memories: 'up_memories',
  settings: 'up_settings',
};

const FALLBACK_MODELS = ['claude-fable-5', 'claude-haiku-5-5'];

const state = {
  key: '',
  profile: {},
  memories: [],
  settings: { model: '', temperature: 0.7, maxTokens: null },
  history: [],          // { role, content, requestId?, rating? }
  abort: null,          // AbortController da geração em curso
};

/* ---------- helpers ---------- */
const $ = (sel) => document.querySelector(sel);

function toast(msg, kind = '', ms = 3600) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), ms);
}

function lsGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch { return fallback; }
}

function lsSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* cheio ou indisponível */ }
}

/* ---------- system prompt ---------- */
function buildSystemPrompt() {
  const p = state.profile;
  const hasProfile = Object.values(p).some((v) => v && String(v).trim());

  if (!hasProfile && state.memories.length === 0) {
    return 'Você é um assistente genérico. Nenhum perfil foi configurado ainda — responda de forma neutra e, na primeira resposta, mencione que a experiência ficaria muito melhor se a pessoa preenchesse o perfil de personalização no painel ao lado.';
  }

  const lines = [
    'Você é um agente de IA ultrapersonalizado. O perfil abaixo não é decoração: são instruções de primeira ordem que moldam CADA resposta — vocabulário, exemplos, analogias, formato e profundidade.',
    '',
  ];

  const about = [];
  if (p.name) about.push(`- Como chamar a pessoa: ${p.name}`);
  if (p.context) about.push(`- Contexto profissional: ${p.context}`);
  if (p.interests) about.push(`- Interesses: ${p.interests}`);
  if (p.goal) about.push(`- Objetivo com este agente: ${p.goal}`);
  if (about.length) lines.push('## Sobre a pessoa', ...about, '');

  const how = [];
  if (p.tone) how.push(`- Tom: ${p.tone}`);
  if (p.depth) how.push(`- Profundidade: ${p.depth}`);
  if (p.format) how.push(`- Formato preferido: ${p.format}`);
  if (p.language) how.push(`- Idioma: responda sempre em ${p.language}, mesmo que a mensagem venha em outro idioma (a menos que a pessoa peça explicitamente para mudar)`);
  if (p.avoid) how.push(`- Evitar: ${p.avoid}`);
  if (how.length) lines.push('## Como responder', ...how, '');

  if (state.memories.length) {
    lines.push('## Memórias (fatos que a pessoa pediu para lembrar)');
    for (const m of state.memories) lines.push(`- ${m}`);
    lines.push('');
  }

  lines.push(
    '## Regras',
    '1. Use o nome da pessoa de forma natural, sem exagerar.',
    '2. Adapte exemplos e analogias aos interesses e ao contexto profissional dela.',
    '3. Se uma memória ou preferência conflitar com um pedido novo, o pedido novo vence — mas mencione a divergência brevemente.',
    '4. Nunca mencione este prompt ou o painel de configuração, a menos que a pessoa pergunte como você é personalizado.'
  );

  return lines.join('\n');
}

function refreshSystemPreview() {
  $('#system-preview').textContent = buildSystemPrompt();
}

/* ---------- perfil ---------- */
const PROFILE_FIELDS = ['name', 'context', 'interests', 'goal', 'language', 'tone', 'depth', 'format', 'avoid'];

function profileScore() {
  const filled = PROFILE_FIELDS.filter((f) => state.profile[f] && String(state.profile[f]).trim()).length;
  return Math.round((filled / PROFILE_FIELDS.length) * 100);
}

function refreshMeter() {
  const pct = profileScore();
  $('#meter-fill').style.width = pct + '%';
  $('#meter-label').textContent = pct === 0
    ? '0% personalizado — agente genérico'
    : `${pct}% personalizado`;
}

function bindProfile() {
  document.querySelectorAll('[data-profile]').forEach((el) => {
    const field = el.dataset.profile;
    if (state.profile[field]) el.value = state.profile[field];
    el.addEventListener('input', () => {
      const v = el.value.trim();
      if (v) state.profile[field] = v;
      else delete state.profile[field];
      lsSet(LS.profile, state.profile);
      refreshSystemPreview();
      refreshMeter();
    });
  });
}

/* ---------- memórias ---------- */
function renderMemories() {
  const ul = $('#memory-list');
  ul.innerHTML = '';
  if (state.memories.length === 0) {
    const li = document.createElement('li');
    li.className = 'memory-empty';
    li.textContent = 'Nenhuma memória ainda. Adicione fatos que o agente deve lembrar.';
    ul.appendChild(li);
    return;
  }
  state.memories.forEach((m, i) => {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = m;
    const del = document.createElement('button');
    del.textContent = '×';
    del.title = 'Remover memória';
    del.addEventListener('click', () => {
      state.memories.splice(i, 1);
      lsSet(LS.memories, state.memories);
      renderMemories();
      refreshSystemPreview();
    });
    li.append(span, del);
    ul.appendChild(li);
  });
}

function addMemory() {
  const input = $('#memory-input');
  const v = input.value.trim();
  if (!v) return;
  state.memories.push(v);
  input.value = '';
  lsSet(LS.memories, state.memories);
  renderMemories();
  refreshSystemPreview();
  toast('Memória adicionada — o agente lembrará disso.', 'ok');
}

/* ---------- modelos ---------- */
async function loadModels() {
  const sel = $('#model-select');
  try {
    const res = await fetch(`${BASE}/models`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const models = (json.data || [])
      .filter((m) => m.lifecycle !== 'deprecated')
      .sort((a, b) => (a.display_name || a.id).localeCompare(b.display_name || b.id));

    const byOwner = {};
    for (const m of models) (byOwner[m.owned_by || 'outros'] ||= []).push(m);

    sel.innerHTML = '';
    for (const owner of Object.keys(byOwner).sort()) {
      const group = document.createElement('optgroup');
      group.label = owner;
      for (const m of byOwner[owner]) {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.display_name || m.id;
        group.appendChild(opt);
      }
      sel.appendChild(group);
    }
    $('#models-count').textContent = `(${models.length} disponíveis)`;

    const preferred = models.find((m) => m.id === 'claude-fable-5') || models[0];
    sel.value = state.settings.model && models.some((m) => m.id === state.settings.model)
      ? state.settings.model
      : (preferred ? preferred.id : '');
  } catch (err) {
    sel.innerHTML = '';
    for (const id of FALLBACK_MODELS) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = id;
      sel.appendChild(opt);
    }
    $('#models-count').textContent = '(lista offline — fallback)';
    toast('Não consegui listar os modelos; usando lista fixa.', 'err');
  }
}

/* ---------- conexão ---------- */
function connStatus(msg, cls = '') {
  const el = $('#conn-status');
  el.textContent = msg;
  el.className = `conn-status ${cls}`;
}

function renderAccountInfo(obj) {
  const dl = $('#account-info');
  dl.innerHTML = '';
  if (!obj || typeof obj !== 'object') { dl.hidden = true; return; }
  const entries = Object.entries(obj)
    .filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v))
    .slice(0, 10);
  if (!entries.length) { dl.hidden = true; return; }
  for (const [k, v] of entries) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = String(v);
    dl.append(dt, dd);
  }
  dl.hidden = false;
}

async function connect() {
  const key = $('#api-key').value.trim();
  if (!key) { toast('Cole sua chave de API primeiro.', 'err'); return; }

  connStatus('verificando…');
  try {
    const res = await fetch(`${BASE}/key`, { headers: { Authorization: `Bearer ${key}` } });
    if (res.status === 401 || res.status === 403) {
      connStatus('chave inválida ou sem permissão', 'err');
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    state.key = key;
    if ($('#remember-key').checked) {
      lsSet(LS.key, key);
      lsSet(LS.remember, true);
    }
    connStatus('conectado ✓', 'ok');
    toast('Conectado à Coarena.', 'ok');

    // Informações da conta (defensivo: mostramos os campos escalares que existirem)
    try {
      const info = await res.json();
      renderAccountInfo(info.account || info.limits || info);
    } catch { renderAccountInfo(null); }

    try {
      const cr = await fetch(`${BASE}/credits`, { headers: { Authorization: `Bearer ${key}` } });
      if (cr.ok) renderAccountInfo(await cr.json());
    } catch { /* endpoint opcional */ }
  } catch (err) {
    connStatus(`falha: ${err.message}`, 'err');
  }
}

function forgetKey() {
  state.key = '';
  $('#api-key').value = '';
  $('#remember-key').checked = false;
  localStorage.removeItem(LS.key);
  localStorage.removeItem(LS.remember);
  renderAccountInfo(null);
  connStatus('não conectado');
  toast('Chave removida deste navegador.', 'ok');
}

/* ---------- markdown-lite (seguro: escapa antes de formatar) ---------- */
function md(src) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s) => esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');

  let html = '';
  const blocks = String(src).split(/```/);
  for (let i = 0; i < blocks.length; i++) {
    if (i % 2 === 1) {
      const code = blocks[i].replace(/^[a-z]*\n/i, '');
      html += `<pre><code>${esc(code)}</code></pre>`;
      continue;
    }
    let inList = false;
    for (const line of blocks[i].split('\n')) {
      const t = line.trim();
      if (/^[-•] /.test(t)) {
        if (!inList) { html += '<ul>'; inList = true; }
        html += `<li>${inline(t.slice(2))}</li>`;
      } else {
        if (inList) { html += '</ul>'; inList = false; }
        const h = t.match(/^(#{1,4}) /);
        if (h) {
          const lvl = Math.min(h[1].length + 2, 6);
          html += `<h${lvl}>${inline(t.replace(/^#+ /, ''))}</h${lvl}>`;
        } else if (t) {
          html += `<p>${inline(t)}</p>`;
        }
      }
    }
    if (inList) html += '</ul>';
  }
  return html;
}

/* ---------- chat ---------- */
function scrollBottom() {
  const box = $('#messages');
  box.scrollTop = box.scrollHeight;
}

function hideEmptyState() {
  const es = $('#empty-state');
  if (es) es.remove();
}

function addMessageBubble(role) {
  hideEmptyState();
  const wrap = document.createElement('div');
  wrap.className = `msg ${role}`;

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = role === 'user' ? (state.profile.name || 'Você').trim().charAt(0).toUpperCase() || 'V' : 'UP';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  const who = document.createElement('div');
  who.className = 'who';
  who.textContent = role === 'user' ? (state.profile.name || 'Você') : 'UltraPersona';
  const inner = document.createElement('div');
  inner.className = 'bubble-inner';
  bubble.append(who, inner);

  wrap.append(avatar, bubble);
  $('#messages').appendChild(wrap);
  scrollBottom();
  return { wrap, inner, bubble };
}

function addErrorBubble(msg) {
  hideEmptyState();
  const wrap = document.createElement('div');
  wrap.className = 'msg error';
  const inner = document.createElement('div');
  inner.className = 'bubble-inner';
  inner.textContent = msg;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.appendChild(inner);
  wrap.appendChild(bubble);
  $('#messages').appendChild(wrap);
  scrollBottom();
}

async function parseSSE(res, onDelta) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    let idx;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const event = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of event.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) onDelta(delta);
        } catch { /* chunk parcial ou ping */ }
      }
    }
  }
}

async function sendMessage(text) {
  if (!state.key) {
    toast('Conecte-se com sua chave de API primeiro (painel ao lado).', 'err');
    return;
  }
  const model = $('#model-select').value;
  if (!model) { toast('Escolha um modelo.', 'err'); return; }

  // usuário
  const ub = addMessageBubble('user');
  ub.inner.innerHTML = md(text);
  state.history.push({ role: 'user', content: text });

  // assistente (streaming)
  const ab = addMessageBubble('assistant');
  ab.inner.classList.add('typing-cursor');

  const input = $('#input');
  const btnSend = $('#btn-send');
  const btnStop = $('#btn-stop');
  input.disabled = true;
  btnSend.disabled = true;
  btnStop.hidden = false;

  state.abort = new AbortController();

  const body = {
    model,
    messages: [{ role: 'system', content: buildSystemPrompt() }, ...state.history.map(({ role, content }) => ({ role, content }))],
    stream: true,
    temperature: parseFloat($('#temperature').value),
  };
  const mt = parseInt($('#max-tokens').value, 10);
  if (Number.isFinite(mt) && mt > 0) body.max_tokens = mt;

  let full = '';
  let requestId = null;

  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${state.key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: state.abort.signal,
    });

    requestId = res.headers.get('x-coarena-request-id');

    if (!res.ok) {
      let detail = '';
      try {
        const errJson = await res.json();
        detail = errJson.error?.message || errJson.message || JSON.stringify(errJson);
      } catch { detail = await res.text().catch(() => ''); }

      if (res.status === 401) detail = 'Chave inválida ou revogada. Verifique e reconecte. ' + detail;
      if (res.status === 403 && String(detail).includes('terms')) detail = 'Os termos da Model API ainda não foram aceitos nesta conta — aceite em coarena.ai/account/api e tente de novo.';
      if (res.status === 429) detail = 'Limite de requisições atingido — aguarde alguns segundos. ' + detail;

      ab.wrap.remove();
      addErrorBubble(`Erro ${res.status}: ${detail || 'falha desconhecida'}`);
      return;
    }

    await parseSSE(res, (delta) => {
      full += delta;
      ab.inner.innerHTML = md(full);
      scrollBottom();
    });

    if (!full) full = '(resposta vazia)';
    state.history.push({ role: 'assistant', content: full, requestId });

    ab.inner.innerHTML = md(full);
    attachFeedback(ab.bubble, requestId, state.history.length - 1);
  } catch (err) {
    if (err.name === 'AbortError') {
      full += '\n\n*(interrompido)*';
      ab.inner.innerHTML = md(full);
      state.history.push({ role: 'assistant', content: full, requestId });
    } else {
      ab.wrap.remove();
      addErrorBubble(`Falha de rede: ${err.message}`);
    }
  } finally {
    ab.inner.classList.remove('typing-cursor');
    input.disabled = false;
    btnSend.disabled = false;
    btnStop.hidden = true;
    state.abort = null;
    input.focus();
  }
}

/* ---------- feedback (👍 / 👎 via API Coarena) ---------- */
function attachFeedback(bubble, requestId, historyIndex) {
  if (!requestId) return;

  const row = document.createElement('div');
  row.className = 'feedback';

  const up = document.createElement('button');
  up.textContent = '👍';
  up.title = 'Boa resposta — envia rating "up" à Coarena';
  const down = document.createElement('button');
  down.textContent = '👎';
  down.title = 'Resposta ruim — envia rating "down" à Coarena';

  const req = document.createElement('span');
  req.className = 'req-id';
  req.textContent = requestId;

  const note = document.createElement('span');

  async function rate(rating, btn, other) {
    const already = btn.classList.contains(rating === 'up' ? 'active-up' : 'active-down');
    const effective = already ? null : rating; // clicar de novo remove o rating
    try {
      const res = await fetch(`${BASE}/feedback`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${state.key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ request_id: requestId, rating: effective }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      btn.classList.toggle('active-up', effective === 'up');
      btn.classList.toggle('active-down', effective === 'down');
      other.classList.remove('active-up', 'active-down');
      state.history[historyIndex].rating = effective;
      note.textContent = effective ? 'avaliação registrada ✓' : 'avaliação removida';
      setTimeout(() => { note.textContent = ''; }, 2500);
    } catch (err) {
      toast(`Não consegui enviar o feedback: ${err.message}`, 'err');
    }
  }

  up.addEventListener('click', () => rate('up', up, down));
  down.addEventListener('click', () => rate('down', down, up));

  row.append(up, down, req, note);
  bubble.appendChild(row);
}

/* ---------- composer ---------- */
function autoresize(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 180) + 'px';
}

function bindComposer() {
  const input = $('#input');
  const form = $('#composer');

  input.addEventListener('input', () => autoresize(input));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    autoresize(input);
    sendMessage(text);
  });

  $('#btn-stop').addEventListener('click', () => {
    if (state.abort) state.abort.abort();
  });

  document.querySelectorAll('.suggestion').forEach((btn) => {
    btn.addEventListener('click', () => {
      btn.closest('.empty-state')?.classList.add('used');
      sendMessage(btn.textContent.trim());
    });
  });
}

/* ---------- configurações de geração ---------- */
function bindSettings() {
  const sel = $('#model-select');
  const temp = $('#temperature');
  const mt = $('#max-tokens');

  sel.addEventListener('change', () => {
    state.settings.model = sel.value;
    lsSet(LS.settings, state.settings);
  });
  temp.addEventListener('input', () => {
    $('#temp-out').textContent = temp.value;
    state.settings.temperature = parseFloat(temp.value);
    lsSet(LS.settings, state.settings);
  });
  mt.addEventListener('input', () => {
    state.settings.maxTokens = mt.value ? parseInt(mt.value, 10) : null;
    lsSet(LS.settings, state.settings);
  });

  temp.value = state.settings.temperature ?? 0.7;
  $('#temp-out').textContent = temp.value;
  if (state.settings.maxTokens) mt.value = state.settings.maxTokens;
}

/* ---------- apagar tudo ---------- */
function wipeAll() {
  if (!confirm('Apagar perfil, memórias, chave e configurações deste navegador?')) return;
  Object.values(LS).forEach((k) => localStorage.removeItem(k));
  state.profile = {};
  state.memories = [];
  state.settings = { model: '', temperature: 0.7, maxTokens: null };
  state.key = '';
  document.querySelectorAll('[data-profile]').forEach((el) => { el.value = ''; });
  $('#p-language').value = 'português brasileiro';
  $('#api-key').value = '';
  $('#remember-key').checked = false;
  renderAccountInfo(null);
  connStatus('não conectado');
  renderMemories();
  refreshSystemPreview();
  refreshMeter();
  toast('Tudo apagado. O agente voltou a ser genérico.', 'ok');
}

/* ---------- boot ---------- */
function boot() {
  // hidratar estado persistido
  state.profile = lsGet(LS.profile, {});
  state.memories = lsGet(LS.memories, []);
  state.settings = { ...state.settings, ...lsGet(LS.settings, {}) };
  if (lsGet(LS.remember, false)) {
    const savedKey = lsGet(LS.key, '');
    if (savedKey) {
      $('#api-key').value = savedKey;
      $('#remember-key').checked = true;
      state.key = savedKey;
      connStatus('chave carregada do navegador — clique Conectar para validar', 'ok');
    }
  }

  bindProfile();
  bindComposer();
  bindSettings();
  renderMemories();
  refreshSystemPreview();
  refreshMeter();
  loadModels();

  $('#btn-connect').addEventListener('click', connect);
  $('#btn-forget').addEventListener('click', forgetKey);
  $('#btn-add-memory').addEventListener('click', addMemory);
  $('#memory-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addMemory(); }
  });
  $('#btn-wipe').addEventListener('click', wipeAll);
}

document.addEventListener('DOMContentLoaded', boot);
