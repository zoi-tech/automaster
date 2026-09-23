# Configuração do workflow e validação ao vivo — design

Data: 2026-09-22. Origem: backlog C1 e C2 (`docs/backlog-arquitetura.md`, rodada de 2026-09-22),
expostos montando uma automação de transferência por tag na Cliente A.

## Problema

**C1.** Workflow criado por API nasce com `allowMultiple: false`. Nenhuma ação do
`workflow_editar` altera configuração geral do documento, então ligar a reentrada exigiu um
script fora das tools. Em workflow disparado por tag isso quebra em silêncio: a segunda
passagem do mesmo contato não acontece.

**C2.** A validação das 18 regras (`validacao_escrita.validar_edicao`) tem dois furos:

1. Workflow ausente do dump (recém-criado ou duplicado) sai com `rodou: false`. É o caso em
   que mais cabe erro — montagem do zero — e é o único sem guarda.
2. As regras de referência comparam contra as entidades do DUMP. Tag, usuário, campo, funil,
   custom value ou workflow criado depois da extração vira referência quebrada, e a edição que
   o cita é RECUSADA. Vale também para workflow antigo. As três tags da Cliente A foram criadas
   dois minutos depois da extração: com a validação rodando, a montagem teria travado.

## Decisões (aprovadas no chat)

- Ação nova `configuracao` no `workflow_editar`, lista fechada de chaves.
- Validação com entidades AO VIVO (opção A): a prévia, que já abre o Chrome, lê as listas de
  entidades e as devolve; o auditor as sobrepõe ao dump antes de rodar as regras.
- Rejeitada a opção B (erro de referência novo vira aviso): enfraquece a guarda justo onde ela
  importa.

## Item 1 — ação `configuracao`

CLI crua: `npm run workflow-editar -- -l <loc> --acao configuracao -i <wid> --campo <c> --valor <v> [--confirmo]`.

Chave aceita: só `allowMultiple` (reentrada), booleana — a única com prova ao vivo de que
sobrevive ao save (2026-09-22, Cliente A). A lista é uma constante; chave nova entra nela quando
for provada. Chave fora da lista ou valor não booleano é recusado com a lista.

Fluxo: um `case` em `aplicarOperacao`, o mesmo caminho das ações de corpo — prévia sem
`--confirmo` (mudança `campo: antes → depois`), `montarCorpo` + `salvarWorkflow`, releitura.
`diffWorkflow` não enxerga campo de raiz, então a conferência compara o campo relido; se não
bater, `aplicado: "duvidoso"`. Valor igual ao atual: "nada a mudar". Workflow publicado exige
`--publicado`. A checagem de publicável continua valendo: workflow sem step é recusado, e a
mensagem diz para criar o primeiro step antes.

Não passa pelas 18 regras (nenhuma regra lê essas chaves) e, pela convenção das ações sem
corpo validado, a resposta não traz a chave `validacao`.

Portas: CLI crua, tool MCP `workflow_editar` (fora de `_WF_EDITAR_COM_CORPO`) e
`automaster-audit workflow-editar` (novos `--campo`/`--valor`).

**Aviso de reentrada.** `trigger adicionar` de tag ADICIONADA (`type: contact_tag` com
condição `field: "tagsAdded"` ou sem condição de tag, que é qualquer tag) num workflow com
`allowMultiple: false` devolve em `avisos`: reentrada desligada, o mesmo contato não entra de
novo; ligue com `--acao configuracao --campo allowMultiple --valor true`. Aviso, não recusa:
há workflow de tag que deve rodar uma vez só.

## Item 2 — validação com o documento e as entidades ao vivo

**Extractor.** A prévia das ações de corpo passa a devolver, além de `documento` (depois):

- `documentoAntes`: o documento como foi lido, antes da edição.
- `entidades`: `{tags, users, pipelines, custom_fields, custom_values, workflows}`, cada uma
  a resposta crua da rota que o `extract` já usa (`fetchTags`, `fetchUsers`, ...,
  `listWorkflows`). Falha de uma rota não derruba a prévia: a chave some e `entidadesFalhas`
  lista quais.

**Auditor.**

- `loader` separa o preenchimento das entidades em funções que recebem a resposta crua, usadas
  igual pelo disco e pela sobreposição ao vivo. `sobrepor_entidades(ctx, entidades)` devolve
  uma cópia do ctx com as listas trocadas; o ctx do chamador não muda.
- `validar_edicao` aceita `doc_antes`. Workflow fora do dump: entra no ctx como `Workflow`
  montado do documento (`antes` com `doc_antes`, `depois` com o editado) e o diff de erros roda
  igual. Sem `doc_antes` e fora do dump continua `rodou: false`.
- A resposta declara a origem: `entidades: "ao vivo"` ou, com falha, quais caíram no dump.

Templates (WhatsApp/SMS/e-mail) e formulários continuam do dump: as rotas são paginadas ou por
pasta e caras. Fica declarado em `validacao.aviso`.

## Testes

- Extractor: `configuracao` (chave fora da lista, valor não booleano, nada a mudar, prévia,
  releitura divergente vira duvidoso); aviso de reentrada no trigger de tag; prévia devolve
  `documentoAntes` e `entidades`, e sobrevive a uma rota falhando.
- Auditor: sobreposição de entidades (tag criada depois do dump deixa de ser erro novo);
  workflow fora do dump é validado com `doc_antes`; ERROR introduzido num workflow novo é
  recusado; as três portas aceitam `configuracao`.

## Decisões do grill

- **A7** — só `allowMultiple`. Motivo: é a única chave com prova de que sobrevive ao save; as
  outras entram na constante quando forem provadas. Decidido pelo usuário.
- **A1** — conferência própria do campo relido. Motivo: `diffWorkflow` só compara nome, steps
  e triggers (`guardas.ts:40-77`); sem isso um save que não pegou sairia como sucesso.
- **A2** — mantida a checagem de publicável. Motivo: o app recusa salvar workflow vazio; a
  mensagem orienta criar o primeiro step antes.
- **A3** — o descarte de workflow fora do dump sai de antes da prévia. O dump continua sendo
  carregado antes do Chrome (o teste de ordem fica), mas a ausência do workflow só decide
  depois, com `documentoAntes` em mãos.
- **A4** — aviso só para tag adicionada (`tagsAdded`) ou qualquer tag. Motivo: `contact_tag`
  cobre também tag removida (`journey.py:110-128`).
- **A5** — `configuracao` não devolve `validacao`. Motivo: convenção das ações sem corpo
  validado, travada por `test_workflow_editar_tool.py:403-446`.
- **A6** — CLAUDE.md passa a dizer que `configuracao` entra nas três portas sem as regras, e a
  lista de ações ganha `configuracao` e os `step-*` que já faltavam.
- **A9** — a sobreposição troca também `stage_ids`, `user_deleted`, `user_names` e
  `workflow_names`, por atribuição (nunca mutação): `validar_edicao` usa `copy.copy`.
- **A8, A10, A11** — sem decisão: parser novo para a lista de workflows, dublês de teste
  atualizados, aviso de reentrada nos dois caminhos do trigger.

## Fora de escopo

Leitura ao vivo de usuários como tool própria (C3 fica parcialmente coberto: a validação já os
lê); C4, C5, C6.
