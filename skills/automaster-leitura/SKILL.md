---
name: automaster-leitura
description: Como ler o que as tools automaster (inventario, achados, workflow, buscar, jornada, contato) devolvem sobre automações GoHighLevel — o que é ruído, o que é erro de verdade, o que é desenho. Use antes de interpretar qualquer resposta dessas tools ou de opinar sobre um dump.
---

# Leitura do domínio automaster

As tools devolvem fatos do dump. Esta skill diz o que cada fato costuma significar. Números de referência: subconta Instaltech, 94 workflows.

**Comece pelo mapa.** `inventario(loc)` custa ~130 tokens e responde quantos workflows, tags, fields, órfãs. Só peça uma fatia (`fatia="workflows"`, ~10k tokens) quando a pergunta exigir a lista. Toda resposta traz `_snapshot.idade_dias`: você decide se a idade importa para a pergunta; não há aviso automático.

**Draft é o estado normal, não abandono.** 66 de 94 workflows são draft. `dead_end_draft` é INFO e quase nunca vira ação.

**`naming_convention` é ruído.** 94 dos 152 achados. Chame `achados(loc, severidade="ERROR")` primeiro; o `counts` mostra o que você deixou de pedir.

**Referência quebrada é sempre erro.** `broken_tag_ref`, `broken_field_ref`, `broken_pipeline_ref`, `broken_user_ref`, `broken_workflow_ref`, `broken_custom_value_ref` apontam entidade que não existe mais. Um campo apagado aparece uma vez por step; `achados` já agrupa e traz `n`.

**Tag órfã quase nunca importa.** 48 de 95 tags não aparecem em nenhum workflow e são só rótulo manual. Antes de chamar de lixo, veja `papeis` em `buscar(loc, tag)`: `dispara` (gatilho de workflow), `adiciona`, `remove`, `condicao` (testada em branch ou trigger). Tag com `papeis` vazio é órfã de verdade.

**Ciclo de `add_to_workflow` nem sempre é bug.** Pode ser desenho com guarda (tag, campo, espera). Leia `workflow(loc, id).caminhos` dos dois lados antes de chamar de erro. Se `caminhos_truncado` for true, o resto está em `paths.md` gerado por `/automaster-audit`.

**Jornada de criação vazia é informação.** Na Instaltech não há trigger `contact_created`: o contato entra por tag, resposta ou ligação, e isso aparece em `anytime`. `jornada` devolve um nível por chamada; desça com `caminho=[i, j, ...]` (índices sobre `criacao + anytime`) e nunca peça `profundidade` alta num nó com muitos filhos.

**`contato` é ao vivo.** Abre Chrome, leva segundos e exige o extractor provisionado. Eventos vêm com `sourceWorkflowName`; para explicar o porquê, chame `workflow(loc, sourceId)`. Com `truncado`, pagine com `ate=proximo_ate`.

**Workflow sem entrada (`workflow_unreachable`)** já cruza triggers e `add_to_workflow`; o que sobra pode ser execução manual pelo painel do GHL. Pergunte antes de sugerir apagar.
