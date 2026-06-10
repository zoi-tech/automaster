# Plano — Validação de workflows, Camadas 2 e 3

**Status:** aprovado, a executar na próxima sessão.
**Objetivo do usuário:** "validar se as automações funcionam como deveriam".
**Decisão:** construir 1 + 2 + 3 (não live). Camada 1 ✅ feita. Este doc cobre 2 e 3.

## Decisões já tomadas

- **Camada 1 — lógica sã (estática):** ✅ entregue (commit `2e59368`). Ver `auditor/src/automaster_audit/flow.py` + regras `unreachable_step`, `broken_goto`, `workflow_call_cycle`, `uncovered_condition`.
- **Camada 2 — enumeração de caminhos (abordagem A):** lista TODOS os caminhos de execução de cada workflow, com as ações de cada rota e onde termina, usando os rótulos legíveis dos ramos. **Sem avaliar condição** → zero risco semântico. Responde "o que esse workflow faz?" tornando a lógica legível.
- **Camada 3 — teste de contrato (funde a abordagem B):** usuário declara cenário + resultado esperado; a ferramenta avalia o subconjunto documentado de condições, escolhe o caminho e compara com o esperado. Condições não suportadas → marcar "ambíguo", não falhar silenciosamente.
- **NÃO fazer:** teste ao vivo no GHL (escreve em produção).

## Modelo do grafo de execução (reverso-engenheirado — NÃO re-derivar)

Validado contra dump real (`dumps/WPIUKW3L4lDyMhLhKYKG/`). Já implementado em `flow.py`:

- Cada step tem `id`. `attributes` carrega a config.
- **`next`**:
  - string → próximo step (linear)
  - **lista** → step é um **container** (`if_else` com `attributes.branches`, ou `find_opportunity` com `attributes.transitions`); os ids da lista são **nós-branch**.
  - ausente/`null` → terminal (contato sai do workflow).
- **Nós-branch:**
  - `if_else`: o container tem `attributes.branches=[{id,name},...]`; cada nó-branch é um step `type:if_else` com `parent`=container e SEM `branches` (tem `attributes.if`=condição, ou `attributes.else` se for o ramo ELSE). O `next` do nó-branch = primeiro step do corpo do ramo (ou `null` = ramo vazio → sai).
  - `find_opportunity`: nós-branch são `type:transition` (`name` = "Opportunity Found"/"Opportunity Not Found"), `parent`=find_opportunity, `next` = corpo do ramo.
- **`parent`** = aresta de entrada (de onde veio). Step sem `parent` = **raiz** (entrada após o trigger). Normalmente 1 raiz.
- **`goto`**: `attributes.targetNodeId` = id do step alvo (salto no mesmo workflow). `flow.successors()` já inclui essa aresta.
- **Helpers prontos em `flow.py`:** `successors(step)`, `index_steps(wf)`, `roots(wf)`, `reachable(wf)`, `is_branch_node(step)`.

### Tipos de step e o que carregam (do dump real)
`if_else` (container/branch), `wait`, `sms`, `webhook`, `transition`, `add_contact_tag`/`remove_contact_tag` (`attributes.tags`=nomes), `update_contact_field` (`attributes.fields[].field`=id), `add_to_workflow` (`attributes.workflow_id`), `internal_notification` (`attributes.sms.{selectedUser,template_id,body}`), `find_opportunity` (`__customInputFields__` filterField `pipeline_id`→`secondValue`), `internal_create_opportunity` (`pipelineId`, `__customInputFields__` `pipelineStageId`→`value`), `assign_user` (`traffic_weightage` chaves=userIds, `traffic_index`), `drip`, `manual-call`, `goto` (`targetNodeId`), `internal_update_opportunity`.

### Condições de `if_else` (para Camada 3 — avaliar subconjunto)
Nó-branch `attributes.if` / `attributes.branches[].segments[].conditions[]`. Cada condição vista no dump:
`conditionType` (ex.: `date_time`), `conditionSubType` (ex.: `day_week`), `conditionOperator` (`==`,…), `conditionValue`. Também condições de tag/campo (confirmar shapes ao implementar Camada 3 — inspecionar `raw.steps` de workflows com if/else de tag/campo).

## Camada 2 — Enumeração de caminhos

### O que implementar
1. `flow.py` — adicionar `enumerate_paths(wf) -> list[Path]`:
   - Caminho = sequência de (nó, rótulo-do-ramo-tomado) da raiz até um terminal.
   - Em container, ramificar um caminho por nó-branch (rótulo = nome do branch / "Opportunity Found"…).
   - **Proteção contra ciclo:** `goto`/loop → cortar caminho ao revisitar nó, marcando "(loop → <nó>)". Limite de paths por workflow (ex.: 500) com `log` do que truncou (sem cap silencioso).
   - Cada `Path` resume as **ações** efetivas (sms, add_tag X, assign user Y, create opportunity em stage Z, add_to_workflow W) e o **terminal** (sai / loop / add_to_workflow).
2. `path_report.py` (ou estender `report.py`): saída Markdown por workflow — árvore de caminhos legível. Ex.:
   ```
   ## Cria oportunidades!
   - Found → [fim]
   - Not Found → Find Opportunity(2)
       - Found → [fim]
       - Not Found → criar oportunidade (stage Novo lead) → [fim]
   ```
3. Surfacing: novo subcomando `automaster-audit paths <dump> [-o paths.md]` (ver `cli.py` para o padrão de subcomando), e/ou aba no dashboard.

### Verificação
- Rodar em `Cria oportunidades!` (8 steps) → deve casar a árvore Found/Not-Found derivada à mão.
- Rodar em `1A - Fluxo de prospecção ativa` (25 steps, if/else dia-da-semana + goto) → caminhos por dia + corte de loop no goto.
- Teste unit: workflow sintético com 1 container 2-ramos → 2 paths; com goto-loop → path marcado, sem recursão infinita.

### Anti-padrões
- NÃO avaliar condição na Camada 2 (é enumeração, não simulação). NÃO recursão sem corte de ciclo. NÃO cap silencioso (logar truncamento).

## Camada 3 — Teste de contrato

### O que implementar
1. Formato do contrato (YAML/JSON em `auditor/contracts/<workflow>.yaml` ou apontado por flag): por workflow, lista de casos `{nome, dado: {tags, campos, dia_semana, ...}, espera: {ações_contém, termina_em, não_faz}}`.
2. `simulate.py` — `simulate(wf, contact_state) -> Path`: anda o grafo escolhendo o ramo cuja condição casa com `contact_state`. Avaliar subconjunto documentado de `conditionType` (começar por `date_time/day_week`, presença de tag, igualdade de campo). Condição não suportada → resultado `ambiguous` (não casar à força; reportar).
3. `contract.py` + subcomando `automaster-audit verify-contracts <dump> [--contracts dir]`: roda cada caso, compara com `espera`, reporta PASS/FAIL/AMBIGUOUS. Exit code ≠0 se algum FAIL (CI).

### Verificação
- Escrever 1 contrato para `Cria oportunidades!` ("contato sem oportunidade → cria em Novo lead") e ver PASS.
- Caso com condição não suportada → AMBIGUOUS, não FAIL.
- Testes unit com workflows sintéticos por tipo de condição suportada.

### Anti-padrões
- NÃO afirmar PASS quando a condição é não suportada (tem que ser AMBIGUOUS). NÃO escrever no GHL. Documentar exatamente quais `conditionType` são suportados.

## Estado atual do projeto (para orientar a próxima sessão)

- **extractor/** (TS): extrai workflows + 6 entidades (pipelines, tags, custom_fields, users, calendars, custom_values). Endpoints em `docs/endpoints.md` + `docs/endpoints-extras.md` (a criar; por ora os de users/calendars/custom_values estão no commit `021b7f3`).
- **auditor/** (Python): `loader.py` (DumpContext), `flow.py` (grafo), `rules/` (13 regras, registry pkgutil), `report.py`, `graph.py`+`graph_html.py`, `dashboard.py`+`dashboard_html.py`, `theme.py` (Tron). Saídas: `report.md/json`, `graph.html`, `dashboard.html`.
- **Comandos:** `automaster-audit {audit|graph|dashboard} <dump>`. Camada 2 add `paths`; Camada 3 add `verify-contracts`.
- **Testes:** `cd auditor && .venv/bin/python -m pytest` (44 verdes). Fixtures via `conftest.make_dump(...)` (aceita workflows/tags/pipelines/fields/users/custom_values/calendars).
- **Dump de validação:** `dumps/WPIUKW3L4lDyMhLhKYKG/<ts>/` (gitignored; re-extrair com `cd extractor && npm run extract -- --location WPIUKW3L4lDyMhLhKYKG`, sessão Chrome persistente já logada).
