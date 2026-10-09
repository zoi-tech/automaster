# Pesquisa — sessão de fundo

Spec: `docs/vesta/specs/2026-10-09-sessao-de-fundo-design.md`

## Achados

### A1 — Os cookies de login do GHL no perfil são persistentes e valem 1 ano, e o perfil fecha com saída normal, então um fecha-e-abre limpo não descarta o login
- Fonte: `~/.automaster/chrome-profile/Default/Cookies` (sqlite: `a`, `access-token-v1/v2`, `refresh-token-v1/v2` e `custom-firebase-token` em `.app.gohighlevel.com` com `is_persistent=1`, vencendo em 2027-10-09; nenhum cookie de sessão em host gohighlevel/leadconnector); `~/.automaster/chrome-profile/Default/Preferences` (`profile.exit_type=Normal`); https://chromium.googlesource.com/chromium/src/+/HEAD/net/extras/sqlite/sqlite_persistent_cookie_store.cc linhas 1479-1481 (`DeleteSessionCookiesOnStartup` só apaga `is_persistent != 1`); https://github.com/microsoft/playwright/issues/36139; `docs/vesta/specs/2026-10-09-sessao-de-fundo-design.md:26-27`
- Contradiz a spec: parcial
- Pergunta que levanta: A suspeita de que abrir e fechar o Chrome apaga o login não vale para o fechamento normal: o GHL guarda o login num cookie de 1 ano. Se o processo de fundo for construído só por causa disso, os pedidos de login podem continuar. Topa uma etapa curta de medição antes (registrar quando e por que o GHL pede login)? Atrasa a entrega, mas evita construir semanas em cima de uma causa errada.

### A2 — O login hoje dura de algumas horas a cerca de 4 dias, com 22 a 26 quedas desde 21/09, e não várias quedas por dia com comandos próximos
- Fonte: `~/.automaster/chrome-profile/Default/History` (redirecionamentos para `https://app.gohighlevel.com/?url=...`; login em 02/10 ~13:35 local, queda em 06/10 10:36; em 09/10 quedas às 16:58, 17:10 e 19:30 UTC sem login entre elas); `docs/vesta/specs/2026-10-09-sessao-de-fundo-design.md:10,20`
- Contradiz a spec: parcial
- Pergunta que levanta: Se, mesmo com o processo de fundo, o GHL continuar derrubando a sessão a cada 1 a 4 dias, isso já conta como sucesso? Ou "durar semanas" é inegociável, mesmo dependendo de algo do lado do GHL que não controlamos?

### A3 — Todo o cookie jar do perfil (22 cookies, inclusive os do Google) foi recriado hoje às 19:30:49 UTC (16:30 BRT), mas o arquivo Cookies existe desde 10/06: o perfil não foi recriado, o conteúdo sumiu
- Fonte: `~/.automaster/chrome-profile/Default/Cookies` (`count=22`, `min(creation)=2026-10-09 19:30:49`, todos com prefixo `v10`; `g_state` às 19:30:58 seguido dos cookies do Google às 19:30:59, sequência de login novo pelo Google); `stat` de `chrome-profile`, `Default` e `Default/Cookies` (criados em 10/06/2026)
- Contradiz a spec: parcial
- Pergunta que levanta: Hoje às 16:30 você logou do zero, com o Google, ou limpou cookies? Se você não fez nada e todos os cookies sumiram, o que apagou foi algo nesta máquina, e o processo de fundo ajuda. Se foi você, essa pista não serve.

### A4 — No perfil do automaster, o "Entrar com Google" termina recusado pelo Google repetidas vezes (cerca de 10 desde 21/09, mais 3 em 30/07)
- Fonte: `~/.automaster/chrome-profile/Default/History` (`accounts.google.com/v3/signin/rejected?app_domain=https://app.gohighlevel.com` em 21/09, 22/09, 28/09, 02/10, 07/10 e 09/10); `extractor/node_modules/playwright-core/lib/coreBundle.js:33651-33652`; https://support.google.com/accounts/answer/7675428; `docs/vesta/specs/2026-10-09-sessao-de-fundo-design.md:54-57`
- Contradiz a spec: parcial
- Pergunta que levanta: Quando o GHL pedir login, a janela que abre é de um Chrome automatizado, e nele o "Entrar com Google" costuma ser recusado. Você topa logar sempre por e-mail e senha (ou passkey) nessa janela? Ou prefere logar num Chrome comum, com um passo manual a mais para levar a sessão ao automaster?

### A5 — O perfil navegou para o domínio white-label `app.zoitech.com.br` (22/09, 08/10, 09/10), onde nunca está logado, e toda visita caiu na tela de login; o código só usa `app.gohighlevel.com`
- Fonte: `~/.automaster/chrome-profile/Default/History` (09/10 19:33:28 UTC `app.zoitech.com.br/v2/location/citQs4acsN1StzOEDuvj/conversations/...` seguido de `app.zoitech.com.br/?url=...`; tentativas via `login.leadconnectorhq.com/google?origin=https://app.zoitech.com.br`); `~/.automaster/chrome-profile/Default/IndexedDB/https_app.zoitech.com.br_0.indexeddb.leveldb`; `extractor/src/auth/token.ts:40-41`; `extractor/src/cli/extract.ts:105`; `extractor/src/api/workflows-write.ts:12`; grep por `zoitech` em `extractor/src`, `auditor/src`, `skills`, `commands` sem resultado
- Contradiz a spec: parcial
- Pergunta que levanta: Parte dos "pediu login" veio de links do domínio da sua marca abertos na janela do automaster, onde ele nunca está logado. Você precisa que o automaster funcione nesse domínio, o que pede um segundo login? Ou basta o domínio padrão do GHL, sabendo que esses links não abrem logados por ele? (Com o Chrome invisível, esse caminho de clique some.)

### A6 — O GHL tem um "Session Timeout" de agência (15 min a 3 dias, ou "Never"); o padrão fora de HIPAA é "Never", e nenhuma página diz o que conta como inatividade
- Fonte: https://help.gohighlevel.com/support/solutions/articles/48000982604-agency-company-settings-in-highlevel ; https://ideas.gohighlevel.com/changelog/security-update-customisable-automatic-logout-after-extended-inactivity
- Contradiz a spec: parcial
- Pergunta que levanta: Em Agency Settings > Company da ZOI, quanto está o Session Timeout? Se alguém pôs em horas, nenhum Chrome de fundo garante o login que dura semanas, e o ganho vem de voltar para "Never" (custo: todo navegador logado na agência fica logado sem prazo).

### A7 — Já houve logout logo depois de abrir o app do GHL pelo Playwright no perfil persistente, sem mecanismo registrado; o desenho da spec recarrega o app pelo Playwright cerca de uma vez por hora
- Fonte: `CHANGELOG.md:306`; `skills/automaster-leitura/SKILL.md:229-233`; `~/.claude/projects/-Users-luccassilveira-Desktop-ZOI-Projetos-ZOI-automaster-v2/memory/MEMORY.md:271-272` ("Rodar Playwright contra o app derrubou a sessão do perfil persistente; o próximo comando pediu login de novo"); `extractor/src/cli/shared.ts:50`; `extractor/src/auth/token.ts:73`; `docs/vesta/specs/2026-10-09-sessao-de-fundo-design.md:26-28,61-62`
- Contradiz a spec: parcial
- Pergunta que levanta: Se a causa for a navegação pelo Playwright e não o fechamento, o processo de fundo, que recarrega o app de hora em hora o dia todo, custa semanas e você continua logando várias vezes por dia. Topa medir antes (contar logins com o Chrome sempre aberto contra o abre-e-fecha de hoje)?

### A8 — O Chrome grava cookies em lote a cada 30 s, os tokens do GHL rotacionam a cada carga do app, e o comando pode ser morto à força (exitHandler do Playwright com SIGKILL; timeout de 600 s do MCP)
- Fonte: https://chromium.googlesource.com/chromium/src/+/HEAD/net/extras/sqlite/sqlite_persistent_cookie_store.cc linhas 1237-1239 (`kCommitInterval = Seconds(30)`, `kCommitAfterBatchSize = 512`); `extractor/node_modules/playwright-core/lib/coreBundle.js:8560-8563,8700`; `auditor/src/automaster_audit/mcp/base.py:141-143`; `extractor/src/cli/shared.ts:55-57`; `~/.automaster/chrome-profile/Default/Cookies` (5 tokens com o mesmo `creation_utc`, regravados entre execuções)
- Contradiz a spec: parcial
- Pergunta que levanta: Quando uma tool estoura o tempo, o comando é morto à força; se o GHL tiver acabado de trocar o token, o perfil fica com o token velho e o próximo comando pede login. Com o processo de fundo esse risco quase some, mas volta quando o Mac desliga ou o processo cai. Aceita esse resto?

### A9 — O Playwright sempre passa `--use-mock-keychain` e `--password-store=basic`, com ou sem janela, então a chave dos cookies é a mesma nos dois modos; um Chrome aberto sem esses switches usaria outra chave
- Fonte: `extractor/node_modules/playwright-core/lib/coreBundle.js:33651-33652,41671-41674`; `extractor/src/auth/session.ts:25-28`; https://chromium.googlesource.com/chromium/src/+/08fbce0a25be93e3ccef86182a5a7e8f08f4be2f/components/os_crypt/os_crypt_mac.mm linhas 58-64; `docs/vesta/specs/2026-10-09-sessao-de-fundo-design.md:27-28`
- Contradiz a spec: parcial
- Pergunta que levanta: Alternar entre invisível e com janela no mesmo perfil é seguro enquanto quem abre for sempre o Playwright com o Chrome instalado. O perfil do automaster nunca pode ser aberto à mão num Chrome normal, nem trocado para o Chromium do Playwright. Topa travar isso no código?

### A10 — Não há sinal de outro Chrome usando o perfil (sem `os_crypt`, 20/20 cookies `v10`, `navegador-login` usa outro perfil), mas o próprio Chrome do perfil tem uma conta Google logada desde 28/09
- Fonte: `~/.automaster/chrome-profile/Local State` (`os_crypt` ausente); `~/.automaster/chrome-profile/Default/Preferences` (`signin.*`, `signin_with_explicit_browser_signin_on=True`); `~/.automaster/chrome-profile/Default/History` (2026-09-28 15:32 `accounts.google.com/signin/chrome/sync`); `~/.local/bin/navegador-login:6`; `~/.automaster/chrome-profile/Last Version` (154.0.8037.98)
- Contradiz a spec: parcial
- Pergunta que levanta: Prefere manter a conta Google logada no Chrome do automaster, o que pode facilitar algum login, ou zerar para um perfil só do GHL? Zerar pede um login novo agora, mas tira uma variável enquanto investigamos as quedas.

### A11 — Chrome sem janela funciona com o perfil atual: capturou os dois tokens em 3,5 s, 3,7 s e 4,8 s, sem passar pela tela de login; nenhum documento registrava essa prova antes
- Fonte: sonda local `launchPersistentContext(perfil, {headless:true, channel:'chrome'})` em 2026-10-09 20:02, 20:03 e 20:34 UTC (script descartável, apagado), contra `extractor/src/auth/session.ts:25-28` e `extractor/src/auth/token.ts:52-95`; grep `headless` em `CLAUDE.md`, `CHANGELOG.md`, `docs/*.md`, `skills/`, `commands/` sem resultado; `hooks/scripts/check-setup.sh:1-11` (o SessionStart não toca Chrome)
- Contradiz a spec: não
- Pergunta que levanta: O Chrome invisível entra no GHL com o login salvo em uns 4 s. Aceita que a primeira tool do dia demore isso e as seguintes saiam na hora? Ou quer pré-aquecer, subindo o Chrome invisível ao abrir o Claude (custo: um Chrome no fundo, ou uma janela de login surgindo, mesmo sem usar o automaster)? A prova cobre minutos, não horas: quanto a sessão aguenta sem janela entra na medição de A1.

### A12 — Sem janela, o Chrome se anuncia como `HeadlessChrome/154` com `navigator.webdriver=true`, e os domínios do GHL carregam o cookie de bot score do Cloudflare (`__cf_bm`)
- Fonte: teste local `chromium.launch({channel:'chrome', headless:true})` → UA `...HeadlessChrome/154.0.0.0 Safari/537.36`, `webdriver=true`; `~/.automaster/chrome-profile/Default/Cookies` (`__cf_bm` em `.gohighlevel.com`, `.leadconnectorhq.com`, `.msgsndr.com`); https://developers.cloudflare.com/fundamentals/reference/policies-compliances/cloudflare-cookies/
- Contradiz a spec: parcial
- Pergunta que levanta: Se o Chrome invisível se anunciar como robô, o Cloudflare ou o GHL podem derrubar o login, que é justamente o problema a resolver. Topa forçar no Chrome invisível o mesmo user-agent de navegador que o `GhlClient` já usa, sabendo que isso não esconde o `webdriver`? (Não há prova de bloqueio: as cargas sem janela de hoje funcionaram.)

### A13 — Os dois tokens trazem `exp` de 60 min e vencem praticamente juntos: o token-id é refeito pelo `signInWithCustomToken` a partir do cookie `custom-firebase-token`, renovado junto com o bearer
- Fonte: `docs/endpoints.md:10-13,19,365`; `extractor/src/auth/token.ts:9-17`; claims decodificadas pela sonda (bearer RS256 com `authClass`, `source=WEB_USER`, `exp`; token-id com `iss=https://securetoken.google.com/highlevel-backend`, `exp`); `~/.automaster/chrome-profile/Default/IndexedDB/https_app.gohighlevel.com_0.indexeddb.leveldb` (`firebase:authUser`, `lastLoginAt` muda a cada comando); `docs/vesta/specs/2026-10-09-sessao-de-fundo-design.md:30,63-64,84-85`
- Contradiz a spec: parcial
- Pergunta que levanta: Os dois tokens vencem juntos a cada hora e um único refresh renova os dois. Aceita o contrato mais simples ("o token que eu tinha não serve, me dá outro") em vez de `renovar(tokenQueFalhou)`, abrindo mão de saber qual dos dois falhou?

### A14 — O bearer é do usuário (sem claim de subconta), mas o token-id leva uma foto da lista `locations[]` tirada na emissão, e `captureTokens` exige um `locationId` para navegar; o contrato `tokens` da spec não recebe subconta
- Fonte: `docs/endpoints.md:13`; `extractor/src/auth/token.ts:19-23,40-41,47-49,52,73-83`; `extractor/src/cli/shared.ts:47,51`; `~/.claude/projects/-Users-luccassilveira-Desktop-ZOI-Projetos-ZOI-automaster-v2/memory/MEMORY.md:237-239` (401 repetido numa subconta, "a sessão parece não ter mais acesso"); `docs/vesta/specs/2026-10-09-sessao-de-fundo-design.md:29,83`
- Contradiz a spec: parcial
- Pergunta que levanta: O processo de fundo precisa abrir alguma tela do GHL para pegar os tokens, e uma subconta concedida no meio do dia só entra no token seguinte. Prefere uma subconta padrão fixa, a do primeiro comando, ou só o painel sem subconta (provável, não medido)? E para subconta fora do token: erro claro na hora ("seu login não vê esta subconta") ou renovar e tentar?

### A15 — Recarregar a página antes do vencimento não troca o bearer: a troca só apareceu na carga depois de vencer, e o Firebase só renova de forma preguiçosa (30 s antes) se o app fizer uma chamada
- Fonte: `~/.automaster/chrome-profile/Default/Cookies` (`access-token-v2` com `iat` 20:34:06 e `exp` 21:34:06 UTC; `access-token-v2` e `refresh-token-v2` recriados só na carga de 20:34); `~/.automaster/chrome-profile/Default/History` (cargas da sonda 20:02, 20:03, 20:34 UTC); https://github.com/firebase/firebase-js-sdk/blob/main/packages/auth/src/core/user/token_manager.ts (`TOKEN_REFRESH = 30_000`); https://github.com/firebase/firebase-js-sdk/blob/main/packages/auth/src/core/user/proactive_refresh.ts (renovação proativa só com listener); `docs/vesta/specs/2026-10-09-sessao-de-fundo-design.md:61-62`
- Contradiz a spec: sim
- Pergunta que levanta: O token do GHL vence a cada hora, e recarregar antes disso não parece trocá-lo (o bearer idêntico entre 20:02 e 20:03 veio de um log da sonda que não ficou em disco). Aceita que, uma vez por hora, um comando leve um 401 e se recupere sozinho em alguns segundos? A alternativa é chamar a rota interna de renovação do GHL (`/oauth/2/login/signin/refresh`): some o tropeço, mas entra mais uma rota não documentada que muda sem aviso.

### A16 — O refresh token do GHL vale 30 dias e é trocado a cada renovação
- Fonte: `~/.automaster/chrome-profile/Default/Cookies` (`refresh-token-v2` com `iat` 2026-10-09T20:34:06 e `exp` 2026-11-08T20:34:06, claims `uniqueId` e `v`); `auditor/src/automaster_audit/mcp/base.py:142-143`
- Contradiz a spec: não
- Pergunta que levanta: "Durar semanas" é possível em tese (30 dias). Mas se o processo de fundo for morto exatamente durante a troca da chave (Mac desligado à força, kill manual), o login pode se perder (não provado que o GHL recuse o refresh antigo). Esse risco raro é aceitável, ou prefere que o processo só encerre de forma ordenada, mesmo saindo mais devagar?

### A17 — Há caminho medido para renovar o token-id sem navegador (refresh token do Firebase no IndexedDB + `securetoken.googleapis.com`), mas nenhum para o bearer
- Fonte: `~/.claude/memory/tools/ghl.md:216-221`; https://firebase.google.com/docs/auth/admin/manage-sessions ; https://firebase.google.com/docs/auth/web/auth-state-persistence ; `~/.automaster/chrome-profile/Default/IndexedDB/https_client-app-automation-workflows.leadconnectorhq.com_0.indexeddb.leveldb` (`firebaseLocalStorageDb`, `stsTokenManager`)
- Contradiz a spec: não
- Pergunta que levanta: Existe um atalho que renova metade da sessão sem Chrome, mas não cobre o bearer e mexe num segredo de admin da agência. Vale investigar, ou fica a solução da spec, que renova os dois de uma vez?

### A18 — O processo de fundo morre após 30 min sem uso, o que reabre o Chrome do perfil (com menos frequência), o mesmo evento que a spec aponta como causa provável dos logins
- Fonte: `docs/vesta/specs/2026-10-09-sessao-de-fundo-design.md:20,26-28,48`; https://tip.golang.org/gopls/daemon (gopls `-remote=auto` encerra após 1 min sem clientes)
- Contradiz a spec: parcial
- Pergunta que levanta: Se fechar o Chrome for mesmo o que desloga, o processo que morre após 30 min parado ainda vai pedir login depois do almoço. Prefere mantê-lo vivo o dia inteiro (ex.: 8 h), gastando memória, ou aceitar esse risco até medir?

### A19 — `context.request` manda os cookies do perfil em toda chamada e grava os `Set-Cookie` de volta; o `fetch` do Node não tem cookie jar, e nunca se provou que alguma rota (sobretudo escrita e multipart) funciona sem esses cookies
- Fonte: `extractor/src/api/client.ts:45-55,64,98,117`; `extractor/node_modules/playwright-core/lib/coreBundle.js:25733,25924-25925,25990-25997,26187-26215`; https://playwright.dev/docs/api/class-apirequestcontext ; `docs/endpoints.md:1-4,15-17,398-402`; `~/.claude/memory/tools/ghl.md:213-215` (host `services` funcionou sem cookie, com `referer` de navegador); `docs/vesta/specs/2026-10-09-sessao-de-fundo-design.md:40-42`
- Contradiz a spec: parcial
- Pergunta que levanta: A requisição já sai do Node hoje (o WAF já aceita isso), mas os cookies do navegador deixam de ir junto. Se alguma rota depender deles, quebra para todos os comandos de uma vez e sem aviso para o cliente. Topa rodar o smoke e uma escrita descartável de cada tipo, incluindo um anexo, com fetch antes de largar o cliente antigo, mandando também `referer` de navegador? E o UA fixo `Chrome/148`, que envelhece, continua ou passa a ser o do Chrome de fundo?

### A20 — Anexo e download sem auth migram para fetch sem adaptação de formato, com três cuidados: `JSON.stringify` explícito, DELETE com corpo e nenhum header de auth no Firebase
- Fonte: `extractor/src/api/conversations.ts:234-246` (`FormData`/`Blob` nativos); `extractor/src/api/client.ts:58-64,86-99,115-120`; `extractor/src/api/contacts.ts:26` (DELETE com corpo); `extractor/src/api/workflows.ts:62-65`; `extractor/src/api/forms-write.ts:74-76`; `CLAUDE.md:115`; `docs/endpoints.md:24`
- Contradiz a spec: não
- Pergunta que levanta: Anexo de conversa e remoção de tag do contato são os pontos da troca que mexem em produção sem desfazer. Topa validá-los ao vivo no contato de teste antes de liberar, e um teste que falhe se o download do Firebase sair com header de auth (para o token do GHL nunca ir ao Google)?

### A21 — O MCP chama o extractor com `subprocess.run(capture_output=True, timeout=600)`, que espera o fim dos pipes; um processo de fundo que herde esses pipes prende a tool até estourar, com a mensagem falsa de "login manual pendente... a escrita PODE ter sido aplicada"
- Fonte: `auditor/src/automaster_audit/mcp/base.py:123-143,144-159`; https://nodejs.org/api/child_process.html#optionsdetached ; https://docs.python.org/3/library/subprocess.html ; `auditor/tests/test_mcp_tools.py:15-78` (substitui `subprocess.run` por falso, não pegaria isso); `docs/vesta/specs/2026-10-09-sessao-de-fundo-design.md:46-47`
- Contradiz a spec: parcial
- Pergunta que levanta: Se o processo de fundo nascer preso à saída do MCP, a primeira tool do dia fica 10 minutos pendurada e termina com falso alarme de escrita parcial. Aceita como critério de aceite que a primeira tool, a que sobe o processo, chamada pelo MCP (não só pelo terminal), responda no tempo normal? (Solução: `detached`, `stdio` ignorado ou em log, `unref()`.)

### A22 — Throttle de 200 ms e backoff de 429 vivem em cada `GhlClient`, um por processo; hoje a trava global faz deles o limite da máquina, e com paralelo a taxa contra o GHL dobra sem coordenação
- Fonte: `extractor/src/api/client.ts:23,59,73-76`; `~/.claude/memory/tools/ghl.md:222` ("concorrência derruba tudo em 403" nas rotas blade-platform); `docs/endpoints.md:363`; `docs/vesta/specs/2026-10-09-sessao-de-fundo-design.md:94`
- Contradiz a spec: parcial
- Pergunta que levanta: Uma extração completa rodando junto com outra tool pode levar 429 ou 403 nas duas. Aceita esse risco com o backoff que já existe, ou quer que o processo de fundo também distribua a vez de chamar?

### A23 — Os tokens passam a circular por um socket local legível por qualquer processo do usuário; e o login completo já está em disco no perfil (cookies de 1 ano, refresh tokens no IndexedDB), então "tokens nunca em disco" só vale para o que o automaster escreve
- Fonte: `CLAUDE.md:18`; `extractor/src/auth/session.ts:13-16`; `~/.automaster/chrome-profile/Default/Cookies` (`refresh-token-v1/v2`, `access-token-v1/v2`, `custom-firebase-token`); `~/.automaster/chrome-profile/Default/IndexedDB/https_client-app-automation-workflows.leadconnectorhq.com_0.indexeddb.leveldb/000019.ldb` e `000018.log` (`refreshToken`, `stsTokenManager`); `~/.claude/memory/tools/ghl.md:219` (token-id é sessão de admin da agência); `docs/vesta/specs/2026-10-09-sessao-de-fundo-design.md:36-38`
- Contradiz a spec: parcial
- Pergunta que levanta: Qualquer programa rodando com o seu usuário poderá pedir a sessão de admin do GHL pelo socket, e quem copiar `~/.automaster/chrome-profile` já leva a conta da agência hoje. Aceita tratar a permissão da pasta como a proteção real, ou quer que o socket exija um segredo além da permissão de arquivo?

### A24 — A trava `travarChrome(arquivo)` serve tal como está para o processo de fundo ser único (caminho por parâmetro, roubo de trava órfã por PID, teste próprio), mas a mensagem fala em "escrita serial" e a soltura só ocorre em `process.once('exit')`
- Fonte: `extractor/src/auth/lock.ts:31-62`; `extractor/test/lock.test.ts:10-27`; `extractor/src/auth/session.ts:23`; sonda (trava pega e solta nas três execuções; `~/.automaster/chrome.lock` ausente antes e depois)
- Contradiz a spec: não
- Pergunta que levanta: O processo de fundo herda a trava existente. Topa que a mensagem passe a dizer "já há um processo de fundo (pid X)", para ninguém apagar o arquivo achando que é escrita travada? (SIGTERM/SIGINT não disparam `exit`: a morte por ociosidade precisa chamar `soltar()` explicitamente.)

### A25 — Socket Unix órfão persiste no disco e dá `EADDRINUSE`; o padrão aceito é travar, testar conexão, só então apagar e escutar; no macOS o caminho tem limite de 103 bytes, e PID gravado pode ser reaproveitado após reboot
- Fonte: https://nodejs.org/api/net.html#identifying-paths-for-ipc-connections ; https://listman.redhat.com/archives/virtio-fs/2022-May/004917.html ; https://github.com/nginx/unit/pull/649 ; https://www.npmjs.com/package/bsbd ; `extractor/src/auth/lock.ts:31-62`
- Contradiz a spec: não
- Pergunta que levanta: Se duas tools chegam juntas com o processo de fundo desligado, as duas tentam subi-lo. Proposta: quem pegar a trava vira o processo de fundo e o outro espera o socket responder. Está bom que o segundo espere alguns segundos em vez de falhar, como hoje?

### A26 — A trava garante um só processo de fundo, não um só dono do perfil: um Chrome de fora (com `--remote-debugging-port=9223`) já segurou o perfil e o erro foi o ilegível "Target page, context or browser has been closed" (item C5 aberto)
- Fonte: `docs/backlog-arquitetura.md:77-80`; `extractor/src/auth/lock.ts:31-49`; `docs/vesta/specs/2026-10-09-sessao-de-fundo-design.md:34,49`
- Contradiz a spec: parcial
- Pergunta que levanta: Com o Chrome de fundo vivo o tempo todo, qualquer outra ferramenta sua que abra esse perfil falha com uma mensagem que não explica nada. Quer que o erro claro "perfil em uso pelo pid X" (C5) entre nesta entrega?

### A27 — Não existe atalho pronto: `launchServer` não aceita `userDataDir`, `connectOverCDP` tem fidelidade menor e abre porta local, e o extractor não tem socket, servidor nem spawn longo; tudo é código novo
- Fonte: `extractor/node_modules/playwright-core/types/types.d.ts:15990-16140`; https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp ; https://developer.chrome.com/blog/remote-debugging-port ; https://github.com/trycua/cua/issues/2916 ; `extractor/src/cli/contato.ts:11,118` (único `child_process`)
- Contradiz a spec: parcial
- Pergunta que levanta: O socket próprio com permissão só do seu usuário é o mais controlado, mas é código novo para manter. Ligar cada comando ao mesmo Chrome pelo protocolo de depuração reaproveita o Playwright, mas abre uma porta pela qual qualquer processo da máquina controla sua sessão logada do GHL, e ainda exige o mesmo ciclo de vida. Qual risco prefere carregar?

### A28 — Depois de um `git pull`, o processo de fundo vivo pode estar rodando código mais velho que o do comando (lição do gopls)
- Fonte: https://tip.golang.org/gopls/daemon ; https://go.googlesource.com/tools/+/67ab769fbfbfcb13e01e46f185ecd2863170fd09/internal/lsp/cmd/usage/usage.hlp
- Contradiz a spec: não
- Pergunta que levanta: Topa que o socket devolva a versão do processo de fundo e que o comando peça "encerrar" e o religue quando divergir, para uma atualização do plugin valer na hora e não 30 min depois?

### A29 — O rastro de escrita do envelope `--json` vive em variáveis de módulo do processo do comando; só funciona se o HTTP continuar no comando e o processo de fundo apenas entregar tokens
- Fonte: `extractor/src/saida.ts:11-46`; `extractor/src/api/client.ts:60,94`; `auditor/src/automaster_audit/mcp/base.py:177-190`
- Contradiz a spec: não
- Pergunta que levanta: Fixar como regra que o processo de fundo nunca chama o GHL mantém intacto o aviso "a escrita pode ter saído". Concorda?

### A30 — A espera de login segue 5 min (`captureTokens` 300 s) e o MCP corta em 600 s, mas com o processo de fundo várias tools passam a esperar a mesma janela de login
- Fonte: `extractor/src/auth/token.ts:52`; `auditor/src/automaster_audit/mcp/base.py:143,155`; `docs/vesta/specs/2026-10-09-sessao-de-fundo-design.md:56-57,92-93`
- Contradiz a spec: não
- Pergunta que levanta: Se três tools esperam o mesmo login, todas terminam juntas quando você logar, ou todas falham juntas aos 10 minutos (uma extração longa somada à espera pode passar dos 600 s). Prefere que só a primeira espere e as outras falhem na hora com "login pendente"?

### A31 — O envelope de erro só separa `http_NNN` de um `erro` genérico: "processo de fundo não subiu", "login pendente" e "tokens não capturados" chegam iguais ao MCP
- Fonte: `extractor/src/saida.ts:34-46`; `auditor/src/automaster_audit/mcp/base.py:145-166`; `auditor/tests/test_mcp_tools.py:54,66-78`; `docs/vesta/specs/2026-10-09-sessao-de-fundo-design.md:90-93`
- Contradiz a spec: parcial
- Pergunta que levanta: Quando uma tool falhar por falta de login, quer que o agente receba um código próprio (`login_pendente`) para te avisar "abre a janela e loga", em vez de tratar como erro qualquer e tentar de novo?

### A32 — O `discover` segura a trava sem limite (`waitForEvent('close', {timeout: 0})`), e a spec não diz o que acontece com um comando que chega nesse meio-tempo
- Fonte: `extractor/src/cli/extract.ts:78-109`; `extractor/test/lock.test.ts:10-18`; `docs/vesta/specs/2026-10-09-sessao-de-fundo-design.md:46-49,70-71`
- Contradiz a spec: parcial
- Pergunta que levanta: Enquanto você estiver mapeando rotas com o discover, as tools ao vivo devem falhar na hora com "discover aberto", ou esperar você fechar a janela?

### A33 — O Chromium baixado na instalação (~410 MB) não é usado hoje (todo launch é `channel: 'chrome'`); a prévia visual roda dentro do `withClient` e captura tokens para fotografar uma página pública; a spec passa a depender dos dois navegadores
- Fonte: `commands/automaster-extract.md:9-11`; `extractor/src/auth/session.ts:25-28`; `extractor/src/cli/formularios.ts:319,329-357`; `auditor/src/automaster_audit/mcp/base.py:131`; `docs/vesta/specs/2026-10-09-sessao-de-fundo-design.md:68-69`
- Contradiz a spec: parcial
- Pergunta que levanta: A prévia visual pode virar uma foto avulsa que nunca pede login. Você a usa para algo que precise da sessão, como formulário não publicado? E prefere documentar os dois navegadores como pré-requisito ou padronizar no Chrome do sistema e dispensar o download de 410 MB?

### A34 — O teste `cli-comandos.test.ts` trava a lista exata de comandos; um subcomando do processo de fundo quebra o teste até ser registrado e aparece no `--help`
- Fonte: `extractor/test/cli-comandos.test.ts:14-40`
- Contradiz a spec: não
- Pergunta que levanta: O processo de fundo aparece como comando no `--help`, que dá para usar à mão (ver status, encerrar), ou fica escondido como arquivo separado que só o extractor chama?

### A35 — Há três cópias de `sleep`; o Node ≥22 traz `setTimeout` de `node:timers/promises` e o relógio falso sai de `node:test` (`mock.timers`)
- Fonte: `extractor/src/cli/shared.ts:12`; `extractor/src/api/client.ts:8`; `extractor/src/auth/token.ts:43`; `extractor/package.json` (engines `node >=22`)
- Contradiz a spec: não
- Pergunta que levanta: Detalhe interno, sem efeito para o usuário: só não criar uma quarta cópia no processo de fundo.

### A36 — Sem Chrome, cada chamada ainda paga a subida do `tsx` (~0,43 s medidos), e `workflow_editar` com `confirmo` chama a CLI duas vezes (prévia e gravação)
- Fonte: `auditor/src/automaster_audit/mcp/workflows.py:216-218,231,258,272,289,323`; medição `time ./node_modules/.bin/tsx src/cli.ts --help` em `extractor/` (0,428 s)
- Contradiz a spec: não
- Pergunta que levanta: Cada tool cai de vários segundos para menos de meio segundo, mas não para zero, porque o Node ainda sobe a cada chamada. Esse resto é aceitável?

### A37 — O alcance central é um ponto só: `withClient` tem 30 chamadas em 11 arquivos, `new GhlClient` só existe em `shared.ts:54`; só a prévia visual usa `page`, e extract, smoke, workflows e workflow-editar leem os JWTs brutos (companyId, userId), então o processo de fundo precisa entregar os tokens inteiros
- Fonte: `extractor/src/cli/shared.ts:38-59`; `extractor/src/auth/session.ts:22-35`; `extractor/src/cli/extract.ts:18-19,41,79`; `extractor/src/cli/smoke.ts:245-248`; `extractor/src/cli/workflows.ts:124-125`; `extractor/src/cli/workflow-editar.ts:50-51,140,189-190`; `extractor/src/cli/contato.ts:58`; `extractor/src/cli/formularios.ts:319,336`; `extractor/src/auth/token.ts:20-38`
- Contradiz a spec: não
- Pergunta que levanta: Trocar só o miolo do `withClient` muda de uma vez os 30 comandos ao vivo. Prefere a troca inteira numa versão, ou ligar comando por comando para poder voltar atrás em algum que der problema?

### A38 — Fora de workflow (`--versao-esperada`, `--triggers-esperados`) não há guarda de concorrência: formulário, pipeline e contato só têm a trava do Chrome; um lock por recurso em `registroEscrita` fica depois da leitura do "antes" e não cobre os dois processos (prévia e gravação) da MCP
- Fonte: `auditor/src/automaster_audit/mcp/workflows.py:173-187`; `extractor/src/cli/formularios.ts:88,158,180-242`; `extractor/src/cli/oportunidades.ts:134-170`; `extractor/src/cli/workflows.ts:167-170`; `extractor/src/auth/lock.ts:5-15,39-45`; `CLAUDE.md:32`; `CHANGELOG.md:102-111,439-440`; `docs/endpoints.md:1374-1390`; `docs/backlog-arquitetura.md:6-8,87-88` (nota supõe que o lock "esperou", mas ele recusa); `docs/vesta/specs/2026-10-09-sessao-de-fundo-design.md:96-101`
- Contradiz a spec: parcial
- Pergunta que levanta: Liberar o paralelo tira a única barreira que hoje impede dois agentes de reescreverem o mesmo formulário ou funil. Prefere leitura em paralelo e escrita em fila única (mais segura, mais lenta), trava só no MESMO recurso (o resto roda junto), ou escrita livre aceitando o risco onde não há guarda?

### A39 — O incidente da 0.12.0 foi registrado "como episódio, não como prova", e a doc culpa duas requisições disputando a mesma aba do perfil, aba que deixa de existir com fetch direto; a spec o resume como "duas escritas no mesmo recurso"
- Fonte: `docs/endpoints.md:1194-1203,1379-1384`; `extractor/src/auth/lock.ts:8-11`; `docs/vesta/specs/2026-10-09-sessao-de-fundo-design.md:98-101`
- Contradiz a spec: parcial
- Pergunta que levanta: Ninguém provou a causa do formulário apagado. Prefere tratar escritas em paralelo como perigosas até haver prova, ou como seguras porque não existe mais aba compartilhada?

### A40 — Nenhum teste exercita o `GhlClient` real (401, 429, multipart, `getJsonNoAuth`): testes e cassete trocam o cliente inteiro por falsos com o mesmo formato, e a espia precisa continuar guardando os três caminhos para o `smoke --gravar`
- Fonte: `extractor/src/cli/cassete.ts:44-56`; `extractor/src/api/client.ts:15-43,57-79`; `extractor/test/workflow-editar.test.ts:25-31,150`; `extractor/test/smoke.test.ts:10,48`; `extractor/test/annotations.test.ts:15`; `extractor/test/tags.test.ts:15`; `extractor/test/workflows-write.test.ts:20-21,144,162`; `extractor/test/entidades-vivo.test.ts:7-13`; `extractor/src/cli/smoke.ts:250-253`
- Contradiz a spec: não
- Pergunta que levanta: Se o tratamento de sessão vencida ou de excesso de chamadas quebrar hoje, nenhum teste avisa. Quer esses testes escritos ANTES da troca, contra o cliente atual, para provar que o comportamento ficou igual?

### A41 — `npm run smoke` passa por `withClient` e exercitaria o cliente novo de ponta a ponta nas rotas de leitura, mas a seção de testes da spec não o cita (o replay do cassete no CI usa cliente falso)
- Fonte: `extractor/src/cli/smoke.ts:240-245`; `extractor/src/cli/cassete.ts:44-56`; `CLAUDE.md` (comando `npm run smoke -- -l <loc>`); `docs/vesta/specs/2026-10-09-sessao-de-fundo-design.md:103-109`
- Contradiz a spec: parcial
- Pergunta que levanta: Aceita somar à prova ao vivo o smoke completo, rodado antes e depois, como prova de que nenhuma rota de leitura quebrou com a troca do cliente HTTP? (Escritas seguem dependendo de A20.)

### A42 — Linha de base do extractor: 235 testes, todos passando (~1 s)
- Fonte: `extractor/package.json:46`; execução de `npm test` em `extractor/` em 2026-10-09
- Contradiz a spec: não
- Pergunta que levanta: Aceita como critério de pronto "os 235 de hoje continuam passando, mais os testes novos de renovação e de subida automática"?

### A43 — Descrições e instruções passam a descrever o sistema errado: 9 descrições de tool MCP dizem "abre Chrome", a docstring e a mensagem de timeout de `_run_extractor` falam do Chrome, e CLAUDE.md, a skill de leitura e o comando de extração documentam a trava e a escrita serial "por construção"
- Fonte: `auditor/src/automaster_audit/mcp/contato.py:150,166,209`; `mcp/oportunidades.py:147`; `mcp/agenda.py:176`; `mcp/conversas.py:344,422`; `mcp/formularios.py:153`; `mcp/workflows.py:160,183,220,332`; `mcp/base.py:124,155`; `skills/automaster-leitura/SKILL.md:24,67,86,140,229-233`; `commands/automaster-extract.md:2,7,13`; `CLAUDE.md:18,32,49,129`; `auditor/tests/test_mcp_tools.py:54` (único teste que cita o texto, como stderr falso)
- Contradiz a spec: parcial
- Pergunta que levanta: Os agentes decidem com base em frases como "esta tool abre o Chrome" e "escrita é serial". Quer que a reescrita dessas instruções seja um passo travado do plano, para nenhum agente seguir a regra antiga nem te avisar "vou abrir o Chrome"?

### A44 — A mudança altera o plugin instalado: pede 0.28.0 nas três versões (hoje 0.27.0) e seção própria no CHANGELOG, que deve reverter explicitamente as decisões "serial por construção" (0.12.0) e "trava do Chrome" (0.22.0)
- Fonte: `CLAUDE.md:30`; `CHANGELOG.md:1-7,102-111,439-440`; `.claude-plugin/plugin.json:4`; `extractor/package.json:3`; `auditor/pyproject.toml:7`; `auditor/tests/test_versoes.py:30-41`
- Contradiz a spec: não
- Pergunta que levanta: Esta versão desfaz duas decisões que o CHANGELOG apresenta como proteção. Quer que a 0.28.0 diga isso com todas as letras, para quem atualizar o plugin saber que o paralelo voltou?

### A45 — Mais da metade das telas de login desde 21/09 nasceu fora do código do automaster: 14 de 24 vieram de páginas que o extractor nunca abre (conversas ×8, dashboard ×4, editor de workflow ×2), e três outros projetos documentam usar o perfil `~/.automaster/chrome-profile` para prints e testes no GHL
- Fonte: `~/.automaster/chrome-profile/Default/History` (redirecionamentos `app.*/?url=` desde 21/09 agrupados pela página de origem: 10 de `/automation/workflows`, 8 de `/conversations`, inclusive 2 em `app.zoitech.com.br`, 4 de `/dashboard` em 01/10 e 06/10, 2 de `/automation/workflow/<id>` em 21/09; as visitas de 09/10 16:58:19 e 17:10:10 para `/v2/location/QOzJ130pN0bi6GDHcL9x/conversations/...` têm transição `TYPED` com qualificador `0x38` = `FROM_API|CHAIN_START|CHAIN_END`, a mesma marca das 1.159 navegações do próprio `captureTokens`); https://raw.githubusercontent.com/chromium/chromium/main/ui/base/page_transition_types.h (`FROM_API` = "originated from an external application"); `extractor/src/auth/token.ts:40-41,73,82` (única URL que o código abre); `../evolution/docs/handoffs/handoff-2026-10-07-status-tela-nova.md:37-38` (teste em campo na `I2enfs81gaiAGj9YXKoi` "pelo GHL no Chrome com o perfil `~/.automaster/chrome-profile`"); `../evolution-markup/docs/vesta/specs/2026-10-01-central-de-ajuda-design.md:88` (prints "pelo perfil de Chrome logado (`~/.automaster/chrome-profile`)"); `../Agente Conquist/docs/testes-agenda-ghl.md:3-5` (API "com os tokens da sessão do automaster"); `docs/vesta/specs/2026-10-09-sessao-de-fundo-design.md:26-28,34`
- Contradiz a spec: sim
- Pergunta que levanta: Outros projetos seus (evolution, central de ajuda, Agente Conquist) usam o mesmo login do automaster para tirar prints e testar o GHL, e boa parte dos "pediu login" aconteceu nessas visitas, não nos comandos do automaster. Com o processo de fundo segurando o perfil o tempo todo, esses usos deixam de abrir (ou derrubam o processo). Prefere que eles ganhem perfil e login próprios (um login a mais para manter, mas o do automaster fica isolado), ou que o processo de fundo empreste uma janela logada para eles (mais código, e o login continua compartilhado)?

### A46 — O plugin instalado roda direto desta pasta do repositório (marketplace `directory`), e hoje há 7 servidores MCP vivos servindo sessões de outros projetos; o `installed_plugins.json` ainda diz 0.18.0, versão que nem tem a trava
- Fonte: `~/.claude/settings.json:371-375` (`"zoi": {"source": "directory", "path": ".../automaster_v2"}`); `ps eww` dos 7 processos `automaster_audit.mcp_server` em 2026-10-09 (`CLAUDE_PLUGIN_ROOT` e `PYTHONPATH` apontando para este repo; `cwd` em `Projetos_ZOI/evolution` e `Projetos_ZOI/Agente Conquist`); `~/.claude/plugins/installed_plugins.json:123-131` (`installPath .../cache/zoi/automaster/0.18.0`, cópia sem `src/auth/lock.ts` e sem `mcp/`); `auditor/src/automaster_audit/mcp/base.py:31` (`EXTRACTOR_DIR` sai de `CLAUDE_PLUGIN_ROOT`); `git worktree list` (só a árvore principal, na branch `sessao-de-fundo`)
- Contradiz a spec: parcial
- Pergunta que levanta: Toda sessão do Claude aberta em outro projeto usa, na hora, o código que estiver nesta pasta. Construir o processo de fundo aqui, na branch, troca o automaster de todas elas no meio do trabalho, e um processo de fundo de uma branch continua vivo depois de voltar para a master (A28 vale para `git checkout`, não só `git pull`). Topa construir numa cópia separada (worktree) e só trazer para cá na prova ao vivo, sabendo que a prova pelas tools MCP só acontece depois de mesclar?

### A47 — `captureTokens` não reconhece a tela de login: só espera tokens por até 300 s. No Chrome invisível, "nenhum token capturado" só se constata depois de 5 minutos sem janela; o sinal rápido existe, o redirecionamento para `app.gohighlevel.com/?url=`
- Fonte: `extractor/src/auth/token.ts:52,73-84,89-93`; `~/.automaster/chrome-profile/Default/History` (24 redirecionamentos `https://app.gohighlevel.com/?url=<destino>` desde 21/09, todos no mesmo formato); `docs/vesta/specs/2026-10-09-sessao-de-fundo-design.md:54-57`
- Contradiz a spec: parcial
- Pergunta que levanta: Quando o login cair, quer que a janela de login apareça em poucos segundos (o processo reconhece a tela de login pelo endereço, que o GHL pode mudar sem aviso; se mudar, volta a esperar os 5 minutos) ou aceita que a tool fique até 5 minutos parada sem nenhuma janela antes de pedir login?

### A48 — `context.request` corta cada chamada em 30 s por padrão; o `fetch` do Node não tem limite total e o undici espera até 300 s pelos cabeçalhos e mais 300 s pelo corpo
- Fonte: `extractor/node_modules/playwright-core/types/types.d.ts:18028-18031` ("Defaults to `30000`"); `extractor/src/api/client.ts:64,98,117` (nenhum `timeout` passado hoje); https://raw.githubusercontent.com/nodejs/undici/main/docs/docs/api/Client.md (`headersTimeout` e `bodyTimeout` com padrão `300e3`); `auditor/src/automaster_audit/mcp/base.py:143,155-159`; `docs/vesta/specs/2026-10-09-sessao-de-fundo-design.md:40-42`
- Contradiz a spec: parcial
- Pergunta que levanta: Na troca para chamadas diretas, uma rota do GHL que trave deixa de virar erro em 30 s e pode prender a tool até os 10 minutos do MCP, terminando no falso aviso de "a escrita pode ter sido aplicada". Quer manter o corte de 30 s por chamada (`AbortSignal.timeout`), aceitando que uma rota lenta de verdade, como uma busca grande, falhe e precise de nova tentativa?

### A49 — No macOS o relógio dos timers do Node conta o tempo de Mac dormindo: ao acordar, a renovação "antes de vencer" e a morte por ociosidade disparam juntas, com os tokens já vencidos
- Fonte: https://raw.githubusercontent.com/libuv/libuv/v1.52.1/src/unix/darwin.c linha 62 (`uv__hrtime` usa `mach_continuous_time()`); `node -p process.versions.uv` = 1.52.1 (Node 26.5.0, o primeiro no PATH do MCP: `/opt/homebrew/bin`); `docs/vesta/specs/2026-10-09-sessao-de-fundo-design.md:48,61-62`
- Contradiz a spec: parcial
- Pergunta que levanta: Depois de o Mac dormir mais de 30 minutos, o processo de fundo morre ao acordar e a primeira tool religa o Chrome invisível (uns 4 s, A11), e nenhum token guardado sobrevive à noite. Aceita isso como normal? E topa que a validade seja conferida na hora de cada pedido, pelo `exp`, em vez de confiar só no timer de renovação, que após o sono dispara atrasado?

### A50 — O `tsx` roda o comando num processo filho: o timeout do MCP manda SIGKILL só ao `tsx`, e o node com o Chrome, a trava e a escrita em curso continua vivo, órfão
- Fonte: medição `ps` em 2026-10-09 (`node .../.bin/tsx -e ...` pid 71488 → filho `node --require .../tsx/dist/preflight.cjs --import .../tsx/dist/loader.mjs` pid 71490); https://github.com/python/cpython/blob/main/Lib/subprocess.py (`run`: no `TimeoutExpired` chama `process.kill()`, SIGKILL só no pid direto); `auditor/src/automaster_audit/mcp/base.py:46-49`; `extractor/src/auth/lock.ts:31-49` (a trava guarda o pid do filho, que segue vivo); corrige o mecanismo suposto em A8
- Contradiz a spec: não
- Pergunta que levanta: Hoje, quando uma tool estoura o tempo, o agente ouve "foi morto", mas o comando continua rodando escondido e pode concluir a escrita depois, ainda segurando a trava. Quer que o MCP mate o grupo inteiro de processos, para "estourou" passar a significar "parou"? (Para o plano: o processo de fundo, se subir pelo próprio comando, precisa herdar `process.execArgv` com o carregador do `tsx`, ou não lê os `.ts`.)

### A51 — Todo comando ao vivo já tem a subconta em mãos: as 30 chamadas de `withClient` passam um `locationId` vindo de `-l` obrigatório, então levar a subconta no pedido ao processo de fundo não custa nada
- Fonte: `extractor/src/cli/shared.ts:38-47`; grep de `withClient(` em `extractor/src` (21× `opts.location`, 6× `o.location`, 2× `locationId`, 1× `loc`); 31 ocorrências de `-l, --location` obrigatório em `extractor/src/cli`; `extractor/src/auth/token.ts:40-41,73`; `docs/vesta/specs/2026-10-09-sessao-de-fundo-design.md:83` (contrato `tokens` sem subconta); complementa A14
- Contradiz a spec: parcial
- Pergunta que levanta: O processo de fundo pode abrir a subconta que o primeiro comando pediu e reaproveitar os tokens para as outras. Topa que, ao trocar de subconta, ele NÃO navegue de novo (mais rápido, mas uma subconta recém-liberada só funciona depois da próxima renovação) e só renove quando a API recusar?

### A52 — O CI não tem Chrome por desenho, então o teste de "subida automática" da spec subiria um processo de fundo que tenta abrir um Chrome inexistente; socket Unix e relógio falso funcionam no runner, e o cliente com `fetch` dá para testar contra um servidor HTTP local
- Fonte: `.github/workflows/ci.yml:20-23` ("Sem browser do Playwright de propósito: nenhum teste abre Chrome", `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: 1`, `ubuntu-latest`); https://nodejs.org/api/net.html#identifying-paths-for-ipc-connections ; https://nodejs.org/api/test.html#class-mocktimers ; `extractor/test/lock.test.ts:10-27` (padrão já usado: caminho de arquivo por parâmetro); `docs/vesta/specs/2026-10-09-sessao-de-fundo-design.md:105-107`; fecha o "como" de A40
- Contradiz a spec: parcial
- Pergunta que levanta: No CI, o processo de fundo vai rodar com um Chrome de mentira, e o 401, o 429 e o anexo serão provados contra um servidor falso local. A prova com Chrome e GHL de verdade fica só na rodada ao vivo na sua máquina. Aceita essa divisão?

### A53 — Windows já não é suportado (o MCP sobe por script bash, o PATH extra é do Homebrew e o UA é de Mac); o socket Unix não fecha porta nenhuma que esteja aberta hoje. Linux funcionaria, mas a janela de login exige tela
- Fonte: `.claude-plugin/mcp.json:5` (`automaster-python.sh`); `bin/automaster-python.sh:1,7`; `auditor/src/automaster_audit/mcp/base.py:40`; `extractor/src/api/client.ts:5-6`; `extractor/src/cli/contato.ts:118` (único ramo por plataforma, `darwin`); https://nodejs.org/api/net.html#identifying-paths-for-ipc-connections (no Windows o equivalente é pipe nomeado)
- Contradiz a spec: não
- Pergunta que levanta: O automaster segue só para Mac (e Linux com tela). Algum cliente vai precisar dele em Windows ou num servidor sem tela? Se sim, é outro projeto e não muda esta entrega.

## Fila do grill

1. A6 — Quanto está o Session Timeout da agência ZOI? Se estiver em horas, nenhum Chrome de fundo resolve (trava A1, A2, A18)
2. A3 — Você logou do zero ou limpou cookies hoje às 16:30? (trava A1)
3. A45 — Outros projetos usam o mesmo perfil do automaster e geraram a maioria das telas de login: perfil próprio para eles ou janela emprestada pelo processo de fundo? (trava A1, A2, A7)
4. A1 — Medir antes de construir, já que o fechamento limpo não apaga o login? (trava A2, A7, A8, A15, A18)
5. A2 — Login que dura de 1 a 4 dias conta como sucesso, ou "semanas" é inegociável? (trava A18)
6. A7 — Aceita recarregar o app pelo Playwright de hora em hora, sabendo que já houve logout depois de navegar pelo Playwright? (trava A15, A13)
7. A15 — Um 401 por hora com recuperação sozinha, ou a rota interna de renovação do GHL? (trava A13, A18)
8. A13 — Contrato simples "me dá outro token" em vez de `renovar(tokenQueFalhou)`?
9. A18 — Processo de fundo vivo o dia inteiro ou morte após 30 min parado?
10. A8 — Aceita o risco residual de token velho quando o processo cai à força?
11. A49 — Após o Mac dormir, religar o Chrome e conferir o `exp` a cada pedido?
12. A4 — Logar sempre por e-mail e senha na janela automatizada, ou num Chrome comum com passo manual a mais?
13. A5 — O automaster precisa funcionar no domínio `app.zoitech.com.br`?
14. A10 — Manter ou zerar a conta Google logada no Chrome do perfil?
15. A9 — Travar no código que o perfil só abre pelo Playwright com o Chrome do sistema? (trava A33)
16. A12 — Forçar user-agent de navegador no Chrome invisível?
17. A14 — Qual tela/subconta o processo de fundo abre para capturar, e o que fazer com subconta fora do token?
18. A51 — Levar a subconta no pedido ao processo de fundo e não renavegar ao trocar de subconta?
19. A47 — Janela de login em segundos pelo endereço da tela de login, ou até 5 min invisível?
20. A46 — Construir numa worktree, já que o plugin roda desta pasta para todas as sessões abertas? (trava A28)
21. A19 — Rodar smoke e uma escrita descartável de cada tipo com fetch antes de largar o cliente atual? (trava A41)
22. A41 — Somar o smoke completo, antes e depois, à prova ao vivo?
23. A48 — Manter o corte de 30 s por chamada no fetch?
24. A52 — Chrome falso no CI e Chrome real só na prova ao vivo?
25. A38 — Escrita em fila única, trava por recurso ou livre? (trava A39, A22, A43)
26. A39 — Tratar escrita paralela como perigosa até prova, ou segura sem aba compartilhada?
27. A22 — Aceitar a taxa dobrada contra o GHL ou o processo de fundo distribui a vez de chamar?
28. A23 — Permissão da pasta basta, ou o socket exige segredo? (trava A27)
29. A27 — Socket próprio ou Chrome compartilhado pelo protocolo de depuração?
30. A26 — Erro claro "perfil em uso pelo pid X" (C5) entra nesta entrega?
31. A21 — Critério de aceite: a primeira tool via MCP, que sobe o processo, responde no tempo normal?
32. A31 — Código de erro próprio `login_pendente` para o agente?
33. A32 — Com o discover aberto, tools falham na hora ou esperam?
34. A33 — Prévia visual sem login; um navegador só ou os dois como pré-requisito?
35. A43 — Reescrita das descrições e instruções como passo travado do plano?

## Lacunas abertas

- Causa das 10 quedas notadas em `/automation/workflows`: a tela de login mostra onde a queda foi percebida, não quando nem por quê. Falta cruzar com o horário dos usos de outros projetos (A45) e com o Session Timeout da agência (A6), que só o usuário vê.
- Quem fez as navegações `FROM_API` para conversas e dashboard: script de outro projeto via Playwright/CDP ou link aberto de outro app no Chrome do automaster, que no macOS é o mesmo `Google Chrome.app`. A marca no History não distingue, e os scripts não estão nos repositórios (só citados nas docs).
- Quanto a sessão dura com o Chrome invisível vivo por horas e dias: A11 provou minutos. Só medindo.
- Se o GHL aceita um refresh token já trocado (A16) e se a carga logo após o vencimento sempre troca o bearer (A15 se apoia em uma carga).
- Se alguma rota de escrita ou multipart depende dos cookies do navegador (A19): só se prova ao vivo.
- Se o GHL limita sessões simultâneas por usuário (outro navegador logado derruba este): busca web sem nenhuma documentação do GHL sobre isso (https://consultevo.com/gohighlevel-login-troubleshooting-guide/ é guia de terceiro e não trata do assunto).
- Memória do Chrome invisível parado: não medida, para não abrir o perfil de novo e arriscar a sessão (A7).
- O que acontece com o processo de fundo quando o Chrome do sistema se atualiza com ele vivo (perfil hoje em 154.0.8037.98): não verificado.
- Reação do Cloudflare ao `HeadlessChrome` ao longo de dias (A12): sem prova de bloqueio nem de ausência dele.
