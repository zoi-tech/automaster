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
