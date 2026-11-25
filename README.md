# UltraPersona Saúde

Demo em HTML, CSS e JavaScript de um assistente de bem-estar personalizado. Marina Costa é uma personagem fictícia com sete dias de dados simulados de sono, passos e energia. O painel transforma esses dados em três sugestões iniciais e o chat oferece exemplos para explorar cada uma.

## Rodar a demo

Na pasta do projeto, execute `python3 -m http.server 8000` e abra `http://localhost:8000`. O modo demo roda no navegador sem chave. Para usar a geração ao vivo, clique em **Conectar IA** e informe uma chave da Coarena. A chave vale apenas para a sessão. No modo ao vivo, a Coarena recebe o perfil fictício e as mensagens enviadas. Use apenas dados de exemplo.

Os testes da lógica da demo e do leitor da API rodam com `node --test`.
