# Oportunidades no MCP automaster — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dar ao MCP automaster três tools novas — `oportunidades`, `oportunidade_acao` e `pipeline` — que leem e escrevem os cards e os funis de uma subconta GoHighLevel ao vivo.

**Architecture:** um módulo novo no extractor (`opportunities.ts`) com uma função por rota sobre o cliente Playwright autenticado; três comandos na CLI que serializam JSON no stdout e gravam o rastro de cada escrita; três funções no `mcp_server.py` que validam e chamam a CLI. Nada toca o dump, o loader, o flow ou as regras de auditoria.

**Tech Stack:** TypeScript + Playwright (extractor), Python 3.12 + pytest (auditor), commander para a CLI.

**Spec:** `docs/superpowers/specs/2026-09-19-oportunidades-mcp-design.md`

## Global Constraints

- Subconta de validação: `Xb9gDxwxYhdqtprGcb5E` (Instaltech). Contato de teste: `uWqujqll20tRuglV3mLt`.
- Pipeline de produção `Vendas` (9 estágios) **nunca** é tocado. Toda escrita de teste acontece dentro de um pipeline `zz-teste-automaster` criado e apagado pela própria validação.
- Auth: os dois tokens (Bearer + `token-id` Firebase) em toda chamada, via `withClient`. Nunca usar credencial de API pública.
- Toda escrita exige `confirmo=true` na tool e `--confirmo` na CLI, e grava o rastro em `<dumps>/_oportunidades/<loc>/<chave>/<ts>.json` por `registroEscrita`.
- Leitura nunca pede confirmação.
- Versão alvo do plugin: **0.6.0**.
- Rodar `npx tsc --noEmit` em `extractor/` depois de cada tarefa que mexe em TypeScript, e `.venv/bin/python -m pytest -q` em `auditor/` depois de cada tarefa que mexe em Python.
- Comentários e mensagens de erro em português, como o resto do repo.

---

### Task 1: Sondar o contrato ao vivo da aba Oportunidades

O contrato do card veio da documentação pública da v3; o da escrita de pipeline não tem fonte nenhuma. Esta tarefa fecha os dois contra o app real, antes de qualquer código. É a única tarefa sem teste automatizado — o entregável é documentação.

**Files:**
- Modify: `docs/endpoints.md` (acrescentar uma seção `## Oportunidades` no fim)

- [ ] **Step 1: Abrir a subconta no modo discover**

```bash
cd extractor && npm run discover -- --location Xb9gDxwxYhdqtprGcb5E
```

Isso abre o Chrome com o perfil persistente e loga todo request ao backend. A sessão costuma já estar logada.

- [ ] **Step 2: Percorrer a interface de oportunidades, na ordem**

Na aba **Oportunidades** da subconta, faça manualmente, olhando o log do discover a cada passo:

1. Abrir a lista de um pipeline (captura a rota de listar cards e o formato da paginação).
2. Digitar um termo na busca (captura a rota de busca e os parâmetros de filtro).
3. Abrir um card (captura a rota de detalhe).
4. Arrastar um card de um estágio para outro (captura como o app move — confirma se é o mesmo `PUT` da edição com o estágio trocado).
5. Em **Configurações do pipeline**, criar um pipeline novo chamado `zz-sonda-automaster` com três estágios.
6. Renomear um estágio desse pipeline e salvar (captura se o corpo do `PUT` leva a lista inteira de estágios ou só o que mudou — **esta é a pergunta central da tarefa**).
7. Adicionar um estágio e salvar.
8. Criar um card qualquer no último estágio desse pipeline, voltar às configurações e **remover esse estágio**. Observe e anote: a interface avisa? Recusa? Para onde vai o card? Se ela recusar, anote que a guarda é do servidor.
9. Apagar o pipeline `zz-sonda-automaster` inteiro.

- [ ] **Step 3: Escrever o que foi capturado**

Acrescente ao fim de `docs/endpoints.md`:

```markdown
## Oportunidades

Auth: os dois tokens, como todo `opportunities/*`.

### Leitura
| O que | Rota |
|---|---|
| Pipelines e estágios | `GET backend.leadconnectorhq.com/opportunities/pipelines?locationId=<loc>` (já usado por `fetchPipelines`) |
| Cards de um pipeline | `<preencher com o capturado>` |
| Busca | `<preencher>` |
| Um card | `<preencher>` |

### Escrita de card
| O que | Rota | Corpo |
|---|---|---|
| Criar | `<preencher>` | `<preencher>` |
| Editar / mover de estágio | `<preencher>` | `<preencher>` |
| Status | `<preencher>` | `<preencher>` |
| Apagar | `<preencher>` | — |
| Restaurar | `<preencher>` | — |

### Escrita de pipeline
| O que | Rota | Corpo |
|---|---|---|
| Criar | `<preencher>` | `<preencher>` |
| Editar nome e estágios | `<preencher>` | `<preencher>` |
| Apagar | `<preencher>` | — |

**Editar estágios manda a lista inteira?** `<sim/não, e o que isso implica>`

**Remover estágio com cards dentro:** `<o que a interface faz; o que o servidor faz>`
```

Substitua cada `<preencher>` pelo capturado. Não deixe nenhum.

- [ ] **Step 4: Commit**

```bash
git add docs/endpoints.md
git commit -m "docs(endpoints): contrato ao vivo de oportunidades e pipelines"
```

---

### Task 2: Módulo de leitura de oportunidades no extractor

**Files:**
- Create: `extractor/src/api/opportunities.ts`
- Read for reference: `extractor/src/api/entities.ts:1-9` (constantes de host e `fetchPipelines`), `extractor/src/api/whatsapp.ts:1-40` (molde de módulo)

**Interfaces:**
- Consumes: `GhlClient` de `./client.js` — métodos `getJson<T>(url)`, `postJson<T>(url, body)`, `putJson<T>(url, body)`, `deleteJson<T>(url, body?)`. `fetchPipelines(client, locationId)` de `./entities.js`.
- Produces: `listPipelines`, `listOpportunities`, `searchOpportunities`, `getOpportunity` — assinaturas abaixo.

- [ ] **Step 1: Escrever o módulo**

Use as rotas exatas que a Task 1 escreveu em `docs/endpoints.md`. O corpo abaixo assume a forma documentada da v3; se a sondagem achou outra, use a da sondagem e ajuste as assinaturas.

```typescript
import type { GhlClient } from "./client.js";
import { fetchPipelines } from "./entities.js";

const OPP = "https://services.leadconnectorhq.com/opportunities";

export interface OppFiltro {
  pipelineId?: string;
  pipelineStageId?: string;
  status?: string;       // open | won | lost | abandoned | all
  contactId?: string;
  assignedTo?: string;
  q?: string;            // termo livre
  limit?: number;
  page?: number;
}

/** Pipelines e seus estágios. Reusa o que o extractor já faz. */
export function listPipelines(client: GhlClient, locationId: string): Promise<unknown> {
  return fetchPipelines(client, locationId);
}

/** Monta a query string de um filtro, sem os campos vazios. */
function query(locationId: string, f: OppFiltro): string {
  const p = new URLSearchParams({ location_id: locationId });
  for (const [k, v] of Object.entries(f)) {
    if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  }
  return p.toString();
}

/** Cards de um pipeline, com filtro opcional de estágio, status e dono. */
export function listOpportunities(
  client: GhlClient, locationId: string, f: OppFiltro = {},
): Promise<unknown> {
  return client.getJson(`${OPP}/search?${query(locationId, f)}`);
}

/** Busca por termo livre na subconta inteira. */
export function searchOpportunities(
  client: GhlClient, locationId: string, termo: string, f: OppFiltro = {},
): Promise<unknown> {
  return client.getJson(`${OPP}/search?${query(locationId, { ...f, q: termo })}`);
}

/** Um card pelo id. */
export function getOpportunity(client: GhlClient, id: string): Promise<unknown> {
  return client.getJson(`${OPP}/${id}`);
}
```

- [ ] **Step 2: Conferir que compila**

```bash
cd extractor && npx tsc --noEmit
```

Esperado: sem saída (sucesso).

- [ ] **Step 3: Commit**

```bash
git add extractor/src/api/opportunities.ts
git commit -m "feat(oportunidades): modulo de leitura no extractor"
```

---

### Task 3: Comando `oportunidades` na CLI

**Files:**
- Modify: `extractor/src/cli.ts` (import no topo; função `runOportunidades` junto das outras `run*`; registro do comando junto dos outros `program.command`)
- Modify: `extractor/package.json` (bloco `scripts`)
- Read for reference: `extractor/src/cli.ts:506-524` (`runWhatsapp`, molde de comando de leitura com `-o`)

**Interfaces:**
- Consumes: `listPipelines`, `listOpportunities`, `searchOpportunities`, `getOpportunity` da Task 2; `withClient(location, log, fn)` já existente no `cli.ts`.
- Produces: comando `oportunidades` com `-o <op>` aceitando `pipelines | listar | buscar | ver`.

- [ ] **Step 1: Importar o módulo no topo do cli.ts**

Junto dos outros imports de `./api/`:

```typescript
import {
  listPipelines, listOpportunities, searchOpportunities, getOpportunity,
} from "./api/opportunities.js";
```

- [ ] **Step 2: Escrever a função de execução**

Coloque junto das outras `run*`, antes do bloco de registro de comandos:

```typescript
async function runOportunidades(opts: {
  location: string; o: string; id?: string; pipeline?: string; estagio?: string;
  status?: string; contato?: string; termo?: string; limite?: string; json?: boolean;
}): Promise<void> {
  const log = opts.json ? console.error : console.log;
  await withClient(opts.location, log, async (client) => {
    const filtro = {
      pipelineId: opts.pipeline,
      pipelineStageId: opts.estagio,
      status: opts.status,
      contactId: opts.contato,
      limit: opts.limite ? Number(opts.limite) : undefined,
    };
    let out: unknown;
    switch (opts.o) {
      case "pipelines": out = await listPipelines(client, opts.location); break;
      case "listar": out = await listOpportunities(client, opts.location, filtro); break;
      case "buscar":
        if (!opts.termo) throw new Error("-o buscar exige --termo");
        out = await searchOpportunities(client, opts.location, opts.termo, filtro);
        break;
      case "ver":
        if (!opts.id) throw new Error("-o ver exige --id");
        out = await getOpportunity(client, opts.id);
        break;
      default:
        throw new Error(`-o inválido: ${opts.o}. Aceitos: pipelines, listar, buscar, ver`);
    }
    if (opts.json) console.log(JSON.stringify(out));
    else console.log(JSON.stringify(out, null, 2));
  });
}
```

- [ ] **Step 3: Registrar o comando**

Junto dos outros `program.command(...)`:

```typescript
program
  .command("oportunidades")
  .description("Leitura ao vivo de pipelines e oportunidades da subconta")
  .requiredOption("-l, --location <id>", "locationId da subconta")
  .option("-o, --o <op>", "pipelines | listar | buscar | ver", "pipelines")
  .option("-i, --id <id>", "id da oportunidade (com -o ver)")
  .option("--pipeline <id>", "filtra por pipeline")
  .option("--estagio <id>", "filtra por estágio")
  .option("--status <s>", "open | won | lost | abandoned | all")
  .option("--contato <id>", "filtra pelas oportunidades de um contato")
  .option("--termo <texto>", "termo de busca (com -o buscar)")
  .option("--limite <n>", "quantos cards trazer")
  .option("--json", "imprime o resultado em JSON no stdout")
  .action((o) => runOportunidades(o).catch((e) => { console.error(e.message); process.exit(1); }));
```

- [ ] **Step 4: Acrescentar o script no package.json**

No bloco `scripts`, depois de `"grupo"`:

```json
    "oportunidades": "tsx src/cli.ts oportunidades"
```

- [ ] **Step 5: Conferir que compila e que o comando existe**

```bash
cd extractor && npx tsc --noEmit && npx tsx src/cli.ts oportunidades --help
```

Esperado: a ajuda do comando, com todas as opções acima.

- [ ] **Step 6: Commit**

```bash
git add extractor/src/cli.ts extractor/package.json
git commit -m "feat(oportunidades): comando de leitura na CLI"
```

---

### Task 4: Tool MCP `oportunidades`

**Files:**
- Modify: `auditor/src/automaster_audit/mcp_server.py` (função nova junto das outras; entrada nova no dict `TOOLS`)
- Modify: `auditor/tests/test_mcp_tools.py`
- Read for reference: `mcp_server.py:398-407` (`whatsapp`, molde de tool de leitura), `mcp_server.py:624-629` (entrada de `whatsapp` no `TOOLS`)

**Interfaces:**
- Consumes: `_load(loc, snapshot)`, `_run_extractor(*args)`, `ToolError` — já existentes.
- Produces: `oportunidades(loc, o, id, pipeline, estagio, status, contato, termo, limite, snapshot) -> dict`; constante `OPP_LEITURA`.

- [ ] **Step 1: Escrever o teste que falha**

Em `auditor/tests/test_mcp_tools.py`, no fim do arquivo:

```python
def test_oportunidades_recusa_operacao_invalida(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(srv, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError) as e:
        srv.oportunidades(LOC, o="inventar")
    assert "inventar" in str(e.value)


def test_oportunidades_ver_exige_id(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(srv, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError) as e:
        srv.oportunidades(LOC, o="ver")
    assert "id" in str(e.value)


def test_oportunidades_buscar_passa_termo_ao_extractor(root, monkeypatch):
    root(workflows=[wf()])
    visto = {}
    monkeypatch.setattr(srv, "_run_extractor", lambda *a: visto.update(args=a) or {"ok": True})
    r = srv.oportunidades(LOC, o="buscar", termo="teto solar")
    assert r["resultado"] == {"ok": True}
    assert "--termo" in visto["args"] and "teto solar" in visto["args"]
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd auditor && .venv/bin/python -m pytest tests/test_mcp_tools.py -k oportunidades -q
```

Esperado: FAIL com `AttributeError: module ... has no attribute 'oportunidades'`.

- [ ] **Step 3: Escrever a tool**

Junto das outras funções de tool:

```python
OPP_LEITURA = ("pipelines", "listar", "buscar", "ver")


def oportunidades(loc: str, o: str = "pipelines", id: str | None = None,
                  pipeline: str | None = None, estagio: str | None = None,
                  status: str | None = None, contato: str | None = None,
                  termo: str | None = None, limite: int | None = None,
                  snapshot: str | None = None) -> dict:
    """Leitura ao vivo de pipelines e oportunidades da subconta."""
    if o not in OPP_LEITURA:
        raise ToolError(f"o inválido: {o}. Aceitos: {', '.join(OPP_LEITURA)}")
    if o == "ver" and not id:
        raise ToolError("o=ver exige id da oportunidade")
    if o == "buscar" and not termo:
        raise ToolError("o=buscar exige termo")
    _, meta = _load(loc, snapshot)
    args = ["oportunidades", "-l", loc, "-o", o]
    for flag, val in (("-i", id), ("--pipeline", pipeline), ("--estagio", estagio),
                      ("--status", status), ("--contato", contato), ("--termo", termo),
                      ("--limite", str(limite) if limite else None)):
        if val:
            args += [flag, val]
    return {"resultado": _run_extractor(*args, "--json"), "_snapshot": meta}
```

- [ ] **Step 4: Registrar no dict TOOLS**

Depois da entrada de `grupo`:

```python
    "oportunidades": (oportunidades, "Leitura ao vivo de pipelines e oportunidades (abre Chrome, não usa o "
                      "dump): `pipelines` (funis e seus estágios), `listar` (cards, com filtro de pipeline, "
                      "estágio, status e contato), `buscar` (termo livre), `ver` (um card pelo id).",
                      {"loc": _LOC, "o": {"type": "string", "enum": list(OPP_LEITURA), "default": "pipelines"},
                       "id": {"type": "string", "description": "id da oportunidade (com o=ver)"},
                       "pipeline": {"type": "string"}, "estagio": {"type": "string"},
                       "status": {"type": "string", "enum": ["open", "won", "lost", "abandoned", "all"]},
                       "contato": {"type": "string", "description": "só as oportunidades deste contato"},
                       "termo": {"type": "string", "description": "com o=buscar"},
                       "limite": {"type": "integer"}, "snapshot": _SNAP},
                      ["loc"]),
```

- [ ] **Step 5: Rodar a suíte inteira**

```bash
cd auditor && .venv/bin/python -m pytest -q
```

Esperado: todos passam, três a mais que antes.

- [ ] **Step 6: Commit**

```bash
git add auditor/src/automaster_audit/mcp_server.py auditor/tests/test_mcp_tools.py
git commit -m "feat(oportunidades): tool MCP de leitura"
```

---

### Task 5: Escrita de card no extractor e na CLI

**Files:**
- Modify: `extractor/src/api/opportunities.ts`
- Modify: `extractor/src/cli.ts`, `extractor/package.json`
- Read for reference: `extractor/src/cli.ts:498-505` (`registroEscrita`), `cli.ts:526-565` (`runWhatsappEnviar`, molde de comando de escrita com rastro antes e depois)

**Interfaces:**
- Consumes: `getOpportunity` da Task 2; `registroEscrita(loc, pasta, chave, dados)` do `cli.ts`.
- Produces: `createOpportunity`, `updateOpportunity`, `deleteOpportunity`, `restoreOpportunity`; comando `oportunidade-acao`.

- [ ] **Step 1: Acrescentar as funções de escrita ao módulo**

No fim de `extractor/src/api/opportunities.ts`. Ajuste as rotas ao que a Task 1 documentou se divergir:

```typescript
export interface OppCorpo {
  name?: string;
  status?: string;
  pipelineId?: string;
  pipelineStageId?: string;
  contactId?: string;
  monetaryValue?: number;
  assignedTo?: string;
  forecastExpectedCloseDate?: string;
  forecastProbability?: number;
  customFields?: { id: string; fieldValue: unknown }[];
}

/** ESCREVE: cria um card. `contactId` só se define aqui — não dá para trocar depois. */
export function createOpportunity(
  client: GhlClient, locationId: string, corpo: OppCorpo,
): Promise<unknown> {
  return client.postJson(`${OPP}/`, { locationId, ...corpo });
}

/** ESCREVE: edita um card. Mover de estágio é isto com `pipelineStageId` trocado. */
export function updateOpportunity(
  client: GhlClient, id: string, corpo: OppCorpo,
): Promise<unknown> {
  return client.putJson(`${OPP}/${id}`, corpo);
}

/** ESCREVE: apaga um card. Reversível por `restoreOpportunity`. */
export function deleteOpportunity(client: GhlClient, id: string): Promise<unknown> {
  return client.deleteJson(`${OPP}/${id}`);
}

/** ESCREVE: devolve à vida um card apagado. */
export function restoreOpportunity(client: GhlClient, id: string): Promise<unknown> {
  return client.putJson(`${OPP}/${id}/restore`, {});
}
```

- [ ] **Step 2: Escrever a função de execução na CLI**

A recusa de trocar o contato é regra de negócio decidida na spec: o vínculo é de nascença.

```typescript
const OPP_ACOES = ["criar", "editar", "mover", "status", "apagar", "restaurar"];

async function runOportunidadeAcao(opts: {
  location: string; acao: string; id?: string; pipeline?: string; estagio?: string;
  nome?: string; valor?: string; status?: string; contato?: string; dono?: string;
  confirmo?: boolean; json?: boolean;
}): Promise<void> {
  const log = opts.json ? console.error : console.log;
  if (!OPP_ACOES.includes(opts.acao)) {
    throw new Error(`--acao inválida: ${opts.acao}. Aceitas: ${OPP_ACOES.join(", ")}`);
  }
  if (!opts.confirmo) {
    throw new Error("Isto muda dado real da subconta e não tem desfazer. Repita com --confirmo.");
  }
  if (opts.acao === "criar") {
    if (!opts.pipeline || !opts.nome || !opts.contato) {
      throw new Error("criar exige --pipeline, --nome e --contato");
    }
  } else if (!opts.id) {
    throw new Error(`${opts.acao} exige --id da oportunidade`);
  }
  if (opts.acao !== "criar" && opts.contato) {
    throw new Error(
      "não dá para trocar o contato de uma oportunidade: o vínculo se define quando o card " +
      "nasce. Crie outro card para a pessoa certa.",
    );
  }

  await withClient(opts.location, log, async (client) => {
    const corpo = {
      ...(opts.nome ? { name: opts.nome } : {}),
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.pipeline ? { pipelineId: opts.pipeline } : {}),
      ...(opts.estagio ? { pipelineStageId: opts.estagio } : {}),
      ...(opts.contato ? { contactId: opts.contato } : {}),
      ...(opts.valor ? { monetaryValue: Number(opts.valor) } : {}),
      ...(opts.dono ? { assignedTo: opts.dono } : {}),
    };
    const antes = opts.id ? await getOpportunity(client, opts.id).catch(() => null) : null;
    const chave = opts.id ?? "novo";
    const registro = registroEscrita(opts.location, "_oportunidades", chave, {
      acao: opts.acao, corpo, antes, aplicado: false,
    });

    let r: unknown;
    switch (opts.acao) {
      case "criar": r = await createOpportunity(client, opts.location, corpo); break;
      case "editar":
      case "mover":
      case "status": r = await updateOpportunity(client, opts.id!, corpo); break;
      case "apagar": r = await deleteOpportunity(client, opts.id!); break;
      case "restaurar": r = await restoreOpportunity(client, opts.id!); break;
    }
    fs.writeFileSync(registro, JSON.stringify({
      em: new Date().toISOString(), acao: opts.acao, corpo, antes, aplicado: true, resposta: r,
    }, null, 2));
    const out = { aplicado: true, acao: opts.acao, resposta: r, registro };
    if (opts.json) console.log(JSON.stringify(out));
    else log(`ok — ${opts.acao}; registro em ${registro}`);
  });
}
```

Acrescente ao import da Task 3:

```typescript
import {
  listPipelines, listOpportunities, searchOpportunities, getOpportunity,
  createOpportunity, updateOpportunity, deleteOpportunity, restoreOpportunity,
} from "./api/opportunities.js";
```

- [ ] **Step 3: Registrar o comando**

```typescript
program
  .command("oportunidade-acao")
  .description("ESCREVE: cria, edita, move, apaga ou restaura uma oportunidade")
  .requiredOption("-l, --location <id>", "locationId da subconta")
  .requiredOption("--acao <a>", "criar | editar | mover | status | apagar | restaurar")
  .option("-i, --id <id>", "id da oportunidade (tudo menos criar)")
  .option("--pipeline <id>", "pipeline do card")
  .option("--estagio <id>", "estágio do card")
  .option("--nome <texto>", "nome do card")
  .option("--valor <n>", "valor monetário")
  .option("--status <s>", "open | won | lost | abandoned")
  .option("--contato <id>", "só na criação; o vínculo não se troca depois")
  .option("--dono <id>", "usuário responsável")
  .option("--confirmo", "obrigatório: muda dado real e não tem desfazer")
  .option("--json", "imprime o resultado em JSON no stdout")
  .action((o) => runOportunidadeAcao(o).catch((e) => { console.error(e.message); process.exit(1); }));
```

No `package.json`:

```json
    "oportunidade-acao": "tsx src/cli.ts oportunidade-acao"
```

- [ ] **Step 4: Conferir que compila e que a recusa funciona sem tocar a rede**

```bash
cd extractor && npx tsc --noEmit
npx tsx src/cli.ts oportunidade-acao -l X --acao editar -i abc
npx tsx src/cli.ts oportunidade-acao -l X --acao editar -i abc --contato c1 --confirmo
```

Esperado: a segunda linha imprime a recusa por falta de `--confirmo`; a terceira, a recusa de trocar o contato. Nenhuma das duas abre o Chrome.

- [ ] **Step 5: Commit**

```bash
git add extractor/src/api/opportunities.ts extractor/src/cli.ts extractor/package.json
git commit -m "feat(oportunidades): escrita de card no extractor e na CLI"
```

---

### Task 6: Tool MCP `oportunidade_acao`

**Files:**
- Modify: `auditor/src/automaster_audit/mcp_server.py`, `auditor/tests/test_mcp_tools.py`
- Read for reference: `mcp_server.py:410-429` (`whatsapp_enviar`), `tests/test_mcp_tools.py:419-430` (teste de tool de escrita)

**Interfaces:**
- Consumes: `_load`, `_run_extractor`, `ToolError`.
- Produces: `oportunidade_acao(loc, acao, id, pipeline, estagio, nome, valor, status, contato, dono, confirmo, snapshot) -> dict`; constante `OPP_ACOES`.

- [ ] **Step 1: Escrever os testes que falham**

```python
def test_oportunidade_acao_exige_confirmo(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(srv, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError) as e:
        srv.oportunidade_acao(LOC, acao="apagar", id="o1")
    assert "confirmo=true" in str(e.value)


def test_oportunidade_acao_recusa_trocar_contato(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(srv, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError) as e:
        srv.oportunidade_acao(LOC, acao="editar", id="o1", contato="c9", confirmo=True)
    assert "contato" in str(e.value)


def test_oportunidade_acao_criar_exige_os_tres_campos(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(srv, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError) as e:
        srv.oportunidade_acao(LOC, acao="criar", nome="Teto solar", confirmo=True)
    assert "pipeline" in str(e.value)


def test_oportunidade_acao_mover_chama_o_extractor(root, monkeypatch):
    root(workflows=[wf()])
    visto = {}
    monkeypatch.setattr(srv, "_run_extractor", lambda *a: visto.update(args=a) or {"aplicado": True})
    r = srv.oportunidade_acao(LOC, acao="mover", id="o1", estagio="s2", confirmo=True)
    assert r["aplicado"] is True
    assert "--estagio" in visto["args"] and "s2" in visto["args"]
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd auditor && .venv/bin/python -m pytest tests/test_mcp_tools.py -k oportunidade_acao -q
```

Esperado: FAIL com `AttributeError`.

- [ ] **Step 3: Escrever a tool**

```python
OPP_ACOES = ("criar", "editar", "mover", "status", "apagar", "restaurar")


def oportunidade_acao(loc: str, acao: str, id: str | None = None, pipeline: str | None = None,
                      estagio: str | None = None, nome: str | None = None,
                      valor: float | None = None, status: str | None = None,
                      contato: str | None = None, dono: str | None = None,
                      confirmo: bool = False, snapshot: str | None = None) -> dict:
    """ESCREVE: cria, edita, move, apaga ou restaura uma oportunidade."""
    if acao not in OPP_ACOES:
        raise ToolError(f"acao inválida: {acao}. Aceitas: {', '.join(OPP_ACOES)}")
    if not confirmo:
        raise ToolError("Isto muda dado real da subconta e não tem desfazer. Repita com confirmo=true.")
    if acao == "criar":
        if not (pipeline and nome and contato):
            raise ToolError("criar exige pipeline, nome e contato")
    elif not id:
        raise ToolError(f"{acao} exige o id da oportunidade")
    if acao != "criar" and contato:
        raise ToolError("não dá para trocar o contato de uma oportunidade: o vínculo se define "
                        "quando o card nasce. Crie outro card para a pessoa certa.")
    _, meta = _load(loc, snapshot)
    args = ["oportunidade-acao", "-l", loc, "--acao", acao, "--confirmo"]
    for flag, val in (("-i", id), ("--pipeline", pipeline), ("--estagio", estagio),
                      ("--nome", nome), ("--valor", str(valor) if valor is not None else None),
                      ("--status", status), ("--contato", contato), ("--dono", dono)):
        if val:
            args += [flag, val]
    return _run_extractor(*args, "--json") | {"_snapshot": meta}
```

- [ ] **Step 4: Registrar no dict TOOLS**

```python
    "oportunidade_acao": (oportunidade_acao, "ESCREVE EM PRODUÇÃO: cria, edita, move de estágio, muda o "
                          "status, apaga ou restaura uma oportunidade. Exige confirmo=true; registro em "
                          "<dumps>/_oportunidades/. `apagar` é reversível por `restaurar`. O contato de um "
                          "card só se define na criação e não pode ser trocado depois.",
                          {"loc": _LOC, "acao": {"type": "string", "enum": list(OPP_ACOES)},
                           "id": {"type": "string", "description": "id da oportunidade (tudo menos criar)"},
                           "pipeline": {"type": "string"}, "estagio": {"type": "string"},
                           "nome": {"type": "string"}, "valor": {"type": "number"},
                           "status": {"type": "string", "enum": ["open", "won", "lost", "abandoned"]},
                           "contato": {"type": "string", "description": "só na criação"},
                           "dono": {"type": "string", "description": "usuário responsável"},
                           "confirmo": {"type": "boolean", "default": False},
                           "snapshot": _SNAP},
                          ["loc", "acao"]),
```

- [ ] **Step 5: Rodar a suíte inteira**

```bash
cd auditor && .venv/bin/python -m pytest -q
```

Esperado: todos passam.

- [ ] **Step 6: Commit**

```bash
git add auditor/src/automaster_audit/mcp_server.py auditor/tests/test_mcp_tools.py
git commit -m "feat(oportunidades): tool MCP de escrita de card"
```

---

### Task 7: Escrita de pipeline, com a guarda do estágio com cards

Esta tarefa depende do contrato que a Task 1 escreveu. Se a sondagem mostrou que editar estágios manda a lista inteira, a guarda abaixo é indispensável — é ela que impede apagar uma coluna do funil por omissão.

**Files:**
- Modify: `extractor/src/api/opportunities.ts`, `extractor/src/cli.ts`, `extractor/package.json`

**Interfaces:**
- Consumes: `listPipelines`, `listOpportunities` da Task 2; `registroEscrita`.
- Produces: `createPipeline`, `updatePipeline`, `deletePipeline`; comando `pipeline`.

- [ ] **Step 1: Acrescentar as funções de pipeline ao módulo**

Use as rotas exatas da Task 1. A forma esperada:

```typescript
const PIPE = `${OPP}/pipelines`;

export interface PipeEstagio {
  id?: string;          // sem id = estágio novo
  name: string;
  position?: number;
}

/** ESCREVE: cria um pipeline com seus estágios. */
export function createPipeline(
  client: GhlClient, locationId: string, name: string, stages: PipeEstagio[],
): Promise<unknown> {
  return client.postJson(PIPE, { locationId, name, stages });
}

/**
 * ESCREVE: renomeia o pipeline e redefine seus estágios.
 * A lista de estágios é substitutiva: estágio ausente dela é removido.
 */
export function updatePipeline(
  client: GhlClient, locationId: string, id: string, name: string, stages: PipeEstagio[],
): Promise<unknown> {
  return client.putJson(`${PIPE}/${id}`, { locationId, name, stages });
}

/** ESCREVE: apaga um pipeline. NÃO tem restore. */
export function deletePipeline(
  client: GhlClient, locationId: string, id: string,
): Promise<unknown> {
  return client.deleteJson(`${PIPE}/${id}?locationId=${locationId}`);
}
```

- [ ] **Step 2: Escrever a função de execução com a guarda**

```typescript
const PIPE_ACOES = ["criar", "editar", "apagar"];

/** Estágios que sumiriam com a nova lista, e quantos cards vivem em cada um. */
async function estagiosQueSomem(
  client: GhlClient, locationId: string, pipelineId: string, novos: { id?: string; name: string }[],
): Promise<{ id: string; name: string; cards: number }[]> {
  const atual = await listPipelines(client, locationId) as { pipelines?: { id: string; stages?: { id: string; name: string }[] }[] };
  const p = (atual.pipelines ?? []).find((x) => x.id === pipelineId);
  if (!p) throw new Error(`pipeline ${pipelineId} não existe na subconta`);
  const mantidos = new Set(novos.map((s) => s.id).filter(Boolean));
  const somem = (p.stages ?? []).filter((s) => !mantidos.has(s.id));
  const out: { id: string; name: string; cards: number }[] = [];
  for (const s of somem) {
    const r = await listOpportunities(client, locationId, { pipelineId, pipelineStageId: s.id, status: "all", limit: 1 }) as { total?: number; opportunities?: unknown[] };
    out.push({ id: s.id, name: s.name, cards: r.total ?? (r.opportunities?.length ?? 0) });
  }
  return out.filter((s) => s.cards > 0);
}

async function runPipeline(opts: {
  location: string; acao: string; id?: string; nome?: string; estagios?: string;
  confirmo?: boolean; apagarComCards?: boolean; json?: boolean;
}): Promise<void> {
  const log = opts.json ? console.error : console.log;
  if (!PIPE_ACOES.includes(opts.acao)) {
    throw new Error(`--acao inválida: ${opts.acao}. Aceitas: ${PIPE_ACOES.join(", ")}`);
  }
  if (!opts.confirmo) {
    throw new Error("Isto muda a estrutura do funil e não tem desfazer. Repita com --confirmo.");
  }
  if (opts.acao !== "criar" && !opts.id) throw new Error(`${opts.acao} exige --id do pipeline`);
  if (opts.acao === "criar" && !opts.nome) throw new Error("criar exige --nome");

  let estagios: { id?: string; name: string; position?: number }[] = [];
  if (opts.estagios) {
    try { estagios = JSON.parse(opts.estagios); } catch { throw new Error("--estagios precisa ser JSON: [{\"id\":\"...\",\"name\":\"...\"}]"); }
    if (!Array.isArray(estagios)) throw new Error("--estagios precisa ser uma lista JSON");
  }
  if (opts.acao !== "apagar" && estagios.length === 0) {
    throw new Error(`${opts.acao} exige --estagios com a lista completa dos estágios que devem existir`);
  }

  await withClient(opts.location, log, async (client) => {
    if (opts.acao === "editar") {
      const somem = await estagiosQueSomem(client, opts.location, opts.id!, estagios);
      if (somem.length > 0 && !opts.apagarComCards) {
        const linhas = somem.map((s) => `  ${s.name} (${s.cards} card${s.cards > 1 ? "s" : ""})`).join("\n");
        throw new Error(
          `esta edição remove estágio que tem card dentro:\n${linhas}\n` +
          "Os cards somem junto e não voltam. Esvazie os estágios antes, ou repita com --apagar-com-cards.",
        );
      }
    }
    const registro = registroEscrita(opts.location, "_oportunidades", `pipeline-${opts.id ?? "novo"}`, {
      acao: opts.acao, nome: opts.nome, estagios,
      antes: await listPipelines(client, opts.location).catch(() => null),
      aplicado: false,
    });
    let r: unknown;
    switch (opts.acao) {
      case "criar": r = await createPipeline(client, opts.location, opts.nome!, estagios); break;
      case "editar": r = await updatePipeline(client, opts.location, opts.id!, opts.nome ?? "", estagios); break;
      case "apagar": r = await deletePipeline(client, opts.location, opts.id!); break;
    }
    fs.writeFileSync(registro, JSON.stringify({
      em: new Date().toISOString(), acao: opts.acao, aplicado: true, resposta: r,
    }, null, 2));
    const out = { aplicado: true, acao: opts.acao, resposta: r, registro };
    if (opts.json) console.log(JSON.stringify(out));
    else log(`ok — ${opts.acao}; registro em ${registro}`);
  });
}
```

Estenda o import com `createPipeline, updatePipeline, deletePipeline` e acrescente `import type { GhlClient } from "./api/client.js";` se ainda não houver um no `cli.ts`.

- [ ] **Step 3: Registrar o comando**

```typescript
program
  .command("pipeline")
  .description("ESCREVE: cria, edita ou apaga um pipeline e seus estágios")
  .requiredOption("-l, --location <id>", "locationId da subconta")
  .requiredOption("--acao <a>", "criar | editar | apagar")
  .option("-i, --id <id>", "id do pipeline (editar e apagar)")
  .option("--nome <texto>", "nome do pipeline")
  .option("--estagios <json>", "lista COMPLETA dos estágios: [{\"id\":\"...\",\"name\":\"...\"}]")
  .option("--apagar-com-cards", "libera remover estágio que tem card dentro; os cards somem junto")
  .option("--confirmo", "obrigatório: muda a estrutura do funil e não tem desfazer")
  .option("--json", "imprime o resultado em JSON no stdout")
  .action((o) => runPipeline(o).catch((e) => { console.error(e.message); process.exit(1); }));
```

No `package.json`:

```json
    "pipeline": "tsx src/cli.ts pipeline"
```

- [ ] **Step 4: Conferir que compila e que as recusas funcionam sem rede**

```bash
cd extractor && npx tsc --noEmit
npx tsx src/cli.ts pipeline -l X --acao editar -i p1
npx tsx src/cli.ts pipeline -l X --acao editar -i p1 --confirmo --estagios 'nao-e-json'
```

Esperado: a segunda recusa por falta de `--confirmo`; a terceira, por JSON inválido. Nenhuma abre o Chrome.

- [ ] **Step 5: Commit**

```bash
git add extractor/src/api/opportunities.ts extractor/src/cli.ts extractor/package.json
git commit -m "feat(oportunidades): escrita de pipeline com guarda de estagio com cards"
```

---

### Task 8: Tool MCP `pipeline`

**Files:**
- Modify: `auditor/src/automaster_audit/mcp_server.py`, `auditor/tests/test_mcp_tools.py`

**Interfaces:**
- Consumes: `_load`, `_run_extractor`, `ToolError`.
- Produces: `pipeline(loc, acao, id, nome, estagios, confirmo, apagar_com_cards, snapshot) -> dict`; constante `PIPE_ACOES`.

- [ ] **Step 1: Escrever os testes que falham**

```python
def test_pipeline_exige_confirmo(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(srv, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError) as e:
        srv.pipeline(LOC, acao="apagar", id="p1")
    assert "confirmo=true" in str(e.value)


def test_pipeline_editar_exige_lista_de_estagios(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(srv, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError) as e:
        srv.pipeline(LOC, acao="editar", id="p1", confirmo=True)
    assert "estagios" in str(e.value)


def test_pipeline_serializa_estagios_como_json(root, monkeypatch):
    root(workflows=[wf()])
    visto = {}
    monkeypatch.setattr(srv, "_run_extractor", lambda *a: visto.update(args=a) or {"aplicado": True})
    srv.pipeline(LOC, acao="criar", nome="zz", estagios=[{"name": "Novo"}], confirmo=True)
    assert '[{"name": "Novo"}]' in visto["args"]


def test_pipeline_passa_apagar_com_cards(root, monkeypatch):
    root(workflows=[wf()])
    visto = {}
    monkeypatch.setattr(srv, "_run_extractor", lambda *a: visto.update(args=a) or {"aplicado": True})
    srv.pipeline(LOC, acao="editar", id="p1", estagios=[{"id": "s1", "name": "A"}],
                 confirmo=True, apagar_com_cards=True)
    assert "--apagar-com-cards" in visto["args"]
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd auditor && .venv/bin/python -m pytest tests/test_mcp_tools.py -k pipeline -q
```

Esperado: FAIL com `AttributeError`.

- [ ] **Step 3: Escrever a tool**

```python
PIPE_ACOES = ("criar", "editar", "apagar")


def pipeline(loc: str, acao: str, id: str | None = None, nome: str | None = None,
             estagios: list | None = None, confirmo: bool = False,
             apagar_com_cards: bool = False, snapshot: str | None = None) -> dict:
    """ESCREVE: cria, edita ou apaga um pipeline e seus estágios."""
    if acao not in PIPE_ACOES:
        raise ToolError(f"acao inválida: {acao}. Aceitas: {', '.join(PIPE_ACOES)}")
    if not confirmo:
        raise ToolError("Isto muda a estrutura do funil e não tem desfazer. Repita com confirmo=true.")
    if acao == "criar" and not nome:
        raise ToolError("criar exige nome")
    if acao != "criar" and not id:
        raise ToolError(f"{acao} exige o id do pipeline")
    if acao != "apagar" and not estagios:
        raise ToolError("estagios é obrigatório e precisa trazer a lista COMPLETA dos estágios "
                        "que devem existir depois — estágio ausente da lista é removido")
    _, meta = _load(loc, snapshot)
    args = ["pipeline", "-l", loc, "--acao", acao, "--confirmo"]
    for flag, val in (("-i", id), ("--nome", nome)):
        if val:
            args += [flag, val]
    if estagios:
        args += ["--estagios", json.dumps(estagios)]
    if apagar_com_cards:
        args += ["--apagar-com-cards"]
    return _run_extractor(*args, "--json") | {"_snapshot": meta}
```

`json` já está importado no topo do `mcp_server.py`; confirme antes de rodar.

- [ ] **Step 4: Registrar no dict TOOLS**

```python
    "pipeline": (pipeline, "ESCREVE EM PRODUÇÃO: cria, edita ou apaga um pipeline. `estagios` é "
                 "SUBSTITUTIVO — estágio ausente da lista é removido, e some junto com os cards dele. "
                 "A tool recusa remover estágio que tem card dentro, a menos que apagar_com_cards=true. "
                 "Apagar pipeline NÃO tem restore; o estado anterior fica em <dumps>/_oportunidades/.",
                 {"loc": _LOC, "acao": {"type": "string", "enum": list(PIPE_ACOES)},
                  "id": {"type": "string", "description": "id do pipeline (editar e apagar)"},
                  "nome": {"type": "string"},
                  "estagios": {"type": "array", "items": {"type": "object"},
                               "description": "lista COMPLETA: [{id?, name, position?}]"},
                  "confirmo": {"type": "boolean", "default": False},
                  "apagar_com_cards": {"type": "boolean", "default": False,
                                       "description": "libera remover estágio com card dentro"},
                  "snapshot": _SNAP},
                 ["loc", "acao"]),
```

- [ ] **Step 5: Rodar a suíte inteira**

```bash
cd auditor && .venv/bin/python -m pytest -q
```

Esperado: todos passam.

- [ ] **Step 6: Commit**

```bash
git add auditor/src/automaster_audit/mcp_server.py auditor/tests/test_mcp_tools.py
git commit -m "feat(oportunidades): tool MCP de pipeline"
```

---

### Task 9: Validação ao vivo no pipeline descartável

O pipeline `Vendas` não é tocado em nenhum passo. Se qualquer passo falhar, pare, anote o erro, e vá direto ao passo de limpeza antes de investigar.

**Files:**
- Modify: `docs/endpoints.md` (marcar cada operação como exercitada ao vivo ou não)

- [ ] **Step 1: Criar o pipeline de teste**

```bash
cd extractor && npm run pipeline -- -l Xb9gDxwxYhdqtprGcb5E --acao criar --nome zz-teste-automaster \
  --estagios '[{"name":"Um"},{"name":"Dois"},{"name":"Tres"}]' --confirmo --json
```

Anote o id do pipeline e os ids dos três estágios da resposta.

- [ ] **Step 2: Criar um card no primeiro estágio**

```bash
npm run oportunidade-acao -- -l Xb9gDxwxYhdqtprGcb5E --acao criar \
  --pipeline <pipelineId> --estagio <estagioUmId> --nome "Card de teste" \
  --contato uWqujqll20tRuglV3mLt --valor 100 --confirmo --json
```

Anote o id do card.

- [ ] **Step 3: Ler de volta pelos quatro caminhos**

```bash
npm run oportunidades -- -l Xb9gDxwxYhdqtprGcb5E -o pipelines --json
npm run oportunidades -- -l Xb9gDxwxYhdqtprGcb5E -o listar --pipeline <pipelineId> --json
npm run oportunidades -- -l Xb9gDxwxYhdqtprGcb5E -o buscar --termo "Card de teste" --json
npm run oportunidades -- -l Xb9gDxwxYhdqtprGcb5E -o ver -i <cardId> --json
```

Esperado: o pipeline aparece com os três estágios; o card aparece na listagem, na busca e no detalhe, no estágio Um, com valor 100.

- [ ] **Step 4: Exercitar mover, editar e status**

```bash
npm run oportunidade-acao -- -l Xb9gDxwxYhdqtprGcb5E --acao mover -i <cardId> --estagio <estagioDoisId> --confirmo --json
npm run oportunidade-acao -- -l Xb9gDxwxYhdqtprGcb5E --acao editar -i <cardId> --nome "Card renomeado" --valor 250 --confirmo --json
npm run oportunidade-acao -- -l Xb9gDxwxYhdqtprGcb5E --acao status -i <cardId> --status won --confirmo --json
npm run oportunidades -- -l Xb9gDxwxYhdqtprGcb5E -o ver -i <cardId> --json
```

Esperado: a leitura final mostra o card no estágio Dois, com o nome novo, valor 250 e status `won`.

- [ ] **Step 5: Provar a guarda do estágio com cards**

O card está no estágio Dois. Tente editar o pipeline omitindo o Dois:

```bash
npm run pipeline -- -l Xb9gDxwxYhdqtprGcb5E --acao editar -i <pipelineId> --nome zz-teste-automaster \
  --estagios '[{"id":"<estagioUmId>","name":"Um"},{"id":"<estagioTresId>","name":"Tres"}]' --confirmo --json
```

Esperado: **recusa**, dizendo que o estágio Dois tem 1 card. Nada é gravado. Se ela não recusar, a guarda está quebrada — pare, conserte a Task 7 e repita.

- [ ] **Step 6: Exercitar editar estágios sem perda**

Renomeie um estágio vazio, mantendo os três na lista:

```bash
npm run pipeline -- -l Xb9gDxwxYhdqtprGcb5E --acao editar -i <pipelineId> --nome zz-teste-automaster \
  --estagios '[{"id":"<estagioUmId>","name":"Primeiro"},{"id":"<estagioDoisId>","name":"Dois"},{"id":"<estagioTresId>","name":"Tres"}]' --confirmo --json
npm run oportunidades -- -l Xb9gDxwxYhdqtprGcb5E -o pipelines --json
```

Esperado: o estágio Um agora se chama Primeiro, os outros dois intactos, o card ainda no Dois.

- [ ] **Step 7: Exercitar apagar e restaurar o card**

```bash
npm run oportunidade-acao -- -l Xb9gDxwxYhdqtprGcb5E --acao apagar -i <cardId> --confirmo --json
npm run oportunidades -- -l Xb9gDxwxYhdqtprGcb5E -o ver -i <cardId> --json
npm run oportunidade-acao -- -l Xb9gDxwxYhdqtprGcb5E --acao restaurar -i <cardId> --confirmo --json
npm run oportunidades -- -l Xb9gDxwxYhdqtprGcb5E -o ver -i <cardId> --json
```

Esperado: depois do apagar, o card some ou vem marcado como apagado; depois do restaurar, volta. Anote exatamente qual dos dois comportamentos o apagar produz.

- [ ] **Step 8: Limpar — apagar o pipeline de teste inteiro**

```bash
npm run pipeline -- -l Xb9gDxwxYhdqtprGcb5E --acao apagar -i <pipelineId> --confirmo --json
npm run oportunidades -- -l Xb9gDxwxYhdqtprGcb5E -o pipelines --json
```

Esperado: só o pipeline `Vendas` na lista, com os 9 estágios originais. O card de teste vai junto.

- [ ] **Step 9: Registrar o que foi exercitado**

Na seção `## Oportunidades` de `docs/endpoints.md`, marque cada operação com `ao vivo ✓` ou `só contrato`, no padrão da tabela de conversas. Anote o comportamento do apagar de card (some ou marca) e o do apagar de pipeline com card dentro.

- [ ] **Step 10: Commit**

```bash
git add docs/endpoints.md
git commit -m "docs(endpoints): oportunidades validadas ao vivo na Instaltech"
```

---

### Task 10: Fechar a release 0.6.0

**Files:**
- Modify: `.claude-plugin/plugin.json`, `CHANGELOG.md`, `skills/automaster-leitura/SKILL.md`, `CLAUDE.md`

- [ ] **Step 1: Subir a versão e corrigir a descrição do plugin**

Em `.claude-plugin/plugin.json`: `"version": "0.6.0"`, e troque a descrição, que ainda diz "oito tools" e está três releases atrasada:

```json
  "description": "Backup e auditoria de automações GoHighLevel: 21 tools MCP sobre o dump offline e sobre a subconta ao vivo (contato, conversas, WhatsApp, oportunidades e pipelines).",
```

- [ ] **Step 2: Escrever a entrada do CHANGELOG**

No topo de `CHANGELOG.md`, acima da 0.5.0, no mesmo formato:

```markdown
## 0.6.0 — 2026-09-19

Oportunidades: os funis e os cards da subconta, lidos e escritos ao vivo.

- **`oportunidades`**: pipelines e seus estágios, cards de um pipeline com filtro de
  estágio, status e contato, busca por termo livre, e um card pelo id. Só leitura, sempre
  ao vivo — não usa o dump.
- **`oportunidade_acao`**: cria, edita, move de estágio, muda o status, apaga e restaura um
  card. Exige `confirmo=true`; registro em `<dumps>/_oportunidades/`. O contato de um card
  se define na criação e não se troca depois — a tool recusa a tentativa e explica.
- **`pipeline`**: cria, edita e apaga pipeline. A lista de estágios é substitutiva, então
  estágio omitido é removido junto com os cards dele — a tool conta os cards antes e recusa,
  a menos que `apagar_com_cards=true`. Apagar pipeline não tem restore.

CLI: oportunidades, oportunidade-acao, pipeline.
```

- [ ] **Step 3: Acrescentar as três tools ao frontmatter da skill de leitura**

Em `skills/automaster-leitura/SKILL.md:2`, a lista nominal de tools na `description` é o gatilho da skill — tool fora dela não dispara. Acrescente `oportunidades, oportunidade_acao, pipeline` à enumeração (e `dumps`, que está faltando).

- [ ] **Step 4: Atualizar o CLAUDE.md**

Na linha que diz "expõe dezoito tools", troque para vinte e uma e acrescente os três nomes à lista entre parênteses. No bloco de comandos do extractor, acrescente:

```bash
npm run oportunidades -- -l <loc> -o pipelines --json          # funis, cards, busca (leitura)
npm run oportunidade-acao -- -l <loc> --acao mover -i <id> --estagio <sid> --confirmo --json  # ESCREVE
npm run pipeline -- -l <loc> --acao editar -i <id> --estagios '[...]' --confirmo --json       # ESCREVE: estrutura do funil
```

Atualize a contagem de testes na linha `.venv/bin/python -m pytest -q` para o número real depois desta release.

- [ ] **Step 5: Conferir tudo de uma vez**

```bash
cd extractor && npx tsc --noEmit && cd ../auditor && .venv/bin/python -m pytest -q
cd .. && python3 -c "import json; print(json.load(open('.claude-plugin/plugin.json'))['version'])"
```

Esperado: typecheck limpo, todos os testes passando, versão `0.6.0`.

- [ ] **Step 6: Commit**

```bash
git add .claude-plugin/plugin.json CHANGELOG.md skills/automaster-leitura/SKILL.md CLAUDE.md
git commit -m "chore(release): plugin 0.6.0 com oportunidades"
```
