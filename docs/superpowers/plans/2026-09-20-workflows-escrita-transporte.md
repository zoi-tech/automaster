# Escrita de workflows, parte A (transporte e edição cirúrgica) — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dar ao automaster a capacidade de criar, renomear, mover, duplicar, apagar e
restaurar workflows do GHL, e de aplicar cinco operações cirúrgicas sobre o corpo de um
workflow existente (trocar referência, remover step inalcançável, alterar atributo de step,
mexer em trigger, renomear) com snapshot, diff, validação e confirmação.

**Architecture:** o extractor ganha um módulo de rotas de escrita (`workflows-write.ts`) e
um módulo puro de edição de documento (`workflow-edit.ts`), mais um comando em arquivo
próprio. O auditor ganha a validação pré-gravação (troca um workflow no `DumpContext` em
memória e roda as 18 regras) e a tool MCP `workflow_editar`, que orquestra: lê ao vivo,
edita, valida, mostra diff, grava. O extractor nunca decide nada.

**Tech Stack:** TypeScript + Playwright (extractor, testes com `node:test` via `tsx`),
Python 3.12 (auditor, pytest), MCP stdio.

**Spec:** `docs/superpowers/specs/2026-09-20-workflows-escrita-transporte-design.md`
**Pesquisa:** `docs/superpowers/research/2026-09-20-workflows-escrita-transporte-research.md`

## Global Constraints

- Host da API: `https://backend.leadconnectorhq.com`. **Prefixo `/workflow` (SINGULAR)** em
  todas as rotas deste plano. `/workflows` (plural) é outro serviço, só da busca de
  inscritos.
- Dois tokens em toda chamada (`authorization: Bearer` + `token-id`), mais
  `channel: APP`, `source: WEB_USER`, `version: 2021-07-28` e User-Agent de browser. Tudo
  isso já está em `GhlClient.authHeaders()` (`extractor/src/api/client.ts:26-35`) — use
  `client.getJson/putJson/postJson/deleteJson`, nunca monte requisição à mão.
- **Nunca montar corpo de PUT do zero.** O corpo é a resposta da leitura com o campo alvo
  trocado. Exceção única: `createdSteps`, `modifiedSteps`, `deletedSteps`, preenchidas pela
  operação.
- Escrita ao vivo é **serial**: o perfil do Chrome (`~/.automaster/chrome-profile`) é único.
  Nunca rodar dois comandos de escrita em paralelo, nem despachar dois agentes que escrevam.
- Subconta de validação: `Xb9gDxwxYhdqtprGcb5E` (Instaltech). Só workflow descartável,
  criado e apagado na tarefa.
- Toda escrita grava rastro via `registroEscrita(loc, "_workflows", wid, dados)`.
- Texto de usuário em português do Brasil, com acento. Identificadores de código em inglês
  só quando já existem assim no projeto.
- `schemaVersion` do dump fica em 1. Nada neste plano muda o formato do dump.

---

## Estrutura de arquivos

**Criar:**
- `extractor/src/api/workflows-write.ts` — uma função por rota de escrita/histórico. Sem
  lógica de negócio.
- `extractor/src/api/workflow-edit.ts` — funções puras sobre o documento do workflow:
  as cinco operações, a montagem do corpo, as duas checagens de publicabilidade e o diff.
  Zero I/O, zero rede.
- `extractor/src/cli/workflow-editar.ts` — o comando, registrado no `program` do `cli.ts`.
- `extractor/test/workflows-write.test.ts`, `extractor/test/workflow-edit.test.ts`
- `auditor/src/automaster_audit/validacao_escrita.py` — valida um workflow editado contra
  as 18 regras, comparando achados antes e depois.
- `auditor/tests/test_validacao_escrita.py`, `auditor/tests/test_workflow_editar_tool.py`

**Modificar:**
- `extractor/src/cli.ts` — exportar `withClient` (`:105`) e `registroEscrita` (`:550`);
  importar e registrar o comando novo perto do fim (`:2371`).
- `extractor/package.json` — script `workflow-editar`.
- `auditor/src/automaster_audit/mcp_server.py` — função `workflow_editar` e sua entrada no
  dict `TOOLS` (`:999`).
- `docs/endpoints.md`, `CLAUDE.md`, `CHANGELOG.md`, `.claude-plugin/plugin.json`,
  `skills/automaster-leitura/SKILL.md`.

---

### Task 1: rotas de escrita (`workflows-write.ts`)

**Files:**
- Create: `extractor/src/api/workflows-write.ts`
- Test: `extractor/test/workflows-write.test.ts`

**Interfaces:**
- Consumes: `GhlClient` de `extractor/src/api/client.ts`.
- Produces: `criarWorkflow`, `duplicarWorkflow`, `renomearWorkflow`, `moverWorkflow`,
  `apagarWorkflow`, `recuperarWorkflow`, `salvarWorkflow`, `salvarSomenteTriggers`,
  `historicoVersoes`, `versaoPorNumero`, e a constante `WF_WRITE` (base da URL), todas
  usadas pela Task 5.

- [ ] **Step 1: escrever o teste que falha**

As funções recebem um cliente falso que só registra método, URL e corpo. Isso testa a
montagem da URL e a passagem do corpo — que é tudo que estas funções fazem.

```ts
// extractor/test/workflows-write.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  criarWorkflow, duplicarWorkflow, renomearWorkflow, moverWorkflow, apagarWorkflow,
  salvarWorkflow, salvarSomenteTriggers, historicoVersoes, versaoPorNumero,
} from "../src/api/workflows-write.js";

type Chamada = { metodo: string; url: string; corpo?: unknown };

function clienteFalso() {
  const chamadas: Chamada[] = [];
  const reg = (metodo: string) => (url: string, corpo?: unknown) => {
    chamadas.push({ metodo, url, corpo });
    return Promise.resolve({ ok: true });
  };
  return {
    chamadas,
    client: {
      getJson: reg("get"), putJson: reg("put"),
      postJson: reg("post"), deleteJson: reg("delete"),
    } as never,
  };
}

const LOC = "LOC1";
const WID = "WF1";

test("salvarWorkflow faz PUT no workflow, prefixo singular", async () => {
  const { client, chamadas } = clienteFalso();
  await salvarWorkflow(client, LOC, WID, { name: "x" });
  assert.deepEqual(chamadas[0], {
    metodo: "put",
    url: "https://backend.leadconnectorhq.com/workflow/LOC1/WF1",
    corpo: { name: "x" },
  });
});

test("salvarSomenteTriggers usa a rota only-triggers com o mesmo corpo", async () => {
  const { client, chamadas } = clienteFalso();
  await salvarSomenteTriggers(client, LOC, WID, { name: "x" });
  assert.equal(chamadas[0].url, "https://backend.leadconnectorhq.com/workflow/LOC1/only-triggers/WF1");
  assert.deepEqual(chamadas[0].corpo, { name: "x" });
});

test("criarWorkflow faz POST na subconta com location_id no corpo", async () => {
  const { client, chamadas } = clienteFalso();
  await criarWorkflow(client, LOC, { name: "Novo" });
  assert.deepEqual(chamadas[0], {
    metodo: "post",
    url: "https://backend.leadconnectorhq.com/workflow/LOC1",
    corpo: { name: "Novo", location_id: "LOC1" },
  });
});

test("duplicarWorkflow é o POST de criação com workflow_id", async () => {
  const { client, chamadas } = clienteFalso();
  await duplicarWorkflow(client, LOC, { workflowId: WID, novoNome: "Cópia", parentId: "P1" });
  assert.equal(chamadas[0].metodo, "post");
  assert.equal(chamadas[0].url, "https://backend.leadconnectorhq.com/workflow/LOC1");
  assert.deepEqual(chamadas[0].corpo, {
    new_workflow_name: "Cópia", workflow_id: "WF1", parentId: "P1", location_id: "LOC1",
  });
});

test("duplicarWorkflow manda parentId null quando não vem pasta", async () => {
  const { client, chamadas } = clienteFalso();
  await duplicarWorkflow(client, LOC, { workflowId: WID, novoNome: "Cópia" });
  assert.equal((chamadas[0].corpo as { parentId: unknown }).parentId, null);
});

test("renomearWorkflow e moverWorkflow usam as rotas dedicadas", async () => {
  const { client, chamadas } = clienteFalso();
  await renomearWorkflow(client, LOC, WID, "Nome novo");
  await moverWorkflow(client, LOC, WID, "P2");
  assert.equal(chamadas[0].url, "https://backend.leadconnectorhq.com/workflow/LOC1/rename-workflow/WF1");
  assert.deepEqual(chamadas[0].corpo, { name: "Nome novo" });
  assert.equal(chamadas[1].url, "https://backend.leadconnectorhq.com/workflow/LOC1/move-directory/WF1");
  assert.deepEqual(chamadas[1].corpo, { parentId: "P2" });
});

test("apagarWorkflow manda o userId na query", async () => {
  const { client, chamadas } = clienteFalso();
  await apagarWorkflow(client, LOC, WID, "U1");
  assert.equal(chamadas[0].metodo, "delete");
  assert.equal(chamadas[0].url, "https://backend.leadconnectorhq.com/workflow/LOC1/WF1?userId=U1");
});

test("histórico de versões: lista e por número", async () => {
  const { client, chamadas } = clienteFalso();
  await historicoVersoes(client, LOC, WID);
  await versaoPorNumero(client, LOC, WID, 7);
  assert.equal(chamadas[0].url, "https://backend.leadconnectorhq.com/workflow/LOC1/WF1/history");
  assert.equal(chamadas[1].url, "https://backend.leadconnectorhq.com/workflow/LOC1/WF1/history-by-number/7");
});
```

- [ ] **Step 2: rodar para ver falhar**

Run: `cd extractor && npx tsx --test test/workflows-write.test.ts`
Expected: FAIL — `Cannot find module '../src/api/workflows-write.js'`

- [ ] **Step 3: implementar**

```ts
// extractor/src/api/workflows-write.ts
import type { GhlClient } from "./client.js";

/**
 * Rotas de ESCRITA de workflow, mapeadas do bundle do editor
 * (client-app-automation-workflows.leadconnectorhq.com). Prefixo SINGULAR.
 * Transporte puro: nenhuma decisão mora aqui.
 */
export const WF_WRITE = "https://backend.leadconnectorhq.com/workflow";

/** POST de criação. `location_id` só existe no POST — o PUT nunca o leva. */
export function criarWorkflow(client: GhlClient, loc: string, corpo: Record<string, unknown>): Promise<unknown> {
  return client.postJson(`${WF_WRITE}/${loc}`, { ...corpo, location_id: loc });
}

/** Duplicar na MESMA subconta é o POST de criação com o id do original. */
export function duplicarWorkflow(
  client: GhlClient,
  loc: string,
  a: { workflowId: string; novoNome: string; parentId?: string },
): Promise<unknown> {
  return client.postJson(`${WF_WRITE}/${loc}`, {
    new_workflow_name: a.novoNome,
    workflow_id: a.workflowId,
    parentId: a.parentId ?? null,
    location_id: loc,
  });
}

export function renomearWorkflow(client: GhlClient, loc: string, wid: string, nome: string): Promise<unknown> {
  return client.putJson(`${WF_WRITE}/${loc}/rename-workflow/${wid}`, { name: nome });
}

export function moverWorkflow(client: GhlClient, loc: string, wid: string, parentId: string | null): Promise<unknown> {
  return client.putJson(`${WF_WRITE}/${loc}/move-directory/${wid}`, { parentId });
}

export function apagarWorkflow(client: GhlClient, loc: string, wid: string, userId: string): Promise<unknown> {
  return client.deleteJson(`${WF_WRITE}/${loc}/${wid}?userId=${encodeURIComponent(userId)}`);
}

export function recuperarWorkflow(client: GhlClient, loc: string, wid: string, corpo: Record<string, unknown>): Promise<unknown> {
  return client.putJson(`${WF_WRITE}/${loc}/${wid}/recover`, corpo);
}

/** Salva o workflow inteiro. O corpo é o documento lido, com o alvo trocado. */
export function salvarWorkflow(client: GhlClient, loc: string, wid: string, corpo: Record<string, unknown>): Promise<unknown> {
  return client.putJson(`${WF_WRITE}/${loc}/${wid}`, corpo);
}

/**
 * Rota usada pelo app quando SÓ triggers mudaram. O corpo é o mesmo do save
 * inteiro — não é operação mais leve nem mais segura, só outra URL.
 */
export function salvarSomenteTriggers(client: GhlClient, loc: string, wid: string, corpo: Record<string, unknown>): Promise<unknown> {
  return client.putJson(`${WF_WRITE}/${loc}/only-triggers/${wid}`, corpo);
}

export function historicoVersoes(client: GhlClient, loc: string, wid: string): Promise<unknown> {
  return client.getJson(`${WF_WRITE}/${loc}/${wid}/history`);
}

export function versaoPorNumero(client: GhlClient, loc: string, wid: string, n: number): Promise<unknown> {
  return client.getJson(`${WF_WRITE}/${loc}/${wid}/history-by-number/${n}`);
}
```

- [ ] **Step 4: rodar até passar**

Run: `cd extractor && npx tsx --test test/workflows-write.test.ts && npx tsc --noEmit`
Expected: todos os testes PASS, typecheck limpo.

- [ ] **Step 5: commit**

```bash
git add extractor/src/api/workflows-write.ts extractor/test/workflows-write.test.ts
git commit -m "feat(extractor): rotas de escrita de workflow"
```

---

### Task 2: as cinco operações cirúrgicas (`workflow-edit.ts`, parte 1)

**Files:**
- Create: `extractor/src/api/workflow-edit.ts`
- Test: `extractor/test/workflow-edit.test.ts`

**Interfaces:**
- Produces: `type Documento`, `type Step`, `trocarReferencia`, `trocarTag`,
  `removerStepsInalcancaveis`, `alterarAtributo`, `editarTriggers`, `renomear`. Todas
  puras: recebem documento, devolvem `{ doc, mudancas }` sem mutar a entrada.

O documento é a resposta de `GET /workflow/<loc>/<wid>`: um objeto com `name`, `status`,
`version`, `workflowData.templates` (os steps) e o resto. Os steps se encadeiam por
ponteiro: `next` é id ou lista de ids; step sem `parent` é entrada.

- [ ] **Step 1: escrever o teste que falha**

```ts
// extractor/test/workflow-edit.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  trocarReferencia, trocarTag, removerStepsInalcancaveis, alterarAtributo,
  editarTriggers, renomear, type Documento,
} from "../src/api/workflow-edit.js";

function doc(steps: unknown[], triggers: unknown[] = []): Documento {
  return {
    _id: "WF1", name: "Fluxo", status: "draft", version: 3,
    workflowData: { templates: steps },
    triggersData: triggers,
  } as unknown as Documento;
}

const ID_VELHO = "AkbAIoxcORSn9CELCijZ";
const ID_NOVO = "ZZnovoCampo000000001";

test("trocarReferencia troca o id em qualquer profundidade e conta as trocas", () => {
  const d = doc([
    { id: "s1", type: "update_contact_field", next: null,
      attributes: { fields: [{ id: ID_VELHO, value: "x" }] } },
    { id: "s2", type: "webhook", attributes: { url: "https://x/" + ID_VELHO } },
  ]);
  const r = trocarReferencia(d, ID_VELHO, ID_NOVO);
  assert.equal(r.mudancas.length, 2);
  assert.equal(r.doc.workflowData.templates[0].attributes.fields[0].id, ID_NOVO);
  assert.equal(r.doc.workflowData.templates[1].attributes.url, "https://x/" + ID_NOVO);
});

test("trocarReferencia não muta o documento original", () => {
  const d = doc([{ id: "s1", type: "x", attributes: { campo: ID_VELHO } }]);
  trocarReferencia(d, ID_VELHO, ID_NOVO);
  assert.equal(d.workflowData.templates[0].attributes.campo, ID_VELHO);
});

test("trocarReferencia devolve zero mudanças quando o id não aparece", () => {
  const d = doc([{ id: "s1", type: "x", attributes: {} }]);
  assert.equal(trocarReferencia(d, ID_VELHO, ID_NOVO).mudancas.length, 0);
});

test("trocarTag só mexe nos campos onde tag mora, nunca no texto de mensagem", () => {
  const d = doc([
    { id: "s1", type: "add_contact_tag", attributes: { tags: ["quente", "frio"] } },
    { id: "s2", type: "sms", attributes: { message: "você está quente" } },
    { id: "s3", type: "if_else", attributes: { branches: [{ segments: [{ conditions: [
      { conditionSubType: "tags", conditionValue: ["quente"] }] }] }] } },
  ]);
  const r = trocarTag(d, "quente", "morno");
  assert.deepEqual(r.doc.workflowData.templates[0].attributes.tags, ["morno", "frio"]);
  assert.equal(r.doc.workflowData.templates[1].attributes.message, "você está quente");
  assert.deepEqual(
    r.doc.workflowData.templates[2].attributes.branches[0].segments[0].conditions[0].conditionValue,
    ["morno"],
  );
  assert.equal(r.mudancas.length, 2);
});

test("trocarTag compara ignorando caixa e espaço nas pontas, como a auditoria", () => {
  const d = doc([{ id: "s1", type: "remove_contact_tag", attributes: { tags: [" Quente "] } }]);
  assert.deepEqual(trocarTag(d, "quente", "morno").doc.workflowData.templates[0].attributes.tags, ["morno"]);
});

test("removerStepsInalcancaveis tira o bloco órfão e preserva o fluxo vivo", () => {
  const d = doc([
    { id: "a", type: "wait", next: "b" },            // entrada (sem parent)
    { id: "b", type: "sms", parent: "a", next: null },
    { id: "orf1", type: "sms", parent: "x", next: "orf2" },
    { id: "orf2", type: "sms", parent: "orf1" },
  ]);
  const r = removerStepsInalcancaveis(d);
  assert.deepEqual(r.mudancas.sort(), ["orf1", "orf2"]);
  assert.deepEqual(r.doc.workflowData.templates.map((s) => s.id), ["a", "b"]);
});

test("removerStepsInalcancaveis segue goto ao decidir o que é alcançável", () => {
  const d = doc([
    { id: "a", type: "goto", next: null, attributes: { targetNodeId: "z" } },
    { id: "z", type: "sms", parent: "q" },
  ]);
  assert.deepEqual(removerStepsInalcancaveis(d).mudancas, []);
});

test("removerStepsInalcancaveis não faz nada em workflow sem entrada identificável", () => {
  const d = doc([{ id: "a", type: "sms", parent: "sumiu" }]);
  assert.deepEqual(removerStepsInalcancaveis(d).mudancas, []);
});

test("alterarAtributo escreve no caminho e recusa step inexistente", () => {
  const d = doc([{ id: "s1", type: "wait", attributes: { dias: 2 } }]);
  const r = alterarAtributo(d, "s1", "dias", 5);
  assert.equal(r.doc.workflowData.templates[0].attributes.dias, 5);
  assert.equal(r.mudancas.length, 1);
  assert.throws(() => alterarAtributo(d, "naoexiste", "dias", 5), /naoexiste/);
});

test("alterarAtributo aceita caminho aninhado com ponto", () => {
  const d = doc([{ id: "s1", type: "x", attributes: { alvo: { interno: 1 } } }]);
  assert.equal(alterarAtributo(d, "s1", "alvo.interno", 9).doc.workflowData.templates[0].attributes.alvo.interno, 9);
});

test("editarTriggers adiciona, remove e substitui", () => {
  const d = doc([], [{ id: "t1", name: "Form" }, { id: "t2", name: "Tag" }]);
  assert.equal(editarTriggers(d, { acao: "remover", id: "t1" }).doc.triggersData.length, 1);
  assert.equal(editarTriggers(d, { acao: "adicionar", trigger: { id: "t3" } }).doc.triggersData.length, 3);
  const sub = editarTriggers(d, { acao: "substituir", id: "t2", trigger: { id: "t2", name: "Outro" } });
  assert.equal(sub.doc.triggersData[1].name, "Outro");
  assert.throws(() => editarTriggers(d, { acao: "remover", id: "nao" }), /nao/);
});

test("renomear apara espaço nas pontas e recusa nome vazio", () => {
  const d = doc([]);
  assert.equal(renomear(d, "  Novo  ").doc.name, "Novo");
  assert.throws(() => renomear(d, "   "), /vazio/);
});
```

- [ ] **Step 2: rodar para ver falhar**

Run: `cd extractor && npx tsx --test test/workflow-edit.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: implementar**

```ts
// extractor/src/api/workflow-edit.ts

/** Um step do workflow. Encadeia por ponteiro: `next` é id, lista de ids, ou nada. */
export interface Step {
  id: string;
  type?: string;
  name?: string;
  parent?: string;
  next?: string | string[] | null;
  attributes?: Record<string, any>;
  [k: string]: unknown;
}

/** O documento do workflow, como `GET /workflow/<loc>/<wid>` devolve. */
export interface Documento {
  _id?: string;
  name?: string;
  status?: string;
  version?: number;
  workflowData: { templates: Step[] };
  triggersData?: any[];
  [k: string]: unknown;
}

export interface Resultado {
  doc: Documento;
  /** Descrição de cada mudança aplicada; vazio = nada mudou. */
  mudancas: string[];
}

const clonar = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/**
 * Troca um id em qualquer profundidade do documento. Ids do GHL são opacos e
 * longos (uuid/ObjectId), então comparar a string inteira não colide com texto
 * de mensagem. Para TAG, que é referenciada por NOME, use `trocarTag`.
 */
export function trocarReferencia(doc: Documento, de: string, para: string): Resultado {
  const out = clonar(doc);
  const mudancas: string[] = [];
  const anda = (no: any, caminho: string): any => {
    if (typeof no === "string") {
      if (no === de) { mudancas.push(caminho); return para; }
      if (no.includes(de)) { mudancas.push(caminho); return no.split(de).join(para); }
      return no;
    }
    if (Array.isArray(no)) return no.map((v, i) => anda(v, `${caminho}[${i}]`));
    if (no && typeof no === "object") {
      for (const k of Object.keys(no)) no[k] = anda(no[k], `${caminho}.${k}`);
    }
    return no;
  };
  anda(out.workflowData?.templates, "steps");
  anda(out.triggersData, "triggers");
  return { doc: out, mudancas };
}

const mesmaTag = (a: unknown, b: string) =>
  typeof a === "string" && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Troca uma tag pelo nome, SÓ onde tag mora: `attributes.tags` de
 * add/remove_contact_tag e `conditionValue` de condição com
 * `conditionSubType: "tags"`. Nunca varre texto livre — trocar em mensagem
 * reescreveria o que o cliente fala com o contato.
 */
export function trocarTag(doc: Documento, de: string, para: string): Resultado {
  const out = clonar(doc);
  const mudancas: string[] = [];
  for (const step of out.workflowData?.templates ?? []) {
    const attrs = step.attributes ?? {};
    if (step.type === "add_contact_tag" || step.type === "remove_contact_tag") {
      const tags = attrs.tags;
      if (Array.isArray(tags) && tags.some((t) => mesmaTag(t, de))) {
        attrs.tags = tags.map((t) => (mesmaTag(t, de) ? para : t));
        mudancas.push(`step ${step.id} (${step.type})`);
      }
    }
    const condicoes: any[] = [];
    const cata = (no: any): void => {
      if (Array.isArray(no)) { no.forEach(cata); return; }
      if (no && typeof no === "object") {
        if (no.conditionSubType === "tags") condicoes.push(no);
        Object.values(no).forEach(cata);
      }
    };
    cata(attrs);
    for (const c of condicoes) {
      if (Array.isArray(c.conditionValue) && c.conditionValue.some((t: unknown) => mesmaTag(t, de))) {
        c.conditionValue = c.conditionValue.map((t: unknown) => (mesmaTag(t, de) ? para : t));
        mudancas.push(`step ${step.id} (condição)`);
      }
    }
  }
  return { doc: out, mudancas };
}

/** Ids alcançáveis a partir das entradas, seguindo `next` e `goto`. */
function alcancaveis(steps: Step[]): Set<string> {
  const porId = new Map(steps.filter((s) => s.id).map((s) => [s.id, s]));
  const raizes = steps.filter((s) => s.id && !s.parent).map((s) => s.id);
  const vistos = new Set<string>();
  const fila = [...raizes];
  while (fila.length) {
    const id = fila.shift()!;
    if (vistos.has(id)) continue;
    vistos.add(id);
    const s = porId.get(id);
    if (!s) continue;
    const proximos: string[] = [];
    if (Array.isArray(s.next)) proximos.push(...s.next.filter((x): x is string => typeof x === "string" && !!x));
    else if (typeof s.next === "string" && s.next) proximos.push(s.next);
    if (s.type === "goto") {
      const alvo = s.attributes?.targetNodeId;
      if (typeof alvo === "string" && alvo) proximos.push(alvo);
    }
    fila.push(...proximos);
  }
  return vistos;
}

/**
 * Remove os steps que nunca executam. Ninguém alcançável aponta para eles, então
 * não há ponteiro a recosturar — é por isso que só o inalcançável sai em A.
 * Workflow sem entrada identificável não é mexido (mesmo critério da regra
 * `unreachable_step` do auditor).
 */
export function removerStepsInalcancaveis(doc: Documento): Resultado {
  const out = clonar(doc);
  const steps = out.workflowData?.templates ?? [];
  const temRaiz = steps.some((s) => s.id && !s.parent);
  if (!steps.length || !temRaiz) return { doc: out, mudancas: [] };
  const vivos = alcancaveis(steps);
  const removidos = steps.filter((s) => s.id && !vivos.has(s.id)).map((s) => s.id);
  out.workflowData.templates = steps.filter((s) => !s.id || vivos.has(s.id));
  return { doc: out, mudancas: removidos };
}

/** Escreve em `attributes.<caminho>` de um step. Caminho aninhado usa ponto. */
export function alterarAtributo(doc: Documento, stepId: string, caminho: string, valor: unknown): Resultado {
  const out = clonar(doc);
  const step = (out.workflowData?.templates ?? []).find((s) => s.id === stepId);
  if (!step) throw new Error(`step ${stepId} não existe neste workflow`);
  step.attributes ??= {};
  const partes = caminho.split(".");
  let no: any = step.attributes;
  for (const p of partes.slice(0, -1)) {
    if (typeof no[p] !== "object" || no[p] === null) no[p] = {};
    no = no[p];
  }
  no[partes[partes.length - 1]] = valor;
  return { doc: out, mudancas: [`step ${stepId}: ${caminho}`] };
}

export type OpTrigger =
  | { acao: "adicionar"; trigger: Record<string, unknown> }
  | { acao: "remover"; id: string }
  | { acao: "substituir"; id: string; trigger: Record<string, unknown> };

export function editarTriggers(doc: Documento, op: OpTrigger): Resultado {
  const out = clonar(doc);
  const lista: any[] = out.triggersData ?? (out.triggersData = []);
  if (op.acao === "adicionar") {
    lista.push(op.trigger);
    return { doc: out, mudancas: ["trigger adicionado"] };
  }
  const i = lista.findIndex((t) => t?.id === op.id);
  if (i < 0) throw new Error(`trigger ${op.id} não existe neste workflow`);
  if (op.acao === "remover") {
    lista.splice(i, 1);
    return { doc: out, mudancas: [`trigger ${op.id} removido`] };
  }
  lista[i] = op.trigger;
  return { doc: out, mudancas: [`trigger ${op.id} substituído`] };
}

export function renomear(doc: Documento, nome: string): Resultado {
  const limpo = nome.trim();
  if (!limpo) throw new Error("nome vazio: o workflow precisa de um nome");
  const out = clonar(doc);
  const antes = out.name;
  out.name = limpo;
  return { doc: out, mudancas: antes === limpo ? [] : [`nome: ${antes} → ${limpo}`] };
}
```

- [ ] **Step 4: rodar até passar**

Run: `cd extractor && npx tsx --test test/workflow-edit.test.ts && npx tsc --noEmit`
Expected: PASS em todos, typecheck limpo.

- [ ] **Step 5: commit**

```bash
git add extractor/src/api/workflow-edit.ts extractor/test/workflow-edit.test.ts
git commit -m "feat(extractor): operações cirúrgicas sobre o documento do workflow"
```

---

### Task 3: corpo do PUT, checagens de publicabilidade e diff (`workflow-edit.ts`, parte 2)

**Files:**
- Modify: `extractor/src/api/workflow-edit.ts` (acrescenta ao final)
- Modify: `extractor/test/workflow-edit.test.ts` (acrescenta ao final)

**Interfaces:**
- Consumes: `Documento`, `Step` da Task 2.
- Produces: `montarCorpo(original, editado, usuarioId)`, `checarPublicavel(doc)`,
  `diffWorkflow(antes, depois)` e `type DiffWorkflow`. Usadas pela Task 5 e pela Task 6.

- [ ] **Step 1: escrever o teste que falha**

```ts
// acrescentar em extractor/test/workflow-edit.test.ts
import { montarCorpo, checarPublicavel, diffWorkflow } from "../src/api/workflow-edit.js";

test("montarCorpo parte do documento editado e calcula as três listas de steps", () => {
  const antes = doc([
    { id: "a", type: "wait", attributes: { dias: 2 } },
    { id: "b", type: "sms", attributes: {} },
  ]);
  const depois = doc([
    { id: "a", type: "wait", attributes: { dias: 5 } },
    { id: "c", type: "sms", attributes: {} },
  ]);
  const corpo = montarCorpo(antes, depois, "U1");
  assert.deepEqual(corpo.createdSteps, ["c"]);
  assert.deepEqual(corpo.modifiedSteps, ["a"]);
  assert.deepEqual(corpo.deletedSteps, ["b"]);
  assert.equal(corpo.updatedBy, "U1");
  assert.equal(corpo.name, "Fluxo");
});

test("montarCorpo não inventa campo que a leitura não trouxe", () => {
  const d = doc([]);
  const corpo = montarCorpo(d, d, "U1");
  for (const proibido of ["paused", "workflowType", "templateId", "location_id"]) {
    assert.equal(proibido in corpo, false, `${proibido} não deveria ser inventado`);
  }
});

test("checarPublicavel acusa workflow sem nenhuma ação", () => {
  assert.deepEqual(
    checarPublicavel(doc([])),
    ["o workflow ficaria sem nenhuma ação, e o app recusa salvar workflow vazio"],
  );
});

test("checarPublicavel acusa goto apontando para step que não existe", () => {
  const d = doc([{ id: "a", type: "goto", attributes: { targetNodeId: "sumiu" } }]);
  assert.match(checarPublicavel(d)[0], /goto.*sumiu/);
});

test("checarPublicavel aprova workflow são", () => {
  assert.deepEqual(checarPublicavel(doc([{ id: "a", type: "sms", attributes: {} }])), []);
});

test("diffWorkflow separa step somado, removido e alterado, e mostra o campo", () => {
  const antes = doc([
    { id: "a", type: "wait", name: "Espera", attributes: { dias: 2 } },
    { id: "b", type: "sms", name: "Aviso", attributes: {} },
  ], [{ id: "t1", name: "Form" }]);
  const depois = doc([
    { id: "a", type: "wait", name: "Espera", attributes: { dias: 5 } },
    { id: "c", type: "sms", name: "Novo", attributes: {} },
  ], []);
  const d = diffWorkflow(antes, depois);
  assert.deepEqual(d.stepsAdicionados, [{ id: "c", nome: "Novo", tipo: "sms" }]);
  assert.deepEqual(d.stepsRemovidos, [{ id: "b", nome: "Aviso", tipo: "sms" }]);
  assert.equal(d.stepsAlterados.length, 1);
  assert.equal(d.stepsAlterados[0].id, "a");
  assert.deepEqual(d.stepsAlterados[0].campos, ["attributes.dias"]);
  assert.deepEqual(d.triggersRemovidos, [{ id: "t1", nome: "Form" }]);
  assert.equal(d.vazio, false);
});

test("diffWorkflow marca vazio quando nada mudou", () => {
  const d = doc([{ id: "a", type: "sms", attributes: {} }]);
  assert.equal(diffWorkflow(d, d).vazio, true);
});
```

- [ ] **Step 2: rodar para ver falhar**

Run: `cd extractor && npx tsx --test test/workflow-edit.test.ts`
Expected: FAIL — `montarCorpo is not a function` (ou erro de import).

- [ ] **Step 3: implementar**

```ts
// acrescentar em extractor/src/api/workflow-edit.ts

const porId = (steps: Step[]): Map<string, Step> =>
  new Map(steps.filter((s) => s?.id).map((s) => [s.id, s]));

const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Corpo do PUT: o documento EDITADO, tal como veio da leitura, mais as três
 * listas que o app recalcula a cada save e o autor da edição. Nada é inventado:
 * campo que a leitura não trouxe não entra (ver spec, "Como o corpo é montado").
 */
export function montarCorpo(
  original: Documento,
  editado: Documento,
  usuarioId: string,
): Record<string, unknown> {
  const antes = porId(original.workflowData?.templates ?? []);
  const depois = porId(editado.workflowData?.templates ?? []);
  const createdSteps = [...depois.keys()].filter((id) => !antes.has(id));
  const deletedSteps = [...antes.keys()].filter((id) => !depois.has(id));
  const modifiedSteps = [...depois.keys()].filter((id) => antes.has(id) && !igual(antes.get(id), depois.get(id)));
  return { ...clonar(editado), createdSteps, modifiedSteps, deletedSteps, updatedBy: usuarioId };
}

/**
 * As duas validações de publicação do app que dá para replicar sem entender cada
 * tipo de ação. As outras (remetente de e-mail, loop sem corpo, múltiplos goals)
 * ficam para a parte B — limite declarado, não coberto.
 */
export function checarPublicavel(doc: Documento): string[] {
  const steps = doc.workflowData?.templates ?? [];
  const erros: string[] = [];
  if (!steps.length) {
    erros.push("o workflow ficaria sem nenhuma ação, e o app recusa salvar workflow vazio");
  }
  const ids = new Set(steps.map((s) => s.id));
  for (const s of steps) {
    if (s.type !== "goto") continue;
    const alvo = s.attributes?.targetNodeId;
    if (!alvo || !ids.has(alvo)) {
      erros.push(`o step goto '${s.name ?? s.id}' apontaria para ${alvo ?? "lugar nenhum"}, que não existe no workflow`);
    }
  }
  return erros;
}

export interface DiffWorkflow {
  nome?: { antes?: string; depois?: string };
  stepsAdicionados: { id: string; nome?: string; tipo?: string }[];
  stepsRemovidos: { id: string; nome?: string; tipo?: string }[];
  stepsAlterados: { id: string; nome?: string; tipo?: string; campos: string[] }[];
  triggersAdicionados: { id: string; nome?: string }[];
  triggersRemovidos: { id: string; nome?: string }[];
  triggersAlterados: { id: string; nome?: string }[];
  vazio: boolean;
}

/** Caminhos (com ponto) dos campos que diferem entre dois objetos. */
function camposDiferentes(a: any, b: any, prefixo = ""): string[] {
  if (igual(a, b)) return [];
  const obj = (v: unknown) => v && typeof v === "object" && !Array.isArray(v);
  if (!obj(a) || !obj(b)) return [prefixo || "(valor)"];
  const chaves = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out: string[] = [];
  for (const k of chaves) out.push(...camposDiferentes(a[k], b[k], prefixo ? `${prefixo}.${k}` : k));
  return out;
}

const rotuloStep = (s: Step) => ({ id: s.id, nome: s.name, tipo: s.type });

export function diffWorkflow(antes: Documento, depois: Documento): DiffWorkflow {
  const a = porId(antes.workflowData?.templates ?? []);
  const d = porId(depois.workflowData?.templates ?? []);
  const stepsAdicionados = [...d.values()].filter((s) => !a.has(s.id)).map(rotuloStep);
  const stepsRemovidos = [...a.values()].filter((s) => !d.has(s.id)).map(rotuloStep);
  const stepsAlterados = [...d.values()]
    .filter((s) => a.has(s.id) && !igual(a.get(s.id), s))
    .map((s) => ({ ...rotuloStep(s), campos: camposDiferentes(a.get(s.id), s) }));

  const ta = new Map((antes.triggersData ?? []).map((t: any) => [t?.id, t]));
  const td = new Map((depois.triggersData ?? []).map((t: any) => [t?.id, t]));
  const rotuloTrigger = (t: any) => ({ id: t?.id, nome: t?.name });
  const triggersAdicionados = [...td.values()].filter((t: any) => !ta.has(t?.id)).map(rotuloTrigger);
  const triggersRemovidos = [...ta.values()].filter((t: any) => !td.has(t?.id)).map(rotuloTrigger);
  const triggersAlterados = [...td.values()]
    .filter((t: any) => ta.has(t?.id) && !igual(ta.get(t?.id), t))
    .map(rotuloTrigger);

  const nome = antes.name === depois.name ? undefined : { antes: antes.name, depois: depois.name };
  const vazio =
    !nome && !stepsAdicionados.length && !stepsRemovidos.length && !stepsAlterados.length &&
    !triggersAdicionados.length && !triggersRemovidos.length && !triggersAlterados.length;
  return {
    nome, stepsAdicionados, stepsRemovidos, stepsAlterados,
    triggersAdicionados, triggersRemovidos, triggersAlterados, vazio,
  };
}
```

- [ ] **Step 4: rodar até passar**

Run: `cd extractor && npx tsx --test test/workflow-edit.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: commit**

```bash
git add extractor/src/api/workflow-edit.ts extractor/test/workflow-edit.test.ts
git commit -m "feat(extractor): corpo do PUT, checagem de publicabilidade e diff de workflow"
```

---

### Task 4: exportar os helpers do `cli.ts`

**Files:**
- Modify: `extractor/src/cli.ts:105` (`withClient`), `extractor/src/cli.ts:550` (`registroEscrita`)

**Interfaces:**
- Produces: `withClient` e `registroEscrita` exportados, consumidos pela Task 5.

Tarefa deliberadamente minúscula e separada: é a única mudança em arquivo existente grande,
e um revisor precisa poder aprová-la sozinha.

- [ ] **Step 1: trocar `function` por `export function` nos dois**

Em `extractor/src/cli.ts`, linha 105:

```ts
export async function withClient(
```

Em `extractor/src/cli.ts`, linha 550:

```ts
export function registroEscrita(loc: string, pasta: string, chave: string, dados: unknown): string {
```

Nada mais muda: os dois continuam sendo usados internamente do mesmo jeito.

- [ ] **Step 2: verificar que nada quebrou**

Run: `cd extractor && npx tsc --noEmit && npx tsx --test test/*.test.ts`
Expected: typecheck limpo, todos os testes existentes PASS.

- [ ] **Step 3: commit**

```bash
git add extractor/src/cli.ts
git commit -m "refactor(extractor): exporta withClient e registroEscrita"
```

---

### Task 5: o comando `workflow-editar`

**Files:**
- Create: `extractor/src/cli/workflow-editar.ts`
- Modify: `extractor/src/cli.ts` (import + registro do comando, perto do fim do arquivo)
- Modify: `extractor/package.json` (script)

**Interfaces:**
- Consumes: tudo das Tasks 1, 2, 3 e 4, mais `getWorkflowMeta` e `paginaDeInscritos` de
  `extractor/src/api/workflows-live.ts`, e `decodeUserId` de `extractor/src/auth/token.js`.
- Produces: o comando `workflow-editar`, cuja saída JSON a Task 7 consome.

O comando faz, nesta ordem: lê o documento ao vivo; aplica a operação; roda as duas
checagens de publicabilidade; monta o diff; se faltar `--confirmo`, imprime a prévia e
para; se o workflow estiver publicado, conta os inscritos vivos e exige `--publicado`;
**relê a meta e aborta se `version` mudou**; grava snapshot "antes"; escreve; grava
snapshot "depois".

- [ ] **Step 1: escrever o arquivo do comando**

```ts
// extractor/src/cli/workflow-editar.ts
import type { Command } from "commander";
import fs from "node:fs";
import { withClient, registroEscrita } from "../cli.js";
import { decodeUserId } from "../auth/token.js";
import { getWorkflowMeta, paginaDeInscritos } from "../api/workflows-live.js";
import {
  criarWorkflow, duplicarWorkflow, renomearWorkflow, moverWorkflow, apagarWorkflow,
  salvarWorkflow, salvarSomenteTriggers, historicoVersoes, WF_WRITE,
} from "../api/workflows-write.js";
import {
  trocarReferencia, trocarTag, removerStepsInalcancaveis, alterarAtributo,
  editarTriggers, renomear, montarCorpo, checarPublicavel, diffWorkflow,
  type Documento,
} from "../api/workflow-edit.js";

export const WF_EDITAR_ACOES = [
  "criar", "renomear", "mover", "duplicar", "apagar",
  "trocar-ref", "trocar-tag", "limpar-orfaos", "atributo", "trigger", "historico",
] as const;

interface Opts {
  location: string; acao: string; id?: string; nome?: string; pasta?: string;
  de?: string; para?: string; step?: string; caminho?: string; valor?: string;
  trigger?: string; triggerAcao?: string; triggerId?: string;
  usuario?: string; confirmo?: boolean; publicado?: boolean; json?: boolean;
}

/** As ações que não tocam no corpo do workflow e por isso pulam diff e validação. */
const SEM_CORPO = new Set(["criar", "renomear", "mover", "duplicar", "apagar", "historico"]);

export async function runWorkflowEditar(o: Opts): Promise<void> {
  if (!WF_EDITAR_ACOES.includes(o.acao as never)) {
    throw new Error(`--acao inválida: ${o.acao}. Use uma de: ${WF_EDITAR_ACOES.join(" | ")}`);
  }
  const log = (m: string) => (o.json ? console.error(m) : console.log(m));
  const precisaId = o.acao !== "criar";
  if (precisaId && !o.id) throw new Error(`--acao ${o.acao} exige -i/--id (id do workflow)`);

  await withClient(o.location, log, async (client, _page, tokens) => {
    const usuarioId = o.usuario ?? decodeUserId(tokens.bearer, tokens.tokenId);
    const saida: Record<string, unknown> = { aplicado: false, acao: o.acao, id: o.id };

    if (o.acao === "historico") {
      saida.historico = await historicoVersoes(client, o.location, o.id!);
      saida.aplicado = true;
      return imprimir(saida, o, log);
    }

    if (SEM_CORPO.has(o.acao)) {
      if (!o.confirmo) throw new Error(exigeConfirmo(o.acao));
      const registro = registroEscrita(o.location, "_workflows", o.id ?? "novo", { acao: o.acao, opts: semSegredo(o) });
      const resposta = await escritaSemCorpo(client, o, usuarioId);
      fs.writeFileSync(registro, JSON.stringify({ em: new Date().toISOString(), acao: o.acao, aplicado: true, resposta }, null, 2));
      Object.assign(saida, { aplicado: true, resposta, registro });
      return imprimir(saida, o, log);
    }

    // ---- ações que mexem no corpo ----
    const doc = (await client.getJson(`${WF_WRITE}/${o.location}/${o.id}`)) as Documento;
    const versaoLida = doc.version;
    const { doc: editado, mudancas } = aplicarOperacao(doc, o);
    if (!mudancas.length) {
      Object.assign(saida, { aplicado: false, motivo: "nada a mudar: a operação não encontrou alvo neste workflow" });
      return imprimir(saida, o, log);
    }

    const problemas = checarPublicavel(editado);
    if (problemas.length) {
      throw new Error(
        "a edição deixaria o workflow num estado que o app recusa salvar, e o cliente ficaria travado no editor:\n  - " +
        problemas.join("\n  - "),
      );
    }

    const diff = diffWorkflow(doc, editado);
    saida.diff = diff;
    saida.mudancas = mudancas;

    if (!o.confirmo) {
      Object.assign(saida, { aplicado: false, motivo: "prévia: rode de novo com --confirmo para gravar" });
      return imprimir(saida, o, log);
    }

    if (doc.status === "published") {
      const dentro = await contarDentro(client, o.location, o.id!);
      const aviso =
        `workflow PUBLICADO com ${dentro} contato(s) dentro agora. Quem está no meio termina o passo ` +
        `atual na versão antiga e segue pela nova daí em diante.`;
      saida.aviso = aviso;
      log(aviso);
      if (!o.publicado) {
        throw new Error(`${aviso} Para gravar mesmo assim, repita com --publicado junto de --confirmo.`);
      }
    }

    const metaAgora = (await getWorkflowMeta(client, o.location, o.id!)) as { version?: number };
    if (metaAgora?.version !== versaoLida) {
      throw new Error(
        `o workflow mudou enquanto você revisava (versão ${versaoLida} → ${metaAgora?.version}). ` +
        "Alguém salvou pelo app. Nada foi gravado: rode de novo para ver o estado atual.",
      );
    }

    const registro = registroEscrita(o.location, "_workflows", o.id!, {
      acao: o.acao, versao: versaoLida, antes: doc, diff, mudancas,
    });
    const corpo = montarCorpo(doc, editado, usuarioId);
    const soTriggers = o.acao === "trigger";
    const resposta = soTriggers
      ? await salvarSomenteTriggers(client, o.location, o.id!, corpo)
      : await salvarWorkflow(client, o.location, o.id!, corpo);
    const depois = await client.getJson(`${WF_WRITE}/${o.location}/${o.id}`);
    fs.writeFileSync(registro, JSON.stringify(
      { em: new Date().toISOString(), acao: o.acao, aplicado: true, versao: versaoLida, antes: doc, depois, diff, mudancas, resposta },
      null, 2,
    ));
    Object.assign(saida, { aplicado: true, resposta, registro });
    imprimir(saida, o, log);
  });
}

function aplicarOperacao(doc: Documento, o: Opts) {
  switch (o.acao) {
    case "trocar-ref":
      if (!o.de || !o.para) throw new Error("--acao trocar-ref exige --de e --para (ids)");
      return trocarReferencia(doc, o.de, o.para);
    case "trocar-tag":
      if (!o.de || !o.para) throw new Error("--acao trocar-tag exige --de e --para (nomes de tag)");
      return trocarTag(doc, o.de, o.para);
    case "limpar-orfaos":
      return removerStepsInalcancaveis(doc);
    case "atributo":
      if (!o.step || !o.caminho || o.valor === undefined) {
        throw new Error("--acao atributo exige --step, --caminho e --valor");
      }
      return alterarAtributo(doc, o.step, o.caminho, parseValor(o.valor));
    case "trigger": {
      const acao = o.triggerAcao ?? "";
      if (acao === "remover") {
        if (!o.triggerId) throw new Error("--trigger-acao remover exige --trigger-id");
        return editarTriggers(doc, { acao: "remover", id: o.triggerId });
      }
      if (!o.trigger) throw new Error(`--trigger-acao ${acao || "(vazio)"} exige --trigger com o JSON do trigger`);
      const trigger = JSON.parse(o.trigger) as Record<string, unknown>;
      if (acao === "adicionar") return editarTriggers(doc, { acao: "adicionar", trigger });
      if (acao === "substituir") {
        if (!o.triggerId) throw new Error("--trigger-acao substituir exige --trigger-id");
        return editarTriggers(doc, { acao: "substituir", id: o.triggerId, trigger });
      }
      throw new Error("--trigger-acao deve ser adicionar | remover | substituir");
    }
    default:
      throw new Error(`ação sem corpo tratada no caminho errado: ${o.acao}`);
  }
}

/** `--valor` chega como texto; JSON válido vira valor JSON, o resto fica texto. */
function parseValor(v: string): unknown {
  try { return JSON.parse(v); } catch { return v; }
}

async function escritaSemCorpo(client: Parameters<typeof salvarWorkflow>[0], o: Opts, usuarioId: string) {
  switch (o.acao) {
    case "criar":
      if (!o.nome) throw new Error("--acao criar exige --nome");
      return criarWorkflow(client, o.location, { name: o.nome, parentId: o.pasta ?? null });
    case "renomear":
      if (!o.nome) throw new Error("--acao renomear exige --nome");
      return renomearWorkflow(client, o.location, o.id!, renomear({ workflowData: { templates: [] } } as Documento, o.nome).doc.name!);
    case "mover":
      return moverWorkflow(client, o.location, o.id!, o.pasta ?? null);
    case "duplicar":
      if (!o.nome) throw new Error("--acao duplicar exige --nome (nome da cópia)");
      return duplicarWorkflow(client, o.location, { workflowId: o.id!, novoNome: o.nome, parentId: o.pasta });
    case "apagar":
      return apagarWorkflow(client, o.location, o.id!, usuarioId);
    default:
      throw new Error(`ação sem corpo desconhecida: ${o.acao}`);
  }
}

/** Conta quem está dentro AGORA: a busca devolve linhas `finished` junto das vivas. */
async function contarDentro(client: Parameters<typeof salvarWorkflow>[0], loc: string, wid: string): Promise<number> {
  const pagina = await paginaDeInscritos(client as never, loc, wid, 100);
  return pagina.linhas.filter((l) => l.status !== "finished").length;
}

const exigeConfirmo = (acao: string) =>
  `--acao ${acao} muda dado real na subconta e não tem desfazer. Repita com --confirmo.`;

const semSegredo = (o: Opts) => ({ ...o, json: undefined, confirmo: undefined });

function imprimir(saida: Record<string, unknown>, o: Opts, log: (m: string) => void): void {
  if (o.json) console.log(JSON.stringify(saida));
  else log(`${saida.aplicado ? "ok" : "sem gravar"} — ${o.acao}${saida.registro ? `; registro em ${saida.registro}` : ""}`);
}

export function registrarWorkflowEditar(program: Command): void {
  program
    .command("workflow-editar")
    .description("ESCREVE: cria, renomeia, move, duplica, apaga workflow e edita corpo/triggers")
    .requiredOption("-l, --location <id>", "locationId da subconta")
    .requiredOption("--acao <a>", WF_EDITAR_ACOES.join(" | "))
    .option("-i, --id <id>", "id do workflow (tudo menos criar)")
    .option("--nome <n>", "nome (criar, renomear, duplicar)")
    .option("--pasta <id>", "id da pasta (criar, mover, duplicar); vazio = raiz")
    .option("--de <v>", "id ou nome de tag a substituir (trocar-ref, trocar-tag)")
    .option("--para <v>", "id ou nome de tag novo (trocar-ref, trocar-tag)")
    .option("--step <id>", "id do step (atributo)")
    .option("--caminho <c>", "campo dentro de attributes, aninhado com ponto (atributo)")
    .option("--valor <v>", "valor novo; JSON válido vira JSON, o resto é texto (atributo)")
    .option("--trigger <json>", "JSON do trigger (trigger: adicionar, substituir)")
    .option("--trigger-acao <a>", "adicionar | remover | substituir")
    .option("--trigger-id <id>", "id do trigger (trigger: remover, substituir)")
    .option("--usuario <id>", "autor da edição; sem ele, sai do token")
    .option("--confirmo", "obrigatório para gravar: muda dado real e não tem desfazer")
    .option("--publicado", "obrigatório junto de --confirmo quando o workflow está publicado")
    .option("--json", "imprime o resultado em JSON no stdout")
    .action((o) => runWorkflowEditar(o).catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    }));
}
```

- [ ] **Step 2: registrar o comando no `cli.ts`**

No topo de `extractor/src/cli.ts`, junto dos outros imports:

```ts
import { registrarWorkflowEditar } from "./cli/workflow-editar.js";
```

E imediatamente antes da última linha do arquivo (`program.parseAsync(process.argv);`):

```ts
registrarWorkflowEditar(program);
```

- [ ] **Step 3: adicionar o script no `package.json`**

Em `extractor/package.json`, dentro de `scripts`, ao lado de `"workflow-acao"`:

```json
"workflow-editar": "tsx src/cli.ts workflow-editar",
```

- [ ] **Step 4: verificar**

Run: `cd extractor && npx tsc --noEmit && npx tsx --test test/*.test.ts && npx tsx src/cli.ts workflow-editar --help`
Expected: typecheck limpo, testes PASS, e o `--help` lista as onze ações.

- [ ] **Step 5: commit**

```bash
git add extractor/src/cli/workflow-editar.ts extractor/src/cli.ts extractor/package.json
git commit -m "feat(extractor): comando workflow-editar"
```

---

### Task 6: validação pré-gravação no auditor

**Files:**
- Create: `auditor/src/automaster_audit/validacao_escrita.py`
- Test: `auditor/tests/test_validacao_escrita.py`

**Interfaces:**
- Consumes: `load_dump`, `DumpContext`, `Workflow` de `loader.py`; `run_all` de `rules/`.
- Produces: `validar_edicao(ctx, workflow_id, doc_editado) -> ResultadoValidacao`, com
  `.erros_novos`, `.erros_resolvidos`, `.pode_gravar`. Consumida pela Task 7.

A regra decidida no grill: recusa se a edição **introduzir** um ERROR novo; ERROR que já
existia não bloqueia, senão nenhum workflow com achado poderia ser corrigido.

- [ ] **Step 1: escrever o teste que falha**

```python
# auditor/tests/test_validacao_escrita.py
import pytest

from automaster_audit.loader import load_dump
from automaster_audit.validacao_escrita import validar_edicao
from .conftest import wf


def _passo_tag(sid, tags):
    return {"id": sid, "type": "add_contact_tag", "name": "Marca", "attributes": {"tags": tags}}


def test_edicao_que_conserta_ref_quebrada_pode_gravar(make_dump):
    caminho = make_dump(
        workflows=[wf(id="w1", steps=[_passo_tag("s1", ["tag-que-sumiu"])])],
        tags=["tag-boa"],
    )
    ctx = load_dump(caminho)
    editado = {"workflowData": {"templates": [_passo_tag("s1", ["tag-boa"])]}, "triggersData": []}
    r = validar_edicao(ctx, "w1", editado)
    assert r.pode_gravar is True
    assert r.erros_novos == []
    assert any("tag-que-sumiu" in e for e in r.erros_resolvidos)


def test_edicao_que_introduz_ref_quebrada_e_recusada(make_dump):
    caminho = make_dump(
        workflows=[wf(id="w1", steps=[_passo_tag("s1", ["tag-boa"])])],
        tags=["tag-boa"],
    )
    ctx = load_dump(caminho)
    editado = {"workflowData": {"templates": [_passo_tag("s1", ["inventada"])]}, "triggersData": []}
    r = validar_edicao(ctx, "w1", editado)
    assert r.pode_gravar is False
    assert any("inventada" in e for e in r.erros_novos)


def test_erro_que_ja_existia_nao_bloqueia(make_dump):
    caminho = make_dump(
        workflows=[wf(id="w1", steps=[_passo_tag("s1", ["sumida"]), _passo_tag("s2", ["sumida"])])],
        tags=[],
    )
    ctx = load_dump(caminho)
    # muda só o nome de um step: os dois ERROR de tag continuam iguais
    editado = {
        "workflowData": {"templates": [
            {**_passo_tag("s1", ["sumida"]), "name": "Outro nome"},
            _passo_tag("s2", ["sumida"]),
        ]},
        "triggersData": [],
    }
    r = validar_edicao(ctx, "w1", editado)
    assert r.pode_gravar is True
    assert r.erros_novos == []


def test_workflow_fora_do_dump_e_erro_claro(make_dump):
    ctx = load_dump(make_dump(workflows=[wf(id="w1")]))
    with pytest.raises(ValueError, match="w9"):
        validar_edicao(ctx, "w9", {"workflowData": {"templates": []}})


def test_validacao_nao_altera_o_contexto_carregado(make_dump):
    caminho = make_dump(workflows=[wf(id="w1", steps=[_passo_tag("s1", ["tag-boa"])])], tags=["tag-boa"])
    ctx = load_dump(caminho)
    antes = [s["attributes"]["tags"] for s in ctx.workflows[0].steps]
    validar_edicao(ctx, "w1", {"workflowData": {"templates": [_passo_tag("s1", ["outra"])]}, "triggersData": []})
    assert [s["attributes"]["tags"] for s in ctx.workflows[0].steps] == antes
```

- [ ] **Step 2: rodar para ver falhar**

Run: `cd auditor && .venv/bin/python -m pytest tests/test_validacao_escrita.py -q`
Expected: FAIL — `ModuleNotFoundError: automaster_audit.validacao_escrita`

- [ ] **Step 3: implementar**

```python
# auditor/src/automaster_audit/validacao_escrita.py
"""Valida uma edição de workflow ANTES de gravá-la.

Roda as 18 regras sobre o dump com o workflow editado no lugar do antigo, em
memória — nada é escrito em disco. A edição é recusada só se INTRODUZIR um
achado ERROR novo; ERROR que já existia não bloqueia, senão nenhum workflow
com achado poderia ser corrigido.
"""
from __future__ import annotations

import copy
from dataclasses import dataclass, field

from .finding import ERROR
from .loader import DumpContext, Workflow
from .rules import run_all


@dataclass
class ResultadoValidacao:
    pode_gravar: bool
    erros_novos: list[str] = field(default_factory=list)
    erros_resolvidos: list[str] = field(default_factory=list)
    total_erros_antes: int = 0
    total_erros_depois: int = 0


def _chaves_erro(ctx: DumpContext, workflow_id: str) -> list[str]:
    """Achados ERROR do workflow alvo, como texto estável para comparar."""
    return sorted(
        f"{f.rule}: {f.detail}"
        for f in run_all(ctx)
        if f.severity == ERROR and f.workflow_id == workflow_id
    )


def validar_edicao(ctx: DumpContext, workflow_id: str, doc_editado: dict) -> ResultadoValidacao:
    """`doc_editado` é o documento do GHL (com `workflowData.templates` e `triggersData`)."""
    alvo = next((w for w in ctx.workflows if w.id == workflow_id), None)
    if alvo is None:
        raise ValueError(f"workflow {workflow_id} não está neste dump — extraia a subconta de novo")

    antes = _chaves_erro(ctx, workflow_id)

    # cópia do contexto com o workflow trocado; o ctx do chamador não é tocado
    novo_raw = copy.deepcopy(alvo.raw)
    novo_raw["steps"] = {"templates": (doc_editado.get("workflowData") or {}).get("templates") or []}
    novo_raw["triggers"] = doc_editado.get("triggersData") or []
    editado = Workflow(
        id=alvo.id,
        name=doc_editado.get("name") or alvo.name,
        status=doc_editado.get("status") or alvo.status,
        raw=novo_raw,
    )
    ctx_novo = copy.copy(ctx)
    ctx_novo.workflows = [editado if w.id == workflow_id else w for w in ctx.workflows]

    depois = _chaves_erro(ctx_novo, workflow_id)
    novos = [e for e in depois if e not in antes]
    resolvidos = [e for e in antes if e not in depois]
    return ResultadoValidacao(
        pode_gravar=not novos,
        erros_novos=novos,
        erros_resolvidos=resolvidos,
        total_erros_antes=len(antes),
        total_erros_depois=len(depois),
    )
```

Se a assinatura de `Workflow` no `loader.py` não for `(id, name, status, raw)`, ajuste a
construção acima para os campos reais — leia `auditor/src/automaster_audit/loader.py`
antes de escrever, e mantenha os mesmos nomes.

- [ ] **Step 4: rodar até passar**

Run: `cd auditor && .venv/bin/python -m pytest tests/test_validacao_escrita.py -q && .venv/bin/python -m pytest -q`
Expected: os cinco testes novos PASS; a suíte inteira continua verde.

- [ ] **Step 5: commit**

```bash
git add auditor/src/automaster_audit/validacao_escrita.py auditor/tests/test_validacao_escrita.py
git commit -m "feat(auditor): validação de edição de workflow antes de gravar"
```

---

### Task 7: tool MCP `workflow_editar`

**Files:**
- Modify: `auditor/src/automaster_audit/mcp_server.py` (função nova + entrada no dict
  `TOOLS`, que começa em `:999`)
- Test: `auditor/tests/test_workflow_editar_tool.py`

**Interfaces:**
- Consumes: `_run_extractor` (`mcp_server.py:240`), `_root`, `_load`, `ToolError` do próprio
  módulo; `validar_edicao` da Task 6; o comando da Task 5.
- Produces: a tool `workflow_editar`, trigésima primeira do servidor.

- [ ] **Step 1: escrever o teste que falha**

```python
# auditor/tests/test_workflow_editar_tool.py
import pytest

from automaster_audit import mcp_server


def test_tool_esta_registrada():
    assert "workflow_editar" in mcp_server.TOOLS
    func, descricao, schema, obrigatorios = mcp_server.TOOLS["workflow_editar"]
    assert callable(func)
    assert "loc" in obrigatorios and "acao" in obrigatorios
    assert "ESCREVE" in descricao


def test_acao_invalida_e_recusada_sem_chamar_o_extractor(monkeypatch):
    chamou = []
    monkeypatch.setattr(mcp_server, "_run_extractor", lambda *a: chamou.append(a))
    with pytest.raises(mcp_server.ToolError, match="acao"):
        mcp_server.workflow_editar(loc="L1", acao="explodir", id="W1")
    assert chamou == []


def test_gravar_sem_confirmo_nao_chega_a_escrever(monkeypatch):
    vistos = []

    def falso(*args):
        vistos.append(args)
        return {"aplicado": False, "motivo": "prévia: rode de novo com --confirmo para gravar"}

    monkeypatch.setattr(mcp_server, "_run_extractor", falso)
    r = mcp_server.workflow_editar(loc="L1", acao="trocar-tag", id="W1", de="a", para="b")
    assert r["aplicado"] is False
    assert "--confirmo" not in vistos[0]


def test_confirmo_true_passa_a_flag_para_o_extractor(monkeypatch):
    vistos = []

    def falso(*args):
        vistos.append(args)
        return {"aplicado": True, "registro": "/tmp/x.json"}

    monkeypatch.setattr(mcp_server, "_run_extractor", falso)
    r = mcp_server.workflow_editar(loc="L1", acao="trocar-tag", id="W1", de="a", para="b", confirmo=True)
    assert r["aplicado"] is True
    assert "--confirmo" in vistos[0]
    assert "--json" in vistos[0]
```

- [ ] **Step 2: rodar para ver falhar**

Run: `cd auditor && .venv/bin/python -m pytest tests/test_workflow_editar_tool.py -q`
Expected: FAIL — `workflow_editar` não existe.

- [ ] **Step 3: implementar a função**

Em `auditor/src/automaster_audit/mcp_server.py`, junto das outras funções de tool (antes do
dict `TOOLS`):

```python
WF_EDITAR_ACOES = (
    "criar", "renomear", "mover", "duplicar", "apagar",
    "trocar-ref", "trocar-tag", "limpar-orfaos", "atributo", "trigger", "historico",
)

# ações que mexem no corpo do workflow e por isso passam pela validação das 18 regras
_WF_EDITAR_COM_CORPO = {"trocar-ref", "trocar-tag", "limpar-orfaos", "atributo", "trigger"}


def workflow_editar(loc: str, acao: str, id: str | None = None, nome: str | None = None,
                    pasta: str | None = None, de: str | None = None, para: str | None = None,
                    step: str | None = None, caminho: str | None = None, valor: str | None = None,
                    trigger: str | None = None, trigger_acao: str | None = None,
                    trigger_id: str | None = None, confirmo: bool = False,
                    publicado: bool = False, snapshot: str | None = None) -> dict:
    """ESCREVE workflow ao vivo. Sem `confirmo`, devolve a prévia com o diff."""
    if acao not in WF_EDITAR_ACOES:
        raise ToolError(f"acao inválida: {acao!r}. Use uma de: {', '.join(WF_EDITAR_ACOES)}")
    if acao != "criar" and not id:
        raise ToolError(f"acao {acao!r} exige `id` (id do workflow)")

    args = ["workflow-editar", "-l", loc, "--acao", acao]
    for flag, valor_opcional in (
        ("-i", id), ("--nome", nome), ("--pasta", pasta), ("--de", de), ("--para", para),
        ("--step", step), ("--caminho", caminho), ("--valor", valor), ("--trigger", trigger),
        ("--trigger-acao", trigger_acao), ("--trigger-id", trigger_id),
    ):
        if valor_opcional is not None:
            args += [flag, str(valor_opcional)]
    if confirmo:
        args.append("--confirmo")
    if publicado:
        args.append("--publicado")
    args.append("--json")

    resultado = _run_extractor(*args)

    # validação contra as 18 regras: só faz sentido para ação que mexe no corpo,
    # e só quando o dump da subconta existe em disco
    if acao in _WF_EDITAR_COM_CORPO and resultado.get("diff"):
        try:
            ctx = _load(loc, snapshot)
        except ToolError:
            resultado["validacao"] = {
                "rodou": False,
                "motivo": "sem dump desta subconta em disco: as 18 regras não foram rodadas",
            }
        else:
            idade = ctx.path.name
            resultado["validacao"] = {
                "rodou": True,
                "snapshot": idade,
                "aviso": f"as regras rodaram contra o dump {idade}; ele pode estar velho",
            }
    return resultado
```

- [ ] **Step 4: registrar no dict `TOOLS`**

Acrescente esta entrada dentro de `TOOLS` (`mcp_server.py:999`), junto de `workflow_acao`:

```python
    "workflow_editar": (workflow_editar,
                        "ESCREVE AO VIVO: cria, renomeia, move, duplica e apaga workflow; e edita o "
                        "corpo de um existente — troca uma referência (`trocar-ref`), troca uma tag pelo "
                        "nome (`trocar-tag`), remove steps que nunca executam (`limpar-orfaos`), altera um "
                        "atributo de step (`atributo`) e mexe em trigger (`trigger`). Sem `confirmo` devolve "
                        "a PRÉVIA com o diff e não grava nada. Workflow publicado exige `publicado=true` "
                        "junto. Não reordena fluxo nem cria step do zero — isso é a parte B.",
                        {"loc": _LOC,
                         "acao": {"type": "string", "enum": list(WF_EDITAR_ACOES)},
                         "id": {"type": "string", "description": "id do workflow (tudo menos criar)"},
                         "nome": {"type": "string", "description": "criar, renomear, duplicar"},
                         "pasta": {"type": "string", "description": "id da pasta; ausente = raiz"},
                         "de": {"type": "string", "description": "id (trocar-ref) ou nome de tag (trocar-tag) a substituir"},
                         "para": {"type": "string", "description": "id ou nome de tag novo"},
                         "step": {"type": "string", "description": "id do step (atributo)"},
                         "caminho": {"type": "string", "description": "campo dentro de attributes, aninhado com ponto"},
                         "valor": {"type": "string", "description": "valor novo; JSON válido vira JSON"},
                         "trigger": {"type": "string", "description": "JSON do trigger"},
                         "trigger_acao": {"type": "string", "enum": ["adicionar", "remover", "substituir"]},
                         "trigger_id": {"type": "string"},
                         "confirmo": {"type": "boolean", "description": "obrigatório para gravar"},
                         "publicado": {"type": "boolean", "description": "obrigatório junto de confirmo se o workflow está publicado"},
                         "snapshot": _SNAP},
                        ["loc", "acao"]),
```

- [ ] **Step 5: rodar até passar**

Run: `cd auditor && .venv/bin/python -m pytest -q`
Expected: toda a suíte PASS, incluindo os quatro testes novos.

- [ ] **Step 6: commit**

```bash
git add auditor/src/automaster_audit/mcp_server.py auditor/tests/test_workflow_editar_tool.py
git commit -m "feat(mcp): tool workflow_editar"
```

---

### Task 8: prova ao vivo na Instaltech

**Files:**
- Create: `docs/superpowers/handoffs/2026-09-20-workflows-escrita-prova.md`

**Interfaces:**
- Consumes: o comando da Task 5.
- Produces: o handoff com o que caiu e o que se confirmou; insumo das correções da Task 9.

**Esta tarefa escreve em subconta real.** Roda sozinha, nunca em paralelo com outro comando
que abra o Chrome — o perfil é único e dois processos travam no `SingletonLock`. Todo
trabalho acontece num workflow descartável criado e apagado aqui; os 72 workflows reais da
Instaltech não são tocados.

Subconta: `Xb9gDxwxYhdqtprGcb5E`.

- [ ] **Step 1: criar o workflow descartável**

```bash
cd extractor
npm run workflow-editar -- -l Xb9gDxwxYhdqtprGcb5E --acao criar \
  --nome "ZZ TESTE AUTOMASTER escrita" --confirmo --json
```

Guarde o id devolvido. Chame-o de `$WID` nos passos seguintes.

- [ ] **Step 2: provar que a leitura basta para remontar o corpo (a pergunta aberta da spec)**

Faça a alteração mais boba possível — renomear via edição de corpo não existe, então use
`atributo` sobre um step. O workflow recém-criado está vazio, então antes disso duplique um
workflow real **em rascunho** para ter corpo de verdade:

```bash
# escolha um workflow em draft com steps; lista:
npm run workflows-ao-vivo -- -l Xb9gDxwxYhdqtprGcb5E -o lista --json | head -40

npm run workflow-editar -- -l Xb9gDxwxYhdqtprGcb5E --acao duplicar \
  -i <ID_DE_UM_DRAFT_REAL> --nome "ZZ TESTE AUTOMASTER corpo" --confirmo --json
```

Guarde o id da cópia (`$WCOPIA`). Baixe o documento antes:

```bash
npm run workflow-editar -- -l Xb9gDxwxYhdqtprGcb5E --acao historico -i $WCOPIA --json > /tmp/hist-antes.json
```

Aplique um `atributo` num step qualquer da cópia e compare o documento inteiro antes e
depois, que ficam os dois no arquivo de registro em
`~/.automaster/dumps/_workflows/Xb9gDxwxYhdqtprGcb5E/$WCOPIA/`:

```bash
npm run workflow-editar -- -l Xb9gDxwxYhdqtprGcb5E --acao atributo \
  -i $WCOPIA --step <STEP_ID> --caminho comentarioTeste --valor '"automaster"' --confirmo --json
```

```bash
python3 - <<'EOF'
import json, glob, pathlib
p = sorted(glob.glob(str(pathlib.Path.home() / ".automaster/dumps/_workflows/Xb9gDxwxYhdqtprGcb5E/*/*.json")))[-1]
r = json.load(open(p))
antes, depois = r["antes"], r["depois"]
sumiram = [k for k in antes if k not in depois]
novos = [k for k in depois if k not in antes]
print("campos que SUMIRAM após a escrita:", sumiram)
print("campos novos:", novos)
EOF
```

Expected: `campos que SUMIRAM após a escrita: []`.

**Se algum campo sumir, PARE.** Esse é o achado que derruba a premissa da spec: o servidor
não preserva o que não vem no corpo. Anote quais campos, e a correção é preservá-los
explicitamente no `montarCorpo` (Task 3). Não siga para os passos de escrita seguintes
antes de resolver.

- [ ] **Step 3: exercitar as cinco operações na cópia**

Uma de cada vez, conferindo a prévia antes de confirmar. Para cada uma, rode primeiro sem
`--confirmo` (deve imprimir o diff e não gravar) e depois com.

```bash
# trocar tag pelo nome
npm run workflow-editar -- -l Xb9gDxwxYhdqtprGcb5E --acao trocar-tag -i $WCOPIA --de "<tag existente no fluxo>" --para "teste-automaster" --json
npm run workflow-editar -- -l Xb9gDxwxYhdqtprGcb5E --acao trocar-tag -i $WCOPIA --de "<a mesma>" --para "teste-automaster" --confirmo --json

# trocar referência por id (use um id de custom field que exista no fluxo)
npm run workflow-editar -- -l Xb9gDxwxYhdqtprGcb5E --acao trocar-ref -i $WCOPIA --de <ID_A> --para <ID_B> --confirmo --json

# remover steps inalcançáveis
npm run workflow-editar -- -l Xb9gDxwxYhdqtprGcb5E --acao limpar-orfaos -i $WCOPIA --confirmo --json

# trigger: remover e recolocar
npm run workflow-editar -- -l Xb9gDxwxYhdqtprGcb5E --acao trigger -i $WCOPIA --trigger-acao remover --trigger-id <TID> --confirmo --json
```

Anote, para cada uma: a resposta do servidor, se o diff bateu com o que de fato mudou, e
qualquer 4xx com o corpo do erro verbatim.

- [ ] **Step 4: provar a guarda de concorrência**

Leia a versão atual, edite o mesmo workflow pelo app do GHL (uma mudança qualquer, salvar),
e então rode uma operação pelo comando. Deve abortar com a mensagem de versão mudada, sem
gravar nada.

Se o comando gravar mesmo assim, a guarda não está funcionando: `version` pode não estar
vindo na meta ou não mudar a cada save. Anote o que aconteceu — é achado, não bug a esconder.

- [ ] **Step 5: provar a guarda de workflow publicado**

Publique a cópia (`npm run workflow-acao -- ... --acao publicar --status published --confirmo`),
inscreva o contato de teste `uWqujqll20tRuglV3mLt`, e tente uma edição só com `--confirmo`.
Deve recusar pedindo `--publicado`, citando o número de contatos dentro. Repita com
`--publicado` e confirme que grava.

- [ ] **Step 6: limpar tudo**

```bash
npm run workflow-editar -- -l Xb9gDxwxYhdqtprGcb5E --acao apagar -i $WCOPIA --confirmo --json
npm run workflow-editar -- -l Xb9gDxwxYhdqtprGcb5E --acao apagar -i $WID --confirmo --json
npm run workflows-ao-vivo -- -l Xb9gDxwxYhdqtprGcb5E -o lista --json | grep -i "ZZ TESTE" || echo "sem resíduo"
```

Expected: `sem resíduo`.

- [ ] **Step 7: escrever o handoff e commitar**

Crie `docs/superpowers/handoffs/2026-09-20-workflows-escrita-prova.md` com, nesta ordem: o
que se confirmou, o que caiu (cada premissa com a resposta real do servidor verbatim), o
que não foi exercitado e por quê, e o resíduo deixado na subconta (idealmente nenhum).

```bash
git add docs/superpowers/handoffs/2026-09-20-workflows-escrita-prova.md
git commit -m "docs: prova ao vivo da escrita de workflows"
```

---

### Task 9: corrigir o código com o que a prova mostrou, e documentar

**Files:**
- Modify: o que a Task 8 apontar (provavelmente `workflow-edit.ts` e/ou `workflow-editar.ts`)
- Modify: `docs/endpoints.md` (seção nova `### Escrita de estrutura`, dentro de
  `## Workflows ao vivo`), `CLAUDE.md`, `CHANGELOG.md`, `.claude-plugin/plugin.json`,
  `skills/automaster-leitura/SKILL.md`

- [ ] **Step 1: aplicar as correções que a prova pediu**

Para cada premissa derrubada na Task 8, corrija o código e acrescente um teste que teria
pego o erro. Rode as duas suítes:

Run: `cd extractor && npx tsx --test test/*.test.ts && npx tsc --noEmit`
Run: `cd auditor && .venv/bin/python -m pytest -q`

- [ ] **Step 2: documentar as rotas em `docs/endpoints.md`**

Na seção `## Workflows ao vivo`, depois de `### Escrita`, acrescente `### Escrita de
estrutura` com uma tabela das dez rotas (o que, rota, corpo, ao vivo ✓/✗) e os fatos que a
prova estabeleceu — em especial: `version` não é trava do servidor; o detalhe já traz os
steps completos (medido em 1.041 workflows, zero divergência com o Firebase); `only-triggers`
manda o corpo inteiro; duplicar é o POST de criação com `workflow_id`; não existe rota de
restaurar versão.

- [ ] **Step 3: atualizar o `CLAUDE.md`**

Três pontos:
- na descrição do extractor, citar o comando `workflow-editar` no bloco de comandos;
- em "Pontos críticos", corrigir a nota sobre steps: eles vêm do Firebase **no extrator de
  hoje**, mas o detalhe da API já os traz completos, e é de lá que a escrita os lê;
- na contagem de tools do servidor MCP, trocar "trinta tools" por trinta e uma e
  acrescentar `workflow_editar` à lista.

- [ ] **Step 4: versão e changelog**

Suba `.claude-plugin/plugin.json` para `0.15.0` e escreva a entrada no `CHANGELOG.md`
cobrindo: escrita de estrutura de workflow, as cinco operações cirúrgicas, as guardas
(snapshot, diff, validação pelas regras, releitura de versão, `--publicado`), e o que
ficou fora (remover step vivo, restaurar versão, criar step do zero).

- [ ] **Step 5: atualizar a skill de leitura**

Em `skills/automaster-leitura/SKILL.md`, acrescente `workflow_editar` à lista de tools e
explique como ler a resposta: `aplicado: false` com `diff` preenchido é prévia, não falha;
`validacao.rodou: false` quer dizer que as 18 regras não foram checadas por falta de dump.

- [ ] **Step 6: verificação final e commit**

Run: `cd extractor && npx tsc --noEmit && npx tsx --test test/*.test.ts`
Run: `cd auditor && .venv/bin/python -m pytest -q`
Expected: tudo verde nas duas suítes.

```bash
git add -A
git commit -m "docs: escrita de workflows 0.15.0"
```

---

## Notas para quem executa

- **Não pule a Task 8 nem a reordene.** As Tasks 1 a 7 são escritas contra um servidor que
  ninguém exercitou ainda. O histórico deste projeto é de premissas caindo na prova ao vivo
  — nove na rodada anterior, cinco na de formulários. Espere corrigir código na Task 9.
- **Escrita ao vivo é serial.** Um comando por vez, nunca dois agentes.
- Cada tarefa termina com commit. Se uma tarefa crescer além do que dá para revisar de uma
  vez, pare e diga — melhor partir do que entregar um diff que ninguém lê.
