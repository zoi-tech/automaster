# Contato editar — escrita no GHL via API interna

Data: 2026-09-18. Primeiro passo do Automaster como ferramenta de escrita, não só de backup.

## Objetivo

Uma tool MCP `contato_editar` que edita campos e tags de um contato de uma subconta GHL usando a
API interna (`backend`/`services.leadconnectorhq.com`), com a sessão Chrome já logada do
extractor. Toda escrita é precedida por um snapshot do contato gravado em disco.

Escolhas já feitas:

- Disparo: tool MCP, usada pelo Claude durante diagnóstico com `contato`.
- Escopo v1: campos padrão (nome, telefone, email...), custom fields e tags (adicionar/remover).
  Fora: mover oportunidade, criar contato, desfazer.
- Salvaguarda: snapshot antes de escrever. Sem confirmação em duas etapas; o gate de permissão
  do Claude Code já pede aprovação humana.
- API interna, não a pública v2 com PIT. Motivo: exercitar o caminho que também serve para
  workflows, onde a pública não alcança. A escrita interna já foi provada em scripts soltos
  (`extractor/restore.ts` PUT de workflow, `extractor/cv.ts` POST de custom value).

## Etapa zero: descoberta

O endpoint de edição de contato **não está mapeado**. Antes de qualquer código:

1. Rodar `npm run discover -- --location Xb9gDxwxYhdqtprGcb5E` e, no Chrome, editar um contato
   de teste: mudar um campo padrão, um custom field, adicionar e remover uma tag.
2. Anotar em `docs/endpoints.md`: host, método, rota, headers (qual dos dois tokens), payload
   de cada operação e resposta. Anotar também o GET de contato inteiro usado pelo snapshot.
3. Se tag e campo forem endpoints distintos, o comando faz uma chamada por operação.

## Extractor

Comando novo em `src/cli.ts`:

```
npm run contato-editar -- -l <loc> -i <contactId> [--set campo=valor]... [--tag +nome]... [--tag -nome]... --json
```

- Reusa `openSession`, `captureTokens`, `GhlClient`. `GhlClient` ganha `putJson`/`postJson`
  (hoje só tem GET); mesma recaptura de tokens em 401.
- `--set` aceita nome de campo padrão (`firstName`, `email`, `phone`...) ou nome/id de custom
  field. Nome de custom field é resolvido pela lista `custom_fields` do dump mais recente da
  subconta em `AUTOMASTER_DUMPS`; sem dump, só id. Nome ambíguo ou inexistente é erro antes de
  qualquer chamada.
- `--tag` aceita nome; a lista de tags também vem do dump. Tag inexistente é erro (não cria).
- Ordem: validar entrada → GET contato → gravar snapshot → PUT/POST → GET contato de novo →
  imprimir `{antes, depois, mudancas, snapshot}` em JSON no stdout.
- Falha no snapshot aborta sem escrever.

## Snapshot

Caminho: `<AUTOMASTER_DUMPS>/<locationId>/contatos/<contactId>/<YYYY-MM-DD_HHmmss>.json`.

Conteúdo: `{fetchedAt, pedido: {set, tags}, raw: <GET do contato intocado>}`. Pasta `contatos/`
fica ao lado das pastas de snapshot de workflow e o loader do auditor a ignora (não tem
`manifest.json`). Desfazer a partir desse arquivo é trabalho futuro.

## Auditor / MCP

Tool `contato_editar(loc, id, set: dict = {}, tags_adicionar: list = [], tags_remover: list = [])`
em `mcp_server.py`. Chama o comando por subprocess, igual `_run_timeline`, e devolve o JSON do
stdout. Erros ensinam, no padrão do `contato`: extractor não provisionado (`tsx` ausente),
campo/tag inexistente, 401 persistente após recaptura. Skill `automaster-leitura` ganha uma
linha dizendo quando usar a tool.

## Testes

- Auditor: teste da tool com subprocess mockado (sucesso, erro de provisionamento, erro do
  comando).
- Extractor: `npx tsc --noEmit`; resolução de nome de campo/tag em função pura testável a olho.
- Real: editar um contato de teste na Instaltech e conferir com `contato` que o evento
  `UPDATED`/`TAG_ADDED` apareceu na timeline e que o snapshot foi gravado.

## Fora de escopo

Desfazer, criar contato, mover oportunidade, edição em lote, confirmação em duas etapas.
