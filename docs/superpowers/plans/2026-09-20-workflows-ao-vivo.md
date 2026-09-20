# Workflows ao vivo — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dar ao MCP automaster a leitura ao vivo do estado corrente de workflows e das inscrições de contato, mais quatro ações de escrita (publicar/despublicar, inscrever, remover, retomar).

**Architecture:** um módulo novo de API no extractor (`workflows-live.ts`) com as rotas da API interna e as funções puras que montam a resposta; dois comandos de CLI (`workflows-ao-vivo`, `workflow-acao`); duas tools MCP que chamam esses comandos por subprocesso. Nada lê o dump. O módulo `workflows.ts`, que serve à extração, não muda.

**Tech Stack:** TypeScript + Playwright (extractor, testes com `node:test`), Python 3.12 (auditor/MCP, testes com pytest).

**Spec:** `docs/superpowers/specs/2026-09-20-workflows-ao-vivo-design.md`
**Pesquisa:** `docs/superpowers/research/2026-09-20-workflows-ao-vivo-research.md`

## Global Constraints

- Host de todas as rotas: `https://backend.leadconnectorhq.com`. Nada de API pública (decisão A9).
- Toda escrita exige `--confirmo` (CLI) / `confirmo=true` (MCP), com a frase exata já usada no projeto: `Isto muda dado real da subconta e não tem desfazer. Repita com --confirmo.` (CLI) e `... Repita com confirmo=true.` (MCP).
- Toda escrita exige autoria: `userId` derivado do token, ou `--usuario <id>`. Sem nenhum dos dois, recusa (A4).
- Rastro de toda escrita em `<dumps>/_workflows/<locationId>/<workflowId>/<ts>.json`, via `registroEscrita` (`extractor/src/cli.ts:542`), que já cria esse nível de pasta (A12).
- O comando de escrita imprime `snapshot: <caminho>` no **stderr** antes de escrever. O servidor MCP preserva essa linha ao truncar o stderr (`auditor/src/automaster_audit/mcp_server.py:230-231`); sem ela o caminho do rastro some quando a saída é longa.
- Em comando com `--json`, `log` é `console.error`; a **última linha do stdout** é o JSON. É o que `_run_extractor` lê (`mcp_server.py:268`).
- Teto padrão da lista de inscritos: 500, ajustável por `--limite`. A resposta sempre declara se cortou (A11).
- As duas tools novas **não** chamam `_load` e **não** devolvem `_snapshot` (A15).
- Nenhuma leitura devolve lista vazia sem dizer por quê: `{linhas: [], vazio_porque: "..."}`.
- Versão do plugin ao fim: **0.13.0**; total de tools: **29**.
- Nada de `parentId`, pastas, edição de estrutura, ação em lote (fora de escopo).
- Nenhum tratamento de `401` ou `429` é escrito de novo: `GhlClient.request`
  (`extractor/src/api/client.ts:37-57`) já recaptura os tokens uma vez em `401`, faz backoff
  em `429`, e lança `MÉTODO url → HTTP <status> <corpo>` em qualquer outro erro — que é
  exatamente a "falha explícita nomeando a rota" que a spec pede. Nenhuma função nova
  engole exceção do cliente.

---

### Task 1: ler o id do usuário logado a partir do token

O extractor captura dois tokens e nunca soube quem está logado. As quatro escritas precisam
carimbar autoria. `decodeCompanyId` já faz esse tipo de leitura no mesmo arquivo — a função
nova é irmã dela.

**Files:**
- Modify: `extractor/src/auth/token.ts:9-16` (adicionar função ao lado de `decodeCompanyId`)
- Test: `extractor/test/token.test.ts` (criar)

**Interfaces:**
- Consumes: nada.
- Produces: `decodeUserId(bearer: string, tokenId: string): string` — devolve `""` quando
  nenhum dos dois tokens traz um id de usuário.

- [ ] **Step 1: escrever o teste que falha**

Crie `extractor/test/token.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeUserId } from "../src/auth/token.js";

/** Monta um JWT de mentira: só o payload importa, a assinatura nunca é verificada aqui. */
function jwt(payload: Record<string, unknown>): string {
  const b64 = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  return `xxx.${b64}.yyy`;
}

test("tira o userId do Bearer quando ele traz user_id", () => {
  assert.equal(decodeUserId(jwt({ user_id: "U1" }), jwt({ company_id: "C1" })), "U1");
});

test("aceita a grafia userId no Bearer", () => {
  assert.equal(decodeUserId(jwt({ userId: "U2" }), ""), "U2");
});

test("cai para o token-id quando o Bearer não traz nada", () => {
  assert.equal(decodeUserId(jwt({ company_id: "C1" }), jwt({ user_id: "U3" })), "U3");
});

test("aceita sub como último recurso, que é o claim padrão do Firebase", () => {
  assert.equal(decodeUserId("", jwt({ sub: "U4" })), "U4");
});

test("devolve vazio quando nenhum token traz id — o CLI exige --usuario nesse caso", () => {
  assert.equal(decodeUserId(jwt({ company_id: "C1" }), jwt({ company_id: "C1" })), "");
});

test("devolve vazio em token quebrado, sem estourar", () => {
  assert.equal(decodeUserId("não é jwt", ""), "");
});

test("ignora claim que não é string", () => {
  assert.equal(decodeUserId(jwt({ user_id: 42 }), ""), "");
});
```

- [ ] **Step 2: rodar e ver falhar**

Run: `cd extractor && npx tsx --test test/token.test.ts`
Expected: FAIL — `decodeUserId` não existe (`SyntaxError: The requested module ... does not provide an export named 'decodeUserId'`).

- [ ] **Step 3: implementar**

Em `extractor/src/auth/token.ts`, logo depois de `decodeCompanyId`:

```typescript
/** Payload de um JWT, sem verificar assinatura. `{}` quando o texto não é um JWT. */
function payloadDeJwt(token: string): Record<string, unknown> {
  try {
    const parte = token.split(".")[1];
    if (!parte) return {};
    return JSON.parse(Buffer.from(parte, "base64url").toString("utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Id do usuário logado, para carimbar autoria nas escritas de workflow. Procura nos dois
 * tokens porque o app manda o mesmo usuário em claims de nomes diferentes conforme o
 * emissor. Vazio = não deu para saber; quem chama exige `--usuario` nesse caso.
 */
export function decodeUserId(bearer: string, tokenId: string): string {
  for (const p of [payloadDeJwt(bearer), payloadDeJwt(tokenId)]) {
    for (const chave of ["user_id", "userId", "sub"]) {
      const v = p[chave];
      if (typeof v === "string" && v) return v;
    }
  }
  return "";
}
```

Reescreva `decodeCompanyId` para usar o helper, sem mudar o comportamento:

```typescript
/** Extrai o company_id do JWT `token-id` (necessário para o endpoint de usuários). */
export function decodeCompanyId(tokenId: string): string {
  const v = payloadDeJwt(tokenId).company_id;
  return typeof v === "string" ? v : "";
}
```

- [ ] **Step 4: rodar e ver passar**

Run: `cd extractor && npx tsx --test test/token.test.ts && npx tsc --noEmit`
Expected: 7 testes PASS, typecheck limpo.

- [ ] **Step 5: rodar a suíte inteira, porque `decodeCompanyId` foi mexido**

Run: `cd extractor && npm test`
Expected: todos os testes anteriores continuam passando (64 antes desta tarefa).

- [ ] **Step 6: commit**

```bash
git add extractor/src/auth/token.ts extractor/test/token.test.ts
git commit -m "feat: le o id do usuario logado a partir dos tokens"
```

---

### Task 2: rotas de leitura no módulo novo

Só as rotas e os tipos. As funções puras que montam a resposta vêm na Task 3, para que esta
tarefa fique inteiramente sobre a conversa com o servidor.

A paginação aqui é por cursor, não por deslocamento: cada página devolve linhas, e a
próxima se pede mandando os campos de referência da última linha. Diferente do
`listWorkflows` que já existe (`extractor/src/api/workflows.ts:30`), que pagina por `offset`.

**Files:**
- Create: `extractor/src/api/workflows-live.ts`
- Test: nenhum (rota não vira teste automatizado; a prova é a Task 8)

**Interfaces:**
- Consumes: `GhlClient` de `./client.js` (`getJson`, `postJson`, `putJson`).
- Produces:
  - `type StatusWorkflow = "published" | "draft" | "locked" | "paused"`
  - `interface InscricaoCrua` — a linha como o servidor manda
  - `getWorkflowMeta(client, loc, wid): Promise<unknown>`
  - `listarWorkflows(client, loc): Promise<WorkflowLinha[]>`
  - `paginaDeInscritos(client, loc, wid, limite, cursor?): Promise<PaginaInscritos>`
  - `contarInscritos(client, loc, wid): Promise<{ total?: number; finished?: number }>`
  - `inscricoesDoContato(client, loc, cid): Promise<{ count?: number; workflowStatuses?: InscricaoCrua[] }>`

- [ ] **Step 1: criar o arquivo com as rotas de leitura**

```typescript
import type { GhlClient } from "./client.js";

/**
 * API interna do app, achada no bundle público do editor de workflows.
 * Atenção ao prefixo: a busca de inscritos usa `/workflows` (PLURAL), as demais
 * usam `/workflow` (singular). Não é engano de digitação — são serviços diferentes.
 */
const BACKEND = "https://backend.leadconnectorhq.com";
const WF = `${BACKEND}/workflow`;
const WFS = `${BACKEND}/workflows`;

/** O servidor tem quatro status, não dois. `locked` e `paused` aparecem no app. */
export type StatusWorkflow = "published" | "draft" | "locked" | "paused";

export const STATUS_WORKFLOW: StatusWorkflow[] = ["published", "draft", "locked", "paused"];

/** Linha da lista de workflows, como o `/list` devolve. */
export interface WorkflowLinha {
  id: string;
  name?: string;
  status?: string;
  updatedAt?: string;
}

/**
 * Uma inscrição, como o servidor manda. Campos opcionais porque a rota é interna e
 * não documentada: tudo que a gente lê daqui pode sumir numa atualização do app.
 */
export interface InscricaoCrua {
  _id?: string;
  id?: string;
  contactId?: string;
  workflowId?: string;
  status?: string;
  createdAt?: string;
  currentStepName?: string;
  currentStepType?: string;
  nextExecutionOn?: string;
  meta?: { addedSource?: { source?: string; sourceName?: string } };
}

/** Cursor da paginação: os três campos que a próxima página exige. */
export interface Cursor {
  referenceId: string;
  referenceCreatedAt: string;
  referenceSid: string;
}

export interface PaginaInscritos {
  linhas: InscricaoCrua[];
  cursor?: Cursor;
  estrangulado: boolean;
}

/** Metadados de um workflow, sem baixar os steps do Firebase (que é a parte cara). */
export function getWorkflowMeta(client: GhlClient, loc: string, wid: string): Promise<unknown> {
  return client.getJson(`${WF}/${loc}/${wid}?includeScheduledPauseInfo=true`);
}

/**
 * Lista plana de workflows da subconta. Mesma rota que a extração usa, paginada por
 * offset; aqui só interessam id, nome e status correntes.
 */
export async function listarWorkflows(client: GhlClient, loc: string): Promise<WorkflowLinha[]> {
  const limit = 100;
  const todos: WorkflowLinha[] = [];
  for (let offset = 0; ; offset += limit) {
    const d = await client.getJson<{ rows?: WorkflowLinha[]; count?: number }>(
      `${WF}/${loc}/list?type=workflow&limit=${limit}&offset=${offset}&sortBy=name&sortOrder=asc`,
    );
    const rows = d.rows ?? [];
    todos.push(...rows);
    if (!rows.length || todos.length >= (d.count ?? 0)) return todos;
  }
}

/**
 * Uma página de inscritos. Sem `cursor`, traz a primeira; com `cursor`, a seguinte.
 * `isLocationRateLimited` é uma bandeira do próprio servidor dizendo que estrangulou a
 * subconta — resposta curta com ela ligada é resposta cortada, não lista curta.
 */
export async function paginaDeInscritos(
  client: GhlClient, loc: string, wid: string, limite: number, cursor?: Cursor,
): Promise<PaginaInscritos> {
  const p = new URLSearchParams({
    workflowId: wid,
    locationId: loc,
    limit: String(limite),
    action: cursor ? "next" : "first",
  });
  if (cursor) {
    p.set("referenceId", cursor.referenceId);
    p.set("referenceCreatedAt", cursor.referenceCreatedAt);
    p.set("referenceSid", cursor.referenceSid);
  }
  const d = await client.getJson<{ statuses?: InscricaoCrua[]; isLocationRateLimited?: boolean }>(
    `${WFS}/status/search/workflow-with-filter?${p.toString()}`,
  );
  const linhas = d.statuses ?? [];
  const ultima = linhas.at(-1);
  return {
    linhas,
    cursor: ultima
      ? {
          referenceId: String(ultima._id ?? ultima.id ?? ""),
          referenceCreatedAt: String(ultima.createdAt ?? ""),
          referenceSid: String(ultima.contactId ?? ""),
        }
      : undefined,
    estrangulado: d.isLocationRateLimited === true,
  };
}

/** Quantos passaram pelo workflow e quantos já terminaram. Uma chamada, resposta curta. */
export function contarInscritos(
  client: GhlClient, loc: string, wid: string,
): Promise<{ total?: number; finished?: number }> {
  return client.getJson(`${WFS}/status/enroll-stats?workflowId=${wid}&locationId=${loc}`);
}

/** O lado inverso: em que workflows este contato está agora. */
export function inscricoesDoContato(
  client: GhlClient, loc: string, cid: string,
): Promise<{ count?: number; workflowStatuses?: InscricaoCrua[] }> {
  return client.getJson(`${WF}/${loc}/contact/${cid}/statuses_v2`);
}
```

- [ ] **Step 2: conferir que compila**

Run: `cd extractor && npx tsc --noEmit`
Expected: sem erro. (Nenhum teste ainda: este arquivo só fala com a rede.)

- [ ] **Step 3: commit**

```bash
git add extractor/src/api/workflows-live.ts
git commit -m "feat: rotas de leitura de workflow ao vivo"
```

---

### Task 3: funções puras que montam a resposta

Aqui mora toda a lógica que um teste pode morder sem rede: normalizar a linha crua, cortar
no teto, dizer por que a lista veio vazia, montar os dois lados da leitura e montar a saída
da escrita.

A função de saída da escrita é extraída de propósito. O precedente está documentado no
código: um campo foi removido em silêncio uma vez, com a suíte inteira passando, porque
nada exercitava aquela fiação (`extractor/src/forms/style.ts:151-156`).

**Files:**
- Modify: `extractor/src/api/workflows-live.ts` (acrescentar ao fim)
- Test: `extractor/test/workflows-live.test.ts` (criar)

**Interfaces:**
- Consumes: `InscricaoCrua`, `WorkflowLinha` da Task 2.
- Produces:
  - `interface Inscricao { inscricaoId, contactId, contato?, status, entrouEm, passo, passoTipo, proximaExecucao, origem }`
  - `normalizarInscricao(c: InscricaoCrua): Inscricao`
  - `cortar<T>(linhas: T[], limite: number): { linhas: T[]; cortou: boolean }`
  - `porqueVazio(estrangulado: boolean): string`
  - `resumoPorWorkflow(a: {...}): SaidaPorWorkflow`
  - `resumoPorContato(a: {...}): SaidaPorContato`
  - `saidaWorkflowAcao(a: {...}): SaidaAcao`
  - `avisoDespublicar(n: number): string`

- [ ] **Step 1: escrever os testes que falham**

Crie `extractor/test/workflows-live.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizarInscricao, cortar, porqueVazio, resumoPorWorkflow, resumoPorContato,
  saidaWorkflowAcao, avisoDespublicar, type InscricaoCrua,
} from "../src/api/workflows-live.js";

const crua: InscricaoCrua = {
  _id: "S1",
  contactId: "C1",
  workflowId: "W1",
  status: "waiting",
  createdAt: "2026-09-01T10:00:00.000Z",
  currentStepName: "Espera 2 dias",
  currentStepType: "wait",
  nextExecutionOn: "2026-09-03T10:00:00.000Z",
  meta: { addedSource: { source: "trigger", sourceName: "Formulário enviado" } },
};

test("normalizarInscricao achata a linha crua nos campos que interessam", () => {
  assert.deepEqual(normalizarInscricao(crua), {
    inscricaoId: "S1",
    contactId: "C1",
    status: "waiting",
    entrouEm: "2026-09-01T10:00:00.000Z",
    passo: "Espera 2 dias",
    passoTipo: "wait",
    proximaExecucao: "2026-09-03T10:00:00.000Z",
    origem: "trigger",
    origemNome: "Formulário enviado",
  });
});

test("normalizarInscricao aceita id no lugar de _id e sobrevive a campo ausente", () => {
  const r = normalizarInscricao({ id: "S2", contactId: "C2" });
  assert.equal(r.inscricaoId, "S2");
  assert.equal(r.passo, "");
  assert.equal(r.origem, "");
});

test("cortar devolve tudo e cortou=false quando cabe no teto", () => {
  assert.deepEqual(cortar([1, 2, 3], 5), { linhas: [1, 2, 3], cortou: false });
});

test("cortar apara no teto e avisa que cortou", () => {
  assert.deepEqual(cortar([1, 2, 3], 2), { linhas: [1, 2], cortou: true });
});

test("porqueVazio distingue vazio de verdade de corte do servidor", () => {
  assert.match(porqueVazio(false), /nenhum contato/i);
  assert.match(porqueVazio(true), /estrangul/i);
});

test("resumoPorWorkflow junta status, total e inscrições normalizadas", () => {
  const out = resumoPorWorkflow({
    workflow: { id: "W1", name: "Boas-vindas", status: "published" },
    cruas: [crua],
    total: 12,
    finished: 4,
    cortou: false,
    estrangulado: false,
    nomes: {},
  });
  assert.equal(out.workflow.id, "W1");
  assert.equal(out.workflow.status, "published");
  assert.equal(out.total_historico, 12);
  assert.equal(out.terminados, 4);
  assert.equal(out.dentro_agora, 1);
  assert.equal(out.cortou, false);
  assert.equal(out.inscricoes[0].passo, "Espera 2 dias");
  assert.equal(out.vazio_porque, undefined);
});

test("resumoPorWorkflow explica a lista vazia em vez de devolver [] mudo", () => {
  const out = resumoPorWorkflow({
    workflow: { id: "W1", name: "Boas-vindas", status: "draft" },
    cruas: [], total: 0, finished: 0, cortou: false, estrangulado: true, nomes: {},
  });
  assert.deepEqual(out.inscricoes, []);
  assert.match(out.vazio_porque ?? "", /estrangul/i);
});

test("resumoPorWorkflow preenche o nome do contato quando ele foi resolvido", () => {
  const out = resumoPorWorkflow({
    workflow: { id: "W1", status: "published" },
    cruas: [crua], total: 1, finished: 0, cortou: false, estrangulado: false,
    nomes: { C1: "Maria Silva" },
  });
  assert.equal(out.inscricoes[0].contato, "Maria Silva");
});

test("resumoPorContato usa a mesma linha normalizada do outro lado", () => {
  const out = resumoPorContato({
    contactId: "C1",
    cruas: [{ ...crua, workflowId: "W1" }],
    nomesWorkflow: { W1: "Boas-vindas" },
  });
  assert.equal(out.contactId, "C1");
  assert.equal(out.dentro_agora, 1);
  assert.equal(out.inscricoes[0].workflowId, "W1");
  assert.equal(out.inscricoes[0].workflow, "Boas-vindas");
  assert.equal(out.inscricoes[0].passo, "Espera 2 dias");
});

test("resumoPorContato explica a lista vazia", () => {
  const out = resumoPorContato({ contactId: "C9", cruas: [], nomesWorkflow: {} });
  assert.deepEqual(out.inscricoes, []);
  assert.match(out.vazio_porque ?? "", /nenhum workflow/i);
});

test("saidaWorkflowAcao carrega o aviso quando ele existe", () => {
  const out = saidaWorkflowAcao({
    acao: "publicar", workflowId: "W1", resposta: { ok: true },
    registro: "/tmp/x.json", aviso: "3 contatos congelaram",
  });
  assert.deepEqual(out, {
    aplicado: true, acao: "publicar", workflowId: "W1", resposta: { ok: true },
    registro: "/tmp/x.json", aviso: "3 contatos congelaram",
  });
});

test("saidaWorkflowAcao não inventa o campo aviso quando não há aviso", () => {
  const out = saidaWorkflowAcao({
    acao: "remover", workflowId: "W1", resposta: { ok: true }, registro: "/tmp/x.json",
  });
  assert.ok(!("aviso" in out));
});

test("avisoDespublicar diz o número e que os contatos retomam, não somem", () => {
  const a = avisoDespublicar(3);
  assert.match(a, /3/);
  assert.match(a, /congel/i);
  assert.match(a, /republic/i);
  assert.doesNotMatch(a, /perd/i);
});

test("avisoDespublicar no vazio não fala de congelamento", () => {
  assert.match(avisoDespublicar(0), /nenhum contato/i);
});
```

- [ ] **Step 2: rodar e ver falhar**

Run: `cd extractor && npx tsx --test test/workflows-live.test.ts`
Expected: FAIL — os exports não existem.

- [ ] **Step 3: implementar**

Acrescente ao fim de `extractor/src/api/workflows-live.ts`:

```typescript
/** Uma inscrição achatada nos campos que a gente usa nos dois lados da leitura. */
export interface Inscricao {
  inscricaoId: string;
  contactId: string;
  contato?: string;
  status: string;
  entrouEm: string;
  passo: string;
  passoTipo: string;
  proximaExecucao: string;
  origem: string;
  origemNome: string;
}

/** Campo ausente vira string vazia: a rota é interna e pode parar de mandar qualquer um. */
export function normalizarInscricao(c: InscricaoCrua): Inscricao {
  return {
    inscricaoId: String(c._id ?? c.id ?? ""),
    contactId: String(c.contactId ?? ""),
    status: String(c.status ?? ""),
    entrouEm: String(c.createdAt ?? ""),
    passo: String(c.currentStepName ?? ""),
    passoTipo: String(c.currentStepType ?? ""),
    proximaExecucao: String(c.nextExecutionOn ?? ""),
    origem: String(c.meta?.addedSource?.source ?? ""),
    origemNome: String(c.meta?.addedSource?.sourceName ?? ""),
  };
}

/** Apara no teto e diz se aparou. Quem chama precisa declarar o corte na resposta. */
export function cortar<T>(linhas: T[], limite: number): { linhas: T[]; cortou: boolean } {
  if (linhas.length <= limite) return { linhas, cortou: false };
  return { linhas: linhas.slice(0, limite), cortou: true };
}

/**
 * Por que a lista veio vazia. Lista vazia muda vale um bug inteiro: foi assim que a
 * agenda sumiu em silêncio quando a data ia em texto (docs/endpoints.md, seção Agenda).
 */
export function porqueVazio(estrangulado: boolean): string {
  return estrangulado
    ? "o servidor estrangulou a subconta (isLocationRateLimited) e devolveu a busca cortada; " +
      "não dá para afirmar que não há ninguém dentro. Tente de novo em alguns minutos."
    : "nenhum contato está dentro deste workflow agora.";
}

export interface SaidaPorWorkflow {
  workflow: { id: string; name?: string; status?: string };
  total_historico?: number;
  terminados?: number;
  dentro_agora: number;
  cortou: boolean;
  estrangulado: boolean;
  inscricoes: Inscricao[];
  vazio_porque?: string;
}

/** O lado "quem está dentro deste workflow". */
export function resumoPorWorkflow(a: {
  workflow: WorkflowLinha;
  cruas: InscricaoCrua[];
  total?: number;
  finished?: number;
  cortou: boolean;
  estrangulado: boolean;
  nomes: Record<string, string>;
}): SaidaPorWorkflow {
  const inscricoes = a.cruas.map((c) => {
    const i = normalizarInscricao(c);
    const nome = a.nomes[i.contactId];
    return nome ? { ...i, contato: nome } : i;
  });
  return {
    workflow: { id: a.workflow.id, name: a.workflow.name, status: a.workflow.status },
    total_historico: a.total,
    terminados: a.finished,
    dentro_agora: inscricoes.length,
    cortou: a.cortou,
    estrangulado: a.estrangulado,
    inscricoes,
    ...(inscricoes.length ? {} : { vazio_porque: porqueVazio(a.estrangulado) }),
  };
}

export interface SaidaPorContato {
  contactId: string;
  dentro_agora: number;
  inscricoes: (Inscricao & { workflowId: string; workflow?: string })[];
  vazio_porque?: string;
}

/** O lado "em que workflows este contato está". Mesma linha normalizada do outro lado. */
export function resumoPorContato(a: {
  contactId: string;
  cruas: InscricaoCrua[];
  nomesWorkflow: Record<string, string>;
}): SaidaPorContato {
  const inscricoes = a.cruas.map((c) => {
    const wid = String(c.workflowId ?? "");
    const nome = a.nomesWorkflow[wid];
    return { ...normalizarInscricao(c), workflowId: wid, ...(nome ? { workflow: nome } : {}) };
  });
  return {
    contactId: a.contactId,
    dentro_agora: inscricoes.length,
    inscricoes,
    ...(inscricoes.length
      ? {}
      : { vazio_porque: "nenhum workflow tem este contato dentro agora." }),
  };
}

export interface SaidaAcao {
  aplicado: true;
  acao: string;
  workflowId: string;
  resposta: unknown;
  registro: string;
  aviso?: string;
}

/**
 * Saída de `workflow-acao`, pura para que um teste morda se alguém tirar o `aviso` —
 * é exatamente o que já aconteceu com `saidaPaletaGravar` (src/forms/style.ts:151).
 */
export function saidaWorkflowAcao(a: {
  acao: string; workflowId: string; resposta: unknown; registro: string; aviso?: string;
}): SaidaAcao {
  return {
    aplicado: true, acao: a.acao, workflowId: a.workflowId,
    resposta: a.resposta, registro: a.registro,
    ...(a.aviso ? { aviso: a.aviso } : {}),
  };
}

/**
 * O que despublicar faz com quem está dentro. Não é perda: o app tem o estado
 * `paused_due_to_draft_mode` e os contatos retomam de onde pararam na republicação —
 * todos de uma vez, que é o risco de verdade.
 */
export function avisoDespublicar(n: number): string {
  if (n <= 0) return "nenhum contato está dentro; despublicar não afeta ninguém agora.";
  return `${n} contato(s) estão dentro agora. Eles não são removidos: congelam no passo em ` +
    "que estão e voltam a andar, todos de uma vez, quando o workflow for republicado.";
}
```

- [ ] **Step 4: rodar e ver passar**

Run: `cd extractor && npx tsx --test test/workflows-live.test.ts && npx tsc --noEmit`
Expected: 14 testes PASS, typecheck limpo.

- [ ] **Step 5: provar que os testes mordem (teste de mutação, 2 minutos)**

Aplique cada mutação, rode, confirme a falha, desfaça:

1. Em `saidaWorkflowAcao`, remova `...(a.aviso ? { aviso: a.aviso } : {})`.
   Expected: falha em "saidaWorkflowAcao carrega o aviso quando ele existe".
2. Em `resumoPorWorkflow`, troque o bloco `...(inscricoes.length ? {} : {...})` por `{}`.
   Expected: falha em "resumoPorWorkflow explica a lista vazia".
3. Em `cortar`, troque `linhas.slice(0, limite)` por `linhas`.
   Expected: falha em "cortar apara no teto e avisa que cortou".

Run (entre cada uma): `cd extractor && npx tsx --test test/workflows-live.test.ts`
Desfaça com `git checkout extractor/src/api/workflows-live.ts` antes do commit.

- [ ] **Step 6: commit**

```bash
git add extractor/src/api/workflows-live.ts extractor/test/workflows-live.test.ts
git commit -m "feat: montagem pura da resposta de workflow ao vivo"
```

---

### Task 4: rotas de escrita no módulo

Quatro rotas. Todas carregam autoria em campos de nomes diferentes (`updatedBy`,
`actionFrom`, `removedFrom`) — é assim que o app manda, e o servidor pode validar o formato.

Sobre `source`: os valores (`add_to_campaign_modal`, `workflow_status_page`) são os que o
app usa. Não inventamos um valor nosso porque enum desconhecido em API interna costuma
voltar como `422`. A prova ao vivo (Task 8) testa se `automaster` é aceito; se for, troque
e registre em `docs/endpoints.md`.

**Files:**
- Modify: `extractor/src/api/workflows-live.ts` (acrescentar ao fim)
- Test: nenhum novo (rota não vira teste automatizado)

**Interfaces:**
- Consumes: `GhlClient`, `StatusWorkflow`.
- Produces:
  - `mudarStatus(client, loc, wid, status: StatusWorkflow, userId): Promise<unknown>`
  - `inscreverContato(client, loc, wid, contactId, userId, eventStartTime?): Promise<unknown>`
  - `removerContato(client, loc, contactId, wid, userId): Promise<unknown>`
  - `retomarInscricao(client, loc, inscricaoId, userId): Promise<unknown>`

- [ ] **Step 1: implementar**

Acrescente ao fim de `extractor/src/api/workflows-live.ts`:

```typescript
/** Origem das escritas. Valores do próprio app: enum desconhecido costuma dar 422. */
const CANAL = "web_app";
const FONTE_CONTATO = "add_to_campaign_modal";
const FONTE_INSCRICAO = "workflow_status_page";

/** ESCREVE: liga ou desliga o workflow. É um campo de status, não duas rotas. */
export function mudarStatus(
  client: GhlClient, loc: string, wid: string, status: StatusWorkflow, userId: string,
): Promise<unknown> {
  return client.putJson(`${WF}/${loc}/change-status/${wid}`, { status, updatedBy: userId });
}

/**
 * ESCREVE: coloca um contato no workflow. A entrada é ENFILEIRADA — ler o estado logo
 * depois pode não mostrar ninguém sem que nada tenha falhado.
 */
export function inscreverContato(
  client: GhlClient, loc: string, wid: string, contactId: string, userId: string,
  eventStartTime?: string,
): Promise<unknown> {
  return client.postJson(`${WF}/${loc}/${wid}/start-workflow`, {
    contactId,
    actionFrom: { userId, source: FONTE_CONTATO, channel: CANAL },
    ...(eventStartTime ? { eventStartTime } : {}),
  });
}

/** ESCREVE: tira o contato do workflow, pela rota por contato (não pela por inscrição). */
export function removerContato(
  client: GhlClient, loc: string, contactId: string, wid: string, userId: string,
): Promise<unknown> {
  return client.postJson(`${WF}/${loc}/contact/${contactId}/stop-execution`, {
    workflowId: wid,
    removedFrom: { userId, channel: CANAL, source: FONTE_CONTATO },
  });
}

/** ESCREVE: religa uma inscrição parada. O alvo é o id da INSCRIÇÃO, não o do contato. */
export function retomarInscricao(
  client: GhlClient, loc: string, inscricaoId: string, userId: string,
): Promise<unknown> {
  return client.postJson(`${WF}/${loc}/${inscricaoId}/force-resume`, {
    actionFrom: { userId, channel: CANAL, source: FONTE_INSCRICAO },
  });
}
```

- [ ] **Step 2: conferir que compila e que nada quebrou**

Run: `cd extractor && npx tsc --noEmit && npm test`
Expected: typecheck limpo, todos os testes passando.

- [ ] **Step 3: commit**

```bash
git add extractor/src/api/workflows-live.ts
git commit -m "feat: rotas de escrita de workflow ao vivo"
```

---

### Task 5: comando de leitura `workflows-ao-vivo`

Três operações: `lista` (todos os workflows com status corrente), `dentro` (quem está
dentro de um workflow) e `contato` (em que workflows um contato está).

`--nomes` resolve o nome de cada contato, uma chamada por contato. Sem a flag, só o id.
Em lista grande a diferença é de um minuto de espera (A2).

**Files:**
- Modify: `extractor/src/cli.ts` (import no topo; função `runWorkflowsAoVivo`; registro do comando junto dos outros)
- Modify: `extractor/package.json` (script `workflows-ao-vivo`)
- Test: coberto pelos testes puros da Task 3; o comando é fiação

**Interfaces:**
- Consumes: tudo que as Tasks 2 e 3 exportam; `withClient`, `numeroOpcional` do `cli.ts`.
- Produces: comando `workflows-ao-vivo`, cuja última linha de stdout com `--json` é o objeto que a tool MCP lê.

- [ ] **Step 1: importar o módulo novo**

No bloco de imports de `extractor/src/cli.ts`, junto dos outros `./api/*`:

```typescript
import {
  listarWorkflows, getWorkflowMeta, paginaDeInscritos, contarInscritos, inscricoesDoContato,
  resumoPorWorkflow, resumoPorContato, saidaWorkflowAcao, avisoDespublicar, cortar,
  mudarStatus, inscreverContato, removerContato, retomarInscricao,
  STATUS_WORKFLOW, type Cursor, type InscricaoCrua, type StatusWorkflow,
} from "./api/workflows-live.js";
import { decodeUserId } from "./auth/token.js";
```

`decodeCompanyId` já é importado de `./auth/token.js` — acrescente `decodeUserId` ao import
existente em vez de criar um segundo.

- [ ] **Step 2: acrescentar as constantes, junto das outras (perto de `extractor/src/cli.ts:551`)**

```typescript
const WF_LEITURA = ["lista", "dentro", "contato"];
const WF_ACOES = ["publicar", "inscrever", "remover", "retomar"];
const WF_TETO_PADRAO = 500;
```

- [ ] **Step 3: escrever o handler de leitura**

```typescript
/** Busca páginas até o teto. O cursor vem da última linha de cada página. */
async function todosOsInscritos(
  client: GhlClient, loc: string, wid: string, teto: number,
): Promise<{ cruas: InscricaoCrua[]; cortou: boolean; estrangulado: boolean }> {
  const cruas: InscricaoCrua[] = [];
  let cursor: Cursor | undefined;
  let estrangulado = false;
  // teto + 1 para saber que havia mais; `cortar` apara depois
  while (cruas.length <= teto) {
    const p = await paginaDeInscritos(client, loc, wid, 100, cursor);
    estrangulado = estrangulado || p.estrangulado;
    cruas.push(...p.linhas);
    if (p.linhas.length < 100 || !p.cursor) break;
    cursor = p.cursor;
  }
  const c = cortar(cruas, teto);
  return { cruas: c.linhas, cortou: c.cortou, estrangulado };
}

/** Nome de cada contato, uma chamada por id. Falha em um não derruba a lista. */
async function nomesDeContatos(
  client: GhlClient, loc: string, ids: string[],
): Promise<Record<string, string>> {
  const nomes: Record<string, string> = {};
  for (const id of [...new Set(ids)].filter(Boolean)) {
    try {
      const c = await getContact(client, loc, id) as { contact?: { name?: string } };
      if (c?.contact?.name) nomes[id] = c.contact.name;
    } catch {
      // contato apagado depois de entrar no workflow: segue sem o nome
    }
  }
  return nomes;
}

async function runWorkflowsAoVivo(opts: {
  location: string; o: string; id?: string; contato?: string;
  limite?: string; nomes?: boolean; json?: boolean;
}): Promise<void> {
  const log = opts.json ? console.error : console.log;
  if (!WF_LEITURA.includes(opts.o)) {
    throw new Error(`-o inválido: ${opts.o}. Aceitos: ${WF_LEITURA.join(", ")}`);
  }
  if (opts.o === "dentro" && !opts.id) throw new Error("-o dentro exige --id do workflow");
  if (opts.o === "contato" && !opts.contato) throw new Error("-o contato exige --contato");

  const teto = numeroOpcional(opts.limite, "limite", log) ?? WF_TETO_PADRAO;

  await withClient(opts.location, log, async (client) => {
    let out: unknown;
    switch (opts.o) {
      case "lista": {
        const linhas = await listarWorkflows(client, opts.location);
        out = {
          quantos: linhas.length,
          workflows: linhas.map((w) => ({
            id: w.id, name: w.name, status: w.status, updatedAt: w.updatedAt,
          })),
          ...(linhas.length ? {} : { vazio_porque: "a subconta não tem nenhum workflow." }),
        };
        break;
      }
      case "dentro": {
        const wid = opts.id!;
        const meta = await getWorkflowMeta(client, opts.location, wid) as
          { workflow?: { id?: string; name?: string; status?: string } };
        const w = meta?.workflow ?? {};
        const { cruas, cortou, estrangulado } = await todosOsInscritos(client, opts.location, wid, teto);
        const stats = await contarInscritos(client, opts.location, wid).catch(() => ({}));
        const nomes = opts.nomes
          ? await nomesDeContatos(client, opts.location, cruas.map((c) => String(c.contactId ?? "")))
          : {};
        out = resumoPorWorkflow({
          workflow: { id: String(w.id ?? wid), name: w.name, status: w.status },
          cruas, total: stats.total, finished: stats.finished, cortou, estrangulado, nomes,
        });
        break;
      }
      case "contato": {
        const cid = opts.contato!;
        const d = await inscricoesDoContato(client, opts.location, cid);
        const cruas = d.workflowStatuses ?? [];
        const nomesWorkflow: Record<string, string> = {};
        if (cruas.length) {
          for (const w of await listarWorkflows(client, opts.location)) {
            if (w.name) nomesWorkflow[w.id] = w.name;
          }
        }
        out = resumoPorContato({ contactId: cid, cruas, nomesWorkflow });
        break;
      }
    }
    if (opts.json) console.log(JSON.stringify(out));
    else console.log(JSON.stringify(out, null, 2));
  });
}
```

`getContact` já é importado no `cli.ts` (vem de `./api/contacts.js`); confirme com
`grep -n "getContact" extractor/src/cli.ts` e só acrescente ao import se faltar.

- [ ] **Step 4: registrar o comando, junto dos outros `program.command(...)`**

```typescript
program
  .command("workflows-ao-vivo")
  .description("Leitura ao vivo de workflows, de quem está dentro deles e de onde um contato está")
  .requiredOption("-l, --location <id>", "locationId da subconta")
  .option("-o, --o <op>", "lista | dentro | contato", "lista")
  .option("-i, --id <id>", "id do workflow (com -o dentro)")
  .option("--contato <id>", "id do contato (com -o contato)")
  .option("--limite <n>", `teto de inscritos trazidos (padrão ${WF_TETO_PADRAO})`)
  .option("--nomes", "resolve o nome de cada contato: uma chamada por contato, é lento em lista grande")
  .option("--json", "imprime o resultado em JSON no stdout")
  .action((o) => runWorkflowsAoVivo(o).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); }));
```

- [ ] **Step 5: acrescentar o script ao `extractor/package.json`**

Na lista `scripts`, ao lado de `"agenda"`:

```json
    "workflows-ao-vivo": "tsx src/cli.ts workflows-ao-vivo",
```

- [ ] **Step 6: conferir typecheck, ajuda do comando e suíte**

```bash
cd extractor
npx tsc --noEmit
npx tsx src/cli.ts workflows-ao-vivo --help
npm test
```
Expected: typecheck limpo; a ajuda lista as três operações e as flags; testes passando.

- [ ] **Step 7: commit**

```bash
git add extractor/src/cli.ts extractor/package.json
git commit -m "feat: comando workflows-ao-vivo"
```

---

### Task 6: comando de escrita `workflow-acao`

Quatro ações, autoria obrigatória, rastro por workflow, e o mesmo try/catch que a agenda e
as oportunidades usam: grava o registro com `aplicado: false` antes de chamar, reescreve com
o erro se estourar, reescreve com a resposta se der certo.

`retomar` precisa do id da **inscrição**, não do contato. Quando o usuário passar `--contato`
em vez de `--inscricao`, o comando resolve sozinho lendo as inscrições daquele contato; se
achar mais de uma no mesmo workflow, recusa e lista os ids — escolher por conta própria
seria adivinhar.

**Files:**
- Modify: `extractor/src/cli.ts` (função `runWorkflowAcao` + registro do comando)
- Modify: `extractor/package.json` (script `workflow-acao`)
- Test: `extractor/test/workflows-live.test.ts` (acrescentar o teste do resolvedor de inscrição)

**Interfaces:**
- Consumes: as quatro funções de escrita da Task 4, `saidaWorkflowAcao`, `avisoDespublicar`, `decodeUserId`, `registroEscrita`.
- Produces:
  - `resolverInscricao(cruas: InscricaoCrua[], wid: string): { id: string } | { erro: string }` (exportada de `workflows-live.ts`, para ser testável)
  - comando `workflow-acao`.

- [ ] **Step 1: escrever o teste que falha, em `extractor/test/workflows-live.test.ts`**

```typescript
import { resolverInscricao } from "../src/api/workflows-live.js";

test("resolverInscricao acha a única inscrição do contato naquele workflow", () => {
  const r = resolverInscricao([{ _id: "S1", workflowId: "W1" }, { _id: "S2", workflowId: "W2" }], "W1");
  assert.deepEqual(r, { id: "S1" });
});

test("resolverInscricao recusa quando o contato está duas vezes no mesmo workflow", () => {
  const r = resolverInscricao([{ _id: "S1", workflowId: "W1" }, { _id: "S3", workflowId: "W1" }], "W1");
  assert.ok("erro" in r);
  assert.match(r.erro, /S1/);
  assert.match(r.erro, /S3/);
  assert.match(r.erro, /--inscricao/);
});

test("resolverInscricao recusa quando o contato não está no workflow", () => {
  const r = resolverInscricao([{ _id: "S1", workflowId: "W2" }], "W1");
  assert.ok("erro" in r);
  assert.match(r.erro, /não está/i);
});
```

Acrescente `resolverInscricao` ao import do topo do arquivo de teste.

- [ ] **Step 2: rodar e ver falhar**

Run: `cd extractor && npx tsx --test test/workflows-live.test.ts`
Expected: FAIL — `resolverInscricao` não existe.

- [ ] **Step 3: implementar `resolverInscricao` em `extractor/src/api/workflows-live.ts`**

```typescript
/**
 * Qual inscrição deste contato retomar num workflow. Duas inscrições no mesmo workflow é
 * possível (a flag `allowMultiple` do GHL), e aí escolher por conta própria seria adivinhar.
 */
export function resolverInscricao(
  cruas: InscricaoCrua[], wid: string,
): { id: string } | { erro: string } {
  const minhas = cruas
    .filter((c) => String(c.workflowId ?? "") === wid)
    .map((c) => String(c._id ?? c.id ?? ""))
    .filter(Boolean);
  if (!minhas.length) return { erro: `este contato não está no workflow ${wid} agora.` };
  if (minhas.length > 1) {
    return {
      erro: `o contato tem ${minhas.length} inscrições neste workflow (${minhas.join(", ")}). ` +
        "Escolha uma com --inscricao <id>.",
    };
  }
  return { id: minhas[0] };
}
```

- [ ] **Step 4: rodar e ver passar**

Run: `cd extractor && npx tsx --test test/workflows-live.test.ts`
Expected: 17 testes PASS.

- [ ] **Step 5: escrever o handler de escrita em `extractor/src/cli.ts`**

```typescript
async function runWorkflowAcao(opts: {
  location: string; acao: string; id?: string; contato?: string; inscricao?: string;
  status?: string; usuario?: string; inicio?: string; confirmo?: boolean; json?: boolean;
}): Promise<void> {
  const log = opts.json ? console.error : console.log;
  if (!WF_ACOES.includes(opts.acao)) {
    throw new Error(`--acao inválida: ${opts.acao}. Aceitas: ${WF_ACOES.join(", ")}`);
  }
  if (!opts.confirmo) {
    throw new Error("Isto muda dado real da subconta e não tem desfazer. Repita com --confirmo.");
  }
  if (!opts.id) throw new Error(`${opts.acao} exige --id do workflow`);
  if (opts.acao === "publicar") {
    if (!opts.status) throw new Error("publicar exige --status: " + STATUS_WORKFLOW.join(" | "));
    if (!STATUS_WORKFLOW.includes(opts.status as StatusWorkflow)) {
      throw new Error(`--status inválido: ${opts.status}. Aceitos: ${STATUS_WORKFLOW.join(", ")}`);
    }
  } else if (opts.acao !== "retomar" && !opts.contato) {
    throw new Error(`${opts.acao} exige --contato`);
  } else if (opts.acao === "retomar" && !opts.contato && !opts.inscricao) {
    throw new Error("retomar exige --inscricao <id> ou --contato <id>");
  }

  await withClient(opts.location, log, async (client, _page, tokens) => {
    const userId = opts.usuario || decodeUserId(tokens.bearer, tokens.tokenId);
    if (!userId) {
      throw new Error(
        "não deu para descobrir o usuário logado a partir dos tokens, e toda escrita de " +
        "workflow é carimbada com o autor no histórico do GHL. Repita com --usuario <id>; " +
        "o id está no users.json do dump.",
      );
    }

    const wid = opts.id!;
    let aviso: string | undefined;
    let alvoInscricao = opts.inscricao;

    // despublicar: conta quem está dentro ANTES, porque depois a busca reflete o novo estado
    if (opts.acao === "publicar" && opts.status !== "published") {
      const p = await paginaDeInscritos(client, opts.location, wid, 100).catch(() => null);
      const stats = await contarInscritos(client, opts.location, wid).catch(() => ({} as { total?: number }));
      const dentro = p ? p.linhas.length : (stats.total ?? 0);
      aviso = avisoDespublicar(dentro);
      log(`aviso: ${aviso}`);
    }

    if (opts.acao === "retomar" && !alvoInscricao) {
      const d = await inscricoesDoContato(client, opts.location, opts.contato!);
      const r = resolverInscricao(d.workflowStatuses ?? [], wid);
      if ("erro" in r) throw new Error(r.erro);
      alvoInscricao = r.id;
    }

    const corpo = {
      acao: opts.acao,
      workflowId: wid,
      ...(opts.contato ? { contactId: opts.contato } : {}),
      ...(alvoInscricao ? { inscricaoId: alvoInscricao } : {}),
      ...(opts.status ? { status: opts.status } : {}),
      usuario: userId,
    };
    const antes = await getWorkflowMeta(client, opts.location, wid).catch(() => null);
    const registro = registroEscrita(opts.location, "_workflows", wid, {
      ...corpo, antes, aplicado: false,
    });
    log(`snapshot: ${registro}`);

    let r: unknown;
    try {
      switch (opts.acao) {
        case "publicar":
          r = await mudarStatus(client, opts.location, wid, opts.status as StatusWorkflow, userId);
          break;
        case "inscrever":
          r = await inscreverContato(client, opts.location, wid, opts.contato!, userId, opts.inicio);
          break;
        case "remover":
          r = await removerContato(client, opts.location, opts.contato!, wid, userId);
          break;
        case "retomar":
          r = await retomarInscricao(client, opts.location, alvoInscricao!, userId);
          break;
      }
    } catch (e) {
      fs.writeFileSync(registro, JSON.stringify({
        em: new Date().toISOString(), ...corpo, antes, aplicado: false, erro: String(e),
      }, null, 2));
      throw e;
    }
    fs.writeFileSync(registro, JSON.stringify({
      em: new Date().toISOString(), ...corpo, antes, aplicado: true, resposta: r,
    }, null, 2));

    if (opts.acao === "inscrever") {
      aviso = "a entrada no workflow é enfileirada pelo servidor: ler o estado agora pode " +
        "não mostrar o contato ainda, sem que nada tenha falhado.";
      log(`aviso: ${aviso}`);
    }

    const out = saidaWorkflowAcao({ acao: opts.acao, workflowId: wid, resposta: r, registro, aviso });
    if (opts.json) console.log(JSON.stringify(out));
    else log(`ok — ${opts.acao}; registro em ${registro}`);
  });
}
```

Acrescente `resolverInscricao` ao import de `./api/workflows-live.js` no topo do `cli.ts`.

- [ ] **Step 6: registrar o comando**

```typescript
program
  .command("workflow-acao")
  .description("ESCREVE: publica/despublica workflow, inscreve, remove ou retoma um contato")
  .requiredOption("-l, --location <id>", "locationId da subconta")
  .requiredOption("--acao <a>", WF_ACOES.join(" | "))
  .requiredOption("-i, --id <id>", "id do workflow")
  .option("--contato <id>", "id do contato (inscrever, remover, retomar)")
  .option("--inscricao <id>", "id da inscrição (retomar); sem ele, resolve pelo contato")
  .option("--status <s>", STATUS_WORKFLOW.join(" | ") + " (com --acao publicar)")
  .option("--usuario <id>", "autor da ação; sem ele, sai do token")
  .option("--inicio <iso>", "início programado da execução (inscrever), ISO com fuso")
  .option("--confirmo", "obrigatório: muda dado real e não tem desfazer")
  .option("--json", "imprime o resultado em JSON no stdout")
  .action((o) => runWorkflowAcao(o).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); }));
```

- [ ] **Step 7: script no `extractor/package.json`**

```json
    "workflow-acao": "tsx src/cli.ts workflow-acao",
```

- [ ] **Step 8: conferir a recusa sem `--confirmo` na mão (não há rede envolvida: a guarda estoura antes)**

```bash
cd extractor
npx tsx src/cli.ts workflow-acao -l L1 --acao publicar -i W1 --status draft ; echo "saida=$?"
```
Expected: imprime `Isto muda dado real da subconta e não tem desfazer. Repita com --confirmo.` e `saida=1`. Nenhuma janela de Chrome abre.

```bash
npx tsx src/cli.ts workflow-acao -l L1 --acao voar -i W1 --confirmo ; echo "saida=$?"
```
Expected: `--acao inválida: voar. Aceitas: publicar, inscrever, remover, retomar` e `saida=1`.

- [ ] **Step 9: typecheck e suíte**

Run: `cd extractor && npx tsc --noEmit && npm test`
Expected: limpo, tudo passando.

- [ ] **Step 10: commit**

```bash
git add extractor/src/cli.ts extractor/src/api/workflows-live.ts extractor/test/workflows-live.test.ts extractor/package.json
git commit -m "feat: comando workflow-acao com autoria e rastro por workflow"
```

---

### Task 7: as duas tools MCP

Espelham os dois comandos. Não chamam `_load` e não devolvem `_snapshot` (A15) — e é
justamente isso que um teste precisa fixar, senão alguém "conserta" para o padrão das
outras e volta a exigir dump.

A tool `workflow` existente ganha uma frase na descrição dizendo que o que ela devolve vem
do snapshot (A16). Nada mais nela muda.

**Files:**
- Modify: `auditor/src/automaster_audit/mcp_server.py` (constantes perto de `:549`; duas funções perto de `:751`; duas entradas no dict `TOOLS`; descrição da tool `workflow` em `:877`)
- Test: `auditor/tests/test_mcp_workflows_ao_vivo.py` (criar)

**Interfaces:**
- Consumes: `_run_extractor`, `ToolError`, `_LOC` do próprio módulo.
- Produces: tools `workflows_ao_vivo` e `workflow_acao` no dict `TOOLS`.

- [ ] **Step 1: escrever os testes que falham**

Crie `auditor/tests/test_mcp_workflows_ao_vivo.py`:

```python
import pytest
from automaster_audit import mcp_server as srv


@pytest.fixture
def espiao(monkeypatch):
    chamadas = []

    def falso(*args):
        chamadas.append(args)
        return {"aplicado": True}

    monkeypatch.setattr(srv, "_run_extractor", falso)
    # nenhum _load aqui de propósito: estas tools não podem depender de dump
    monkeypatch.setattr(srv, "_load", lambda loc, snap=None: pytest.fail(
        "tool ao vivo de workflow não pode chamar o loader"))
    return chamadas


def test_leitura_lista_monta_os_argumentos(espiao):
    srv.workflows_ao_vivo(loc="L1")
    assert espiao[0] == ("workflows-ao-vivo", "-l", "L1", "-o", "lista", "--json")


def test_leitura_dentro_exige_id(espiao):
    with pytest.raises(srv.ToolError, match="id"):
        srv.workflows_ao_vivo(loc="L1", o="dentro")
    assert espiao == []


def test_leitura_contato_exige_contato(espiao):
    with pytest.raises(srv.ToolError, match="contato"):
        srv.workflows_ao_vivo(loc="L1", o="contato")
    assert espiao == []


def test_leitura_o_invalido(espiao):
    with pytest.raises(srv.ToolError, match="o inválido"):
        srv.workflows_ao_vivo(loc="L1", o="voar")
    assert espiao == []


def test_leitura_passa_limite_e_nomes(espiao):
    srv.workflows_ao_vivo(loc="L1", o="dentro", id="W1", limite=50, nomes=True)
    args = espiao[0]
    assert "--limite" in args and args[args.index("--limite") + 1] == "50"
    assert "--nomes" in args


def test_leitura_sem_nomes_nao_manda_a_flag(espiao):
    srv.workflows_ao_vivo(loc="L1", o="dentro", id="W1")
    assert "--nomes" not in espiao[0]


def test_leitura_nao_traz_snapshot(espiao):
    out = srv.workflows_ao_vivo(loc="L1")
    assert "_snapshot" not in out


def test_acao_exige_confirmo(espiao):
    with pytest.raises(srv.ToolError, match="confirmo=true"):
        srv.workflow_acao(loc="L1", acao="publicar", id="W1", status="draft")
    assert espiao == []


def test_acao_invalida(espiao):
    with pytest.raises(srv.ToolError, match="acao inválida"):
        srv.workflow_acao(loc="L1", acao="voar", id="W1", confirmo=True)
    assert espiao == []


def test_publicar_exige_status_valido(espiao):
    with pytest.raises(srv.ToolError, match="status"):
        srv.workflow_acao(loc="L1", acao="publicar", id="W1", confirmo=True)
    with pytest.raises(srv.ToolError, match="status inválido"):
        srv.workflow_acao(loc="L1", acao="publicar", id="W1", status="voando", confirmo=True)
    assert espiao == []


def test_inscrever_exige_contato(espiao):
    with pytest.raises(srv.ToolError, match="contato"):
        srv.workflow_acao(loc="L1", acao="inscrever", id="W1", confirmo=True)
    assert espiao == []


def test_retomar_aceita_contato_ou_inscricao(espiao):
    srv.workflow_acao(loc="L1", acao="retomar", id="W1", inscricao="S1", confirmo=True)
    assert "--inscricao" in espiao[0]
    srv.workflow_acao(loc="L1", acao="retomar", id="W1", contato="C1", confirmo=True)
    assert "--contato" in espiao[1]
    with pytest.raises(srv.ToolError, match="inscricao"):
        srv.workflow_acao(loc="L1", acao="retomar", id="W1", confirmo=True)


def test_acao_monta_os_argumentos_com_confirmo(espiao):
    srv.workflow_acao(loc="L1", acao="remover", id="W1", contato="C1", confirmo=True)
    args = espiao[0]
    assert args[:6] == ("workflow-acao", "-l", "L1", "--acao", "remover", "--confirmo")
    assert "--json" in args


def test_as_duas_tools_estao_declaradas():
    for nome in ("workflows_ao_vivo", "workflow_acao"):
        assert nome in srv.TOOLS
    func, desc, props, req = srv.TOOLS["workflow_acao"]
    assert "ESCREVE" in desc
    assert req == ["loc", "acao", "id"]
    assert "snapshot" not in props, "tool ao vivo de workflow não usa dump"


def test_tool_do_dump_avisa_que_e_do_dump():
    _, desc, _, _ = srv.TOOLS["workflow"]
    assert "dump" in desc.lower()
```

- [ ] **Step 2: rodar e ver falhar**

Run: `cd auditor && .venv/bin/python -m pytest tests/test_mcp_workflows_ao_vivo.py -q`
Expected: FAIL — `AttributeError: module ... has no attribute 'workflows_ao_vivo'`.

- [ ] **Step 3: acrescentar as constantes, perto de `mcp_server.py:549`**

```python
WF_LEITURA = ("lista", "dentro", "contato")
WF_ACOES = ("publicar", "inscrever", "remover", "retomar")
WF_STATUS = ("published", "draft", "locked", "paused")
```

- [ ] **Step 4: escrever as duas funções, junto das outras tools ao vivo**

```python
def workflows_ao_vivo(loc: str, o: str = "lista", id: str | None = None,
                      contato: str | None = None, limite: int | None = None,
                      nomes: bool = False) -> dict:
    """Leitura ao vivo de workflows e inscrições. Não usa o dump."""
    if o not in WF_LEITURA:
        raise ToolError(f"o inválido: {o}. Aceitos: {', '.join(WF_LEITURA)}")
    if o == "dentro" and not id:
        raise ToolError("o=dentro exige o id do workflow")
    if o == "contato" and not contato:
        raise ToolError("o=contato exige o contato")
    args = ["workflows-ao-vivo", "-l", loc, "-o", o]
    for flag, val in (("-i", id), ("--contato", contato),
                      ("--limite", str(limite) if limite else None)):
        if val:
            args += [flag, val]
    if nomes:
        args += ["--nomes"]
    return _run_extractor(*args, "--json")


def workflow_acao(loc: str, acao: str, id: str, contato: str | None = None,
                  inscricao: str | None = None, status: str | None = None,
                  usuario: str | None = None, inicio: str | None = None,
                  confirmo: bool = False) -> dict:
    """ESCREVE: publica/despublica um workflow, inscreve, remove ou retoma um contato."""
    if acao not in WF_ACOES:
        raise ToolError(f"acao inválida: {acao}. Aceitas: {', '.join(WF_ACOES)}")
    if not confirmo:
        raise ToolError("Isto muda dado real da subconta e não tem desfazer. Repita com confirmo=true.")
    if acao == "publicar":
        if not status:
            raise ToolError(f"publicar exige status: {', '.join(WF_STATUS)}")
        if status not in WF_STATUS:
            raise ToolError(f"status inválido: {status}. Aceitos: {', '.join(WF_STATUS)}")
    elif acao in ("inscrever", "remover") and not contato:
        raise ToolError(f"{acao} exige o contato")
    elif acao == "retomar" and not (contato or inscricao):
        raise ToolError("retomar exige inscricao ou contato")
    args = ["workflow-acao", "-l", loc, "--acao", acao, "--confirmo", "-i", id]
    for flag, val in (("--contato", contato), ("--inscricao", inscricao),
                      ("--status", status), ("--usuario", usuario), ("--inicio", inicio)):
        if val:
            args += [flag, val]
    return _run_extractor(*args, "--json")
```

- [ ] **Step 5: declarar as duas no dict `TOOLS`, depois de `agenda_acao`**

```python
    "workflows_ao_vivo": (workflows_ao_vivo, "Leitura AO VIVO de workflows (abre Chrome, não usa o "
                          "dump e não exige extração prévia): `lista` (todos os workflows com o status "
                          "corrente), `dentro` (quem está dentro de um workflow agora, com o passo em "
                          "que cada um parou, desde quando e por que entrou), `contato` (em que "
                          "workflows um contato está agora). Teto de 500 inscritos, ajustável por "
                          "`limite`; a resposta declara se cortou. `nomes=true` resolve o nome de cada "
                          "contato, uma chamada por contato — lento em lista grande.",
                          {"loc": _LOC, "o": {"type": "string", "enum": list(WF_LEITURA), "default": "lista"},
                           "id": {"type": "string", "description": "id do workflow (com o=dentro)"},
                           "contato": {"type": "string", "description": "id do contato (com o=contato)"},
                           "limite": {"type": "integer", "description": "teto de inscritos (padrão 500)"},
                           "nomes": {"type": "boolean", "default": False}},
                          ["loc"]),
    "workflow_acao": (workflow_acao, "ESCREVE EM PRODUÇÃO: publica ou despublica um workflow "
                      "(`publicar` com o status desejado), inscreve um contato, remove um contato ou "
                      "retoma uma inscrição parada. Exige confirmo=true; registro em "
                      "<dumps>/_workflows/<workflowId>/. Despublicar NÃO remove ninguém: quem está "
                      "dentro congela no passo em que está e volta a andar, todo mundo de uma vez, "
                      "quando o workflow for republicado. Inscrever é enfileirado pelo servidor — ler "
                      "logo depois pode não mostrar o contato ainda. A ação é carimbada com o usuário "
                      "logado no histórico do GHL; `usuario` sobrescreve.",
                      {"loc": _LOC, "acao": {"type": "string", "enum": list(WF_ACOES)},
                       "id": {"type": "string", "description": "id do workflow"},
                       "contato": {"type": "string", "description": "inscrever, remover, retomar"},
                       "inscricao": {"type": "string", "description": "id da inscrição (retomar)"},
                       "status": {"type": "string", "enum": list(WF_STATUS),
                                  "description": "com acao=publicar"},
                       "usuario": {"type": "string", "description": "autor; sem ele, sai do token"},
                       "inicio": {"type": "string", "description": "início programado (inscrever), ISO com fuso"},
                       "confirmo": {"type": "boolean", "default": False}},
                      ["loc", "acao", "id"]),
```

- [ ] **Step 6: marcar a tool `workflow` como leitura de dump (`mcp_server.py:877`)**

Troque a descrição por:

```python
    "workflow": (workflow, "DO DUMP (pode estar velho; para o estado corrente use `workflows_ao_vivo`): "
                 "meta, árvore de caminhos (teto ~1.5k tokens, flag caminhos_truncado) e achados de um workflow.",
                 {"loc": _LOC, "id": {"type": "string"}, "snapshot": _SNAP}, ["loc", "id"]),
```

- [ ] **Step 7: rodar e ver passar**

Run: `cd auditor && .venv/bin/python -m pytest tests/test_mcp_workflows_ao_vivo.py -q`
Expected: 15 PASS.

- [ ] **Step 8: rodar a suíte inteira do auditor**

Run: `cd auditor && .venv/bin/python -m pytest -q`
Expected: 231 anteriores + 15 novos = 246 PASS. Se `test_every_tool_carries_snapshot_block`
falhar, é porque ele varre o dict `TOOLS` inteiro em vez de uma lista fixa — nesse caso
acrescente as duas tools novas à exclusão do teste, com um comentário citando A15, e **não**
faça as tools devolverem `_snapshot`.

- [ ] **Step 9: commit**

```bash
git add auditor/src/automaster_audit/mcp_server.py auditor/tests/test_mcp_workflows_ao_vivo.py
git commit -m "feat: tools MCP workflows_ao_vivo e workflow_acao"
```

---

### Task 8: prova ao vivo na Instaltech

Rota de API não vira teste automatizado. Esta tarefa é a prova, e ela é **serial**: o perfil
persistente do Chrome é único, e dois comandos de escrita ao mesmo tempo disputam o
`SingletonLock` — foi assim que a validação de formulários gerou uma cópia e uma exclusão
que ninguém pediu. **Nunca despachar dois agentes escrevendo ao vivo.**

Subconta: `Xb9gDxwxYhdqtprGcb5E` (Instaltech). Contato de teste: `uWqujqll20tRuglV3mLt`.

**Files:**
- Create: `docs/superpowers/handoffs/2026-09-20-workflows-ao-vivo-prova.md` (o que aconteceu em cada passo)
- Modify: `docs/endpoints.md` (seção nova, só depois de cada rota responder)

- [ ] **Step 1: preparar o alvo descartável**

Crie um workflow pela interface do GHL chamado `ZZ TESTE AUTOMASTER`, com um gatilho manual
e um passo de espera de 2 dias (o passo de espera é o que deixa o contato parado onde dá
para ver). Anote o id da URL. Não há rota de criação no escopo, então este passo é manual.

- [ ] **Step 2: leitura, os dois lados, antes de qualquer escrita**

```bash
cd extractor
npm run workflows-ao-vivo -- -l Xb9gDxwxYhdqtprGcb5E -o lista --json
npm run workflows-ao-vivo -- -l Xb9gDxwxYhdqtprGcb5E -o dentro -i <WID> --json
npm run workflows-ao-vivo -- -l Xb9gDxwxYhdqtprGcb5E -o contato --contato uWqujqll20tRuglV3mLt --json
```
Expected: a lista traz o workflow novo com `status`; `dentro` traz `inscricoes: []` com
`vazio_porque` explicando; `contato` responde sem erro.
Registre: a rota de contagem (`enroll-stats`) responde ou 404?

- [ ] **Step 3: inscrever, esperar, conferir**

```bash
npm run workflow-acao -- -l Xb9gDxwxYhdqtprGcb5E --acao inscrever -i <WID> --contato uWqujqll20tRuglV3mLt --confirmo --json
sleep 30
npm run workflows-ao-vivo -- -l Xb9gDxwxYhdqtprGcb5E -o dentro -i <WID> --nomes --json
```
Expected: a escrita devolve `aplicado: true` e o aviso da fila; depois da espera, uma
inscrição, com `passo` preenchido e `contato` com o nome.
Confirme também o formato de `getContact`: o código supõe `{contact: {name}}`. Se o nome vier
em outro lugar, ajuste `nomesDeContatos` em `extractor/src/cli.ts` e registre o formato real.

Registre: quanto tempo levou para aparecer, e o que veio em `currentStepName`, `status` e
`meta.addedSource.source` (o app inscreve manualmente com `add_to_campaign_modal` — confira
se o servidor guardou esse valor ou outro).

- [ ] **Step 4: testar se o servidor aceita uma origem nossa**

Rode uma vez com a constante `FONTE_CONTATO` trocada para `"automaster"` em
`extractor/src/api/workflows-live.ts`, inscrevendo o contato de novo:

```bash
npm run workflow-acao -- -l Xb9gDxwxYhdqtprGcb5E --acao inscrever -i <WID> --contato uWqujqll20tRuglV3mLt --confirmo --json
```
Se aceitar (HTTP 2xx) e a leitura mostrar `origem: automaster`, mantenha o valor novo e
registre: ação nossa passa a ser distinguível no histórico do cliente. Se der `422`,
reverta para `add_to_campaign_modal` e registre que o enum é fechado.

- [ ] **Step 5: o caso da inscrição dupla**

Se o passo 4 deixou o contato inscrito duas vezes, é a chance de responder a pergunta que a
spec deixou aberta:

```bash
npm run workflows-ao-vivo -- -l Xb9gDxwxYhdqtprGcb5E -o contato --contato uWqujqll20tRuglV3mLt --json
npm run workflow-acao -- -l Xb9gDxwxYhdqtprGcb5E --acao remover -i <WID> --contato uWqujqll20tRuglV3mLt --confirmo --json
npm run workflows-ao-vivo -- -l Xb9gDxwxYhdqtprGcb5E -o dentro -i <WID> --json
```
Registre: a remoção por contato tirou as duas inscrições ou só uma? Se o workflow não
aceitar inscrição dupla (`allowMultiple` desligado), registre isso e siga.

- [ ] **Step 6: retomar**

```bash
npm run workflow-acao -- -l Xb9gDxwxYhdqtprGcb5E --acao retomar -i <WID> --contato uWqujqll20tRuglV3mLt --confirmo --json
```
Expected, com o contato já removido: o resolvedor recusa com "este contato não está no
workflow". Reinscreva, remova, e tente retomar para descobrir se `force-resume` religa uma
inscrição parada por remoção ou só uma pausada por outro motivo. Registre o que for.

- [ ] **Step 7: despublicar com gente dentro, e republicar**

```bash
npm run workflow-acao -- -l Xb9gDxwxYhdqtprGcb5E --acao inscrever -i <WID> --contato uWqujqll20tRuglV3mLt --confirmo --json
sleep 30
npm run workflow-acao -- -l Xb9gDxwxYhdqtprGcb5E --acao publicar -i <WID> --status draft --confirmo --json
npm run workflows-ao-vivo -- -l Xb9gDxwxYhdqtprGcb5E -o dentro -i <WID> --json
npm run workflow-acao -- -l Xb9gDxwxYhdqtprGcb5E --acao publicar -i <WID> --status published --confirmo --json
npm run workflows-ao-vivo -- -l Xb9gDxwxYhdqtprGcb5E -o dentro -i <WID> --json
```
Expected: o aviso de congelamento sai com o número certo; depois de despublicar o contato
continua na lista (congelado, não removido); depois de republicar continua lá.
Registre: o `status` da inscrição muda para algo como `paused_due_to_draft_mode`?

- [ ] **Step 8: conferir a autoria e o rastro**

```bash
ls -R ~/.automaster/dumps/_workflows/Xb9gDxwxYhdqtprGcb5E/
cat ~/.automaster/dumps/_workflows/Xb9gDxwxYhdqtprGcb5E/<WID>/*.json | head -40
```
Expected: um arquivo por escrita, agrupado por workflow, com `antes`, `aplicado` e `usuario`
preenchido. Abra o histórico do workflow na interface do GHL e confirme que as ações
aparecem com o nome do usuário certo.

- [ ] **Step 9: limpar**

Remova o contato do workflow, apague o workflow `ZZ TESTE AUTOMASTER` pela interface, e
confirme que não sobrou nada:

```bash
npm run workflows-ao-vivo -- -l Xb9gDxwxYhdqtprGcb5E -o contato --contato uWqujqll20tRuglV3mLt --json
```
Expected: o contato não está em nenhum workflow de teste.
Registre qualquer resíduo que não deu para apagar, com o id.

- [ ] **Step 10: escrever o que aconteceu**

Crie `docs/superpowers/handoffs/2026-09-20-workflows-ao-vivo-prova.md` com: uma linha por
passo dizendo o que respondeu e o que não respondeu; a tabela de rotas com coluna "Ao vivo"
marcada só no que foi exercitado de verdade; as premissas do plano que caíram; e o resíduo.
Nada de "validado" em rota que não foi chamada.

- [ ] **Step 11: commit**

```bash
git add docs/superpowers/handoffs/2026-09-20-workflows-ao-vivo-prova.md extractor/src/api/workflows-live.ts
git commit -m "docs: prova ao vivo de workflows na Instaltech"
```

---

### Task 9: documentação e versão

Só depois da Task 8, porque o que entra aqui é o que foi provado.

**Files:**
- Modify: `docs/endpoints.md` (seção `## Workflows ao vivo`, depois da seção `## Workflows`)
- Modify: `CHANGELOG.md` (entrada `## 0.13.0`)
- Modify: `.claude-plugin/plugin.json` (versão e descrição)
- Modify: `CLAUDE.md` (lista de tools, comandos, ponto crítico)
- Modify: `skills/automaster-leitura/SKILL.md` (frontmatter + seção nova)

- [ ] **Step 1: seção em `docs/endpoints.md`**

Siga o formato vigente (veja `## Oportunidades`, `docs/endpoints.md:416`): duas linhas de
contexto com host, data e subconta; tabelas com colunas `| O que | Rota | Ao vivo |` para
leitura e `| O que | Rota | Corpo | Ao vivo |` para escrita, com `✓` só no exercitado;
depois os parágrafos de armadilha. Inclua obrigatoriamente:

- o prefixo plural `/workflows/` da busca de inscritos contra o singular `/workflow/`;
- que despublicar congela em vez de remover;
- que inscrever é enfileirado;
- que `force-resume` age sobre o id da inscrição, não do contato;
- o que o passo 4 descobriu sobre o valor de `source`;
- a correção da nota antiga de descoberta de bundle: o app agora carrega de
  `production.app-manifest.leadconnectorhq.com/latest/manifest.json`, e o editor de workflow
  é uma aplicação à parte em `client-app-automation-workflows.leadconnectorhq.com` (A18).

- [ ] **Step 2: entrada no `CHANGELOG.md`**

No formato das anteriores — título `## 0.13.0 — 2026-09-20`, parágrafo que nomeia as tools
novas e o total, depois bullets com negrito no que muda contrato:

```markdown
## 0.13.0 — 2026-09-20

Workflows ao vivo. Duas tools novas (`workflows_ao_vivo`, `workflow_acao`), 29 no total,
módulo `extractor/src/api/workflows-live.ts` e dois comandos de CLI.

- Leitura ao vivo pelos dois lados: quem está dentro de um workflow (com o passo em que
  cada um parou, desde quando e por que entrou) e em que workflows um contato está.
- Escrita: publicar/despublicar, inscrever, remover e retomar. Tudo atrás de `confirmo`,
  com registro em `<dumps>/_workflows/<workflowId>/`.
- **Despublicar não remove ninguém**: quem está dentro congela no passo em que está e volta
  a andar, todo mundo de uma vez, na republicação.
- **Inscrever é enfileirado pelo servidor**: ler o estado logo depois pode não mostrar o
  contato ainda.
- **Toda escrita é carimbada com o usuário logado**, lido do token; sem conseguir ler, a
  escrita recusa e pede `usuario`.
- A tool `workflow` passa a declarar na descrição que lê o dump — o estado corrente é da
  tool nova. Comportamento inalterado.
- Teto de 500 inscritos por leitura, ajustável, com declaração de corte.

Rotas em `docs/endpoints.md`, seção `## Workflows ao vivo`.
```

- [ ] **Step 3: `.claude-plugin/plugin.json`**

Suba `"version"` para `"0.13.0"` e atualize a `description`, que hoje diz "27 tools MCP".

- [ ] **Step 4: `CLAUDE.md`**

Três lugares: a lista de tools na seção de arquitetura (de vinte e sete para vinte e nove,
com os dois nomes novos); o bloco de comandos do extractor (as duas linhas de
`npm run workflows-ao-vivo` e `npm run workflow-acao`); e um ponto crítico novo dizendo que
despublicar congela em vez de remover.

- [ ] **Step 5: `skills/automaster-leitura/SKILL.md`**

Dois lugares, como manda o precedente: os dois nomes entram na lista do frontmatter
`description` (é ela que dispara a skill), e uma seção `##` nova no corpo, no molde de
`## Formulários e surveys` (`SKILL.md:109`). A seção precisa dizer, em parágrafos:

- que `workflow` é do dump e `workflows_ao_vivo` é de agora, e quando usar cada uma — este
  par não tem precedente na skill, é a primeira vez que duas tools tratam do mesmo assunto
  com frescores diferentes;
- que lista vazia vem com `vazio_porque`, e que `estrangulado: true` significa lista cortada
  pelo servidor, não ausência de gente;
- que `cortou: true` significa que existe mais gente do que a resposta mostra;
- que despublicar congela, e que inscrever é enfileirado.

- [ ] **Step 6: conferir que tudo continua passando**

```bash
cd extractor && npx tsc --noEmit && npm test
cd ../auditor && .venv/bin/python -m pytest -q
```
Expected: typecheck limpo, extractor verde, 246 testes no auditor.

- [ ] **Step 7: commit**

```bash
git add docs/endpoints.md CHANGELOG.md .claude-plugin/plugin.json CLAUDE.md skills/automaster-leitura/SKILL.md
git commit -m "docs: plugin 0.13.0, workflows ao vivo"
```

---

## Ordem e dependências

1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9, em série.

As Tasks 2 e 3 podem trocar de ordem, mas 3 depende dos tipos declarados em 2. A Task 8 é
serial por construção e não aceita paralelismo nem entre si: **um comando de escrita por
vez**, sempre.

## Verificação final, antes de considerar pronto

```bash
cd extractor && npx tsc --noEmit && npm test
cd ../auditor && .venv/bin/python -m pytest -q
git status --short          # árvore limpa
grep -c '"version"' .claude-plugin/plugin.json
```

Nada é "validado" sem um comando que rodou e uma resposta que voltou. Rota não exercitada
entra na documentação sem o `✓`.
