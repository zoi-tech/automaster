# Pesquisa — configuração do workflow e validação ao vivo

Spec: `docs/superpowers/specs/2026-09-22-config-e-validacao-ao-vivo-design.md`

Frente externa pulada: a API é a interna do GHL, sem documentação pública; o que vale é prova
ao vivo, e a única que existe para configuração geral é a de `allowMultiple` (2026-09-22).

## Achados

### A1 — A conferência pós-gravação não enxerga configuração
- Fonte: `extractor/src/api/workflow-edit/guardas.ts:40-77` (`diffWorkflow` compara nome, steps e triggers; `conferirEscrita` é `residual.vazio`)
- Contradiz a spec: parcial
- Pergunta que levanta: sem uma comparação própria do campo, uma gravação que não pegou sairia como sucesso.

### A2 — Workflow sem step não passa pela checagem de publicável
- Fonte: `extractor/src/cli/workflow-editar.ts:117`, `extractor/src/api/workflow-edit/documento.ts:188-190`
- Contradiz a spec: parcial
- Pergunta que levanta: num workflow recém-criado, ligar a reentrada antes do primeiro passo seria recusado.

### A3 — O workflow fora do dump é descartado antes da prévia
- Fonte: `auditor/src/automaster_audit/mcp/workflows.py:213-219`; teste de ordem em `auditor/tests/test_workflow_editar_tool.py:150-173`
- Contradiz a spec: sim
- Pergunta que levanta: a ordem "dump antes do Chrome" precisa mudar para o workflow novo chegar à validação.

### A4 — Gatilho de tag não se reconhece só pelo tipo
- Fonte: `auditor/src/automaster_audit/journey.py:110-128`, `auditor/src/automaster_audit/dashboard.py:48`
- Contradiz a spec: parcial
- Pergunta que levanta: `contact_tag` cobre também "tag removida"; o aviso de reentrada deve olhar `field == "tagsAdded"` (ou condição ausente, que é qualquer tag).

### A5 — Ação sem validação não devolve a chave `validacao`
- Fonte: `auditor/tests/test_workflow_editar_tool.py:403-446` (assert `"validacao" not in r`)
- Contradiz a spec: sim
- Pergunta que levanta: seguir a convenção existente e não devolver `validacao` em `configuracao`.

### A6 — CLAUDE.md diz que toda ação nova passa por `validar_edicao`
- Fonte: `CLAUDE.md:143-146`, lista de ações em `CLAUDE.md:74`
- Contradiz a spec: parcial
- Pergunta que levanta: `configuracao` entra nas três portas, mas sem regras; o CLAUDE.md precisa dizer isso.

### A7 — Só `allowMultiple` tem prova de que a configuração sobrevive ao save
- Fonte: `docs/endpoints.md:119-121` (prova do save é sobre steps)
- Contradiz a spec: parcial
- Pergunta que levanta: liberar agora só a reentrada, ou também as quatro chaves sem prova?

### A8 — Lista de workflows não tem parser no loader
- Fonte: `extractor/src/api/workflows.ts:30-45`, `auditor/src/automaster_audit/loader.py:143-144`
- Contradiz a spec: não (a spec pede parser; ele é novo)

### A9 — Regras leem mais que os conjuntos de id
- Fonte: `broken_pipeline_ref.py:34` (`stage_ids`), `broken_user_ref.py:33-41` (`user_deleted`, `user_names`, no-op sem usuários), `workflow_call_cycle.py:34,41` (`workflow_names`)
- Contradiz a spec: não; a sobreposição tem de trocar esses derivados junto. `copy.copy(ctx)` em `validacao_escrita.py:90` exige trocar, nunca mutar.

### A10 — Dublês de teste quebram com o novo parâmetro
- Fonte: `auditor/tests/test_workflow_editar_tool.py:184,339,416,512,539`; `auditor/tests/test_cli_workflow_editar.py:53-75`
- Contradiz a spec: não; custo de plano.

### A11 — Prévia de trigger já lê o documento; gravação só lê a meta
- Fonte: `extractor/src/cli/workflow-editar.ts:388` e `:396` (`getWorkflowMeta` traz as flags)
- Contradiz a spec: não; o aviso de reentrada sai nos dois caminhos.

## Fila do grill

1. A7 — liberar só a reentrada ou as cinco chaves?

Os demais contraditórios têm resposta no código e entram direto como decisão (A1, A2, A3, A4,
A5, A6).
