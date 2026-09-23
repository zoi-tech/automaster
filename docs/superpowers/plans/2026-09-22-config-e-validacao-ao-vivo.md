# Configuração do workflow e validação ao vivo — plano

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ligar a reentrada de um workflow pelas tools e fazer as 18 regras validarem workflow recém-criado e entidade criada depois da extração.

**Architecture:** o extractor ganha a ação `configuracao` no caminho de corpo já existente, e a prévia das ações de corpo passa a devolver o documento de antes e as listas de entidades lidas ao vivo. O auditor sobrepõe essas listas ao dump e valida o workflow mesmo quando ele não está no dump, montando-o a partir do documento.

**Tech Stack:** TypeScript (tsx, node:test) no extractor; Python 3.12 (pytest, ruff) no auditor.

**Spec:** `docs/superpowers/specs/2026-09-22-config-e-validacao-ao-vivo-design.md`

## Global Constraints

- Única chave de configuração aceita: `allowMultiple`, booleana. A lista é uma constante (`CONFIG_CAMPOS`), chave nova entra quando for provada ao vivo.
- `configuracao` não passa pelas 18 regras e a resposta da tool NÃO traz a chave `validacao`.
- O documento do workflow (antes ou depois) e as entidades nunca voltam na resposta da tool MCP: são removidos antes de devolver, nos dois caminhos (com e sem validação).
- A sobreposição de entidades troca atributos do contexto por atribuição, nunca muta: `validar_edicao` usa `copy.copy`.
- As três versões andam juntas (`.claude-plugin/plugin.json`, `extractor/package.json`, `auditor/pyproject.toml`) com seção no `CHANGELOG.md`; `auditor/tests/test_versoes.py` falha se divergirem.
- Saída `--json` da CLI é envelope `{ok, data}` via `emitir`; não usar `console.log(JSON.stringify(...))`.
- Rodar, antes de cada commit: extractor `npm run typecheck && npm run lint && npm test`; auditor `.venv/bin/ruff check src tests && .venv/bin/ruff format --check src tests && .venv/bin/python -m pytest -q`.

## Review Focus

1. Rota de entidade que falha na prévia (ex.: 403 em usuários): a prévia não pode cair, e a validação usa o dump só para aquela lista, dizendo qual. Coberto na Task 4 e na Task 7.
2. Gatilho de tag REMOVIDA num workflow sem reentrada: não deve gerar aviso. Coberto na Task 3.
3. Workflow novo cuja edição introduz ERROR (tag inexistente mesmo ao vivo): deve ser recusado, não passar em silêncio. Coberto na Task 6.
4. Workflow no dump mas com tag criada depois da extração: a edição que a cita passa. Coberto na Task 5 e Task 6.
5. `configuracao` num workflow sem step: recusa com mensagem que orienta criar o primeiro step. Coberto na Task 2.

---

### Task 1: edição pura `configurarWorkflow` e diff de configuração

**Files:**
- Modify: `extractor/src/api/workflow-edit/documento.ts` (depois de `renomear`, ~linha 160)
- Modify: `extractor/src/api/workflow-edit/tipos.ts` (interface `DiffWorkflow`)
- Modify: `extractor/src/api/workflow-edit/guardas.ts:40-71` (`diffWorkflow`)
- Test: `extractor/test/workflow-edit.test.ts`

**Interfaces:**
- Produces: `CONFIG_CAMPOS: readonly ["allowMultiple"]`; `configurarWorkflow(doc: Documento, campo: string, valor: unknown): Resultado`; `DiffWorkflow.configuracao?: Record<string, { antes: unknown; depois: unknown }>` (e `vazio` passa a considerá-la).

- [ ] **Step 1: testes que falham** (acrescentar ao fim de `extractor/test/workflow-edit.test.ts`; importar `configurarWorkflow`, `CONFIG_CAMPOS` e `conferirEscrita` junto dos demais)

```ts
test("configurarWorkflow liga a reentrada sem mexer em step", () => {
  const d = { ...doc([{ id: "s1", type: "sms" }]), allowMultiple: false } as Documento;
  const r = configurarWorkflow(d, "allowMultiple", true);
  assert.equal(r.doc.allowMultiple, true);
  assert.deepEqual(r.mudancas, ["allowMultiple: false → true"]);
  assert.equal(d.allowMultiple, false, "não muta o original");
  assert.deepEqual(r.doc.workflowData, d.workflowData);
});

test("configurarWorkflow com o valor atual não muda nada", () => {
  const d = { ...doc([{ id: "s1", type: "sms" }]), allowMultiple: true } as Documento;
  assert.deepEqual(configurarWorkflow(d, "allowMultiple", true).mudancas, []);
});

test("configurarWorkflow recusa chave fora da lista e valor não booleano", () => {
  const d = doc([{ id: "s1", type: "sms" }]);
  assert.throws(() => configurarWorkflow(d, "stopOnResponse", true), /allowMultiple/);
  assert.throws(() => configurarWorkflow(d, "allowMultiple", "sim"), /true ou false/);
  assert.deepEqual([...CONFIG_CAMPOS], ["allowMultiple"]);
});

test("diffWorkflow enxerga configuração e a conferência pega save que não pegou", () => {
  const antes = { ...doc([{ id: "s1", type: "sms" }]), allowMultiple: false } as Documento;
  const pedido = configurarWorkflow(antes, "allowMultiple", true).doc;
  const diff = diffWorkflow(antes, pedido);
  assert.deepEqual(diff.configuracao, { allowMultiple: { antes: false, depois: true } });
  assert.equal(diff.vazio, false);
  assert.equal(conferirEscrita(pedido, antes).ok, false, "relido sem a mudança é duvidoso");
  assert.equal(conferirEscrita(pedido, pedido).ok, true);
});
```

- [ ] **Step 2: rodar e ver falhar**

Run: `cd extractor && npx tsx --test test/workflow-edit.test.ts`
Expected: FAIL, `configurarWorkflow` não exportado.

- [ ] **Step 3: implementação**

Em `documento.ts`, depois de `renomear`:

```ts
/**
 * Configurações gerais do workflow que a ação `configuracao` altera. Só entra chave com
 * prova ao vivo de que sobrevive ao save: `allowMultiple` (reentrada), provada na Cliente A
 * Mulher em 2026-09-22. As outras chaves de raiz do documento ficam de fora até serem provadas.
 */
export const CONFIG_CAMPOS = ["allowMultiple"] as const;

export function configurarWorkflow(doc: Documento, campo: string, valor: unknown): Resultado {
  if (!(CONFIG_CAMPOS as readonly string[]).includes(campo)) {
    throw new Error(`--campo ${campo} não é configurável. Use: ${CONFIG_CAMPOS.join(" | ")}`);
  }
  if (typeof valor !== "boolean") throw new Error(`--valor de ${campo} precisa ser true ou false`);
  const out = clonar(doc);
  const antes = out[campo];
  out[campo] = valor;
  return { doc: out, mudancas: antes === valor ? [] : [`${campo}: ${String(antes)} → ${String(valor)}`] };
}
```

Em `tipos.ts`, na interface `DiffWorkflow`, acrescentar:

```ts
  /** Chaves de CONFIG_CAMPOS que mudaram; ausente quando nenhuma mudou. */
  configuracao?: Record<string, { antes: unknown; depois: unknown }>;
```

Em `guardas.ts`, importar `CONFIG_CAMPOS` de `./documento.js` e, em `diffWorkflow`, antes do `vazio`:

```ts
  const mudouConfig = CONFIG_CAMPOS.filter((c) => !igual(antes[c], depois[c]));
  const configuracao = mudouConfig.length
    ? Object.fromEntries(mudouConfig.map((c) => [c, { antes: antes[c], depois: depois[c] }]))
    : undefined;
```

e incluir `!configuracao &&` no cálculo de `vazio` e `configuracao` no objeto devolvido.

Se `documento.ts` já importa de `guardas.ts` (ciclo), mover `CONFIG_CAMPOS` para `tipos.ts` e importar dos dois lados.

- [ ] **Step 4: rodar e ver passar**

Run: `cd extractor && npx tsx --test test/workflow-edit.test.ts`
Expected: PASS

- [ ] **Step 5: commit**

```bash
git add extractor/src/api/workflow-edit extractor/test/workflow-edit.test.ts
git commit -m "feat(extractor): edição pura da configuração do workflow (allowMultiple)"
```

### Task 2: ação `configuracao` na CLI crua

**Files:**
- Modify: `extractor/src/cli/workflow-editar.ts` (`WF_EDITAR_ACOES` linha 20, `Opts` linha 26, `aplicarOperacao` linha 180, opções do commander ~linha 458, mensagem do `checarPublicavel` linha 117)
- Test: `extractor/test/workflow-editar.test.ts`

**Interfaces:**
- Consumes: `configurarWorkflow`, `CONFIG_CAMPOS` (Task 1).
- Produces: `--acao configuracao --campo <c> --valor <v>`; `Opts.campo?: string`.

- [ ] **Step 1: teste que falha** — em `extractor/test/workflow-editar.test.ts`, seguindo o estilo do arquivo:

```ts
import { WF_EDITAR_ACOES } from "../src/cli/workflow-editar.js";

test("configuracao é uma ação da CLI crua", () => {
  assert.ok((WF_EDITAR_ACOES as readonly string[]).includes("configuracao"));
});
```

- [ ] **Step 2: rodar e ver falhar**

Run: `cd extractor && npx tsx --test test/workflow-editar.test.ts`
Expected: FAIL

- [ ] **Step 3: implementação**

1. `WF_EDITAR_ACOES`: acrescentar `"configuracao"` depois de `"historico"`.
2. `Opts`: acrescentar `campo?: string;`.
3. `aplicarOperacao`, novo case:

```ts
    case "configuracao":
      if (!o.campo || o.valor === undefined) throw new Error("--acao configuracao exige --campo e --valor");
      return configurarWorkflow(doc, o.campo, parseValor(o.valor));
```

4. Mensagem do `checarPublicavel` (linha ~118): quando `o.acao === "configuracao"`, trocar o texto por `"o workflow ainda não tem nenhum step, e o app recusa salvar workflow vazio: crie o primeiro step (--acao step-criar) e configure depois"`.
5. Commander: `.option("--campo <c>", "configuração geral do workflow (configuracao): " + CONFIG_CAMPOS.join(" | "))`; o texto de `--valor` passa a citar `configuracao`.

O caminho de corpo (prévia, `--publicado`, guarda de versão, registro, save, releitura, `conferirEscrita`) já cobre o resto: com a Task 1, o diff mostra `configuracao` e a releitura divergente vira `"duvidoso"`.

- [ ] **Step 4: rodar a suíte inteira e o typecheck**

Run: `cd extractor && npm run typecheck && npm run lint && npm test`
Expected: PASS

- [ ] **Step 5: commit**

```bash
git add extractor/src/cli/workflow-editar.ts extractor/test/workflow-editar.test.ts
git commit -m "feat(extractor): workflow-editar --acao configuracao"
```

### Task 3: aviso de reentrada no gatilho de tag adicionada

**Files:**
- Modify: `extractor/src/api/workflow-edit/guardas.ts` (nova função)
- Modify: `extractor/src/cli/workflow-editar.ts:358-431` (`adicionarTrigger`)
- Test: `extractor/test/workflow-edit.test.ts`

**Interfaces:**
- Produces: `avisoReentrada(trigger: Record<string, unknown>, allowMultiple: unknown): string | undefined`.

- [ ] **Step 1: testes que falham**

```ts
test("avisoReentrada só dispara em tag adicionada com reentrada desligada", () => {
  const adicionada = { type: "contact_tag", conditions: [{ field: "tagsAdded", value: "x" }] };
  const removida = { type: "contact_tag", conditions: [{ field: "tagsRemoved", value: "x" }] };
  const qualquer = { type: "contact_tag", conditions: [] };
  assert.match(avisoReentrada(adicionada, false)!, /reentrada desligada/);
  assert.match(avisoReentrada(qualquer, false)!, /reentrada desligada/);
  assert.equal(avisoReentrada(adicionada, true), undefined);
  assert.equal(avisoReentrada(removida, false), undefined);
  assert.equal(avisoReentrada({ type: "form_submission" }, false), undefined);
});
```

- [ ] **Step 2: rodar e ver falhar**

Run: `cd extractor && npx tsx --test test/workflow-edit.test.ts`
Expected: FAIL

- [ ] **Step 3: implementação** em `guardas.ts`:

```ts
/**
 * Workflow criado por API nasce com `allowMultiple: false`. Em gatilho de tag ADICIONADA
 * isso quebra em silêncio: o contato que já passou uma vez não entra de novo quando
 * recebe a tag outra vez (descoberto na Cliente A, 2026-09-22). Tag removida fica de
 * fora: `contact_tag` cobre as duas, e o que as separa é `condition.field`.
 */
export function avisoReentrada(trigger: Record<string, unknown>, allowMultiple: unknown): string | undefined {
  if (trigger?.type !== "contact_tag" || allowMultiple !== false) return undefined;
  const conds = (trigger.conditions as { field?: string }[] | undefined) ?? [];
  const deTag = conds.filter((c) => c?.field === "tagsAdded" || c?.field === "tagsRemoved");
  if (deTag.length && !deTag.some((c) => c.field === "tagsAdded")) return undefined;
  return "reentrada desligada neste workflow: o contato que já passou por ele não entra de novo " +
    "quando receber a tag outra vez. Ligue com --acao configuracao --campo allowMultiple --valor true.";
}
```

Em `adicionarTrigger`: na prévia, depois de ler `documento`, `const a = avisoReentrada(corpo, documento.allowMultiple); if (a) { saida.avisos = [a]; log(a); }`. Na gravação, depois do `getWorkflowMeta` (tipar `meta` com `allowMultiple?: boolean`), o mesmo com `meta?.allowMultiple`.

- [ ] **Step 4: rodar e ver passar**

Run: `cd extractor && npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 5: commit**

```bash
git add extractor/src/api/workflow-edit/guardas.ts extractor/src/cli/workflow-editar.ts extractor/test/workflow-edit.test.ts
git commit -m "feat(extractor): avisa reentrada desligada ao adicionar gatilho de tag"
```

### Task 4: prévia devolve documento de antes e entidades ao vivo

**Files:**
- Create: `extractor/src/api/entidades-vivo.ts`
- Modify: `extractor/src/cli/workflow-editar.ts` (prévia de corpo ~linha 129; prévia de trigger adicionar ~linha 387 e remover ~linha 307)
- Test: `extractor/test/entidades-vivo.test.ts`

**Interfaces:**
- Consumes: `fetchTags`, `fetchUsers`, `fetchPipelines`, `fetchCustomFields`, `fetchCustomValues` (`src/api/entities.ts`), `listWorkflows` (`src/api/workflows.ts`), `decodeCompanyId` (`src/auth/token.ts`).
- Produces: `lerEntidadesAoVivo(client: GhlClient, loc: string, companyId: string): Promise<{ entidades: Record<string, unknown>; falhas: string[] }>` com chaves `tags`, `users`, `pipelines`, `custom_fields`, `custom_values`, `workflows` (resposta crua de cada rota; `workflows` é o array de `ListEntry`). Na saída da prévia: `documentoAntes`, `entidades`, `entidadesFalhas`, `triggersAntesLista` (lista completa de antes, só no caminho de trigger).

- [ ] **Step 1: teste que falha** em `extractor/test/entidades-vivo.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { lerEntidadesAoVivo } from "../src/api/entidades-vivo.js";

test("uma rota que falha não derruba as outras", async () => {
  const client = {
    getJson: async (url: string) => {
      if (url.includes("/users/search")) throw new Error("403");
      if (url.includes("/tags/search")) return { tags: [{ name: "nova" }] };
      if (url.includes("/workflow/")) return { rows: [] };
      return {};
    },
  } as any;
  const r = await lerEntidadesAoVivo(client, "L1", "C1");
  assert.deepEqual(r.falhas, ["users"]);
  assert.deepEqual(r.entidades.tags, { tags: [{ name: "nova" }] });
  assert.ok(!("users" in r.entidades));
});
```

Antes de escrever o dublê de `workflows`, abrir `src/api/workflows.ts:30-45` e ajustar o `if` do dublê para a URL e a forma que `listWorkflows` realmente consome.

- [ ] **Step 2: rodar e ver falhar**

Run: `cd extractor && npx tsx --test test/entidades-vivo.test.ts`
Expected: FAIL, módulo inexistente.

- [ ] **Step 3: implementação** de `src/api/entidades-vivo.ts`:

```ts
import type { GhlClient } from "./client.js";
import { fetchCustomFields, fetchCustomValues, fetchPipelines, fetchTags, fetchUsers } from "./entities.js";
import { listWorkflows } from "./workflows.js";

/**
 * As listas que as regras de referência consultam, lidas AGORA. A validação de escrita
 * compara contra elas em vez do dump: entidade criada depois da extração não pode virar
 * referência quebrada (três tags da Cliente A nasceram dois minutos depois do dump).
 * Rota que falha sai em `falhas` e a validação cai no dump só para aquela lista.
 */
export async function lerEntidadesAoVivo(
  client: GhlClient, loc: string, companyId: string,
): Promise<{ entidades: Record<string, unknown>; falhas: string[] }> {
  const rotas: [string, () => Promise<unknown>][] = [
    ["tags", () => fetchTags(client, loc)],
    ["users", () => fetchUsers(client, loc, companyId)],
    ["pipelines", () => fetchPipelines(client, loc)],
    ["custom_fields", () => fetchCustomFields(client, loc)],
    ["custom_values", () => fetchCustomValues(client, loc)],
    ["workflows", () => listWorkflows(client, loc)],
  ];
  const entidades: Record<string, unknown> = {};
  const falhas: string[] = [];
  for (const [nome, ler] of rotas) {
    try { entidades[nome] = await ler(); } catch { falhas.push(nome); }
  }
  return { entidades, falhas };
}
```

Serial de propósito: o cliente já aplica o rate limit entre chamadas.

Em `workflow-editar.ts`, prévia de corpo (bloco `if (!o.confirmo)` ~linha 129), acrescentar ao `Object.assign`:

```ts
        documentoAntes: doc,
        ...(await entidadesParaPrevia(client, o.location, tokens)),
```

com o helper local:

```ts
async function entidadesParaPrevia(client: GhlClient, loc: string, tokens: { tokenId: string }) {
  const { entidades, falhas } = await lerEntidadesAoVivo(client, loc, decodeCompanyId(tokens.tokenId));
  return { entidades, ...(falhas.length ? { entidadesFalhas: falhas } : {}) };
}
```

`tokens` já chega no callback de `withClient` (linha 48); passá-lo para `acaoTrigger`/`adicionarTrigger`/`removerTrigger` como parâmetro novo. Nas prévias de trigger: `documentoAntes: documento`, as entidades, e `triggersAntesLista: antes` (a lista completa lida antes da mudança).

`configuracao` não precisa das entidades, mas passa pelo mesmo bloco: aceitar o custo (~2 s só na prévia) em vez de ramificar.

- [ ] **Step 4: rodar e ver passar**

Run: `cd extractor && npm run typecheck && npm run lint && npm test`
Expected: PASS

- [ ] **Step 5: commit**

```bash
git add extractor/src/api/entidades-vivo.ts extractor/src/cli/workflow-editar.ts extractor/test/entidades-vivo.test.ts
git commit -m "feat(extractor): prévia devolve o documento de antes e as entidades ao vivo"
```

### Task 5: loader sobrepõe entidades ao vivo

**Files:**
- Modify: `auditor/src/automaster_audit/loader.py:143-190`
- Test: `auditor/tests/test_loader_and_report.py`

**Interfaces:**
- Produces: `sobrepor_entidades(ctx: DumpContext, entidades: dict) -> DumpContext` (cópia rasa com os derivados trocados das chaves presentes em `entidades`; chave ausente mantém o dump).

- [ ] **Step 1: testes que falham**

```python
from automaster_audit.loader import load_dump, sobrepor_entidades


def test_sobrepor_troca_so_as_listas_presentes(make_dump):
    ctx = load_dump(make_dump(workflows=[wf(id="w1")], tags=["velha"]))
    novo = sobrepor_entidades(
        ctx,
        {
            "tags": {"tags": [{"name": "Nova"}]},
            "users": {"users": [{"id": "U1", "name": "Luana"}, {"id": "U2", "name": "X", "deleted": True}]},
            "workflows": [{"_id": "w9", "name": "Recém-criado"}],
        },
    )
    assert novo.has_tag("nova") and not novo.has_tag("velha")
    assert novo.user_ids == {"U1", "U2"} and novo.user_deleted == {"U2"}
    assert "w9" in novo.workflow_ids and novo.workflow_names["w9"] == "Recém-criado"
    assert ctx.has_tag("velha"), "o contexto original não muda"
    assert novo.field_ids == ctx.field_ids, "lista ausente fica a do dump"
```

(importar `wf` de `conftest` se o arquivo ainda não importa.)

- [ ] **Step 2: rodar e ver falhar**

Run: `cd auditor && .venv/bin/python -m pytest tests/test_loader_and_report.py -q -k sobrepor`
Expected: FAIL, ImportError.

- [ ] **Step 3: implementação**

Extrair, de `load_dump`, cada bloco de entidade para uma função que recebe a resposta crua e ATRIBUI (não muta) os atributos do ctx:

```python
def _aplicar_pipelines(ctx: DumpContext, raw: dict) -> None:
    ids, stages, nomes, nomes_stage = set(), set(), {}, {}
    for p in raw.get("pipelines", []):
        if p.get("id"):
            ids.add(p["id"])
            nomes[p["id"]] = p.get("name", p["id"])
        for s in p.get("stages", []):
            if s.get("id"):
                stages.add(s["id"])
                nomes_stage[s["id"]] = s.get("name", s["id"])
    ctx.pipeline_ids, ctx.stage_ids, ctx.pipeline_names, ctx.stage_names = ids, stages, nomes, nomes_stage


def _aplicar_tags(ctx: DumpContext, raw: dict) -> None:
    ctx.tag_names = {t.get("name", "").strip().lower() for t in raw.get("tags", []) if t.get("name")}


def _aplicar_fields(ctx: DumpContext, raw: dict) -> None:
    ids, nomes = set(), {}
    for f in raw.get("customFields", []):
        fid = f.get("id") or f.get("_id")
        if fid:
            ids.add(fid)
            nomes[fid] = f.get("name", fid)
    ctx.field_ids, ctx.field_names = ids, nomes


def _aplicar_users(ctx: DumpContext, raw: dict) -> None:
    users = raw.get("users", [])
    ids, nomes, apagados = set(), {}, set()
    for u in users:
        uid = u.get("id") or u.get("_id")
        if uid:
            ids.add(uid)
            nomes[uid] = u.get("name") or f"{u.get('firstName', '')} {u.get('lastName', '')}".strip() or uid
            if u.get("deleted"):
                apagados.add(uid)
    ctx.users, ctx.user_ids, ctx.user_names, ctx.user_deleted = users, ids, nomes, apagados


def _aplicar_custom_values(ctx: DumpContext, raw: dict) -> None:
    cvs = raw.get("customValues", [])
    ctx.custom_values = cvs
    ctx.cv_keys = {k for cv in cvs for k in _cv_keys(cv)}


def _aplicar_lista_workflows(ctx: DumpContext, lista: list) -> None:
    """Lista ao vivo (`ListEntry[]`): só ids e nomes. O corpo de cada workflow continua do dump."""
    ids = {w.get("_id") or w.get("id") for w in lista} - {None}
    ctx.workflow_ids = ids | {w.id for w in ctx.workflows}
    ctx.workflow_names = {**ctx.workflow_names, **{(w.get("_id") or w.get("id")): w.get("name", "") for w in lista if (w.get("_id") or w.get("id"))}}


_SOBREPOSICAO = {
    "pipelines": _aplicar_pipelines,
    "tags": _aplicar_tags,
    "custom_fields": _aplicar_fields,
    "users": _aplicar_users,
    "custom_values": _aplicar_custom_values,
    "workflows": _aplicar_lista_workflows,
}


def sobrepor_entidades(ctx: DumpContext, entidades: dict) -> DumpContext:
    """Cópia rasa do ctx com as listas lidas AO VIVO no lugar das do dump.

    Entidade criada depois da extração não pode virar referência quebrada na validação de
    escrita. Chave ausente em `entidades` (rota que falhou) mantém a lista do dump.
    """
    novo = copy.copy(ctx)
    for chave, aplicar in _SOBREPOSICAO.items():
        if chave in entidades and entidades[chave] is not None:
            aplicar(novo, entidades[chave])
    return novo
```

`load_dump` passa a chamar `_aplicar_pipelines(ctx, _entity_raw(path / "pipelines.json"))` e equivalentes para tags, fields, users (`_entity_raw_optional`) e custom values (`_entity_raw_optional`); `ctx.workflow_ids`/`workflow_names` continuam vindo dos arquivos. Remover o `discard(None)` do fim (as funções já não inserem `None`). Importar `copy`.

- [ ] **Step 4: rodar a suíte inteira** (a refatoração do loader não pode mudar nenhum relatório)

Run: `cd auditor && .venv/bin/ruff check src tests && .venv/bin/ruff format --check src tests && .venv/bin/python -m pytest -q`
Expected: PASS, todos.

- [ ] **Step 5: commit**

```bash
git add auditor/src/automaster_audit/loader.py auditor/tests/test_loader_and_report.py
git commit -m "feat(auditor): sobrepor entidades lidas ao vivo ao contexto do dump"
```

### Task 6: `validar_edicao` valida workflow fora do dump

**Files:**
- Modify: `auditor/src/automaster_audit/validacao_escrita.py:56-104`
- Test: `auditor/tests/test_validacao_escrita.py`

**Interfaces:**
- Consumes: nada novo.
- Produces: `validar_edicao(ctx, workflow_id, doc_editado, triggers=None, doc_antes=None, triggers_antes=None) -> ResultadoValidacao`. Workflow fora do dump e `doc_antes` presente: valida. Fora do dump sem `doc_antes`: `ValueError` como hoje.

- [ ] **Step 1: testes que falham** (substituir o teste `test_workflow_fora_do_dump_e_erro_claro` mantendo-o para o caso sem `doc_antes`, e acrescentar):

```python
def _doc(steps):
    return {"name": "Novo", "status": "draft", "workflowData": {"templates": steps}}


def test_workflow_fora_do_dump_e_validado_com_o_documento_de_antes(make_dump):
    ctx = load_dump(make_dump(workflows=[wf(id="w1")], tags=["boa"]))
    antes = _doc([_passo_tag("s1", ["boa"])])
    depois = _doc([_passo_tag("s1", ["boa"]), _passo_tag("s2", ["inventada"])])
    r = validar_edicao(ctx, "w9", depois, triggers=[], doc_antes=antes, triggers_antes=[])
    assert r.pode_gravar is False
    assert any("inventada" in e for e in r.erros_novos)


def test_workflow_fora_do_dump_sem_erro_novo_pode_gravar(make_dump):
    ctx = load_dump(make_dump(workflows=[wf(id="w1")], tags=["boa"]))
    antes = _doc([])
    depois = _doc([_passo_tag("s1", ["boa"])])
    r = validar_edicao(ctx, "w9", depois, triggers=[], doc_antes=antes, triggers_antes=[])
    assert r.pode_gravar is True
```

- [ ] **Step 2: rodar e ver falhar**

Run: `cd auditor && .venv/bin/python -m pytest tests/test_validacao_escrita.py -q`
Expected: FAIL, `doc_antes` inesperado.

- [ ] **Step 3: implementação**

No começo de `validar_edicao`, trocar o `raise` por:

```python
    alvo = next((w for w in ctx.workflows if w.id == workflow_id), None)
    if alvo is None:
        if doc_antes is None:
            raise ValueError(f"workflow {workflow_id} não está neste dump — extraia a subconta de novo")
        # Workflow mais novo que o dump (criado ou duplicado depois da extração): entra no
        # contexto montado do documento lido ao vivo. É a montagem do zero, o caso em que
        # mais cabe erro, e até aqui era o único sem guarda.
        alvo = Workflow(
            id=workflow_id,
            name=doc_antes.get("name", ""),
            status=doc_antes.get("status", ""),
            raw={
                "detail": doc_antes,
                "steps": {"templates": (doc_antes.get("workflowData") or {}).get("templates") or []},
                "triggers": triggers_antes if triggers_antes is not None else (triggers or []),
            },
        )
        ctx = copy.copy(ctx)
        ctx.workflows = [*ctx.workflows, alvo]
        ctx.workflow_ids = ctx.workflow_ids | {workflow_id}
        ctx.workflow_names = {**ctx.workflow_names, workflow_id: alvo.name}
```

Atualizar a docstring com os dois parâmetros novos. O resto da função segue igual (`antes` é calculado sobre este `ctx`).

- [ ] **Step 4: rodar e ver passar**

Run: `cd auditor && .venv/bin/python -m pytest tests/test_validacao_escrita.py -q`
Expected: PASS

- [ ] **Step 5: commit**

```bash
git add auditor/src/automaster_audit/validacao_escrita.py auditor/tests/test_validacao_escrita.py
git commit -m "feat(auditor): as 18 regras validam workflow que ainda não está no dump"
```

### Task 7: tool MCP — configuracao, entidades ao vivo e workflow novo

**Files:**
- Modify: `auditor/src/automaster_audit/mcp/workflows.py` (`WF_EDITAR_ACOES` ~linha 80, assinatura ~linha 109, `_args` ~linha 160, orquestração 202-275, schema ~linha 360, descrição da tool)
- Test: `auditor/tests/test_workflow_editar_tool.py`

**Interfaces:**
- Consumes: `sobrepor_entidades` (Task 5), `validar_edicao(..., doc_antes=, triggers_antes=)` (Task 6), chaves da prévia da Task 4.
- Produces: parâmetro `campo: str | None` na tool.

- [ ] **Step 1: testes que falham**

1. Em `_ARGS_POR_ACAO` acrescentar `"configuracao": {"id": "W1", "campo": "allowMultiple", "valor": "true"}`.
2. Trocar todo dublê `lambda *a:` de `validar_edicao` por `lambda *a, **k:` (linhas 339, 416, 512, 539) e `def validar(ctx, wid, doc, triggers=None)` (linha 184) por `def validar(ctx, wid, doc, triggers=None, **k)`.
3. Dar a `_CtxFalso` os atributos que `sobrepor_entidades` copia: trocar a classe por uma que herde de `DumpContext` ou, mais simples, fazer os testes que precisam de sobreposição usarem `load_dump(make_dump(...))`.
4. Novos testes:

```python
def test_workflow_novo_e_validado_com_documento_e_entidades_ao_vivo(monkeypatch, make_dump):
    ctx = load_dump(make_dump(workflows=[wf(id="OUTRO")], tags=[]))
    recebido = {}

    def falso(*args):
        if "--confirmo" in args:
            return {"aplicado": True}
        return {
            "aplicado": False,
            "documento": {"name": "n", "workflowData": {"templates": []}},
            "documentoAntes": {"name": "n", "workflowData": {"templates": []}},
            "entidades": {"tags": {"tags": [{"name": "transferir-luana"}]}},
            "triggers": [],
            "versao": 3,
        }

    def validar(c, wid, doc, triggers=None, doc_antes=None, triggers_antes=None):
        recebido.update(tem_tag=c.has_tag("transferir-luana"), doc_antes=doc_antes)
        return _ResultadoFalso(pode_gravar=True)

    monkeypatch.setattr(mcp_base, "_run_extractor", falso)
    monkeypatch.setattr(mcp_base, "_load", lambda loc, snap: (ctx, {"snapshot": "S"}))
    monkeypatch.setattr(mcp_workflows, "validar_edicao", validar)
    r = mcp_server.workflow_editar(loc="L1", acao="trocar-tag", id="W9", de="a", para="b", confirmo=True)
    assert r["validacao"]["rodou"] is True
    assert recebido["tem_tag"] is True
    assert recebido["doc_antes"] is not None
    assert "documentoAntes" not in r and "entidades" not in r and "documento" not in r


def test_entidade_que_falhou_cai_no_dump_e_diz_qual(monkeypatch, make_dump):
    ctx = load_dump(make_dump(workflows=[wf(id="W1")], tags=["x"]))
    monkeypatch.setattr(
        mcp_base,
        "_run_extractor",
        lambda *a: {"aplicado": False, "documento": {"name": "n"}, "documentoAntes": {"name": "n"},
                    "entidades": {}, "entidadesFalhas": ["users"], "triggers": []},
    )
    monkeypatch.setattr(mcp_base, "_load", lambda loc, snap: (ctx, {"snapshot": "S"}))
    monkeypatch.setattr(mcp_workflows, "validar_edicao", lambda *a, **k: _ResultadoFalso(pode_gravar=True))
    r = mcp_server.workflow_editar(loc="L1", acao="trocar-tag", id="W1", de="a", para="b")
    assert "users" in r["validacao"]["aviso"]


def test_configuracao_nao_devolve_documento(monkeypatch):
    monkeypatch.setattr(
        mcp_base, "_run_extractor", lambda *a: {"aplicado": False, "documento": {"x": 1}, "documentoAntes": {}, "entidades": {}}
    )
    r = mcp_server.workflow_editar(loc="L1", acao="configuracao", id="W1", campo="allowMultiple", valor="true")
    assert "documento" not in r and "documentoAntes" not in r and "entidades" not in r
    assert "validacao" not in r
```

(importar `load_dump` de `automaster_audit.loader` e `wf` de `conftest`.)

O teste `test_workflow_fora_do_dump_nao_estoura_e_avisa_antes_do_chrome` continua: a prévia dele não traz `documentoAntes`, então a validação não roda e o motivo segue contendo "não está no dump".

- [ ] **Step 2: rodar e ver falhar**

Run: `cd auditor && .venv/bin/python -m pytest tests/test_workflow_editar_tool.py -q`
Expected: FAIL

- [ ] **Step 3: implementação**

1. `WF_EDITAR_ACOES`: acrescentar `"configuracao"`. NÃO entra em `_WF_EDITAR_COM_CORPO`.
2. Assinatura: `campo: str | None = None` depois de `valor`; em `_args`, `("--campo", campo)` na lista de flags.
3. Função local para limpar a resposta, usada nos DOIS caminhos (inclusive o `return base._run_extractor(*_args(confirmo))` das ações sem validação, que passa a guardar o resultado e limpá-lo):

```python
_SO_PARA_VALIDAR = ("documento", "documentoAntes", "entidades", "entidadesFalhas", "triggersAntesLista")


def _sem_documento(r: dict) -> dict:
    """O documento e as entidades servem à validação local e nunca voltam ao modelo."""
    for chave in _SO_PARA_VALIDAR:
        r.pop(chave, None)
    return r
```

4. Orquestração: o dump continua sendo carregado ANTES da prévia, mas a ausência do workflow não zera mais o `ctx`. Depois da prévia:

```python
    previa = base._run_extractor(*_args(False))
    documento = previa.get("documento")
    documento_antes = previa.get("documentoAntes")
    entidades = previa.get("entidades") or {}
    falhas = previa.get("entidadesFalhas") or []
    triggers_antes_lista = previa.get("triggersAntesLista")
    _sem_documento(previa)
    versao = previa.get("versao")
    triggers_antes = previa.get("triggersAntes")

    fora_do_dump = ctx is not None and not any(getattr(w, "id", None) == id for w in ctx.workflows)
    if fora_do_dump and documento_antes is None:
        sem_validacao = (
            f"workflow {id} não está no dump {meta['snapshot']} (criado ou duplicado depois da "
            "última extração) e a prévia não trouxe o documento de antes: as 18 regras não foram rodadas."
        )
        ctx = None
    if ctx is not None and entidades:
        ctx = sobrepor_entidades(ctx, entidades)
```

O bloco de `ctx is None` e o de `documento is None` seguem como estão. A chamada vira:

```python
        resultado_validacao = validar_edicao(
            ctx, id, documento, previa.get("triggers"),
            doc_antes=documento_antes, triggers_antes=triggers_antes_lista,
        )
```

e o `aviso` da validação passa a dizer a origem:

```python
    origem = "entidades lidas ao vivo" if entidades else f"entidades do dump {meta['snapshot']}"
    if falhas:
        origem += f" (do dump, por falha de leitura: {', '.join(falhas)})"
    validacao["aviso"] = f"as regras rodaram com {origem}; templates e formulários vêm do dump {meta['snapshot']}"
    if fora_do_dump:
        validacao["aviso"] += "; workflow mais novo que o dump, validado a partir do documento ao vivo"
```

Os `resultado = base._run_extractor(*_args(True, ...))` também passam por `_sem_documento`.

5. Schema: `"campo": {"type": "string", "enum": ["allowMultiple"], "description": "configuracao: chave geral do workflow; allowMultiple = reentrada"}`, e `"configuracao"` no enum de `acao`.
6. Descrição da tool: acrescentar "altera configuração geral do workflow (`configuracao`: por ora só `allowMultiple`, a reentrada)".

- [ ] **Step 4: rodar a suíte inteira**

Run: `cd auditor && .venv/bin/ruff check src tests && .venv/bin/ruff format --check src tests && .venv/bin/python -m pytest -q`
Expected: PASS

- [ ] **Step 5: commit**

```bash
git add auditor/src/automaster_audit/mcp/workflows.py auditor/tests/test_workflow_editar_tool.py
git commit -m "feat(mcp): workflow_editar configura reentrada e valida com entidades ao vivo"
```

### Task 8: porta `automaster-audit workflow-editar`

**Files:**
- Modify: `auditor/src/automaster_audit/cli.py:193-213` (lista `campos`) e ~linha 304 (argumentos)
- Test: `auditor/tests/test_cli_workflow_editar.py:53-75`

- [ ] **Step 1: teste que falha** — no dict de kwargs esperado do teste existente (linhas 53-75), acrescentar `"campo": None`; e novo teste:

```python
def test_configuracao_chega_na_tool(monkeypatch):
    recebido = {}
    monkeypatch.setattr(mcp_server, "workflow_editar", lambda **k: (recebido.update(k), {"aplicado": True})[1])
    rc = main(["workflow-editar", "-l", "L1", "--acao", "configuracao", "-i", "W1", "--campo", "allowMultiple", "--valor", "true"])
    assert rc == 0
    assert recebido["campo"] == "allowMultiple" and recebido["valor"] == "true"
```

Antes de escrever, conferir no topo de `test_cli_workflow_editar.py` como o arquivo chama a CLI (`main` ou `cli.main`) e seguir o mesmo nome.

- [ ] **Step 2: rodar e ver falhar**

Run: `cd auditor && .venv/bin/python -m pytest tests/test_cli_workflow_editar.py -q`
Expected: FAIL

- [ ] **Step 3: implementação** — `"campo"` na tupla `campos` depois de `"valor"`; `p_we.add_argument("--campo", help="configuração geral do workflow (configuracao): allowMultiple")`; o help de `--valor` cita `configuracao`.

- [ ] **Step 4: rodar e ver passar**

Run: `cd auditor && .venv/bin/python -m pytest -q`
Expected: PASS

- [ ] **Step 5: commit**

```bash
git add auditor/src/automaster_audit/cli.py auditor/tests/test_cli_workflow_editar.py
git commit -m "feat(auditor): automaster-audit workflow-editar --campo"
```

### Task 9: documentação e versão 0.26.0

**Files:**
- Modify: `CLAUDE.md` (linha 74, lista de ações do `workflow-editar`; parágrafo "A validação pelas 18 regras mora acima do comando", ~143-146)
- Modify: `skills/automaster-leitura/SKILL.md` (seção `## Workflows ao vivo`)
- Modify: `docs/endpoints.md` (seção de escrita de workflow, perto da linha 119)
- Modify: `docs/backlog-arquitetura.md` (C1 e C2 viram `[x]`)
- Modify: `CHANGELOG.md`, `.claude-plugin/plugin.json`, `extractor/package.json`, `auditor/pyproject.toml`

- [ ] **Step 1: CLAUDE.md** — lista de ações vira `(criar/renomear/mover/duplicar/apagar/trocar-ref/trocar-tag/limpar-orfaos/atributo/trigger/historico/configuracao/step-criar/step-remover/step-mover)`; no parágrafo das 18 regras acrescentar: "`configuracao` entra nas três portas mas não nas regras, que não leem configuração geral. A validação usa as entidades lidas ao vivo pela prévia (tags, usuários, funis, campos, custom values, lista de workflows) e valida também workflow mais novo que o dump, montado do documento; templates e formulários seguem do dump."
- [ ] **Step 2: skill** — acrescentar na seção de `workflow_editar`: "**Workflow criado por API nasce com a reentrada desligada** (`allowMultiple: false`). Gatilho de tag adicionada devolve aviso; ligue com `acao=configuracao, campo=allowMultiple, valor=true`. `validacao.aviso` diz de onde vieram as entidades: com `(do dump, por falha de leitura: ...)` a lista citada pode estar velha."
- [ ] **Step 3: endpoints.md** — registrar: "`allowMultiple` na raiz do documento sobrevive ao `PUT /workflow/<loc>/<wid>` e é o que a releitura devolve — provado ao vivo na Cliente A em 2026-09-22 (workflow `a6e9784b-2d9a-44ab-aa0d-ed67cdc90800`, versão 11 → 12). As demais chaves de raiz (`stopOnResponse`, `autoMarkAsRead`, `allowMultipleOpportunity`, `removeContactFromLastStep`) não foram exercitadas."
- [ ] **Step 4: versão** — 0.26.0 nos três manifestos; `CHANGELOG.md` ganha a seção `## 0.26.0` com: ação `configuracao` (só `allowMultiple`); aviso de reentrada no gatilho de tag; validação com entidades ao vivo; validação de workflow fora do dump.
- [ ] **Step 5: backlog** — C1 e C2 marcados `[x]` com "fechados em 0.26.0".
- [ ] **Step 6: suítes completas dos dois lados**

Run: `cd extractor && npm run typecheck && npm run lint && npm test && cd ../auditor && .venv/bin/ruff check src tests && .venv/bin/ruff format --check src tests && .venv/bin/python -m pytest -q`
Expected: PASS (inclui `test_versoes.py`)

- [ ] **Step 7: commit**

```bash
git add CLAUDE.md skills/automaster-leitura/SKILL.md docs/endpoints.md docs/backlog-arquitetura.md CHANGELOG.md .claude-plugin/plugin.json extractor/package.json auditor/pyproject.toml
git commit -m "chore(0.26.0): configuração do workflow e validação ao vivo"
```

### Task 10: prova ao vivo (só prévias, nada gravado)

Subconta: Cliente A `HNEdypCYlMDyGCKSkTGQ`, workflow `a6e9784b-2d9a-44ab-aa0d-ed67cdc90800` (publicado, não está no dump `2026-09-22_2104`). UMA chamada por vez: o perfil do Chrome é único.

- [ ] **Step 1:** `cd auditor && .venv/bin/automaster-audit workflow-editar -l HNEdypCYlMDyGCKSkTGQ --acao configuracao -i a6e9784b-2d9a-44ab-aa0d-ed67cdc90800 --campo allowMultiple --valor true`
Expected: `aplicado: false`, motivo "nada a mudar" (a reentrada já está ligada).
- [ ] **Step 2:** `.venv/bin/automaster-audit workflow-editar -l HNEdypCYlMDyGCKSkTGQ --acao trocar-tag -i a6e9784b-2d9a-44ab-aa0d-ed67cdc90800 --de transferir-luana --para transferir-luana-x`
Expected: prévia com `validacao.rodou: true`, aviso "workflow mais novo que o dump", e `erros_novos` citando `transferir-luana-x` (a tag não existe) — prova de que a guarda agora morde em workflow novo. `aplicado: false`, nada gravado.
- [ ] **Step 3:** registrar os dois resultados em `docs/endpoints.md` (uma linha cada) e commitar:

```bash
git add docs/endpoints.md
git commit -m "docs: prova ao vivo da validação de workflow fora do dump"
```
