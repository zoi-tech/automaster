---
name: automaster-leitura
description: Como ler o que as tools automaster (dumps, comparar, inventario, achados, workflow, buscar, jornada, contato, conversas, conversas_buscar, conversa_acao, rascunho, anexar, enviar, whatsapp, whatsapp_enviar, config, grupo, editar, oportunidades, oportunidade_acao, pipeline, agenda, agenda_acao) devolvem sobre automações GoHighLevel — o que é ruído, o que é erro de verdade, o que é desenho. Use antes de interpretar qualquer resposta dessas tools ou de opinar sobre um dump.
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

**Template de WhatsApp só sai aprovado, e o texto é montado aqui.** O `whatsapp_enviar`
concatena HEADER, BODY e FOOTER e troca `{{1}}`, `{{2}}` pelas `customVariables` antes de
mandar — o servidor não faz isso. Template com variável não preenchida sai com o
`{{n}}` cru na mensagem.

**`config` escreve na subconta inteira, não numa conversa.** `ia-gravar` e `sla-gravar`
trocam a configuração de todo mundo; o estado anterior fica em `<dumps>/_config/`, mas
restaurar é você regravando à mão.

**O corpo de `grupo` com `o="criar"` não foi confirmado ao vivo.** A rota existe e responde,
o formato do payload veio de leitura parcial do app. Trate um erro ali como contrato
errado, não como bug do CRM.

**As tools de oportunidade não leem o dump — elas abrem o Chrome.** `oportunidades`,
`oportunidade_acao` e `pipeline` falam sempre com a subconta ao vivo. O funil muda a toda
hora, então um número de card vindo do snapshot enganaria. Custo: cada chamada precisa da
sessão logada, e é mais lenta que as tools de dump.

**O contato de uma oportunidade é de nascença.** Ele só se define na criação; o servidor
não aceita trocá-lo depois, e a tool recusa a tentativa. Quem pediu "mudar o card para
outra pessoa" precisa de um card novo — e o antigo perde o histórico se for apagado.

**`pipeline` com `acao="editar"` substitui a lista de estágios inteira.** Estágio que não
estiver em `estagios` é removido. Os cards dele não somem: o servidor joga todos para um
estágio que sobrou, de uma vez. Isso muda o estágio de cada card sem aviso e acorda toda
automação que reage a transição — por isso a tool conta os cards antes e recusa, e só passa
com `apagar_com_cards=true`. Ao montar a lista, sempre parta da leitura atual do pipeline.

**Apagar pipeline não tem restore.** Apagar card tem (`acao="restaurar"`), e o card
apagado devolve 404 na leitura até ser restaurado. Pipeline apagado leva os cards junto e
só volta reconstruído à mão, a partir do estado gravado em `<dumps>/_oportunidades/`.

**As tools de agenda não leem o dump — elas abrem o Chrome.** O dump só guarda nome e id de
calendário, para resolver referência de workflow. Compromisso não está lá.

**Marcar ou cancelar fala com o cliente.** A escrita dispara o e-mail ou SMS que o
calendário tem configurado e acorda as automações ligadas ao compromisso. `silenciar`
desliga as automações junto. Provado ao vivo num calendário com notificação ao contato
ligada: com `silenciar` nenhuma mensagem saiu. O caso **sem** `silenciar` nunca foi testado
(mandaria mensagem de verdade), então trate a escrita não silenciada como quem fala com o
cliente.

**Compromisso que se repete exige dizer o alvo.** Sem `alvo`, a tool recusa em vez de
escolher: a mesma chamada remarca uma terça ou o ano inteiro, conforme o id enviado.

**Bloqueio de horário não aparece em `o=eventos`.** Ele só vem em `o=bloqueios`
(`/calendars/blocked-slots`). O que separa os dois é o `status` — `booked` no compromisso,
`unavailable` no bloqueio — e é isso que o campo `_tipo` traduz. Bloqueio não tem contato,
não tem situação e não é reunião com ninguém: é a agenda de um usuário fechada num horário.
Por isso `bloquear` exige `dono` e recusa `contato`/`situacao`.

**`forcar` marca por cima da disponibilidade.** Sem ele o servidor recusa horário ocupado
(`400 The slot you have selected is no longer available.`); com ele, passa — e exige `dono`,
porque sem a checagem de horário o servidor não escolhe responsável sozinho.
