# Notas e tarefas do contato + tags da subconta — plano de implementação (0.20.0)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dar ao plugin automaster leitura e escrita de nota de contato, tarefa de contato e tag da subconta, no padrão das áreas já entregues.

**Architecture:** dois módulos novos no extractor (`api/annotations.ts`, `api/tags.ts`) que só falam HTTP, quatro comandos de CLI que orquestram prévia/guarda/rastro, e quatro tools MCP no auditor que chamam a CLI por subprocesso. Nada entra no dump: as quatro áreas são ao vivo. A tool `tags` é a única que também lê o dump, para cruzar cada tag com os workflows que a citam.

**Tech Stack:** TypeScript + Playwright (extractor, `node:test`), Python 3.12 (auditor, pytest), API pública GHL v3 em `services.leadconnectorhq.com` com os dois tokens da sessão.

**Spec:** `docs/superpowers/specs/2026-09-21-notas-tarefas-tags-design.md`

**Dossiê de pesquisa:** `docs/superpowers/research/2026-09-21-notas-tarefas-tags-research.md`

## Global Constraints

- Host de todas as rotas novas: `https://services.leadconnectorhq.com`. Os dois tokens da sessão (`authorization: Bearer` + `token-id`) e UA de browser são obrigatórios — o `GhlClient` já manda todos.
- Escrita ao vivo é **serial**: o perfil Chrome `~/.automaster/chrome-profile` é único. Nunca rodar dois comandos de escrita em paralelo, nem despachar dois agentes que escrevam ao mesmo tempo.
- Padrão de escrita: sem `--confirmo` é prévia e não grava nada; com `--confirmo` grava. A CLI é a camada crua; a guarda mora na tool MCP.
- Toda escrita deixa rastro via `registroEscrita(loc, pasta, chave, dados)` (`extractor/src/cli.ts:552`), que grava em `<DUMPS_DIR>/<pasta>/<loc>/<chave>/<ts>.json`.
- `DELETE` de tag e de nota/tarefa devolve `succeded` (grafia errada) e/ou `succeeded`. Ler sempre `r.succeeded ?? r.succeded`.
- Criar tarefa exige `title`, `dueDate` **e `completed`**; a CLI manda `completed: false` quando o usuário não disser nada. `dueDate` é texto ISO 8601.
- Criar tag responde **200**, não 201.
- Nomes de tag são comparados em minúsculas: `ctx.tag_names` já vem normalizado (`auditor/src/automaster_audit/loader.py:147`).
- Subconta de validação: `Xb9gDxwxYhdqtprGcb5E` (Instaltech). Contato de teste: `uWqujqll20tRuglV3mLt`. Zero resíduo ao fim.
- Versão final 0.20.0 em `.claude-plugin/plugin.json`, `CHANGELOG.md` e `CLAUDE.md`.

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `extractor/src/api/annotations.ts` (novo) | HTTP puro de nota e tarefa do contato, mais a busca de tarefa por subconta. Nenhuma decisão de produto. |
| `extractor/src/api/tags.ts` (novo) | HTTP puro de criar, renomear e apagar tag da subconta. A leitura reusa `fetchTags` de `api/entities.ts:26`. |
| `extractor/src/cli.ts` (modificar) | 4 funções `run*` + 4 blocos `program.command(...)` + 2 consts de vocabulário. |
| `extractor/package.json` (modificar) | 4 scripts npm. |
| `auditor/src/automaster_audit/mcp_server.py` (modificar) | 4 funções + 4 entradas em `TOOLS`. |
| `extractor/test/annotations.test.ts`, `extractor/test/tags.test.ts` (novos) | Testes dos módulos de API com cliente falso. |
| `auditor/tests/test_mcp_anotacoes_tags.py` (novo) | Testes das tools: guardas, argv montado, contrato do schema. |
| `docs/endpoints.md`, `CHANGELOG.md`, `CLAUDE.md`, `.claude-plugin/plugin.json`, `skills/automaster-leitura/SKILL.md` (modificar) | Documentação e versão. |

---

### Task 1: rotas em `docs/endpoints.md`

Vem primeiro por exigência da spec: rota documentada antes de código.

**Files:**
- Modify: `docs/endpoints.md` (nova seção no fim, `## Notas, tarefas e tags da subconta`)

**Interfaces:**
- Consumes: nada.
- Produces: a seção que as Tasks 2 e 3 citam nos doc-comments dos módulos.

- [ ] **Step 1: escrever a seção**

Acrescente ao fim de `docs/endpoints.md`:

```markdown
## Notas, tarefas e tags da subconta

Tudo em `services.leadconnectorhq.com`, com os dois tokens da sessão. Mapeado a partir do
mirror offline dos docs v3 (skill `ghl-api-docs`) e provado ao vivo na Instaltech em
2026-09-21.

### Notas do contato

| O que | Rota | Corpo | Prova |
|---|---|---|---|
| Listar | `GET /contacts/<contactId>/notes` | — | |
| Ler uma | `GET /contacts/<contactId>/notes/<noteId>` | — | |
| Criar | `POST /contacts/<contactId>/notes` | `{body}` obrigatório; `userId`, `title`, `color`, `pinned` opcionais | responde **201** |
| Editar | `PUT /contacts/<contactId>/notes/<noteId>` | qualquer subconjunto de `{body, title, color, pinned, userId}` | |
| Apagar | `DELETE /contacts/<contactId>/notes/<noteId>` | — | devolve `succeeded`, com alias legado `succeded` |

**Não confundir com nota de compromisso** (`/calendars/appointments/<id>/notes`, seção
`## Agenda`): o pai ali é o compromisso, não o contato.

`title`, `color` e `pinned` aparecem no schema de create/update mas não no exemplo de
resposta — trate como possivelmente ausentes na leitura.

### Tarefas do contato

| O que | Rota | Corpo |
|---|---|---|
| Listar | `GET /contacts/<contactId>/tasks` | — |
| Ler uma | `GET /contacts/<contactId>/tasks/<taskId>` | — |
| Criar | `POST /contacts/<contactId>/tasks` | **`title`, `dueDate` e `completed` obrigatórios**; `body` e `assignedTo` opcionais |
| Editar | `PUT /contacts/<contactId>/tasks/<taskId>` | tudo opcional (é patch, apesar do verbo) |
| Concluir | `PUT /contacts/<contactId>/tasks/<taskId>/completed` | `{completed: true}` |
| Apagar | `DELETE /contacts/<contactId>/tasks/<taskId>` | — |
| Buscar na subconta | `POST /locations/<loc>/tasks/search` | `{contactId[], completed, assignedTo[], query, limit, skip}`; `limit` padrão 25 |

**`completed` é obrigatório na criação** — sem ele o POST recusa. A CLI manda `false` por
padrão.

**`dueDate` é texto ISO 8601** (`2026-10-25T11:00:00Z`). É o inverso da armadilha da agenda,
onde `/calendars/events` só aceita epoch em milissegundos e texto ISO devolve lista vazia sem
erro.

### Tags da subconta

| O que | Rota | Corpo |
|---|---|---|
| Listar | `GET /locations/<loc>/tags/search?skip=0&limit=10000&query=&getCount=true` | — (já usado por `fetchTags`) |
| Criar | `POST /locations/<loc>/tags` | `{name}`; responde **200**, não 201 |
| Renomear | `PUT /locations/<loc>/tags/<tagId>` | `{name}` |
| Apagar | `DELETE /locations/<loc>/tags/<tagId>` | — |

**Renomear propaga para os workflows, inclusive no trigger.** Provado ao vivo em 2026-09-21
(`docs/superpowers/provas/2026-09-21-prova-tag-rename.ts`): tag descartável citada por um step
`add_contact_tag` e por um trigger `contact_tag`, renomeada pelo `PUT`; ao reler, os dois
campos já traziam o nome novo. Isso importa porque **workflow guarda o NOME da tag, nunca o
id** — em step, em trigger e em condição de `if_else`, medido em 34 de 34 valores do dump da
Instaltech. Se o servidor não propagasse, renomear quebraria em silêncio todo workflow que
cita a tag.

O `POST` devolve campos que a doc não lista: `categoryId`, `description`, `color`, todos
`null`. O `DELETE` devolve **as duas grafias**: `{"succeded":true,"succeeded":true}`.

**Apagar é a operação perigosa, não renomear.** A tag sai de todos os contatos que a têm, com
restauração por 60 dias segundo o help oficial (artigo hoje 404, só o resumo indexado
sobreviveu). Se isso dispara os workflows com trigger de "tag removida" **não tem prova**: o
rename tinha esse defeito até a HighLevel corrigi-lo em 15/05/2024, e provar no apagar
exigiria disparar automação na base real de um cliente. Por isso a guarda `--apagar-citada`.

**Não existe contagem de contatos por tag** em lugar nenhum do GHL: o payload da tag tem só
`name`, `locationId` e `id`, e o pedido de mostrar a contagem na tela de Tags está com status
"planned" (129 votos). A prévia do apagar declara que não sabe esse número em vez de estimá-lo.
```

- [ ] **Step 2: commit**

```bash
git add docs/endpoints.md
git commit -m "docs(endpoints): rotas de nota, tarefa e tag da subconta"
```

---

### Task 2: `api/annotations.ts`

**Files:**
- Create: `extractor/src/api/annotations.ts`
- Test: `extractor/test/annotations.test.ts`

**Interfaces:**
- Consumes: `GhlClient` de `./client.js` (métodos `getJson`, `postJson`, `putJson`, `deleteJson`).
- Produces, todos exportados de `api/annotations.ts`:
  - `type Tipo = "nota" | "tarefa"`
  - `listar(client: GhlClient, tipo: Tipo, contactId: string): Promise<unknown>`
  - `ler(client: GhlClient, tipo: Tipo, contactId: string, id: string): Promise<unknown>`
  - `criar(client: GhlClient, tipo: Tipo, contactId: string, corpo: Record<string, unknown>): Promise<unknown>`
  - `editar(client: GhlClient, tipo: Tipo, contactId: string, id: string, corpo: Record<string, unknown>): Promise<unknown>`
  - `apagar(client: GhlClient, tipo: Tipo, contactId: string, id: string): Promise<unknown>`
  - `concluir(client: GhlClient, contactId: string, taskId: string, completed: boolean): Promise<unknown>`
  - `buscarTarefas(client: GhlClient, loc: string, filtro: FiltroTarefa): Promise<unknown>`
  - `interface FiltroTarefa { contactId?: string[]; completed?: boolean; assignedTo?: string[]; query?: string; limit?: number; skip?: number }`
  - `deuCerto(r: unknown): boolean`

- [ ] **Step 1: escrever o teste que falha**

Crie `extractor/test/annotations.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { listar, criar, editar, apagar, concluir, buscarTarefas, deuCerto } from "../src/api/annotations.js";

interface Chamada { metodo: string; url: string; corpo?: unknown }

function clienteFalso(resposta: unknown = { ok: true }) {
  const chamadas: Chamada[] = [];
  const reg = (metodo: string) => (url: string, corpo?: unknown) => {
    chamadas.push({ metodo, url, corpo });
    return Promise.resolve(resposta);
  };
  return {
    chamadas,
    client: { getJson: reg("get"), putJson: reg("put"), postJson: reg("post"), deleteJson: reg("delete") } as never,
  };
}

const BASE = "https://services.leadconnectorhq.com";

test("listar usa /notes para nota e /tasks para tarefa", async () => {
  const a = clienteFalso();
  await listar(a.client, "nota", "C1");
  await listar(a.client, "tarefa", "C1");
  assert.deepEqual(a.chamadas.map((c) => c.url), [
    `${BASE}/contacts/C1/notes`,
    `${BASE}/contacts/C1/tasks`,
  ]);
  assert.deepEqual(a.chamadas.map((c) => c.metodo), ["get", "get"]);
});

test("criar tarefa manda o corpo como recebeu, sem inventar campo", async () => {
  const a = clienteFalso();
  await criar(a.client, "tarefa", "C1", { title: "T", dueDate: "2026-10-01T10:00:00Z", completed: false });
  assert.equal(a.chamadas[0].metodo, "post");
  assert.equal(a.chamadas[0].url, `${BASE}/contacts/C1/tasks`);
  assert.deepEqual(a.chamadas[0].corpo, { title: "T", dueDate: "2026-10-01T10:00:00Z", completed: false });
});

test("editar e apagar apontam para o id", async () => {
  const a = clienteFalso();
  await editar(a.client, "nota", "C1", "N1", { body: "x" });
  await apagar(a.client, "nota", "C1", "N1");
  assert.deepEqual(a.chamadas.map((c) => `${c.metodo} ${c.url}`), [
    `put ${BASE}/contacts/C1/notes/N1`,
    `delete ${BASE}/contacts/C1/notes/N1`,
  ]);
});

test("concluir usa a rota dedicada", async () => {
  const a = clienteFalso();
  await concluir(a.client, "C1", "T1", true);
  assert.equal(a.chamadas[0].url, `${BASE}/contacts/C1/tasks/T1/completed`);
  assert.deepEqual(a.chamadas[0].corpo, { completed: true });
});

test("buscarTarefas manda só os filtros preenchidos", async () => {
  const a = clienteFalso();
  await buscarTarefas(a.client, "L1", { completed: false, limit: 50 });
  assert.equal(a.chamadas[0].metodo, "post");
  assert.equal(a.chamadas[0].url, `${BASE}/locations/L1/tasks/search`);
  assert.deepEqual(a.chamadas[0].corpo, { completed: false, limit: 50 });
});

test("deuCerto aceita as duas grafias do servidor", () => {
  assert.equal(deuCerto({ succeeded: true }), true);
  assert.equal(deuCerto({ succeded: true }), true);
  assert.equal(deuCerto({ succeeded: false, succeded: false }), false);
  assert.equal(deuCerto({}), false);
});
```

- [ ] **Step 2: rodar e ver falhar**

Run: `cd extractor && npx tsx --test test/annotations.test.ts`
Expected: FAIL — `Cannot find module '../src/api/annotations.js'`.

- [ ] **Step 3: escrever o módulo**

Crie `extractor/src/api/annotations.ts`:

```ts
import type { GhlClient } from "./client.js";

/**
 * Notas e tarefas do CONTATO. Host `services.leadconnectorhq.com`, os dois tokens da sessão.
 * Rotas em docs/endpoints.md, seção `## Notas, tarefas e tags da subconta`.
 *
 * Nota de COMPROMISSO é outra entidade, em `api/calendars.ts` — ali o pai é o compromisso.
 */
const BASE = "https://services.leadconnectorhq.com";

export type Tipo = "nota" | "tarefa";

/** `notes` ou `tasks`: é a única diferença entre as duas áreas. */
const rota = (tipo: Tipo): string => (tipo === "nota" ? "notes" : "tasks");

const url = (tipo: Tipo, contactId: string, id?: string): string =>
  `${BASE}/contacts/${contactId}/${rota(tipo)}${id ? `/${id}` : ""}`;

export function listar(client: GhlClient, tipo: Tipo, contactId: string): Promise<unknown> {
  return client.getJson(url(tipo, contactId));
}

export function ler(client: GhlClient, tipo: Tipo, contactId: string, id: string): Promise<unknown> {
  return client.getJson(url(tipo, contactId, id));
}

/**
 * Criar nota exige só `body`. Criar tarefa exige `title`, `dueDate` E `completed` — quem
 * monta o corpo é a CLI, que preenche `completed: false` quando o usuário não disser nada.
 * Aqui nada é inventado: o corpo vai como veio.
 */
export function criar(
  client: GhlClient, tipo: Tipo, contactId: string, corpo: Record<string, unknown>,
): Promise<unknown> {
  return client.postJson(url(tipo, contactId), corpo);
}

/** PUT parcial: o servidor trata como patch, apesar do verbo. */
export function editar(
  client: GhlClient, tipo: Tipo, contactId: string, id: string, corpo: Record<string, unknown>,
): Promise<unknown> {
  return client.putJson(url(tipo, contactId, id), corpo);
}

export function apagar(client: GhlClient, tipo: Tipo, contactId: string, id: string): Promise<unknown> {
  return client.deleteJson(url(tipo, contactId, id));
}

/** Rota dedicada de concluir, que existe em paralelo ao PUT geral. */
export function concluir(
  client: GhlClient, contactId: string, taskId: string, completed: boolean,
): Promise<unknown> {
  return client.putJson(`${BASE}/contacts/${contactId}/tasks/${taskId}/completed`, { completed });
}

export interface FiltroTarefa {
  contactId?: string[];
  completed?: boolean;
  assignedTo?: string[];
  query?: string;
  limit?: number;
  skip?: number;
}

/** Tarefas de toda a subconta, não de um contato. `limit` do servidor é 25 por padrão. */
export function buscarTarefas(client: GhlClient, loc: string, filtro: FiltroTarefa): Promise<unknown> {
  const corpo = Object.fromEntries(Object.entries(filtro).filter(([, v]) => v !== undefined));
  return client.postJson(`${BASE}/locations/${loc}/tasks/search`, corpo);
}

/**
 * O servidor devolve `succeeded` em nota e tarefa, e AS DUAS grafias em tag
 * (`{"succeded":true,"succeeded":true}`). A doc de tag só traz a errada. Ler as duas.
 */
export function deuCerto(r: unknown): boolean {
  const o = (r ?? {}) as Record<string, unknown>;
  return o.succeeded === true || o.succeded === true;
}
```

- [ ] **Step 4: rodar e ver passar**

Run: `cd extractor && npx tsx --test test/annotations.test.ts`
Expected: PASS, 6 testes.

- [ ] **Step 5: typecheck e commit**

```bash
cd extractor && npx tsc --noEmit
git add src/api/annotations.ts test/annotations.test.ts
git commit -m "feat(annotations): rotas de nota e tarefa do contato"
```

---

### Task 3: `api/tags.ts`

**Files:**
- Create: `extractor/src/api/tags.ts`
- Test: `extractor/test/tags.test.ts`

**Interfaces:**
- Consumes: `GhlClient`; `deuCerto` de `./annotations.js`.
- Produces, exportados de `api/tags.ts`:
  - `interface Tag { id: string; name: string }`
  - `listarTags(client: GhlClient, loc: string): Promise<Tag[]>`
  - `criarTag(client: GhlClient, loc: string, name: string): Promise<Tag>`
  - `renomearTag(client: GhlClient, loc: string, tagId: string, name: string): Promise<Tag>`
  - `apagarTag(client: GhlClient, loc: string, tagId: string): Promise<boolean>`
  - `acharTag(tags: Tag[], nomeOuId: string): Tag | undefined`

- [ ] **Step 1: escrever o teste que falha**

Crie `extractor/test/tags.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { listarTags, criarTag, renomearTag, apagarTag, acharTag } from "../src/api/tags.js";

interface Chamada { metodo: string; url: string; corpo?: unknown }

function clienteFalso(resposta: unknown) {
  const chamadas: Chamada[] = [];
  const reg = (metodo: string) => (url: string, corpo?: unknown) => {
    chamadas.push({ metodo, url, corpo });
    return Promise.resolve(resposta);
  };
  return {
    chamadas,
    client: { getJson: reg("get"), putJson: reg("put"), postJson: reg("post"), deleteJson: reg("delete") } as never,
  };
}

const BASE = "https://services.leadconnectorhq.com";

test("listarTags normaliza _id para id", async () => {
  const a = clienteFalso({ tags: [{ _id: "T1", name: "alfa" }, { id: "T2", name: "beta" }] });
  const tags = await listarTags(a.client, "L1");
  assert.deepEqual(tags, [{ id: "T1", name: "alfa" }, { id: "T2", name: "beta" }]);
  assert.match(a.chamadas[0].url, new RegExp(`^${BASE}/locations/L1/tags/search\\?`));
});

test("criarTag manda name e devolve a tag de dentro do envelope", async () => {
  const a = clienteFalso({ tag: { id: "T9", name: "nova", color: null } });
  const t = await criarTag(a.client, "L1", "nova");
  assert.deepEqual(t, { id: "T9", name: "nova" });
  assert.equal(a.chamadas[0].metodo, "post");
  assert.equal(a.chamadas[0].url, `${BASE}/locations/L1/tags`);
  assert.deepEqual(a.chamadas[0].corpo, { name: "nova" });
});

test("renomearTag faz PUT no id", async () => {
  const a = clienteFalso({ tag: { id: "T9", name: "depois" } });
  const t = await renomearTag(a.client, "L1", "T9", "depois");
  assert.equal(t.name, "depois");
  assert.equal(a.chamadas[0].metodo, "put");
  assert.equal(a.chamadas[0].url, `${BASE}/locations/L1/tags/T9`);
  assert.deepEqual(a.chamadas[0].corpo, { name: "depois" });
});

test("apagarTag aceita a grafia errada que o servidor devolve", async () => {
  const a = clienteFalso({ succeded: true });
  assert.equal(await apagarTag(a.client, "L1", "T9"), true);
  assert.equal(a.chamadas[0].metodo, "delete");
  assert.equal(a.chamadas[0].url, `${BASE}/locations/L1/tags/T9`);
});

test("acharTag casa por id exato e por nome sem ligar para maiúscula", () => {
  const tags = [{ id: "T1", name: "Alfa Beta" }];
  assert.equal(acharTag(tags, "T1")?.id, "T1");
  assert.equal(acharTag(tags, "alfa beta")?.id, "T1");
  assert.equal(acharTag(tags, "  ALFA BETA ")?.id, "T1");
  assert.equal(acharTag(tags, "gama"), undefined);
});
```

- [ ] **Step 2: rodar e ver falhar**

Run: `cd extractor && npx tsx --test test/tags.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: escrever o módulo**

Crie `extractor/src/api/tags.ts`:

```ts
import type { GhlClient } from "./client.js";
import { deuCerto } from "./annotations.js";

/**
 * CRUD de tag da SUBCONTA. Host `services.leadconnectorhq.com`.
 * Rotas em docs/endpoints.md, seção `## Notas, tarefas e tags da subconta`.
 *
 * Tag do CONTATO (pôr e tirar tag de uma pessoa) é outra coisa, em `api/contacts.ts`.
 *
 * O que torna esta área segura: renomear propaga. Workflow guarda o NOME da tag, nunca o id
 * — em step, em trigger e em condição — mas o servidor reescreve a referência nos três
 * lugares quando o nome muda. Provado ao vivo em 2026-09-21. Sem isso, renomear quebraria
 * em silêncio todo workflow que cita a tag.
 */
const BASE = "https://services.leadconnectorhq.com";

export interface Tag {
  id: string;
  name: string;
}

/** A resposta mistura `id` e `_id` conforme a rota; aqui sai sempre `id`. */
const normalizar = (t: Record<string, any>): Tag => ({ id: t.id ?? t._id, name: t.name });

export async function listarTags(client: GhlClient, loc: string): Promise<Tag[]> {
  const qs = new URLSearchParams({ skip: "0", limit: "10000", query: "", getCount: "true" });
  const r = await client.getJson<{ tags?: Record<string, any>[] }>(
    `${BASE}/locations/${loc}/tags/search?${qs}`,
  );
  return (r?.tags ?? []).map(normalizar);
}

/** Responde 200, não 201. Devolve também `categoryId`/`description`/`color`, que aqui se ignoram. */
export async function criarTag(client: GhlClient, loc: string, name: string): Promise<Tag> {
  const r = await client.postJson<{ tag?: Record<string, any> }>(`${BASE}/locations/${loc}/tags`, { name });
  return normalizar(r?.tag ?? {});
}

export async function renomearTag(
  client: GhlClient, loc: string, tagId: string, name: string,
): Promise<Tag> {
  const r = await client.putJson<{ tag?: Record<string, any> }>(
    `${BASE}/locations/${loc}/tags/${tagId}`, { name },
  );
  return normalizar(r?.tag ?? {});
}

/**
 * Apaga a tag da subconta, o que a arranca de todos os contatos que a têm. Se isso dispara os
 * workflows com trigger de "tag removida" NÃO há prova — a guarda está na CLI, não aqui.
 */
export async function apagarTag(client: GhlClient, loc: string, tagId: string): Promise<boolean> {
  return deuCerto(await client.deleteJson(`${BASE}/locations/${loc}/tags/${tagId}`));
}

/** Aceita o id ou o nome. Nome casa sem ligar para maiúscula nem espaço nas pontas. */
export function acharTag(tags: Tag[], nomeOuId: string): Tag | undefined {
  const alvo = nomeOuId.trim().toLowerCase();
  return tags.find((t) => t.id === nomeOuId) ?? tags.find((t) => t.name.trim().toLowerCase() === alvo);
}
```

- [ ] **Step 4: rodar e ver passar**

Run: `cd extractor && npx tsx --test test/tags.test.ts`
Expected: PASS, 5 testes.

- [ ] **Step 5: typecheck e commit**

```bash
cd extractor && npx tsc --noEmit
git add src/api/tags.ts test/tags.test.ts
git commit -m "feat(tags): CRUD de tag da subconta"
```

---

### Task 4: comandos `anotacoes` e `anotacao-acao`

**Files:**
- Modify: `extractor/src/cli.ts` (imports junto de `:28-37`; consts junto de `:561-566`; funções `run*` depois de `runFormularioAcao`, que acaba em `:1150`; blocos `program.command` depois do de `formulario-estilo`)
- Modify: `extractor/package.json:34-37` (scripts)

**Interfaces:**
- Consumes: de `api/annotations.js` — `listar`, `ler`, `criar`, `editar`, `apagar`, `concluir`, `buscarTarefas`, `deuCerto`, `Tipo`; de `cli.ts` — `withClient` (`:107`), `registroEscrita` (`:552`).
- Produces: os comandos `anotacoes` e `anotacao-acao`, cujo argv a Task 6 monta do lado Python. Vocabulário: `ANOTACAO_LEITURA = ["lista", "detalhe", "buscar"]`, `ANOTACAO_ACOES = ["criar", "editar", "apagar", "concluir", "reabrir"]`.

- [ ] **Step 1: escrever as consts e os imports**

Em `extractor/src/cli.ts`, junto dos outros imports de `./api/`:

```ts
import {
  listar as listarAnotacao, ler as lerAnotacao, criar as criarAnotacao,
  editar as editarAnotacao, apagar as apagarAnotacao, concluir as concluirTarefa,
  buscarTarefas, deuCerto, type Tipo as TipoAnotacao,
} from "./api/annotations.js";
```

Junto das outras consts de vocabulário (perto de `:561`):

```ts
const ANOTACAO_LEITURA = ["lista", "detalhe", "buscar"] as const;
const ANOTACAO_ACOES = ["criar", "editar", "apagar", "concluir", "reabrir"] as const;
const ANOTACAO_TIPOS = ["nota", "tarefa"] as const;
```

- [ ] **Step 2: escrever `runAnotacoes`**

```ts
interface OptsAnotacoes {
  location: string; o?: string; tipo?: string; contato?: string; id?: string;
  dono?: string; concluidas?: string; termo?: string; limite?: string; json?: boolean;
}

/**
 * Leitura de nota e tarefa. `-o buscar` é o único que não precisa de contato: varre as
 * tarefas de toda a subconta, que é a pergunta útil ("o que está atrasado aqui").
 */
async function runAnotacoes(o: OptsAnotacoes): Promise<void> {
  const op = o.o ?? "lista";
  const tipo = (o.tipo ?? "nota") as TipoAnotacao;
  if (!ANOTACAO_LEITURA.includes(op as never)) {
    throw new Error(`-o inválido: ${op}. Aceitos: ${ANOTACAO_LEITURA.join(", ")}`);
  }
  if (!ANOTACAO_TIPOS.includes(tipo as never)) {
    throw new Error(`--tipo inválido: ${o.tipo}. Aceitos: ${ANOTACAO_TIPOS.join(", ")}`);
  }
  if (op === "buscar" && tipo !== "tarefa") {
    throw new Error("-o buscar só existe para tarefa: não há busca de nota por subconta");
  }
  if (op !== "buscar" && !o.contato) throw new Error(`-o ${op} exige --contato`);
  if (op === "detalhe" && !o.id) throw new Error("-o detalhe exige -i");

  await withClient(o.location, (m) => { if (!o.json) console.log(m); }, async (client) => {
    let saida: unknown;
    if (op === "lista") saida = await listarAnotacao(client, tipo, o.contato!);
    else if (op === "detalhe") saida = await lerAnotacao(client, tipo, o.contato!, o.id!);
    else {
      saida = await buscarTarefas(client, o.location, {
        contactId: o.contato ? [o.contato] : undefined,
        assignedTo: o.dono ? [o.dono] : undefined,
        completed: o.concluidas === undefined ? undefined : o.concluidas === "true",
        query: o.termo,
        limit: o.limite ? Number(o.limite) : undefined,
      });
    }
    const r = { op, tipo, contato: o.contato ?? null, resultado: saida };
    console.log(o.json ? JSON.stringify(r, null, 2) : JSON.stringify(r, null, 2));
  });
}
```

- [ ] **Step 3: escrever `runAnotacaoAcao`**

```ts
interface OptsAnotacaoAcao {
  location: string; acao: string; tipo?: string; contato: string; id?: string;
  texto?: string; titulo?: string; prazo?: string; dono?: string;
  confirmo?: boolean; json?: boolean;
}

/**
 * Escrita de nota e tarefa. Camada crua: a prévia aqui só mostra o corpo que iria para o
 * servidor. Criar tarefa preenche `completed: false` sozinha — o campo é obrigatório no POST
 * e ninguém cria tarefa já concluída.
 */
async function runAnotacaoAcao(o: OptsAnotacaoAcao): Promise<void> {
  const tipo = (o.tipo ?? "nota") as TipoAnotacao;
  if (!ANOTACAO_ACOES.includes(o.acao as never)) {
    throw new Error(`--acao inválida: ${o.acao}. Aceitas: ${ANOTACAO_ACOES.join(", ")}`);
  }
  if (!ANOTACAO_TIPOS.includes(tipo as never)) {
    throw new Error(`--tipo inválido: ${o.tipo}. Aceitos: ${ANOTACAO_TIPOS.join(", ")}`);
  }
  if (!o.contato) throw new Error("--contato é obrigatório");
  if (o.acao !== "criar" && !o.id) throw new Error(`--acao ${o.acao} exige -i`);
  if ((o.acao === "concluir" || o.acao === "reabrir") && tipo !== "tarefa") {
    throw new Error("concluir e reabrir só existem para tarefa");
  }
  if (o.acao === "criar" && tipo === "nota" && !o.texto) {
    throw new Error("criar nota exige --texto");
  }
  if (o.acao === "criar" && tipo === "tarefa" && !(o.titulo && o.prazo)) {
    throw new Error("criar tarefa exige --titulo e --prazo (data ISO, ex. 2026-10-01T10:00:00Z)");
  }

  const corpo: Record<string, unknown> = {};
  if (tipo === "nota") {
    if (o.texto !== undefined) corpo.body = o.texto;
  } else {
    if (o.titulo !== undefined) corpo.title = o.titulo;
    if (o.texto !== undefined) corpo.body = o.texto;
    if (o.prazo !== undefined) corpo.dueDate = o.prazo;
    if (o.dono !== undefined) corpo.assignedTo = o.dono;
    // Obrigatório no POST; sem isto toda criação de tarefa falha.
    if (o.acao === "criar") corpo.completed = false;
  }

  if (!o.confirmo) {
    const previa = {
      previa: true, aplicado: false, acao: o.acao, tipo, contato: o.contato, id: o.id ?? null,
      corpo, aviso: "nada foi gravado. Repita com --confirmo para gravar.",
    };
    console.log(JSON.stringify(previa, null, 2));
    return;
  }

  await withClient(o.location, (m) => { if (!o.json) console.log(m); }, async (client) => {
    const antes = o.id ? await lerAnotacao(client, tipo, o.contato, o.id).catch(() => null) : null;
    let resposta: unknown;
    if (o.acao === "criar") resposta = await criarAnotacao(client, tipo, o.contato, corpo);
    else if (o.acao === "editar") resposta = await editarAnotacao(client, tipo, o.contato, o.id!, corpo);
    else if (o.acao === "apagar") resposta = await apagarAnotacao(client, tipo, o.contato, o.id!);
    else resposta = await concluirTarefa(client, o.contato, o.id!, o.acao === "concluir");

    const registro = registroEscrita(o.location, "_anotacoes", o.contato, {
      acao: o.acao, tipo, id: o.id ?? null, corpo, antes, resposta,
    });
    const r = {
      aplicado: true, acao: o.acao, tipo, contato: o.contato, id: o.id ?? null,
      resposta, apagou: o.acao === "apagar" ? deuCerto(resposta) : undefined, registro,
    };
    console.log(JSON.stringify(r, null, 2));
  });
}
```

- [ ] **Step 4: registrar os dois comandos**

Depois do bloco de `formulario-estilo`:

```ts
program
  .command("anotacoes")
  .description("Leitura ao vivo de notas e tarefas do contato")
  .requiredOption("-l, --location <id>", "locationId da subconta")
  .option("-o, --o <op>", ANOTACAO_LEITURA.join(" | "), "lista")
  .option("--tipo <t>", ANOTACAO_TIPOS.join(" | "), "nota")
  .option("--contato <id>", "contactId (obrigatório, menos em -o buscar)")
  .option("-i, --id <id>", "id da nota ou tarefa (com -o detalhe)")
  .option("--dono <userId>", "filtra as tarefas por responsável (-o buscar)")
  .option("--concluidas <bool>", "true | false: filtra tarefas concluídas (-o buscar)")
  .option("--termo <texto>", "busca no texto das tarefas (-o buscar)")
  .option("--limite <n>", "quantas tarefas trazer; o servidor usa 25 por padrão")
  .option("--json", "imprime o resultado em JSON no stdout")
  .action((o) => runAnotacoes(o).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); }));

program
  .command("anotacao-acao")
  .description("ESCREVE: cria, edita, apaga nota ou tarefa do contato; conclui ou reabre tarefa")
  .requiredOption("-l, --location <id>", "locationId da subconta")
  .requiredOption("--acao <a>", ANOTACAO_ACOES.join(" | "))
  .requiredOption("--contato <id>", "contactId")
  .option("--tipo <t>", ANOTACAO_TIPOS.join(" | "), "nota")
  .option("-i, --id <id>", "id da nota ou tarefa (tudo menos criar)")
  .option("--texto <texto>", "corpo da nota, ou descrição da tarefa")
  .option("--titulo <texto>", "título da tarefa (obrigatório ao criar tarefa)")
  .option("--prazo <iso>", "vencimento da tarefa em ISO, ex. 2026-10-01T10:00:00Z")
  .option("--dono <userId>", "responsável pela tarefa")
  .option("--confirmo", "obrigatório: grava de verdade. Sem ele, só mostra a prévia")
  .option("--json", "imprime o resultado em JSON no stdout")
  .action((o) => runAnotacaoAcao(o).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); }));
```

- [ ] **Step 5: scripts no package.json**

Em `extractor/package.json`, junto dos outros:

```json
    "anotacoes": "tsx src/cli.ts anotacoes",
    "anotacao-acao": "tsx src/cli.ts anotacao-acao",
```

- [ ] **Step 6: typecheck, suíte e commit**

```bash
cd extractor && npx tsc --noEmit && npm test
git add src/cli.ts package.json
git commit -m "feat(cli): comandos anotacoes e anotacao-acao"
```

---

### Task 5: comandos `tags` e `tag-acao`

**Files:**
- Modify: `extractor/src/cli.ts`
- Modify: `extractor/package.json`

**Interfaces:**
- Consumes: de `api/tags.js` — `listarTags`, `criarTag`, `renomearTag`, `apagarTag`, `acharTag`, `Tag`; de `cli.ts` — `withClient`, `registroEscrita`, `latestDumpEntity` (`:96`).
- Produces: os comandos `tags` e `tag-acao`. Vocabulário `TAG_ACOES = ["criar", "renomear", "apagar"]`.

A coluna de impacto NÃO é calculada aqui: o índice reverso vive no auditor. A CLI devolve a lista de tags ao vivo, e a tool MCP da Task 7 faz o cruzamento. Isso mantém o extractor sem dependência do auditor, como já é hoje.

- [ ] **Step 1: escrever a const e o import**

```ts
import { listarTags, criarTag, renomearTag, apagarTag, acharTag, type Tag } from "./api/tags.js";
```

```ts
const TAG_ACOES = ["criar", "renomear", "apagar"] as const;
```

- [ ] **Step 2: escrever `runTags`**

```ts
/** Lista as tags da subconta, ao vivo. O cruzamento com os workflows é da tool MCP. */
async function runTags(o: { location: string; termo?: string; json?: boolean }): Promise<void> {
  await withClient(o.location, (m) => { if (!o.json) console.log(m); }, async (client) => {
    let tags = await listarTags(client, o.location);
    if (o.termo) {
      const alvo = o.termo.trim().toLowerCase();
      tags = tags.filter((t) => t.name.toLowerCase().includes(alvo));
    }
    console.log(JSON.stringify({ total: tags.length, tags }, null, 2));
  });
}
```

- [ ] **Step 3: escrever `runTagAcao`**

```ts
interface OptsTagAcao {
  location: string; acao: string; tag?: string; nome?: string;
  apagarCitada?: boolean; confirmo?: boolean; json?: boolean;
}

/**
 * Escrita de tag da subconta.
 *
 * `renomear` é escrita comum: provado ao vivo que o servidor reescreve a referência nos
 * workflows, inclusive no trigger.
 *
 * `apagar` é a operação perigosa: arranca a tag de todos os contatos que a têm, e não há
 * prova de que isso não dispare os workflows com trigger de "tag removida". A guarda
 * `--apagar-citada` mora na tool MCP, que sabe quais workflows citam a tag; aqui, camada
 * crua, a prévia só declara o risco.
 */
async function runTagAcao(o: OptsTagAcao): Promise<void> {
  if (!TAG_ACOES.includes(o.acao as never)) {
    throw new Error(`--acao inválida: ${o.acao}. Aceitas: ${TAG_ACOES.join(", ")}`);
  }
  if (o.acao === "criar" && !o.nome) throw new Error("criar exige --nome");
  if (o.acao === "renomear" && !(o.tag && o.nome)) throw new Error("renomear exige --tag e --nome");
  if (o.acao === "apagar" && !o.tag) throw new Error("apagar exige --tag");

  await withClient(o.location, (m) => { if (!o.json) console.log(m); }, async (client) => {
    const tags = await listarTags(client, o.location);
    const alvo = o.tag ? acharTag(tags, o.tag) : undefined;
    if (o.acao !== "criar" && !alvo) {
      throw new Error(`tag não encontrada na subconta: ${o.tag}`);
    }
    if (o.acao === "criar" && acharTag(tags, o.nome!)) {
      throw new Error(`já existe uma tag chamada "${o.nome}" — nomes de tag não distinguem maiúscula`);
    }

    if (!o.confirmo) {
      const previa: Record<string, unknown> = {
        previa: true, aplicado: false, acao: o.acao,
        tag: alvo ?? null, nome: o.nome ?? null,
        aviso: "nada foi gravado. Repita com --confirmo para gravar.",
      };
      if (o.acao === "renomear") {
        previa.efeito = "o servidor troca o nome também dentro dos workflows que citam a tag, " +
          "inclusive no trigger (provado ao vivo em 2026-09-21)";
      }
      if (o.acao === "apagar") {
        previa.efeito = "a tag sai de TODOS os contatos que a têm. Não há como saber quantos: o " +
          "GHL não expõe contagem de contatos por tag. Pode disparar os workflows com trigger " +
          "de tag removida — isso não tem prova, nem a favor nem contra.";
      }
      console.log(JSON.stringify(previa, null, 2));
      return;
    }

    let resposta: unknown;
    if (o.acao === "criar") resposta = await criarTag(client, o.location, o.nome!);
    else if (o.acao === "renomear") resposta = await renomearTag(client, o.location, alvo!.id, o.nome!);
    else resposta = await apagarTag(client, o.location, alvo!.id);

    const registro = registroEscrita(o.location, "_tags", alvo?.id ?? "nova", {
      acao: o.acao, antes: alvo ?? null, nome: o.nome ?? null, resposta,
    });
    console.log(JSON.stringify({ aplicado: true, acao: o.acao, resposta, registro }, null, 2));
  });
}
```

- [ ] **Step 4: registrar os comandos**

```ts
program
  .command("tags")
  .description("Leitura ao vivo das tags da subconta")
  .requiredOption("-l, --location <id>", "locationId da subconta")
  .option("--termo <texto>", "filtra as tags por parte do nome")
  .option("--json", "imprime o resultado em JSON no stdout")
  .action((o) => runTags(o).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); }));

program
  .command("tag-acao")
  .description("ESCREVE: cria, renomeia ou apaga uma tag da subconta")
  .requiredOption("-l, --location <id>", "locationId da subconta")
  .requiredOption("--acao <a>", TAG_ACOES.join(" | "))
  .option("--tag <nomeOuId>", "a tag alvo (renomear, apagar)")
  .option("--nome <texto>", "nome novo (criar, renomear)")
  .option("--confirmo", "obrigatório: grava de verdade. Sem ele, só mostra a prévia")
  .option("--json", "imprime o resultado em JSON no stdout")
  .action((o) => runTagAcao(o).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); }));
```

- [ ] **Step 5: scripts no package.json**

```json
    "tags": "tsx src/cli.ts tags",
    "tag-acao": "tsx src/cli.ts tag-acao",
```

- [ ] **Step 6: typecheck, suíte e commit**

```bash
cd extractor && npx tsc --noEmit && npm test
git add src/cli.ts package.json
git commit -m "feat(cli): comandos tags e tag-acao"
```

---

### Task 6: tools MCP `anotacoes` e `anotacao_acao`

**Files:**
- Modify: `auditor/src/automaster_audit/mcp_server.py` (funções perto de `formulario_estilo`, que acaba em `:675`; entradas em `TOOLS`, que abre em `:1186`)
- Test: `auditor/tests/test_mcp_anotacoes_tags.py` (criar)

**Interfaces:**
- Consumes: `_run_extractor(*args)` (`:241`), `ToolError`, `_LOC`, `_SNAP`.
- Produces: `anotacoes(...)`, `anotacao_acao(...)`, e as duas entradas no dict `TOOLS`.

Estas tools **não chamam `_load`**: nota e tarefa são ao vivo e não estão no dump, então exigir dump seria arbitrário. Precedente: `workflows_ao_vivo` (`:872`).

- [ ] **Step 1: escrever os testes que falham**

Crie `auditor/tests/test_mcp_anotacoes_tags.py`:

```python
import pytest
from automaster_audit import mcp_server as srv
from automaster_audit.mcp_server import ToolError


@pytest.fixture
def espiao(monkeypatch):
    chamadas = []

    def falso(*args):
        chamadas.append(args)
        return {"aplicado": True}

    monkeypatch.setattr(srv, "_run_extractor", falso)
    return chamadas


def test_anotacoes_lista_monta_o_argv(espiao):
    srv.anotacoes("L1", o="lista", tipo="tarefa", contato="C1")
    assert espiao[0][:7] == ("anotacoes", "-l", "L1", "-o", "lista", "--tipo", "tarefa")
    assert "--contato" in espiao[0] and "C1" in espiao[0]


def test_anotacoes_recusa_op_invalida(espiao):
    with pytest.raises(ToolError):
        srv.anotacoes("L1", o="inventada", contato="C1")
    assert espiao == []


def test_anotacoes_exige_contato_fora_da_busca(espiao):
    with pytest.raises(ToolError):
        srv.anotacoes("L1", o="lista")
    assert espiao == []


def test_anotacoes_busca_dispensa_contato_mas_exige_tarefa(espiao):
    srv.anotacoes("L1", o="buscar", tipo="tarefa", concluidas=False)
    assert espiao[0][0] == "anotacoes"
    with pytest.raises(ToolError):
        srv.anotacoes("L1", o="buscar", tipo="nota")


def test_anotacao_acao_sem_confirmo_nao_manda_a_flag(espiao):
    srv.anotacao_acao("L1", acao="criar", tipo="nota", contato="C1", texto="oi")
    assert "--confirmo" not in espiao[0]


def test_anotacao_acao_com_confirmo_manda_a_flag(espiao):
    srv.anotacao_acao("L1", acao="criar", tipo="nota", contato="C1", texto="oi", confirmo=True)
    assert "--confirmo" in espiao[0]


def test_criar_tarefa_exige_titulo_e_prazo(espiao):
    with pytest.raises(ToolError):
        srv.anotacao_acao("L1", acao="criar", tipo="tarefa", contato="C1", titulo="T")
    assert espiao == []


def test_concluir_so_existe_para_tarefa(espiao):
    with pytest.raises(ToolError):
        srv.anotacao_acao("L1", acao="concluir", tipo="nota", contato="C1", id="N1")
    assert espiao == []


def test_editar_exige_id(espiao):
    with pytest.raises(ToolError):
        srv.anotacao_acao("L1", acao="editar", tipo="nota", contato="C1", texto="x")
    assert espiao == []


def test_contrato_das_tools_de_anotacao():
    for nome in ("anotacoes", "anotacao_acao"):
        assert nome in srv.TOOLS
        func, desc, props, obrig = srv.TOOLS[nome]
        assert callable(func) and desc and "loc" in props and "loc" in obrig
```

- [ ] **Step 2: rodar e ver falhar**

Run: `cd auditor && .venv/bin/python -m pytest tests/test_mcp_anotacoes_tags.py -q`
Expected: FAIL — `AttributeError: module ... has no attribute 'anotacoes'`.

- [ ] **Step 3: escrever as duas funções**

Em `mcp_server.py`, depois de `formulario_estilo`:

```python
ANOTACAO_LEITURA = ("lista", "detalhe", "buscar")
ANOTACAO_ACOES = ("criar", "editar", "apagar", "concluir", "reabrir")
ANOTACAO_TIPOS = ("nota", "tarefa")


def anotacoes(loc: str, o: str = "lista", tipo: str = "nota", contato: str | None = None,
              id: str | None = None, dono: str | None = None, concluidas: bool | None = None,
              termo: str | None = None, limite: int | None = None) -> dict:
    """Leitura ao vivo de notas e tarefas do contato. Não usa o dump."""
    if o not in ANOTACAO_LEITURA:
        raise ToolError(f"o inválido: {o}. Aceitos: {', '.join(ANOTACAO_LEITURA)}")
    if tipo not in ANOTACAO_TIPOS:
        raise ToolError(f"tipo inválido: {tipo}. Aceitos: {', '.join(ANOTACAO_TIPOS)}")
    if o == "buscar" and tipo != "tarefa":
        raise ToolError("o=buscar só existe para tarefa: não há busca de nota por subconta")
    if o != "buscar" and not contato:
        raise ToolError(f"o={o} exige contato")
    if o == "detalhe" and not id:
        raise ToolError("o=detalhe exige id da nota ou tarefa")
    args = ["anotacoes", "-l", loc, "-o", o, "--tipo", tipo]
    for flag, val in (("--contato", contato), ("-i", id), ("--dono", dono),
                      ("--termo", termo),
                      ("--concluidas", None if concluidas is None else str(concluidas).lower()),
                      ("--limite", str(limite) if limite else None)):
        if val:
            args += [flag, val]
    return {"resultado": _run_extractor(*args, "--json")}


def anotacao_acao(loc: str, acao: str, contato: str, tipo: str = "nota", id: str | None = None,
                  texto: str | None = None, titulo: str | None = None, prazo: str | None = None,
                  dono: str | None = None, confirmo: bool = False) -> dict:
    """ESCREVE: nota e tarefa do contato. Sem confirmo, devolve a prévia."""
    if acao not in ANOTACAO_ACOES:
        raise ToolError(f"acao inválida: {acao}. Aceitas: {', '.join(ANOTACAO_ACOES)}")
    if tipo not in ANOTACAO_TIPOS:
        raise ToolError(f"tipo inválido: {tipo}. Aceitos: {', '.join(ANOTACAO_TIPOS)}")
    if acao != "criar" and not id:
        raise ToolError(f"acao={acao} exige id da nota ou tarefa")
    if acao in ("concluir", "reabrir") and tipo != "tarefa":
        raise ToolError("concluir e reabrir só existem para tarefa")
    if acao == "criar" and tipo == "nota" and not texto:
        raise ToolError("criar nota exige texto")
    if acao == "criar" and tipo == "tarefa" and not (titulo and prazo):
        raise ToolError("criar tarefa exige titulo e prazo (ISO, ex. 2026-10-01T10:00:00Z)")
    args = ["anotacao-acao", "-l", loc, "--acao", acao, "--tipo", tipo, "--contato", contato]
    for flag, val in (("-i", id), ("--texto", texto), ("--titulo", titulo),
                      ("--prazo", prazo), ("--dono", dono)):
        if val:
            args += [flag, val]
    if confirmo:
        args.append("--confirmo")
    return {"resultado": _run_extractor(*args, "--json")}
```

- [ ] **Step 4: registrar em `TOOLS`**

Dentro do dict `TOOLS`:

```python
    "anotacoes": (anotacoes, "Leitura ao vivo de notas e tarefas do contato (abre Chrome, não usa o "
                  "dump): `lista` e `detalhe` precisam de contato; `buscar` varre as tarefas de TODA "
                  "a subconta e só existe para tarefa — é a forma de responder o que está atrasado. "
                  "Nota de compromisso é outra coisa, e sai pela tool `agenda`.",
                  {"loc": _LOC,
                   "o": {"type": "string", "enum": list(ANOTACAO_LEITURA), "default": "lista"},
                   "tipo": {"type": "string", "enum": list(ANOTACAO_TIPOS), "default": "nota"},
                   "contato": {"type": "string", "description": "contactId; obrigatório fora de o=buscar"},
                   "id": {"type": "string", "description": "id da nota ou tarefa (com o=detalhe)"},
                   "dono": {"type": "string", "description": "filtra tarefas por responsável (o=buscar)"},
                   "concluidas": {"type": "boolean", "description": "filtra tarefas concluídas (o=buscar)"},
                   "termo": {"type": "string", "description": "busca no texto das tarefas (o=buscar)"},
                   "limite": {"type": "integer", "description": "quantas tarefas; o servidor usa 25"}},
                  ["loc"]),
    "anotacao_acao": (anotacao_acao,
                      "ESCREVE EM PRODUÇÃO: cria, edita ou apaga nota e tarefa do contato, e conclui "
                      "ou reabre tarefa. Sem confirmo=true devolve a prévia com o corpo que iria para "
                      "o servidor, sem gravar. Criar tarefa exige titulo e prazo (ISO); a tarefa nasce "
                      "não concluída. Apagar não tem desfazer.",
                      {"loc": _LOC,
                       "acao": {"type": "string", "enum": list(ANOTACAO_ACOES)},
                       "contato": {"type": "string", "description": "contactId"},
                       "tipo": {"type": "string", "enum": list(ANOTACAO_TIPOS), "default": "nota"},
                       "id": {"type": "string", "description": "id da nota ou tarefa; tudo menos criar"},
                       "texto": {"type": "string", "description": "corpo da nota, ou descrição da tarefa"},
                       "titulo": {"type": "string", "description": "título da tarefa"},
                       "prazo": {"type": "string", "description": "vencimento em ISO, ex. 2026-10-01T10:00:00Z"},
                       "dono": {"type": "string", "description": "responsável pela tarefa"},
                       "confirmo": {"type": "boolean", "description": "true grava de verdade", "default": False}},
                      ["loc", "acao", "contato"]),
```

- [ ] **Step 5: rodar e ver passar**

Run: `cd auditor && .venv/bin/python -m pytest tests/test_mcp_anotacoes_tags.py -q`
Expected: PASS, 10 testes.

- [ ] **Step 6: commit**

```bash
git add auditor/src/automaster_audit/mcp_server.py auditor/tests/test_mcp_anotacoes_tags.py
git commit -m "feat(mcp): tools anotacoes e anotacao_acao"
```

---

### Task 7: tools MCP `tags` e `tag_acao`, com o cruzamento de impacto

Esta é a tarefa com a lógica própria do plano: o cruzamento entre a tag ao vivo e os workflows que a citam, e a guarda do apagar.

**Files:**
- Modify: `auditor/src/automaster_audit/mcp_server.py`
- Test: `auditor/tests/test_mcp_anotacoes_tags.py` (acrescentar)

**Interfaces:**
- Consumes: `_run_extractor`, `_load` (`:86`), `_dash` (`:91`), `ToolError`, `_LOC`, `_SNAP`.
- Produces: `_impacto_tags(loc, snapshot)`, `tags(...)`, `tag_acao(...)`, e as duas entradas em `TOOLS`.

Regras:
1. `tags` lê ao vivo e cruza com o índice reverso do dump. **Sem dump, degrada**: devolve a lista sem impacto e com aviso, em vez de falhar.
2. A chave do cruzamento é o nome em minúsculas — `ctx.tag_names` já vem assim.
3. `apagar` uma tag citada por algum workflow exige `apagar_citada=True`.
4. O furo do `customTags` é declarado: se algum step usa tag por merge field, a resposta avisa que a contagem é incompleta.

- [ ] **Step 1: escrever os testes que falham**

Acrescente a `auditor/tests/test_mcp_anotacoes_tags.py`:

```python
def test_tags_cruza_com_o_indice_reverso(monkeypatch):
    monkeypatch.setattr(srv, "_run_extractor", lambda *a: {
        "total": 2, "tags": [{"id": "T1", "name": "Alfa"}, {"id": "T2", "name": "beta"}]})
    monkeypatch.setattr(srv, "_load", lambda loc, snap=None: (_CtxFalso(), {"snapshot": "S"}))
    monkeypatch.setattr(srv, "_dash", lambda p: {"tags": [
        {"name": "alfa", "used_by": ["WF um", "WF dois"], "papeis": ["adiciona", "dispara"], "orphan": False},
    ]})
    r = srv.tags("L1")
    por_nome = {t["name"]: t for t in r["tags"]}
    # o cruzamento ignora maiúscula: "Alfa" ao vivo casa com "alfa" do índice
    assert por_nome["Alfa"]["workflows"] == ["WF dois", "WF um"]
    assert por_nome["Alfa"]["papeis"] == ["adiciona", "dispara"]
    assert por_nome["beta"]["workflows"] == []
    assert r["_snapshot"]["snapshot"] == "S"


def test_tags_degrada_sem_dump(monkeypatch):
    monkeypatch.setattr(srv, "_run_extractor", lambda *a: {
        "total": 1, "tags": [{"id": "T1", "name": "alfa"}]})

    def sem_dump(loc, snap=None):
        raise ToolError("nenhum dump para L1")

    monkeypatch.setattr(srv, "_load", sem_dump)
    r = srv.tags("L1")
    assert r["tags"][0]["workflows"] is None
    assert "sem dump" in r["aviso"].lower()


def test_tag_acao_apagar_citada_exige_a_guarda(monkeypatch):
    chamadas = []
    monkeypatch.setattr(srv, "_run_extractor", lambda *a: chamadas.append(a) or {"ok": True})
    monkeypatch.setattr(srv, "_impacto_tags", lambda loc, snap=None: (
        {"alfa": {"workflows": ["WF um"], "papeis": ["dispara"]}}, None))
    with pytest.raises(ToolError) as e:
        srv.tag_acao("L1", acao="apagar", tag="alfa", confirmo=True)
    assert "WF um" in str(e.value)
    assert chamadas == []
    srv.tag_acao("L1", acao="apagar", tag="alfa", confirmo=True, apagar_citada=True)
    assert chamadas and "--confirmo" in chamadas[0]


def test_tag_acao_renomear_nao_exige_guarda(monkeypatch):
    chamadas = []
    monkeypatch.setattr(srv, "_run_extractor", lambda *a: chamadas.append(a) or {"ok": True})
    monkeypatch.setattr(srv, "_impacto_tags", lambda loc, snap=None: (
        {"alfa": {"workflows": ["WF um"], "papeis": ["dispara"]}}, None))
    srv.tag_acao("L1", acao="renomear", tag="alfa", nome="gama", confirmo=True)
    assert "--confirmo" in chamadas[0]


def test_tag_acao_valida_os_argumentos(espiao):
    with pytest.raises(ToolError):
        srv.tag_acao("L1", acao="inventada", tag="x")
    with pytest.raises(ToolError):
        srv.tag_acao("L1", acao="criar")
    with pytest.raises(ToolError):
        srv.tag_acao("L1", acao="renomear", tag="alfa")
    assert espiao == []


def test_contrato_das_tools_de_tag():
    for nome in ("tags", "tag_acao"):
        assert nome in srv.TOOLS
        func, desc, props, obrig = srv.TOOLS[nome]
        assert callable(func) and desc and "loc" in props and "loc" in obrig


class _CtxFalso:
    path = "/tmp/dump-falso"
    workflows: list = []
```

- [ ] **Step 2: rodar e ver falhar**

Run: `cd auditor && .venv/bin/python -m pytest tests/test_mcp_anotacoes_tags.py -q`
Expected: FAIL — `_impacto_tags` e `tags` não existem.

- [ ] **Step 3: escrever o cruzamento e as duas tools**

```python
TAG_ACOES = ("criar", "renomear", "apagar")


def _tem_tag_por_merge_field(ctx) -> bool:
    """
    Step `add_contact_tag` pode escolher a tag em tempo de execução, por
    `attributes.customTags` com um merge field. Nenhuma contagem de citação vê essa ligação,
    então a resposta declara o furo em vez de fingir que ele não existe.
    """
    for wf in getattr(ctx, "workflows", []) or []:
        for step in (((wf.raw or {}).get("steps") or {}).get("templates") or []):
            if (step.get("attributes") or {}).get("customTags"):
                return True
    return False


def _impacto_tags(loc: str, snapshot: str | None = None) -> tuple[dict | None, dict | None]:
    """
    Índice reverso de tag do dump: nome em MINÚSCULAS → workflows e papéis.

    Devolve `(None, meta_do_aviso)` quando a subconta não tem dump — a tag é ao vivo, e
    exigir dump para listá-la seria arbitrário.
    """
    try:
        ctx, meta = _load(loc, snapshot)
    except Exception as e:
        return None, {"motivo": str(e)}
    dash = _dash(str(ctx.path))
    idx = {
        t["name"].strip().lower(): {"workflows": sorted(t.get("used_by") or []),
                                    "papeis": sorted(t.get("papeis") or [])}
        for t in dash.get("tags", [])
    }
    meta = dict(meta)
    meta["merge_field_em_tag"] = _tem_tag_por_merge_field(ctx)
    return idx, meta


def tags(loc: str, termo: str | None = None, snapshot: str | None = None) -> dict:
    """Tags da subconta, ao vivo, cruzadas com os workflows que as citam."""
    args = ["tags", "-l", loc]
    if termo:
        args += ["--termo", termo]
    vivo = _run_extractor(*args, "--json") or {}
    idx, meta = _impacto_tags(loc, snapshot)
    saida = []
    for t in vivo.get("tags", []):
        chave = (t.get("name") or "").strip().lower()
        achado = (idx or {}).get(chave, {"workflows": [], "papeis": []})
        saida.append({**t,
                      "workflows": None if idx is None else achado["workflows"],
                      "papeis": None if idx is None else achado["papeis"]})
    r: dict = {"total": len(saida), "tags": saida}
    if idx is None:
        r["aviso"] = ("sem dump desta subconta: a lista saiu sem a coluna de impacto. "
                      f"Rode uma extração para saber quais workflows citam cada tag "
                      f"({(meta or {}).get('motivo', '')})")
    else:
        r["_snapshot"] = meta
        if (meta or {}).get("merge_field_em_tag"):
            r["aviso"] = ("esta subconta tem step que escolhe a tag em tempo de execução, por "
                          "merge field (`customTags`): a contagem de workflows por tag é "
                          "incompleta por natureza, e nenhuma ferramenta consegue fechá-la")
    return r


def tag_acao(loc: str, acao: str, tag: str | None = None, nome: str | None = None,
             confirmo: bool = False, apagar_citada: bool = False,
             snapshot: str | None = None) -> dict:
    """ESCREVE: cria, renomeia ou apaga tag da subconta, com prévia e guarda."""
    if acao not in TAG_ACOES:
        raise ToolError(f"acao inválida: {acao}. Aceitas: {', '.join(TAG_ACOES)}")
    if acao == "criar" and not nome:
        raise ToolError("criar exige nome")
    if acao == "renomear" and not (tag and nome):
        raise ToolError("renomear exige tag e nome")
    if acao == "apagar" and not tag:
        raise ToolError("apagar exige tag")

    idx, _meta = _impacto_tags(loc, snapshot)
    citacao = (idx or {}).get((tag or "").strip().lower())
    # Renomear não precisa de guarda: o servidor reescreve a referência nos workflows,
    # inclusive no trigger (provado ao vivo em 2026-09-21). Apagar precisa: a tag sai de todos
    # os contatos, e se isso acorda automação de "tag removida" ninguém sabe.
    if acao == "apagar" and confirmo and citacao and citacao["workflows"] and not apagar_citada:
        raise ToolError(
            f"a tag \"{tag}\" é citada por {len(citacao['workflows'])} workflow(s) "
            f"({', '.join(citacao['workflows'][:5])}) nos papéis "
            f"{', '.join(citacao['papeis'])}. Apagar a tira de todos os contatos que a têm e "
            "pode disparar automação de tag removida. Repita com apagar_citada=true se é isso "
            "que você quer.")

    args = ["tag-acao", "-l", loc, "--acao", acao]
    for flag, val in (("--tag", tag), ("--nome", nome)):
        if val:
            args += [flag, val]
    if confirmo:
        args.append("--confirmo")
    return {"resultado": _run_extractor(*args, "--json"),
            "citado_por": citacao["workflows"] if citacao else []}
```

- [ ] **Step 4: registrar em `TOOLS`**

```python
    "tags": (tags, "Tags da subconta, lidas AO VIVO e cruzadas com os workflows que citam cada uma "
             "(campo `workflows`) e em que papel (`papeis`: dispara, adiciona, remove, condicao). O "
             "cruzamento vem do dump, então `_snapshot` diz de quando ele é; sem dump a lista sai "
             "com `workflows: null` e um aviso. Workflow guarda o NOME da tag, nunca o id.",
             {"loc": _LOC,
              "termo": {"type": "string", "description": "filtra as tags por parte do nome"},
              "snapshot": _SNAP},
             ["loc"]),
    "tag_acao": (tag_acao,
                 "ESCREVE EM PRODUÇÃO: cria, renomeia ou apaga uma tag da subconta. Sem confirmo=true "
                 "devolve a prévia. RENOMEAR é seguro: o servidor troca o nome dentro dos workflows "
                 "que citam a tag, inclusive no trigger. APAGAR é perigoso: arranca a tag de todos os "
                 "contatos que a têm, pode disparar automação de tag removida, e não há como saber "
                 "quantos contatos são — o GHL não expõe essa contagem. Apagar tag citada por "
                 "workflow exige apagar_citada=true.",
                 {"loc": _LOC,
                  "acao": {"type": "string", "enum": list(TAG_ACOES)},
                  "tag": {"type": "string", "description": "nome ou id da tag (renomear, apagar)"},
                  "nome": {"type": "string", "description": "nome novo (criar, renomear)"},
                  "confirmo": {"type": "boolean", "description": "true grava de verdade", "default": False},
                  "apagar_citada": {"type": "boolean",
                                    "description": "libera apagar tag citada por workflow", "default": False},
                  "snapshot": _SNAP},
                 ["loc", "acao"]),
```

- [ ] **Step 5: rodar a suíte inteira**

Run: `cd auditor && .venv/bin/python -m pytest -q`
Expected: PASS, 331 anteriores + 16 novos.

- [ ] **Step 6: commit**

```bash
git add auditor/src/automaster_audit/mcp_server.py auditor/tests/test_mcp_anotacoes_tags.py
git commit -m "feat(mcp): tools tags e tag_acao, com cruzamento de impacto e guarda do apagar"
```

---

### Task 8: prova ao vivo na Instaltech

Escrita ao vivo é **serial**: um comando por vez, nunca dois agentes.

**Files:**
- Create: `docs/superpowers/provas/2026-09-21-prova-notas-tarefas-tags.md` (o registro do que rodou)

**Interfaces:**
- Consumes: os quatro comandos das Tasks 4 e 5.
- Produces: o relato que a Task 9 cita no CHANGELOG.

- [ ] **Step 1: notas no contato de teste**

```bash
cd extractor
npm run anotacoes -- -l Xb9gDxwxYhdqtprGcb5E --contato uWqujqll20tRuglV3mLt --tipo nota --json
npm run anotacao-acao -- -l Xb9gDxwxYhdqtprGcb5E --contato uWqujqll20tRuglV3mLt --tipo nota --acao criar --texto "ZZ prova automaster 0.20.0" --json
```

A primeira chamada é prévia (sem `--confirmo`) e não grava. Repita com `--confirmo`, guarde o id devolvido, edite e apague:

```bash
npm run anotacao-acao -- -l Xb9gDxwxYhdqtprGcb5E --contato uWqujqll20tRuglV3mLt --tipo nota --acao editar -i <noteId> --texto "ZZ prova editada" --confirmo --json
npm run anotacao-acao -- -l Xb9gDxwxYhdqtprGcb5E --contato uWqujqll20tRuglV3mLt --tipo nota --acao apagar -i <noteId> --confirmo --json
```

Registre: o POST responde 201? `title`/`color`/`pinned` voltam na leitura?

- [ ] **Step 2: tarefas, incluindo o caso sem dono**

```bash
npm run anotacao-acao -- -l Xb9gDxwxYhdqtprGcb5E --contato uWqujqll20tRuglV3mLt --tipo tarefa --acao criar --titulo "ZZ prova tarefa" --prazo 2026-12-01T10:00:00Z --confirmo --json
npm run anotacoes -- -l Xb9gDxwxYhdqtprGcb5E --contato uWqujqll20tRuglV3mLt --tipo tarefa --json
npm run anotacao-acao -- -l Xb9gDxwxYhdqtprGcb5E --contato uWqujqll20tRuglV3mLt --tipo tarefa --acao concluir -i <taskId> --confirmo --json
npm run anotacao-acao -- -l Xb9gDxwxYhdqtprGcb5E --contato uWqujqll20tRuglV3mLt --tipo tarefa --acao reabrir -i <taskId> --confirmo --json
npm run anotacao-acao -- -l Xb9gDxwxYhdqtprGcb5E --contato uWqujqll20tRuglV3mLt --tipo tarefa --acao apagar -i <taskId> --confirmo --json
npm run anotacoes -- -l Xb9gDxwxYhdqtprGcb5E -o buscar --tipo tarefa --concluidas false --limite 10 --json
```

**A pergunta aberta do dossiê:** a tarefa criada sem `--dono` fica sem responsável, ou o servidor atribui alguém? Leia a resposta e registre — é um fato que ninguém tem.

Se a criação sem `completed` fosse tentada, o servidor recusaria; a CLI manda `false` sozinha, então isso não aparece. Registre que a guarda existe.

- [ ] **Step 3: tags, com tag descartável**

```bash
npm run tags -- -l Xb9gDxwxYhdqtprGcb5E --termo zz --json
npm run tag-acao -- -l Xb9gDxwxYhdqtprGcb5E --acao criar --nome zz-prova-020 --json          # prévia
npm run tag-acao -- -l Xb9gDxwxYhdqtprGcb5E --acao criar --nome zz-prova-020 --confirmo --json
npm run tag-acao -- -l Xb9gDxwxYhdqtprGcb5E --acao renomear --tag zz-prova-020 --nome zz-prova-020b --confirmo --json
npm run tag-acao -- -l Xb9gDxwxYhdqtprGcb5E --acao apagar --tag zz-prova-020b --confirmo --json
npm run tags -- -l Xb9gDxwxYhdqtprGcb5E --termo zz-prova --json   # tem que voltar vazio
```

Nenhuma das tags reais da Instaltech é tocada. Confirme que a guarda de nome duplicado dispara: repita o `criar` com um nome que já existe e veja o erro.

- [ ] **Step 4: as tools MCP, não só a CLI**

Pelo servidor MCP (ou pelo plugin instalado), exercite `anotacoes`, `anotacao_acao`, `tags` e `tag_acao`. O que importa provar aqui, e a CLI não prova:

1. `tags` devolve `workflows` e `papeis` preenchidos para uma tag real da Instaltech que muitos workflows citam.
2. `tag_acao` com `acao="apagar"` numa tag citada **recusa** sem `apagar_citada=true`. Use uma tag citada e **não** confirme depois — a recusa é o teste.
3. `anotacao_acao` sem `confirmo` devolve prévia com `aplicado: false`.

- [ ] **Step 5: escrever o registro da prova**

Crie `docs/superpowers/provas/2026-09-21-prova-notas-tarefas-tags.md` com: o que rodou, o que o servidor respondeu em cada caso, os fatos novos (dono da tarefa sem `assignedTo`; se o POST de nota responde 201; se `title`/`color`/`pinned` voltam), e a confirmação de resíduo zero.

- [ ] **Step 6: commit**

```bash
git add docs/superpowers/provas/2026-09-21-prova-notas-tarefas-tags.md
git commit -m "docs: prova ao vivo de notas, tarefas e tags na Instaltech"
```

---

### Task 9: fechar a 0.20.0

**Files:**
- Modify: `.claude-plugin/plugin.json:3-4` (descrição e versão)
- Modify: `CHANGELOG.md` (nova seção no topo, acima da 0.19.0 em `:7`)
- Modify: `CLAUDE.md:30` (a lista literal das tools e a contagem)
- Modify: `skills/automaster-leitura/SKILL.md:3` (a lista de tools no frontmatter) + nova seção de leitura
- Modify: `docs/endpoints.md` (o que a prova ao vivo da Task 8 descobriu)

- [ ] **Step 1: atualizar `docs/endpoints.md` com os achados da prova**

Acrescente à seção criada na Task 1 o que a Task 8 mediu — especialmente o comportamento da tarefa sem dono, que até aqui era lacuna declarada.

- [ ] **Step 2: versão e descrição do plugin**

Em `.claude-plugin/plugin.json`: `version` para `0.20.0`, e a descrição passa de 31 para 35 tools, citando nota, tarefa e tag da subconta.

- [ ] **Step 3: `CLAUDE.md`**

Em `:30`, trocar "expõe trinta e uma tools" por "trinta e cinco" e acrescentar `anotacoes`, `anotacao_acao`, `tags`, `tag_acao` à lista literal. Acrescentar aos comandos:

```bash
npm run anotacoes -- -l <loc> --contato <contactId> --tipo nota --json   # notas e tarefas do contato (leitura ao vivo)
npm run anotacao-acao -- -l <loc> --contato <id> --tipo tarefa --acao criar --titulo "..." --prazo <iso> --confirmo --json  # ESCREVE
npm run tags -- -l <loc> --json                                          # tags da subconta (leitura ao vivo)
npm run tag-acao -- -l <loc> --acao renomear --tag <nomeOuId> --nome <novo> --confirmo --json  # ESCREVE
```

E, nos pontos críticos, duas linhas que o projeto não sabia:

```markdown
- **Tag em workflow é o NOME, nunca o id** — em step, em trigger e em condição (34 de 34 no
  dump da Instaltech). Renomear pela API **propaga**: o servidor reescreve a referência nos
  três lugares, provado ao vivo em 2026-09-21. Quem quebra é apagar, que arranca a tag de
  todos os contatos — daí a guarda `apagar_citada`. Não existe contagem de contatos por tag
  em lugar nenhum do GHL, então nenhuma prévia estima esse número.
- **Criar tarefa exige `completed`** além de `title` e `dueDate`; a CLI manda `false` sozinha.
  A data é texto ISO, o inverso da agenda, onde ISO devolve lista vazia em silêncio.
```

- [ ] **Step 4: `CHANGELOG.md`**

Nova seção no topo:

```markdown
## 0.20.0 — notas e tarefas do contato, tags da subconta

Quatro tools novas (35 no total): `anotacoes`, `anotacao_acao`, `tags`, `tag_acao`. 18 regras
de auditoria, sem mudança. Dois módulos novos no extractor (`api/annotations.ts`,
`api/tags.ts`) e quatro comandos de CLI.

Nada entra no dump: as quatro áreas são ao vivo. A tool `tags` é a única que também lê o
dump, para dizer quais workflows citam cada tag e em que papel; sem dump ela degrada, com
aviso, em vez de falhar.

O que a pesquisa e a prova ao vivo mudaram no desenho:

- **Tag em workflow é o nome, nunca o id** — em step, em trigger e em condição.
- **Renomear pela API propaga** para os três lugares, provado ao vivo. Por isso `renomear` é
  escrita comum, sem guarda extra e sem propagação própria.
- **Apagar é a operação perigosa**: tira a tag de todos os contatos e pode disparar os
  workflows com trigger de "tag removida" — isso não tem prova nem a favor nem contra. Apagar
  tag citada por workflow exige `apagar_citada`.
- **Não existe contagem de contatos por tag** no GHL. A prévia do apagar declara que não sabe
  esse número em vez de estimá-lo.
- **Criar tarefa exige `completed`**, e a data é texto ISO.

Dívida declarada: `workflow-editar --acao trocar-tag` continua sem tocar trigger nem
`attributes.customTags`. Nada nesta entrega depende dele, mas quem o usar para trocar tag
deixa o trigger com o nome velho.
```

Atualize também a linha de contagens ("31 tools e 18 regras; 189 testes no extractor, 331 no auditor") com os números finais, medidos pelas suítes.

- [ ] **Step 5: `skills/automaster-leitura/SKILL.md`**

Acrescente as quatro tools ao `description` do frontmatter e uma seção nova, no molde da de formulários, dizendo como ler as respostas: `aplicado: false` é prévia; `workflows: null` em `tags` significa "sem dump", não "tag órfã"; `papeis` vazio com `workflows` preenchido não acontece; e o aviso de merge field significa que a contagem é incompleta por natureza.

- [ ] **Step 6: suítes, e só então commit**

```bash
cd extractor && npx tsc --noEmit && npm test
cd ../auditor && .venv/bin/python -m pytest -q
cd .. && git add -A
git commit -m "feat(0.20.0): notas e tarefas do contato, tags da subconta"
```

---

## Ordem e paralelismo

Tasks 2 e 3 são independentes e podem ir em paralelo. Task 4 depende da 2; Task 5 depende da 3. Tasks 6 e 7 dependem de 4 e 5 respectivamente. Task 8 depende de tudo e é **estritamente serial** — um comando de escrita por vez, nunca dois agentes. Task 9 fecha.
