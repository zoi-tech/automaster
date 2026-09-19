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
`CHECKBOX` e `DATE`; PUT de campo padrão (`contact.company_name`, `contact.phone`,
`contact.source`); POST de tag; DELETE de tag; `set` + `tagsDel` na mesma execução. Tudo 200,
pela CLI e pela tool MCP `editar`.

**Normalização do GHL na resposta** (o valor vai como string em todos os casos):
`NUMERICAL` volta número (`1234.5`), `CHECKBOX` volta array (`["sim"]`), `DATE` volta a string
ISO como enviada, `contact.phone` volta em E.164 com o DDI do `country` do contato
(`11999998888` → `+5511999998888`). O aviso de "escrita possivelmente ignorada" dispara nesse
último caso e é falso positivo esperado.

**Limpar campo:** custom field limpa com string vazia; campo padrão **não** — a API aceita 200
e ignora. Para campo padrão o corpo tem que levar `null`, e é isso que a CLI manda quando o
valor de `--set` é vazio.

**O que NÃO foi exercitado:** `MONETORY`, `TEXTBOX_LIST`, `EMAIL` e `PHONE` como custom field;
os 12 campos padrão restantes do mapa.

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
