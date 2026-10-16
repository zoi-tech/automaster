# Sessão de fundo

Este arquivo reúne o contrato do processo de fundo e as provas ao vivo que o sustentam.

## Contrato do socket

Para outros projetos da máquina (decisão A45). O perfil `~/.automaster/chrome-profile` é só do
processo de fundo: projeto que precisa de token pede pelo socket; projeto que precisa de tela
usa perfil e login próprios.

- **Onde:** socket Unix `~/.automaster/sessao/sock` (pasta `0700`, socket `0600`), HTTP com JSON.
- **Se não responder, suba:** `npm --prefix <repo>/extractor run sessao -- --acao subir --json`.
- **`POST /tokens {"subconta": "<locationId>"}`** → `200 {"bearer", "tokenId", "cookies":
  {"<host>": "<cabeçalho cookie>"}, "userAgent"}`. Mande `authorization: Bearer <bearer>`,
  `token-id: <tokenId>`, `channel: APP`, `source: WEB_USER`, `version: 2021-07-28`, o cookie do
  host e o `userAgent` (UA que não é de browser leva 403).
- **`POST /renovar {"subconta", "bearer", "tokenId"}`**, com o par que levou `401` → par novo
  (ou o atual, se outro pedido já renovou).
- **`GET /versao`** → `{"versao", "pid", "perfil", "esperandoLogin"}`.
- **`POST /encerrar`** → fecha o Chrome e sai.
- **Erros:** `503 {"code": "login_pendente" | "sessao_indisponivel", "message"}`; `400` para
  pedido sem `subconta`. `login_pendente`: alguém precisa entrar na janela do Chrome que abriu.
- **Prazo:** o pedido de tokens pode levar até uns 5 min quando o GHL pede login (janela
  aberta). Use timeout de pelo menos 330 s e não repita o pedido por tempo esgotado: cada
  repetição abriria outra espera de login.
- **Regras:** nunca gravar os tokens em disco (a sessão do GHL, cookies e localStorage do GHL, vai para `~/.automaster/sessao/estado-ghl.json` com 0600); nunca abrir `~/.automaster/chrome-profile` em
  outro Chrome; o processo morre após 4 h sem pedido e sobe de novo no próximo.
- **Exemplo:**
  `curl -s --unix-socket ~/.automaster/sessao/sock -X POST -H 'content-type: application/json' -d '{"subconta":"<locationId>"}' http://fundo/tokens`

## Arquivos

- `~/.automaster/sessao/fundo.log`: log do processo de fundo, sem tokens.
- `~/.automaster/sessao/logins.jsonl`: cada pedido de login, com `via` e `motivo`.
- `~/.automaster/sessao/escrita.lock`: fila de escrita da máquina (espera até 2 min).
- `~/.automaster/chrome.lock`: trava do perfil, com o pid e o rótulo `fundo` ou `discover`.

## Prova A19 — cliente sobre fetch

Subconta de teste Instaltech (`Xb9gDxwxYhdqtprGcb5E`). O contato de teste antigo
(`uWqujqll20tRuglV3mLt`) não existe mais: o GHL devolve `400 Contact not found`, e com ele
os dois clientes falhavam nas mesmas 3 checagens do smoke (`contato/detalhe`,
`conversas/busca`, `anotacoes/notas`), 20 ok. As escritas e os smokes abaixo usaram o
contato `ZlkU3kiMDr0xiIGLiMC5` (ZZ TESTE AUTOMASTER, criado por uma submissão de teste de
formulário). Ele não tinha conversa, e o upload exige uma: a conversa
`iaz7QbRDLz2al30jCjAA` foi criada por uma nota interna (`InternalComment`, não chega ao
contato), recebeu o anexo e foi apagada em seguida.

- Data: 2026-10-09
- Tempo de `tags` antes (Chrome visível, cliente antigo): 4,60 s
- Smoke com o cliente antigo: 23 ok, 0 falhou, 0 pulado
- Smoke com fetch: 23 ok, 0 falhou, 0 pulado
- Checagens que falharam só com fetch: nenhuma
- Extração completa com fetch (download sem auth do Firebase): 80 workflows, 0 falhas
- Escrita JSON (criar tag e criar nota): ok
- DELETE com corpo (remover tag do contato e repor): ok
- DELETE sem corpo (apagar tag e apagar nota): ok
- Multipart (anexo): ok
- Cabeçalhos além dos de hoje: nenhum
- Resíduo: anexo https://app.aceleradorazoi.com.br/conversations-assets/location/Xb9gDxwxYhdqtprGcb5E/conversations/iaz7QbRDLz2al30jCjAA/284c0f0d-c79b-48cf-9832-06e18e6a719e.png no armazenamento do CRM; a tag `teste-a19-fetch` e a nota foram apagadas, a conversa criada para o anexo foi apagada e a tag `teste-automaster` do contato voltou ao estado de antes

## Prova ao vivo do Chrome de fundo

Prova pelo comando `sessao`, na Instaltech (`Xb9gDxwxYhdqtprGcb5E`), com o Chrome do sistema,
um comando de cada vez. Nenhuma escrita na API do GHL.

- Data: 2026-10-09
- Captura invisível no perfil real (sessao --acao tokens, partida fria): 4,20 s
- Chrome do perfil com --headless: sim
- Chrome invisível registrado como app no macOS (System Events): 0
- Pedidos do Chrome invisível sem Headless (user-agent e sec-ch-ua): ok
- Perfil aberto por outro Chrome vira erro com pid: ok
- Login com janela e volta ao invisível: ok
- SIGTERM fecha limpo (exit_type Normal, trava e socket removidos): ok
- Chrome morto com o processo de fundo vivo: o pedido seguinte reabre: ok
- kill -9 no processo de fundo: o pedido seguinte sai ok: ok

No passo 9 o Chrome não sobreviveu ao kill -9: 10 s depois não havia Chrome no perfil (só a
trava e o socket velhos), e o `renovar` seguinte subiu um processo de fundo novo e deu `ok` em
6,2 s, com um único Chrome principal no perfil.

Notas da prova:
- O System Events conta o Chrome invisível como processo (`BackgroundOnly`); o instrumento só
  separa janela de invisível com `background only is false` (janela de login: 1; invisível: 0).
- O SIGTERM deixava o perfil com `exit_type` `Crashed` por dois defeitos, ambos corrigidos: os
  tratadores de sinal do Playwright (`handleSIGTERM`/`SIGINT`/`SIGHUP`) matavam o Chrome em
  paralelo ao fechamento, deixando também o `SingletonLock` órfão; e fechar o contexto direto
  perpetuava `Crashed` num perfil que já tinha saído assim — fechar as páginas antes do contexto
  sai `Normal`. Este segundo defeito também existe no caminho antigo de hoje. Depois das
  correções: SIGTERM limpo em 0,3 s (Chrome fechado em 91 ms), `exit_type` `Normal`, sem
  `SingletonLock`.
- O `encerrar` passou de 20 s duas vezes logo após uma captura (Chrome fechado em 24,3 s na
  segunda); o processo saiu sozinho e limpo, mas o comando respondeu `sessao_indisponivel`.
- No passo 9 o `wc -l` do plano deu 7 porque `MacOS/Google Chrome ` também casa com os helpers;
  processo principal do Chrome no perfil, só um.

## Prova ao vivo dos comandos pelo processo de fundo

- Data: 2026-10-10
- Primeira chamada (sobe o processo de fundo): 7,36 s
- Chamadas seguintes (mediana de 3): 1,73 s
- Chrome invisível registrado como app no macOS durante os comandos (System Events): 0
- Duas leituras ao mesmo tempo: ok
- Escrita descartável pelo processo de fundo (tag criada e apagada, tag do contato removida e reposta, nota): ok, desfeita
- Smoke depois: 23 ok, 0 falhou, 0 pulado
- Checagens que falharam só depois da troca: nenhuma
- Discover encerra o processo de fundo e os comandos falham na hora: ok
- Renovação pelo exp depois de 61 min parado: ok
- Resíduo: nenhum

Contato usado: `ZlkU3kiMDr0xiIGLiMC5`, o mesmo da prova A19 (o antigo não existe mais). Antes da
troca, cada `tags` levava 4,60 s com o Chrome visível; agora leva 1,73 s com o processo de fundo
de pé.

Com o discover aberto, `tags` respondeu `sessao_indisponivel` em 0,61 s citando o pid do
discover. A janela foi fechada com SIGTERM no processo principal do Chrome (o usuário não a
encontrou na tela); o perfil saiu `SessionEnded`, não `Crashed`, e o comando seguinte voltou a
dar `ok`. O discover termina com a mensagem `browserContext.close: Target page, context or
browser has been closed` quando o Chrome sai inteiro: inofensivo, e anterior a esta mudança.

Renovação: `tags` às 11:18:33 UTC, espera até 12:20:13, `tags` de novo com `ok` e
`motivo=vencido` no `fundo.log` às 12:20:14. Durante a espera, sessões de outros projetos
pediram tokens de outras subcontas e foram servidas do cache, sem navegação.

## Prova final pelo MCP

- Data: 2026-10-10
- Plugin em uso (CLAUDE_PLUGIN_ROOT dos servidores MCP): /Users/luccassilveira/Desktop/ZOI/Projetos_ZOI/automaster_v2 (6 servidores, todos desta pasta)
- Primeira chamada pelo caminho do MCP (_run_extractor), subindo o processo de fundo: 6,67 s
- Processo de fundo vivo depois do fim do Python: sim
- Tool chamada numa sessão do Claude Code: ok
- Duas tools ao mesmo tempo, em dois processos pelo caminho do MCP (sobreposição medida): ok
- Chrome invisível registrado como app no macOS: 0
- Tempo de `tags` depois (mediana de 3): 1,77 s

As duas tools em paralelo (`tags` e `oportunidades -o pipelines`) terminaram em 1,54 s e 1,49 s,
com os intervalos sobrepostos. A tool `tags` foi chamada nesta sessão depois de reconectar o
servidor `automaster` pelo `/mcp`.

## Semana de medição de logins

- Início: 2026-10-10
- Como conferir: ao fim de sete dias de uso normal, rode `grep -F '"via":"fundo"' ~/.automaster/sessao/logins.jsonl | grep -F '"motivo":"redirecionamento"'` e fique com as linhas cujo `perfil` é o `~/.automaster/chrome-profile` expandido (as de `/tmp/...` são dos testes). Cada uma é uma queda: veja `origem`, `navegouAntes` e `ultimaNavegacao`. Linhas com `"motivo":"sem_tokens"` vão à parte e não contam como queda; as com `"via":"withClient"` são a linha de base do caminho antigo. Para cruzar com telas de login abertas fora do processo de fundo: `cp ~/.automaster/chrome-profile/Default/History /tmp/h.db && sqlite3 /tmp/h.db "select datetime(last_visit_time/1000000-11644473600,'unixepoch'), url from urls where url like 'https://app.gohighlevel.com/?url=%' order by last_visit_time desc limit 30" && rm /tmp/h.db`. `grep -c "motivo=" ~/.automaster/sessao/fundo.log` dá quantas capturas o processo fez e `grep "encerrando" ~/.automaster/sessao/fundo.log` mostra cada encerramento e o motivo. Aprovado se nenhuma queda tiver sido causada por ação do automaster; queda do lado do GHL é anotada e não reprova.
- Resultado: em andamento

## Perfil de tela

`npm run dashboard-ver` fotografa painéis do GHL num perfil só dele, em `~/.automaster/perfil-tela/` (raiz trocável por `AUTOMASTER_PERFIL_TELA`), com trava própria em `~/.automaster/perfil-tela.lock`. Antes de carregar a página, o comando copia para esse perfil a sessão salva em `sessao/estado-ghl.json` (cookies e localStorage do GHL, a mesma que o Playwright MCP importa), então não pede login; provado ao vivo em 2026-10-16, com o processo de fundo logado antes e depois. Nunca toca em `chrome-profile`, que é do processo de fundo. Sem o arquivo, vale o login próprio, feito uma vez com `npm run dashboard-ver -- --login` (abre a raiz do app: o `/login` do GHL fica em branco). Carregar o painel grava preferência de widget, então o comando espera a vez na mesma fila de escrita dos outros.
