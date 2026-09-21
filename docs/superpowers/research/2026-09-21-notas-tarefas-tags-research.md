# Pesquisa — notas e tarefas do contato + tags da subconta

Spec: `docs/superpowers/specs/2026-09-21-notas-tarefas-tags-design.md`

Três frentes: dois agentes internos (dump + repo) e um externo (mirror offline dos docs v3
do Marketplace, mais os boards públicos do HighLevel).

## Achados

### A1 — Tag em workflow é sempre o NOME, nunca o id. Em step, em trigger e em condição.
- Fonte: dump `~/.automaster/dumps/Xb9gDxwxYhdqtprGcb5E/2026-09-20_0856`; 34 valores
  distintos em `attributes.tags`, 34/34 casam com `tags.json` → `raw.tags[].name`, 0/34
  com o id. `auditor/src/automaster_audit/rules/broken_tag_ref.py:14`,
  `auditor/src/automaster_audit/loader.py:94` (compara nome, case-insensitive),
  `auditor/src/automaster_audit/dashboard.py:65`.
- Contradiz a spec: não — confirma o pior cenário que a spec previu.
- Pergunta que levanta: renomear a tag pela subconta, se o servidor não propagar, apaga a
  ligação entre a tag e todo workflow que a cita. Renomear deixa de ser escrita comum.

### A2 — Há um segundo campo de tag que ninguém no projeto lê: `attributes.customTags`.
- Fonte: workflow `06674078-9c36-4fe2-a5db-265e1c429acf` da Instaltech,
  `{"tags": [], "customTags": "{{opportunity.lost_reason}}"}`. Nem `broken_tag_ref` nem
  `dashboard._wf_refs` olham esse campo.
- Contradiz a spec: parcial.
- Pergunta que levanta: a tag aplicada por esse step é escolhida na hora da execução, pelo
  valor de um campo do contato. Nenhuma prévia de impacto consegue ver essa ligação, e a
  contagem de "quantos workflows citam esta tag" nasce com um furo conhecido. Declarar o
  furo na resposta, ou tentar fechá-lo?

### A3 — O `trocar-tag` que já existe é incompleto: não toca trigger nem `customTags`.
- Fonte: `extractor/src/api/workflow-edit.ts:105-133` (`trocarTag`) varre só
  `out.workflowData.templates`; nunca `triggersData`.
- Contradiz a spec: sim. A spec cita `trocar-tag` como o caminho de propagação, e ele hoje
  deixa o trigger com o nome velho.
- Pergunta que levanta: encaminhar o usuário para uma ferramenta que faz o trabalho pela
  metade é pior que não encaminhar. Consertar o `trocar-tag` entra na 0.20.0?

### A4 — O renomear da interface do GHL propaga para os workflows desde 15/05/2024. O PUT da API não tem essa garantia.
- Fonte: `ideas.gohighlevel.com/changelog/resolved-rename-tag-issues-in-workflow`
  (changelog oficial da correção) e
  `ideas.gohighlevel.com/automations/p/renaming-a-tag-in-settings-triggers-remove-tag-workflow`
  (o bug original, 67 votos: renomear disparava os workflows de "tag removida" e
  desanexava a tag das ações). O changelog fala da seção Tags da **interface**; nada diz
  sobre `PUT /locations/<loc>/tags/<tagId>`.
- Contradiz a spec: parcial.
- Pergunta que levanta: o comportamento seguro talvez já exista de graça, mas só se a API
  fizer o mesmo que o app. Isso é uma prova ao vivo de dez minutos: renomeia uma tag
  descartável citada por um workflow de teste, roda `automaster-audit audit`, e vê se
  `broken_tag_ref` acusa. Até essa prova, o desenho de `renomear` fica em suspenso.

### A5 — Apagar tag da subconta a remove em cascata dos contatos, com restauração por 60 dias. Se dispara automação de "tag removida", ninguém documentou.
- Fonte: artigo "Revamped Tags Management" do help oficial, hoje **404** — só o resumo
  indexado sobreviveu. O disparo em massa só tem relato para o renomear (A4), não para o
  apagar.
- Contradiz a spec: parcial.
- Pergunta que levanta: apagar tag pode disparar uma onda de automação em contatos reais,
  igual ao que remover estágio de pipeline faz com os cards. A guarda `--apagar-citada`
  que a spec previu cobre "workflow cita a tag", não cobre "N contatos têm a tag".

### A6 — Não existe contagem de contatos por tag, em nenhum lugar do GHL.
- Fonte: `ideas.gohighlevel.com/contacts/p/add-tag-count-under-settings-tags`, 129 votos,
  status "planned" posto pela HighLevel em 10/03/2026. O payload da tag tem só `name`,
  `locationId` e `id`.
- Contradiz a spec: não, mas limita A5.
- Pergunta que levanta: a prévia do apagar não consegue dizer "isto afeta 1.200 contatos"
  sem uma busca de contatos por tag, cujo corpo não está documentado no mirror. Prévia sem
  esse número é honesta ou é falsa segurança?

### A7 — O CRUD de tag da subconta existe na API pública, e é o caminho, não a API interna.
- Fonte: `POST /locations/<loc>/tags` (responde **200**, não 201),
  `PUT /locations/<loc>/tags/<tagId>`, `DELETE /locations/<loc>/tags/<tagId>`, todos em
  `services.leadconnectorhq.com`. Criar exige só `{name}`. A leitura que o projeto já usa
  (`fetchTags`, `extractor/src/api/entities.ts:26`) é do mesmo host.
- Contradiz a spec: não.
- Pergunta que levanta: nenhuma. É o raro caso em que a rota pública cobre tudo. Atenção
  só ao `DELETE`, que devolve `{"succeded": true}` — a grafia errada é a única
  documentada aqui, ao contrário de nota e tarefa, que trazem as duas.

### A8 — Nota e tarefa do contato estão inteiramente documentadas, e a tarefa tem uma armadilha na criação.
- Fonte: `GET|POST /contacts/<id>/notes` e `PUT|DELETE /contacts/<id>/notes/<noteId>`;
  idem `/tasks`, mais a rota dedicada `PUT /contacts/<id>/tasks/<taskId>/completed`.
  Criar nota exige só `body`. **Criar tarefa exige `title`, `dueDate` e `completed`** — o
  `completed` é obrigatório na criação; `assignedTo` é opcional.
- Contradiz a spec: não.
- Pergunta que levanta: a CLI vai ter que mandar `completed: false` por conta própria
  quando o usuário não disser nada, senão toda criação de tarefa falha com 422.

### A9 — A data da tarefa é texto ISO, ao contrário da agenda.
- Fonte: `dueDate` com exemplos `2020-10-25T11:00:00Z` e `2021-07-08T02:30:00.000Z`.
- Contradiz a spec: não.
- Pergunta que levanta: nenhuma, mas é o inverso da armadilha da agenda, onde ISO devolve
  lista vazia em silêncio. Vale uma linha em `docs/endpoints.md` dizendo que aqui é ISO.

### A10 — O que o servidor faz sem dono na tarefa não está documentado.
- Fonte: lacuna declarada no mirror; `assignedTo` é opcional e não há default descrito.
- Contradiz a spec: não.
- Pergunta que levanta: descobrir ao vivo, criando uma tarefa sem dono no contato de teste.

### A11 — Existe busca de tarefa por subconta, não só por contato.
- Fonte: `POST /locations/<loc>/tasks/search`, com `contactId[]`, `completed`,
  `assignedTo[]`, `query`, `limit` (25 por padrão) e `skip`.
- Contradiz a spec: parcial. A spec só previu leitura por contato.
- Pergunta que levanta: "que tarefas estão atrasadas nesta subconta" é uma pergunta mais
  útil que "que tarefas este contato tem", e custa uma opção a mais na mesma tool.

### A12 — Nota de compromisso é entidade separada, confirmado.
- Fonte: `extractor/src/api/calendars.ts:113-178`, rotas
  `/calendars/appointments/<id>/notes`. Pai é o compromisso.
- Contradiz a spec: não. Registro.

### A13 — O helper de rastro de escrita não aceita a forma que a spec propôs para tag.
- Fonte: `registroEscrita(loc, pasta, chave, dados)` em `extractor/src/cli.ts:552` sempre
  insere um nível `<chave>` entre a subconta e o arquivo.
- Contradiz a spec: sim, num detalhe. A spec escreveu `_tags/<loc>/<ts>.json`; o helper
  produz `_tags/<loc>/<chave>/<ts>.json`.
- Pergunta que levanta: nenhuma de fundo. Usar o id da tag como `<chave>` e corrigir a
  spec.

### A14 — A tool `tags` precisa funcionar em subconta sem dump, e o helper de hoje não deixa.
- Fonte: `_load` (`mcp_server.py:86`) chama `_snapshot` (`:59`), que levanta erro quando a
  subconta não tem dump. O precedente de tool ao vivo sem dump é `workflows_ao_vivo`
  (`:872`), que não chama `_load`.
- Contradiz a spec: parcial.
- Pergunta que levanta: a tool degrada (lista as tags sem a coluna de impacto) ou exige
  dump? A spec disse degradar; o código exige uma escolha explícita.

### A15 — Tag com maiúscula pode aparecer como órfã hoje, por assimetria de normalização.
- Fonte: `dashboard.py:110` grava a chave em minúscula, mas `dashboard.py:141-145` procura
  usando `name` de `ctx.tag_names`, no caso original.
- Contradiz a spec: não, é bug pré-existente.
- Pergunta que levanta: se for bug de verdade, a coluna de impacto da tool `tags` nasce
  errada para qualquer tag com letra maiúscula. Confirmar antes de construir sobre isso.

## Fila do grill

Ordenada por dependência.

1. A4 — o `PUT` da API propaga o rename para os workflows como a interface faz? Enquanto
   isso não tem prova ao vivo, o desenho de `renomear` fica indefinido. (trava A1, A3)
2. A1 — se não propagar, `renomear` vira o quê: bloqueio, flag explícita, ou renomear
   seguido de propagação automática? (trava A3)
3. A3 — consertar o `trocar-tag` (trigger e `customTags`) entra na 0.20.0 ou fica em
   dívida declarada?
4. A5 — apagar tag pode disparar automação em massa nos contatos. Que guarda?
5. A6 — sem contagem de contatos por tag, a prévia do apagar vale?
6. A2 — declarar o furo do `customTags` na resposta ou fechá-lo?
7. A14 — a tool `tags` degrada sem dump ou exige dump?
8. A11 — entra a busca de tarefa por subconta?
9. A15 — confirmar se a tag com maiúscula aparece órfã antes de construir a coluna de
   impacto.

## Prova ao vivo — A4 respondido (2026-09-21, Instaltech)

Script: `docs/superpowers/provas/2026-09-21-prova-tag-rename.ts` (descartável, guardado como
registro).

Roteiro: tag `zz-prova-rename-automaster` criada; workflow `ZZ PROVA RENAME TAG` criado em
pasta, em `draft`, com um step `add_contact_tag` citando a tag e um trigger `contact_tag`
disparando por ela; tag renomeada por `PUT /locations/<loc>/tags/<tagId>`; workflow e
trigger relidos 3s depois; workflow e tag apagados. Zero resíduo.

**Veredito: o `PUT` propaga, nos dois lugares.**

```
step.attributes.tags : ["zz-prova-rename-automaster-2"]
trigger conditions   : [{"field":"tagsAdded","value":"zz-prova-rename-automaster-2",...}]
```

Três fatos que caem daí:

- **A4 resolvido**: renomear tag pela API é seguro. O servidor reescreve a referência nos
  workflows, inclusive no trigger — que é justamente o lugar que o `trocar-tag` do projeto
  não cobre. Renomear pelo plugin não precisa de propagação própria.
- **A3 esvazia**: a lacuna do `trocar-tag` (não tocar trigger) continua sendo uma lacuna,
  mas deixa de ser um bloqueio para esta entrega — `renomear` não depende dele.
- `DELETE` de tag devolve **as duas grafias**: `{"succeded":true,"succeeded":true}`. A doc
  que só mostrava a errada está incompleta; ler `succeeded` com fallback resolve.
- `POST` de tag devolve a tag inteira com campos que a doc não lista: `categoryId`,
  `description`, `color`, todos `null`. Há mais superfície de tag do que só o nome.

Segue **sem prova**: se o rename dispara os workflows de "tag removida" (o workflow da prova
estava em `draft`, de propósito), e o que o `DELETE` faz com contatos que têm a tag.
