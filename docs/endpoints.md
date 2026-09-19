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
- Agendamentos: `services.../calendars/events?locationId&contactId&startTime&endTime`
  testado e RECUSADO com tokens internos — endpoint correto pendente de discover
  (aba Appointments do contato).

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

### Mapa das áreas restantes (lido do bundle, sem prova ao vivo)

Bundle `crm/conversations-new-ui/2567`, baixado com `curl -A "<UA de Chrome>"`. Base
`services.leadconnectorhq.com/conversations` salvo onde indicado.

| área | rotas |
|---|---|
| group chat | `POST /group`, `POST /group/messages`, `POST /internal`, `POST /internal/check`, `POST /internal/user` |
| WhatsApp (base `/phone-system`) | `GET /whatsapp/location/<loc>/template[?templateId=&includeRewriterIds=true]`, `GET /whatsapp/workflow/options/template_id?locationId=`, `GET /whatsapp/flows?locationId=`, `POST /whatsapp/location/<loc>/attachment?conversationId=`, `POST /whatsapp/location/<loc>/voice-note?userId=&contactId=&conversationId=`, `GET /whatsapp/location/<loc>/{is-configured,phone-numbers,media?url=}` |
| IA | `GET /ai/settings/<loc>`, `POST /ai/settings`, `PUT /ai/settings/<loc>`, `POST /text/<x>/suggestions`, `POST /text/suggestions/<x>/deliver`, `PUT /interactions/suggestions/<responseId>`; knowledge base em `services.../knowledge-base` |
| SLA | `GET /sla-settings/<loc>`, `POST /sla-settings`, `PUT /sla-settings/<loc>`, `GET /sla-settings/<loc>/inbox-sla-status`, `GET /sla-settings/<loc>/manual-clear-permission`, `POST /sla-settings/clear-sla/<x>` |

### Fora de escopo, com motivo

Live-chat typing, review reply, spam check e views salvas da caixa de entrada existem na API
interna (mapeados no bundle) e não têm uso no diagnóstico de automação.
