# UltraPersona Saúde

Demo em HTML, CSS e JavaScript de um assistente de bem-estar personalizado. Marina Costa é uma personagem fictícia com sete dias de dados simulados de sono, passos e energia. O painel transforma esses dados em três sugestões iniciais e o chat oferece exemplos para explorar cada uma.

## Rodar a demo

Na pasta do projeto, execute `python3 -m http.server 8000` e abra `http://localhost:8000`. O modo demo roda no navegador sem chave. Para usar a geração ao vivo, clique em **Conectar IA** e informe uma chave da Coarena. A chave vale apenas para a sessão. No modo ao vivo, a Coarena recebe o perfil fictício e as mensagens enviadas. Use apenas dados de exemplo.

Os testes da lógica da demo e do leitor da API rodam com `node --test`.

## Publicar a versão de evento

O Vercel executa `npm run build` e serve o conteúdo de `dist/`. Configure `COARENA_API_KEY` como variável secreta no ambiente de produção do projeto. A função `/api/event-reply` gera respostas para os três temas fictícios com cache de uma hora. Perguntas fora desses exemplos e falhas da IA usam respostas locais identificadas na conversa. A chave e as mensagens digitadas no navegador ficam fora das requisições do navegador para a Coarena.

Após publicar, execute `npm run smoke:event -- https://ultrapersona-saude.vercel.app`. O comando verifica se a página e a configuração do modo evento estão públicas e se a função retorna uma resposta para cada tema. A verificação falha se a função estiver indisponível, mesmo quando o navegador ainda consegue mostrar o exemplo local. Com cache vazio, o teste pode gerar uma chamada à Coarena por tema.
