# Formulários e surveys: leitura, submissões e auditoria — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dar ao automaster leitura ao vivo de formulários, surveys e suas submissões, e duas regras de auditoria que cruzam as referências de formulário dos workflows e dos calendários contra a lista real da subconta.

**Architecture:** o extractor ganha um módulo de leitura (`forms.ts`) e um comando de CLI `formularios`; o `extract` passa a gravar duas listas opcionais no dump; o auditor carrega essas listas no `DumpContext` e duas regras novas as consomem; o servidor MCP expõe uma tool `formularios` que chama o CLI ao vivo, como já fazem `oportunidades` e `agenda`.

**Tech Stack:** TypeScript + Playwright (extractor), Python 3.12 + pytest (auditor), MCP stdio.

**Spec:** `docs/superpowers/specs/2026-09-19-formularios-surveys-leitura-design.md`
**Pesquisa:** `docs/superpowers/research/2026-09-19-formularios-surveys-research.md`

## Global Constraints

- Host das rotas: `https://backend.leadconnectorhq.com`. Autenticação pelos dois tokens da sessão, como todo o resto do extractor — nunca PIT nem OAuth.
- Listas: `limit` máximo 50 (`422 limit must not be greater than 50`); paginar com `skip` até juntar `total`.
- Submissões: paginam por `page`, `limit` até 100, e trazem `meta.total`, `meta.nextPage`.
- `schemaVersion` continua **1**. Arquivo novo no dump é opcional e aditivo.
- Lista ausente do dump = regra no-op. Nunca gerar achado sem lista contra a qual cruzar.
- Id de formulário começado por `fb-` é o pseudo-formulário do lead gen do Facebook: nunca vira achado.
- `raw` do dump é a resposta da API intocada.
- Verificação antes de cada commit: em `auditor/`, `.venv/bin/python -m pytest -q` (201 testes hoje); em `extractor/`, `npx tsc --noEmit`.
- Subconta de validação: `Xb9gDxwxYhdqtprGcb5E` (Instaltech) — 10 formulários, 29 surveys, 6 pastas de survey.

---

### Task 1: leitura ao vivo no extractor (`forms.ts` + CLI `formularios`)

**Files:**
- Create: `extractor/src/api/forms.ts`
- Modify: `extractor/src/cli.ts` (runner novo junto de `runOportunidades`, por volta de `:859`; registro do comando junto de `:1532`)
- Modify: `extractor/package.json:20-32` (script npm)
- Test: não há unit test no extractor; a verificação é `npx tsc --noEmit` mais uma execução ao vivo.

**Interfaces:**
- Consumes: `GhlClient` de `./client.js`.
- Produces: `listForms(client, locationId)`, `listSurveys(client, locationId)`, `getForm(client, id)`, `getSurvey(client, locationId, id)`, `listFormSubmissions(client, locationId, f)`, `listSurveySubmissions(client, locationId, f)`, e a interface `SubFiltro`.

- [ ] **Step 1: criar `extractor/src/api/forms.ts`**

```ts
import type { GhlClient } from "./client.js";

/**
 * Formulários e surveys da subconta. Host interno, dois tokens da sessão — as
 * mesmas rotas existem na API pública v3, mas devolvendo só id e nome.
 * Rotas em docs/endpoints.md, seção `## Formulários e surveys`.
 */
const BASE = "https://backend.leadconnectorhq.com";

/** O servidor recusa mais que isto por página (422). */
const PAGINA = 50;

export interface SubFiltro {
  formId?: string;
  surveyId?: string;
  q?: string;        // contactId, nome, e-mail ou telefone
  startAt?: string;  // YYYY-MM-DD
  endAt?: string;    // YYYY-MM-DD
  limit?: number;    // até 100
  page?: number;     // a partir de 1
}

/** Varre todas as páginas de uma lista (`forms` ou `surveys`). */
async function listarTudo(
  client: GhlClient, rota: "forms" | "surveys", locationId: string,
): Promise<{ itens: unknown[]; total: number }> {
  const itens: unknown[] = [];
  let total = 0;
  for (let skip = 0; ; skip += PAGINA) {
    const url = `${BASE}/${rota}/?locationId=${locationId}&limit=${PAGINA}&skip=${skip}`;
    const resp = await client.getJson<Record<string, unknown>>(url);
    const pagina = (resp[rota] as unknown[]) ?? [];
    total = Number(resp.total ?? 0);
    itens.push(...pagina);
    if (pagina.length < PAGINA || itens.length >= total) break;
  }
  return { itens, total };
}

/** Todos os formulários da subconta, já paginados. Pasta não entra na lista. */
export async function listForms(client: GhlClient, locationId: string): Promise<unknown> {
  const { itens, total } = await listarTudo(client, "forms", locationId);
  return { forms: itens, total };
}

/** Todos os surveys da subconta, já paginados. */
export async function listSurveys(client: GhlClient, locationId: string): Promise<unknown> {
  const { itens, total } = await listarTudo(client, "surveys", locationId);
  return { surveys: itens, total };
}

/** Um formulário, com os campos em `form.formData`. */
export function getForm(client: GhlClient, id: string): Promise<unknown> {
  return client.getJson(`${BASE}/forms/${encodeURIComponent(id)}`);
}

/** Um survey. Aqui o locationId é obrigatório; no formulário, não. */
export function getSurvey(client: GhlClient, locationId: string, id: string): Promise<unknown> {
  return client.getJson(`${BASE}/surveys/${encodeURIComponent(id)}?locationId=${locationId}`);
}

function querySub(locationId: string, f: SubFiltro): string {
  const p = new URLSearchParams({ locationId });
  for (const [k, v] of Object.entries(f)) {
    if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  }
  return p.toString();
}

/** Submissões de formulário. Filtro vazio = a subconta inteira, mês corrente. */
export function listFormSubmissions(
  client: GhlClient, locationId: string, f: SubFiltro = {},
): Promise<unknown> {
  return client.getJson(`${BASE}/forms/submissions?${querySub(locationId, f)}`);
}

/** Submissões de survey. */
export function listSurveySubmissions(
  client: GhlClient, locationId: string, f: SubFiltro = {},
): Promise<unknown> {
  return client.getJson(`${BASE}/surveys/submissions?${querySub(locationId, f)}`);
}
```

- [ ] **Step 2: adicionar o runner no `extractor/src/cli.ts`**

Coloque imediatamente antes de `async function runOportunidades` (por volta de `:859`), e acrescente o import no topo do arquivo, junto dos outros de `./api/`:

```ts
import {
  listForms, listSurveys, getForm, getSurvey,
  listFormSubmissions, listSurveySubmissions,
} from "./api/forms.js";
```

```ts
async function runFormularios(opts: {
  location: string; o: string; tipo: string; id?: string; formulario?: string;
  termo?: string; inicio?: string; fim?: string; limite?: string; pagina?: string;
  json?: boolean;
}): Promise<void> {
  const log = opts.json ? console.error : console.log;
  if (opts.tipo !== "formulario" && opts.tipo !== "survey") {
    throw new Error(`--tipo inválido: ${opts.tipo}. Aceitos: formulario, survey`);
  }
  const survey = opts.tipo === "survey";
  await withClient(opts.location, log, async (client) => {
    const filtro = {
      [survey ? "surveyId" : "formId"]: opts.formulario,
      q: opts.termo,
      startAt: opts.inicio,
      endAt: opts.fim,
      limit: numeroOpcional(opts.limite, "limite", log),
      page: numeroOpcional(opts.pagina, "pagina", log),
    };
    let out: unknown;
    switch (opts.o) {
      case "lista":
        out = survey ? await listSurveys(client, opts.location) : await listForms(client, opts.location);
        break;
      case "detalhe":
        if (!opts.id) throw new Error("-o detalhe exige --id");
        out = survey ? await getSurvey(client, opts.location, opts.id) : await getForm(client, opts.id);
        break;
      case "submissoes":
        out = survey
          ? await listSurveySubmissions(client, opts.location, filtro)
          : await listFormSubmissions(client, opts.location, filtro);
        break;
      case "buscar": {
        if (!opts.termo) throw new Error("-o buscar exige --termo");
        // não existe busca por nome no servidor: a lista inteira é curta e vem numa varredura
        const alvo = opts.termo.toLowerCase();
        const todos = survey
          ? ((await listSurveys(client, opts.location)) as { surveys: { name?: string }[] }).surveys
          : ((await listForms(client, opts.location)) as { forms: { name?: string }[] }).forms;
        out = { itens: todos.filter((x) => (x.name ?? "").toLowerCase().includes(alvo)) };
        break;
      }
      default:
        throw new Error(`-o inválido: ${opts.o}. Aceitos: lista, detalhe, submissoes, buscar`);
    }
    if (opts.json) console.log(JSON.stringify(out));
    else console.log(JSON.stringify(out, null, 2));
  });
}
```

- [ ] **Step 3: registrar o comando**

Logo depois do bloco `program.command("oportunidades")` (por volta de `:1547`):

```ts
program
  .command("formularios")
  .description("Leitura ao vivo de formulários, surveys e suas submissões")
  .requiredOption("-l, --location <id>", "locationId da subconta")
  .option("-o, --o <op>", "lista | detalhe | submissoes | buscar", "lista")
  .option("--tipo <t>", "formulario | survey", "formulario")
  .option("-i, --id <id>", "id do formulário ou survey (com -o detalhe)")
  .option("--formulario <id>", "filtra as submissões por formulário ou survey")
  .option("--termo <texto>", "busca por nome (-o buscar) ou por contato/e-mail/telefone (-o submissoes)")
  .option("--inicio <data>", "primeira data das submissões, YYYY-MM-DD")
  .option("--fim <data>", "última data das submissões, YYYY-MM-DD")
  .option("--limite <n>", "quantas submissões trazer, até 100")
  .option("--pagina <n>", "página das submissões, a partir de 1")
  .option("--json", "imprime o resultado em JSON no stdout")
  .action((o) => runFormularios(o).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); }));
```

- [ ] **Step 4: script npm**

Em `extractor/package.json`, junto dos outros scripts (o último hoje é `"agenda-acao"`):

```json
    "formularios": "tsx src/cli.ts formularios",
```

- [ ] **Step 5: typecheck**

Run: `cd extractor && npx tsc --noEmit`
Expected: sem saída.

- [ ] **Step 6: verificar ao vivo na Instaltech**

```bash
cd extractor
npm run formularios -- -l Xb9gDxwxYhdqtprGcb5E -o lista --json
npm run formularios -- -l Xb9gDxwxYhdqtprGcb5E -o lista --tipo survey --json
npm run formularios -- -l Xb9gDxwxYhdqtprGcb5E -o submissoes --limite 5 --json
npm run formularios -- -l Xb9gDxwxYhdqtprGcb5E -o buscar --termo form --json
```

Expected: 10 formulários (`total: 10`), 29 surveys, submissões com `meta.total`, e a busca devolvendo os formulários cujo nome contém "form". Um `-o detalhe --id <um id da lista>` tem de trazer `form.formData`.

- [ ] **Step 7: commit**

```bash
git add extractor/src/api/forms.ts extractor/src/cli.ts extractor/package.json
git commit -m "feat(extractor): leitura de formularios, surveys e submissoes"
```

---

### Task 2: as duas listas no dump

**Files:**
- Modify: `extractor/src/dump/writer.ts:64-67` (union de nomes de entidade)
- Modify: `extractor/src/cli.ts:136-149` (laço de entidades opcionais do `runExtract`)

**Interfaces:**
- Consumes: `listForms`/`listSurveys` da Task 1.
- Produces: `forms.json` = `{fetchedAt, raw:{forms:[...], total:n}}` e `surveys.json` = `{fetchedAt, raw:{surveys:[...], total:n}}` na pasta do snapshot.

- [ ] **Step 1: abrir o union de nomes de arquivo**

Em `extractor/src/dump/writer.ts`, o parâmetro `name` de `writeEntity`:

```ts
    name: "pipelines" | "tags" | "custom_fields" | "users" | "calendars" | "custom_values"
      | "message_templates" | "whatsapp_templates" | "forms" | "surveys",
```

- [ ] **Step 2: gravar as duas listas no `runExtract`**

Em `extractor/src/cli.ts`, o laço que hoje tem só os dois templates (`:138-141`) passa a ter quatro entradas, e o comentário acima dele ganha a frase nova:

```ts
    // Templates, formulários e surveys: cada lista é opcional. Canal desligado na
    // subconta (WhatsApp, p.ex.) ou busca que falha vira warning no manifest, e a regra
    // que depende da lista fica no-op.
    for (const [nome, buscar] of [
      ["message_templates", () => fetchMessageTemplates(client, locationId)],
      ["whatsapp_templates", () => waTemplates(client, locationId)],
      ["forms", () => listForms(client, locationId)],
      ["surveys", () => listSurveys(client, locationId)],
    ] as const) {
```

- [ ] **Step 3: typecheck**

Run: `cd extractor && npx tsc --noEmit`
Expected: sem saída.

- [ ] **Step 4: extrair a Instaltech e conferir os dois arquivos**

```bash
cd extractor && npm run extract -- --location Xb9gDxwxYhdqtprGcb5E
ls -la ~/.automaster/dumps/Xb9gDxwxYhdqtprGcb5E/$(ls -t ~/.automaster/dumps/Xb9gDxwxYhdqtprGcb5E | head -1)/{forms,surveys}.json
```

Expected: os dois arquivos existem; `forms.json` tem `raw.total == 10` e `surveys.json` `raw.total == 29`.

- [ ] **Step 5: commit**

```bash
git add extractor/src/dump/writer.ts extractor/src/cli.ts
git commit -m "feat(extractor): forms.json e surveys.json no dump"
```

---

### Task 3: o auditor carrega as duas listas

**Files:**
- Modify: `auditor/src/automaster_audit/loader.py` (docstring do contrato em `:5-13`; campos do `DumpContext` junto de `:81-83`; chamada e função de carga junto de `_load_templates`, `:169` e `:176-203`)
- Modify: `auditor/tests/conftest.py:31-54` (`make_dump` aceita `forms=` e `surveys=`)
- Test: `auditor/tests/test_loader_forms.py` (novo)

**Interfaces:**
- Consumes: os arquivos da Task 2.
- Produces: `ctx.form_ids: set[str] | None`-por-tipo via `ctx.form_ids: dict[str, set[str]]` com as chaves `"form"` e `"survey"`, e `ctx.form_names: dict[str, str]`. Chave ausente do dict = lista ausente do dump (regra no-op); chave presente com conjunto vazio = subconta sem formulário.

- [ ] **Step 1: escrever o teste que falha**

Crie `auditor/tests/test_loader_forms.py`:

```python
from automaster_audit.loader import load_dump
from conftest import wf


def test_listas_ausentes_nao_criam_chave(make_dump):
    ctx = load_dump(make_dump(workflows=[wf()]))
    assert ctx.form_ids == {}
    assert ctx.form_names == {}


def test_listas_presentes_viram_ids_e_nomes(make_dump):
    path = make_dump(
        workflows=[wf()],
        forms=[{"_id": "F1", "name": "Contato"}],
        surveys=[{"_id": "S1", "name": "Pesquisa"}],
    )
    ctx = load_dump(path)
    assert ctx.form_ids == {"form": {"F1"}, "survey": {"S1"}}
    assert ctx.form_names["F1"] == "Contato"
    assert ctx.form_names["S1"] == "Pesquisa"


def test_lista_vazia_cria_chave_vazia(make_dump):
    ctx = load_dump(make_dump(workflows=[wf()], forms=[]))
    assert ctx.form_ids == {"form": set()}
```

- [ ] **Step 2: rodar e ver falhar**

Run: `cd auditor && .venv/bin/python -m pytest tests/test_loader_forms.py -q`
Expected: FAIL — `DumpContext` não tem `form_ids`, e `make_dump` não aceita `forms`.

- [ ] **Step 3: `make_dump` aceita as duas listas**

Em `auditor/tests/conftest.py`, na assinatura de `_build`:

```python
    def _build(workflows=None, tags=None, pipelines=None, fields=None,
               users=None, custom_values=None, calendars=None,
               message_templates=None, whatsapp_templates=None,
               forms=None, surveys=None,
               extracted_at="2026-06-10T00:00:00+00:00"):
```

e, junto dos outros arquivos opcionais (depois do `whatsapp_templates`):

```python
        if forms is not None:
            _write(root / "forms.json", {"raw": {"forms": forms, "total": len(forms)}})
        if surveys is not None:
            _write(root / "surveys.json", {"raw": {"surveys": surveys, "total": len(surveys)}})
```

- [ ] **Step 4: campos no `DumpContext`**

Em `auditor/src/automaster_audit/loader.py`, logo abaixo do bloco de templates (`:81-83`):

```python
    # formulários e surveys (ausentes em dumps anteriores; chave ausente = regra no-op)
    form_ids: dict[str, set[str]] = field(default_factory=dict)
    form_names: dict[str, str] = field(default_factory=dict)
```

- [ ] **Step 5: função de carga**

Em `loader.py`, chame `_load_forms(ctx, path)` na linha seguinte ao `_load_templates(ctx, path)` e escreva a função logo abaixo de `_load_templates`:

```python
def _load_forms(ctx: DumpContext, path: Path) -> None:
    """Preenche form_ids com as chaves 'form' e 'survey' (as duas listas são opcionais).

    Chave ausente = lista ausente do dump, e a regra que depende dela fica no-op.
    Pasta não aparece nessas listas: o servidor só a devolve com `type=folder`.
    """
    for chave, arquivo, campo in (
        ("form", path / "forms.json", "forms"),
        ("survey", path / "surveys.json", "surveys"),
    ):
        if not arquivo.exists():
            continue
        ids = set()
        for item in _entity_raw_optional(arquivo).get(campo, []) or []:
            fid = item.get("id") or item.get("_id")
            if fid:
                ids.add(str(fid))
                ctx.form_names[str(fid)] = item.get("name", str(fid))
        ctx.form_ids[chave] = ids
```

- [ ] **Step 6: atualizar a docstring do contrato**

Em `loader.py:5-13`, acrescente as duas linhas na lista de arquivos, no mesmo formato das existentes:

```
      forms.json                    {fetchedAt, raw:{forms:[...],total:n}}   (opcional)
      surveys.json                  {fetchedAt, raw:{surveys:[...],total:n}} (opcional)
```

- [ ] **Step 7: rodar a suíte inteira**

Run: `cd auditor && .venv/bin/python -m pytest -q`
Expected: os 3 testes novos passam e os 201 antigos continuam verdes.

- [ ] **Step 8: commit**

```bash
git add auditor/src/automaster_audit/loader.py auditor/tests/conftest.py auditor/tests/test_loader_forms.py
git commit -m "feat(audit): loader carrega forms.json e surveys.json"
```

---

### Task 4: as duas regras

**Files:**
- Create: `auditor/src/automaster_audit/rules/broken_form_ref.py`
- Create: `auditor/src/automaster_audit/rules/unused_form.py`
- Test: `auditor/tests/test_broken_form_ref.py`, `auditor/tests/test_unused_form.py`

**Interfaces:**
- Consumes: `ctx.form_ids`, `ctx.form_names` (Task 3), `ctx.calendars` (já existe), `wf.triggers`.
- Produces: achados `broken_form_ref` (ERROR) e `unused_form` (INFO). O registry por `pkgutil` descobre os arquivos sozinho; nada a registrar.

- [ ] **Step 1: teste da regra ERROR**

Crie `auditor/tests/test_broken_form_ref.py`:

```python
from automaster_audit.loader import load_dump
from automaster_audit.rules.broken_form_ref import check
from conftest import trig, wf


def form_cond(field, valores):
    return {"operator": "is-any-of", "field": field, "value": valores,
            "title": "Form is", "type": "string"}


def test_sem_lista_nao_acusa(make_dump):
    ctx = load_dump(make_dump(workflows=[
        wf(triggers=[trig("form_submission", "wf1", conditions=[form_cond("form.id", ["SUMIU"])])]),
    ]))
    assert check(ctx) == []


def test_acusa_trigger_com_formulario_inexistente(make_dump):
    ctx = load_dump(make_dump(
        workflows=[wf(triggers=[trig("form_submission", "wf1", conditions=[form_cond("form.id", ["SUMIU"])])])],
        forms=[{"_id": "F1", "name": "Contato"}],
    ))
    f = check(ctx)
    assert len(f) == 1
    assert f[0].severity == "ERROR" and "SUMIU" in f[0].detail


def test_trigger_com_formulario_existente_fica_calado(make_dump):
    ctx = load_dump(make_dump(
        workflows=[wf(triggers=[trig("form_submission", "wf1", conditions=[form_cond("form.id", ["F1"])])])],
        forms=[{"_id": "F1", "name": "Contato"}],
    ))
    assert check(ctx) == []


def test_survey_usa_a_lista_de_survey(make_dump):
    ctx = load_dump(make_dump(
        workflows=[wf(triggers=[trig("survey_submission", "wf1", conditions=[form_cond("survey.id", ["S9"])])])],
        forms=[{"_id": "F1"}], surveys=[{"_id": "S1"}],
    ))
    assert len(check(ctx)) == 1


def test_pseudo_formulario_do_facebook_nao_acusa(make_dump):
    ctx = load_dump(make_dump(
        workflows=[wf(triggers=[trig("form_submission", "wf1",
                                     conditions=[form_cond("form.id", ["fb-TESTLOC"])])])],
        forms=[{"_id": "F1"}],
    ))
    assert check(ctx) == []


def test_calendario_com_formulario_apagado(make_dump):
    ctx = load_dump(make_dump(
        workflows=[wf(triggers=[])],
        forms=[{"_id": "F1"}],
        calendars=[{"id": "C1", "name": "Reunião", "formId": "SUMIU"}],
    ))
    f = check(ctx)
    assert len(f) == 1
    assert "Reunião" in f[0].detail and f[0].workflow_id == ""
```

- [ ] **Step 2: rodar e ver falhar**

Run: `cd auditor && .venv/bin/python -m pytest tests/test_broken_form_ref.py -q`
Expected: FAIL com `ModuleNotFoundError: automaster_audit.rules.broken_form_ref`.

- [ ] **Step 3: escrever a regra ERROR**

Crie `auditor/src/automaster_audit/rules/broken_form_ref.py`:

```python
"""ERROR: referência a formulário ou survey que não existe mais na subconta.

Duas fontes: o trigger `form_submission`/`survey_submission`, cuja condição lista os
ids que disparam o fluxo, e o `formId` do calendário. As duas listas do dump são
opcionais — sem lista, sem achado, senão toda subconta com dump antigo viraria erro.

Id começado por `fb-` é o pseudo-formulário do lead gen do Facebook: ele nunca aparece
na lista de formulários e não é referência quebrada.
"""
from __future__ import annotations

from ..finding import ERROR, Finding
from ..loader import DumpContext

# tipo de trigger -> (lista que o valida, campo da condição)
TRIGGER = {
    "form_submission": ("form", "form.id"),
    "survey_submission": ("survey", "survey.id"),
}

FACEBOOK = "fb-"


def _citados(cond: dict) -> list[str]:
    valor = cond.get("value")
    if isinstance(valor, list):
        return [str(v) for v in valor if v]
    return [str(valor)] if valor else []


def check(ctx: DumpContext) -> list[Finding]:
    findings: list[Finding] = []

    for wf in ctx.workflows:
        for trigger in wf.triggers:
            alvo = TRIGGER.get(trigger.get("type"))
            if not alvo:
                continue
            chave, campo = alvo
            conhecidos = ctx.form_ids.get(chave)
            if conhecidos is None:  # lista ausente do dump: nada a cruzar
                continue
            for cond in trigger.get("conditions") or []:
                if cond.get("field") != campo:
                    continue
                for fid in _citados(cond):
                    if fid.startswith(FACEBOOK) or fid in conhecidos:
                        continue
                    rotulo = "formulário" if chave == "form" else "survey"
                    findings.append(
                        Finding(
                            rule="broken_form_ref",
                            severity=ERROR,
                            workflow_id=wf.id,
                            workflow_name=wf.name,
                            detail=f"trigger '{trigger.get('name', trigger.get('type'))}' "
                                   f"dispara por {rotulo} inexistente: {fid}",
                        )
                    )

    conhecidos = ctx.form_ids.get("form")
    if conhecidos is not None:
        for cal in ctx.calendars:
            fid = str(cal.get("formId") or "").strip()
            if not fid or fid.startswith(FACEBOOK) or fid in conhecidos:
                continue
            findings.append(
                Finding(
                    rule="broken_form_ref",
                    severity=ERROR,
                    workflow_id="",
                    workflow_name="",
                    detail=f"calendário '{cal.get('name', cal.get('id'))}' usa formulário "
                           f"inexistente: {fid}",
                )
            )
    return findings
```

- [ ] **Step 4: rodar e ver passar**

Run: `cd auditor && .venv/bin/python -m pytest tests/test_broken_form_ref.py -q`
Expected: 6 passed.

- [ ] **Step 5: teste da regra INFO**

Crie `auditor/tests/test_unused_form.py`:

```python
from automaster_audit.loader import load_dump
from automaster_audit.rules.unused_form import check
from conftest import trig, wf


def form_cond(field, valores):
    return {"operator": "is-any-of", "field": field, "value": valores,
            "title": "Form is", "type": "string"}


def test_sem_lista_nao_acusa(make_dump):
    assert check(load_dump(make_dump(workflows=[wf(triggers=[])]))) == []


def test_formulario_sem_uso_vira_info(make_dump):
    ctx = load_dump(make_dump(
        workflows=[wf(triggers=[])],
        forms=[{"_id": "F1", "name": "Esquecido"}],
    ))
    f = check(ctx)
    assert len(f) == 1
    assert f[0].severity == "INFO" and "Esquecido" in f[0].detail
    assert "site externo" in f[0].detail


def test_formulario_usado_em_trigger_nao_e_orfao(make_dump):
    ctx = load_dump(make_dump(
        workflows=[wf(triggers=[trig("form_submission", "wf1", conditions=[form_cond("form.id", ["F1"])])])],
        forms=[{"_id": "F1", "name": "Usado"}],
    ))
    assert check(ctx) == []


def test_formulario_usado_em_calendario_nao_e_orfao(make_dump):
    ctx = load_dump(make_dump(
        workflows=[wf(triggers=[])],
        forms=[{"_id": "F1", "name": "Do calendário"}],
        calendars=[{"id": "C1", "name": "Reunião", "formId": "F1"}],
    ))
    assert check(ctx) == []


def test_survey_orfao_tambem_conta(make_dump):
    ctx = load_dump(make_dump(workflows=[wf(triggers=[])], surveys=[{"_id": "S1", "name": "Pesquisa"}]))
    assert len(check(ctx)) == 1
```

- [ ] **Step 6: rodar e ver falhar**

Run: `cd auditor && .venv/bin/python -m pytest tests/test_unused_form.py -q`
Expected: FAIL com `ModuleNotFoundError: automaster_audit.rules.unused_form`.

- [ ] **Step 7: escrever a regra INFO**

Crie `auditor/src/automaster_audit/rules/unused_form.py`:

```python
"""INFO: formulário ou survey que existe na subconta e ninguém referencia.

É INFO, nunca ERROR: um formulário embutido num site externo, num funil ou numa
landing page não aparece em lugar nenhum do dump, e seria acusado à toa. O achado
serve para revisão humana, não para conserto automático.
"""
from __future__ import annotations

from ..finding import INFO, Finding
from ..loader import DumpContext
from .broken_form_ref import TRIGGER, _citados


def _referenciados(ctx: DumpContext) -> set[str]:
    usados: set[str] = set()
    for wf in ctx.workflows:
        for trigger in wf.triggers:
            alvo = TRIGGER.get(trigger.get("type"))
            if not alvo:
                continue
            _, campo = alvo
            for cond in trigger.get("conditions") or []:
                if cond.get("field") == campo:
                    usados.update(_citados(cond))
    for cal in ctx.calendars:
        fid = str(cal.get("formId") or "").strip()
        if fid:
            usados.add(fid)
    return usados


def check(ctx: DumpContext) -> list[Finding]:
    usados = _referenciados(ctx)
    findings: list[Finding] = []
    for chave, rotulo in (("form", "formulário"), ("survey", "survey")):
        for fid in sorted(ctx.form_ids.get(chave, set())):
            if fid in usados:
                continue
            findings.append(
                Finding(
                    rule="unused_form",
                    severity=INFO,
                    workflow_id="",
                    workflow_name="",
                    detail=f"{rotulo} '{ctx.form_names.get(fid, fid)}' não é citado por nenhum "
                           f"trigger nem calendário — pode estar embutido num site externo, "
                           f"que o dump não enxerga",
                )
            )
    return findings
```

- [ ] **Step 8: rodar a suíte inteira**

Run: `cd auditor && .venv/bin/python -m pytest -q`
Expected: tudo verde. Se `test_loader_and_report.py` ou `test_mcp_tools.py` reclamarem de contagem de severidade, é sinal de que uma regra falou num dump sintético sem lista — o guard de "lista ausente" está errado; conserte-o, não o teste.

- [ ] **Step 9: rodar a auditoria no dump real**

```bash
cd auditor && .venv/bin/automaster-audit audit ~/.automaster/dumps/Xb9gDxwxYhdqtprGcb5E/$(ls -t ~/.automaster/dumps/Xb9gDxwxYhdqtprGcb5E | head -1)/
grep -n "broken_form_ref\|unused_form" ~/.automaster/dumps/Xb9gDxwxYhdqtprGcb5E/$(ls -t ~/.automaster/dumps/Xb9gDxwxYhdqtprGcb5E | head -1)/report.md
```

Expected: exatamente um `broken_form_ref`, o trigger "Formulário Enviado" citando `bblZYCoXk6rf3xl7ehyO` (formulário apagado, confirmado 404 na pesquisa). Os `unused_form` são INFO e podem ser vários — confira por amostragem que cada um realmente não é citado.

- [ ] **Step 10: commit**

```bash
git add auditor/src/automaster_audit/rules/broken_form_ref.py auditor/src/automaster_audit/rules/unused_form.py auditor/tests/test_broken_form_ref.py auditor/tests/test_unused_form.py
git commit -m "feat(audit): broken_form_ref e unused_form"
```

---

### Task 5: tool MCP `formularios`, documentação e versão do plugin

**Files:**
- Modify: `auditor/src/automaster_audit/mcp_server.py` (função junto de `oportunidades`, `:549`; entrada no dict `TOOLS`, junto de `:879`)
- Test: `auditor/tests/test_mcp_tools.py` (testes novos no fim do arquivo)
- Modify: `docs/endpoints.md` (seção nova no fim), `CLAUDE.md` (linhas 18 e 30), `.claude-plugin/plugin.json`, `skills/automaster-leitura/SKILL.md`, `CHANGELOG.md`

**Interfaces:**
- Consumes: o comando `formularios` do CLI (Task 1) e `_run_extractor`/`_load` do próprio servidor.
- Produces: tool `formularios(loc, o, tipo, id, formulario, termo, inicio, fim, limite, pagina, snapshot) -> {"resultado": ..., "_snapshot": ...}`.

- [ ] **Step 1: escrever os testes que falham**

No fim de `auditor/tests/test_mcp_tools.py`:

```python
def test_formularios_recusa_operacao_invalida(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(srv, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError, match="inválido"):
        srv.formularios(LOC, o="inventar")


def test_formularios_recusa_tipo_invalido(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(srv, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError, match="tipo"):
        srv.formularios(LOC, tipo="planilha")


def test_formularios_detalhe_exige_id(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(srv, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError, match="id"):
        srv.formularios(LOC, o="detalhe")


def test_formularios_passa_filtros_ao_extractor(root, monkeypatch):
    root(workflows=[wf()])
    visto = {}
    monkeypatch.setattr(srv, "_run_extractor", lambda *a: visto.update(args=a) or {"submissions": []})
    r = srv.formularios(LOC, o="submissoes", tipo="survey", formulario="S1",
                        inicio="2026-09-01", limite=5)
    assert r["resultado"] == {"submissions": []}
    assert "--tipo" in visto["args"] and "survey" in visto["args"]
    assert "--formulario" in visto["args"] and "S1" in visto["args"]
    assert "--inicio" in visto["args"] and "2026-09-01" in visto["args"]
    assert "--limite" in visto["args"] and "5" in visto["args"]
```

- [ ] **Step 2: rodar e ver falhar**

Run: `cd auditor && .venv/bin/python -m pytest tests/test_mcp_tools.py -q -k formularios`
Expected: FAIL com `AttributeError: module ... has no attribute 'formularios'`.

- [ ] **Step 3: escrever a função da tool**

Em `auditor/src/automaster_audit/mcp_server.py`, junto das constantes de enum (`:544`):

```python
FORM_LEITURA = ("lista", "detalhe", "submissoes", "buscar")
FORM_TIPOS = ("formulario", "survey")
```

e a função, logo antes de `def oportunidades(`:

```python
def formularios(loc: str, o: str = "lista", tipo: str = "formulario", id: str | None = None,
                formulario: str | None = None, termo: str | None = None,
                inicio: str | None = None, fim: str | None = None,
                limite: int | None = None, pagina: int | None = None,
                snapshot: str | None = None) -> dict:
    """Leitura ao vivo de formulários, surveys e suas submissões."""
    if o not in FORM_LEITURA:
        raise ToolError(f"o inválido: {o}. Aceitos: {', '.join(FORM_LEITURA)}")
    if tipo not in FORM_TIPOS:
        raise ToolError(f"tipo inválido: {tipo}. Aceitos: {', '.join(FORM_TIPOS)}")
    if o == "detalhe" and not id:
        raise ToolError("o=detalhe exige id do formulário ou survey")
    if o == "buscar" and not termo:
        raise ToolError("o=buscar exige termo")
    _, meta = _load(loc, snapshot)
    args = ["formularios", "-l", loc, "-o", o, "--tipo", tipo]
    for flag, val in (("-i", id), ("--formulario", formulario), ("--termo", termo),
                      ("--inicio", inicio), ("--fim", fim),
                      ("--limite", str(limite) if limite else None),
                      ("--pagina", str(pagina) if pagina else None)):
        if val:
            args += [flag, val]
    return {"resultado": _run_extractor(*args, "--json"), "_snapshot": meta}
```

- [ ] **Step 4: registrar no dict `TOOLS`**

Junto da entrada `"oportunidades"`:

```python
    "formularios": (formularios, "Leitura ao vivo de formulários e surveys (abre Chrome, não usa o dump): "
                    "`lista` (todos, já paginados), `detalhe` (um, com os campos), `submissoes` (respostas, "
                    "com filtro de formulário, contato e período), `buscar` (por nome). O parâmetro `tipo` "
                    "escolhe entre formulário e survey. O id `fb-<locationId>` nas submissões é o formulário "
                    "de lead do Facebook, não um formulário da subconta.",
                    {"loc": _LOC, "o": {"type": "string", "enum": list(FORM_LEITURA), "default": "lista"},
                     "tipo": {"type": "string", "enum": list(FORM_TIPOS), "default": "formulario"},
                     "id": {"type": "string", "description": "id do formulário ou survey (com o=detalhe)"},
                     "formulario": {"type": "string", "description": "filtra as submissões por formulário ou survey"},
                     "termo": {"type": "string", "description": "nome (o=buscar) ou contato/e-mail/telefone (o=submissoes)"},
                     "inicio": {"type": "string", "description": "primeira data das submissões, YYYY-MM-DD"},
                     "fim": {"type": "string", "description": "última data das submissões, YYYY-MM-DD"},
                     "limite": {"type": "integer", "description": "quantas submissões, até 100"},
                     "pagina": {"type": "integer", "description": "página das submissões, a partir de 1"},
                     "snapshot": _SNAP},
                    ["loc"]),
```

- [ ] **Step 5: rodar a suíte inteira**

Run: `cd auditor && .venv/bin/python -m pytest -q`
Expected: tudo verde.

- [ ] **Step 6: documentar as rotas**

Acrescente ao fim de `docs/endpoints.md` uma seção `## Formulários e surveys` com: as seis rotas da Task 1 (host `backend`, os dois tokens); o teto de 50 por página e o `422 limit must not be greater than 50`; `skip` na lista e `page`/`meta` nas submissões; `type=folder` devolvendo as pastas nos surveys e sendo **ignorado** nos formulários; o detalhe trazendo os campos em `formData` (e o CSS do survey em `formData.fieldCSS`); `deleted` não sendo parâmetro (422); id inexistente em `/forms/<id>` dando 404 `Form not found!` e em `/surveys/<id>` dando 400 `Survey does not exist`; e o pseudo-id `fb-<locationId>` das submissões vindas do Facebook.

- [ ] **Step 7: atualizar os textos que ficaram desatualizados**

- `CLAUDE.md:18` — "8 entidades" vira 10, com `forms` e `surveys` na lista.
- `CLAUDE.md:30` — "vinte e quatro tools" vira vinte e cinco, com `formularios` na lista nominal.
- `CLAUDE.md` — a lista de regras passa de 14 para 16, citando `broken_form_ref` (ERROR) e `unused_form` (INFO).
- `CLAUDE.md`, bloco de comandos do extractor — acrescente `npm run formularios -- -l <loc> -o lista --json`.
- `.claude-plugin/plugin.json` — versão nova e a contagem de tools corrigida para 25 (o texto diz 23 e já estava errado).
- `skills/automaster-leitura/SKILL.md:3` — `formularios` na lista de tools do frontmatter, e um parágrafo no corpo dizendo como ler o resultado: `unused_form` é revisão, não conserto, e id `fb-` não é formulário da subconta.
- `CHANGELOG.md` — entrada da versão nova descrevendo a tool, as duas regras, os dois arquivos de dump e o comando de CLI.

- [ ] **Step 8: verificar o servidor MCP de pé**

```bash
cd auditor && AUTOMASTER_DUMPS=~/.automaster/dumps .venv/bin/python -c "
from automaster_audit import mcp_server as s
print(len(s.TOOLS), 'formularios' in s.TOOLS)"
```

Expected: `25 True`.

- [ ] **Step 9: commit**

```bash
git add -A
git commit -m "feat(mcp): tool formularios, docs e versao do plugin"
```

---

## Verificação final

- [ ] `cd auditor && .venv/bin/python -m pytest -q` — verde, com os 14 testes novos somados aos 201.
- [ ] `cd extractor && npx tsc --noEmit` — sem saída.
- [ ] `automaster-audit audit` no snapshot novo da Instaltech mostra um `broken_form_ref` e nenhum erro novo além dele.
- [ ] Um dump antigo (por exemplo `Xb9gDxwxYhdqtprGcb5E/2026-07-30_1221`) ainda carrega e não ganha nenhum achado das regras novas.
