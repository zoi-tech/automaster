# Sessão de fundo: um Chrome invisível servindo todos os comandos ao vivo

## Problema

Hoje cada comando ao vivo (cada `npm run <comando>` e cada tool MCP que chama o extractor)
passa por `withClient` (`extractor/src/cli/shared.ts`): abre um Chrome **visível** com o
perfil persistente, navega até a subconta para capturar os dois tokens, faz o trabalho e
fecha o Chrome. Efeitos que o usuário relata:

- O GHL pede login de novo **várias vezes por dia**, mesmo com comandos próximos.
- Uma janela nova a cada chamada; dez perguntas seguidas são dez janelas.
- Dois comandos ao mesmo tempo falham: a trava do perfil (`src/auth/lock.ts`) recusa o segundo.
- Cada chamada paga o custo de abrir o Chrome e carregar o app antes da primeira requisição.

## Resultado pretendido

Dito pelo usuário (critérios de sucesso, todos exigidos):

1. Nenhuma janela visível; o Chrome só aparece quando o GHL exige login.
2. Login raro: logar uma vez e durar semanas.
3. Duas tools ao vivo ao mesmo tempo funcionam.
4. Tool ao vivo responde sem o custo de abrir e fechar o Chrome.

O que a pesquisa mostrou (dossiê `docs/vesta/research/2026-10-09-sessao-de-fundo-research.md`):

- Fechar o Chrome normalmente **não** apaga o login: o GHL guarda a sessão num cookie de 1
  ano (A1). 14 de 24 telas de login desde 21/09 vieram de outros projetos usando o mesmo
  perfil (A45); a outra causa provável é a navegação do Playwright no app (A7).
- O bearer é do usuário; o token-id leva a lista de subcontas da emissão (A14).
- Os dois tokens valem 60 min e só são refeitos depois de vencer (A13, A15).
- Chrome sem janela captura os dois tokens em 3,5 a 4,8 s com o perfil atual (A11).

## Arquitetura

Um **processo de fundo** novo no extractor (Node) é o único dono do perfil persistente e da
trava `~/.automaster/chrome.lock`. Ele mantém um Chrome sem janela (`headless`) logado e
os tokens em memória. Tokens continuam **nunca indo para disco**.

Ele escuta num socket Unix dentro de `~/.automaster/`, com permissão só do usuário.

Os comandos deixam de abrir Chrome: `withClient` pede os tokens ao processo de fundo e
`GhlClient` faz as chamadas HTTP direto do Node (`fetch`, `FormData` nativo), sem
`BrowserContext`. O download do Firebase sem auth (`getJsonNoAuth`) segue a mesma troca.

### Ciclo de vida

- O primeiro comando que não encontra o socket respondendo sobe o processo de fundo,
  desacoplado do terminal, e espera ele ficar pronto.
- O processo morre depois de **4 horas sem pedido** e fecha o Chrome de forma limpa.
- A trava do perfil é dele, o que garante um só processo de fundo por máquina.
- Processo que morre no meio de um comando é religado uma vez antes de o comando desistir.

### Login

Se o GHL pedir login (redirecionamento para `app.gohighlevel.com/?url=`, reconhecido em
segundos), o processo fecha o
Chrome invisível e reabre **com janela**, só para o login. Depois que os tokens aparecem,
volta a ficar invisível. O comando que esperava continua sozinho; espera até 5 minutos,
como hoje, avisando que há uma janela esperando login.

### Renovação

- Só sob demanda: a cada pedido o processo confere o `exp` pelo relógio de parede; vencido
  ou a menos de 60 s, recarrega o app uma vez e só então entrega. Sem timer de renovação.
- Em 401, o comando informa ao processo qual token falhou. Se outro comando já renovou, ele
  recebe o novo sem nova renovação; renovações simultâneas viram uma só.

### Casos fora do processo de fundo

- `formulario-estilo --acao previa-visual` abre a página pública do widget num Chromium
  descartável, sem perfil e sem trava: a página não exige login.
- `discover` é interativo de propósito: encerra o processo de fundo antes de abrir a
  janela dele com o perfil.

## Fluxo de dados

```
comando (CLI ou tool MCP) ──socket──▶ processo de fundo ──▶ Chrome invisível (perfil)
        │  tokens                              │ renova antes de vencer
        └──── HTTP direto (fetch) ────▶ backend.leadconnectorhq.com / services...
```

Contrato do socket (mínimo):

- `tokens(subconta)`: devolve `{bearer, tokenId}` válidos (e os cookies do perfil, se a
  prova A19 mostrar rota que precise), capturando ou esperando login se preciso.
- `versao`: impressão digital do código do processo, para o comando trocar um processo velho.
- `renovar(tokenQueFalhou)`: devolve tokens novos; se os atuais já diferem do que falhou,
  devolve os atuais.
- `encerrar`: fecha o Chrome e sai (usado pelo `discover`).

## Erros

- Processo de fundo que não sobe: erro claro no comando, com o motivo, pelo envelope
  `--json` de sempre (`falhar`).
- Login pendente: o comando espera até 5 minutos; a mensagem do timeout do MCP
  (`mcp/base.py:_run_extractor`) segue válida e é ajustada para citar a janela de login.
- Comportamento atual mantido: 429 com backoff, throttle entre chamadas, rastro de escrita.

## Paralelo

Leituras em paralelo funcionam. Escritas entram numa fila da máquina: um comando que
escreve espera a vez do anterior, cobrindo o comando inteiro, como a trava do Chrome cobria
(decisão A38/A39).

## Testes

- Unitários (Chrome falso injetado, sem Chrome no CI): renovação única sob concorrência;
  subida automática quando o socket não responde; morte por ociosidade com relógio falso;
  fila de escrita; `GhlClient` sobre `fetch` mantendo o
  tratamento de 401/429.
- Prova antes da troca do cliente (A19): `npm run smoke` e uma escrita descartável de cada
  tipo na Instaltech, desfeitas no fim.
- Prova ao vivo: duas tools ao mesmo tempo, nenhuma janela, tempo de uma tool medido antes
  e depois, primeira tool via MCP no tempo normal, e uma semana de uso sem queda de login
  causada pelo automaster no registro de logins (A2).

## Fora de escopo

- Multi-usuário ou mais de um login do GHL ao mesmo tempo.
- Subir o processo de fundo com o macOS (launchd).

## Decisões do grill

- **A6** — Session Timeout da agência tratado como o padrão do GHL ("Never"). Motivo: o
  usuário não alterou a configuração, e o padrão fora de HIPAA não desloga por inatividade.
- **A3** — descartado como pista. Motivo: o cookie jar recriado em 09/10 16:30 foi um login
  do próprio usuário.
- **A45** — o perfil `~/.automaster/chrome-profile` passa a ser só do processo de fundo.
  Outros projetos que precisam de token pedem ao processo de fundo pelo socket; os que
  precisam de tela (prints, testes clicando) usam perfil próprio com login próprio. Motivo:
  14 de 24 telas de login desde 21/09 vieram de páginas que o automaster não abre. A
  migração dos outros repositórios fica fora deste plano; entra aqui só a documentação do
  contrato do socket para eles.
- **A1/A7** — construir já, medindo. Entra desde a primeira etapa um registro de cada
  pedido de login (horário, tela de origem, se o processo de fundo tinha navegado antes).
  Motivo: fechar o Chrome normalmente não apaga o login (cookie de 1 ano), e a causa que
  resta, a navegação do Playwright, só se confirma com o Chrome isolado rodando.
- **A2** — critério "login raro" aprovado quando, numa semana de uso, o registro não mostrar
  queda causada por ação do automaster. Queda do lado do GHL é anotada e não reprova.
- **A15/A7/A13/A49** — renovação só sob demanda. A cada pedido o processo de fundo confere
  o `exp` dos tokens pelo relógio de parede; vencido (ou a menos de 60 s), recarrega o app
  uma vez e só então entrega. Sem timer de renovação. Motivo: recarregar antes de vencer não
  troca o bearer (60 min), recarregar sem uso multiplica a navegação suspeita de derrubar a
  sessão, e conferir na hora do pedido cobre o Mac que acorda com tudo vencido. O contrato
  `renovar(tokenQueFalhou)` continua para o 401 que escapar.
- **A18** — o processo de fundo morre após **4 horas** sem pedido (era 30 min). Motivo: cada
  reabertura recarrega o app; um Chrome parado não navega.
- **A4** — login na janela aceita os dois caminhos, e-mail e senha ou Google. A janela não
  bloqueia nenhum; se o Google recusar, o usuário tenta pelo e-mail.
- **A5** — só `app.gohighlevel.com`. Motivo: o domínio da marca nunca esteve logado no
  perfil, e com o Chrome invisível ninguém mais abre link nele.
- **A10** — a conta Google logada no perfil fica. Motivo: é o que sustenta o login pelo
  Google, que o usuário quer manter (A4).
- **A38/A39** — leitura livre, escrita em fila. Um comando que escreve espera a vez do
  anterior em vez de falhar, com a mesma cobertura da trava do Chrome hoje (o comando
  inteiro, da leitura do "antes" até a gravação). Motivo: fora de workflow a trava do Chrome
  era a única guarda contra escrita concorrente, e não há prova de que escrever em paralelo
  no GHL seja seguro. Substitui a seção "Paralelo".
- **A46** — construção nesta pasta, sem worktree, por decisão do usuário. Consequência
  aceita: as sessões de outros projetos usam o código do branch enquanto ele estiver aqui.
- **A19/A41** — etapa de prova antes de trocar o cliente: `npm run smoke` completo e uma
  escrita descartável de cada tipo (JSON, DELETE com corpo, multipart) na subconta de teste
  da Instaltech, tudo desfeito no fim. Rota que exigir cookie recebe os cookies do perfil
  pelo processo de fundo, junto com os tokens.

Decididas sem pergunta, por serem técnicas e terem um caminho claramente melhor (confirmadas
em bloco pelo usuário):

- **A8** — o processo de fundo sempre fecha o Chrome de forma limpa (SIGTERM, SIGINT,
  ociosidade, `encerrar`), porque o Chrome grava cookies em lote e os tokens rotacionam a
  cada carga. Risco residual aceito só para SIGKILL e queda do sistema.
- **A9** — o perfil continua aberto só pelo Playwright com o Chrome do sistema, mesmos
  switches nos dois modos (com e sem janela), para a chave dos cookies não mudar.
- **A12** — o Chrome invisível usa o user-agent do Chrome normal, sem `HeadlessChrome`.
- **A14/A51** — o pedido ao processo de fundo leva a subconta (`-l` já é obrigatório nos 30
  comandos). Os tokens são do usuário e servem a qualquer subconta; se a subconta pedida não
  estiver na lista gravada no token-id, o processo navega até ela e recaptura.
- **A47** — tela de login reconhecida em segundos pelo redirecionamento para
  `app.gohighlevel.com/?url=`, e não depois de 5 minutos sem tokens.
- **A48** — cada chamada HTTP mantém o corte de 30 s que existe hoje.
- **A52** — no CI o processo de fundo roda com um Chrome falso injetado; o Chrome real só na
  prova ao vivo. O cliente sobre `fetch` é testado contra um servidor HTTP local.
- **A23** — o socket fica em `~/.automaster/` com permissão só do usuário, sem segredo
  extra: o mesmo usuário já lê os cookies do perfil em disco.
- **A27** — socket próprio (HTTP sobre socket Unix), não Chrome compartilhado pelo protocolo
  de depuração: este abriria porta local e tem fidelidade menor.
- **A26** — Chrome de fora segurando o perfil vira erro claro com o pid, no lugar de
  "Target page, context or browser has been closed" (fecha o item C5 do backlog).
- **A21/A50** — o processo de fundo sobe desacoplado, sem herdar a saída do comando que o
  criou, para o MCP não esperar 600 s pelos pipes. Critério de aceite: a primeira tool via
  MCP, a que sobe o processo, responde no tempo normal de captura.
- **A31** — códigos de erro próprios no envelope `--json`: `login_pendente` e
  `sessao_indisponivel`.
- **A32** — com o `discover` aberto, comandos falham na hora com mensagem dizendo que o
  discover está com o perfil.
- **A33** — a prévia visual abre a página pública no Chrome do sistema sem perfil e sem
  trava; o Chromium baixado na instalação continua sem uso.
- **A22** — taxa contra o GHL somada entre comandos paralelos aceita; o backoff de 429 de
  cada comando segue valendo.
- **A28** — o processo de fundo responde com a impressão digital do próprio código; o
  comando que vê uma diferente o encerra e sobe outro. Cobre `git pull`, `git checkout` e a
  mescla deste branch.
- **A43** — reescrever descrições de tool, docstrings, CLAUDE.md, skill de leitura e
  comandos que falam em "abre Chrome" e "escrita serial por construção" é etapa do plano
  com prova (grep sem resto). Versão 0.28.0 nas três e seção no CHANGELOG (A44).
