# Conversas — mapa prévio (antes da sessão de discover)

Levantado da API pública v3 em 2026-09-19. Serve para saber **o que procurar** na aba
Conversas com `npm run discover`. Nada aqui foi confirmado na API interna.

## Comando da sessão

```
npm run discover -- -l Xb9gDxwxYhdqtprGcb5E \
  --rota "contacts/detail/<contactId>" --filtro conversations
```

`--filtro` liga o log da resposta dos GET (4000 chars) cuja URL contenha a substring.

## As três rotas que importam

Na pública, base `services.leadconnectorhq.com`, header `Version: v3`:

| o quê | rota pública |
|---|---|
| achar a conversa do contato | `GET /conversations/search?locationId=&contactId=` |
| ler as mensagens | `GET /conversations/:conversationId/messages` |
| enviar | `POST /conversations/messages` |

Na interna (`backend.leadconnectorhq.com`) o shape costuma ser próximo, mas o caminho e o
esquema de auth precisam ser observados. Lembrar dos dois tokens: workflows aceitam só
`Bearer`; `locations/*` exige `token-id`. Conversas: **a descobrir**.

## O que anotar na sessão

Paginação da leitura: a pública devolve `{messages, lastMessageId, nextPage}` e pagina por
`lastMessageId`, não por offset. Confirmar se a interna faz igual — se fizer, o loop é o
mesmo padrão de `fetchContactEvents`.

O `type` da mensagem. É o campo que diz por onde a mensagem saiu e se foi automação. A lista
pública tem 36 valores; os que interessam são `TYPE_SMS`, `TYPE_WHATSAPP`, `TYPE_EMAIL`,
`TYPE_CUSTOM_SMS`, `TYPE_CUSTOM_PROVIDER_SMS` e os `TYPE_ACTIVITY_*` (que não são mensagem,
são evento de timeline misturado no mesmo array).

Direção e autoria: procurar `direction` (inbound/outbound), `userId` e
`conversationProviderId`. Mensagem disparada por workflow chega sem autor humano — é assim
que a tool vai conseguir dizer "isto veio da automação X".

No envio: o corpo mínimo é `{type, contactId, message}`. Confirmar se a interna aceita o
mesmo ou se exige `conversationId`.

## Armadilhas já conhecidas (memória do projeto)

O `search` é indexado com atraso: conversa nova leva ~1 min para aparecer no filtro por
`contactId`, mesmo já existindo no GET direto. Não usar como verdade imediata depois de um
envio.

Não existe apagar mensagem individual — a granularidade mínima é a conversa inteira.
Qualquer tool de escrita aqui é irreversível no mesmo grau que `editar`.
