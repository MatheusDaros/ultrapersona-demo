export const person = {
  firstName: 'Marina',
  name: 'Marina Costa',
  age: 34,
  facts: [
    ['Rotina de trabalho', 'Designer em trabalho híbrido, com escritório às terças e quintas.'],
    ['Sono', 'Costuma ir para a cama por volta de 23h30 e usa telas à noite.'],
    ['Movimento', 'Gosta de caminhar ao ar livre e tem 10 minutos livres depois do almoço em casa.'],
    ['Manhãs', 'Tem pouco tempo para si antes da primeira reunião ou do deslocamento.'],
    ['Objetivo', 'Ter mais energia ao longo do dia e criar hábitos que caibam na rotina.'],
  ],
};

const week = [
  { day: 'Segunda', sleep: 365, steps: 3850, energy: 3 },
  { day: 'Terça', sleep: 375, steps: 4180, energy: 3 },
  { day: 'Quarta', sleep: 405, steps: 4920, energy: 4 },
  { day: 'Quinta', sleep: 350, steps: 3660, energy: 2 },
  { day: 'Sexta', sleep: 390, steps: 4530, energy: 3 },
  { day: 'Sábado', sleep: 370, steps: 3980, energy: 3 },
  { day: 'Domingo', sleep: 391, steps: 4700, energy: 3 },
];

const average = (field) => week.reduce((sum, day) => sum + day[field], 0) / week.length;
const minutes = Math.round(average('sleep'));
const sleep = `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}min`;
const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
const steps = number.format(average('steps'));
const energy = `${number.format(average('energy'))}/5`;
const lowestEnergy = week.reduce((lowest, day) => day.energy < lowest.energy ? day : lowest);

export const metrics = [
  { topic: 'sleep', icon: 'moon', label: 'Sono', value: sleep, detail: 'média por noite', values: week.map((day) => day.sleep), scale: 480 },
  { topic: 'movement', icon: 'walk', label: 'Passos', value: steps, detail: 'média por dia', values: week.map((day) => day.steps), scale: 6000 },
  { topic: 'energy', icon: 'sun', label: 'Energia', value: energy, detail: 'média autorrelatada', values: week.map((day) => day.energy), scale: 5 },
];

export const suggestions = {
  sleep: {
    icon: 'moon',
    category: 'Sono',
    title: 'Desacelere antes de dormir',
    description: 'Experimente 15 minutos sem telas antes de se preparar para dormir, em duas noites.',
    reason: `Você dormiu em média ${sleep} por noite.`,
    action: 'Montar rotina noturna',
    prompt: 'Monte uma rotina noturna para mim.',
    reply: `Marina, você dormiu em média ${sleep} por noite nesta semana fictícia. Que tal testar em duas noites, na segunda e na quarta?

• Às 22h45, ative o modo silencioso e deixe o celular carregando longe da cama.
• Use os próximos 15 minutos para ler algo leve ou preparar o dia seguinte.
• Na manhã seguinte, anote como você acordou. Se o horário ficar apertado, comece com 5 minutos.`,
  },
  movement: {
    icon: 'walk',
    category: 'Movimento',
    title: 'Caminhe 10 minutos',
    description: 'Aproveite a pausa após o almoço nos dias de trabalho em casa para dar uma volta.',
    reason: `Sua média foi de ${steps} passos por dia.`,
    action: 'Planejar caminhadas',
    prompt: 'Em quais dias posso encaixar uma caminhada?',
    reply: `Marina, sua média ficou em ${steps} passos por dia. Segunda, quarta e sexta são dias de trabalho em casa e você tem 10 minutos livres depois do almoço.

• Teste uma volta de 10 minutos depois do almoço na segunda e na quarta.
• Escolha um trajeto plano e um ritmo confortável.
• Na sexta, se as duas primeiras caminhadas tiverem cabido na agenda, repita. Se chover, vale andar em um espaço coberto.`,
  },
  energy: {
    icon: 'sun',
    category: 'Energia',
    title: 'Reserve 5 minutos de manhã',
    description: 'Faça uma pausa curta antes de abrir as mensagens ou sair para o escritório.',
    reason: `Sua energia média foi ${energy}, com ${lowestEnergy.energy}/5 na ${lowestEnergy.day.toLowerCase()}.`,
    action: 'Organizar minha manhã',
    prompt: 'Como posso começar a manhã com mais calma?',
    reply: `Marina, você registrou energia média de ${energy}, com ${lowestEnergy.energy}/5 na ${lowestEnergy.day.toLowerCase()}, um dia de escritório. Teste uma pausa de 5 minutos na próxima terça e quinta, antes do deslocamento.

• Beba um copo de água e passe um momento perto da janela.
• Anote uma prioridade para a manhã antes de olhar as mensagens.
• Registre sua energia no começo da tarde para observar como esses dias se comparam.`,
  },
};

export function demoReply(text, topic) {
  if (Object.hasOwn(suggestions, topic)) return suggestions[topic].reply;
  const query = text.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
  if (/\b(remedios?|medicamentos?|dosagem|superdosagem|comprimidos?|sintomas?|doencas?|diagnostic\w*|dor|dores|insonia|melatonina|tratamento|prescrev\w*|falta de ar|urgencia|emergencia)\b/.test(query)) {
    return 'Posso ajudar a organizar hábitos de bem-estar da Marina. Para sintomas, medicamentos ou decisões sobre tratamento, procure um profissional de saúde.';
  }
  if (/\b(sono|dorm\w*|noturn\w*|noite)\b/.test(query)) return suggestions.sleep.reply;
  if (/\b(caminh\w*|passos|movimento|exercicio)\b/.test(query)) return suggestions.movement.reply;
  if (/\b(energia|manha|acord\w*)\b/.test(query)) return suggestions.energy.reply;
  return 'Nesta demo, tenho exemplos sobre sono, movimento e energia. Use uma pergunta sugerida para ver como o perfil fictício da Marina muda o plano.';
}

export function buildMessages(history, text) {
  const context = [
    `Pessoa fictícia: ${person.name}, ${person.age} anos.`,
    ...person.facts.map(([label, value]) => `${label}: ${value}`),
    `Médias da semana fictícia: ${sleep} de sono, ${steps} passos/dia, energia autorrelatada ${energy}. ${lowestEnergy.day}: energia ${lowestEnergy.energy}/5.`,
  ];
  return [
    { role: 'system', content: [
      'Você é um assistente de bem-estar em uma demonstração. Responda em português brasileiro, em texto simples, com passos breves e viáveis. Fundamente sugestões em fatos do perfil fictício e deixe claro quando algo é apenas uma sugestão.',
      'Limite-se a hábitos gerais de sono, movimento e organização do dia. Não diagnostique, não indique tratamentos, medicamentos, suplementos ou doses e não interprete sintomas. Para questões clínicas, oriente a buscar um profissional. Em emergência, oriente a procurar o serviço de urgência local.',
      'Se o usuário trouxer dados pessoais de saúde, peça que volte ao caso fictício. Não invente medições ou fatos sobre Marina.',
      ...context,
    ].join('\n') },
    ...history.slice(-12),
    { role: 'user', content: text },
  ];
}
