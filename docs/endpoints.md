# Endpoints da API interna GHL — mapeados

Validado em 2026-06-10 contra subconta `Instaltech` (`WPIUKW3L4lDyMhLhKYKG`), 21 workflows.
Resultado do spike manual (precursor do comando `discover`).

## Autenticação — DOIS esquemas (descoberta crítica)

Requests do app carregam **ambos** os tokens; o servidor escolhe qual valida por endpoint.

| Token | Header | Conteúdo | Expira |
|---|---|---|---|
| **Bearer** | `authorization: Bearer <jwt>` | JWT custom (`channel`, `source`, `authClass`) | ~1h (`exp` no payload) |
| **token-id** | `token-id: <jwt>` | JWT Firebase (`user_id`, `company_id`, `locations[]`, `permissions`) | ~1h |

Headers comuns obrigatórios: `channel: APP`, `source: WEB_USER`, `version: 2021-07-28`, e um `user-agent` de browser (**sem UA de browser → HTTP 403**; `Python-urllib` é bloqueado por WAF).

**Regra prática:** enviar sempre os dois tokens + `version` + UA de browser em toda chamada. Endpoints de workflow aceitam só Bearer, mas os de `locations/*` e `opportunities/*` exigem o `token-id` Firebase (sem ele → **401**, mesmo com Bearer válido).

Ambos JWTs vêm do mesmo login e renovam juntos. A renovação no extractor (recarregar página via Playwright e recapturar) deve pegar **os dois**.

## Hosts

- `backend.leadconnectorhq.com` — workflows, pipelines, custom fields
- `services.leadconnectorhq.com` — tags
- `firebasestorage.googleapis.com` — **steps dos workflows** (URL pré-assinada, baixa sem auth)

## Workflows

### Listar (lista plana, ignora pastas)
```
GET backend.leadconnectorhq.com/workflow/<locationId>/list
    ?type=workflow&limit=200&offset=0&sortBy=name&sortOrder=asc
```
- Resposta: `{ rows: [...], count: N }`. Paginar por `offset` até `len >= count`.
- ⚠️ Usar `type=workflow` (lista plana de todos). `parentId=root` devolve só raiz + **pastas** — workflows ficam dentro delas. Na Instaltech: `parentId=root` = 7 itens (6 pastas + 1 wf); `type=workflow` = 21 workflows reais.
- Cada row: `id`, `name`, `status` (`published`/`draft`), `parentId` (pasta), `version`, `updatedAt`, `createdAt`.

### Detalhe (metadados — NÃO traz os steps)
```
GET backend.leadconnectorhq.com/workflow/<locationId>/<workflowId>
    ?includeScheduledPauseInfo=true
```
- Metadados: `name`, `status`, `version`, `timezone`, flags (`allowMultiple`, `stopOnResponse`, ...).
- **Campo `fileUrl`**: URL Firebase pré-assinada com os steps. **As actions não vêm no JSON da API** — vêm desse arquivo.
- `workflowData` aqui só traz `templates` parcial; a fonte completa é o `fileUrl`.

### Steps (no Firebase)
```
GET <fileUrl do detalhe>     # firebasestorage.googleapis.com, sem auth
```
- Resposta: `{ templates: [ { id, order, type, name, next, ... } ] }`.
- Lista encadeada por `next` (id do próximo step). `if_else` ramifica.
- Tipos de action observados (21 workflows): `if_else`, `wait`, `sms`, `webhook`, `transition` (move stage), `add_contact_tag`, `update_contact_field`, `add_to_workflow`, `internal_notification`, `find_opportunity`, `remove_contact_tag`, `drip`, `internal_update_opportunity`, `manual-call`, `assign_user`, `goto`, `internal_create_opportunity`.

### Triggers (array separado)
```
GET backend.leadconnectorhq.com/workflow/<locationId>/trigger?workflowId=<workflowId>
```
- Resposta: **array** de triggers. Cada um: `id`, `name`, `belongs_to`, `masterType`, filtros.

## Workflows ao vivo

Host `backend.leadconnectorhq.com`, os dois tokens. Exercitado ao vivo em 2026-09-20 contra
a Instaltech (`Xb9gDxwxYhdqtprGcb5E`), workflow descartável `test.cmd [review]`
(`457e3101-9aa4-4733-acaa-9f7a90bf6f90`) e contato de teste `uWqujqll20tRuglV3mLt`. Detalhe
completo em `docs/superpowers/handoffs/2026-09-20-workflows-ao-vivo-prova.md`.

**Atenção ao prefixo: a busca de inscritos usa `/workflows` (plural); lista, meta, inscrição
por contato e todas as escritas usam `/workflow` (singular).** Não é engano de digitação —
são serviços diferentes no backend.

### Leitura
| O que | Rota | Ao vivo |
|---|---|---|
| Lista de workflows | `GET .../workflow/<loc>/list?type=workflow&limit=&offset=&sortBy=name&sortOrder=asc` | ✓ |
| Meta de um workflow | `GET .../workflow/<loc>/<wid>?includeScheduledPauseInfo=true` | ✓ |
| Inscritos de um workflow (paginado) | `GET .../workflows/status/search/workflow-with-filter?workflowId=&locationId=&limit=&action=first\|next&referenceId=&referenceCreatedAt=&referenceSid=` | ✓ |
| Workflows de um contato | `GET .../workflow/<loc>/contact/<cid>/statuses_v2` | ✓ |
| Contagem de inscritos (`enroll-stats`) | `GET .../workflows/status/enroll-stats?workflowId=&locationId=` e as 3 variantes abaixo | ✓ (todas 404/401) |

`enroll-stats` é **404 em todas as variantes tentadas**:

    GET /workflows/status/enroll-stats?workflowId=..&locationId=..  → 404 Cannot GET
    GET /workflow/status/enroll-stats?...                           → 401
    GET /workflows/<loc>/status/enroll-stats?workflowId=..          → 404
    GET /workflows/status/stats?...                                 → 404

Não existe rota de contagem. O `count` que `workflow-with-filter` devolve é **tamanho da
página**, não total de inscritos — confirmado ao vivo. Não há como saber quantas pessoas já
passaram por um workflow sem paginar a lista inteira.

A meta do workflow vem na **raiz** da resposta, não sob `meta.workflow`: `{"_id":"...",
"name":"...","status":"draft","updatedBy":"...","fileUrl":"...","version":10,...}`. O id fica
em `_id`, não em `id`.

O campo da próxima execução na linha de inscrição é `executeOn`. `nextExecutionOn` — o nome
que apareceu ao ler o bundle público — não existe na resposta real do servidor.

`GET .../contact/<cid>` (usado para exibir nome) **não devolve `contact.name`** nem
`contact.contactName`. Vêm apenas `firstName`, `lastName`, `fullNameLowerCase`, `email`.

`statuses_v2` (workflows de um contato) devolve linhas mínimas: só `{workflowId, status}`. Sem
`_id`, sem `contactId`, sem passo, sem `createdAt`, sem `meta.addedSource`. Por isso o id de
inscrição para `force-resume` **tem que sair da busca de inscritos do workflow**
(`workflow-with-filter`, filtrando por `workflowId` e `contactId`), nunca de `statuses_v2`.

`workflow-with-filter` devolve as linhas `finished` **junto** das vivas. Contar o tamanho da
lista de inscritos superestima quem está dentro agora — confirmado ao vivo: uma única
inscrição `finished` aparecia como "1 contato dentro". O mesmo vale para `statuses_v2` do
lado do contato: 9 de 10 linhas do contato de teste eram `finished`, e a contagem ingênua do
tamanho da lista mentia que ele estava em dez workflows.

### Escrita
| O que | Rota | Corpo | Ao vivo |
|---|---|---|---|
| Publicar/despublicar | `PUT .../workflow/<loc>/change-status/<wid>` | `{status, updatedBy}` | ✓ |
| Inscrever contato | `POST .../workflow/<loc>/<wid>/start-workflow` | `{contactId, actionFrom:{userId, source, channel}, eventStartTime?}` | ✓ |
| Remover contato | `POST .../workflow/<loc>/contact/<cid>/stop-execution` | `{workflowId, removedFrom:{userId, channel, source}}` | ✓ |
| Retomar inscrição | `POST .../workflow/<loc>/<inscricaoId>/force-resume` | `{actionFrom:{userId, channel, source}}` | ✓ (sobre inscrição `finished`, ver abaixo) |

`change-status` devolve o workflow inteiro com o `status` novo; `updatedBy` muda para o id do
usuário do token — a autoria funciona de ponta a ponta (confirmado ao vivo: mudou de
`OvPQsxKKffcLSOGL90wN` para `GYFy8jJyy0KRNliM8ejy`).

**Inscrever num workflow em `draft` devolve 200 e não cria inscrição nenhuma.** A resposta é
idêntica à de uma inscrição que funciona (`200 {"msg":"ADD To WF:... PubSub
StartWorker:...","error":false}`), em duas tentativas, sem nenhuma linha nova depois. Só
publicar o workflow fez a inscrição aparecer. O comando não tem como distinguir os dois casos
pela resposta.

**Despublicar não remove ninguém: congela.** Quem está dentro para no passo em que está e
volta a andar, todo mundo de uma vez, quando o workflow for republicado.

**Inscrever é enfileirado pelo servidor** (`"PubSub StartWorker"` na mensagem) — ler o estado
logo depois de inscrever pode não mostrar o contato ainda, sem que nada tenha falhado.

**Remover é enfileirado e, sobre inscrição já terminada, não faz nada.**
`stop-execution` devolveu `200 {"msg":"successfully queued contact to end workflow
execution"}` sobre uma inscrição já `finished`, e ela continuou `finished` — não havia o que
encerrar.

**`force-resume` age sobre o id da INSCRIÇÃO, não do contato**, e recusa inscrição terminada:
`404 {"msg":"Invalid workflow status id"}` sobre uma inscrição `finished`. O resolvedor local
(que busca a inscrição certa por `workflowId` + `contactId` na lista de inscritos do
workflow, já que `statuses_v2` não serve para isso) achou o id certo — quem recusou foi o
servidor, não o código.

**`source` de uma inscrição criada pelo app é `add_to_campaign_modal`**, e o campo é
persistido (confirmado com o workflow publicado). O servidor **aceitou** `source:
"automaster"` com `200`, sem `422` — o enum não é fechado —, mas o teste rodou com o workflow
em `draft`, onde nenhuma inscrição é criada, então a persistência desse valor não foi vista.
O código segue mandando o valor do app.

**Nenhum dos quatro comportamentos abaixo foi exercitado**, porque nenhum workflow
descartável da Instaltech tem passo de espera — o contato entra e termina na hora, sem ficar
parado onde daria para provar sem disparar automação real de cliente: `retomar` sobre uma
inscrição genuinamente pausada, despublicar com gente de verdade congelando, remover um
contato parado no meio de um workflow, e o efeito da remoção por contato sobre inscrição
dupla (`allowMultiple`). Ver o handoff citado acima.

### Correção: descoberta de bundle

A nota antiga (seção "Como o bundle foi lido") está desatualizada para o editor de workflow:
o app hoje carrega de `production.app-manifest.leadconnectorhq.com/latest/manifest.json`, e o
editor de workflow é uma aplicação à parte, em
`client-app-automation-workflows.leadconnectorhq.com`. As rotas mapeadas acima vieram de lá,
não do bundle `crm/*` usado nas seções anteriores.

## Entidades referenciadas (para auditoria de refs)

### Pipelines (+ stages)
```
GET backend.leadconnectorhq.com/opportunities/pipelines?locationId=<locationId>
```
- `{ pipelines: [ { id, name, stages: [ { id, name } ] } ] }`. Instaltech: 1 pipeline (`Vendas`, 9 stages).

### Custom fields
```
GET backend.leadconnectorhq.com/locations/<locationId>/customFields/search
    ?parentId=&skip=0&limit=10000&documentType=field&model=all&query=&includeStandards=true
```
- `{ customFields: [ { id, name, dataType, fieldKey } ] }`. Instaltech: 61 (inclui `STANDARD_FIELD`).
- `documentType=folder` lista as pastas de campos (separado).

### Tags
```
GET services.leadconnectorhq.com/locations/<locationId>/tags/search
    ?skip=0&limit=10000&query=&getCount=true
```
- `{ tags: [ { id, name } ] }`. Instaltech: 15. ⚠️ Host `services`, não `backend`.

## Resiliência confirmada no spike

- Rate limit: 0,2s entre chamadas funcionou para 21 workflows × 3 req sem 429. Manter conservador.
- Todos os 21 detalhes + steps retornaram 200/200 (até workflow de 50 steps).
- Token expira no meio de sessão longa → 401. Renovar recapturando os dois JWTs.

## Audit logs (linha do tempo de um registro) — validado 2026-06-11

```
GET services.leadconnectorhq.com/audit/search/v2
    ?page=1&pageSize=100&startAt=<ISO>&endAt=<ISO>&id=<recordId>&locationId=<locationId>
```
- Resposta: `{ logs: [...] }`. Paginar por `page` até batch < pageSize.
- Evento: `type` (`TAG_ADDED`/`TAG_REMOVED`/`UPDATED`/...), `before`/`after`, `changedFields`,
  `documentName` (nome do contato), `createdAt`, e **`source`** (`WORKFLOW_NEW` com
  `sourceId` = id do workflow causador; `WEB_USER` com `sourceName`; `INTEGRATION`; etc.).
- Uso no projeto: `npm run timeline -- --location <loc> --id <recordId> [--days 60]`
  (sob demanda, HTML efêmero em /tmp — POR DESIGN não grava em dumps/).

### Oportunidades de um contato (associations) — validado 2026-06-11
```
GET services.leadconnectorhq.com/associations/relations/record/<contactId>
    ?locationId=<loc>&associationIds=OPPORTUNITIES_CONTACTS_ASSOCIATION&skip=0&limit=10
```
- `{ relations: [{ recordId: <opportunityId>, ... }] }`. O audit/search/v2 aceita
  o opportunityId no `id` → histórico da oportunidade (criação, stage, status).
- Snapshot do registro: `POST services.../objects/opportunity/records/ids` (observado, não usado).
- Agendamentos: ver `## Agenda`. A nota antiga ("endpoint recusado com tokens internos")
  estava errada: o 4xx vinha de `contactId` (parâmetro inexistente na rota) e da falta de
  `calendarId`/`userId`/`groupId`, não da auth.

## Escrita — PUT de campo padrão e custom (todos os tipos), POST/DELETE de tag validados ao vivo (2026-09-18)

Rotas obtidas lendo os chunks JS do app (`contacts-highrise`, `appcdn.leadconnectorhq.com`).
Exercitadas ao vivo em 2026-09-18 contra a Instaltech (`Xb9gDxwxYhdqtprGcb5E`), contato de
teste `uWqujqll20tRuglV3mLt`: PUT de custom field TEXT, POST de tag e DELETE de tag, incluindo
uma execução combinando `set` + `tagsDel` na mesma chamada. Todas responderam 200. Headers de
escrita, provados pelos scripts soltos do extractor (`extractor/restore.ts`, `extractor/patch.ts`,
`extractor/cv.ts`, não versionados) e confirmados na execução ao vivo: os mesmos de leitura
(`authorization: Bearer`, `token-id`, `channel: APP`, `source: WEB_USER`, `version: 2021-07-28`,
UA de browser) mais `content-type: application/json`. **Nenhum header de escopo de subconta foi
necessário** — os headers que o `GhlClient` já manda bastaram.
O PUT de workflow exige também `version` e `dataVersion` vindos do GET anterior
(concorrência otimista) — o PUT de contato não tem exigência equivalente (não pediu esses campos
nas 3 execuções ao vivo).

**Achado mais importante: o PUT é MERGE, não replace.** Alterar 1 custom field preservou os
outros 4 custom fields, as 2 tags e todos os 4 campos padrão do contato de teste, em 3 execuções
sem nenhum aviso de destruição.

**O que foi exercitado:** PUT de custom field `TEXT`, `SINGLE_OPTIONS`, `RADIO`, `NUMERICAL`,
`CHECKBOX`, `DATE`, `MONETORY`, `LARGE_TEXT` e `TEXTBOX_LIST`; PUT dos **15** campos padrão do
mapa `STANDARD_FIELD_BODY_KEY`; POST de tag; DELETE de tag; `set` + `tagsDel` na mesma execução.
Tudo 200, pela CLI e pela tool MCP `editar`.

**`TEXTBOX_LIST` é o único tipo que não aceita string.** O valor tem que ser um objeto
`{ "<picklistOption.id>": "<texto>" }`. String crua responde 200 e grava `{}` — escrita perdida
em silêncio. Objeto por *label* e array `[{id, value}]` também são descartados sem erro.
Esse objeto é **merge por chave**: `{}` não limpa nada; para limpar, mande cada id com `""`
(o campo fica `{}`, não some). Por isso a CLI passa a interpretar valor de `--set` que começa
com `{` ou `[` como JSON (`parseCustomValue`).

**Normalização do GHL na resposta** (o valor vai como string em todos os casos):
`NUMERICAL` e `MONETORY` voltam número (`1234.56`), `CHECKBOX` volta array (`["sim"]`), `DATE` volta a string
ISO como enviada, `contact.phone` volta em E.164 com o DDI do `country` do contato
(`11999998888` → `+5511999998888`). O aviso de "escrita possivelmente ignorada" dispara nesse
último caso e é falso positivo esperado.

**Limpar campo:** custom field limpa com string vazia (inclusive `MONETORY` e `LARGE_TEXT`;
`TEXTBOX_LIST` é a exceção, ver acima); campo padrão **não** — a API aceita 200
e ignora. Para campo padrão o corpo tem que levar `null`, e é isso que a CLI manda quando o
valor de `--set` é vazio.

**Custom field `PHONE`** (validado ao vivo em 2026-09-18 com um campo criado e apagado para o
teste): aceita string crua e **não** coage para E.164 — `11999998888` volta igual, ao contrário
do campo padrão `contact.phone`. Limpa com string vazia.

**Custom field `EMAIL` não existe.** O POST de criação responde 422 com a lista fechada de
tipos aceitos: `TEXT, LARGE_TEXT, NUMERICAL, PHONE, MONETORY, CHECKBOX, SINGLE_OPTIONS,
MULTIPLE_OPTIONS, FLOAT, TIME, DATE, TEXTBOX_LIST, FILE_UPLOAD, SIGNATURE, RADIO, URL,
DATE_TIME, USER, RICH_TEXT, FORMULA`. O `EMAIL` visto em campos `model: business` vem de outro
enum. **Os 9 tipos restantes foram exercitados em 2026-09-18**, cada um com um campo criado e
apagado na Instaltech (nenhum existia com `model: contact`). Todos aceitam string no `value`
e todos limpam com string vazia. O que a API faz com o valor:

| tipo | enviei | voltou |
|---|---|---|
| `FLOAT` | `"3.14"` | `3.14` (número) |
| `TIME` | `"14:30"` | `"14:30:00"` (segundos completados) |
| `DATE_TIME` | `"2026-05-17T14:30:00.000Z"` | igual |
| `URL` | `"https://exemplo.com"` | igual |
| `MULTIPLE_OPTIONS` | `"um"` | `["um"]` (array, como `CHECKBOX`) |
| `USER` | id do usuário, ou array com ele | string com o id |
| `RICH_TEXT` | `"<p>oi <b>rico</b></p>"` | **string com um doc ProseMirror JSON** (`{"type":"doc","content":[...]}`) — o HTML é parseado |
| `SIGNATURE` | URL | igual, sem validação |
| `FILE_UPLOAD` | URL | objeto `{<uuid>: {meta:{fieldname,mimetype,originalname,size,uuid}, url}}` — a API **inventa o `meta`** a partir da URL (`size: 1`, mimetype pelo sufixo) sem baixar o arquivo |

`URL` é o único tipo que **valida** o valor: `"nao-e-url"` responde HTTP 400 (`Please enter a
valid URL`) em vez de gravar lixo.

`FORMULA` aparece no enum mas o POST de criação o rejeita; não há como exercitá-lo por essa
rota.

**Config obrigatória no POST, por tipo** (400/422 explícito quando falta):
`MULTIPLE_OPTIONS`/`SINGLE_OPTIONS` levam `options: [...]` (não `picklistOptions`, que a
resposta usa); `TIME` e `DATE_TIME` levam `dateTimeValidation: { timezone }`; `URL` leva
`urlValidation: { mode: "allow_all" | "allow_only" | "block" }`; `USER` leva
`userFieldConfig: { multiSelect: boolean }`.

### Criar e apagar custom field — validado ao vivo (2026-09-18)
```
POST   backend.leadconnectorhq.com/locations/<locationId>/customFields
DELETE backend.leadconnectorhq.com/locations/<locationId>/customFields/<fieldId>
```
- Corpo do POST: `{ name, dataType, model: "contact", placeholder, position, showInForms }`.
  Resposta 200 `{ customField: { id, fieldKey, parentId, ... } }`; o `fieldKey` é derivado do
  nome (`zz probe PHONE` → `contact.zz_probe_phone`).
- DELETE responde 200 e some do `customFields/search`. Nenhum comando do extractor expõe essas
  duas rotas — foram exercitadas por script descartável.

### Contato inteiro (snapshot) — GET validado ao vivo
```
GET services.leadconnectorhq.com/contacts/<contactId>
```
- Headers: os de leitura padrão do `GhlClient` (Bearer + `token-id`, sem `content-type`).
- Resposta **200**, confirmada com um contato real da Instaltech: `{ contact: {...} }`.
- Chaves de topo: `id`, `dateAdded`, `tags`, `type`, `locationId`, `firstName`,
  `firstNameLowerCase`, `fullNameLowerCase`, `lastName`, `lastNameLowerCase`, `phone`,
  `country`, `assignedTo`, `createdBy`, `profilePhoto`, `dateUpdated`, `followers`,
  `customFields`, `additionalEmails`, `additionalPhones`.
- `customFields` é **array de `{ id, value }`** — confirmado no mesmo contato real:
  `customFields: [{"id":"3eqIvbxYmKdonxhAcyGv","value":"Falso"}, ...]`. ⚠️ Armadilha: a
  API pública v2 usa `field_value` para o mesmo conceito; a interna usa `value`. Quem for
  montar o corpo do PUT (Task 6, `buildFieldsBody`) tem que usar `value`, não `field_value`.

### Campos do contato — PUT de custom field TEXT validado ao vivo
```
PUT backend.leadconnectorhq.com/contacts/<contactId>?version=14-05-22
```
- O `?version=14-05-22` é parte da rota (query string fixa do app), não um header.
- Corpo, pelo código do app e confirmado ao vivo para custom field TEXT: campo padrão
  (`phone`, `companyName`, `email`, ...) vai cru no topo do corpo, como no GET; custom field
  vai em `customFields: [{ id, value }]`.
- Resposta: **200**, confirmada ao vivo para campo padrão e para custom field
  `TEXT`/`SINGLE_OPTIONS`/`RADIO`/`NUMERICAL`/`CHECKBOX`/`DATE`.
- **PUT é MERGE, não replace** (achado desta validação): campos não incluídos no corpo
  permanecem intocados.
- `contact.source` está de volta no `STANDARD_FIELD_BODY_KEY` (`extractor/src/cli.ts`):
  escrita e releitura confirmadas ao vivo em 2026-09-18 (`Facebook` → `Automaster QA` →
  `Facebook`). A chave `source` aparece no GET quando o contato tem valor; a lista de chaves
  de topo acima veio de um contato que não tinha.
- ⚠️ **Perigo não confirmado nem negado na interna:** na API pública v2 do GHL, mandar
  `tags` dentro do PUT de campos do contato **sobrescreve a lista inteira de tags**. Por
  isso, aqui, tag nunca vai por esse PUT — sempre pelos endpoints granulares abaixo. A
  validação ao vivo não testou mandar `tags` nesse PUT (não havia motivo, já que tag usa
  os endpoints granulares).

### Tags — POST e DELETE validados ao vivo
```
POST   backend.leadconnectorhq.com/contacts/<contactId>/tags     corpo: { tags: [...] }
DELETE backend.leadconnectorhq.com/contacts/<contactId>/tags     corpo: { tags: [...] }
```
- Adicionar e remover, respectivamente. Resposta: **200**, confirmada ao vivo em ambos.
- Tag de teste criada nessa validação: `teste-automaster` (id `b6exN50lRXSodrTXKDE0`), na
  Instaltech; permanece na subconta.

### Bônus (do bundle, não usado no projeto ainda)
```
POST backend.leadconnectorhq.com/contacts/<contactId>/customFields/refresh
```
- Recalcula campo computado. Sem corpo observado, sem uso previsto por ora.

## Conversas — leitura validada ao vivo (2026-09-19)

Subconta Instaltech, contato `uWqujqll20tRuglV3mLt`. Host **`services`**, não `backend`
(o `backend` responde igual no search, mas o app usa o `services`). Auth: **só `token-id`**
— as respostas vieram com `authorization` ausente nos requests reais do app; o `GhlClient`
manda os dois e funciona.

### Achar a conversa de um contato
```
GET services.leadconnectorhq.com/conversations/search?locationId=<loc>&contactId=<id>&limit=20
```
- Resposta: `{conversations: [...]}`. Cada item traz `lastMessageType` (string `TYPE_*`),
  `lastMessageBody` (prévia), `lastMessageDirection`, `lastOutboundMessageAction`
  (`automated`/`manual`), `unreadCount`, `tags`, `messageTypes` (números).
- Normalmente há **uma conversa por contato**, agregando todos os canais.
- É indexado (ES) com atraso: conversa nova leva ~1 min para aparecer aqui.

### Ler as mensagens
```
GET services.leadconnectorhq.com/conversations/<conversationId>/messages?limit=50[&lastMessageId=<id>]
GET services.leadconnectorhq.com/f1/conversations/<conversationId>/messages?limit=50
```
- As duas funcionam e devolvem o mesmo conteúdo. **Use a sem `/f1`**: só ela traz
  `nextPage`. O app usa a `/f1`.
- Resposta: `{messages: {messages: [...], lastMessageId, nextPage}}`. Ordem: **mais recente
  primeiro**. Paginação por `lastMessageId`, não por offset; páginas não se sobrepõem.
- O corpo do e-mail já vem em texto plano no `body` (há também `bodyStorageUrl`, não
  necessário). `GET /conversations/messages/email/<id>` responde **400** com id de mensagem
  — não é o caminho.

### O `type` é numérico na interna
A API pública usa as strings `TYPE_SMS`, `TYPE_EMAIL`…; a interna manda **números**. Mapa
completo (53 valores) extraído do bundle `conversations-new-ui` e fixado em
`extractor/src/api/conversations.ts`. Os principais: 1 CALL, 2 SMS, 3 EMAIL, 19 WHATSAPP,
20 CUSTOM_SMS, 22 CUSTOM_PROVIDER_SMS, 29 LIVE_CHAT, 37 INTERNAL_COMMENT, 50 FORM_SUBMISSION.
Os `ACTIVITY_*` (25–28, 31, 38, 44, 51) **não são mensagem** — são eventos de timeline
misturados no mesmo array; o comando `conversas` os esconde salvo `--atividades`.

### Quem mandou: use `source`, não o `userId`
A mensagem traz `source` com `app | workflow | campaign | api | bulk_actions`. **Mensagem
disparada por workflow vem com `userId` preenchido** (o dono do workflow), então deduzir
automação pela ausência de autor erra — medido ao vivo: e-mail com `userId` e
`source: "workflow"`. Nem toda mensagem traz `source`.

### Como o bundle foi lido (atalho reaproveitável)
Os arquivos de `appcdn.leadconnectorhq.com/crm/<app>/<build>/static/js/*.js` são públicos,
mas respondem **403 sem UA de browser**. Com `curl -A "<UA de Chrome>"` baixam normalmente.
É o caminho mais rápido para enums e templates de rota (`grep -oh '\`/[^\`]*\`'`), sem
sessão e sem clicar na interface.

### Enviar mensagem — validado ao vivo (2026-09-19)
```
POST services.leadconnectorhq.com/conversations/messages
corpo: { type, contactId, message, subject?, emailFrom?, attachments?, conversationId? }
```
- `type` aqui é **string** (`SMS`, `Email`, `WhatsApp`, `IG`, `FB`, `Live_Chat`, `Custom`,
  `InternalComment`) — ao contrário do `type` numérico que a leitura devolve.
- Resposta: `{conversationId, messageId, ...}`. Validado com `InternalComment` na Instaltech
  (contato `uWqujqll20tRuglV3mLt`, messageId `xOFkJpI1XGV6Ox5e10jb`): a nota apareceu na
  leitura em seguida como `INTERNAL_COMMENT`, `origem: "app"`.
- **`InternalComment` não sai para o contato** — fica na conversa como nota interna. É o tipo
  para exercitar o caminho sem mandar nada para fora. Os demais canais não foram enviados ao
  vivo: fazê-lo significa mandar mensagem de verdade para uma pessoa.
- Não existe desfazer, e a granularidade mínima de exclusão é a conversa inteira. Cada envio
  deixa registro em `<dumps>/_mensagens/<loc>/<contactId>/<ts>.json`.

### Resto da superfície de conversas — validado ao vivo (2026-09-19)

Tudo abaixo na Instaltech, contato `uWqujqll20tRuglV3mLt`, host `services`.

| o quê | chamada | observação |
|---|---|---|
| filtrar por tipo | `GET /conversations/<conv>/messages?type=TYPE_EMAIL` | no filtro o tipo é **string**; na resposta volta número |
| buscar na conversa | `POST /conversations/message-search/<conv>` `{locationId, query, limit, sortDirection}` | devolve só `matchedMessageIds` (com `emailMessageId`), sem corpo |
| buscar na subconta | `POST /conversations/message-search` `{locationId, query, limit}` | devolve conversas + a mensagem que casou; **`limit` é ignorado** (pedi 3, vieram 20) |
| e-mail completo | `GET /conversations/messages/email/<emailMessageId>` | o id **não** é o da mensagem: é o `altId`/`emailMessageId`. Com o id da mensagem responde 400 |
| vários e-mails | `POST /conversations/messages/email/batch` `{locationId, ids}` | o `search?threadId=` recusou toda combinação de params testada |
| marcar lida | `PUT /conversations/<conv>` `{locationId, unreadCount: 0}` | mandar junto `firstUnreadInboundMessageId`/`Timestamp`, como a interface faz, dá **422** |
| marcar não lida | `PUT /conversations/<conv>` `{locationId, unreadCount: 1}` | |
| estrela | `PUT /conversations/<conv>` `{locationId, starred: bool}` | |
| apagar conversa | `DELETE /conversations/<conv>` | **não exercitado** — leva o histórico inteiro, e não há delete de mensagem avulsa |
| rascunho | `POST /conversations/messages/drafts` `{locationId, contactId, body, channel, attachments}` | criar/listar/apagar validados; resposta traz `_id` |
| listar rascunhos | `GET /conversations/messages/drafts/<loc>/contacts/<contactId>` | |
| apagar rascunho | `DELETE /conversations/messages/drafts/<draftId>` | |
| cancelar agendada | `DELETE /conversations/messages/<id>/schedule` (ou `/messages/email/<id>/schedule`) | responde **200 mesmo quando falha**, com `message: "Cannot cancel..."` — leia o texto |
| reenviar | `POST /conversations/messages/resend/text` `{messageId, locationId}` / `/resend/email` `{emailMessageId, locationId}` | **não exercitado**: exige mensagem que falhou |
| transcrição | `GET /conversations/locations/<loc>/messages/<msgId>/transcription?index=0` | 400 quando a mensagem não tem; só chamada |
| gravação | `GET /conversations/messages/<msgId>/locations/<loc>/recording?index=0` | 422 em mensagem sem gravação; devolve binário, não JSON |
| criar conversa | `POST /conversations` | **404** — não existe; o envio cria a conversa sozinho |

**Agendamento não vale para nota interna.** `scheduledTimestamp` (epoch em segundos) no POST
de envio é aceito, mas com `InternalComment` a mensagem sai na hora: o cancelamento respondeu
"Cannot cancel the message as the message was already sent!". Para canal externo o campo não
foi exercitado — testar significa arriscar mandar a mensagem de verdade se o cancelamento
falhar.

### Upload de anexo — validado ao vivo (2026-09-19)

```
POST services.leadconnectorhq.com/conversations/messages/upload
multipart: conversationId, disableMaxFileSize=true, disableMaxFiles=true,
           files (um campo por arquivo), isGroupSms=true só em group chat
```
- Resposta: `{uploadedFiles: {<nome do arquivo>: <url>}, twilioMediaSids: [...]}`. As URLs
  saem no domínio da subconta (`app.<dominio>/conversations-assets/location/<loc>/conversations/<conv>/<uuid>.<ext>`)
  e alimentam o `attachments` do POST de envio.
- **Não mande `content-type` à mão** — o boundary é montado pelo Playwright a partir do
  `FormData`. É o único caminho não-JSON do `GhlClient` (`postMultipart`).
- O header `version: v4` que o bundle liga condicionalmente **não foi necessário**: o
  upload passou sem ele. A CLI expõe `--v4` para o caso de alguma conta exigir.
- Validado na Instaltech (contato `uWqujqll20tRuglV3mLt`, conversa `HypNQNXNG1ADmmr0uUPr`):
  PNG de 8×8 subiu e a URL voltou numa nota interna (`messageId NYxwRVHxtUQD6N2DhZJN`).
- Group chat (`isGroupSms`) e anexo de WhatsApp (base `phone-system`) **não** foram
  exercitados; o campo existe no código mas segue sem prova ao vivo.

### WhatsApp, IA, SLA e group chat (2026-09-19)

Base `services.leadconnectorhq.com/phone-system` no WhatsApp; `.../conversations` no resto.
Rotas lidas do bundle `crm/conversations-new-ui/2567`; as leituras foram exercitadas na
Instaltech, as escritas não.

| área | chamada | prova ao vivo |
|---|---|---|
| WhatsApp ligado? | `GET /whatsapp/location/<loc>/is-configured` | sim — devolve `whatsAppBusinessAccountId`, `isConfigured` |
| números | `GET /whatsapp/location/<loc>/phone-numbers` | sim — o `id` é o `fromNumberId` do envio; traz `quality`, `messagingLimitTier` |
| templates | `GET /whatsapp/location/<loc>/template[?templateId=]` | sim — lista com `components` (HEADER/BODY/FOOTER/BUTTONS), `category`, `language` |
| templates aprovados | `GET /whatsapp/workflow/options/template_id?locationId=` | sim — `{options:[{label,value}]}`, `value` é o templateId |
| flows | `GET /whatsapp/flows?locationId=` | sim — `[]` na Instaltech (não usa flows) |
| IA | `GET /ai/settings/<loc>` | sim — `{conversationsAISettings:{mode, channels, autoPilot*, typeSettings...}}` |
| SLA | `GET /sla-settings/<loc>` | sim — `{enabled, scope:"channel", channels:[{type, rt:{dueAt,overdueAt}}]}` |
| SLA agora | `GET /sla-settings/<loc>/inbox-sla-status` | sim |
| quem zera SLA | `GET /sla-settings/<loc>/manual-clear-permission` | sim — `manualClearPermission: "all"` |
| gravar IA / SLA | `PUT /ai/settings/<loc>`, `PUT /sla-settings/<loc>` | **não** — muda a subconta inteira |
| zerar SLA | `POST /sla-settings/clear-sla/<conv>` | **não** |
| group chat | `POST /group`, `POST /group/messages` | **não** — o corpo de `/group` nem aparece no chunk baixado |
| chat interno | `POST /internal`, `/internal/check`, `/internal/user` | **não** |

**Template e flow não têm rota própria de envio.** Ambos vão pelo `POST /conversations/messages`
de sempre, com `type: "WhatsApp"` e um bloco `whatsapp` extra:

```
template: whatsapp: {type:"template", template:{name, lang, category},
                     placeholders:{header:[], body:[], buttons:[]}, fromNumberId?, toNumber?}
flow:     whatsapp: {type:"interactive",
                     interactive:{type:"flow", flow:{id, header, body, footer, cta}}}
```
O `message` é o texto dos componentes concatenado, com `{{n}}` já trocado pelas
`customVariables` — o servidor não monta isso sozinho.

**Mensagem de group chat leva `subType: 3`**, acrescentado ao mesmo payload de envio.

**`startAfter` do chat interno** decide o histórico que o novo participante enxerga:
`"-1"` tudo, `"0"` nada, `YYYY-MM-DD` a partir da data.

### Fora de escopo, com motivo

Live-chat typing, review reply, spam check, views salvas da caixa de entrada, voice note e a
knowledge base da IA existem na API interna (mapeados no bundle) e não têm uso no
diagnóstico de automação.

## Oportunidades

Auth: os dois tokens, como todo `opportunities/*`. Host `services.leadconnectorhq.com`.
**Tudo abaixo foi exercitado ao vivo na Instaltech em 2026-09-19**, num pipeline
descartável criado e apagado na hora. Os 4 pipelines reais não foram tocados.

### Leitura
| O que | Rota | Ao vivo |
|---|---|---|
| Pipelines e estágios | `GET backend.leadconnectorhq.com/opportunities/pipelines?locationId=<loc>` | ✓ |
| Cards, com filtro | `GET services.../opportunities/search?location_id=&pipeline_id=&pipeline_stage_id=&status=&contact_id=&limit=` | ✓ |
| Busca por termo | mesma rota, com `q=<termo>` | ✓ |
| Paginação | mesma rota, com `page=<n>` a partir de 1 | ✓ |
| Um card | `GET services.../opportunities/<id>` | ✓ (404 `OPPORTUNITY_NOT_FOUND` se apagado) |

`pipelines/search` **não** é busca de pipeline por nome: ela exige `pipelineId` e
`pipelineStageId` e devolve os cards daquele estágio. Não há rota de buscar pipeline por
nome — a lista completa já vem em uma chamada e é curta.

**Os filtros da busca são snake_case.** `pipelineId` no query string devolve
422 `property pipelineId should not exist`. O corpo das respostas, ao contrário, é
camelCase. A busca devolve o contato inteiro embutido (`contact` e `relations`), com tags,
e as atribuições de campanha.

### Escrita de card
| O que | Rota | Corpo | Ao vivo |
|---|---|---|---|
| Criar | `POST services.../opportunities/` | `{locationId, pipelineId, name, status, contactId, pipelineStageId?, monetaryValue?, assignedTo?, ...}` | ✓ |
| Editar e mover de estágio | `PUT services.../opportunities/<id>` | mesmo corpo, nenhum campo obrigatório, **sem `contactId`** | ✓ |
| Apagar | `DELETE services.../opportunities/<id>` | — | ✓ |
| Restaurar | `PUT services.../opportunities/<id>/restore` | `{}` | ✓ |

`status` é **obrigatório na criação** (422 sem ele); a CLI manda `open` por padrão.
`assignedTo`, `forecastExpectedCloseDate` (AAAA-MM-DD), `forecastProbability` e
`customFields` (`[{id, fieldValue}]`) gravam e voltam na leitura — validados ao vivo. Mover
de estágio não tem rota própria: é o `PUT` da edição com `pipelineStageId` trocado. O
contato só se vincula na criação. Apagar devolve 404 na leitura seguinte, e `restaurar`
traz o card de volta.

### Escrita de pipeline
Não existe na API pública v3 (que só tem leitura). Rotas internas, confirmadas ao vivo:

| O que | Rota | Corpo | Ao vivo |
|---|---|---|---|
| Criar | `POST services.../opportunities/pipelines` | `{locationId, name, stages: [{name, position}]}` | ✓ |
| Editar nome e estágios | `PUT services.../opportunities/pipelines/<id>?locationId=<loc>` | `{name, stages: [{id?, name, position}]}` | ✓ |
| Apagar | `DELETE services.../opportunities/pipelines/<id>?locationId=<loc>` | — | ✓ |

Duas armadilhas confirmadas no 422:

`position` é obrigatório em cada estágio, na criação e na edição. A CLI preenche pelo
índice da lista quando falta.

No `PUT`, o `locationId` vai **na query, não no corpo** — no corpo devolve 422
`property locationId should not exist`. No `POST` é o contrário: vai no corpo.

**Editar estágios manda a lista inteira**, e estágio ausente dela é removido. Por isso a
CLI conta os cards de cada estágio que sumiria e recusa sem `--apagar-com-cards`. A guarda
foi exercitada ao vivo nos dois sentidos: com um card no estágio, a edição que o omitia foi
recusada antes de gravar; com `--apagar-com-cards`, passou.

**O card não some quando o estágio é removido** — o servidor o joga para um estágio que
sobrou. Confirmado ao vivo. O risco não é perda de dado, é o estágio de cada card mudar de
uma vez, acordando toda automação que reage a transição.

Apagar o pipeline leva os cards dentro junto, e **não tem restore** — o estado anterior
fica em `<dumps>/_oportunidades/`.

## Agenda — sondagem ao vivo 2026-09-19 (Instaltech `Xb9gDxwxYhdqtprGcb5E`)

Sondado com os tokens da sessão Chrome (Bearer + `token-id`, UA de browser), sem clicar na
interface. As rotas são as mesmas da referência pública; o que faltava era o parâmetro, não
a autenticação.

### Respostas às quatro perguntas da sondagem

1. **Host:** os dois servem agenda, com resposta idêntica byte a byte.
   `backend.leadconnectorhq.com` e `services.leadconnectorhq.com` foram exercitados lado a
   lado em `/calendars/`, `/calendars/events`, `/calendars/<id>/free-slots` e
   `/calendars/groups` — mesmos status e mesmos corpos. Usar `services` (é o host que a
   referência pública documenta). ✓
2. **Compromisso vs. bloqueio — resolvido com um bloqueio de verdade (2026-09-19):** o
   discriminante é o **`status`**: `"booked"` no compromisso, `"unavailable"` no bloqueio. A
   inferência antiga (`contactId` presente ou ausente) estava fraca e foi trocada por essa no
   `_tipo` da CLI. Mais: `/calendars/events` e `/calendars/blocked-slots` **não** são dois
   filtros da mesma lista — com um bloqueio criado no período, `/calendars/events` devolveu
   `{"events":[]}` (tanto por `userId` quanto por `calendarId`) e só `blocked-slots` o
   trouxe. Bloqueio não aparece na listagem de eventos. ✓
3. **`toNotify`, `ignoreFreeSlotValidation`, `ignoreDateRange`:** `toNotify: false`
   (`--silenciar`) e `ignoreFreeSlotValidation`/`ignoreDateRange` (`--forcar`) exercitados ao
   vivo em 2026-09-19 — ver as duas seções abaixo. ✓
4. **Datas — e esta é a armadilha da agenda:** `startTime`/`endTime` de `/calendars/events`
   e `startDate`/`endDate` de `free-slots` aceitam **só milissegundos desde 1970**.
   `free-slots` com texto ISO recusa explicitamente
   (`422 startDate must be a number conforming to the specified constraints`), mas
   `/calendars/events` com texto ISO responde **200 com `{"events":[]}`** — o mesmo recorte
   que em milissegundos devolve o compromisso. Data ISO na listagem some com a agenda sem
   nenhum erro. Já as datas **na resposta** vêm em texto ISO com fuso
   (`2026-09-04T15:00:00-03:00`). ✓

### Auth

Uma chamada válida de `/calendars/events` respondeu 200 **só com o Bearer**, sem `token-id`.
O cliente manda os dois de qualquer forma; nada a mudar. ✓

### Rotas confirmadas (host `services.leadconnectorhq.com`)

| Rota | Parâmetros | Status |
|---|---|---|
| `GET /calendars/?locationId=<loc>` | — | ✓ 200, `{calendars:[...]}` (já usado por `fetchCalendars`) |
| `GET /calendars/groups?locationId=<loc>` | — | ✓ 200, `{groups:[...]}` |
| `GET /calendars/<calendarId>` | — | ✓ 200, `{calendar:{...}}` (usada por `getCalendar`) |
| `GET /calendars/events` | `locationId` **e** um de `calendarId`/`userId`/`groupId`; `startTime`,`endTime` em ms | ✓ 200, `{events:[...]}` |
| `GET /calendars/blocked-slots` | idem | ✓ 200, `{events:[...]}` com os bloqueios (`status:"unavailable"`). É a **única** rota que os devolve — `/calendars/events` os omite. |
| `GET /calendars/<calendarId>/free-slots` | `startDate`,`endDate` em ms; `timezone` IANA opcional | ✓ 200, `{"<YYYY-MM-DD>":{slots:[ISO com fuso]}}` (teto de 31 dias entre `startDate`/`endDate` é guarda nossa em `freeSlots`, nunca observada como limite do servidor — não documentada na referência) |
| `GET /calendars/events/appointments/<eventId>` | — | ✓ 200, `{appointment:{...}}` |
| `GET /calendars/appointments/<appointmentId>/notes?limit&offset` | — | ✓ 200, `{notes:[],hasMore:false}` |

Erros que valem lembrar, todos observados:

- sem `calendarId`/`userId`/`groupId` → `422 Either of userId, calendarId or groupId is required`
- `location_id`/`start_time` (snake_case) → `400 Location ID is required`. O case é camelCase.
- `contactId` em `/calendars/events` → `422 property contactId should not exist`. **Não existe
  filtro por contato nessa rota** — para a agenda de um contato, filtrar no cliente.

### Forma do compromisso (campos observados)

```
id, title, calendarId, locationId, contactId, groupId, calendarProviderId,
status ("booked"), appointmentStatus ("showed"|"cancelled"|...), appoinmentStatus (typo do
servidor, espelha o anterior), assignedUserId, isFree, isRecurring, isFullDay, isCancelled,
deleted, type, google{...}, startTime/endTime (ISO com fuso), dateAdded, dateUpdated,
selectedTimezone, source, version, assignedResources, appointmentMeta{slotType,bookedDuration}
```

### Rotas de escrita — validadas ao vivo 2026-09-19

Exercitadas na Instaltech, num calendário descartável criado e apagado na hora
(`ZZ TESTE AUTOMASTER`, id `fuqBFE5vmoRDGK6u6Vpj`), com o contato de teste
`uWqujqll20tRuglV3mLt`. Nenhum calendário de produção foi tocado.

| Rota | Status | O que o servidor ensinou |
|---|---|---|
| `POST /calendars/events/appointments` | ✓ 200 | Corpo `{calendarId, locationId, contactId, startTime, endTime, title, appointmentStatus, toNotify}` com datas **ISO com fuso** (aqui, ao contrário da listagem, epoch não é necessário). **Com `rrule` o servidor exige `assignedUserId`**: 422 `A team member needs to be selected. assignedUserId is missing`. Virou guarda na CLI (`--repeticao` exige `--dono`) e na tool. |
| `PUT /calendars/events/appointments/<eventId>` | ✓ 200 | Serve para remarcar, mudar situação e cancelar (`appointmentStatus: cancelled` — `status` continua `booked` e `isCancelled` continua `false`; quem lê tem que olhar o `appointmentStatus`). Em série, o **id enviado é que decide o alvo** (ver abaixo). |
| `DELETE /calendars/events/<eventId>` | ✓ 200 `{succeeded:true}` | Usada só na limpeza, por script descartável — a CLI não expõe apagar por decisão de desenho (cancelar deixa rastro). Apagar o id-mestre apaga a série inteira. |
| `POST /calendars/appointments/<id>/notes` | ✓ 200 | Corpo `{body}`; a resposta é `{note:{...}}` e traz `relations:[{objectKey:"appointment", recordId:<eventId>}]` e `contactId` preenchidos pelo servidor. |
| `PUT /calendars/appointments/<id>/notes/<noteId>` | ✓ 200 | Corpo `{body}`; devolve a nota inteira já editada. |
| `DELETE /calendars/appointments/<id>/notes/<noteId>` | ✓ 200 `{success:true}` | Some do `GET .../notes` na hora. |
| `POST /calendars/events/block-slots` | ✓ 200 | Corpo `{locationId, startTime, endTime, title, assignedUserId}`, datas ISO com fuso. **`assignedUserId` é obrigatório na prática:** com `calendarId` de um calendário comum o servidor responde `400 The calendar is not an event calendar.` — bloqueio é da agenda de um usuário, não de um calendário de captação. Por isso `--acao bloquear` exige `--dono`. A resposta traz `status: "unavailable"`, sem `contactId` e sem `appointmentStatus`. |
| `PUT /calendars/events/block-slots/<eventId>` | ✓ 200 | Mesmo corpo; devolve o bloqueio já editado. `GET /calendars/events/appointments/<id>` **aceita o id de um bloqueio** e devolve `{appointment:{... status:"unavailable"}}` — é o que o rastro usa como `antes`. |
| `POST /calendars/` e `DELETE /calendars/<id>` | ✓ 200 | Fora da superfície do projeto, exercitadas para criar e apagar o calendário do teste. POST mínimo: `{locationId, name, calendarType:"personal", slotDuration, slotDurationUnit, teamMembers:[{userId, priority, isPrimary}]}`. DELETE devolve `{message:"calendar deleted"}`. |

### Série recorrente — o id é o alvo (observado ao vivo)

`rrule` vira `RRULE:FREQ=...` na resposta. A série tem um **id-mestre**; cada ocorrência
aparece no `GET /calendars/events` com id composto `<mestre>_<epochMs>_<duracaoSeg>` e
`masterEventId` apontando para o mestre. O `GET /calendars/events/appointments/<id>` aceita
os dois ids e devolve `isRecurring: true` em ambos.

- PUT no **id-mestre** (`--alvo serie`) move as três ocorrências de uma vez.
- PUT no **id composto** (`--alvo instancia`) **destaca** aquela ocorrência: o servidor
  responde com um **id novo, avulso** (`isRecurring:false`, sem `masterEventId`) e a série
  perde aquele dia. Não é edição no lugar — é uma exceção materializada como compromisso
  independente.

**Bug achado e corrigido pela validação:** a checagem de série na CLI lia o envelope errado
(`{event:...}`); a rota devolve `{appointment:...}`. Com isso a guarda de `--alvo` nunca
disparava e um `remarcar` sem alvo destacou uma ocorrência sem avisar. Corrigido em
`extractor/src/cli.ts`; com a correção, `remarcar` sem `--alvo` recusa, `--alvo instancia`
mexe em uma só e `--alvo serie` nas três — os três casos exercitados ao vivo.

⚠️ **Essa guarda e esse desembrulho não têm teste que rode em CI.** O extractor não tem
runner de teste; a única prova dos dois é a validação manual registrada acima e em
`.superpowers/sdd/2026-09-19-agenda-mcp/task-6-report.md`. Por isso o campo `appointment` do
envelope merece cuidado em qualquer mudança futura: se a rota trocar de chave, ou se alguém
mexer no desembrulho, a guarda de `--alvo` volta a nunca disparar e um `remarcar` sem alvo
destaca uma ocorrência em silêncio — exatamente o bug acima, e nada quebra para avisar.

### `--forcar` (`ignoreFreeSlotValidation` + `ignoreDateRange`) — validado ao vivo 2026-09-19 ✓

Num calendário descartável, com um bloqueio criado às 09:00–10:00 do dia alvo (o bloqueio
**some os horários da resposta de `free-slots`** — 09:00 e 09:30 deixaram de ser listados):

- marcar às 09:00 **sem** `--forcar` → `400 The slot you have selected is no longer available.`
- marcar às 09:00 **com** `--forcar` → **422** `A team member needs to be selected.
  assignedUserId is missing`. Mesmo 422 da série: sem a checagem de horário livre o servidor
  não escolhe o responsável sozinho. Virou guarda — `--forcar` em `marcar` exige `--dono`.
- marcar às 09:00 com `--forcar` **e** `--dono` → **200**, compromisso criado em cima do
  bloqueio (`status: "booked"`).

### `--silenciar` (`toNotify: false`) — lado seguro provado ao vivo 2026-09-19 ✓/✗

Calendário descartável criado **com** notificação ao contato ligada
(`notifications: [{type:"email", shouldSendToContact:true, templateId:"default"}]`, confirmado
na resposta do POST). Com esse calendário, um compromisso marcado **com `--silenciar`**
(`toNotify: false`) para o contato de teste: a conversa do contato continuou com as mesmas 5
mensagens, a última de 14:14Z, seis horas antes da escrita (20:25Z). A leitura é boa prova
porque e-mail de confirmação de calendário **aparece** nessa conversa — as duas mensagens
`EMAIL` "REUNIÃO CONFIRMADA!" de 2026-08-24 do mesmo contato são exatamente isso.

**Provado:** com `--silenciar`, num calendário com notificação ligada, nada saiu para o
contato. **Continua sem prova ✗:** o caso **não** silenciado. Confirmar exigiria mandar
e-mail de verdade para uma pessoa real, e essa autorização não foi dada — decisão de
segurança, não lacuna de mapeamento.

Registro histórico: a rodada anterior (calendário descartável com `notifications: []`) não
provava nada, porque não havia mensagem a impedir. Foi essa lacuna que a rodada acima fechou.

### Resíduo

Nenhum. O calendário de teste (`sxT3Q04MFNLfdqvFgw6u`, `ZZ TESTE AUTOMASTER lacunas`), o
bloqueio (`SwNMriJoH6FtUkOEGg1H`) e o compromisso forçado (`I5ON7znc4qgmYlFq3VpX`) foram
apagados; a releitura do período devolveu `{"events":[]}` em `eventos` e em `bloqueios`, e a
subconta voltou aos 7 calendários de produção.

### Rastro de escrita

Cada escrita gravou `<dumps>/_agenda/<loc>/<chave>/<ts>.json` com `antes`, `corpo` e
`aplicado`. O 422 da série foi gravado com `aplicado: false` e o `erro` do servidor, como
projetado.

## Templates de mensagem — sondagem ao vivo 2026-09-19 (Instaltech `Xb9gDxwxYhdqtprGcb5E`)

O que destravou a regra `broken_template_ref`. As duas listas abaixo entram no dump
(`message_templates.json`, `whatsapp_templates.json`); as de e-mail não entram, e a razão
está no fim desta seção.

| Lista | Rota | Resposta |
|---|---|---|
| mensagem (SMS e cia.) | `GET backend/locations/<loc>/templates?limit=10000` | `{templates:[{id,name,template,type,urlAttachments}], totalCount}` |
| e-mail (builder) | `GET backend/emails/builder?locationId=&limit=&offset=&parentId=` | `{builders:[{id,name,templateType,parentId,...}], total:[{total:N}]}` |
| WhatsApp | `GET services/phone-system/whatsapp/location/<loc>/template` | lista crua da Meta, com `id`, `name`, `status`, `components` |

- `locations/<loc>/templates` **não tem `offset`** (`422 property offset should not exist`);
  o `limit` default é 25 e aceita valor bem acima do total. Sem `type` devolve todos os
  canais numa lista só, e `type` é enum fechado (`instagram` dá `422 type must be a valid
  enum value`). O template citado por um step `instagram-dm` sai daí com `type: "sms"`.
- `emails/builder` lista **uma pasta por vez**: item com `templateType: "folder"` esconde os
  seus, e só aparecem passando `parentId=<id da pasta>`. Na Instaltech a raiz tem 8 itens,
  6 deles pastas; a varredura completa dá 43.
- WhatsApp: a lista vem inteira numa chamada (81 na Instaltech; `limit`/`skip` não mudam
  nada). `?templateId=<id>` devolve `[]` para template que não existe mais.
- **`template_id: "0"` não é referência quebrada:** é o próprio app dizendo "sem template".
  `GET services/phone-system/whatsapp/workflow/options/template_id?locationId=` devolve a
  opção `{label: "None - Free form message", value: "0"}`, e nesses steps o texto vive em
  `attributes.message`. Sem essa exceção, a regra acusava 90 falsos positivos só na
  Instaltech.
- **E-mail ficou de fora da auditoria, de propósito.** Nenhum dos 13 `email.template_id` da
  Instaltech casa com id do email builder — nem com a varredura de pastas completa, nem com
  `deleted=true`, e as rotas de item único (`/emails/builder/<id>`, `?templateId=`) não
  resolvem o id. Os ids citados compartilham prefixo de ObjectId (mesmo segundo de
  criação), o que aponta para cópia guardada dentro do step. Cruzar as duas coleções daria
  13 de 13 falsos positivos.
- `internal_notification.template_id` (citado na doc antiga como o alvo desta regra) **não
  aparece em nenhum dos 12 dumps**. Os campos de template que existem de verdade são
  `whatsapp_v2.template_id` (789 usos), `sms.template_id` (131), `email.template_id` (67),
  `instagram-dm.template_id`, `ig_interactive_messenger.templateId` e
  `proposals_estimates_send_document.templateId` (esse último sem lista para cruzar).

## Formulários e surveys

Host `https://services.leadconnectorhq.com`, os dois tokens da sessão (como o resto do
extractor). As mesmas rotas existem na API pública v3, mas devolvendo só id e nome.
Módulo: `extractor/src/api/forms.ts`; CLI `npm run formularios`; tool MCP `formularios`.

Migrado de `backend.` para `services.` em 2026-09-19 (Tarefa 1 da escrita de
formulários/surveys): as seis rotas de leitura (lista de formulário, lista de
survey, um formulário, um survey, submissões de formulário, submissões de
survey) foram comparadas ao vivo nos dois hosts na Instaltech
(`Xb9gDxwxYhdqtprGcb5E`) e devolveram o mesmo conteúdo, byte a byte (só o
`traceId` de cada request muda).

| operação | rota |
| --- | --- |
| lista de formulários | `GET /forms/?locationId=<loc>&limit=50&skip=<n>` |
| lista de surveys | `GET /surveys/?locationId=<loc>&limit=50&skip=<n>` |
| um formulário | `GET /forms/<id>` (locationId dispensável) |
| um survey | `GET /surveys/<id>?locationId=<loc>` |
| submissões de formulário | `GET /forms/submissions?locationId=<loc>&...` |
| submissões de survey | `GET /surveys/submissions?locationId=<loc>&...` |

Paginação das listas: `limit` no máximo 50 — acima disso o servidor devolve
`422 limit must not be greater than 50`. A varredura soma `skip` até juntar `total`.

Paginação das submissões: `page` a partir de 1, `limit` até 100, e a resposta traz
`meta.total`, `meta.currentPage`, `meta.nextPage`, `meta.prevPage`. Filtros aceitos:
`formId`/`surveyId`, `q` (contactId, nome, e-mail ou telefone), `startAt` e `endAt` em
`YYYY-MM-DD`. Sem filtro de data, o servidor responde o mês corrente.

`type=folder` devolve as pastas na rota de surveys (a Instaltech tem 6) e é **ignorado**
na de formulários, que não organiza em pasta. Pasta nunca aparece na lista normal, então
a extração do dump não a grava.

O detalhe traz os campos em `form.formData`; no survey o CSS fica em
`formData.fieldCSS`. `deleted` não é parâmetro dessas rotas (422). Id inexistente devolve
`404 Form not found!` em `/forms/<id>` e `400 Survey does not exist` em `/surveys/<id>`.

O id `fb-<locationId>` que aparece nas submissões é o pseudo-formulário de lead gen do
Facebook: ele nunca está na lista de formulários e **não** é referência quebrada. As
regras `broken_form_ref` e `unused_form` o ignoram explicitamente.

Não há busca por nome no servidor: `-o buscar` do CLI varre a lista inteira, que é curta.

### Lógica condicional entre slides (`form.conditionalLogic`) — medida, não exercitada por escrita ao vivo

Formato medido nos 29 documentos de survey da Instaltech (baixados direto das URLs
públicas de `versionHistory[].surveyDataDownloadUrl`, sem precisar da interface do GHL).
A validação ao vivo do POST/PUT com esse campo fica para a Tarefa 9.

Caminho: **`form.conditionalLogic`**, uma lista, do **documento inteiro** — não por
slide. Cada entrada:

```json
{
  "conditionalOperation": "then",
  "conditions": [
    { "selectedField": "<fieldKey do campo>", "selectedOperation": "isEqualTo", "inputValue": "<valor>" }
  ],
  "outcome": { "jumpTarget": "<id do slide>", "jumpTargetType": "slide", "type": "jumpTo", "value": "" }
}
```

- `conditionalOperation`: `"then"` (20/29 docs), `"and"` (16), `"or"` (10), `null` (23,
  entrada vazia que o builder cria — `conditions`/`outcome` também `null` nesse caso).
- `selectedOperation`: só `isEqualTo` apareceu (72 ocorrências), mas o builder oferece
  outros — não é enum fechado, e a operação `definir-logica` do motor não valida esse campo.
- `selectedField` é o `fieldKey`/`tag` do campo, não o `id`.
- `outcome.jumpTarget` é o `id` de um slide; `jumpTargetType` sempre `"slide"`.
- `surveyLogicLinkById: true` é um booleano no topo do documento (29/29) que diz que
  `jumpTarget` guarda id de slide, não número — não faz parte da regra em si.
- `form.conditionalLogic` também existe em documento de **formulário** (não só survey),
  conferido ao vivo num formulário real da Instaltech.

Operação do motor (`extractor/src/forms/doc.ts`): `{ op: "definir-logica", regras }`
grava `regras` em `form.conditionalLogic`. Em survey, valida que todo `outcome.jumpTarget`
citado é id de slide existente — erro em português caso contrário. Em formulário não há
slides para validar contra, então grava sem checagem.


### Escrita — validada ao vivo na Instaltech (Tarefa 9, 5 rodadas, 2026-09-19)

Host `https://services.leadconnectorhq.com`, mesmos dois tokens de sessão da leitura.
Widget público (onde a página do formulário/survey é renderizada e enviada):
`https://link.msgsndr.com/widget/<form|survey>/<id>?notrack=true[&versionId=<v>&nocache=true]`.

| operação | método + rota | corpo | exercitada ao vivo |
| --- | --- | --- | --- |
| criar | `POST /forms/` (com `productType`) ou `POST /surveys/` (sem `productType`, ver achado abaixo) | `{locationId[, productType], source:"landing_page"[, parentId]}` | sim, formulário e survey |
| publicar/editar | `POST /forms/<id>` ou `POST /surveys/<id>` | `{name, formData}` — documento inteiro, sempre POST, nunca PUT | sim, formulário e survey |
| apagar | `DELETE /forms/<id>` ou `DELETE /surveys/<id>` | — | sim, formulário e survey |
| duplicar | `POST /forms/duplicate/<id>` ou `POST /surveys/duplicate/<id>` | `{name[, folderId]}` | sim, formulário — survey: a rota foi chamada e devolveu `200`, mas nada ficou gravado, ver achado abaixo |
| restaurar versão | igual a publicar, com `formData` baixado de `versionHistory[].formDataDownloadUrl` | `{name, formData}` | sim, formulário e survey (rodada 5) |
| paleta padrão da subconta | `GET /forms/default-colors?locationId=<loc>` / `POST /forms/default-colors` | `{locationId, colors:[{name,value}]}` | sim — é da subconta, não por tipo |
| temas prontos | `GET /forms/themes?locationId=<loc>` / `GET /surveys/themes?locationId=<loc>` | — | sim, formulário e survey (21 temas cada) |

**A frase "todas as operações foram exercitadas ao vivo" era generalização falsa e saiu do
documento** (achado da revisão da rodada 4): nem toda operação tem prévia por construção,
e a tabela acima marca linha a linha o que tem prova e o que não tem. Das operações que
passam por `runFormularioAcao --acao editar --ops` (`adicionar-campo`, `remover-campo`,
`renomear-campo`, `reordenar-campos`, `criar-slide`, `remover-slide`, `renomear-slide`,
`reordenar-slides`, `mover-campo`, `definir-logica`) e por `formulario-estilo --acao
aplicar`, a prévia (`--ops`/`--tokens` sem `--confirmo`) bateu, sempre, exatamente com o
que o servidor gravou depois do `--confirmo` — essa comparação prévia-vs-servidor é o que
está provado, operação por operação, nas tabelas abaixo. `criar`, `apagar`, `duplicar`,
`restaurar` (marcado abaixo como write-only) e `temas`/`paleta-ver` (leitura) **não têm
prévia por construção** — são ações diretas, sem documento "antes" e "depois" para
comparar — e a prova delas é só a conferência direta no servidor depois do `--confirmo`.

**Corrigido — `criar()` mandava `productType` também para survey (2ª rodada de prova,
2026-09-19).** `POST /surveys/` devolvia `422` com o corpo literal
`{"status":422,"options":{},"message":["property productType should not exist"],"name":"UnprocessableEntityException","error":"Unprocessable Entity","statusCode":422}`
quando o corpo levava `productType` — campo que `criar()` em
`extractor/src/api/forms-write.ts` mandava sempre, também para survey, copiando o padrão
de `/forms/`. O servidor não pediu nenhum campo substituto no 422 — só rejeitou a chave. A
rota de survey não aceita `productType`: o tipo já é implícito no segmento `/surveys/` da
URL. Corrigido: `criar()` só inclui `productType` no corpo quando `tipo !== "survey"`.
Depois da correção, `POST /surveys/` com `{locationId, source:"landing_page"}` (sem
`productType`) devolveu `200` e criou o survey normalmente.

**Corrigido — a prévia era cega para operação de slide (3ª rodada, 2026-09-19).** Até a 2ª
rodada, a prévia (`--ops` sem `--confirmo`) devolvia `{"aplicado":false,"previa":[]}` —
vazia — para toda operação de slide (`criar-slide`/`renomear-slide`/`reordenar-slides`/
`remover-slide`); `diferenca()` (`extractor/src/forms/diff.ts`) tinha `slides` na lista de
caminhos ignorados do achatamento genérico e não tinha nenhuma lógica dedicada para
slide, ao contrário de campo (que já tinha entra/sai/rótulo/ordem). Isso é pior do que
não ter prévia: o operador via "nada mudaria" e, ao confirmar, o survey mudava de
verdade. Corrigido: `diferenca()` agora compara a lista de `id`s de slide (entra/sai/
ordem) e o mapa `id → slideName` (renomeado), no mesmo estilo das linhas de campo —
`+ slide <id>`, `- slide <id>`, `~ nome do slide <id>: <antes> → <depois>`,
`~ ordem dos slides: <ids antes> → <ids depois>`. O conteúdo interno de `slideData`
continua fora do achatamento genérico (seria duplicar a listagem de tags de campo, que já
cobre os slides via o prefixo `<slideId>/<tag>` — inclusive `mover-campo` entre slides
aparece assim: `+ campo <slideDestino>/<tag>` e `- campo <slideOrigem>/<tag>`), e as
demais propriedades de estilo de cada slide (`button`, `border`, `active`, ...) continuam
ignoradas por não fazerem parte do conteúdo que uma operação de slide muda. 5 testes novos
em `extractor/test/style.test.ts`: um por operação de slide, um para `definir-logica`,
mais um confirmando que dois surveys idênticos continuam dando prévia vazia (sem falso
positivo).

#### Lado formulário — prova serial completa (rodada 4, 2026-09-19)

**As rodadas 1-3 provaram o lado formulário numa passagem contaminada por concorrência: o
`DELETE` do formulário original (`g7xmOrgWXe8TEMaL5ewr`) aconteceu sem que ninguém o
tivesse pedido, porque dois agentes escreviam no mesmo documento ao mesmo tempo (ver
achado do perfil único de Chrome abaixo). Nesse cenário nada distingue a gravação de um
comando conferido da gravação do outro agente — "o servidor gravou o que a prévia
anunciou" não era leitura confiável. A prova do lado formulário foi refeita do zero, em
série, sem nenhum subagente, num formulário descartável novo:**

Formulário `ZZ TESTE AUTOMASTER`, id `ietufnnUaIn4rdWQjs5w`. Sequência completa, cada
operação com prévia conferida antes do `--confirmo` (quando a operação tem prévia) e
leitura do servidor (`formularios -o detalhe`) depois:

| operação | prévia anunciou | servidor gravou | bateu? |
| --- | --- | --- | --- |
| `criar` (sem prévia) | — | criado de primeira, sem lag de propagação nesta rodada | sim |
| `adicionar-campo` ×3 (full_name, email, button) | `+ campo full_name`, `+ campo email`, `+ campo button` | `[full_name, email, button]` | sim |
| `renomear-campo` (email → "Seu melhor e-mail") | `~ rótulo de email: E-mail → Seu melhor e-mail` | rótulo atualizado | sim |
| `reordenar-campos` ([email, full_name]) | `~ ordem: full_name, email, button → email, full_name, button` | `[email, full_name, button]` | sim |
| `remover-campo` (email) | `- campo email` | `[full_name, button]` | sim |
| `adicionar-campo` custom field real (`consentimento`, id `N6cznmfKOH6YjVyyCSKg`) | `+ campo N6cznmfKOH6YjVyyCSKg` | campo completo gravado, tag = id | sim |
| `aplicar` estilo (tokens Carbon) | 17 linhas (`fieldStyle.*`, `style.*`, `submitMessageStyle.fontColor`, `customStyle`) | idêntico, campo a campo | sim |
| `previa-visual` (sem prévia, é a própria foto) | — | screenshot mostrou o formulário com o custom field renderizado e as cores dos tokens | sim |
| `versoes` (sem prévia, é leitura) | — | 7 versões listadas | sim |
| `previa-visual --versao <antiga>` (sem prévia) | — | screenshot da versão renderizou | sim |
| `restaurar --versao <antiga>` (write-only, sem prévia — guarda de `--confirmo` é erro seco) | — | campos voltaram para `[full_name, email, button]`, o estado daquela versão | sim |
| `duplicar` (sem prévia) | — | cópia criada com o estado atual (pós-restauração) | sim |
| `apagar` da cópia (sem prévia) | — | `deleted:true`, cópia removida | sim |
| `apagar` do formulário original (sem prévia) | — | `deleted:true`, formulário removido — **esta é a exclusão intencional do formulário desta rodada**, diferente do episódio da 1ª rodada (ver abaixo) | sim |

Todas as gravações desta rodada foram feitas por este agente, sozinho, um comando por
vez, sem nenhuma invocação concorrente — a leitura "prévia bateu com o servidor" nesta
tabela é confiável porque não houve segundo escritor no meio.

**O que aconteceu com o formulário da 1ª rodada (`g7xmOrgWXe8TEMaL5ewr`), registrado como
episódio, não como prova**: ele foi criado, editado, estilizado e teve uma submissão
pública real recebida durante a 1ª rodada desta tarefa — mas, no meio da passagem, dois
agentes (a sessão principal e um subagente despachado para a automação de browser da
submissão) escreveram nele ao mesmo tempo. Uma cópia extra apareceu sem que `duplicar`
tivesse sido chamado duas vezes, e o formulário original foi apagado do servidor num
ponto em que a sessão principal não tinha pedido esse `apagar`. Como consequência, as
operações de campo/estilo/versão/restauração/duplicação feitas *nele* não servem como
prova de confiabilidade — só a submissão pública em si (que não pode ser refeita sem criar
outro contato real no CRM do cliente) continua valendo, isolada, na seção abaixo.

**Custom field num formulário usa o `id` do custom field como `tag`.** Testado ao vivo com
o campo `consentimento` (`TEXT`, `contact.consentimento`, id `N6cznmfKOH6YjVyyCSKg`) da
Instaltech: `{"op":"adicionar-campo","campo":{"tag":"<id>","fieldKey":"contact.consentimento",
"dataType":"TEXT","model":"contact","name":"consentimento","id":"<id>","type":"text","label":"..."}}`.
Renderizou na página pública, aceitou valor e a submissão de teste (na passagem
contaminada da 1ª rodada) guardou o valor sob a chave `N6cznmfKOH6YjVyyCSKg` (não sob
`fieldKey`).

**Criação tem lag de propagação — corrigido com retry (2ª rodada, 2026-09-19).** A
primeira `criar` de um formulário, na 1ª rodada desta tarefa, retornou `POST /forms/` OK,
mas o `GET /forms/<id>` imediatamente seguinte (dentro da própria etapa de publicar)
devolveu `400 Form does not exist`, deixando um formulário órfão (sem nome, sem campos)
que precisou de `apagar` manual. O servidor aceita o `POST` antes de o objeto ficar
visível para `GET` — janela de eventual consistency, não determinística. Corrigido em
`runFormularioAcao` (`extractor/src/cli.ts`): o `carregarDoc` logo depois do `criar` agora
tenta até 3 vezes, com 1,5s de atraso entre tentativas, antes de desistir. O rastro grava
`criadoId` **antes** da primeira tentativa (já fazia isso), então mesmo esgotando as
tentativas o id órfão fica registrado no arquivo de rastro; a mensagem de erro final
nomeia o id, diz que ele existe no servidor sem nome nem campos, e dá o comando exato
(`formulario-acao --acao apagar -i <id> --confirmo`) para removê-lo — e essa frase só
aparece quando a falha foi de fato no laço de retry, não quando `aplicar()`/`publicar()`
falha depois dele (a mensagem não pode contar 3 tentativas para um erro que tentou uma
vez). Na 4ª rodada, o `criar` do formulário serial funcionou de primeira, sem acionar o
retry.

#### Lado survey — prova serial (rodadas 2 e 3)

Survey descartável `ZZ TESTE AUTOMASTER SURVEY`, num id novo a cada rodada, sempre criado
e apagado em série, sem subagente. `criar-slide` ×3, `renomear-slide`, `reordenar-slides`,
`adicionar-campo` com `slide`, `mover-campo` entre slides, `remover-slide` e
`definir-logica`, todos confirmados por leitura direta do servidor (`-o detalhe --tipo
survey`) depois do `--confirmo` — os valores gravados bateram exatamente com o que cada
operação pedia (nomes, ordem dos slides, `id` do campo no slide de destino, e a regra de
`conditionalLogic` no formato documentado na seção acima, com `jumpTarget` apontando para
um `id` de slide real). Refeito depois do conserto da prévia de slide (rodada 3): as
quatro operações (`criar-slide`, `remover-slide`, `renomear-slide`, `reordenar-slides`)
tiveram a prévia conferida **antes** de cada `--confirmo`, e em todas as quatro a linha que
a prévia anunciou bateu, campo a campo, com o que o servidor gravou: `+ slide <id>` → o
slide novo apareceu com aquele id; `- slide <id>` → o slide saiu da lista; `~ nome do
slide <id>: <antes> → <depois>` → o `slideName` mudou exatamente assim; `~ ordem dos
slides: <antes> → <depois>` → a nova ordem bateu com a lista do lado direito da seta.
`previa-visual` no survey mostrou o campo do slide ativo renderizado com a barra de
progresso e o botão "Submit" — navegar entre telas via clique não foi exercitado (a
ferramenta só fotografa o estado atual, não simula clique de avançar).

**`restaurar` versão exercitado ao vivo em survey (rodada 5, 2026-09-19).** Survey
descartável `ZZ TESTE AUTOMASTER SURVEY` (id `FuKXZth8OYvPJuzwr7u9`): `criar-slide`
("Segunda tela") e depois `renomear-slide` (para "Segunda tela renomeada") geraram duas
versões distintas em `versionHistory`. `--acao restaurar --tipo survey --versao <a versão
gravada logo depois do criar-slide, antes do renomear-slide>` devolveu `aplicado:true`, e
o `-o detalhe --tipo survey` seguinte mostrou o slide de volta ao nome "Segunda tela" —
exatamente o estado da versão restaurada, não o nome renomeado. Mesma rota de `publicar`
usada no formulário (`POST /surveys/<id>` com o `formData` baixado da URL da versão), sem
diferença de comportamento entre os dois tipos. Nota à margem: o `--acao apagar` seguinte
devolveu `404 Survey does not exist or is deleted` já na primeira tentativa, e um `GET`
imediato depois confirmou o mesmo — apesar do `-o detalhe` ter lido esse mesmo survey com
sucesso poucos segundos antes (mostrando o estado restaurado). O survey não aparece mais em
`-o lista --tipo survey` (total voltou a 29), então não há resíduo, mas o motivo exato de
ter desaparecido entre a leitura e o `apagar` — sem um `DELETE` bem-sucedido no meio — não
foi identificado. Essa anomalia e a de `duplicar` abaixo (`200` sem gravar nada) têm o
mesmo formato — um survey que uma leitura recente confirmou e que some antes da escrita
seguinte alcançá-lo — e podem compartilhar causa no lado do servidor. Ninguém investigou
se é a mesma causa; fica registrado como suspeita, não como conclusão.

**Achado — `duplicar` de survey pode devolver `200` com documento completo sem gravar
nada (investigado a fundo na rodada 5, 2026-09-19; conclusão: é o servidor, não lag).**
`POST /surveys/duplicate/<id>` devolveu `200` com um documento completo e coerente para o
id `u0WIsApG4MDPfCDqcFRf` (`_id` novo, distinto do original; `name: "ZZ TESTE AUTOMASTER
SURVEY COPIA"`, exatamente o pedido, não o nome do original; `locationId` correto;
`deleted:false`; `source:"duplicate"`; `dateAdded`/`dateUpdated` frescos, do momento da
chamada) — não é eco estático do documento original, é uma resposta específica daquela
chamada. Mesmo assim, `GET /surveys/<id>` devolveu `404 Survey not Found!` na hora, de
novo depois de ~8s, e **de novo minutos depois, numa sessão de investigação própria**; o
`DELETE` nesse id devolveu `404 Survey does not exist or is deleted`; `-o lista --tipo
survey` nunca mostrou esse nome, e o `total` da lista bateu exatamente com a contagem de
produção de antes de qualquer escrita desta tarefa (29), nas três vezes em que foi
conferido. **Conclusão: o servidor aceita o `POST` de duplicar survey, monta e devolve um
documento coerente com `200`, mas não grava o registro em lugar nenhum que `GET` ou a
listagem alcancem — não é lag de propagação (que se resolve em segundos, como no `criar()`
de formulário) e não sobrou survey invisível na subconta.** A base para essa conclusão:
o id devolvido nunca apareceu em nenhuma leitura, em três checagens espaçadas no tempo, e
a contagem da lista nunca subiu de 29. Ainda assim, como a única fonte é a API pública —
sem acesso direto ao banco do servidor — **fica registrado aqui, para quem quiser conferir
pela interface do GHL: o id em questão é `u0WIsApG4MDPfCDqcFRf`, na Instaltech
(`Xb9gDxwxYhdqtprGcb5E`)**. Sem resíduo a limpar por este agente (nada para apagar num id
que nenhuma leitura confirma existir), mas é um achado real de API, e a recomendação vale
para qualquer escrita de survey, não só `duplicate`: **depois de qualquer escrita de
survey, confirme com um `GET` antes de assumir que o objeto está lá** — a mesma
desconfiança que cobre `duplicar` cobre o desaparecimento pré-`apagar` acima. O
`criar()`/`duplicar()` de formulário não mostraram esse comportamento nas rodadas em que
foram testados.

**`temas` — exercitado ao vivo para os dois tipos (rodada 4).** `GET /forms/themes` e
`GET /surveys/themes` devolveram, cada um, 21 temas prontos (`Default Theme`, `Dark
Theme`, `Neon Theme`, ...), cada tema com seu próprio `formId`/`surveyId` de onde vem o
preview. Rota de leitura, sem `--confirmo`.

#### Submissão pública, resposta histórica, `cssLivre`, perguntas abertas

**Envio público de submissão — exercitado ao vivo na passagem contaminada da 1ª rodada
(Playwright, widget público); não refeito nas rodadas seguintes de propósito, para não
criar outro contato real no CRM do cliente.** O portão do passo 1 (ver Regra 2 do brief)
confirmou que os 6 triggers de "formulário/survey enviado" na Instaltech são todos
filtrados por `form.id`/`survey.id` explícito — nenhum dispara para um formulário não
citado — então a submissão de teste no formulário descartável era segura. Preencheu
`full_name` e o custom field `consentimento`, clicou Enviar; a submissão apareceu em `GET
/forms/submissions?formId=<id>&limit=<n≤100>`, com o valor do custom field sob a chave do
id (`N6cznmfKOH6YjVyyCSKg`). **`-o submissoes` sem `--formulario` e sem `--limite` (ou com
`--limite` fora de 1..100) devolve `422 limit must not be greater than 100 / limit must be
a number` mesmo sem nenhum parâmetro inválido explícito** — o filtro por formulário é
obrigatório na prática, mesmo não sendo formalmente exigido pelo `-o inválido`; passar
`--formulario <id> --limite <n≤100>` resolve. Efeito colateral fora do escopo desta tarefa:
o envio real criou um contato novo de verdade na Instaltech (`ZlkU3kiMDr0xiIGLiMC5`, nome
"ZZ TESTE AUTOMASTER", `internalSource.type: "form_builder"`, `medium: "form"`,
`mediumId: g7xmOrgWXe8TEMaL5ewr` — o formulário da 1ª rodada, já apagado no episódio
descrito acima). Desfazer contato está fora de escopo do projeto (ver CLAUDE.md, seção
"Fora de escopo"), então ele não foi removido — mas, na 2ª rodada, recebeu a tag
`teste-automaster` (a mesma já usada em testes anteriores na Instaltech) via `npm run
contato-editar -- -l Xb9gDxwxYhdqtprGcb5E -i ZlkU3kiMDr0xiIGLiMC5 --tag +teste-automaster
--json`, para não ficar anônimo no CRM do cliente. Esse contato é o único residual fora do
escopo de formulário/survey desta tarefa, e continua nomeado aqui para quem for achá-lo
depois. **Nenhum workflow disparou com essa submissão**: o portão do passo 1 já tinha
mapeado os 6 triggers de "formulário/survey enviado" da subconta, todos filtrados por
`form.id`/`survey.id` explícito, e nenhum desses filtros cita `g7xmOrgWXe8TEMaL5ewr` (o
formulário de teste) — então nenhum dos 6 workflows entra em condição de disparar por essa
submissão.

**Resposta histórica sobrevive à remoção do campo — confirmado ao vivo na mesma passagem
contaminada, não refeito pelo mesmo motivo (evitar outro contato real).** Depois de
remover o campo `N6cznmfKOH6YjVyyCSKg` do formulário (`remover-campo`) e reconferir
`-o submissoes`, o valor respondido continuou visível na submissão antiga, sob a mesma
chave. O documento do formulário e as submissões já enviadas são independentes.

**`cssLivre` grande — sem limite encontrado até 102 KB.** Um `customStyle` de 91.026
bytes (na passagem contaminada) e, numa rodada serial separada, outro de 102.000 bytes
foram aceitos pelo `POST /forms/<id>` e voltaram intactos, byte a byte, na leitura
seguinte. Não foi testado acima de 102 KB; se existe um limite, é maior que isso.

**Pergunta 7.1 (builder do GHL preserva `customStyle`/`fieldStyle` ao salvar pela
interface) continua sem resposta.** Exige abrir o formulário no builder pela interface,
mexer e salvar manualmente — passo que pede um humano (ver Regra 3 do brief) e não foi
feito. Quem for confirmar isso precisa: aplicar um estilo customizado por
`formulario-estilo --acao aplicar`, abrir o formulário no builder do GHL na UI, salvar
sem tocar no estilo, e depois baixar o documento de novo (`-o detalhe`) para comparar
`customStyle`/`fieldStyle` antes/depois.

#### Paleta padrão da subconta e perfil único de Chrome

**Paleta padrão da subconta — mescla provada ao vivo (pendência da Tarefa 5).** Antes de
qualquer escrita desta tarefa, `paleta-ver` já trazia **10** entradas, salvas em
`/Users/luccassilveira/.claude/jobs/9ca1d468/tmp/paleta-antes.json`: 5 alheias da
Instaltech (`Secondary`, `White`, `Black`, `#00000024`, `#212121ff`) e **5 com os nomes de
papel do motor** (`Primary #0f62feFF`, `Text #161616FF`, `Background #ffffffFF`,
`Border #8d8d8dFF`, `Error #da1e28FF`) — resíduo de uma validação ao vivo anterior a esta
tarefa (Tarefa 5/8, não desta rodada; ver comentário datado em
`extractor/src/forms/style.ts`). Gravar os tokens de teste desta tarefa usando **os
mesmos 5 valores de papel que já estavam lá** e reler a paleta depois: as 10 entradas
saíram idênticas, byte a byte, às 10 de antes — nenhuma cor, alheia ou de papel,
apareceu, desapareceu ou mudou de valor. Isto prova que a operação de gravar do motor
(`mesclarPaleta`, client-side, em `extractor/src/forms/style.ts`) preserva as cores
alheias; não isola se `POST /forms/default-colors` faria merge por si mesmo com uma
lista parcial, porque o motor nunca manda uma lista parcial. As 5 entradas de papel **não
são resíduo desta tarefa** — pré-existiam antes do primeiro comando desta rodada, e a
Tarefa 9 não as criou nem as removeu (Regra 1 do brief: só se toca no que se cria nesta
sessão). Não há operação de remoção individual exposta pelo motor (só gravar a lista
inteira mesclada); são apenas swatches adicionais no seletor de cores do builder — nada
na subconta usa esses nomes de papel hoje, então nenhuma página ou automação muda de
aparência por causa disso.

**Chrome persistente com perfil compartilhado — a escrita ao vivo é serial por
construção.** Abrir uma segunda sessão do Chrome apontando para o mesmo
`~/.automaster/chrome-profile` (por exemplo, uma segunda invocação do CLI, ou uma
ferramenta de automação de navegador separada) enquanto o extractor tenta abrir a sua
própria sessão trava o lock (`SingletonLock`) e faz o `npm run formulario-*` falhar com
`Target page, context or browser has been closed` — ou, pior, deixa duas requisições
disputando a mesma aba e produz efeitos cruzados (visto na 1ª rodada desta tarefa: uma
cópia extra e uma exclusão inesperada do formulário original, quando a sessão principal e
um subagente escreveram perto no tempo — ver episódio registrado acima). Matar os
processos Chrome do perfil e apagar
`SingletonLock`/`SingletonCookie`/`SingletonSocket` resolve o lock em si, mas não evita o
segundo efeito. Não é um bug do extractor: é a arquitetura de "perfil persistente único"
descrita no CLAUDE.md — **a consequência prática é que nenhuma escrita ao vivo de
formulário/survey (nem a captura de token que a antecede) pode rodar em paralelo com
outra**, nem em dois terminais, nem em dois agentes/processos, nem numa mistura dos dois.
Quem for operar este comando deve sempre rodá-lo em série, um de cada vez, até o fim — é a
regra que as rodadas 2, 3 e 4 desta tarefa seguiram, e a 1ª rodada não seguiu.

**Residual de teste (conferido nas cinco rodadas)**: nenhum, em formulário ou survey. A
conferência de cada rodada foi: rodar `formulario-acao -o lista` (formulário) e `-o lista
--tipo survey` (survey) depois da limpeza e procurar por `"name":"ZZ TESTE` no JSON
completo da resposta — nenhuma ocorrência, nas cinco vezes. Na 1ª rodada, isso incluiu
achar e apagar manualmente uma cópia extra que tinha aparecido por causa da concorrência.
Na 4ª rodada, a conferência final mostrou `"total":10` em formulários e `"total":29` em
surveys, os mesmos totais de produção de antes de qualquer escrita desta tarefa. A 5ª
rodada escreveu depois dessa conferência (o `restaurar` de survey e a investigação do
`duplicar` fantasma, ambos acima) e teve a sua própria: o total de surveys foi checado de
novo depois do episódio `restaurar`/`apagar` anômalo (voltou a `29`) e outras três vezes
ao longo da investigação do duplicado fantasma (sempre `29`, sem os ids `u0WIsApG4MDPfCDqcFRf`
nem `FuKXZth8OYvPJuzwr7u9` aparecendo na listagem) — é a mesma checagem de total, repetida, não uma
conferência nova inventada aqui. Fora do escopo de formulário/survey, o contato de teste
`ZlkU3kiMDr0xiIGLiMC5` (ver seção de submissão pública acima) continua na subconta, por
decisão — não é resíduo esquecido.
