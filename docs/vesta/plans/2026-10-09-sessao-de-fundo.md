# Plano — Sessão de fundo: um Chrome invisível servindo todos os comandos ao vivo

- **Objetivo:** trocar o Chrome visível aberto e fechado a cada comando ao vivo por um processo de fundo único, dono do perfil, que entrega os tokens por um socket Unix, enquanto cada comando chama o GHL direto por `fetch`.
- **Spec:** `docs/vesta/specs/2026-10-09-sessao-de-fundo-design.md` (revisada; a seção "## Decisões do grill" manda).
- **Comando de teste:** `(cd extractor && npx tsx --test --test-reporter=spec test/*.test.ts && npm run typecheck && npm run lint) && (cd auditor && .venv/bin/python -m pytest -q && .venv/bin/ruff check src tests && .venv/bin/ruff format --check src tests)`
- **Pastas de tela:** nenhuma
- **Mockup:** nenhum: sem tela

Decisões tomadas ao montar o plano, além das do grill:
- **Ordem da troca (A19/A41/A46).** O plugin em uso por todas as sessões roda desta pasta (os `mcp_server` em execução têm `CLAUDE_PLUGIN_ROOT` apontando para ela). Por isso o caminho padrão só muda depois de provado: o `fetch` entra desligado (`AUTOMASTER_CLIENTE_FETCH=1`) até a prova A19, e o Chrome de fundo é provado ao vivo pelo comando `sessao`, com os comandos ainda no caminho antigo, antes de qualquer comando passar a depender dele.
- **Critério "duas tools ao mesmo tempo".** O servidor MCP de uma sessão é serial (`auditor/src/automaster_audit/mcp_server.py:137` lê o stdin linha a linha e chama `handle()` de forma síncrona): dentro de uma sessão as tools esperam a vez e não falham. O critério vale entre sessões e entre processos, que é onde a disputa pelo perfil acontecia; a prova final roda dois processos pelo caminho do MCP ao mesmo tempo e mede a sobreposição. Concorrência dentro de uma sessão fica fora deste trabalho.
- **Orçamento de tempo.** Todos os prazos moram numa constante (`PRAZOS`, em `extractor/src/fundo/comum.ts`) e um teste confere que a soma cabe nos 600 s do MCP.

---

## Etapa 1 — Caminhos, prazos, impressão digital e linha do registro de logins

**Tela:** não

**Arquivos:**
- criar `extractor/src/fundo/comum.ts`
- criar `extractor/test/comum.test.ts`

**O que prova a etapa:**
- `caminhosDaSessao(dir)` devolve o socket (`<dir>/sock`), o log (`<dir>/fundo.log`), o registro de logins (`<dir>/logins.jsonl`) e a trava da fila de escrita (`<dir>/escrita.lock`), todos dentro de `dir`.
- Sem argumento, os caminhos ficam em `~/.automaster/sessao/` (o teste confere que o socket termina em `.automaster/sessao/sock` e começa com `os.homedir()`).
- Um `dir` tão longo que o socket passe de 103 bytes é recusado com erro que diz "longo demais" (limite do macOS para caminho de socket Unix).
- `prepararDir` cria a pasta com permissão `0700`; se a pasta já existia com `0755`, sai com `0700`.
- `impressaoDigital(raiz)` numa pasta temporária com `a.ts` e `sub/b.ts`: duas chamadas seguidas dão o mesmo texto; mudar o conteúdo de `sub/b.ts` muda o texto; criar `notas.md` não muda; criar `c.ts` muda. Sem argumento, devolve 16 caracteres hexadecimais.
- `ErroSessao("login_pendente", "x")` é `instanceof Error`, tem `codigo === "login_pendente"` e `message === "x"`.
- `pedir(socket, ...)` contra um servidor HTTP de teste escutando num socket Unix numa pasta temporária: um `POST` com corpo JSON chega ao servidor como JSON e a resposta volta parseada com o `status`; resposta `503` com `{code, message}` volta com `status 503` e o corpo; resposta que não é JSON volta como `{message: <texto>}`; servidor que aceita a conexão e nunca responde, com `timeoutMs` de 100, rejeita com erro de `code === "ETIMEOUT"` e mensagem que diz "não respondeu"; socket inexistente rejeita com erro de `code` `ENOENT` ou `ECONNREFUSED`.
- `PRAZOS` tem exatamente `tentativaInvisivelMs: 30_000`, `aberturaChromeMs: 10_000`, `esperaLoginMs: 270_000`, `pedidoTokensMs: 330_000`, `filaEscritaMs: 120_000`, `subidaMs: 15_000`, `encerrarMs: 20_000`; e o teste confere as duas somas: `tentativaInvisivelMs + 2 * aberturaChromeMs + esperaLoginMs <= pedidoTokensMs` (o pior caminho de login cabe no corte do pedido) e `filaEscritaMs + encerrarMs + subidaMs + pedidoTokensMs < 600_000` (o comando inteiro cabe no corte de 600 s do MCP, sobrando tempo para o trabalho).
- `ehTelaDeLogin("https://app.gohighlevel.com/?url=%2Fv2%2Flocation%2FX%2Fautomation%2Fworkflows")` é `true`; a URL da tela de workflows (`https://app.gohighlevel.com/v2/location/X/automation/workflows`) é `false`; `https://app.zoitech.com.br/?url=...` é `false`; `about:blank` e texto que não é URL são `false`.
- `telaDeOrigem` dessa URL de login devolve `/v2/location/X/automation/workflows` (decodificado); de uma URL sem `url=` devolve `""`; de texto que não é URL devolve `""`.
- `linhaDeLogin({...})` monta a linha do registro com exatamente as chaves `em`, `via`, `motivo`, `perfil`, `subconta`, `origem`, `navegouAntes`, `navegacoesDesdeSubida`, `ultimaNavegacao`, `processoDesde`, e nenhuma chave com "token" ou "bearer" no nome; com a URL de login acima, `origem` é `/v2/location/X/automation/workflows`; com uma URL sem `url=`, `origem` é a própria URL; `navegouAntes` é `false` com `navegacoes: 0` e `true` com `navegacoes: 2`.
- `registrarLogin(arquivo, linha)` chamado duas vezes num arquivo novo deixa duas linhas, cada uma JSON válido; o arquivo nasce com permissão `0600`.
- `argsDoCarregador` com o `process.execArgv` poluído de um teste do `tsx` (lista com `--test-concurrency=0`, `--require=<preflight>`, `--import=<loader>` e de novo `--require` `<preflight>` `--import` `<loader>` separados) devolve só `["--require=<preflight>", "--import=<loader>"]`, sem repetição; com `["--import", "tsx"]` devolve `["--import=tsx"]`.

**Como fazer:**

Padrões do repositório: ESM com imports terminando em `.js` mesmo para arquivos `.ts` (ver `extractor/test/lock.test.ts:1-8`); testes em `extractor/test/<nome>.test.ts` com `node:test` e `node:assert/strict`; `npm run typecheck` cobre `src` e `test` (`extractor/tsconfig.check.json`); o lint proíbe promise solta (`extractor/eslint.config.js`); para esperar use `setTimeout` de `node:timers/promises`, nunca uma cópia nova de `sleep`; tokens nunca vão para disco nem para log. Node ≥ 22.

`extractor/src/fundo/comum.ts` é o que o processo de fundo e os comandos compartilham. Exporte:

```ts
export interface Caminhos { dir: string; socket: string; log: string; logins: string; escrita: string }
export const PRAZOS = { tentativaInvisivelMs: 30_000, aberturaChromeMs: 10_000, esperaLoginMs: 270_000,
  pedidoTokensMs: 330_000, filaEscritaMs: 120_000, subidaMs: 15_000, encerrarMs: 20_000 } as const;
export function caminhosDaSessao(dir = path.join(os.homedir(), ".automaster", "sessao")): Caminhos
export function prepararDir(dir: string): void
export function impressaoDigital(raiz = <pasta src do extractor>): string
export class ErroSessao extends Error { constructor(readonly codigo: "login_pendente" | "sessao_indisponivel", mensagem: string) }
export function pedir(socket: string, metodo: "GET" | "POST", caminho: string, corpo?: unknown, timeoutMs = 5000): Promise<{ status: number; corpo: any }>
export function ehTelaDeLogin(url: string): boolean
export function telaDeOrigem(url: string): string
export function linhaDeLogin(d: { via: "fundo" | "withClient"; motivo: "redirecionamento" | "sem_tokens"; perfil: string; subconta: string; url: string; navegacoes: number; ultima: { em: string; url: string } | null; desde: string; agora?: Date }): Record<string, unknown>
export function registrarLogin(arquivo: string, linha: Record<string, unknown>): void
export function argsDoCarregador(execArgv: string[]): string[]
```

- `PRAZOS`: comente cada número numa linha. `tentativaInvisivelMs` é a primeira tentativa do Chrome invisível antes de concluir que o GHL pediu login; `aberturaChromeMs` é a margem de cada abertura do Chrome; `esperaLoginMs` é quanto a janela de login espera alguém entrar (4 min e meio, dentro dos "até 5 minutos" da spec); `pedidoTokensMs` é o corte do pedido `/tokens` ou `/renovar` do comando ao processo de fundo; `filaEscritaMs` é a espera máxima na fila de escrita; `subidaMs` é a espera pela subida do processo de fundo; `encerrarMs` é a espera pelo encerramento de um processo velho.
- `caminhosDaSessao`: monta os quatro caminhos com `path.join`. Se `Buffer.byteLength(socket) > 103`, lance `Error` com "caminho do socket longo demais (N bytes; o macOS aceita 103): <caminho>".
- `prepararDir`: `fs.mkdirSync(dir, { recursive: true, mode: 0o700 })` seguido de `fs.chmodSync(dir, 0o700)` (o `mode` do `mkdir` não vale para pasta que já existe). A permissão da pasta é a proteção do socket (decisão A23 da spec): só o usuário entra.
- `impressaoDigital`: a raiz padrão é a pasta `src` do extractor, `path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")`. Liste com `fs.readdirSync(raiz, { recursive: true })`, fique com o que termina em `.ts` ou `.js`, ordene, e alimente um `createHash("sha256")` com, para cada arquivo, o caminho relativo, um `"\0"`, o conteúdo e outro `"\0"`. Devolva os 16 primeiros caracteres do hex. Serve para o comando perceber que o processo de fundo vivo roda código mais velho (decisão A28).
- `ErroSessao`: `super(mensagem)`, `this.name = "ErroSessao"`. Os dois códigos são os da decisão A31; viram `error.code` no envelope `--json`.
- `pedir`: HTTP sobre socket Unix com `http.request({ socketPath: socket, path: caminho, method: metodo, agent: false, timeout: timeoutMs, headers })`. Com corpo, mande `content-type: application/json` e `content-length`. Junte a resposta como texto; `JSON.parse` quando não estiver vazia, `{}` quando estiver, e `{ message: <texto> }` se o parse falhar. Resolva com `{ status: res.statusCode ?? 0, corpo }`. No evento `timeout`, monte `const e = Object.assign(new Error("o processo de fundo não respondeu <METODO> <caminho> em <N> s"), { code: "ETIMEOUT" })` e `req.destroy(e)`. Repasse `error` para o `reject`. `agent: false` evita timer de keep-alive. O `code` separa "o processo de fundo demorou" de "o processo de fundo caiu", e quem chama trata os dois de jeitos diferentes.
- `ehTelaDeLogin`: `new URL(url)` dentro de `try` (erro → `false`); `hostname === "app.gohighlevel.com" && pathname === "/" && searchParams.has("url")`. O GHL redireciona para `app.gohighlevel.com/?url=<destino>` quando pede login (decisão A47); só `app.gohighlevel.com` (decisão A5).
- `telaDeOrigem`: `new URL(url).searchParams.get("url") ?? ""` dentro de `try` (erro → `""`); o `searchParams` já decodifica.
- `linhaDeLogin`: `{ em: (d.agora ?? new Date()).toISOString(), via: d.via, motivo: d.motivo, perfil: d.perfil, subconta: d.subconta, origem: telaDeOrigem(d.url) || d.url, navegouAntes: d.navegacoes > 0, navegacoesDesdeSubida: d.navegacoes, ultimaNavegacao: d.ultima, processoDesde: d.desde }`. É o registro de cada pedido de login (decisão A1/A7): horário, tela de origem e se havia navegação antes. `motivo` separa a tela de login de verdade (`redirecionamento`) da captura que só não achou tokens a tempo (`sem_tokens`, que pode ser rede lenta); `via` separa o caminho antigo (`withClient`) do processo de fundo (`fundo`).
- `registrarLogin`: `fs.mkdirSync(path.dirname(arquivo), { recursive: true, mode: 0o700 })` e `fs.appendFileSync(arquivo, JSON.stringify(linha) + "\n", { mode: 0o600 })`.
- `argsDoCarregador`: percorre a lista; `--require=x` e `--import=x` entram como estão; `--require` ou `--import` seguidos de um valor separado entram como `--require=<valor>` (ou `--import=<valor>`); o resto sai. Remova repetidos mantendo a ordem. Sob o `tsx`, o `execArgv` traz o carregador (`--require .../tsx/dist/preflight.cjs --import .../tsx/dist/loader.mjs`, ou `--import tsx` quando o comando roda com `node --import tsx`), sem o qual o processo de fundo não lê `.ts` (achado A50); sob o test runner, traz também dezenas de opções que não podem ir junto.

No teste, o servidor de socket Unix é `http.createServer(...).listen(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "amsock-")), "s"))`; feche com `server.closeAllConnections()` e `server.close()` no fim de cada teste, inclusive no do servidor que nunca responde (senão o processo do teste não termina).

---

## Etapa 2 — Trava com rótulo, fila de escrita e registro de login no caminho antigo

**Tela:** não

**Arquivos:**
- mudar `extractor/src/auth/lock.ts`
- mudar `extractor/test/lock.test.ts`
- mudar `extractor/src/auth/token.ts`
- mudar `extractor/test/token.test.ts`
- mudar `extractor/src/cli/shared.ts`
- criar `extractor/test/fila-escrita.test.ts`
- mudar as chamadas de `withClient` em `extractor/src/cli/extract.ts`, `extractor/src/cli/oportunidades.ts`, `extractor/src/cli/formularios.ts`, `extractor/src/cli/workflows.ts`, `extractor/src/cli/agenda.ts`, `extractor/src/cli/workflow-editar.ts`, `extractor/src/cli/mensageria.ts`, `extractor/src/cli/anotacoes.ts`, `extractor/src/cli/contato.ts`, `extractor/src/cli/conversas.ts`

**O que prova a etapa:** os casos de `travarChrome`, `lerTrava`, `comandoDoPid` e `entrarNaFila` vão em `extractor/test/lock.test.ts`; os de `captureTokens` e do registro de login vão em `extractor/test/token.test.ts`; `extractor/test/fila-escrita.test.ts` contém só o teste estático da classificação das 30 chamadas de `withClient`.
- `travarChrome(arq, "fundo")` grava `"<pid> fundo"` no arquivo; `lerTrava(arq)` devolve `{ pid: process.pid, rotulo: "fundo" }`; a função devolvida solta e apaga o arquivo.
- Trava segurada pelo pid 1 (sempre vivo) com rótulo `discover`: a segunda tentativa lança `TravaOcupada` com `pid === 1`, `rotulo === "discover"` e mensagem que cita o discover e "(pid 1)".
- Pid 1 com rótulo `fundo`: a mensagem diz que o processo de fundo do automaster está com o perfil, "(pid 1)".
- Pid 1 sem rótulo (arquivo só com `1`, formato das versões antigas): mensagem com "(pid 1)" e o caminho do arquivo.
- Trava de pid morto (`2147480000`) é roubada, como hoje.
- Trava de pid vivo cujo arquivo foi modificado antes do último boot da máquina (o teste usa `fs.utimesSync` para pôr a data em 1970) é roubada: pid de antes do boot pode ter sido reaproveitado.
- `lerTrava` devolve `null` para arquivo ausente, para pid morto e para arquivo de antes do boot.
- `comandoDoPid(process.pid)` contém `node`; `comandoDoPid(2147480000)` é `null`.
- `entrarNaFila(arq, log)` com a fila livre resolve na hora, grava `"<pid> escrita"` e a função devolvida apaga o arquivo.
- Fila segurada pelo pid 1, liberada pelo teste 300 ms depois (o teste apaga o arquivo): `entrarNaFila` espera e resolve; o `log` foi chamado exatamente uma vez, com "esperando a vez" e "(pid 1)".
- Fila segurada para sempre, com `esperaMaxMs` de 300: rejeita com mensagem que cita "fila de escrita" e "(pid 1)".
- O padrão de `esperaMaxMs` é `PRAZOS.filaEscritaMs` (120 s): o teste lê o texto de `src/auth/lock.ts` e confere que a assinatura de `entrarNaFila` contém `esperaMaxMs: number = PRAZOS.filaEscritaMs`.
- `captureTokens` com uma página falsa cuja `url()` é `https://app.gohighlevel.com/?url=%2Fv2%2Flocation%2FX%2Fautomation%2Fworkflows`, `timeoutMs: 700` e `aoVerLogin` contando chamadas: rejeita com a mensagem de hoje ("Não capturei os tokens...") e `aoVerLogin` foi chamado exatamente uma vez, com essa URL.
- O mesmo `captureTokens` com `aoVerLogin: registroDeLoginAntigo(<arquivo temporário>, "/perfil/x", "X")` deixa no arquivo exatamente uma linha JSON, com `via: "withClient"`, `motivo: "redirecionamento"`, `perfil: "/perfil/x"`, `subconta: "X"`, `origem: "/v2/location/X/automation/workflows"`, `navegouAntes: false`, e sem chave com "token" ou "bearer".
- Página falsa sem tela de login: `aoVerLogin` nunca é chamado.
- Teste estático: lê os arquivos `extractor/src/cli/*.ts`, recorta cada `async function runX` e confere que toda função que chama `withClient(` está numa das duas listas abaixo, nem uma a mais nem uma a menos; as 19 de escrita passam `{ escrita: ... }` na chamada; as 11 de leitura não passam. Um comando novo que chame `withClient` sem ser classificado quebra o teste.

**Como fazer:**

Padrões do repositório: ESM com imports terminando em `.js`; testes com `node:test` e `node:assert/strict` (ver `extractor/test/lock.test.ts`); página falsa do Playwright por cast `as unknown as Page` (padrão de falsos por cast em `extractor/src/cli/cassete.ts:44-56`); `npm run typecheck` cobre `src` e `test`; lint proíbe promise solta; espera com `setTimeout` de `node:timers/promises`; tokens nunca em disco nem em log. `PRAZOS`, `caminhosDaSessao`, `linhaDeLogin`, `registrarLogin` e `ehTelaDeLogin` já existem em `extractor/src/fundo/comum.ts`.

1. `extractor/src/auth/lock.ts`. Hoje `travarChrome` (`lock.ts:31-62`) grava só o pid, lança `Error` genérico quando outro processo vivo segura, e rouba trava de pid morto. Mude para:

```ts
export class TravaOcupada extends Error { constructor(readonly pid: number, readonly rotulo: string, readonly arquivo: string, mensagem: string) }
export function vivo(pid: number): boolean               // a função que já existe em lock.ts:20-28, agora exportada
export function comandoDoPid(pid: number): string | null
export function lerTrava(arquivo: string): { pid: number; rotulo: string } | null
export function travarChrome(arquivo = lockPath(), rotulo = ""): () => void
export async function entrarNaFila(arquivo: string, log: (m: string) => void, esperaMaxMs: number = PRAZOS.filaEscritaMs): Promise<() => void>
```

- Formato do arquivo: `"<pid>"` ou `"<pid> <rótulo>"`. Leitura: `conteudo.trim().split(/\s+/)`, pid = `Number` do primeiro pedaço, rótulo = segundo ou `""`.
- `comandoDoPid`: `execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf-8" }).trim()` dentro de `try`; erro ou texto vazio → `null`. Serve para conferir que um pid de trava ou do `SingletonLock` é mesmo de quem diz ser (pid pode ser reaproveitado).
- `lerTrava`: `null` se o arquivo não existe, se o pid não é número, se `!vivo(pid)`, ou se `fs.statSync(arquivo).mtimeMs < Date.now() - os.uptime() * 1000` (gravado antes do boot). Senão `{ pid, rotulo }`.
- `travarChrome`: mantém o laço de duas tentativas com `flag: "wx"`. No `EEXIST`, usa `lerTrava`; se devolveu dono vivo e `dono.pid !== process.pid`, lança `TravaOcupada` com a mensagem por rótulo:
  - `fundo`: "o processo de fundo do automaster já está com o perfil do Chrome (pid X)."
  - `discover`: "o discover está com o perfil do Chrome (pid X): feche a janela dele e repita."
  - `escrita`: "outra escrita automaster está em andamento (pid X)."
  - vazio: "outro processo automaster está com <arquivo> (pid X). Se tiver certeza de que ele morreu, apague <arquivo>."
  Senão apaga o arquivo (órfão) e tenta de novo, como hoje. A função de soltar compara o pid lido do arquivo (primeiro pedaço) com `process.pid`, não o texto inteiro.
- `entrarNaFila`: laço que tenta `travarChrome(arquivo, "escrita")`. Em `TravaOcupada`, na primeira vez chama `log("outra escrita automaster em andamento (pid X); esperando a vez...")`, espera 500 ms e tenta de novo. Passado `esperaMaxMs`, lança `Error("a fila de escrita está com o pid X há mais de N s; se esse processo travou, encerre-o e repita")`. Qualquer outro erro sobe. Comente com `// ponytail: espera por sondagem a cada 500 ms, sem ordem de chegada; fila de verdade se a disputa virar rotina.` É a decisão A38/A39: escrita espera a vez do anterior em vez de falhar, e a fila cobre o comando inteiro. `PRAZOS` vem de `extractor/src/fundo/comum.ts`; 120 s cabem no corte de 600 s do MCP somados ao resto do comando.
- O comentário do topo de `lock.ts:5-15` passa a explicar as duas travas: a do perfil (`~/.automaster/chrome.lock`, de quem abre o perfil) e a da fila de escrita (`~/.automaster/sessao/escrita.lock`). Tire a frase de que a escrita é serial por causa do `SingletonLock`.
- O primeiro teste de `extractor/test/lock.test.ts:10-18` procura `/já está com o Chrome \(pid 1\)/`; troque por `/\(pid 1\)/`, que é o que continua valendo.

2. `extractor/src/auth/token.ts` (`captureTokens`, hoje `token.ts:52-95`, com `timeoutMs` como terceiro argumento posicional): o terceiro argumento vira `opcoes: { timeoutMs?: number; aoVerLogin?: (url: string) => void } = {}` (padrão de `timeoutMs` 300_000). Logo depois do primeiro `goto` e a cada volta do laço de 500 ms, se `opcoes.aoVerLogin` existe, ainda não foi chamado e `ehTelaDeLogin(page.url())`, chame-o uma vez com `page.url()`. O resto não muda. Troque o `sleep` local de `token.ts:43` por `setTimeout` de `node:timers/promises`.

3. `extractor/src/cli/shared.ts`:
- Exporte `registroDeLoginAntigo(arquivo: string, perfil: string, subconta: string): (url: string) => void`, que devolve `(url) => registrarLogin(arquivo, linhaDeLogin({ via: "withClient", motivo: "redirecionamento", perfil, subconta, url, navegacoes: 0, ultima: null, desde: new Date().toISOString() }))`. É a linha de base da semana de medição (decisão A1/A7: o registro entra desde o começo, ainda no caminho antigo).
- `withClient` (`shared.ts:38-59`) ganha um quarto parâmetro `opcoes: { escrita?: boolean } = {}`. Logo no começo, antes de `openSession()`:

```ts
const sairDaFila = opcoes.escrita ? await entrarNaFila(caminhosDaSessao().escrita, log) : () => {};
```

  e `sairDaFila()` no `finally`, depois do `soltar()`. As duas chamadas de `captureTokens` (a inicial e a do `refresh`) passam `{ aoVerLogin: registroDeLoginAntigo(caminhosDaSessao().logins, defaultUserDataDir(), locationId) }` (`defaultUserDataDir` de `extractor/src/auth/session.ts`). O resto do `withClient` não muda.

4. Classifique as 30 chamadas (linhas de hoje). Leitura, sem `opcoes` (11): `runSmoke` (`smoke.ts:245`), `runOportunidades` (`oportunidades.ts:22`), `runFormularios` (`formularios.ts:31`), `runWorkflowsAoVivo` (`workflows.ts:53`), `runAgenda` (`agenda.ts:65`), `runWhatsapp` (`mensageria.ts:22`), `runAnotacoes` (`anotacoes.ts:41`), `runTags` (`anotacoes.ts:134`), `runTimeline` (`contato.ts:58`), `runConversas` (`conversas.ts:19`), `runConversasBuscar` (`conversas.ts:246`).

Escrita (19), com o valor exato de `escrita`:

| Função | Arquivo:linha | `escrita` |
|---|---|---|
| `runExtract` | `extract.ts:18` | `true` |
| `runOportunidadeAcao` | `oportunidades.ts:89` | `true` |
| `runPipeline` | `oportunidades.ts:179` | `true` |
| `runFormularioAcao` | `formularios.ts:138` | `!!opts.confirmo` |
| `runFormularioEstilo` | `formularios.ts:319` | `!!opts.confirmo` |
| `runWorkflowAcao` | `workflows.ts:124` | `true` |
| `runAgendaAcao` | `agenda.ts:198` | `true` |
| `runWorkflowEditar` | `workflow-editar.ts:50` | `!!o.confirmo` |
| `runWhatsappEnviar` | `mensageria.ts:48` | `true` |
| `runConfig` | `mensageria.ts:86` | `escritas.includes(opts.o)` |
| `runGrupo` | `mensageria.ts:123` | `opts.o !== "interno-checar"` |
| `runAnotacaoAcao` | `anotacoes.ts:111` | `true` |
| `runTagAcao` | `anotacoes.ts:169` | `!!o.confirmo` |
| `runContatoEditar` | `contato.ts:235` | `true` |
| `runConversasAnexar` | `conversas.ts:110` | `true` |
| `runConversasEnviar` | `conversas.ts:162` | `true` |
| `runConversasMarcar` | `conversas.ts:194` | `true` |
| `runConversasRascunho` | `conversas.ts:213` | `opts.acao !== "listar"` |
| `runConversasMensagem` | `conversas.ts:232` | `true` |

`runExtract` só lê do GHL, mas escreve no disco local na pasta `<loc>/<YYYY-MM-DD_HHmm>/`: dois `extract` da mesma subconta no mesmo minuto gravariam na mesma pasta ao mesmo tempo. Até a 0.27.0 a trava do Chrome os serializava; agora quem serializa é a fila. Onde a guarda de `--confirmo` vem antes do `withClient` (oportunidade, pipeline, workflow-acao, agenda-acao, whatsapp-enviar, anotação), o comando só chega lá escrevendo, daí `true`. Onde a prévia acontece dentro do `withClient` sem `--confirmo`, a prévia é leitura e não entra na fila.

O teste estático: para cada arquivo de `extractor/src/cli/`, divida o texto nos começos `async function ` (com ou sem `export `), pegue o nome e o trecho até a próxima função; o conjunto de nomes cujo trecho contém `withClient(` tem que ser igual à união das duas listas; nos 19 de escrita o trecho contém `{ escrita:`; nos 11 de leitura não contém `escrita:`.

---

## Etapa 3 — Cliente HTTP sobre fetch, ligado só por `AUTOMASTER_CLIENTE_FETCH=1`

**Tela:** não

**Arquivos:**
- mudar `extractor/src/api/client.ts`
- mudar `extractor/src/auth/token.ts`
- mudar `extractor/src/auth/session.ts`
- mudar `extractor/src/cli/shared.ts`
- criar `extractor/test/client.test.ts`

**O que prova a etapa:** todos os casos rodam contra um servidor HTTP local (`http.createServer` em `127.0.0.1`, porta 0), sem Chrome, com `throttleMs: 0`, e cada teste fecha o servidor no fim com `server.closeAllConnections()` e `server.close()`, inclusive o do servidor que nunca responde.
- `getJson` manda `authorization: Bearer <bearer>`, `token-id`, `channel: APP`, `source: WEB_USER`, `version: 2021-07-28`, `accept: application/json` e um `user-agent` de navegador; devolve o JSON parseado.
- Com `tokens.userAgent` preenchido, é esse o `user-agent` que chega; sem ele, chega o `UA_PADRAO` exportado de `client.ts`.
- `401` uma vez: `onRefresh` é chamado uma única vez, a repetição sai com o bearer novo e a chamada devolve o JSON. `401` duas vezes seguidas: lança erro com "HTTP 401" e `onRefresh` foi chamado só uma vez.
- `429` seguido de `200` (com `backoffMs: 1`): devolve o JSON. `429` sempre: lança "HTTP 429" depois de exatamente 5 pedidos ao servidor.
- `putJson`, `postJson` e `deleteJson` com corpo mandam `content-type: application/json` e o corpo como JSON; o `DELETE` com corpo chega com o corpo.
- `getJson` não manda `content-type`.
- `postMultipart` com um `FormData` (campo de texto e um arquivo `Blob` com nome): chega `content-type: multipart/form-data; boundary=...`, o campo, o nome do arquivo e os bytes; `extraHeaders` `{ version: "v4" }` sobrescreve o `version`.
- `getJsonNoAuth` não manda `authorization`, `token-id` nem `cookie`, mesmo com cookies nos tokens.
- Com `tokens.cookies = { "<host:porta do servidor de teste>": "a=1; b=2" }`, as chamadas autenticadas a esse host mandam `cookie: a=1; b=2`; a outro host, nenhuma.
- Servidor que não responde, com `timeoutMs: 50`: lança erro com "tempo esgotado" e sem "HTTP".
- Erro HTTP mantém o formato de hoje: `"<MÉTODO> <url> → HTTP <status> <até 200 caracteres do corpo>"` (é dele que `extractor/src/saida.ts:34-38` tira o código `http_NNN`).
- Espia: depois de `espiar()`, as respostas de `getJson`, `postMultipart` e `getJsonNoAuth` aparecem em `coletar()` na ordem, e um segundo `coletar()` vem vazio; sem `espiar()`, `coletar()` é `[]`.
- `cabecalhosCookie(contexto)` com um contexto falso cujo `cookies(url)` devolve `[{name:"a",value:"1"},{name:"b",value:"2"}]` para `https://backend.leadconnectorhq.com/` e `[]` para `https://services.leadconnectorhq.com/` resulta em `{ "backend.leadconnectorhq.com": "a=1; b=2" }`, sem a chave do host vazio.
- Com a opção `contexto` (um contexto falso cujo `request.fetch` registra os argumentos), `getJson` passa pelo `contexto.request` e não manda cabeçalho `cookie` à mão (o contexto do Playwright já põe os cookies do perfil).

**Como fazer:**

Padrões do repositório: ESM com imports terminando em `.js`; testes com `node:test` e `node:assert/strict`; espera com `setTimeout` de `node:timers/promises` (troque a cópia local `sleep` de `client.ts:8` por ele); `npm run typecheck` cobre `src` e `test`; lint proíbe promise solta.

Contexto: hoje `GhlClient` (`extractor/src/api/client.ts:15-121`) faz toda chamada por `this.context.request` do Playwright, que manda os cookies do perfil e corta em 30 s. Depois desta etapa o `fetch` do Node existe, mas **o caminho padrão continua sendo o `context.request`**: o `fetch` só entra com `AUTOMASTER_CLIENTE_FETCH=1`. O plugin em uso por todas as sessões roda desta pasta (decisão A46), então trocar o padrão antes da prova ao vivo A19 mandaria toda tool ao vivo de outro projeto escrever por um cliente sem prova (decisão A19/A41).

1. `extractor/src/auth/token.ts:3-6`: `Tokens` ganha dois campos opcionais, `cookies?: Record<string, string>` (cabeçalho `cookie` pronto, por host) e `userAgent?: string`. Ninguém que já usa `Tokens` muda.

2. `extractor/src/auth/session.ts`: exporte

```ts
export const HOSTS_API = ["backend.leadconnectorhq.com", "services.leadconnectorhq.com"];
export async function cabecalhosCookie(contexto: Pick<BrowserContext, "cookies">, hosts = HOSTS_API): Promise<Record<string, string>>
```

Para cada host, `await contexto.cookies(`https://${host}/`)` (o Playwright já filtra por domínio e caminho), junte como `nome=valor` separados por `"; "` e só inclua o host se a string não for vazia.

3. `extractor/src/api/client.ts`:
- Exporte `UA_PADRAO` (o texto de `client.ts:5-6`).
- Construtor novo: `constructor(tokens: Tokens, private onRefresh: () => Promise<Tokens>, opcoes: { throttleMs?: number; backoffMs?: number; timeoutMs?: number; contexto?: BrowserContext } = {})`, com padrões 200, 1000 e 30_000. Comente o `contexto`: `// caminho padrão até a prova A19; sai quando os comandos passarem a pedir tokens ao processo de fundo`.
- `authHeaders(url)`: os cabeçalhos de hoje (`client.ts:45-55`), com `user-agent` = `this.tokens.userAgent ?? UA_PADRAO`, mais `cookie` quando **não** há `contexto` e `this.tokens.cookies?.[new URL(url).host]` existe.
- Um método privado `enviar(metodo, url, headers, corpo?: { json?: unknown; form?: FormData })` que devolve `{ status: number; ok: boolean; json(): Promise<unknown>; text(): Promise<string> }`:
  - com `this.contexto`: multipart por `this.contexto.request.post(url, { headers, multipart: form })`, JSON por `this.contexto.request.fetch(url, { method, headers, data: json })` (o que `client.ts:64` e `client.ts:98` fazem hoje), adaptando `status()`/`ok()`;
  - sem: `fetch(url, { method: metodo.toUpperCase(), headers, body: form ?? (json === undefined ? undefined : JSON.stringify(json)), signal: AbortSignal.timeout(this.timeoutMs) })`. Erro com `name === "TimeoutError"` vira `Error("<MÉTODO> <url> → tempo esgotado (N s)")`. Nunca defina `content-type` à mão no multipart: o `fetch` monta com o boundary.
- `request` (JSON) e `postMultipart` passam a usar `enviar`, mantendo exatamente a lógica de hoje (`client.ts:58-79` e `client.ts:90-113`): throttle antes, `marcarEscrita()` em todo método que não é GET e em todo multipart, `401` renova uma vez com `this.tokens = await this.onRefresh()`, `429` espera `backoffMs * (tentativa + 1)` até a quarta repetição, `res.json().catch(() => ({}))` no sucesso, a espia (`guardar`) e a mensagem de erro com `safeBody` (agora lendo `text()` do objeto de `enviar`).
- `getJsonNoAuth`: `fetch` (ou o `contexto`, se houver) com só `user-agent` e `accept`, nunca `authorization`, `token-id` ou `cookie` (a URL pré-assinada do Firebase não pode receber token do GHL). Mesmo corte de 30 s, mesma espia.

4. `extractor/src/cli/shared.ts` (`withClient`): depois de cada `captureTokens`, complete os tokens com `cookies: await cabecalhosCookie(context)` (na captura inicial e dentro do `refresh`), e crie o cliente com `new GhlClient(tokens, refresh, process.env.AUTOMASTER_CLIENTE_FETCH === "1" ? {} : { contexto: context })`. Sem a variável, tudo segue como hoje; o Chrome visível continua abrindo nos dois casos.

Os falsos de `extractor/src/cli/cassete.ts:44-56` e dos testes existentes não mudam: eles substituem o cliente inteiro.

---

## Etapa 4 — Prova ao vivo A19: smoke e escritas descartáveis com fetch

**Tela:** não

**Arquivos:**
- criar `docs/sessao-de-fundo.md`
- criar `extractor/test/prova-a19.test.ts`
- mudar `extractor/src/api/client.ts` só se alguma rota falhar apenas com `fetch` (ver o passo 8)

**O que prova a etapa:** `extractor/test/prova-a19.test.ts` lê `docs/sessao-de-fundo.md` (caminho a partir de `extractor/`: `../docs/sessao-de-fundo.md`) e falha enquanto a prova não estiver registrada. Ele exige a seção `## Prova A19 — cliente sobre fetch` com estas linhas (expressões regulares com `m`):
- `^- Data: \d{4}-\d{2}-\d{2}$`
- `^- Tempo de \`tags\` antes \(Chrome visível, cliente antigo\): \d+(,\d+)? s$`
- `^- Smoke com o cliente antigo: \d+ ok, \d+ falhou, \d+ pulado$`
- `^- Smoke com fetch: \d+ ok, \d+ falhou, \d+ pulado$`
- `^- Checagens que falharam só com fetch: nenhuma$`
- `^- Extração completa com fetch \(download sem auth do Firebase\): \d+ workflows, 0 falhas$`
- `^- Escrita JSON \(criar tag e criar nota\): ok$`
- `^- DELETE com corpo \(remover tag do contato e repor\): ok$`
- `^- DELETE sem corpo \(apagar tag e apagar nota\): ok$`
- `^- Multipart \(anexo\): ok`
- `^- Cabeçalhos além dos de hoje: .+$`
- `^- Resíduo: .+$`

O teste também converte o tempo de antes (vírgula decimal) em número e exige que seja maior que zero.

**Como fazer:**

Esta etapa roda contra o GHL de verdade, na subconta de teste Instaltech, com o Chrome do usuário (o perfil `~/.automaster/chrome-profile` já logado; se pedir login, o usuário loga na janela). Cada comando abre e fecha um Chrome visível, como hoje. **Rode tudo em série, um comando de cada vez, até o fim; nunca duas escritas ao mesmo tempo.** Nenhum token vai para arquivo: só a saída JSON dos comandos, que não traz token.

Sem a variável `AUTOMASTER_CLIENTE_FETCH`, o comando usa o cliente antigo (o `context.request` do Playwright); com `AUTOMASTER_CLIENTE_FETCH=1`, usa o `fetch`.

Antes de começar, avise o usuário: **durante esta etapa nenhuma outra sessão do Claude Code pode usar as tools automaster** (elas abrem o mesmo perfil e o comando de teste falha com a trava). Confira que nenhum Chrome está no perfil: `ps -axo args | grep -F automaster/chrome-profile | grep -v grep` tem de sair vazio.

Variáveis, num terminal em `extractor/`:

```bash
LOC=Xb9gDxwxYhdqtprGcb5E                 # Instaltech, subconta de teste
CONTATO=uWqujqll20tRuglV3mLt             # contato de teste da Instaltech
export AUTOMASTER_DUMPS=~/.automaster/dumps   # onde estão os dumps da Instaltech (sem isso, contato-editar não acha o dump)
```

0. Sobra de rodada anterior: `npm run tags -- -l $LOC --termo teste-a19 --json` não pode listar nada. Se listar `teste-a19-fetch`, apague antes com o cliente antigo: `npm run tag-acao -- -l $LOC --acao apagar --tag teste-a19-fetch --confirmo --json`.
1. Tempo de antes (cliente antigo, Chrome visível), três vezes, anote a mediana do `real`:
   `for i in 1 2 3; do /usr/bin/time -p npm run tags -- -l $LOC --json > /dev/null; done 2>&1 | grep real`
2. Smoke com o cliente antigo: `npm run smoke -- -l $LOC --contato $CONTATO --json > /tmp/smoke-antigo.json; echo $?`. Leia `data.resumo` da última linha (`ok`, `falhou`, `pulado`) e os nomes com `estado: "falhou"` em `data.checagens`.
3. Smoke com fetch: `AUTOMASTER_CLIENTE_FETCH=1 npm run smoke -- -l $LOC --contato $CONTATO --json > /tmp/smoke-fetch.json; echo $?`. Compare: toda checagem que falhou com fetch tem que ter falhado também com o antigo (aí é mudança da API, não do cliente).
4. Extração com fetch, que exercita o download sem auth do Firebase (`getJsonNoAuth`), numa pasta descartável:
   `AUTOMASTER_CLIENTE_FETCH=1 AUTOMASTER_DUMPS=/tmp/am-a19 npm run extract -- --location $LOC 2>&1 | tee /tmp/extract-a19.log`. Conte `grep -c FALHOU /tmp/extract-a19.log` (tem que dar 0) e o número de workflows da linha "N workflows. Baixando...". Desfaça: `rm -rf /tmp/am-a19 /tmp/extract-a19.log`.
5. Tag da subconta (POST JSON e DELETE sem corpo):
   - `AUTOMASTER_CLIENTE_FETCH=1 npm run tag-acao -- -l $LOC --acao criar --nome teste-a19-fetch --confirmo --json` (deve sair `"ok":true`).
   - Confira: `AUTOMASTER_CLIENTE_FETCH=1 npm run tags -- -l $LOC --termo teste-a19 --json` lista uma tag.
   - Desfaça: `AUTOMASTER_CLIENTE_FETCH=1 npm run tag-acao -- -l $LOC --acao apagar --tag teste-a19-fetch --confirmo --json` (DELETE sem corpo).
   - Confira: `npm run tags -- -l $LOC --termo teste-a19 --json` não lista nada.
6. Tag do contato (DELETE com corpo e POST JSON), com a tag `teste-automaster`, que já existe no dump e nenhum workflow cita:
   - `AUTOMASTER_CLIENTE_FETCH=1 npm run contato-editar -- -l $LOC -i $CONTATO --tag -teste-automaster --json` (DELETE com corpo).
   - Veja se o contato tinha a tag antes, pelo snapshot que o comando acabou de gravar: `f=$(ls -t $AUTOMASTER_DUMPS/_contatos/$LOC/$CONTATO/ | head -1); python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["raw"]["contact"]["tags"])' $AUTOMASTER_DUMPS/_contatos/$LOC/$CONTATO/$f`.
   - Se a lista tinha `teste-automaster`, reponha: `AUTOMASTER_CLIENTE_FETCH=1 npm run contato-editar -- -l $LOC -i $CONTATO --tag +teste-automaster --json`. Se não tinha, a remoção foi vazia: rode `--tag +teste-automaster` e depois `--tag -teste-automaster`, os dois com `AUTOMASTER_CLIENTE_FETCH=1`, o que exercita os dois sentidos e devolve o contato ao estado de antes.
7. Nota (POST JSON e DELETE sem corpo):
   - `AUTOMASTER_CLIENTE_FETCH=1 npm run anotacao-acao -- -l $LOC --contato $CONTATO --tipo nota --acao criar --texto "teste A19 fetch: apagar" --confirmo --json`; anote o `id` da nota na resposta.
   - Desfaça: `AUTOMASTER_CLIENTE_FETCH=1 npm run anotacao-acao -- -l $LOC --contato $CONTATO --tipo nota --acao apagar -i <id> --confirmo --json`.
   - Confira: `npm run anotacoes -- -l $LOC --contato $CONTATO --tipo nota --json` não traz a nota.
8. Multipart (anexo; sobe o arquivo e não manda nada ao contato):
   - `echo iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg== | base64 -d > /tmp/a19.png`
   - `AUTOMASTER_CLIENTE_FETCH=1 npm run conversas-anexar -- -l $LOC -i $CONTATO --arquivo /tmp/a19.png --json`; a resposta traz `urls`.
   - Não há desfazer para o arquivo no armazenamento do CRM: anote a URL como resíduo. Apague `/tmp/a19.png` e os `/tmp/smoke-*.json`.
9. Se alguma escrita ou desfazer falhar só com fetch: **primeiro desfaça com o cliente antigo** (sem a variável), conforme o que ficou: `npm run tag-acao -- -l $LOC --acao apagar --tag teste-a19-fetch --confirmo --json`; `npm run contato-editar -- -l $LOC -i $CONTATO --tag +teste-automaster --json` (só se o snapshot mostrou que o contato tinha a tag); `npm run anotacao-acao -- -l $LOC --contato $CONTATO --tipo nota --acao apagar -i <id> --confirmo --json`; e confira com `tags --termo teste-a19` e `anotacoes`. Depois acrescente em `authHeaders` (`extractor/src/api/client.ts`) `origin: https://app.gohighlevel.com` e `referer: https://app.gohighlevel.com/`, rode de novo só o que falhou (com a variável, e desfazendo do mesmo jeito) e anote na linha "Cabeçalhos além dos de hoje" o que precisou. Se ainda falhar, pare a etapa e devolva com a saída: a troca do cliente não pode seguir. Sem falha, a linha diz "nenhum".

Crie `docs/sessao-de-fundo.md` com o título `# Sessão de fundo`, um parágrafo de uma frase dizendo que o arquivo reúne o contrato do processo de fundo e as provas ao vivo, e a seção `## Prova A19 — cliente sobre fetch` com as linhas exatamente no formato que o teste exige (número com vírgula decimal, ex. `7,4 s`). A linha de resíduo lista a URL do anexo e diz que a tag criada e a nota foram apagadas e que a tag do contato voltou ao estado de antes.

---

## Etapa 5 — Servidor do processo de fundo no socket Unix, com Chrome falso

**Tela:** não

**Arquivos:**
- criar `extractor/src/fundo/servidor.ts`
- criar `extractor/test/servidor.test.ts`
- mudar `extractor/src/auth/token.ts` (exportar `payloadDeJwt`)

**O que prova a etapa:** cada teste sobe o servidor num socket dentro de `fs.mkdtempSync(path.join(os.tmpdir(), "amfundo-"))` com um navegador falso que conta as capturas e devolve tokens montados por um `jwt(payload)` de teste (`xxx.<payload base64url>.yyy`, como em `extractor/test/token.test.ts:5-9`), e encerra o servidor no fim com `await srv.encerrar("fim do teste")` dentro de `finally` (ou `after`). As chamadas usam `pedir` de `extractor/src/fundo/comum.ts`.
- `GET /versao` responde `{ versao, pid: process.pid, perfil, esperandoLogin: false }` (o `perfil` é o passado ao servidor); com o falso dizendo que espera login, `esperandoLogin: true`.
- `POST /tokens {subconta}` na primeira vez captura uma vez e devolve `{ bearer, tokenId, cookies, userAgent }`; a segunda chamada devolve o mesmo sem nova captura.
- Cinco `POST /tokens` simultâneos sem nada em cache resultam em uma captura só, e os cinco recebem os mesmos tokens.
- Com o relógio injetado (`agora`) a 30 s do `exp` de um dos tokens, o pedido recaptura; a 2 min, não. Token sem `exp` conta como válido.
- Recaptura no máximo uma vez por pedido: se o falso devolver de novo um token já perto de vencer, o pedido é entregue assim mesmo (o teste confere 1 captura, não um laço).
- Subconta fora da lista `locations` do token-id: recaptura passando essa subconta ao navegador. Token-id sem `locations` (ou lista vazia): não recaptura por subconta.
- Subconta fora da lista, com o falso devolvendo sempre um token-id sem ela: dois `POST /tokens` seguidos para ela resultam em 1 captura no total (o segundo sai do cache). Depois de o falso passar a devolver um token-id novo (outro texto), um pedido para essa subconta fora da lista volta a recapturar uma vez.
- `POST /renovar {subconta, bearer, tokenId}` com o par atual: recaptura e devolve o par novo. Com um par antigo (diferente do atual): devolve o atual sem capturar. Três `/renovar` simultâneos com o mesmo par atual: uma captura só.
- Navegador falso que lança `ErroSessao("login_pendente", ...)`: resposta `503 {code: "login_pendente", message}`. Que lança `Error("x")`: `503 {code: "sessao_indisponivel", message: "x"}`.
- Três `POST /tokens` simultâneos com o falso lançando `login_pendente`: 1 captura e três respostas `503 login_pendente`. Um quarto pedido, feito depois de os três voltarem, tenta capturar de novo (2 capturas no total): o erro não fica guardado.
- `POST /tokens` sem `subconta`: `400`.
- `POST /encerrar`: responde `200`, depois chama `fechar()` do navegador, apaga o arquivo do socket e chama `aoEncerrar`.
- Ociosidade, com `mock.timers.enable({ apis: ["setTimeout"] })` ligado antes de subir o servidor: depois de um pedido, avançar `OCIOSO_MS - 1` não encerra; avançar mais 1 ms encerra (navegador fechado, `aoEncerrar` chamado). Um pedido no meio (3 h, pedido, mais 3 h) adia o encerramento. O teste confere também que `OCIOSO_MS === 4 * 60 * 60 * 1000`.
- O arquivo do socket nasce com permissão `0600`, e um arquivo velho no caminho do socket (sobra de processo morto) não impede a subida.
- O `log` injetado nunca recebe o texto de nenhum bearer ou token-id entregue.

**Como fazer:**

Padrões do repositório: ESM com imports terminando em `.js`; testes com `node:test` e `node:assert/strict`; espera com `setTimeout` de `node:timers/promises`; lint proíbe promise solta (use `void` em chamadas que não esperam, como em handlers de evento); tokens nunca em log nem em disco. `ErroSessao` e `pedir` já existem em `extractor/src/fundo/comum.ts`.

Em `extractor/src/auth/token.ts:9-17`, exporte `payloadDeJwt` (hoje privada).

`extractor/src/fundo/servidor.ts`:

```ts
export const OCIOSO_MS = 4 * 60 * 60 * 1000;   // decisão A18
export const MARGEM_MS = 60_000;                // decisão A15/A49: vencido ou a menos de 60 s
export interface Navegador {
  capturar(subconta: string): Promise<Tokens>;   // navega até a subconta e devolve tokens com cookies e userAgent
  esperandoLogin(): boolean;
  fechar(): Promise<void>;
}
export async function iniciarServidor(o: {
  socket: string; navegador: Navegador; versao: string; perfil: string;
  ociosoMs?: number; agora?: () => number; log?: (m: string) => void; aoEncerrar?: () => void;
}): Promise<{ encerrar(motivo: string): Promise<void> }>
```

- Subida: `fs.rmSync(o.socket, { force: true })` (quem chama já tem a trava do perfil, então um arquivo ali é órfão), `http.createServer(...)`, `listen(o.socket)`, depois `fs.chmodSync(o.socket, 0o600)`. Resolva quando estiver escutando.
- Rotas, todas com resposta JSON:
  - `GET /versao` → `{ versao, pid: process.pid, perfil: o.perfil, esperandoLogin: navegador.esperandoLogin() }`
  - `POST /tokens {subconta}` → `200` com os tokens
  - `POST /renovar {subconta, bearer, tokenId}` → `200` com os tokens
  - `POST /encerrar` → `200 {ok: true}` e, em seguida (`setImmediate`), `encerrar("pedido")`
  - qualquer outra → `404`; corpo inválido ou sem `subconta` → `400 {code: "erro", message}`
  - `ErroSessao` → `503 {code: e.codigo, message}`; outro erro → `503 {code: "sessao_indisponivel", message}`.
- Estado: `atual: Tokens | null`, `emCurso: Promise<Tokens> | null` e `jaTentadas: Set<string>` (subcontas já recapturadas com o token-id atual).
- `precisa(t, subconta, falho?)` diz se é preciso capturar e por quê: sem token (`inicio`); vencido pelo relógio de parede (`Math.min(exp do bearer, exp do token-id) * 1000 - agora() < MARGEM_MS`, `exp` lido com `payloadDeJwt`; sem `exp` = válido) (`vencido`); subconta fora de `payloadDeJwt(tokenId).locations` quando ela é lista não vazia **e** fora de `jaTentadas` (`subconta`); ou `falho` igual ao par atual (`401`). Sem timer de renovação: a conferência é só no pedido (decisão A15/A7/A13/A49). O `jaTentadas` impede que uma subconta que a navegação nunca põe na lista (lista com teto de tamanho, acesso retirado) faça cada pedido navegar no app, que é a causa suspeita de queda de login (A7).
- `obter(subconta, falho?)`:
  1. Se `!precisa(atual, ...)`, devolva `atual`.
  2. Se há `emCurso`, `await emCurso` **sem** engolir o erro: quem esperava uma captura que falhou recebe o mesmo erro (mesmo código e mensagem), e não abre outra captura (senão a janela de login reabriria uma vez por pedido em espera, e cada reabertura viraria uma linha falsa no registro de logins). Se deu certo e agora não precisa, devolva `atual`.
  3. Se ainda precisa e não há `emCurso`: `const motivo = precisa(...)`; `emCurso = navegador.capturar(subconta)`; no sucesso, se o `tokenId` novo difere do anterior, `jaTentadas.clear()`; guarde em `atual`; se o motivo era `subconta`, `jaTentadas.add(subconta)`; zere `emCurso` no `finally`. Devolva o resultado sem reconferir (no máximo uma captura por pedido).
- `/renovar` é `obter(subconta, {bearer, tokenId})`: se o par atual já difere do que falhou, `precisa` não acusa `401` e o atual sai na hora.
- Log, uma linha por pedido, sem tokens: `tokens subconta=<id> cache` ou `tokens subconta=<id> motivo=<inicio|vencido|subconta|401>`; erros como `erro subconta=<id> <código>: <mensagem>`; encerramento como `encerrando (<motivo>)`. Quem escreve o horário é o `log` injetado.
- Ociosidade: `tocar()` faz `clearTimeout` do timer anterior e agenda `timer = setTimeout(() => void encerrar("ociosidade"), ociosoMs)` seguido de `timer.unref()`: o `listen` do socket já segura o processo vivo, e um timer com ref de 4 h impediria o processo do teste de terminar. Chame `tocar()` na subida, no começo e no fim de cada pedido.
- `encerrar(motivo)`: idempotente (uma promise guardada). Limpa o timer, `server.close()` e `server.closeAllConnections()`, `await navegador.fechar()` (erro só vai para o log), `fs.rmSync(o.socket, { force: true })`, chama `o.aoEncerrar?.()`.

O processo de fundo nunca chama o GHL: só entrega tokens. Isso mantém o rastro de escrita do envelope `--json` (`extractor/src/saida.ts:11-26`) no processo do comando.

---

## Etapa 6 — Chrome de fundo: invisível, janela só para login, registro de logins

**Tela:** não

**Arquivos:**
- criar `extractor/src/fundo/chrome.ts`
- criar `extractor/test/chrome-fundo.test.ts`
- mudar `extractor/src/auth/token.ts`
- mudar `extractor/test/token.test.ts`

**O que prova a etapa:** sem Chrome no CI (decisão A52): os testes usam um contexto e uma página falsos injetados no `ChromeDeFundo`. O Chrome real é provado ao vivo pelo comando `sessao`.
- `captureTokens` com uma página falsa cuja `url()` já é a tela de login (`https://app.gohighlevel.com/?url=%2Fv2%2F...`) e `pararNoLogin: true` rejeita com `PedidoDeLogin` (com a `url`) em menos de 2 s.
- A mesma página sem `pararNoLogin`, com `timeoutMs: 700`, rejeita com `SemTokens`, cuja mensagem segue "Não capturei os tokens...".
- Página falsa que emite um evento `request` para `https://backend.leadconnectorhq.com/x` com `allHeaders()` trazendo `authorization: Bearer B`, `token-id: T` e `user-agent: U` resolve com `{ bearer: "B", tokenId: "T" }`, e a opção `cabecalhos` recebe uma vez esses cabeçalhos.
- `uaHeadless({ "user-agent": "... HeadlessChrome/154 ..." })` é `true`; `uaHeadless({ "sec-ch-ua": "\"HeadlessChrome\";v=\"154\"" })` é `true`; com `user-agent` de Chrome normal e `sec-ch-ua` com `"Google Chrome"`, é `false`.
- `uaDoPerfil(perfil)` com `Last Version` contendo `154.0.8037.98` devolve um user-agent com `Chrome/154.0.0.0` e sem `Headless`; sem o arquivo, devolve `UA_PADRAO` de `extractor/src/api/client.ts`.
- `donoDoPerfil(perfil, comandoDe)` com `SingletonLock` sendo link simbólico para `maquina-1` (pid 1, vivo) e `comandoDe` devolvendo `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=<perfil>` devolve `{ pid: 1, invisivel: false }`; com `--headless` no comando, `{ pid: 1, invisivel: true }`; com `comandoDe` devolvendo `/sbin/launchd` (pid reaproveitado), `null`; link para `maquina-2147480000` (morto), `null`; sem o link, `null`.
- `ChromeDeFundo.capturar("X")` com o contexto falso, cuja página emite os tokens no `goto` da tela de workflows: o lançador foi chamado uma vez com `headless: true`, `channel: "chrome"` e o `userAgent` de `uaDoPerfil`; os tokens voltam com `userAgent` e `cookies`; o último `goto` da página foi `about:blank`; o `log` recebeu `ua_headless=nao`. Com o falso mandando `user-agent` com `HeadlessChrome`, o `log` recebe `ua_headless=sim`.
- Depois de uma captura, o contexto falso emite `close` (o Chrome morreu): a captura seguinte chama o lançador de novo (2 lançamentos) e devolve tokens.
- Contexto falso cujo `goto` lança "Target page, context or browser has been closed" na primeira vez: `capturar` fecha, lança de novo uma vez e devolve tokens (2 lançamentos); se lança sempre, `capturar` rejeita depois de exatamente 2 lançamentos.
- Página falsa que, no primeiro lançamento (invisível), fica na tela de login, e no segundo (com janela) emite os tokens: o segundo lançamento tem `headless: false`; o registro de logins ganha exatamente uma linha com `via: "fundo"`, `motivo: "redirecionamento"`, `subconta: "X"`; `esperandoLogin()` é `true` durante a espera (o teste lê no `goto` do segundo contexto) e `false` depois; o contexto com janela foi fechado no fim; a próxima `capturar` lança de novo com `headless: true`.
- `donoDoPerfil` acusando outro Chrome com janela: `capturar` rejeita com `ErroSessao` `sessao_indisponivel` com "(pid 1)" e o lançador nunca é chamado.
- `ChromeDeFundo.perfil` devolve o caminho passado ao construtor.

**Como fazer:**

Padrões do repositório: ESM com imports terminando em `.js`; testes com `node:test` e `node:assert/strict`; falsos do Playwright por cast `as unknown as Page` / `as unknown as BrowserContext` (padrão em `extractor/src/cli/cassete.ts:44-56`); espera com `setTimeout` de `node:timers/promises`; tokens nunca em disco nem em log. Já existem: `ehTelaDeLogin`, `linhaDeLogin`, `registrarLogin`, `ErroSessao` e `PRAZOS` em `extractor/src/fundo/comum.ts`; `vivo` e `comandoDoPid` em `extractor/src/auth/lock.ts`; `cabecalhosCookie` em `extractor/src/auth/session.ts`; `UA_PADRAO` em `extractor/src/api/client.ts`; a interface `Navegador` em `extractor/src/fundo/servidor.ts`; e `captureTokens(page, locationId, opcoes: { timeoutMs?; aoVerLogin? })` em `extractor/src/auth/token.ts`.

1. `extractor/src/auth/token.ts`:
   - `export class PedidoDeLogin extends Error { constructor(readonly url: string) }` com mensagem "o GHL pediu login (<url>)".
   - `export class SemTokens extends Error`, com a mensagem de hoje ("Não capturei os tokens. Faça login na janela do Chrome e abra a subconta, depois rode de novo.").
   - As opções de `captureTokens` ganham `pararNoLogin?: boolean` e `cabecalhos?: (h: Record<string, string>) => void`. Logo depois do primeiro `goto` e a cada volta do laço de 500 ms, se `opcoes.pararNoLogin && ehTelaDeLogin(page.url())`, lance `PedidoDeLogin(page.url())`. No `onRequest`, quando os dois tokens forem achados, chame `opcoes.cabecalhos?.(h)` com os cabeçalhos daquele pedido. No fim sem tokens, lance `SemTokens`. O resto do comportamento (e a opção `aoVerLogin`) fica igual.

2. `extractor/src/fundo/chrome.ts`:

```ts
export function uaDoPerfil(perfil: string): string
export function uaHeadless(h: Record<string, string>): boolean
export function donoDoPerfil(perfil: string, comandoDe: (pid: number) => string | null = comandoDoPid): { pid: number; invisivel: boolean } | null
type Lancar = (perfil: string, opcoes: { headless: boolean; channel: "chrome"; userAgent: string }) => Promise<BrowserContext>;
export class ChromeDeFundo implements Navegador {
  constructor(readonly perfil: string, registroLogins: string, log: (m: string) => void,
    lancar: Lancar = (p, op) => chromium.launchPersistentContext(p, op), comandoDe = comandoDoPid)
}
```

- `uaDoPerfil`: lê `path.join(perfil, "Last Version")` (o Chrome grava a própria versão ali a cada abertura), pega o número antes do primeiro ponto e monta `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/<major>.0.0.0 Safari/537.36`. Arquivo ausente ou sem número: `UA_PADRAO`. É o user-agent de Chrome normal no modo invisível (decisão A12), e o mesmo que o `GhlClient` usa (vai no campo `userAgent` dos tokens).
- `uaHeadless`: `/headless/i.test(h["user-agent"] ?? "") || /headless/i.test(h["sec-ch-ua"] ?? "")`. O override de `userAgent` do Playwright troca o cabeçalho `user-agent`, mas não necessariamente o `sec-ch-ua`; o log mede os dois nos pedidos reais.
- `donoDoPerfil`: `fs.readlinkSync(path.join(perfil, "SingletonLock"))` dá `<máquina>-<pid>`; pid = número depois do último `-`. Se não for inteiro positivo, for `process.pid` ou `!vivo(pid)`: `null`. Confirme com `comandoDe(pid)`: o comando tem de conter `Google Chrome` e `--user-data-dir=<perfil>`; senão `null` (pid reaproveitado). Devolva `{ pid, invisivel: comando.includes("--headless") }`. Qualquer erro de leitura: `null`. Fecha o item C5 do backlog (decisão A26).
- `ChromeDeFundo` implementa `Navegador`:
  - estado: `contexto`, `pagina`, `comJanela`, `loginAberto`, `navegacoes = 0`, `ultima = null`, `desde = new Date().toISOString()`.
  - `abrir(comJanela)`: `const dono = donoDoPerfil(this.perfil, this.comandoDe)`. Se `dono?.invisivel`: é sobra de um processo de fundo morto à força (o Chrome invisível ficou sem dono); `log("sobra de Chrome invisível no perfil (pid X); encerrando")`, `process.kill(dono.pid, "SIGTERM")`, sonde `vivo` a cada 200 ms por até 10 s; se continuar vivo, lance `ErroSessao("sessao_indisponivel", "o Chrome invisível que sobrou no perfil (pid X) não encerrou; encerre-o e repita.")`. Se `dono` com janela: lance `ErroSessao("sessao_indisponivel", "o perfil <perfil> está aberto por outro Chrome (pid X). Feche esse Chrome e repita: o perfil é só do processo de fundo do automaster.")`. Senão `this.contexto = await this.lancar(this.perfil, { headless: !comJanela, channel: "chrome", userAgent: uaDoPerfil(this.perfil) })`: mesmas opções nos dois modos, sempre o Chrome do sistema pelo Playwright (decisão A9, a chave dos cookies não muda). Registre `this.contexto.on("close", () => { this.contexto = null; this.pagina = null; })`, para que um Chrome morto (crash, atualização, `pkill`) seja reaberto na próxima captura. Página = `contexto.pages()[0] ?? await contexto.newPage()`.
  - `fecharContexto()`: `await this.contexto?.close()` engolindo erro, zera `contexto` e `pagina`. É o fechamento limpo do Chrome (decisão A8).
  - `navegarECapturar(subconta, opcoes)`: `captureTokens(pagina, subconta, { ...opcoes, cabecalhos: (h) => this.log(`ua_headless=${uaHeadless(h) ? "sim" : "nao"}`) })`; no sucesso, `navegacoes++`, `ultima = { em: new Date().toISOString(), url: pagina.url() }`, monte `{ ...tokens, cookies: await cabecalhosCookie(contexto), userAgent: uaDoPerfil(perfil) }`, e então `await pagina.goto("about:blank").catch(() => {})` antes de devolver: entre capturas o Chrome fica parado de verdade, sem a SPA do GHL rodando em segundo plano por horas (renovação, polling, reconexão ao acordar), que poderia navegar sozinha para a tela de login sem ninguém registrar.
  - `capturar(subconta)`: se não há contexto ou ele está com janela, `fecharContexto()` e `abrir(false)`. `const tentar = () => this.navegarECapturar(subconta, { pararNoLogin: true, timeoutMs: PRAZOS.tentativaInvisivelMs })`. Tente; se falhar com `PedidoDeLogin` ou `SemTokens` (o segundo cobre uma tela de login que o GHL tenha mudado de endereço), siga para o caminho de login; com `ErroSessao`, relance; com outro erro (Chrome caiu no meio), `log("o Chrome caiu (<mensagem>); reabrindo uma vez")`, `fecharContexto()`, `abrir(false)` e tente uma segunda vez, que, se falhar com `PedidoDeLogin`/`SemTokens`, segue para o login, e com outro erro relança.
  - Caminho de login (`login(subconta, erro)`): `registrarLogin(this.registroLogins, linhaDeLogin({ via: "fundo", motivo: erro instanceof PedidoDeLogin ? "redirecionamento" : "sem_tokens", perfil: this.perfil, subconta, url: erro instanceof PedidoDeLogin ? erro.url : (this.pagina?.url() ?? ""), navegacoes: this.navegacoes, ultima: this.ultima, desde: this.desde }))`; `log("o GHL pediu login (origem <origem>); abrindo janela")`; `fecharContexto()`; `loginAberto = true`; `abrir(true)`; `return await navegarECapturar(subconta, { timeoutMs: PRAZOS.esperaLoginMs })`. Se essa espera der `SemTokens`, lance `ErroSessao("login_pendente", "O GHL pediu login e ninguém entrou na janela do Chrome em 4 min e meio. Faça login nela (e-mail e senha ou Google) e repita.")`. No `finally`: `loginAberto = false` e `fecharContexto()`; a próxima captura reabre invisível. Os dois jeitos de logar ficam liberados (decisão A4).
  - `esperandoLogin()`: `loginAberto`.
  - `fechar()`: `fecharContexto()`.

No teste, o contexto falso guarda os ouvintes de `on("close", fn)` e tem `emitirClose()`; `close()` registra a chamada e dispara os ouvintes; `pages()` devolve a página falsa; `cookies()` devolve `[]`. A página falsa guarda as URLs de `goto`, devolve em `url()` a última (ou a tela de login, conforme o caso) e, no `goto` da tela de workflows, chama os ouvintes de `request` com um pedido falso (`url()` = `https://backend.leadconnectorhq.com/x`, `allHeaders()` com os tokens). O `comandoDe` do teste devolve `null`, e o perfil é uma pasta temporária sem `SingletonLock`, exceto nos casos de `donoDoPerfil`.

---

## Etapa 7 — Processo de fundo: trava do perfil, socket, sinais e ociosidade

**Tela:** não

**Arquivos:**
- criar `extractor/src/fundo/processo.ts`
- criar `extractor/src/fundo/main.ts`
- criar `extractor/test/fixtures/fundo-falso.ts`
- criar `extractor/test/processo-fundo.test.ts`

**O que prova a etapa:** os testes sobem o processo de fundo falso (`test/fixtures/fundo-falso.ts`, que roda a mesma `executarFundo` do real com um navegador falso) como processo filho, com a pasta da sessão e a trava do perfil em pastas temporárias, e esperam o socket responder `GET /versao` (sondando a cada 100 ms, até 10 s). No `after`, todo processo subido pelo teste é encerrado (`process.kill(pid, "SIGKILL")` engolindo erro).
- O processo sobe, `GET /versao` responde com o `pid` do filho e o `perfil` passado no argv, e a trava do perfil contém `"<pid do filho> fundo"`.
- `SIGTERM` no processo: em até 5 s ele saiu com código 0, `<dir>/navegador.log` tem `fechado`, a trava e o socket sumiram.
- `SIGINT`: o mesmo.
- `POST /encerrar`: o mesmo.
- Ociosidade de ponta a ponta: com `FUNDO_FALSO_OCIOSO_MS=300`, sem pedidos, o processo sai sozinho em até 5 s e solta a trava.
- Socket órfão: com um arquivo qualquer no caminho do socket e a trava do perfil com `"2147480000 fundo"` (pid morto), o processo sobe e responde.
- Segundo processo com a mesma trava: subindo o falso duas vezes com o mesmo `lock` (o segundo depois de o primeiro responder), o segundo sai com código 1 e escreve no stdout uma linha com "não subiu" e "processo de fundo"; o primeiro continua respondendo.

**Como fazer:**

Padrões do repositório: ESM com imports terminando em `.js`; testes com `node:test` e `node:assert/strict`; espera com `setTimeout` de `node:timers/promises`; lint proíbe promise solta (`process.once("SIGTERM", () => void srv.encerrar("SIGTERM"))`); `npm run typecheck` cobre `test/fixtures` também; tokens nunca em disco nem em log. Os testes ficam em `extractor/test/*.test.ts`; arquivos em `test/fixtures/` não são rodados como teste. Já existem: `caminhosDaSessao`, `prepararDir`, `impressaoDigital`, `argsDoCarregador` e `pedir` em `extractor/src/fundo/comum.ts`; `travarChrome`, `lockPath` e `TravaOcupada` em `extractor/src/auth/lock.ts`; `iniciarServidor` e `Navegador` em `extractor/src/fundo/servidor.ts`; `ChromeDeFundo` em `extractor/src/fundo/chrome.ts`; `defaultUserDataDir` em `extractor/src/auth/session.ts`.

1. `extractor/src/fundo/processo.ts`:

```ts
export async function executarFundo(o: { caminhos: Caminhos; lock: string; perfil: string; navegador: Navegador; versao: string; ociosoMs?: number; log: (m: string) => void }): Promise<void>
```

`prepararDir(o.caminhos.dir)`; `const soltar = travarChrome(o.lock, "fundo")` (se lançar `TravaOcupada`, deixe o erro subir: quem chama loga "não subiu" e sai com 1, que é o caso do segundo processo numa corrida); `const srv = await iniciarServidor({ socket: o.caminhos.socket, navegador: o.navegador, versao: o.versao, perfil: o.perfil, ociosoMs: o.ociosoMs, log: o.log, aoEncerrar: () => { soltar(); process.exit(0); } })`; registre `process.once("SIGTERM", ...)` e `process.once("SIGINT", ...)` chamando `void srv.encerrar("SIGTERM")` / `"SIGINT"`. A trava precisa ser solta explicitamente: `SIGTERM` e `SIGINT` não disparam o `exit` em que `travarChrome` pendura a soltura (achado A24). `o.log("subiu (pid X, perfil P, versão V)")` no fim.

2. `extractor/src/fundo/main.ts`, a entrada que o comando dispara:

```ts
const [dir, lock, perfil] = process.argv.slice(2);
const caminhos = caminhosDaSessao(dir || undefined);
const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);
const p = perfil || defaultUserDataDir();
executarFundo({ caminhos, lock: lock || lockPath(), perfil: p, versao: impressaoDigital(), log,
  navegador: new ChromeDeFundo(p, caminhos.logins, log) })
  .catch((e) => { log(`não subiu: ${e instanceof Error ? e.message : e}`); process.exit(1); });
```

O perfil chega pelo argv (quem sobe o processo decide; o padrão é `~/.automaster/chrome-profile`). O stdout do processo de fundo vai para `fundo.log`, então o `log` é `console.log`.

3. `extractor/test/fixtures/fundo-falso.ts`: lê `[dir, lock, perfil]` de `process.argv.slice(2)`, grava em `<dir>/debug.txt` o valor de `process.env.DEBUG ?? "(nenhum)"`, monta um navegador falso e chama `executarFundo({ caminhos: caminhosDaSessao(dir), lock, perfil: perfil || "perfil-falso", navegador, versao: process.env.FUNDO_FALSO_VERSAO ?? "falsa", ociosoMs: Number(process.env.FUNDO_FALSO_OCIOSO_MS) || undefined, log: console.log }).catch((e) => { console.log(`não subiu: ${e instanceof Error ? e.message : e}`); process.exit(1); })`. O navegador falso: `capturar(sub)` anexa a subconta em `<dir>/capturas.log` e devolve `{ bearer: jwt({ exp: agora + 3600 }), tokenId: jwt({ exp: agora + 3600, locations: [sub] }), cookies: {}, userAgent: "UA falso" }` (`jwt` monta `xxx.<payload base64url>.yyy`; `agora` em segundos); `esperandoLogin()` devolve `false`; `fechar()` anexa `fechado` em `<dir>/navegador.log`.

4. No teste, suba com `spawn(process.execPath, [...argsDoCarregador(process.execArgv), fundoFalso, dir, lock, "perfil-x"], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ... } })`, com `fundoFalso = fileURLToPath(new URL("./fixtures/fundo-falso.ts", import.meta.url))`. Os caminhos ficam em `fs.mkdtempSync(path.join(os.tmpdir(), "amproc-"))`, curtos o bastante para o limite do socket; o `lock` é `<tmp>/chrome.lock`.

---

## Etapa 8 — Cliente do processo de fundo: subida automática, corrida, troca e religação

**Tela:** não

**Arquivos:**
- criar `extractor/src/fundo/cliente.ts`
- mudar `extractor/test/fixtures/fundo-falso.ts`
- criar `extractor/test/fixtures/sobe-e-sai.ts`
- criar `extractor/test/cliente-fundo.test.ts`

**O que prova a etapa:** os testes usam pastas temporárias para a sessão e para a trava do perfil, e o processo de fundo falso `test/fixtures/fundo-falso.ts` como `main`. No `after`, todo processo de fundo subido pelo teste é encerrado.
- Sem processo de fundo, `garantirFundo` sobe um, espera o socket responder e volta; `estadoDoFundo` mostra o pid dele, a versão esperada e o perfil das opções.
- Corrida: duas chamadas simultâneas de `garantirFundo` sem processo de fundo terminam com um processo só respondendo: o pid da trava do perfil é o mesmo que `/versao` informa, e `fundo.log` tem no máximo uma linha "não subiu".
- Processo de fundo vivo com versão `v1` e `garantirFundo` esperando `v2`: o velho é encerrado (pid antigo morto, sem socket dele) e um novo com `v2` responde.
- Processo de fundo vivo com perfil `a` e `garantirFundo` esperando perfil `b`: o mesmo, e o novo responde com perfil `b`.
- Processo de fundo vivo com versão `v1` esperando login (`FUNDO_FALSO_MODO=login`, `FUNDO_FALSO_LOGIN_MS=3000`, com um `tokensDoFundo` em andamento) e `garantirFundo` esperando `v2`: não troca; o pid continua o mesmo.
- Trava do perfil com `"1 discover"`: `garantirFundo` rejeita em menos de 1 s com `ErroSessao` de código `sessao_indisponivel` e mensagem citando o discover.
- Trava do perfil com `"1 fundo"` e nenhum socket (pid 1 é o `launchd`, não um processo de fundo: pid reaproveitado): `garantirFundo` apaga a trava, sobe um processo novo e volta com ele respondendo.
- Processo de fundo saindo (modo `sai-devagar`: ao receber `/tokens`, apaga o socket e só sai, soltando a trava, 1 s depois): disparado esse pedido, um `garantirFundo` simultâneo termina com um processo novo respondendo (pid diferente).
- `main` que nunca escuta (o teste grava na pasta temporária um `dorme.mjs` com `setTimeout(() => {}, 3000)` e passa esse caminho como `main`), com `esperaSubidaMs: 1000`: rejeita com `sessao_indisponivel` citando o caminho do `fundo.log`.
- `main` que grava `não subiu: perfil X inválido` e sai com 1 (um `falha.mjs` gravado pelo teste), com `esperaSubidaMs: 1000`: a rejeição é `sessao_indisponivel` e a mensagem contém "perfil X inválido".
- `DEBUG=pw:protocol` no processo do teste: o processo de fundo falso não recebe `DEBUG` (`<dir>/debug.txt` contém `(nenhum)`); o teste restaura `process.env.DEBUG` no fim.
- `tokensDoFundo` devolve os tokens do navegador falso. Com o falso no modo `morre-uma-vez` (o processo sai com código 1 no meio do primeiro pedido), o comando religa e recebe os tokens; no modo `morre-sempre`, desiste depois de exatamente uma religação, com `sessao_indisponivel`.
- Modo `mudo` (aceita o pedido e nunca responde) com `corteMs: 200`: rejeita com `sessao_indisponivel`, sem religar (`capturas.log` com uma linha só).
- Modo `login-mudo` (diz que espera login e nunca responde) com `corteMs: 200`: rejeita com `login_pendente`, sem religar.
- Modo `login` (o falso diz que espera login por `FUNDO_FALSO_LOGIN_MS`, padrão 800 ms, antes de devolver), com `avisoMs: 100`: o `log` recebe uma única vez o aviso "O GHL pediu login: há uma janela do Chrome esperando você entrar (até 4 min e meio).", e os tokens chegam.
- Resposta `503 {code: "login_pendente"}` (modo `erro-login`) vira `ErroSessao` com esse código, sem religar.
- `renovarNoFundo` manda o par que falhou e devolve o par novo.
- `encerrarFundo` com processo vivo devolve `true`, e depois dele a trava do perfil e o socket sumiram e o navegador falso registrou que foi fechado; sem processo, devolve `false`.
- Pipes desacoplados (critério da decisão A21/A50): um processo filho (`test/fixtures/sobe-e-sai.ts`) rodado por `execFile` com a saída presa em pipes chama `garantirFundo`, imprime "pronto" e sai; o `execFile` termina em menos de 10 s enquanto o processo de fundo continua respondendo `/versao`.

**Como fazer:**

Padrões do repositório: ESM com imports terminando em `.js`; testes com `node:test` e `node:assert/strict`; espera com `setTimeout` de `node:timers/promises`; lint proíbe promise solta; `npm run typecheck` cobre `test/fixtures`; tokens nunca em disco nem em log. Já existem: `caminhosDaSessao`, `prepararDir`, `impressaoDigital`, `argsDoCarregador`, `pedir`, `ErroSessao` e `PRAZOS` em `extractor/src/fundo/comum.ts`; `lerTrava`, `comandoDoPid` e `lockPath` em `extractor/src/auth/lock.ts`; `defaultUserDataDir` em `extractor/src/auth/session.ts`; o processo de fundo real é `extractor/src/fundo/main.ts`, que recebe `[dir, lock, perfil]` no argv; o falso é `extractor/test/fixtures/fundo-falso.ts`, com o mesmo argv, que hoje captura, grava `<dir>/capturas.log`, `<dir>/navegador.log` e `<dir>/debug.txt`.

1. `extractor/src/fundo/cliente.ts`:

```ts
export interface OpcoesFundo { caminhos: Caminhos; lock: string; main: string; perfil: string; versao: string; esperaSubidaMs: number; avisoMs: number; corteMs: number; log: (m: string) => void }
export function opcoesPadrao(log: (m: string) => void): OpcoesFundo
export async function estadoDoFundo(o: OpcoesFundo): Promise<{ versao: string; pid: number; perfil: string; esperandoLogin: boolean } | null>
export async function garantirFundo(o: OpcoesFundo): Promise<void>
export async function encerrarFundo(o: OpcoesFundo): Promise<boolean>
export async function tokensDoFundo(subconta: string, o: OpcoesFundo): Promise<Tokens>
export async function renovarNoFundo(subconta: string, falho: Tokens, o: OpcoesFundo): Promise<Tokens>
```

- `opcoesPadrao`: `caminhosDaSessao()`, `lockPath()`, `main` = `fileURLToPath(new URL(`./main${path.extname(fileURLToPath(import.meta.url))}`, import.meta.url))` (vale para `.ts` com `tsx` e `.js` no `dist`), `perfil` = `process.env.AUTOMASTER_PERFIL || defaultUserDataDir()`, `impressaoDigital()`, `PRAZOS.subidaMs`, 5_000, `PRAZOS.pedidoTokensMs`, `log`. `AUTOMASTER_PERFIL` existe só para a prova ao vivo usar um perfil descartável.
- `estadoDoFundo`: `pedir(socket, "GET", "/versao", undefined, 2000)`; status 200 → corpo; erro de conexão ou outro status → `null`.
- `subir` (interna): `prepararDir`; guarde `tamanhoAntes` = tamanho atual de `fundo.log` (0 se não existe); `const fd = fs.openSync(o.caminhos.log, "a", 0o600)`; `const env = { ...process.env }; delete env.DEBUG;` (com `DEBUG=pw:*` o Playwright escreveria no `fundo.log` os cabeçalhos com os tokens); `spawn(process.execPath, [...argsDoCarregador(process.execArgv), o.main, o.caminhos.dir, o.lock, o.perfil], { detached: true, stdio: ["ignore", fd, fd], env, cwd: path.resolve(path.dirname(o.main), "..", "..") })` (a pasta do extractor, onde `--import=tsx` se resolve, tanto para `src/fundo/main.ts` quanto para `test/fixtures/fundo-falso.ts`), `filho.unref()`, `fs.closeSync(fd)`. Nada dos pipes do comando passa ao filho: é o que impede o MCP de esperar 600 s pelo fim dos pipes (decisão A21/A50). Devolve `tamanhoAntes`.
- `garantirFundo`:
  1. `const estado = await estadoDoFundo(o)`. Se `estado` e `estado.versao === o.versao` e `estado.perfil === o.perfil` → volta.
  2. Se `estado` (código ou perfil diferente): se `estado.esperandoLogin`, `o.log("o processo de fundo (pid X) é de outra versão ou perfil, mas espera login; usando ele desta vez")` e volte (trocar agora fecharia a janela com alguém digitando). Senão `o.log("o processo de fundo (pid X) roda outra versão ou outro perfil; trocando...")` e `await encerrarFundo(o)` (decisão A28).
  3. Laço até `esperaSubidaMs`, sondando a cada 200 ms:
     - `const dono = lerTrava(o.lock)`.
     - `dono?.rotulo === "discover"` → `ErroSessao("sessao_indisponivel", "o discover está com o perfil do Chrome (pid X): feche a janela dele e repita.")` (decisão A32: falha na hora).
     - `dono?.rotulo === "fundo"` e `!(comandoDoPid(dono.pid) ?? "").includes(o.main)` → trava órfã (pid reaproveitado depois de um processo de fundo morto à força): `o.log("trava do perfil órfã (pid X não é o processo de fundo); apagando")`, `fs.rmSync(o.lock, { force: true })`, e siga para a próxima volta.
     - Sem dono e sem `subir` nos últimos 2 s → `tamanhoAntes = subir(o)`. Isso cobre também o processo que estava saindo (ociosidade, troca, discover): ele fecha o socket antes de soltar a trava, e quem chega nessa janela sobe um processo novo assim que a trava fica livre. Na corrida de dois comandos, os dois podem subir; só um ganha a trava do perfil, o outro processo sai com 1 e os dois comandos acham o vencedor pela sondagem (achado A25).
     - Com dono vivo de rótulo `fundo` (o próprio processo de fundo subindo ou saindo) ou sem rótulo (um comando antigo segurando o perfil): só espere.
     - `estadoDoFundo(o)` respondeu → volta.
  4. Estourou → leia `fundo.log` a partir de `tamanhoAntes` (ou do fim menos 500 caracteres, se não houve `subir`), fique com os últimos 500 caracteres sem espaços nas pontas, e lance `ErroSessao("sessao_indisponivel", "o processo de fundo não respondeu em N s" + (trecho ? `: ${trecho}` : "") + (dono ? ` (o perfil está com o pid X)` : "") + `. Log completo em <log>`)`. O motivo (por exemplo `não subiu: <erro>`, gravado pelo `main.ts`) chega assim ao agente do MCP, que não lê o log.
- `encerrarFundo`: `estadoDoFundo`; `null` → `false`. Senão `POST /encerrar` (erro ignorado) e espere até `PRAZOS.encerrarMs`, sondando a cada 200 ms, até `lerTrava(o.lock)` ser `null` ou de outro pid; então `true`. Estourou → `ErroSessao("sessao_indisponivel", "o processo de fundo (pid X) não encerrou em 20 s")`.
- `pedirAoFundo(rota, corpo, o)` (interna, usada por `tokensDoFundo` e `renovarNoFundo`): até duas tentativas. Em cada uma: `await garantirFundo(o)`; um `setInterval(() => void checar(), o.avisoMs)` que consulta `estadoDoFundo` e, na primeira vez que vir `esperandoLogin`, chama `o.log("O GHL pediu login: há uma janela do Chrome esperando você entrar (até 4 min e meio).")` (uma vez por comando, não por tentativa); `pedir(socket, "POST", rota, corpo, o.corteMs)`; `clearInterval` no `finally`.
  - Status 200 → corpo.
  - Outro status → `ErroSessao(corpo.code === "login_pendente" ? "login_pendente" : "sessao_indisponivel", corpo.message ?? "resposta <status> do processo de fundo")`, sem nova tentativa (a mensagem não pode conter "HTTP").
  - Erro com `code === "ETIMEOUT"` (o processo de fundo está vivo e demorou): sem religar. Consulte `estadoDoFundo(o)`; se `esperandoLogin`, `ErroSessao("login_pendente", "o GHL pediu login e a janela do Chrome continua esperando: entre nela e repita.")`; senão `ErroSessao("sessao_indisponivel", "o processo de fundo não respondeu em N s. Veja <log>")`. Religar aqui abriria outra captura com outra janela e estouraria os 600 s do MCP.
  - Erro com `code` em `ECONNREFUSED`, `ECONNRESET`, `ENOENT` ou `EPIPE`, ou mensagem "socket hang up" (o processo morreu no meio): na primeira vez, `o.log("o processo de fundo caiu; religando uma vez...")` e repete; na segunda, `ErroSessao("sessao_indisponivel", "o processo de fundo caiu duas vezes durante o pedido: <mensagem>. Veja <log>")`.
  - Qualquer outro erro → `ErroSessao("sessao_indisponivel", <mensagem>)`.
- `tokensDoFundo` → `pedirAoFundo("/tokens", { subconta })`. `renovarNoFundo` → `pedirAoFundo("/renovar", { subconta, bearer: falho.bearer, tokenId: falho.tokenId })`.

2. `extractor/test/fixtures/fundo-falso.ts`: acrescente os modos por `FUNDO_FALSO_MODO`, aplicados em `capturar(sub)` depois de anexar a subconta em `<dir>/capturas.log`:
   - `morre-uma-vez`: se `<dir>/morreu` não existe, cria e `process.exit(1)`;
   - `morre-sempre`: `process.exit(1)`;
   - `login`: liga `esperando`, espera `Number(process.env.FUNDO_FALSO_LOGIN_MS) || 800` ms e desliga;
   - `mudo`: devolve uma promise que nunca resolve;
   - `login-mudo`: liga `esperando` e devolve uma promise que nunca resolve;
   - `erro-login`: lança `ErroSessao("login_pendente", "falso pediu login")`;
   - `sai-devagar`: `fs.rmSync(<socket>, { force: true })`, `setTimeout(() => process.exit(0), 1000)` e lança `Error("saindo")` (o `exit` solta a trava, porque `travarChrome` pendura a soltura nele).
   `esperandoLogin()` devolve `esperando`.

3. `extractor/test/fixtures/sobe-e-sai.ts`: lê `[dir, lock, main]` do argv, chama `garantirFundo({ caminhos: caminhosDaSessao(dir), lock, main, perfil: "perfil-x", versao: process.env.FUNDO_FALSO_VERSAO ?? "falsa", esperaSubidaMs: 15000, avisoMs: 5000, corteMs: 5000, log: console.log })`, imprime `pronto` e termina.

4. No teste, `main` aponta para `test/fixtures/fundo-falso.ts` (via `fileURLToPath(new URL("./fixtures/fundo-falso.ts", import.meta.url))`), o `versao` das opções é igual a `process.env.FUNDO_FALSO_VERSAO` definido pelo próprio teste, e o filho do teste de pipes roda com `execFile(process.execPath, [...argsDoCarregador(process.execArgv), sobeESai, dir, lock, main])`. Os caminhos ficam em `fs.mkdtempSync(path.join(os.tmpdir(), "amcli-"))`, curtos o bastante para o limite do socket.

---

## Etapa 9 — Comando `sessao` e códigos de erro no envelope `--json`

**Tela:** não

**Arquivos:**
- mudar `extractor/src/saida.ts`
- mudar `extractor/test/saida.test.ts`
- criar `extractor/src/cli/sessao.ts`
- mudar `extractor/src/cli.ts`
- mudar `extractor/package.json`
- mudar `extractor/test/cli-comandos.test.ts`
- criar `extractor/test/sessao-cli.test.ts`

**O que prova a etapa:**
- `falhar` com um erro que tem `codigo: "login_pendente"` emite `{ok: false, error: {code: "login_pendente", message}}`; com `codigo: "sessao_indisponivel"`, esse código; com `"GET x → HTTP 422 ..."`, segue `http_422`; com erro comum, `erro`. (O teste troca `process.exit` por uma função que lança, para não matar o runner, e restaura no fim.)
- A lista de comandos registrados no `--help` passa a incluir `sessao` (o teste de `cli-comandos.test.ts` atualizado com o nome novo, e continua exigindo "nem um a menos nem um a mais").
- `sessao --acao status --json` com `HOME` numa pasta temporária vazia: sai com código 0 em menos de 5 s, envelope `ok: true` com `data.rodando === false`, `data.versaoDoCodigo` com 16 caracteres hexadecimais e `data.perfilEsperado` terminando em `.automaster/chrome-profile`, e não cria o socket (status nunca sobe processo).
- `sessao --acao encerrar --json` no mesmo `HOME` vazio: `data.encerrado === false`.
- `sessao --acao tokens --json` sem `-l`: código 1 e envelope de erro com "-l".
- `sessao --acao qualquer --json`: código 1 e envelope de erro com "--acao".

**Como fazer:**

Padrões do repositório: ESM com imports terminando em `.js`; testes com `node:test` e `node:assert/strict`; testes de CLI por `spawnSync("npx", ["tsx", "src/cli.ts", ...], { cwd: <extractor>, env: { ...process.env, HOME: <tmp> }, encoding: "utf-8" })`, lendo o envelope da última linha do stdout; comando novo segue o formato `registrarX(program)` de um módulo em `extractor/src/cli/` (ver `extractor/src/cli.ts:8-34`), emite por `emitir(opts.json, dado)` e erra por `.catch(falhar)` (`extractor/src/saida.ts`), e entra em `scripts` do `package.json` como os outros (`"sessao": "tsx src/cli.ts sessao"`). Já existem: `estadoDoFundo`, `garantirFundo`, `encerrarFundo`, `tokensDoFundo`, `renovarNoFundo` e `opcoesPadrao` em `extractor/src/fundo/cliente.ts`; `impressaoDigital` e `caminhosDaSessao` em `extractor/src/fundo/comum.ts`; `payloadDeJwt` em `extractor/src/auth/token.ts`.

Esta etapa não muda o caminho dos comandos: eles continuam abrindo o Chrome como antes. O `sessao` é o jeito de exercitar o processo de fundo de verdade antes de qualquer comando depender dele.

1. `extractor/src/saida.ts:41-46` (`falhar`): o código passa a ser `typeof (e as { codigo?: unknown })?.codigo === "string" ? (e as { codigo: string }).codigo : codigo(message)`. É assim que `login_pendente` e `sessao_indisponivel` (decisão A31) chegam ao MCP no `error.code`.

2. `extractor/src/cli/sessao.ts`, `registrarSessao(program)`: comando `sessao`, descrição "processo de fundo que segura o Chrome invisível: status, subir, encerrar, tokens ou renovar", opções `--acao <a>` (`status | subir | encerrar | tokens | renovar`, padrão `status`), `-l, --location <id>` (exigido só por `tokens` e `renovar`) e `--json`. O `log` é `console.error` com `--json` e `console.log` sem (padrão de `extractor/src/cli/mensageria.ts:80`).
   - `status`: `const o = opcoesPadrao(log)`; `estadoDoFundo(o)` → `{ rodando, pid, versao, perfil, esperandoLogin, versaoDoCodigo: o.versao, perfilEsperado: o.perfil, atualizado: versao === o.versao && perfil === o.perfil, socket, log, logins }` (os três últimos são caminhos de `caminhosDaSessao()`). Nunca sobe processo.
   - `subir`: `garantirFundo` e depois o mesmo `status`.
   - `encerrar`: `{ encerrado: await encerrarFundo(...) }`.
   - `tokens`: `tokensDoFundo(loc, o)` e emite **só** o resumo, nunca os tokens: `{ expBearer, expTokenId, subcontaNaLista, hostsComCookie: Object.keys(t.cookies ?? {}), userAgent: t.userAgent }`, com os `exp` convertidos em texto ISO (`new Date(exp * 1000).toISOString()`, ou `null` sem `exp`) e `subcontaNaLista` = a subconta está em `payloadDeJwt(tokenId).locations`.
   - `renovar`: pega o par com `tokensDoFundo` e passa a `renovarNoFundo(loc, par, o)`, o que força uma captura nova (motivo `401` no log do processo de fundo); emite o mesmo resumo.
   - sem `-l` em `tokens`/`renovar`: `Error("--acao tokens e renovar exigem -l <locationId>")`; outra ação: `Error("--acao aceita status, subir, encerrar, tokens ou renovar")`.
   Registre em `extractor/src/cli.ts` (`registrarSessao(program)`), acrescente `"sessao"` em `COMANDOS` de `extractor/test/cli-comandos.test.ts:14-21` e o script no `package.json`.

---

## Etapa 10 — Prévia visual sem perfil e discover que encerra o processo de fundo

**Tela:** não

**Arquivos:**
- mudar `extractor/src/cli/formularios.ts`
- mudar `extractor/src/cli/extract.ts`
- mudar `extractor/src/auth/session.ts`
- criar `extractor/test/previa-visual.test.ts`

**O que prova a etapa:**
- `fotografarWidget(url, destino, abrir)` com um navegador falso injetado: `abrir` é chamado uma vez, com zero argumentos; a página nasce com viewport 480 x 900; recebe `goto(url)`; espera `form, input, button`; fotografa em `destino` com página inteira; e o navegador é fechado.
- Teste estático: o texto de `src/cli/formularios.ts`, no trecho de `fotografarWidget`, contém `chromium.launch(` e não contém `launchPersistentContext` (a prévia não usa o perfil).
- Se a espera do seletor falhar, `fotografarWidget` rejeita com a mensagem que diz que a página pública não renderizou nenhum campo em 15 s (com a URL), e o navegador é fechado do mesmo jeito.
- `spawnSync("npx", ["tsx", "src/cli.ts", "formulario-estilo", "-l", "X", "--acao", "previa-visual", "--json"], { cwd: <extractor>, env: { ...process.env, HOME: <tmp vazio> }, encoding: "utf-8" })`: código 1, a última linha do stdout é o envelope `{ok: false}` com a mensagem "previa-visual exige --id", e nada foi criado em `<HOME>/.automaster` (nem trava do perfil, nem pasta da sessão de fundo): a prévia não passa pela sessão.

**Como fazer:**

Padrões do repositório: ESM com imports terminando em `.js`; testes com `node:test` e `node:assert/strict`; testes de CLI por `spawnSync` (padrão de `extractor/test/cli-comandos.test.ts:24-27`, que usa `execFileSync`; com `spawnSync` dá para ler `status` e `stdout` de um comando que sai com 1); `-l` é `requiredOption` em `formulario-estilo` (`extractor/src/cli/formularios.ts:474`), por isso o teste passa `-l X`; saída `--json` só por `emitir`/`falhar` de `extractor/src/saida.ts`. Já existem: `encerrarFundo` e `opcoesPadrao` em `extractor/src/fundo/cliente.ts`; `donoDoPerfil` em `extractor/src/fundo/chrome.ts`; `TravaOcupada` em `extractor/src/auth/lock.ts`.

1. Prévia visual (decisão A33). Hoje ela roda dentro do `withClient` e usa a `page` do perfil para abrir uma página pública (`extractor/src/cli/formularios.ts:329-358`). Exporte de `formularios.ts`:

```ts
export async function fotografarWidget(url: string, destino: string,
  abrir: () => Promise<Browser> = () => chromium.launch({ channel: "chrome", headless: true })): Promise<void>
```

Dentro: `const navegador = await abrir()`; `try { const aba = await navegador.newPage({ viewport: { width: 480, height: 900 } }); await aba.goto(url, { waitUntil: "domcontentloaded" }); try { await aba.waitForSelector("form, input, button", { timeout: 15000 }); } catch { throw new Error(<a mensagem de hoje, formularios.ts:345-348>); } await aba.waitForTimeout(1500); await aba.screenshot({ path: destino, fullPage: true }); } finally { await navegador.close(); }`. É o Chrome do sistema, sem perfil e sem trava; a página não exige login. Mantenha os comentários de hoje sobre `networkidle` e `notrack=true`.

Em `runFormularioEstilo` (`formularios.ts:291`), trate `previa-visual` antes do `withClient`: exija `--id` (mesma mensagem de hoje), monte a URL e o destino como hoje (`formularios.ts:331-335`), chame `fotografarWidget`, emita `{ url, arquivo }` com `emitir` (ou o texto de hoje sem `--json`) e retorne. Tire o ramo `previa-visual` de dentro do callback; o callback deixa de usar a `page`.

2. Discover (decisão A32). Em `extractor/src/auth/session.ts`, `openSession(userDataDir = defaultUserDataDir(), rotulo = "")` passa `rotulo` para `travarChrome(lockPath(), rotulo)`. Antes de travar, se `donoDoPerfil(userDataDir)` devolver dono, lance `Error("o perfil <perfil> está aberto por outro Chrome (pid X). Feche esse Chrome e repita.")`.

Em `runDiscover` (`extractor/src/cli/extract.ts:78-109`), antes de abrir, um laço de até 3 tentativas:

```ts
const fundo = opcoesPadrao(console.log);
let sessao;
for (let i = 1; ; i++) {
  if (await encerrarFundo(fundo)) console.log("Processo de fundo encerrado: o discover usa o perfil com janela.");
  try { sessao = await openSession(undefined, "discover"); break; }
  catch (e) {
    if (!(e instanceof TravaOcupada && e.rotulo === "fundo")) throw e;
    if (i === 3) throw new Error("outro comando automaster está subindo o processo de fundo ao mesmo tempo; espere ele terminar e repita o discover.");
  }
}
```

Entre o `encerrarFundo` e a trava do discover, um comando de outra sessão pode subir um processo de fundo novo; o laço o encerra de novo em vez de o discover perder. Enquanto a janela do discover estiver aberta, a trava do perfil diz `discover`, e todo comando que precisar do processo de fundo falha na hora com a mensagem do discover.

3. O discover não tem teste automático (abriria uma janela de Chrome na máquina de quem roda os testes); a prova dele é ao vivo, junto da prova dos comandos pelo processo de fundo.

---

## Etapa 11 — Prova ao vivo do Chrome de fundo pela CLI `sessao`

**Tela:** não

**Arquivos:**
- mudar `docs/sessao-de-fundo.md`
- criar `extractor/test/prova-chrome-fundo.test.ts`
- mudar `extractor/src/fundo/chrome.ts` só se o passo 4 acusar `ua_headless=sim`

**O que prova a etapa:** `extractor/test/prova-chrome-fundo.test.ts` lê `../docs/sessao-de-fundo.md` e exige a seção `## Prova ao vivo do Chrome de fundo` com as linhas (regex com `m`):
- `^- Data: \d{4}-\d{2}-\d{2}$`
- `^- Captura invisível no perfil real \(sessao --acao tokens, partida fria\): \d+(,\d+)? s$`
- `^- Chrome do perfil com --headless: sim$`
- `^- Chrome invisível registrado como app no macOS \(System Events\): 0$`
- `^- Pedidos do Chrome invisível sem Headless \(user-agent e sec-ch-ua\): ok$`
- `^- Perfil aberto por outro Chrome vira erro com pid: ok$`
- `^- Login com janela e volta ao invisível: ok$`
- `^- SIGTERM fecha limpo \(exit_type Normal, trava e socket removidos\): ok$`
- `^- Chrome morto com o processo de fundo vivo: o pedido seguinte reabre: ok$`
- `^- kill -9 no processo de fundo: o pedido seguinte sai ok: ok$`

**Como fazer:**

Prova contra o GHL de verdade, na Instaltech, com o Chrome do sistema, pelo comando `sessao` (os outros comandos ainda abrem o Chrome do jeito antigo). **Em série, um comando de cada vez.** O passo de login exige o usuário presente para digitar a senha: peça a ele na hora. Nenhum token vai para arquivo: `sessao --acao tokens` só imprime vencimentos e o user-agent.

Antes de começar, avise o usuário: **durante esta etapa nenhuma outra sessão do Claude Code pode usar as tools automaster.** Com o processo de fundo de pé, o comando antigo de outra sessão falha com "o processo de fundo do automaster já está com o perfil"; e uma tool de outra sessão no meio do teste de perfil descartável trocaria o processo de fundo de perfil. Confira que nenhum Chrome está no perfil: `ps -axo args | grep -F automaster/chrome-profile | grep -v grep` sai vazio.

Terminal em `extractor/`:

```bash
LOC=Xb9gDxwxYhdqtprGcb5E                   # Instaltech, subconta de teste
PERFIL=$HOME/.automaster/chrome-profile
pid_chrome() { ps -axo pid=,args= | grep -F "MacOS/Google Chrome " | grep -F -- "--user-data-dir=$1" | grep -v grep | awk '{print $1}' | head -1; }
apps_do_pid() { osascript -e "tell application \"System Events\" to count (every process whose unix id is $1)"; }
```

`apps_do_pid` conta se o macOS registrou o processo como app com interface: um Chrome com janela dá 1; o invisível dá 0. Na primeira vez o macOS pede para o Terminal controlar o "System Events": aceite.

1. Partida fria: `npm run sessao -- --acao encerrar --json`. Depois `/usr/bin/time -p npm run sessao -- --acao tokens -l $LOC --json > /tmp/s1.json` e anote o `real`. A última linha de `/tmp/s1.json` tem `"ok":true`, `data.subcontaNaLista: true`, `data.expBearer` no futuro e `data.userAgent` sem `Headless`.
2. `ps -o args= -p $(pid_chrome $PERFIL)` contém `--headless`. `npm run sessao -- --acao status --json` mostra `rodando: true`, `atualizado: true` e `perfil` igual a `$PERFIL`.
3. `apps_do_pid $(pid_chrome $PERFIL)` imprime `0`.
4. `grep -c ua_headless=nao ~/.automaster/sessao/fundo.log` dá 1 ou mais e `grep -c ua_headless=sim ~/.automaster/sessao/fundo.log` dá 0. Se aparecer `ua_headless=sim`: em `abrir` de `extractor/src/fundo/chrome.ts`, depois de pegar a página, aplique o override por CDP nos dois modos (decisão A9): `const cdp = await contexto.newCDPSession(pagina); await cdp.send("Network.setUserAgentOverride", { userAgent: uaDoPerfil(perfil), userAgentMetadata: { brands: [{ brand: "Google Chrome", version: <major> }, { brand: "Chromium", version: <major> }, { brand: "Not=A?Brand", version: "24" }], fullVersion: <versão de Last Version>, platform: "macOS", platformVersion: "10.15.7", architecture: "arm", model: "", mobile: false } })`; rode `npm run sessao -- --acao encerrar --json` e os passos 1 a 4 de novo.
5. Perfil aberto por outro Chrome, num perfil descartável:
   - `npm run sessao -- --acao encerrar --json`; `mkdir -p /tmp/perfil-c5`; `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --user-data-dir=/tmp/perfil-c5 --no-first-run about:blank &`; espere 3 s.
   - `AUTOMASTER_PERFIL=/tmp/perfil-c5 npm run sessao -- --acao tokens -l $LOC --json`: `"ok":false`, `code` `sessao_indisponivel`, mensagem "aberto por outro Chrome (pid N)", com N igual a `pid_chrome /tmp/perfil-c5`.
   - `AUTOMASTER_PERFIL=/tmp/perfil-c5 npm run sessao -- --acao status --json`: `data.perfil` é `/tmp/perfil-c5` (confirma que o teste mediu o perfil certo).
   - Desfaça: `pkill -f -- "--user-data-dir=/tmp/perfil-c5"`; `npm run sessao -- --acao encerrar --json`; `rm -rf /tmp/perfil-c5`.
6. Login com janela, num perfil descartável vazio (usuário presente):
   - `npm run sessao -- --acao encerrar --json`; `rm -rf /tmp/perfil-login && mkdir /tmp/perfil-login`.
   - `AUTOMASTER_PERFIL=/tmp/perfil-login npm run sessao -- --acao tokens -l $LOC --json`. Meça: em menos de 40 s abre uma janela do Chrome na tela de login do GHL, e o stderr do comando mostra "O GHL pediu login: há uma janela do Chrome esperando você entrar (até 4 min e meio)." Com a janela aberta, `apps_do_pid $(pid_chrome /tmp/perfil-login)` imprime `1` (confere que o instrumento enxerga janela). `tail -1 ~/.automaster/sessao/logins.jsonl` tem `via` `fundo`, `motivo` `redirecionamento`, `perfil` `/tmp/perfil-login`, `origem` com `/automation/workflows` e `navegouAntes: false`.
   - O usuário entra na janela. O comando termina com `"ok":true` e a janela fecha.
   - `AUTOMASTER_PERFIL=/tmp/perfil-login npm run sessao -- --acao renovar -l $LOC --json` (força uma captura nova): `"ok":true`, sem janela; `ps -o args= -p $(pid_chrome /tmp/perfil-login)` contém `--headless` e `apps_do_pid $(pid_chrome /tmp/perfil-login)` imprime `0`. `AUTOMASTER_PERFIL=/tmp/perfil-login npm run sessao -- --acao status --json` mostra `data.perfil` `/tmp/perfil-login`.
   - Desfaça: `npm run sessao -- --acao encerrar --json`; `rm -rf /tmp/perfil-login`. A linha de teste fica no registro, marcada pelo `perfil`. Se o perfil principal pedir login logo depois, anote em `docs/sessao-de-fundo.md` como efeito deste teste, não como queda.
7. Chrome morto com o processo de fundo vivo: `npm run sessao -- --acao tokens -l $LOC --json` (perfil real; sobe o processo); `pkill -f -- "--user-data-dir=$PERFIL"`; espere 3 s; `npm run sessao -- --acao renovar -l $LOC --json` dá `"ok":true`, `tail -3 ~/.automaster/sessao/fundo.log` mostra `motivo=401` sem `erro`, e `pid_chrome $PERFIL` mostra um Chrome novo com `--headless`.
8. SIGTERM: pegue `data.pid` de `npm run sessao -- --acao status --json` e rode `kill -TERM <pid>`. Em até 10 s: `ls ~/.automaster/sessao/sock` e `cat ~/.automaster/chrome.lock` dão "No such file"; `pid_chrome $PERFIL` vazio; `python3 -c 'import json,os;print(json.load(open(os.path.expanduser("~/.automaster/chrome-profile/Default/Preferences")))["profile"]["exit_type"])'` imprime `Normal`.
9. kill -9 no processo de fundo: `npm run sessao -- --acao tokens -l $LOC --json` (sobe), pegue `data.pid` do `status` e rode `kill -9 <pid>`. Espere 10 s e anote se `pid_chrome $PERFIL` ainda mostra um Chrome (sobra do Playwright). Depois `npm run sessao -- --acao renovar -l $LOC --json` tem de dar `"ok":true` sozinho, sem intervenção, e no fim `ps -axo args | grep -F -- "--user-data-dir=$PERFIL" | grep -F "MacOS/Google Chrome " | grep -v grep | wc -l` dá 1. Se sobrou Chrome, o `fundo.log` mostra "sobra de Chrome invisível no perfil".
10. Encerre e limpe: `npm run sessao -- --acao encerrar --json`; `rm -f /tmp/s1.json`. Avise o usuário que as tools automaster das outras sessões voltaram a funcionar.

Acrescente a seção `## Prova ao vivo do Chrome de fundo` em `docs/sessao-de-fundo.md`, com as linhas exatamente no formato que o teste exige (vírgula decimal), e, abaixo delas, uma frase sobre o que o passo 9 mostrou (se o Chrome sobreviveu ao `kill -9` ou não). Se algum item não der `ok`, a etapa não fecha: devolva com a saída.

---

## Etapa 12 — Ponte do MCP: comando sem processo intermediário e mensagens novas

**Tela:** não

**Arquivos:**
- mudar `auditor/src/automaster_audit/mcp/base.py`
- mudar `auditor/tests/test_mcp_tools.py`
- mudar `extractor/test/cli-comandos.test.ts`

**O que prova a etapa:** os testes do auditor usam `subprocess.run` falso, no padrão de `auditor/tests/test_mcp_tools.py:15-78`.
- O comando montado por `_run_extractor("contato-editar", "-l", "L", "--json")` é exatamente `["node", "--import", "tsx", "src/cli.ts", "contato-editar", "-l", "L", "--json"]` (o teste `test_run_extractor_builds_cmd_and_parses_last_line` muda a asserção de `seen["cmd"][1:]` para a lista inteira).
- Sem `node_modules/.bin/tsx` no extractor, o erro de "extractor não provisionado" continua igual.
- Envelope `{"ok": false, "error": {"code": "login_pendente", "message": "..."}}`: o `ToolError` cita `login_pendente`, a mensagem do extractor e o pedido para logar na janela do Chrome que abriu e chamar a tool de novo.
- Envelope com `sessao_indisponivel`: o `ToolError` cita o código, a mensagem e o diagnóstico (`npm run sessao -- --acao status` na pasta do extractor e o caminho `~/.automaster/sessao/fundo.log`).
- Outros códigos (`http_422`, `erro`) não ganham nenhuma dessas duas dicas.
- Timeout de 600 s: o `ToolError` cita as duas causas prováveis (login pendente com a janela do Chrome esperando, e fila de escrita ocupada por outro comando), mantém o aviso de que a escrita PODE ter sido aplicada com a dica de conferência por tool, e preserva a linha `snapshot:` do stderr (o teste de hoje continua passando).
- O aviso de escrita parcial (`_dica_escrita`) continua aparecendo quando `escrita.tentada` é verdadeiro, inclusive junto de `login_pendente`.
- No extractor, `spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", "--help"], { cwd: <extractor>, encoding: "utf-8" })` sai com código 0 e o stdout contém `Commands:` (o jeito novo de rodar a CLI funciona).

**Como fazer:**

Padrões do repositório: Python 3.12, `ruff check` e `ruff format --check` em `src` e `tests`; testes com `pytest` e `monkeypatch` trocando `mcp_base.subprocess.run` (ver `auditor/tests/test_mcp_tools.py:15-31`); `ToolError` é o erro que vira `isError` para o agente.

Por que mudar o comando: hoje o MCP roda `node_modules/.bin/tsx src/cli.ts`, e o `tsx` 4.22 cria um processo filho com o carregador. No timeout, `subprocess.run` manda `SIGKILL` só no `tsx`, que não repassa `SIGKILL`: o neto continua escrevendo depois de o agente ouvir "confira o estado atual", e segura a fila de escrita porque o pid dele está vivo. Com `node --import tsx` o carregador roda no mesmo processo, e o `SIGKILL` do timeout acerta quem escreve. O processo de fundo não é atingido: ele nasce com `detached: true` (sessão própria).

Em `auditor/src/automaster_audit/mcp/base.py`:
- `cmd = ["node", "--import", "tsx", "src/cli.ts", *args]` (`base.py:141`). O `node` é achado pelo `PATH` montado logo acima, o mesmo de que o `tsx` já dependia pelo `#!/usr/bin/env node`. A conferência de `node_modules/.bin/tsx` continua como prova de que o extractor foi provisionado.
- Docstring de `_run_extractor` (`base.py:124`): troque "Roda `tsx src/cli.ts <args>` no extractor (abre Chrome; espera segundos)" por "Roda `node --import tsx src/cli.ts <args>` no extractor. Pede os tokens ao processo de fundo; a primeira chamada depois de horas paradas sobe o processo, as seguintes saem em menos de um segundo".
- Mensagem do timeout (`base.py:154-159`), inteira:

```python
f"{args[0]} estourou 600 s e foi morto. Causas prováveis: login pendente (o GHL pediu login e a "
"janela do Chrome ficou esperando) ou fila de escrita ocupada por outro comando automaster. "
"A escrita PODE ter sido aplicada (o processo pode ter morrido entre o PUT e a marcação do "
f"snapshot): {dica_estado} "
+ _head_tail(...)   # o mesmo argumento de hoje
```

- Um dicionário `_DICAS_SESSAO` com as duas chaves:
  - `"login_pendente"`: `" O GHL pediu login: entre na janela do Chrome que abriu (e-mail e senha ou Google) e chame a tool de novo."`
  - `"sessao_indisponivel"`: `f" O processo de fundo do automaster não está disponível. Diagnóstico: `npm run sessao -- --acao status` em {EXTRACTOR_DIR}; log em ~/.automaster/sessao/fundo.log."`
  e, no erro de `base.py:161-166`, acrescente `_DICAS_SESSAO.get(erro.get("code"), "")` entre a mensagem e `_dica_escrita(args, saida)`.
- `subprocess.run(..., capture_output=True)` continua: o processo de fundo nasce desacoplado dos pipes do comando (`stdio` para arquivo, `detached`, `unref`), então o `capture_output` não espera por ele.

O plugin roda desta pasta: a mudança do comando vale para as sessões abertas só quando o servidor MCP delas for reiniciado (`/mcp` e reconectar, ou abrir a sessão de novo); até lá elas seguem com o `tsx`, que funciona do mesmo jeito.

---

## Etapa 13 — Comandos pedem tokens ao processo de fundo; o cliente antigo sai

**Tela:** não

**Arquivos:**
- mudar `extractor/src/cli/shared.ts`
- mudar `extractor/src/api/client.ts`
- mudar `extractor/src/auth/session.ts`
- mudar `extractor/src/auth/token.ts`
- mudar `extractor/test/token.test.ts`
- mudar `extractor/test/client.test.ts`
- mudar os callbacks de `withClient` em `extractor/src/cli/extract.ts`, `extractor/src/cli/smoke.ts`, `extractor/src/cli/workflows.ts`, `extractor/src/cli/workflow-editar.ts`, `extractor/src/cli/contato.ts`
- criar `extractor/test/sem-cliente-antigo.test.ts`

**O que prova a etapa:**
- Teste estático (`sem-cliente-antigo.test.ts`) que lê todos os arquivos de `extractor/src`: `openSession(` só aparece em `extractor/src/auth/session.ts` (a definição) e em `extractor/src/cli/extract.ts` (o discover); `context.request`, `AUTOMASTER_CLIENTE_FETCH`, `registroDeLoginAntigo` e `aoVerLogin` não aparecem em lugar nenhum.
- `extractor/test/client.test.ts` sem o caso do `contexto` (a opção deixou de existir); os outros casos continuam passando.
- `extractor/test/token.test.ts` sem os casos de `aoVerLogin` e `registroDeLoginAntigo`; os outros continuam passando.
- A suíte inteira continua verde (os falsos de cliente não dependem do transporte).

**Como fazer:**

Padrões do repositório: ESM com imports terminando em `.js`; testes com `node:test` e `node:assert/strict`; lint proíbe promise solta. Já existem: `tokensDoFundo`, `renovarNoFundo` e `opcoesPadrao` em `extractor/src/fundo/cliente.ts`; `entrarNaFila` em `extractor/src/auth/lock.ts`; `caminhosDaSessao` em `extractor/src/fundo/comum.ts`. A prova ao vivo A19 está registrada em `docs/sessao-de-fundo.md` (seção "Prova A19 — cliente sobre fetch") e a do Chrome de fundo na seção "Prova ao vivo do Chrome de fundo"; confira que as duas existem e estão sem falha antes de começar.

A partir desta etapa nenhum comando abre Chrome: todos pedem os tokens ao processo de fundo. Como o plugin roda desta pasta (decisão A46; os `mcp_server` em execução têm `CLAUDE_PLUGIN_ROOT` apontando para ela), as tools MCP das sessões abertas em outros projetos passam a usar o processo de fundo assim que esta etapa entrar, sem reiniciar nada: cada tool roda a CLI de novo.

1. `extractor/src/cli/shared.ts`, `withClient` novo:

```ts
export async function withClient(
  locationId: string, log: (msg: string) => void,
  fn: (client: GhlClient, tokens: Tokens) => Promise<void>,
  opcoes: { escrita?: boolean } = {},
): Promise<void> {
  const sairDaFila = opcoes.escrita ? await entrarNaFila(caminhosDaSessao().escrita, log) : () => {};
  try {
    const fundo = opcoesPadrao(log);
    log("Pedindo tokens ao processo de fundo...");
    let atual = await tokensDoFundo(locationId, fundo);
    const refresh = async (): Promise<Tokens> => {
      log("401 — pedindo tokens novos ao processo de fundo...");
      atual = await renovarNoFundo(locationId, atual, fundo);
      return atual;
    };
    await fn(new GhlClient(atual, refresh), atual);
  } finally {
    sairDaFila();
  }
}
```

A fila de escrita continua cobrindo o comando inteiro, da leitura do "antes" à gravação. Tire `registroDeLoginAntigo` e os imports de `Page`, `openSession`, `captureTokens`, `cabecalhosCookie`, `defaultUserDataDir`, `linhaDeLogin` e `registrarLogin` daqui (o registro de logins passa a ser do processo de fundo).

2. Callbacks que recebiam a `page`: `(client, _page, tokens)` vira `(client, tokens)` em `extract.ts:18`, `smoke.ts:245`, `workflows.ts:124` e `workflow-editar.ts:50`; `(client, _page)` vira `(client)` em `contato.ts:58`. As 19 chamadas com `{ escrita: ... }` continuam passando o quarto argumento.

3. `extractor/src/api/client.ts`: remova a opção `contexto`, o ramo do Playwright em `enviar` e em `getJsonNoAuth`, a condição "sem contexto" do cabeçalho `cookie` em `authHeaders` (o `cookie` sai sempre que `tokens.cookies` tiver o host) e o import de `BrowserContext`. Em `extractor/test/client.test.ts`, apague o caso do `contexto`.

4. `extractor/src/auth/token.ts`: remova a opção `aoVerLogin` de `captureTokens` (o Chrome de fundo usa `pararNoLogin`). Em `extractor/test/token.test.ts`, apague os casos de `aoVerLogin` e `registroDeLoginAntigo`.

5. `extractor/src/auth/session.ts`: `openSession` fica só para o discover; o comentário do topo diz isso. `cabecalhosCookie` e `HOSTS_API` ficam (o Chrome de fundo usa).

---

## Etapa 14 — Prova ao vivo dos comandos pelo processo de fundo

**Tela:** não

**Arquivos:**
- mudar `docs/sessao-de-fundo.md`
- criar `extractor/test/prova-fundo.test.ts`

**O que prova a etapa:** `extractor/test/prova-fundo.test.ts` lê `../docs/sessao-de-fundo.md` e exige a seção `## Prova ao vivo dos comandos pelo processo de fundo` com as linhas (regex com `m`):
- `^- Data: \d{4}-\d{2}-\d{2}$`
- `^- Primeira chamada \(sobe o processo de fundo\): \d+(,\d+)? s$`
- `^- Chamadas seguintes \(mediana de 3\): \d+(,\d+)? s$` (e o teste exige que o número seja menor que 3)
- `^- Chrome invisível registrado como app no macOS durante os comandos \(System Events\): 0$`
- `^- Duas leituras ao mesmo tempo: ok$`
- `^- Escrita descartável pelo processo de fundo \(tag criada e apagada, tag do contato removida e reposta, nota\): ok, desfeita$`
- `^- Smoke depois: \d+ ok, \d+ falhou, \d+ pulado$`
- `^- Checagens que falharam só depois da troca: nenhuma$`
- `^- Discover encerra o processo de fundo e os comandos falham na hora: ok$`
- `^- Renovação pelo exp depois de 61 min parado: ok$`
- `^- Resíduo: .+$`

**Como fazer:**

Prova contra o GHL de verdade, na Instaltech, com o Chrome do sistema. **Em série, um comando de cada vez; nenhuma escrita ao mesmo tempo que outra.** Nenhum token vai para arquivo. Os comandos já pedem tokens ao processo de fundo, e o cliente antigo não existe mais: o que falhar ao desfazer se desfaz pela interface do GHL.

Antes de começar, avise o usuário: **durante esta etapa nenhuma outra sessão do Claude Code pode usar as tools automaster** (as leituras de outra sessão sujariam os tempos e as linhas do `fundo.log`). Confira com `ps -axo args | grep -F automaster/chrome-profile | grep -v grep` que só existe, no máximo, o Chrome invisível do processo de fundo.

Terminal em `extractor/`:

```bash
LOC=Xb9gDxwxYhdqtprGcb5E                   # Instaltech, subconta de teste
CONTATO=uWqujqll20tRuglV3mLt               # contato de teste da Instaltech
export AUTOMASTER_DUMPS=~/.automaster/dumps     # onde estão os dumps da Instaltech (sem isso, contato-editar não acha o dump)
PERFIL=$HOME/.automaster/chrome-profile
pid_chrome() { ps -axo pid=,args= | grep -F "MacOS/Google Chrome " | grep -F -- "--user-data-dir=$1" | grep -v grep | awk '{print $1}' | head -1; }
apps_do_pid() { osascript -e "tell application \"System Events\" to count (every process whose unix id is $1)"; }
```

0. Sobra de rodada anterior: `npm run tags -- -l $LOC --termo teste-fundo --json` não pode listar nada. Se listar, apague antes: `npm run tag-acao -- -l $LOC --acao apagar --tag teste-fundo --confirmo --json`.
1. Partida fria: `npm run sessao -- --acao encerrar --json`. Depois `/usr/bin/time -p npm run tags -- -l $LOC --json > /tmp/t1.json` e anote o `real` (primeira chamada). Logo depois, `apps_do_pid $(pid_chrome $PERFIL)` imprime `0`.
2. Quente: três vezes `/usr/bin/time -p npm run tags -- -l $LOC --json > /dev/null`, anote a mediana (precisa ficar abaixo de 3 s). `npm run sessao -- --acao status --json` mostra `rodando: true` e `atualizado: true`.
3. Duas leituras ao mesmo tempo: `npm run tags -- -l $LOC --json > /tmp/p1.json & npm run oportunidades -- -l $LOC -o pipelines --json > /tmp/p2.json & wait`; a última linha dos dois arquivos tem `"ok":true`.
4. Escrita descartável pelo processo de fundo, em série:
   - `npm run tag-acao -- -l $LOC --acao criar --nome teste-fundo --confirmo --json`; confira com `npm run tags -- -l $LOC --termo teste-fundo --json` (uma tag); apague com `npm run tag-acao -- -l $LOC --acao apagar --tag teste-fundo --confirmo --json`; confira de novo (vazio).
   - `npm run contato-editar -- -l $LOC -i $CONTATO --tag -teste-automaster --json`; veja no snapshot gravado se o contato tinha a tag: `f=$(ls -t $AUTOMASTER_DUMPS/_contatos/$LOC/$CONTATO/ | head -1); python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["raw"]["contact"]["tags"])' $AUTOMASTER_DUMPS/_contatos/$LOC/$CONTATO/$f`. Se tinha, reponha com `npm run contato-editar -- -l $LOC -i $CONTATO --tag +teste-automaster --json`; se não tinha, rode `--tag +teste-automaster` e depois `--tag -teste-automaster`, o que devolve o contato ao estado de antes.
   - `npm run anotacao-acao -- -l $LOC --contato $CONTATO --tipo nota --acao criar --texto "teste fundo: apagar" --confirmo --json`, anote o `id`, apague com `npm run anotacao-acao -- -l $LOC --contato $CONTATO --tipo nota --acao apagar -i <id> --confirmo --json` e confira com `npm run anotacoes -- -l $LOC --contato $CONTATO --tipo nota --json`.
   - Se algum desfazer falhar: desfaça pela interface do GHL (contato de teste → tags → remover ou repor `teste-automaster`; Configurações → Tags → apagar `teste-fundo`; contato de teste → notas → apagar a nota "teste fundo: apagar") e registre na linha "Resíduo" o que precisou ser desfeito à mão e por quê.
5. Smoke depois: `npm run smoke -- -l $LOC --contato $CONTATO --json > /tmp/smoke-fundo.json; echo $?`. Compare com a linha "Smoke com fetch" da seção "Prova A19 — cliente sobre fetch" de `docs/sessao-de-fundo.md`: nenhuma checagem pode falhar agora que passava lá.
6. Discover: rode `npm run discover -- -l $LOC` em segundo plano (ele encerra o processo de fundo, tentando até 3 vezes se outro comando o subir no meio, e abre o perfil com janela). Confira `npm run sessao -- --acao status --json` (`rodando: false`) e `/usr/bin/time -p npm run tags -- -l $LOC --json`: `"ok":false`, `code` `sessao_indisponivel`, mensagem citando o discover, em menos de 3 s. Peça ao usuário para fechar a janela do discover (não mate o Chrome à força: o fechamento limpo protege os cookies). Depois disso `npm run tags -- -l $LOC --json` volta a dar `"ok":true`.
7. Renovação pelo exp: `npm run tags -- -l $LOC --json > /dev/null`, deixe o processo de fundo parado por 61 min (não encerre), rode `npm run tags -- -l $LOC --json` de novo: `"ok":true`, e `grep "motivo=vencido" ~/.automaster/sessao/fundo.log | tail -1` mostra uma linha com horário depois da espera.
8. Apague os `/tmp/t1.json`, `/tmp/p1.json`, `/tmp/p2.json` e `/tmp/smoke-fundo.json`. Avise o usuário que as outras sessões podem voltar a usar as tools.

Acrescente a seção `## Prova ao vivo dos comandos pelo processo de fundo` em `docs/sessao-de-fundo.md`, com as linhas exatamente no formato que o teste exige (vírgula decimal). A linha "Resíduo" diz "nenhum" quando tudo foi desfeito pelos comandos. Se algum item não der `ok`, a etapa não fecha: devolva com a saída.

---

## Etapa 15 — Descrições, documentação, contrato do socket e versão 0.28.0

**Tela:** não

**Arquivos:**
- mudar `auditor/src/automaster_audit/mcp/contato.py`, `auditor/src/automaster_audit/mcp/oportunidades.py`, `auditor/src/automaster_audit/mcp/agenda.py`, `auditor/src/automaster_audit/mcp/conversas.py`, `auditor/src/automaster_audit/mcp/formularios.py`, `auditor/src/automaster_audit/mcp/workflows.py`
- mudar `auditor/tests/test_workflow_editar_tool.py`
- criar `auditor/tests/test_sessao_de_fundo_docs.py`
- mudar `skills/automaster-leitura/SKILL.md`
- mudar `commands/automaster-extract.md`
- mudar `CLAUDE.md`
- mudar `docs/endpoints.md`
- mudar `docs/backlog-arquitetura.md`
- mudar `docs/sessao-de-fundo.md`
- mudar `extractor/src/cli/cassete.ts`, `extractor/src/auth/session.ts`
- mudar `.claude-plugin/plugin.json`, `extractor/package.json`, `auditor/pyproject.toml`
- mudar `CHANGELOG.md`
- e qualquer outro arquivo de `extractor/src`, `auditor/src`, `auditor/tests`, `skills`, `commands` ou `hooks` que o grep de prova acusar (só texto de comentário, docstring, descrição ou mensagem)

**O que prova a etapa:** `auditor/tests/test_sessao_de_fundo_docs.py`, com a expressão `PROIBIDO = r"abr(e|em|ir) (o |um )?(chrome|browser|navegador)|serial por constru|escrita ao vivo é serial|serialização da escrita"` (sem diferenciar maiúsculas):
- Nenhuma descrição de tool em `automaster_audit.mcp_server.TOOLS` (o texto é o segundo item de cada tupla) casa com `PROIBIDO`.
- Nenhum destes arquivos casa com `PROIBIDO`: `CLAUDE.md`, `skills/automaster-leitura/SKILL.md`, `commands/automaster-extract.md`, `docs/endpoints.md`, `docs/backlog-arquitetura.md`, `docs/sessao-de-fundo.md`, todo `.py` em `auditor/src` e todo `.py` em `auditor/tests` exceto o próprio `test_sessao_de_fundo_docs.py`.
- As três versões (`.claude-plugin/plugin.json`, `extractor/package.json`, `auditor/pyproject.toml`) são `0.28.0`.
- A seção `## 0.28.0` do `CHANGELOG.md` existe e cita `0.12.0`, `0.22.0`, `fila` e `processo de fundo`.
- `docs/sessao-de-fundo.md` tem a seção `## Contrato do socket`, que cita `/tokens`, `/renovar`, `/versao`, `/encerrar`, `login_pendente`, `sessao_indisponivel` e `~/.automaster/sessao/sock`.
- `auditor/tests/test_versoes.py` continua passando.
- Prova por grep, rodada da raiz, que tem de sair vazia: `grep -rniE --exclude=test_sessao_de_fundo_docs.py 'abr(e|em|ir) (o |um )?(chrome|browser|navegador)|serial por constru|escrita ao vivo é serial|serialização da escrita' CLAUDE.md skills commands hooks auditor/src auditor/tests extractor/src docs/endpoints.md docs/backlog-arquitetura.md docs/sessao-de-fundo.md`.

**Como fazer:**

Padrões do repositório: Python 3.12, `ruff check` e `ruff format --check`; testes com `pytest`; a raiz do repo a partir de um teste é `Path(__file__).resolve().parents[2]` (ver `auditor/tests/test_versoes.py:15`). Português do Brasil com acentuação completa. As três versões andam juntas e a seção no `CHANGELOG.md` é obrigatória (`auditor/tests/test_versoes.py:30-41`).

Fato novo que todo texto passa a descrever: um processo de fundo do extractor é o único dono do perfil `~/.automaster/chrome-profile`, mantém um Chrome invisível logado e entrega os tokens por um socket Unix em `~/.automaster/sessao/sock`; os comandos chamam o GHL direto por `fetch`; leitura roda em paralelo; escrita espera a vez numa fila da máquina (`~/.automaster/sessao/escrita.lock`, até 2 min), cobrindo o comando inteiro; a janela do Chrome só aparece quando o GHL pede login; a primeira chamada depois de 4 h paradas sobe o processo (uns segundos), as outras saem em menos de um segundo; dentro de uma mesma sessão do Claude Code as tools rodam uma de cada vez (o servidor MCP é serial), e entre sessões rodam em paralelo. Os números de tempo vêm da seção "Prova ao vivo dos comandos pelo processo de fundo" de `docs/sessao-de-fundo.md`.

1. Descrições de tool (decisão A43): troque "abre Chrome" por "ao vivo, pelo processo de fundo do extractor" (ou equivalente curto) em `mcp/contato.py:150,166,209`, `mcp/oportunidades.py:147`, `mcp/agenda.py:176`, `mcp/conversas.py:344,422`, `mcp/formularios.py:153`, `mcp/workflows.py:332`. Ajuste os comentários de `mcp/workflows.py:160-161` ("antes de abrir o Chrome à toa" → "antes de chamar o extractor à toa"), `mcp/workflows.py:183` ("com um Chrome subindo no meio" → "com o tempo entre as duas invocações") e `mcp/workflows.py:220` ("a prévia abre o Chrome inteiro" → "a prévia chama o extractor ao vivo").
2. `auditor/tests/test_workflow_editar_tool.py`: a docstring da linha 154 ("a prévia (que abre o Chrome)" → "a prévia (que chama o extractor ao vivo)"); o comentário da linha 172 ("o dump é lido antes de abrir o Chrome" → "o dump é lido antes de chamar o extractor"); a docstring da linha 219 ("A recusa vem antes de abrir o Chrome" → "A recusa vem antes de chamar o extractor"); a mensagem da linha 225 ("não pode abrir o Chrome para uma chamada que já se sabe errada" → "não pode chamar o extractor para uma chamada que já se sabe errada"). Renomeie o teste da linha 152, `test_workflow_fora_do_dump_nao_estoura_e_avisa_antes_do_chrome`, para `test_workflow_fora_do_dump_nao_estoura_e_avisa_antes_do_extractor`.
3. `skills/automaster-leitura/SKILL.md`: linhas 24, 67, 86 e 140 deixam de dizer que a tool abre o Chrome (passam a dizer que é ao vivo e que a primeira depois de horas paradas leva uns segundos). O item das linhas 229-233 vira: "Escrita ao vivo entra numa fila: duas escritas ao mesmo tempo não falham, a segunda espera a vez (até 2 min); leitura roda em paralelo entre sessões. Navegar no app do GHL com Playwright no perfil do automaster já deslogou o perfil: o perfil é só do processo de fundo; para conferir o efeito de uma escrita, releia pela API." Acrescente uma linha sobre os códigos: `login_pendente` = peça ao usuário para entrar na janela do Chrome que abriu; `sessao_indisponivel` = rode `npm run sessao -- --acao status` no extractor.
4. `commands/automaster-extract.md`: descrição da linha 2 sem "abre Chrome" (ex.: "pode pedir login numa janela do Chrome na primeira vez"); linha 7 sem "É o único comando que abre browser"; linha 13 diz que o login, se pedido, acontece numa janela que o processo de fundo mostra, e que a sessão fica em `~/.automaster/chrome-profile`.
5. `CLAUDE.md`: na descrição do `extractor/` (linha 18), troque "Abre Chrome com perfil persistente ... Em `401`, recarrega a página para recapturar" pelo fato novo acima, citando `src/fundo/` (`comum.ts`, `servidor.ts`, `chrome.ts`, `cliente.ts`, `processo.ts`, `main.ts`) e o contrato em `docs/sessao-de-fundo.md`. O parágrafo da linha 32 ("Escrita ao vivo é serial por construção") vira o parágrafo da fila de escrita e do processo de fundo único (trava `~/.automaster/chrome.lock` do processo de fundo; o perfil não pode ser aberto por outro Chrome nem por outros projetos, que pedem tokens pelo socket). Linha 49: tire "(abre Chrome p/ login 1x)". Linha 129: troque "abre Chrome com perfil persistente e login manual" por "precisa do processo de fundo logado". Acrescente na lista de comandos `npm run sessao -- --acao status --json  # processo de fundo: status | subir | encerrar | tokens | renovar`. Atualize as contagens "suíte (N testes)" do extractor e do auditor com o número que os dois comandos de teste mostram agora.
6. `docs/endpoints.md:1374-1390`: reescreva o parágrafo no passado, com o título "Até a 0.27.0, o perfil compartilhado obrigava a escrita em série", explicando que desde a 0.28.0 o perfil é só do processo de fundo, as chamadas saem por `fetch` sem aba compartilhada, e a escrita entra numa fila da máquina. Sem as expressões que o teste proíbe.
7. `docs/backlog-arquitetura.md`: na linha 7, ponha no passado: "Até a 0.27.0 a ordem da escrita ao vivo era convenção documentada e já falhou ao vivo (0.12.0: dois agentes no mesmo formulário, uma exclusão que ninguém pediu); desde a 0.28.0 a escrita entra numa fila da máquina." Marque C5 (linhas 77-80) como `[x]`, com "fechado na 0.28.0: o processo de fundo lê o `SingletonLock` e diz qual pid segura o perfil". Na nota da linha 88, troque a suposição de que o `chrome.lock` "esperou" pela explicação de que a trava recusava e que agora a escrita espera numa fila.
8. `extractor/src/cli/cassete.ts:7-8`: "não roda em CI (abre Chrome com login manual)" → "não roda em CI (precisa do processo de fundo logado)". `extractor/src/auth/session.ts`: o comentário de `openSession` diz que só o discover usa o perfil com janela.
9. `docs/sessao-de-fundo.md`: logo depois do título, a seção `## Contrato do socket`, para outros projetos (decisão A45: o perfil é só do processo de fundo; projeto que precisa de token pede pelo socket, projeto que precisa de tela usa perfil e login próprios):
   - onde: socket Unix `~/.automaster/sessao/sock`, pasta `0700`, socket `0600`; HTTP com JSON;
   - como subir se não responder: `npm --prefix <repo>/extractor run sessao -- --acao subir --json`;
   - `POST /tokens {"subconta": "<locationId>"}` → `200 {"bearer", "tokenId", "cookies": {"<host>": "<cabeçalho cookie>"}, "userAgent"}`; mande `authorization: Bearer <bearer>`, `token-id`, `channel: APP`, `source: WEB_USER`, `version: 2021-07-28` e o `userAgent`;
   - `POST /renovar {"subconta", "bearer", "tokenId"}` com o par que levou `401` → par novo (ou o atual, se outro já renovou);
   - `GET /versao` → `{"versao", "pid", "perfil", "esperandoLogin"}`;
   - `POST /encerrar` → fecha o Chrome e sai;
   - erros: `503 {"code": "login_pendente" | "sessao_indisponivel", "message"}`; `400` para pedido sem subconta;
   - o pedido de tokens pode demorar até uns 5 min quando o GHL pede login (janela aberta); use timeout de pelo menos 330 s e não repita o pedido por tempo esgotado (cada repetição abriria outra espera de login);
   - regras: nunca gravar os tokens em disco; nunca abrir `~/.automaster/chrome-profile` em outro Chrome; o processo morre após 4 h sem pedido e sobe de novo no próximo;
   - exemplo: `curl -s --unix-socket ~/.automaster/sessao/sock -X POST -H 'content-type: application/json' -d '{"subconta":"<locationId>"}' http://fundo/tokens`.
   - Uma seção `## Arquivos` com `fundo.log` (log sem tokens), `logins.jsonl` (cada pedido de login, com `via` e `motivo`), `escrita.lock` (fila de escrita) e `~/.automaster/chrome.lock` (trava do perfil, com o pid e o rótulo `fundo` ou `discover`).
10. Versões: `0.28.0` em `.claude-plugin/plugin.json:4`, `extractor/package.json:3` e `auditor/pyproject.toml:7`. No topo do `CHANGELOG.md` (antes de `## 0.27.0`), a seção `## 0.28.0 — sessão de fundo: um Chrome invisível para todos os comandos ao vivo`, com itens curtos: processo de fundo dono do perfil, Chrome invisível, janela só para login; tokens por socket Unix em `~/.automaster/sessao/`; cliente sobre `fetch` com corte de 30 s; renovação pelo `exp` a cada pedido; leitura em paralelo; **reverte a 0.12.0** ("escrita ao vivo serial") e **reverte a recusa da trava da 0.22.0**: a trava do perfil passa a ser do processo de fundo, e escrita espera a vez numa fila em vez de falhar; códigos `login_pendente` e `sessao_indisponivel` no envelope `--json`; comando `sessao`; prévia visual no Chrome do sistema sem perfil; discover encerra o processo de fundo; erro claro de perfil aberto por outro Chrome (C5); registro de pedidos de login; o MCP roda a CLI com `node --import tsx`, sem processo intermediário; contrato do socket para outros projetos em `docs/sessao-de-fundo.md`. Atualizar o plugin: `claude plugin marketplace update zoi && claude plugin install automaster@zoi`.

Rode o grep de prova no fim; o que ele acusar fora da lista acima também se troca (só texto).

---

## Etapa 16 — Prova final pelo caminho do MCP e início da semana de medição de logins

**Tela:** não

**Arquivos:**
- mudar `docs/sessao-de-fundo.md`
- criar `extractor/test/prova-final.test.ts`

**O que prova a etapa:** `extractor/test/prova-final.test.ts` lê `../docs/sessao-de-fundo.md` e exige:
- a seção `## Prova final pelo MCP` com as linhas (regex com `m`):
  - `^- Data: \d{4}-\d{2}-\d{2}$`
  - `^- Plugin em uso \(CLAUDE_PLUGIN_ROOT dos servidores MCP\): .+$`
  - `^- Primeira chamada pelo caminho do MCP \(_run_extractor\), subindo o processo de fundo: \d+(,\d+)? s$` (e o número abaixo de 15: a chamada não ficou presa aos pipes do processo de fundo)
  - `^- Processo de fundo vivo depois do fim do Python: sim$`
  - `^- Tool chamada numa sessão do Claude Code: ok$`
  - `^- Duas tools ao mesmo tempo, em dois processos pelo caminho do MCP \(sobreposição medida\): ok$`
  - `^- Chrome invisível registrado como app no macOS: 0$`
  - `^- Tempo de \`tags\` depois \(mediana de 3\): \d+(,\d+)? s$`, e o número tem de ser menor que o da linha "Tempo de `tags` antes" da seção "Prova A19 — cliente sobre fetch" do mesmo arquivo;
- a seção `## Semana de medição de logins` com `^- Início: \d{4}-\d{2}-\d{2}$`, uma linha que começa com `- Como conferir:` e uma linha que começa com `- Resultado:` (pode dizer "em andamento").

**Como fazer:**

Prova pelo caminho exato do MCP, contra a Instaltech. **Nenhuma escrita nesta etapa.** Antes de começar, avise o usuário: durante esta etapa nenhuma outra sessão do Claude Code pode usar as tools automaster (sujaria os tempos). Variáveis, num terminal em `extractor/`:

```bash
LOC=Xb9gDxwxYhdqtprGcb5E                   # Instaltech, subconta de teste
PERFIL=$HOME/.automaster/chrome-profile
pid_chrome() { ps -axo pid=,args= | grep -F "MacOS/Google Chrome " | grep -F -- "--user-data-dir=$1" | grep -v grep | awk '{print $1}' | head -1; }
apps_do_pid() { osascript -e "tell application \"System Events\" to count (every process whose unix id is $1)"; }
```

1. Plugin em uso: `for p in $(pgrep -f automaster_audit.mcp_server); do ps eww -p $p -o command= | tr ' ' '\n' | grep '^CLAUDE_PLUGIN_ROOT='; done | sort -u`. Tem de mostrar só a pasta deste repositório; anote-a. Se aparecer outra pasta (por exemplo uma cópia em `~/.claude/plugins/cache/`), rode `claude plugin marketplace update zoi && claude plugin install automaster@zoi`, reinicie as sessões e repita.
2. Primeira chamada pelo caminho do MCP, sem o modelo no meio (decisão A21/A50): `npm run sessao -- --acao encerrar --json`; depois, em `auditor/`, `time AUTOMASTER_DUMPS=~/.automaster/dumps .venv/bin/python -c "from automaster_audit.mcp.base import _run_extractor; _run_extractor('tags','-l','Xb9gDxwxYhdqtprGcb5E','--json')"`. Anote o `real` (abaixo de 15 s). Logo depois, em `extractor/`, `npm run sessao -- --acao status --json` tem de dar `rodando: true`: o processo de fundo sobreviveu ao fim do Python. `apps_do_pid $(pid_chrome $PERFIL)` imprime `0`.
3. Numa sessão do Claude Code com o plugin `automaster` (reconecte `automaster` em `/mcp` antes, para carregar o `base.py` novo), chame a tool `tags` com `loc: "Xb9gDxwxYhdqtprGcb5E"`: tem de responder sem erro.
4. Duas tools ao mesmo tempo entre processos (o servidor MCP de uma sessão é serial; a disputa que importa é entre sessões): em `auditor/`,
   ```bash
   for t in "tags -l $LOC --json" "oportunidades -l $LOC -o pipelines --json"; do
     AUTOMASTER_DUMPS=~/.automaster/dumps .venv/bin/python -c 'import sys,time,json; from automaster_audit.mcp.base import _run_extractor; a=time.time(); _run_extractor(*sys.argv[1:]); print(json.dumps({"cmd": sys.argv[1], "inicio": a, "fim": time.time()}))' $t &
   done > /tmp/paralelo.jsonl; wait
   python3 -c 'import json; l=[json.loads(x) for x in open("/tmp/paralelo.jsonl")]; print(len(l)==2 and max(x["inicio"] for x in l) < min(x["fim"] for x in l))'
   ```
   Tem de imprimir `True` (as duas terminaram sem erro e os intervalos se sobrepõem). Apague `/tmp/paralelo.jsonl`.
5. Tempo depois: três vezes `/usr/bin/time -p npm run tags -- -l $LOC --json > /dev/null` com o processo de fundo já de pé; anote a mediana e compare com o "antes" da seção "Prova A19 — cliente sobre fetch".
6. Semana de medição de logins (decisão A2; não bloqueia a entrega): anote a data de hoje como início. Como conferir, ao fim de sete dias de uso normal:
   - `grep -F '"via":"fundo"' ~/.automaster/sessao/logins.jsonl | grep -F '"motivo":"redirecionamento"'` e fique com as linhas cujo `perfil` é `~/.automaster/chrome-profile` expandido (as de `/tmp/...` são dos testes). Cada uma é uma queda: veja `origem`, `navegouAntes` e `ultimaNavegacao`. As linhas com `"motivo":"sem_tokens"` (captura que só não achou tokens a tempo) são anotadas à parte e não contam como queda. As com `"via":"withClient"` são a linha de base do caminho antigo, para comparar.
   - Para cruzar com telas de login abertas fora do processo de fundo: `cp ~/.automaster/chrome-profile/Default/History /tmp/h.db && sqlite3 /tmp/h.db "select datetime(last_visit_time/1000000-11644473600,'unixepoch'), url from urls where url like 'https://app.gohighlevel.com/?url=%' order by last_visit_time desc limit 30" && rm /tmp/h.db`.
   - `grep -c "motivo=" ~/.automaster/sessao/fundo.log` dá quantas capturas o processo fez; `grep "encerrando" ~/.automaster/sessao/fundo.log` mostra cada encerramento e o motivo.
   - Critério: aprovado se nenhuma queda tiver sido causada por ação do automaster; queda do lado do GHL é anotada e não reprova.
   Escreva isso na seção `## Semana de medição de logins` (`- Início:`, `- Como conferir:` com os comandos, `- Resultado: em andamento`).

Acrescente a seção `## Prova final pelo MCP` em `docs/sessao-de-fundo.md` com as linhas no formato que o teste exige (vírgula decimal). Item que não der certo impede o fechamento: devolva com a saída.
