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

Suposto por mim, a confirmar na pesquisa:

- A causa dos logins repetidos é o fecha-e-abre do Chrome a cada comando, que descarta a
  sessão antes de ela ser gravada no perfil (ou outra interação com o perfil, como
  `--use-mock-keychain` do Playwright no macOS).
- Os dois tokens valem para o usuário, não para uma subconta específica.
- Os tokens carregam a própria validade (`exp` do JWT).

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
- O processo morre depois de **30 minutos sem uso** e solta a trava.
- A trava do perfil é dele, o que garante um só processo de fundo por máquina.
- Processo que morre no meio de um comando é religado uma vez antes de o comando desistir.

### Login

Se o GHL pedir login (nenhum token capturado no Chrome invisível), o processo fecha o
Chrome invisível e reabre **com janela**, só para o login. Depois que os tokens aparecem,
volta a ficar invisível. O comando que esperava continua sozinho; espera até 5 minutos,
como hoje, avisando que há uma janela esperando login.

### Renovação

- O processo lê a validade dentro dos tokens e renova em segundo plano alguns minutos antes
  de vencerem, recarregando a página invisível.
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

- `tokens`: devolve `{bearer, tokenId}` válidos, capturando ou esperando login se preciso.
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

Leituras em paralelo passam a funcionar. Escritas em paralelo deixam de travar no Chrome,
o que reabre o risco de duas escritas no mesmo recurso se atropelarem (incidente da 0.12.0:
dois agentes no mesmo formulário geraram cópia e exclusão não pedidas). Decisão pendente
para o grill.

## Testes

- Unitários: renovação única sob concorrência; subida automática quando o socket não
  responde; morte por ociosidade com relógio falso; `GhlClient` sobre `fetch` mantendo o
  tratamento de 401/429.
- Prova ao vivo na subconta de teste: duas tools ao mesmo tempo, nenhuma janela, tempo de
  uma tool medido antes e depois, e um dia de uso sem pedir login.

## Fora de escopo

- Multi-usuário ou mais de um login do GHL ao mesmo tempo.
- Subir o processo de fundo com o macOS (launchd).
