# Contato editar — escrita no GHL via API interna

Data: 2026-09-18. Primeiro passo do Automaster como ferramenta de escrita, não só de backup.

## Objetivo

Uma tool MCP `editar` que edita campos e tags de um contato de uma subconta GHL usando a
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
2. Anotar em `docs/endpoints.md`, numa seção "Escrita", junto com os headers de escrita que
   hoje só existem nos scripts soltos (`content-type`, `version`/`dataVersion` no PUT de
   workflow), antes do apagamento previsto na spec do plugin: host, método, rota, headers (qual dos dois tokens), payload
   de cada operação e resposta. Anotar também o GET de contato inteiro usado pelo snapshot.
3. Capturar adicionar tag e remover tag como requests separados do PUT de campos. O comando
   usa sempre o endpoint granular de tag: na API pública, `tags` dentro do PUT sobrescreve a
   lista inteira, e a interna tende a espelhar.
4. A descoberta é feita no próprio app (editar contato pela UI com a aba Network / `discover`
   capturando). Se o endpoint recusar os tokens capturados do browser, esgotar as variações
   (host `backend` vs `services`, qual dos dois tokens, headers `channel`/`source`/`version`)
   antes de qualquer outra coisa. Só com tudo esgotado, plano B: transporte pela API pública
   v2 com PIT, mantendo o mesmo comando e a mesma tool.

## Extractor

Comando novo em `src/cli.ts`:

```
npm run contato-editar -- -l <loc> -i <contactId> [--set campo=valor]... [--tag +nome]... [--tag -nome]... --json
```

- Reusa `openSession`, `captureTokens`, `GhlClient`. `GhlClient` extrai o laço de retry
  (401 recaptura, 429 backoff) para um `request(method, url, body?)` privado; `getJson`,
  `putJson`, `postJson`, `deleteJson` viram uma linha cada. O bloco sessão+tokens+client,
  hoje copiado em `runExtract` e `runTimeline`, vira `withClient(loc, fn)` usado pelos três.
- Resolução nome→id: uma função `latestDumpEntity(loc, nome)` substitui as três
  `*FromLatestDump` (exige `manifest.json`, ver Snapshot). As chamadas antigas mantêm a falha
  silenciosa; a de contato lança erro com "rode extract" quando não há dump.
- `--set` aceita nome ou id de campo. A resolução usa a lista única `custom_fields` do dump
  mais recente da subconta, que já mistura campo padrão (`dataType: STANDARD_FIELD`) e custom
  field; sem dump, só id. Nome ambíguo ou inexistente é erro antes de qualquer chamada. Se a
  descoberta mostrar que o PUT trata padrão e custom de forma diferente, a diferença fica na
  montagem do payload, não na resolução.
- `--tag` aceita nome; a lista de tags também vem do dump. Tag inexistente é erro (não cria).
- Ordem: validar entrada → GET contato → gravar snapshot → PUT/POST → GET contato de novo →
  imprimir `{antes, depois, mudancas, snapshot}` em JSON no stdout. O campo `dispara`
  (workflows publicados cujo trigger `contact_changed`/`contact_tag` reage ao pedido) é
  calculado pela tool no auditor, que já tem o `TriggerIndex` de `journey.py`; informa, não
  bloqueia.
- Falha no snapshot aborta sem escrever.

## Snapshot

Caminho: `<AUTOMASTER_DUMPS>/_contatos/<locationId>/<contactId>/<YYYY-MM-DD_HHmmss>.json`.

Conteúdo: `{fetchedAt, pedido: {set, tags}, raw: <GET do contato intocado>, escrito: false}`.
Logo após cada chamada de escrita bem-sucedida, o comando regrava o arquivo com `escrito: true`
(e a lista do que já foi aplicado). O caminho do snapshot é impresso em stderr antes do PUT,
para que qualquer erro do subprocess consiga citá-lo. Fica fora da
pasta da subconta: snapshot de contato não é dump. Além disso, as funções `*FromLatestDump`
do extractor passam a considerar só subpastas com `manifest.json`, como o auditor já faz.
Desfazer a partir desse arquivo é trabalho futuro.

## Auditor / MCP

Tool `editar(loc, id, set: dict = {}, tags_adicionar: list = [], tags_remover: list = [])`
em `mcp_server.py`. A descrição da tool avisa "ESCREVE em produção; snapshot gravado antes;
pode disparar workflows", no padrão do aviso "AO VIVO" do `contato`. `_run_timeline` vira `_run_extractor(*args)` e serve aos dois; a tool devolve o
JSON do stdout. Erros ensinam, no padrão do `contato`: extractor não provisionado (`tsx` ausente),
campo/tag inexistente, 401/403 persistente após recaptura ("endpoint pode ter mudado; rode
`discover`"). Erro inesperado do subprocess devolve o caminho do snapshot e a instrução
"confira o estado com `contato`", porque o Claude não sabe se a escrita chegou a acontecer. Skill `automaster-leitura` ganha uma
linha dizendo quando usar a tool.

## Testes

- Auditor: teste da tool mockando `_run_extractor` (padrão da casa), mais um teste próprio de
  `_run_extractor` com `subprocess.run` mockado (montagem do comando, parse da última linha,
  erro com caminho do snapshot).
- Extractor: `npx tsc --noEmit`; resolução de nome de campo/tag em função pura testável a olho.
- Real: editar um contato de teste na Instaltech e conferir com `contato` que o evento
  `UPDATED`/`TAG_ADDED` apareceu na timeline e que o snapshot foi gravado.

## Fora de escopo

Desfazer, criar contato, mover oportunidade, edição em lote, confirmação em duas etapas.

## Decisões do grill

- **A3** — plano B aprovado: API pública v2 com PIT, só depois de esgotar variações de host,
  token e headers na interna. Motivo: sem isso a etapa zero pode matar o trabalho inteiro.
- **A1** — a spec do plugin ganhou nota revogando "escrita fora de escopo" e apontando para cá.
  Motivo: duas specs do mesmo dia não podem se contradizer sem rastro.
- **A2** — snapshots em `_contatos/` fora da pasta da subconta, e o extractor passa a exigir
  `manifest.json` ao escolher o dump mais recente. Motivo: "contatos" vencia qualquer data na
  ordenação e quebraria o `timeline`.
- **A4** — tag sempre pelo endpoint granular, nunca dentro do PUT. Motivo: no público o PUT
  sobrescreve a lista de tags.
- **A8** — um caminho só de resolução de nome, pela lista `custom_fields` do dump. Motivo: o
  dump já mistura padrão e custom.
- **A6** — saída ganha `dispara`: workflows do dump cujo trigger reage à mudança. Motivo:
  escrita pode acender automações do cliente; o Claude avisa junto do resultado.
- **A13** — tool chama-se `editar`; aviso de escrita na descrição da tool; skill de leitura
  ganha uma linha, sem skill nova. Motivo: convenção de nome simples, e a descrição é lida
  sempre.
- **A12** — snapshot marca `escrito: true` após a escrita e todo erro cita o caminho dele.
  Motivo: morte entre PUT e resposta deixaria o Claude sem saber se escreveu.
- **A7** — erro 401/403 persistente orienta a rodar `discover`. Motivo: prior art mostra a
  interna mudando auth sem aviso.
- **A9, A10, A11, A15** — reuso: `request()` único no client, `withClient`,
  `latestDumpEntity`, `_run_extractor`, mock do wrapper nos testes. Motivo: terceira cópia de
  cada bloco; menor diff é extrair.
- **A14** — headers de escrita dos scripts soltos vão para `docs/endpoints.md` na etapa zero.
  Motivo: os scripts vão ser apagados e não são versionados.
- **A5, A16** — registrados sem mudança. Merge de custom field não documentado é coberto pelo
  snapshot e pelo GET pós-escrita; default de `DUMPS_DIR` divergente só afeta uso manual.
