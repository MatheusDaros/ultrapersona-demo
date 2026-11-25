import { person, metrics, suggestions, demoReply, buildMessages } from './health.mjs';
import { verifyConnection, streamReply } from './coarena.mjs';

const $ = (selector) => document.querySelector(selector);
const messages = $('#messages');
const input = $('#input');
const model = $('#model');
const connectionDialog = $('#connection-dialog');
const keyInput = $('#api-key');
const navigation = document.querySelectorAll('.nav-link');
const state = { key: '', verification: null, generation: null, local: [], live: [] };

const icon = (name) => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;

function renderDashboard() {
  document.querySelectorAll('[data-person]').forEach((element) => {
    element.textContent = person[element.dataset.person];
  });
  $('#hero-description').textContent = 'Com base na sua última semana, preparei pequenos passos para melhorar seu sono, se movimentar e ter mais energia.';
  $('#profile-facts').innerHTML = person.facts.map(([label, detail]) =>
    `<div><dt>${label}</dt><dd>${detail}</dd></div>`
  ).join('');

  $('#metrics').innerHTML = metrics.map((metric) => `
    <article class="card metric ${metric.topic}">
      <div class="metric-heading"><span class="card-icon">${icon(metric.icon)}</span><h3>${metric.label}</h3></div>
      <div class="metric-body">
        <div><p class="metric-value">${metric.value}</p><p class="metric-detail">${metric.detail}</p></div>
        <div class="sparkline" aria-hidden="true">${metric.values.map((value) =>
          `<span style="height:${Math.round(value / metric.scale * 100)}%"></span>`).join('')}</div>
      </div>
    </article>`).join('');

  $('#suggestions').innerHTML = Object.entries(suggestions).map(([topic, suggestion]) => `
    <article class="card suggestion-card ${topic}">
      <div class="suggestion-category"><span class="card-icon">${icon(suggestion.icon)}</span>${suggestion.category}</div>
      <h3>${suggestion.title}</h3>
      <p>${suggestion.description}</p>
      <p class="reason">${suggestion.reason}</p>
      <button type="button" class="text-button" data-topic="${topic}">${suggestion.action}${icon('arrow')}</button>
    </article>`).join('');

  $('#quick-replies').innerHTML = Object.entries(suggestions).map(([topic, suggestion]) =>
    `<button type="button" class="button secondary" data-topic="${topic}">${suggestion.action}</button>`
  ).join('');
}

function appendMessage(role, text) {
  const message = document.createElement('div');
  message.className = `message ${role}`;
  if (role !== 'user') {
    const badge = document.createElement('span');
    badge.className = 'card-icon';
    badge.innerHTML = icon(role === 'error' ? 'info' : 'spark');
    message.append(badge);
  }
  const body = document.createElement('div');
  body.className = 'message-body';
  const label = document.createElement('p');
  label.className = 'message-name';
  label.textContent = {
    user: 'Você',
    assistant: state.key ? 'Assistente ao vivo' : 'Exemplo da demo',
    error: 'Resposta indisponível',
  }[role];
  const content = document.createElement('p');
  content.className = 'message-content';
  content.textContent = text;
  body.append(label, content);
  message.append(body);
  messages.append(message);
  return { message, content };
}

function scrollMessages() {
  messages.scrollTop = messages.scrollHeight;
}

function renderConversation() {
  const live = Boolean(state.key);
  messages.replaceChildren();
  appendMessage('assistant', live
    ? 'Posso montar um plano de bem-estar com os dados fictícios da Marina. Pergunte sobre sono, movimento ou energia.'
    : 'Oi, Marina! Podemos começar por uma rotina noturna, uma caminhada curta ou uma manhã mais tranquila. Qual combina com a sua semana?');
  for (const { role, content } of live ? state.live : state.local) appendMessage(role, content);
  scrollMessages();
}

function updateConnectionMode() {
  const live = Boolean(state.key);
  $('#mode-label').textContent = live ? 'IA ao vivo' : 'Modo demo';
  $('#mode-label').classList.toggle('live', live);
  $('#connection-label').textContent = live ? 'Conexão da IA' : 'Conectar IA';
  $('#assistant-subtitle').textContent = live
    ? 'Respostas da Coarena com o perfil fictício da Marina.'
    : 'Respostas de exemplo baseadas no perfil da Marina.';
  $('#connection-form').hidden = live;
  $('#connected-settings').hidden = !live;
  input.value = '';
  renderConversation();
}

function showConnectionStatus(text, error = false) {
  const status = $('#connection-status');
  status.textContent = text;
  status.classList.toggle('error', error);
}

function setVerifying(busy) {
  keyInput.disabled = busy;
  $('#connect').disabled = busy;
}

async function connect(event) {
  event.preventDefault();
  const key = keyInput.value.trim();
  if (!key || state.verification) return;

  const controller = new AbortController();
  const timeout = AbortSignal.timeout(15000);
  state.verification = controller;
  setVerifying(true);
  showConnectionStatus('Validando a chave e carregando modelos…');
  try {
    const models = await verifyConnection(key, AbortSignal.any([controller.signal, timeout]));
    if (controller.signal.aborted || !connectionDialog.open) return;
    model.replaceChildren(...models.map(({ id, name }) => new Option(name, id)));
    const preferred = models.find(({ id }) => id === 'gemini-3-8-flash');
    model.value = (preferred || models[0]).id;
    state.key = key;
    updateConnectionMode();
    showConnectionStatus('IA conectada nesta sessão.');
    model.focus();
  } catch (error) {
    if (controller.signal.aborted) return;
    const reason = timeout.aborted ? 'A validação demorou demais. Tente novamente.'
      : error instanceof TypeError || error instanceof SyntaxError ? 'Falha ao consultar a Coarena. Tente novamente.'
        : error.message;
    showConnectionStatus(reason, true);
  } finally {
    if (state.verification === controller) {
      state.verification = null;
      setVerifying(false);
      keyInput.value = '';
    }
  }
}

function disconnect() {
  state.generation?.abort();
  state.generation = null;
  state.key = '';
  state.live = [];
  model.replaceChildren();
  updateConnectionMode();
  setGenerating(false);
  showConnectionStatus('Modo demo ativo.');
  keyInput.focus();
}

function setGenerating(busy) {
  input.disabled = busy;
  $('#send').disabled = busy;
  $('#stop').hidden = !busy;
  document.querySelectorAll('[data-topic]').forEach((button) => { button.disabled = busy; });
}

function storeTurn(history, question, answer) {
  history.push({ role: 'user', content: question }, { role: 'assistant', content: answer });
  if (history.length > 40) history.splice(0, history.length - 40);
  trimMessages();
}

function trimMessages() {
  while (messages.childElementCount > 41) messages.children[1].remove();
}

async function send(text, topic) {
  if (!text || state.generation) return;
  appendMessage('user', text);

  if (!state.key) {
    const answer = demoReply(text, topic);
    appendMessage('assistant', answer);
    storeTurn(state.local, text, answer);
    scrollMessages();
    return;
  }

  const controller = new AbortController();
  const timeout = AbortSignal.timeout(60000);
  const answer = appendMessage('assistant', 'Preparando resposta…');
  answer.message.setAttribute('aria-busy', 'true');
  state.generation = controller;
  setGenerating(true);
  scrollMessages();

  try {
    const output = document.createTextNode('');
    const reply = await streamReply({
      key: state.key,
      model: model.value,
      messages: buildMessages(state.live, text),
      signal: AbortSignal.any([controller.signal, timeout]),
      onDelta(delta) {
        if (!output.parentNode) answer.content.replaceChildren(output);
        const follow = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 35;
        output.appendData(delta);
        if (follow) scrollMessages();
      },
    });
    if (state.generation !== controller) return;
    controller.signal.throwIfAborted();
    timeout.throwIfAborted();
    storeTurn(state.live, text, reply);
  } catch (error) {
    if (state.generation !== controller) return;
    answer.message.remove();
    const message = controller.signal.aborted ? 'Resposta interrompida. Você pode fazer outra pergunta.'
      : timeout.aborted ? 'A resposta demorou demais. Envie a pergunta novamente para tentar.'
        : error instanceof TypeError ? 'Falha de conexão com a Coarena. Tente novamente.' : error.message;
    appendMessage('error', message);
    trimMessages();
    scrollMessages();
  } finally {
    if (state.generation === controller) {
      answer.message.removeAttribute('aria-busy');
      state.generation = null;
      setGenerating(false);
      input.focus({ preventScroll: true });
    }
  }
}

function updateNavigation() {
  const active = ['#plan', '#assistant'].includes(location.hash) ? location.hash : '#overview';
  navigation.forEach((link) => {
    if (link.hash === active) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  });
}

renderDashboard();
updateConnectionMode();
updateNavigation();
window.addEventListener('hashchange', updateNavigation);

$('#open-profile').addEventListener('click', () => $('#profile-dialog').showModal());
$('#open-connection').addEventListener('click', () => {
  showConnectionStatus(state.key ? 'IA conectada nesta sessão.' : '');
  connectionDialog.showModal();
  (state.key ? model : keyInput).focus();
});
$('#connection-form').addEventListener('submit', connect);
$('#disconnect').addEventListener('click', disconnect);
connectionDialog.addEventListener('close', () => {
  state.verification?.abort();
  state.verification = null;
  setVerifying(false);
  keyInput.value = '';
});

$('#composer').addEventListener('submit', (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  send(text);
});
$('#stop').addEventListener('click', () => state.generation?.abort());

document.querySelectorAll('[data-topic]').forEach((button) => {
  button.addEventListener('click', () => {
    const topic = button.dataset.topic;
    if (button.closest('#plan')) {
      if (location.hash === '#assistant') $('#assistant').scrollIntoView();
      else location.hash = 'assistant';
      $('#assistant-heading').focus({ preventScroll: true });
    }
    send(suggestions[topic].prompt, topic);
  });
});
