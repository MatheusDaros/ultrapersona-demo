# UltraPersona Saúde

Demo em HTML, CSS e JavaScript de um assistente de bem-estar personalizado. Marina Costa é uma personagem fictícia com sete dias de dados simulados de sono, passos e energia. O painel transforma esses dados em três sugestões iniciais e o chat oferece exemplos para explorar cada uma.

## Rodar a demo

Na pasta do projeto, execute `python3 -m http.server 8000` e abra `http://localhost:8000`. O modo demo roda no navegador sem chave. Para usar a geração ao vivo, clique em **Conectar IA** e informe uma chave da Coarena. A chave vale apenas para a sessão. No modo ao vivo, a Coarena recebe o perfil fictício e as mensagens enviadas. Use apenas dados de exemplo.

Os testes da lógica da demo e do leitor da API rodam com `node --test`.

## Publicar a versão de evento

O Vercel executa `npm run build` e serve o conteúdo de `dist/`. Configure `COARENA_API_KEY` como variável secreta no ambiente de produção do projeto. O backend envia perguntas livres e até três trocas recentes à Coarena. O chat usa o perfil fictício da Marina quando ele for relevante. As três sugestões iniciais podem usar respostas em cache por uma hora. Em caso de falha, o chat identifica os exemplos locais disponíveis. Use apenas dados de exemplo.

Após publicar, execute `npm run smoke:event -- https://ultrapersona-saude.vercel.app`. O comando verifica a página pública, a configuração do modo evento, uma resposta da Coarena em tempo real para uma pergunta geral e a disponibilidade das três sugestões. A verificação faz uma chamada de chat à Coarena e pode gerar mais uma por sugestão com cache vazio.
