# Notas e tarefas do contato + tags da subconta (0.20.0)

Data: 2026-09-21. Estado: spec aprovada em chat, pendente de pesquisa (fase 2) e grill (fase 3).

## Objetivo

Fechar o painel do contato (notas e tarefas, hoje invisíveis para o plugin) e dar à tag da
subconta um ciclo de vida próprio — criar, renomear, apagar — com prévia do impacto nos
workflows que a citam.

## Escopo

Dentro: leitura e escrita de nota do contato, tarefa do contato e tag da subconta.

Fora: funis/sites, campanhas de e-mail em massa, custom fields, custom values, trigger
links. Fora também: reescrever as referências de tag nos workflows durante o renomear
(existe `workflow-editar --acao trocar-tag`, e encadear os dois é candidato a 0.21.0).

## Estrutura

Dois módulos novos no extractor:

- `extractor/src/api/annotations.ts` — notas e tarefas, rotas irmãs do contato.
- `extractor/src/api/tags.ts` — CRUD de tag da subconta.

Quatro comandos de CLI (`anotacoes`, `anotacao-acao`, `tags`, `tag-acao`) e quatro tools
MCP de mesmo nome com underscore, indo de 31 para 35 tools.

Nota e tarefa **não entram no dump**. São dados por contato, mudam toda hora e não fazem
parte da auditoria de automação; entrariam ao custo de varrer todos os contatos da
subconta na extração, sem uso claro. Consequência: nenhuma mudança em `loader.py`, nenhum
incremento de `schemaVersion`, nenhuma regra de auditoria nova. Tag sem uso já não é
achado, por decisão anterior.

## Leitura

`anotacoes -l <loc> -i <contactId> --tipo nota|tarefa --json`

Uma tool para os dois, distinguidos por `--tipo`, como `formularios` faz com
`formulario|survey`. Tarefa devolve também prazo, dono e se está concluída.

`tags -l <loc> --json`

Lista as tags da subconta e, para cada uma, quantos workflows a citam e em que papel
(`dispara`/`adiciona`/`remove`/`condicao`), cruzando o índice reverso `dashboard._wf_refs`.
A tag é lida ao vivo e o índice vem do dump mais recente, então a resposta declara de qual
snapshot o cruzamento veio. Subconta sem dump: a lista sai sem a coluna de impacto, com
aviso.

## Escrita

Padrão obrigatório da casa: sem `--confirmo` é prévia, com `--confirmo` grava. A CLI crua é
a camada sem regras; a guarda mora na tool MCP.

`anotacao-acao --tipo nota|tarefa --acao criar|editar|apagar`

`tag-acao --acao criar|renomear|apagar`

Apagar tag citada por workflow exige uma segunda flag explícita (`--apagar-citada`), no
molde do `--apagar-com-cards` do pipeline. Renomear mostra na prévia a lista de workflows
afetados.

Cada escrita deixa rastro em `<dumps>/_anotacoes/<loc>/<contactId>/<ts>.json` e
`<dumps>/_tags/<loc>/<tagId>/<ts>.json`, como as áreas anteriores.

## O que a pesquisa e a prova ao vivo fecharam

**Tag em workflow é sempre o nome, nunca o id** — em step, em trigger e em condição de
`if_else`. Medido em 34 de 34 valores do dump da Instaltech.

**Renomear pela API propaga**, e é o achado que definiu o desenho. A prova ao vivo de
2026-09-21 (`docs/superpowers/provas/2026-09-21-prova-tag-rename.ts`) criou tag e workflow
descartáveis, renomeou por `PUT /locations/<loc>/tags/<tagId>` e releu: o servidor reescreveu
o nome no step **e no trigger**. Logo `renomear` é escrita comum, com prévia informativa, e
não precisa propagar nada por conta própria.

**Apagar é o perigoso**, não o renomear: a tag sai de todos os contatos que a têm, e não há
prova de que isso não dispare os workflows com trigger de "tag removida" — o rename tinha
esse defeito antes de ser corrigido em 2024. Provar exigiria disparar automação na base real
do cliente, então fica sem prova por decisão.

### Rotas (API pública, host `services.leadconnectorhq.com`)

Nota do contato: `GET|POST /contacts/<id>/notes`, `PUT|DELETE /contacts/<id>/notes/<noteId>`.
Criar exige só `body`; `title`, `color` e `pinned` são opcionais e podem não voltar na
resposta.

Tarefa do contato: `GET|POST /contacts/<id>/tasks`, `PUT|DELETE
/contacts/<id>/tasks/<taskId>`, mais `PUT /contacts/<id>/tasks/<taskId>/completed`. **Criar
exige `title`, `dueDate` e `completed`** — o `completed` é obrigatório na criação, então a CLI
manda `false` sozinha quando o usuário não disser nada. `dueDate` é texto ISO, ao contrário da
agenda, onde ISO devolve lista vazia em silêncio. O que o servidor faz sem `assignedTo` não
está documentado: descobrir ao vivo.

Busca de tarefa por subconta: `POST /locations/<loc>/tasks/search`, com `contactId[]`,
`completed`, `assignedTo[]`, `query`, `limit` (25 por padrão) e `skip`.

Tag da subconta: `POST /locations/<loc>/tags` (responde **200**, não 201),
`PUT /locations/<loc>/tags/<tagId>`, `DELETE /locations/<loc>/tags/<tagId>`. O `DELETE`
devolve as duas grafias (`succeded` e `succeeded`); ler `succeeded` com fallback. O `POST`
devolve `categoryId`, `description` e `color`, que a documentação não lista — esta entrega não
os expõe.

## Decisões do grill

- **A4** — `renomear` é escrita comum, sem flag extra e sem propagação própria. Motivo: a
  prova ao vivo mostrou o servidor reescrevendo a referência no step e no trigger.
- **A1** — mantido o desenho original de `renomear`, que a spec tinha deixado em suspenso.
  Motivo: o modelo por nome só seria fatal se o servidor não propagasse, e ele propaga.
- **A3** — consertar o `trocar-tag` (que não toca trigger nem `customTags`) **fica fora** da
  0.20.0, como dívida declarada. Motivo: `renomear` não depende mais dele, e ampliar a
  escrita de workflow no meio de uma entrega de tag mistura dois riscos.
- **A5** — apagar tag exige `--apagar-citada` quando algum workflow cita a tag, no molde do
  `--apagar-com-cards` do pipeline. A prévia avisa que a tag sai de todos os contatos e que
  isso **pode** acordar automação de "tag removida", sem afirmar que acorda. Motivo: o risco
  é real e não provável de medir; guarda é mais barata que uma onda de mensagens.
- **A6** — a prévia **não** tenta contar os contatos afetados, e diz que não sabe contar.
  Motivo: o GHL não expõe esse número em lugar nenhum (pedido "planned", 129 votos), e
  mapear a busca de contatos só para enfeitar a prévia é escopo novo. Prévia que inventa
  número tranquiliza errado.
- **A2** — o furo do `customTags` (step que escolhe a tag em tempo de execução por um merge
  field) é **declarado na resposta**, não fechado. A tool `tags` avisa quando a subconta tem
  algum step assim, porque ali a contagem de citações é incompleta por natureza. Motivo:
  fechar exigiria resolver merge field, que nenhuma parte do projeto faz.
- **A14** — a tool `tags` **degrada** sem dump: lista as tags ao vivo e omite a coluna de
  impacto, com aviso. Não chama o carregador de dump, seguindo o precedente de
  `workflows_ao_vivo`. Motivo: a tag é ao vivo; exigir dump para listá-la seria arbitrário.
- **A11** — entra a busca de tarefa por subconta, como uma opção de leitura a mais na mesma
  tool. Motivo: "que tarefas estão atrasadas nesta subconta" é a pergunta útil, e custa uma
  rota que já está documentada.
- **A15** — não há bug: o carregador já guarda os nomes de tag em minúsculas
  (`auditor/src/automaster_audit/loader.py:147`), então não existe a assimetria que o dossiê
  suspeitou. Consequência para esta entrega: a tool `tags` lê a tag ao vivo no caso original
  e tem que normalizar para minúsculas antes de cruzar com o índice.
- **A13** — o rastro de escrita de tag fica em `_tags/<loc>/<tagId>/<ts>.json`, não
  `_tags/<loc>/<ts>.json` como a spec dizia. Motivo: é a forma que o helper existente produz,
  e mudar o helper mexeria nas áreas já entregues.

## Validação

Subconta Instaltech (`Xb9gDxwxYhdqtprGcb5E`), contato de teste `uWqujqll20tRuglV3mLt`.
Tag descartável criada e apagada na hora; nenhuma das tags reais tocada. Escrita ao vivo é
serial — perfil Chrome único, dois comandos em paralelo travam no `SingletonLock`. Zero
resíduo ao fim.

## Entrega

`CHANGELOG.md`, `CLAUDE.md` e `.claude-plugin/plugin.json` em 0.20.0; rotas em
`docs/endpoints.md` antes de qualquer código.
