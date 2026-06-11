# Plano de execução — Camada 2: Enumeração de caminhos

> Plano faseado, LLM-friendly. Cada fase é auto-contida e executável em contexto novo de chat.
> Fonte de verdade: `docs/superpowers/plans/2026-06-10-validation-layers-2-3-plan.md` (o "doc-mãe").
> O modelo do grafo de execução JÁ FOI reverso-engenheirado e JÁ ESTÁ implementado em `flow.py`. **NÃO re-derivar.**

## O que é a Camada 2 (resumo do doc-mãe, linha 10)

Enumerar TODOS os caminhos de execução de cada workflow — sequência de passos com rótulos legíveis dos ramos, ações de cada rota e onde termina. **Sem avaliar nenhuma condição** (isso é Camada 3). Não é regra de auditoria: é uma função (`enumerate_paths`), um relatório (`paths.md`) e um subcomando (`automaster-audit paths`).

---

## Fase 0 — Descoberta de documentação (CONCLUÍDA — resultado consolidado abaixo)

Subagentes leram doc-mãe, spec e código. Resultado consolidado; executores das fases seguintes NÃO precisam refazer esta descoberta, só consultar as citações.

### APIs permitidas (existem hoje, verificadas no código)

`auditor/src/automaster_audit/flow.py` (62 linhas, funções module-level, sem classes):
```python
def successors(step: dict) -> list[str]      # próximos nós (trata lista, string, goto)
def index_steps(wf: Workflow) -> dict[str, dict]   # {step_id: step_dict}
def roots(wf: Workflow) -> list[str]         # steps sem parent = entradas
def reachable(wf: Workflow) -> set[str]
def is_branch_node(step: dict) -> bool       # distingue container de ramo (flow.py:60)
```

`auditor/src/automaster_audit/loader.py`:
- `load_dump(path: Path) -> DumpContext` (loader.py:87); exceção `DumpError`.
- `Workflow` (loader.py:37-55): `.id`, `.name`, `.status`, `.raw`; property `.steps` = `raw.steps.templates`; `.triggers`.
- `DumpContext` (loader.py:58-84): mapas de nomes para rotular ações — `workflow_names`, `pipeline_names`, `stage_names`, `field_names`, `user_names` (todos `dict[str, str]`), além de `tag_names`, `cv_keys` etc.

CLI (`auditor/src/automaster_audit/cli.py`): padrão de subcomando com `-o/--output` em `run_graph` (cli.py:39-51) + registro no parser (cli.py:77-80) + lista de atalho em `main()` (cli.py:93).

Testes (`auditor/tests/conftest.py`): fixture `make_dump(workflows=..., tags=..., ...) -> Path` e helper module-level `wf(id, name, status, steps, triggers, updated_at)` que coloca `steps` em `raw.steps.templates`. Shapes prontos de steps sintéticos (linear+órfão, goto, if_else com branches): `tests/test_flow_logic.py:17-23, 41-43, 76-80, 87-92`.

### Modelo do grafo (citações — copiar, não re-derivar)

- Modelo completo (`next`/`parent`/`goto`/nós-branch): doc-mãe `:14-31` e docstring de `flow.py`.
  - `step.next`: string = linear; lista = container (`if_else` com `attributes.branches`, `find_opportunity` com `attributes.transitions`), ids da lista = nós-branch; ausente/`null` = terminal.
  - Nó-branch `if_else`: step `type:if_else` com `parent`=container, `attributes.if` (condição) ou `attributes.else`; container tem `attributes.branches=[{id,name},...]` (rótulos legíveis ficam AQUI, no container). `next` do nó-branch = corpo do ramo, `null` = ramo vazio → sai.
  - Nó-branch `find_opportunity`: step `type:transition`, `name` = "Opportunity Found"/"Opportunity Not Found".
  - `goto`: `attributes.targetNodeId`; `successors()` já inclui essa aresta.
- Tipos de step e atributos que carregam (para rótulos de ação): doc-mãe `:30-31`.
- Spec da Camada 2 (enumerate_paths, Path, corte de ciclo, cap ~500): doc-mãe `:37-53`.
- Exemplo literal do output Markdown da árvore de caminhos: doc-mãe `:45-52`.
- Plano de verificação (workflows reais + unit): doc-mãe `:55-58`.

### Anti-padrões (doc-mãe `:61` + descoberta)

- **NÃO avaliar condição** na Camada 2 (é enumeração, não simulação). Nada de ler `conditionOperator`/`conditionValue` para decidir caminho.
- **NÃO recursão sem corte de ciclo** (goto cria loops reais nos dumps).
- **NÃO cap silencioso** — truncou, loga/exibe.
- **NÃO inventar API**: `flow.py` não tem classe de grafo; arestas são implícitas via `successors(step)`. Não existe `models.py` — `Finding` mora em `finding.py` (irrelevante aqui: Camada 2 não produz `Finding`).
- **NÃO transformar o `raw`** do dump (contrato: spec `:138-141`).
- **NÃO teste ao vivo no GHL.**

### Decisões de design fixadas por este plano (lacunas do doc-mãe resolvidas)

1. `Path` = dataclass em `flow.py` (mesmo módulo de `enumerate_paths`, como manda doc-mãe `:40`).
2. Assinatura: `enumerate_paths(wf: Workflow, cap: int = 500) -> tuple[list[Path], bool]` — o `bool` é `truncated`. Cap configurável por parâmetro, default 500.
3. Saída em arquivo novo `path_report.py` (doc-mãe `:45` deixa "ou estender report.py" em aberto; arquivo novo evita acoplar com findings).
4. Surfacing: só subcomando `paths` + `paths.md`. Aba no dashboard ("e/ou", doc-mãe `:53`) fica FORA deste plano.
5. Log de truncamento: warning no stdout do CLI **e** linha visível no `paths.md`.
6. Rotulagem de ações usa `ctx` (nomes legíveis) e mora em `path_report.py`; `flow.py` permanece puro (só `wf`, sem `ctx`).

---

## Fase 1 — `enumerate_paths` + `Path` em `flow.py` (TDD)

### O que implementar

Em `auditor/src/automaster_audit/flow.py`, seguindo o modelo da docstring existente do próprio arquivo e doc-mãe `:40-44`:

1. Dataclass `Path`:
   ```python
   @dataclass
   class Path:
       steps: list[tuple[str, str | None]]  # (step_id, rótulo do ramo tomado ao entrar; None se linear)
       terminal: str                         # "exit" | "loop → <step_id>"
   ```
2. `enumerate_paths(wf: Workflow, cap: int = 500) -> tuple[list[Path], bool]`:
   - DFS a partir de `roots(wf)` usando `successors(step)` e `index_steps(wf)` existentes — **não** reimplementar travessia básica.
   - Em container (step cujo `next` é lista): ramificar um caminho por nó-branch; rótulo do ramo:
     - `if_else`: nome em `attributes.branches[{id,name}]` do **container**, casado pelo id do nó-branch; fallback `"ELSE"` se o nó-branch tem `attributes.else`.
     - `find_opportunity`: `name` do nó `type:transition` ("Opportunity Found"/"Opportunity Not Found").
   - Corte de ciclo: ao revisitar step já presente no caminho corrente, encerrar com `terminal = f"loop → {step_id}"`. Vale para `goto` e qualquer aresta de retorno.
   - `next` ausente/`null` → `terminal = "exit"`. Nó-branch com `next` null = ramo vazio → também `exit` (estrutura normal do GHL, não é erro).
   - Ao atingir `cap` paths: parar e retornar `truncated=True`.

### Referências de documentação

- Semântica de `next`/`parent`/nós-branch/goto: doc-mãe `2026-06-10-validation-layers-2-3-plan.md:14-31`; docstring de `flow.py`.
- Spec da função: doc-mãe `:40-44`.
- Helpers existentes a reutilizar: `flow.py` (`successors`, `index_steps`, `roots`).

### TDD — testes primeiro, em `auditor/tests/test_enumerate_paths.py`

Copiar o padrão de `tests/test_flow_logic.py` (imports, uso de `wf(...)` do conftest; shapes de steps sintéticos em `test_flow_logic.py:17-23, 41-43, 76-80, 87-92`). Casos mínimos (doc-mãe `:57-58`):

1. Workflow linear 3 steps → 1 path, terminal `exit`, rótulos todos `None`.
2. 1 container `if_else` com 2 ramos → exatamente 2 paths, cada um com o rótulo do ramo (nome vindo de `attributes.branches` do container).
3. `find_opportunity` com 2 transitions → 2 paths rotulados "Opportunity Found"/"Opportunity Not Found".
4. goto formando loop → path terminado com `loop → <id>`, **sem recursão infinita** (teste termina).
5. Cap: workflow com mais paths que `cap=2` → retorna 2 paths e `truncated=True`.
6. Ramo vazio (`next` null no nó-branch) → path termina `exit`, sem exceção.

### Checklist de verificação

- [ ] `cd auditor && .venv/bin/python -m pytest tests/test_enumerate_paths.py -q` — novos testes verdes.
- [ ] `.venv/bin/python -m pytest -q` — suíte completa verde (44 pré-existentes + novos).
- [ ] `grep -n "conditionOperator\|conditionValue\|conditionType" src/automaster_audit/flow.py` → **zero** ocorrências novas (nenhuma avaliação de condição).

### Guardas anti-padrão

- Não avaliar condição; rótulo vem de `branches[].name`/`transition.name`, nunca do conteúdo da condição.
- Não duplicar a lógica de `successors` (goto já está lá).
- Visited é **por caminho corrente** (permite diamantes/reconvergência), não global por workflow.

---

## Fase 2 — `path_report.py`: rótulos de ação + Markdown

### O que implementar

Arquivo novo `auditor/src/automaster_audit/path_report.py`:

1. `describe_step(step: dict, ctx: DumpContext) -> str` — rótulo legível por tipo de step, usando os atributos exatos do doc-mãe `:30-31` e os mapas de nomes do `DumpContext` (loader.py:58-84):
   - `sms` → `"SMS"`; `wait`/`drip` → `"Wait"`/`"Drip"`; `webhook` → `"Webhook"`; `manual-call` → `"Manual call"`.
   - `add_contact_tag`/`remove_contact_tag` → `attributes.tags` (nomes já legíveis).
   - `update_contact_field` → ids em `attributes.fields[].field` resolvidos via `ctx.field_names`.
   - `add_to_workflow` → `attributes.workflow_id` via `ctx.workflow_names`.
   - `internal_notification` → `attributes.sms.selectedUser` via `ctx.user_names`.
   - `internal_create_opportunity` → `pipelineId` via `ctx.pipeline_names` + stage (`__customInputFields__` `pipelineStageId`→`value`) via `ctx.stage_names`.
   - `assign_user` → chaves de `attributes.traffic_weightage` via `ctx.user_names`.
   - `goto` → `"goto → <step>"`; tipo desconhecido → o próprio `type` (fallback, nunca exceção).
   - Id sem nome no mapa → mostrar o id cru (não inventar nome, não lançar).
2. `build_paths_report(ctx: DumpContext) -> str` — Markdown com uma seção por workflow, árvore de caminhos no formato do **exemplo literal do doc-mãe `:45-52`** (copiar o formato de lá). Cada path: rótulos de ramo + ações resumidas + terminal. Workflows truncados ganham linha visível `⚠ truncado em <cap> caminhos`.
3. `write_paths_report(ctx: DumpContext, out: Path) -> Path` — grava o `.md`.

### Referências de documentação

- Tipos de step e atributos: doc-mãe `:30-31`.
- Formato de saída: doc-mãe `:45-52` (exemplo literal — seguir).
- Campos do `DumpContext`: Fase 0 deste plano / `loader.py:58-84`.

### TDD — estender `tests/test_enumerate_paths.py` ou criar `tests/test_path_report.py`

1. `describe_step` para `add_contact_tag`, `add_to_workflow` (com nome resolvido via `make_dump(workflows=[...])` contendo o workflow alvo) e tipo desconhecido (fallback = type).
2. `build_paths_report` num dump sintético com 1 if_else 2 ramos → Markdown contém os 2 rótulos de ramo e os terminais.
3. Truncamento: cap baixo → relatório contém a linha de truncamento.

### Checklist de verificação

- [ ] Testes novos verdes; suíte completa verde.
- [ ] `grep -n "conditionOperator\|conditionValue" src/automaster_audit/path_report.py` → zero.
- [ ] Saída é Markdown puro (sem HTML) — nomes do CRM não precisam de escape HTML aqui; **não** interpolar nomes dentro de sintaxe de tabela MD (usar listas/árvore como no exemplo do doc-mãe).

### Guardas anti-padrão

- Não acessar `raw.detail` para actions — actions vivem em `raw.steps.templates` (spec `:139`; a property `Workflow.steps` já faz isso).
- Não mutar/limpar `raw`.
- Nome não encontrado → id cru, nunca exceção (dumps antigos podem não ter `users/`, `custom_values/` — campos do ctx ficam vazios).

---

## Fase 3 — Subcomando CLI `paths`

### O que implementar

Em `auditor/src/automaster_audit/cli.py`, **copiar o padrão de `run_graph`** (cli.py:39-51) e do registro `p_graph` (cli.py:77-80):

1. `run_paths(args)`: `load_dump` (mesmo try/except `DumpError` → exit 2), `enumerate_paths`/`write_paths_report`, default de saída `<dump>/paths.md`, print do resumo (nº de workflows, nº total de paths, quantos truncados) + caminho do arquivo. Truncou → warning explícito no stdout.
2. Registrar `p_paths = sub.add_parser("paths", help="enumera caminhos de execução por workflow (Markdown)")` com `dump_path` e `-o/--output`.
3. Atualizar a lista de atalho em `main()` (cli.py:93) para incluir `"paths"`.

### Referências de documentação

- Surfacing especificado: doc-mãe `:53` (`automaster-audit paths <dump> [-o paths.md]`).
- Padrão a copiar: `cli.py:39-51` e `cli.py:77-80`.

### Checklist de verificação

- [ ] `.venv/bin/automaster-audit paths dumps/WPIUKW3L4lDyMhLhKYKG/<ts-mais-recente>/` roda sem erro e gera `paths.md` na pasta do dump.
- [ ] `.venv/bin/automaster-audit paths --help` mostra `-o`.
- [ ] `audit`, `graph`, `dashboard` continuam funcionando (atalho do `main()` intacto para caminho existente → `audit`).
- [ ] Suíte completa verde.

### Guardas anti-padrão

- Não mudar o comportamento dos subcomandos existentes nem o atalho "caminho → audit".
- Exit code: `paths` retorna 0 em sucesso (não é auditoria; truncamento não é erro).

---

## Fase 4 — Verificação final (doc-mãe `:55-58`)

### O que verificar

1. **Dump real, workflow pequeno:** rodar `paths` no dump mais recente de `dumps/WPIUKW3L4lDyMhLhKYKG/`; localizar `Cria oportunidades!` (8 steps) no `paths.md` e conferir manualmente que a árvore bate com a derivação à mão dos ramos Found/Not-Found (doc-mãe `:56`).
2. **Dump real, workflow grande:** `1A - Fluxo de prospecção ativa` (25 steps, if/else de dia-da-semana + goto) → caminhos por dia presentes + corte de loop marcado no goto (doc-mãe `:57`).
3. **Suíte:** `cd auditor && .venv/bin/python -m pytest -q` — tudo verde.
4. **Anti-padrões (grep):**
   - `grep -rn "conditionOperator\|conditionValue\|conditionType" auditor/src/automaster_audit/flow.py auditor/src/automaster_audit/path_report.py` → zero (nenhuma avaliação de condição entrou).
   - Confirmar que truncamento aparece quando forçado (rodar um teste com cap=1 ou inspecionar teste da Fase 2).
5. **Docs:** adicionar a linha do subcomando `paths` no bloco de comandos do `CLAUDE.md` (seção Auditor) e, se desejado, na tabela de saídas da spec. Nada mais — schemaVersion NÃO muda (formato do dump intocado).

### Critério de pronto

- [ ] Itens 1–4 acima confirmados com evidência (output colado).
- [ ] `CLAUDE.md` atualizado com o comando `paths`.
- [ ] Nenhum arquivo de `dumps/` modificado além dos `paths.md` gerados.

---

## Fora de escopo (explícito)

- Camada 3 (`simulate.py`, `contract.py`, `verify-contracts`) — doc-mãe `:63-76`, plano separado.
- Aba de paths no dashboard (doc-mãe `:53`, "e/ou" — adiado).
- Avaliação de condições, teste ao vivo no GHL, mudanças no extractor ou no formato do dump.
