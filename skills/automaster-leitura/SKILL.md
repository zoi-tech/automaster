---
name: automaster-leitura
description: Como ler o que as tools automaster (inventario, achados, workflow, buscar, jornada, contato, conversas, conversas_buscar, conversa_acao, rascunho, anexar, enviar, editar) devolvem sobre automações GoHighLevel — o que é ruído, o que é erro de verdade, o que é desenho. Use antes de interpretar qualquer resposta dessas tools ou de opinar sobre um dump.
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

**`editar` escreve em produção.** Só depois de diagnosticar com `contato` e com o pedido explícito do usuário. Ela grava snapshot antes e devolve `dispara`: cite esses workflows na resposta, porque a mudança pode acendê-los. Não cria tag nem campo; se o nome não existe no dump, extraia de novo ou passe o id.

**Workflow sem entrada (`workflow_unreachable`)** já cruza triggers e `add_to_workflow`; o que sobra pode ser execução manual pelo painel do GHL. Pergunte antes de sugerir apagar.

**`conversas` mostra o que o contato recebeu de fato.** É a outra metade do diagnóstico:
`contato` diz o que a automação fez, `conversas` diz o que chegou na pessoa. Quem responde
"isso foi automação ou alguém digitou?" é o campo `origem` (`app`, `workflow`, `campaign`,
`api`) — **não** a presença de `autor`: mensagem de workflow vem com `userId` preenchido.

**Um terço do que volta não é mensagem.** Os tipos `ACTIVITY_*` são eventos de timeline
(oportunidade movida, agendamento apagado) no mesmo array; ficam escondidos salvo
`atividades=true`. Se o usuário perguntou "o que foi enviado", eles são ruído.

**Corpo de e-mail vem cortado em 400 caracteres.** Para o texto inteiro, chame `conversas`
de novo com `email=<emailMessageId>` — o id do e-mail, que a mensagem traz em
`emailMessageId`, nunca o `id` da mensagem.

**`enviar` fala com uma pessoa de verdade.** `InternalComment` é nota interna e não sai;
qualquer outro tipo exige `confirmo=true` e não tem desfazer. Diga ao usuário o que vai
sair, para quem, antes de mandar.

**`conversa_acao` com `apagar` leva o histórico inteiro.** O GHL não apaga mensagem avulsa:
a granularidade mínima é a conversa. Nunca ofereça isso como forma de "desfazer" um envio.

**`anexar` não fala com o contato, mas deixa arquivo no CRM.** O upload só cria o arquivo e
devolve a URL; nada sai até você chamar `enviar(anexos=[...])`. Não há desfazer do upload —
o arquivo fica na pasta da conversa mesmo que o envio nunca aconteça.
