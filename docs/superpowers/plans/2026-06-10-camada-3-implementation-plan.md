# Plano de execução — Camada 3: Teste de contrato

> Plano faseado, LLM-friendly. Cada fase auto-contida, executável em contexto novo.
> Fonte de verdade: `docs/superpowers/plans/2026-06-10-validation-layers-2-3-plan.md` (doc-mãe), seção "Camada 3" (`:63-76`).
> Camadas 1 e 2 entregues (`flow.py` com `enumerate_paths`/`Path`, `path_report.py`, subcomandos `audit|graph|dashboard|paths`). Suíte: 58 testes verdes.

## O que é a Camada 3 (doc-mãe `:63-76`)

Usuário declara cenário + resultado esperado por workflow (contrato). A ferramenta **avalia o subconjunto documentado de condições**, escolhe o caminho e compara com o esperado. Resultado por caso: **PASS / FAIL / AMBIGUOUS**. Condição não suportada → AMBIGUOUS, **nunca** FAIL/PASS silencioso. Exit code ≠ 0 se houver FAIL (CI).

---

## Fase 0 — Descoberta (CONCLUÍDA — consolidado; NÃO refazer)

### Correção estrutural ao doc-mãe (validada contra dump real `2026-06-10_2038`, 21 workflows, 69 steps if_else, 47 condições)

O doc-mãe `:34` sugere condição no nó-branch via `attributes.if`. **ERRADO no dump real**: `attributes.if` é **booleano** (`true` no container, `false` no branch-yes). A condição vive no **CONTAINER**, em:

```
container.attributes.branches[j].segments[k].conditions[l]
```

- Container (`nodeType: "condition-node"`): `attributes = {currentRecipeType, operator: "and", if: true, conditionName, version: 2, noneBranchName}` + `branches[]`; `next` = lista com ids dos branch-yes **+ o nó else**.
- `branches[j]` = `{id, name, segments[], operator, showErrors, branchNameError}` — `id` casa com o id do step branch-yes filho.
- `segments[k]` = `{__segmentId, operator, conditions[]}` — condições unidas por `segment.operator` (`and`/`or`); segments unidos por `branch.operator`.
- Nó else: `nodeType: "branch-no"`, `attributes: {else: true}`; nome = `noneBranchName` do container.
- `conditions[l]` = `{conditionType, conditionSubType, conditionOperator, conditionValue?, __conditionId, ifElseNodeId, __customFieldType__, isWait, ...metadados de UI}`. `conditionValue` **ausente** quando operador `has_value`.

### Inventário real de combos (47 condições no dump — base do subconjunto suportado)

| conditionType / SubType / Operator | Qtd | conditionValue |
|---|---|---|
| `contact_detail / tags / index-of-true` | 11 | `list[str]` nomes de tag (ex. `["status/follow-up/dia 1"]`) |
| `date_time / day_week / ==` | 12 | str dígito `"0"`(Dom)…`"6"`(Sáb) |
| `date_time / time / >` `<` `>=` `<=` | 6+3+1+1 | str hora (`"11"`, `"8"`, `"18"`) |
| `trigger / trigger / ==` | 7 | str = id do trigger (casa `raw.triggers[].id`) |
| `contact_detail / phone / contain` | 4 | str (substring do telefone) |
| `contact_detail / assigned_to / has_value` | 2 | (chave ausente) |

Exemplos verbatim copy-ready: tag → `dumps/.../2026-06-10_2038/workflows/768ce517-ea53-4026-897c-f45cd5a4d3e7.json`, container `837e5f79-…`, `attributes.branches[0].segments[0].conditions[0]`; day_week+time (2 conds num segment, "Sábado") → `3789c430-c4be-4506-9472-9c264c9727e3.json`, container `78ab5903-…`.

### Outros nós de decisão (do dump)

- **`find_opportunity`**: ramos são `transitions[]` pré-definidas (`name: "Opportunity Found"/"Opportunity Not Found"`, `conditionType: "pre-defined"`); Found/Not-Found depende de o filtro achar oportunidade — **não avaliável offline** → cenário declara.
- **`wait` type=reply**: `next` = lista de transitions user-defined `{condition: "primary"|"timeout"}` → cenário declara.
- Tags referenciadas por **nome** (nunca id); pipeline por id; trigger por id.

### APIs existentes a reutilizar (verificadas)

- `flow.py`: `roots(wf)`, `successors(step)`, `index_steps(wf)`, `is_branch_node(step)`, dataclass `Path(steps, terminal)`, `enumerate_paths`. Corte de ciclo já modelado (`terminal "loop → <id>"`).
- `path_report.py`: `describe_step(step, ctx) -> str` — usar para casar `espera.acoes_contem` com rótulos legíveis.
- `loader.py`: `load_dump`, `DumpContext` (mapas `*_names`), `Workflow` (`.steps` = `raw.steps.templates`, `.triggers`).
- `cli.py`: padrão de subcomando (`run_paths` etc.); atalho em `main()` linha ~122.
- Testes: `conftest.make_dump(...)` + helper `wf(...)`; padrão em `tests/test_enumerate_paths.py`.

### Decisões fixadas por este plano (lacunas do doc-mãe resolvidas)

1. **Contratos em JSON** (stdlib, zero dependência nova; doc-mãe deixa "YAML/JSON" em aberto). Dir default `auditor/contracts/`, flag `--contracts` para outro dir. Um arquivo por workflow: `{"workflow": "<nome exato ou id>", "casos": [...]}`.
2. **Cenário (`dado`)** — chaves suportadas: `tags: list[str]`, `dia_semana: int 0-6 | nome ("domingo".."sabado")`, `hora: int`, `telefone: str`, `assigned_to: str|null`, `trigger: str (id ou nome)`, `oportunidade_encontrada: bool`, `resposta: bool` (true=respondeu/primary, false=timeout).
3. **Expectativa (`espera`)**: `acoes_contem: list[str]` (substring case-insensitive nos rótulos `describe_step` do caminho), `nao_faz: list[str]` (substring que NÃO pode aparecer), `termina_em: str` (substring do terminal ou do rótulo da última ação).
4. **Lógica trivalente (Kleene)** para avaliar condição: `True/False/None` (None = não suportado/cenário não declara). `and(False,·)=False`, `and(True,None)=None`; `or(True,·)=True`, `or(False,None)=None`.
5. **Seleção de ramo**: avaliar `branches[]` na ordem; primeiro `True` → entra; `None` antes de algum `True` → caso **AMBIGUOUS** (com motivo: step + condição); todos `False` → nó else.
6. **find_opportunity**: `oportunidade_encontrada` ausente no cenário e workflow tem o step → AMBIGUOUS naquele ponto. Idem `wait reply` sem `resposta`.
7. **Entrada da simulação**: `roots(wf)[0]` (ordem de `index_steps`); sem raiz → AMBIGUOUS "sem raiz". Ciclo → terminal `"loop → <id>"` (caminho termina, simulação ok).
8. **Status por caso**: `PASS | FAIL | AMBIGUOUS`. Workflow do contrato não encontrado no dump → conta como **FAIL** (CI honesto). Exit code: 1 se houver FAIL; AMBIGUOUS não falha o exit, mas aparece no sumário.
9. **Tag matching**: case-insensitive (precedente: `ctx.tag_names` lower). `index-of-true` = contato tem **alguma** das tags da lista (no dump todas as listas são unitárias; documentar a escolha).
10. **`trigger ==`**: casa se `dado.trigger` == id da condição OU se `dado.trigger` == `name` de um trigger do workflow cujo id == valor da condição.
11. Subconjunto suportado = **exatamente a tabela do inventário acima**. Qualquer outro combo → None (→ AMBIGUOUS se decisivo). Tabela documentada na docstring de `simulate.py`.

### Anti-padrões (doc-mãe `:76` + descoberta)

- **NÃO** afirmar PASS quando condição não suportada — AMBIGUOUS obrigatório.
- **NÃO** escrever no GHL; **NÃO** mutar `raw`; **NÃO** re-derivar o modelo do grafo (usar `flow.py`).
- **NÃO** "casar à força": cenário sem a chave necessária = None, não False.
- **NÃO** inventar shapes: avaliador cobre só o inventário; combos ausentes do dump (custom fields em if_else, `is`/`not_contain`, multi-segment OR real, `isWait:true`, conditionType `opportunity`/`appointment`) tratados como não suportados.
- Documentar exatamente quais conditionType são suportados (docstring + CLAUDE.md).

---

## Fase 1 — `simulate.py`: avaliador de condições + simulação (TDD)

### O que implementar

Arquivo novo `auditor/src/automaster_audit/simulate.py`:

1. Docstring do módulo com a **tabela dos combos suportados** (decisão 11).
2. `@dataclass SimResult`: `path: Path | None`, `status: str` (`"ok"`/`"ambiguous"`), `motivo: str | None` (step + condição que travou).
3. `_eval_condition(cond: dict, dado: dict) -> bool | None` — implementa exatamente os 6 combos da tabela (decisões 2, 9, 10); combo fora da tabela ou chave ausente em `dado` → `None`.
4. `_eval_branch(branch: dict, dado: dict) -> bool | None` — Kleene: condições do segment unidas por `segment.operator`, segments por `branch.operator` (decisão 4).
5. `simulate(wf: Workflow, dado: dict) -> SimResult` — anda o grafo a partir de `roots(wf)[0]` reutilizando `index_steps`/`successors`:
   - Step linear → segue.
   - Container if_else (`next` lista + `attributes.branches`): seleção de ramo por decisão 5; registra `(step_id, rótulo)` no trail como na Camada 2.
   - `find_opportunity` → transition por `dado["oportunidade_encontrada"]`; ausente → ambiguous (decisão 6).
   - `wait` com `next` lista (transitions user-defined) → por `dado["resposta"]` (`condition=="primary"` se True, `"timeout"` se False); ausente → ambiguous.
   - goto/ciclo → terminal `"loop → <id>"`; `next` ausente → `"exit"`.
   - Retorna `SimResult(path=Path(...), status="ok")` ou `status="ambiguous"` com motivo.

### Referências

- Shapes das condições: Fase 0 deste plano (inventário + exemplos verbatim nos arquivos do dump citados).
- Travessia/rótulos: `flow.py` (`enumerate_paths` como referência de estilo — NÃO duplicar helpers; importar).
- Doc-mãe `:67` (spec da função), `:76` (anti-padrões).

### TDD — `auditor/tests/test_simulate.py` (red → green)

Workflows sintéticos via `conftest.wf(...)` (copiar shapes de container/branch da Fase 0 — `attributes.branches[].segments[].conditions[]` no container, branch-yes com `attributes.if: false`, else com `attributes.else: true`):

1. Tag: container 1 branch (`tags/index-of-true`, `["vip"]`) + else; `dado={"tags":["VIP"]}` → entra no branch (case-insensitive); `dado={"tags":[]}` → else.
2. day_week: `dado={"dia_semana":"sabado"}` e `{"dia_semana":6}` → mesmo ramo; `time >` com `hora`.
3. Kleene: segment com 2 condições `and` (day_week + time) — uma False → branch False sem ambiguidade mesmo faltando a outra chave (short-circuit), ambas True → entra.
4. Não suportado: condição `conditionType:"opportunity"` → `status="ambiguous"`, motivo contém o step id; **nunca** path "ok".
5. Cenário incompleto: condição de tag mas `dado` sem `tags` → ambiguous (None ≠ False).
6. find_opportunity: `oportunidade_encontrada: false` → transition "Opportunity Not Found"; ausente → ambiguous.
7. Ciclo via goto → `status="ok"`, terminal `"loop → <id>"`, sem recursão infinita.
8. Ordem de ramos: 2 branches, primeiro True → segundo nem avaliado (segundo com combo não suportado não gera ambiguidade).

### Checklist de verificação

- [ ] `cd auditor && .venv/bin/python -m pytest tests/test_simulate.py -q` verde; suíte completa verde (58 + novos).
- [ ] Docstring de `simulate.py` contém a tabela de combos suportados.
- [ ] Caso 4 prova: não suportado JAMAIS vira PASS/path ok.

### Guardas anti-padrão

- Condição lida SÓ do container (`attributes.branches`), nunca de `attributes.if` do nó-branch (é booleano!).
- Chave ausente no cenário → None, não False.
- Não duplicar `successors`/`roots`/`index_steps` — importar de `flow`.

---

## Fase 2 — `contract.py`: formato, execução e relatório (TDD)

### O que implementar

Arquivo novo `auditor/src/automaster_audit/contract.py`:

1. Formato (decisões 1-3) — exemplo canônico (vai na docstring):
   ```json
   {
     "workflow": "Cria oportunidades!",
     "casos": [
       {
         "nome": "contato sem oportunidade → cria em Novo lead",
         "dado": {"oportunidade_encontrada": false},
         "espera": {"acoes_contem": ["criar oportunidade"], "termina_em": "exit", "nao_faz": []}
       }
     ]
   }
   ```
2. `load_contracts(dir: Path) -> list[dict]` — lê todos `*.json`; JSON inválido ou sem `workflow`/`casos` → erro claro com nome do arquivo (não traceback cru).
3. `@dataclass CaseResult`: `workflow`, `caso`, `status` (`"PASS"|"FAIL"|"AMBIGUOUS"`), `motivo: str` (vazio em PASS).
4. `run_contracts(ctx: DumpContext, contracts_dir: Path) -> list[CaseResult]`:
   - Workflow casado por id exato ou nome exato; não encontrado → 1 `CaseResult` FAIL por caso ("workflow não encontrado").
   - Por caso: `simulate(wf, dado)`; `ambiguous` → AMBIGUOUS com motivo.
   - `ok` → materializa rótulos do caminho com `describe_step(step, ctx)` (importar de `path_report`); compara: cada item de `acoes_contem` é substring (case-insensitive) de algum rótulo; nenhum item de `nao_faz` aparece; `termina_em` é substring do terminal ou do último rótulo. Divergência → FAIL com motivo específico (qual expectativa falhou, caminho percorrido resumido).
5. `format_results(results) -> str` — texto por workflow/caso (`✓ PASS` / `✗ FAIL — motivo` / `? AMBIGUOUS — motivo`) + sumário `N PASS, N FAIL, N AMBIGUOUS`.

### Referências

- Doc-mãe `:66, :68` (formato e comportamento), `:72` (AMBIGUOUS ≠ FAIL).
- `describe_step`: `path_report.py:25`.
- Estilo de erro do loader: `DumpError` em `loader.py` (mensagens claras, sem traceback).

### TDD — `auditor/tests/test_contract.py`

1. PASS: dump sintético (workflow com find_opportunity → create opportunity, copiar shape da Fase 0) + contrato em `tmp_path` esperando "criar oportunidade" → PASS.
2. FAIL: `espera.acoes_contem` com ação inexistente → FAIL, motivo cita a expectativa.
3. FAIL por `nao_faz`: ação presente no caminho → FAIL.
4. AMBIGUOUS: workflow com condição não suportada → AMBIGUOUS (e **não** FAIL), motivo presente.
5. Workflow não encontrado → FAIL "workflow não encontrado".
6. Contrato malformado (JSON quebrado) → erro claro com nome do arquivo.

### Checklist

- [ ] Testes novos verdes; suíte completa verde.
- [ ] AMBIGUOUS nunca vira PASS nem FAIL (asserts dos casos 4).
- [ ] `grep -n "yaml" auditor/src/automaster_audit/contract.py` → vazio (JSON stdlib só).

### Guardas anti-padrão

- Não escrever nada dentro do dump (contracts ficam fora; relatório vai para stdout — Fase 3 decide arquivo).
- Comparações case-insensitive mas SEM normalizar além disso (não "ajudar" o match).

---

## Fase 3 — Subcomando `verify-contracts` + contrato real

### O que implementar

1. `cli.py` — copiar padrão `run_paths`: subcomando `verify-contracts <dump> [--contracts DIR]` (default `auditor/contracts/` relativo ao CWD? **Não** — default = `Path("contracts")` resolvida a partir do diretório de trabalho `auditor/`; aceitar caminho explícito sempre que passado). Imprime `format_results`; **exit 1 se algum FAIL**, 0 caso contrário (AMBIGUOUS não falha); atualizar lista de atalho em `main()`.
2. Criar `auditor/contracts/cria-oportunidades.json` — o contrato do doc-mãe `:71`: "contato sem oportunidade → cria em Novo lead" (usar o exemplo canônico da Fase 2).
3. CLAUDE.md: linha do subcomando no bloco de comandos + atualizar contagem de testes.

### Checklist

- [ ] `.venv/bin/automaster-audit verify-contracts ../dumps/WPIUKW3L4lDyMhLhKYKG/2026-06-10_2038/ --contracts contracts/` → caso PASS, exit 0 (doc-mãe `:71`).
- [ ] Contrato com caso AMBIGUOUS (testar com `dado` vazio em workflow com condição) → reporta AMBIGUOUS, exit 0 (doc-mãe `:72`).
- [ ] Contrato com expectativa errada (teste manual one-off) → FAIL, exit 1.
- [ ] `audit|graph|dashboard|paths` intactos; suíte completa verde.

---

## Fase 4 — Verificação final

1. Suíte completa verde (paste de output).
2. Greps anti-padrão:
   - `grep -rn "attributes\[.if.\]\|attributes.get(.if.)" auditor/src/automaster_audit/simulate.py` → avaliador não lê `attributes.if` como condição (booleano!). Inspeção manual da função `_eval_*`.
   - Confirmar por teste/inspeção: combo não suportado → AMBIGUOUS (nunca PASS).
   - `grep -rn "import yaml\|requests\|httpx" auditor/src/automaster_audit/{simulate,contract}.py` → vazio (sem dep nova, sem rede — nada escreve no GHL).
3. Rodar `verify-contracts` no dump real com o contrato de `Cria oportunidades!` → PASS, exit 0 (evidência).
4. Tabela de combos suportados presente na docstring de `simulate.py` e citada no CLAUDE.md (1 linha).
5. Doc-mãe: marcar Camada 3 ✅ com hashes dos commits.
6. `git status` limpo ao final; nenhum raw de `dumps/` modificado.

### Critério de pronto

- [ ] Itens 1-4 com evidência colada.
- [ ] Docs atualizados (CLAUDE.md + doc-mãe).
- [ ] Commits atômicos por fase.

## Fora de escopo

- YAML, edição/geração assistida de contratos, UI/dashboard para contratos.
- Avaliação de combos fora do inventário (custom fields em if_else, `opportunity`/`appointment` conditionTypes, multi-segment OR não exercitado etc.).
- Simulação de triggers/filtros de trigger (entrada é sempre a raiz do grafo de steps).
- Teste ao vivo no GHL; qualquer escrita em produção.
