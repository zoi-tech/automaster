# Oportunidades (pipelines e cards GHL) no MCP automaster

Data: 2026-09-19. Alvo: plugin 0.6.0.

## Problema

O MCP automaster lê workflows, contatos e conversas de uma subconta GoHighLevel, mas não
enxerga oportunidades. Pipelines aparecem no dump só como estrutura estática (nome do
pipeline e dos estágios), o suficiente para o `inventario` resolver uma referência de
workflow e nada além disso. Não há como listar os cards de um pipeline, ver em que estágio
um contato está, mover um card, nem criar ou apagar um pipeline.

## Escopo

Dentro: leitura ao vivo de pipelines e de oportunidades; CRUD completo do card (criar,
editar, mover de estágio, mudar status, apagar, restaurar); gestão de pipeline (criar,
editar, apagar, mexer nos estágios).

Fora: bulk delete de cards, relatórios e métricas de funil, oportunidade em auditoria
(nenhuma regra nova em `rules/`), qualquer saída HTML.

## Decisões

**Tudo ao vivo, dump nenhum.** As tools de oportunidade não leem o dump nem para listar
pipelines. O dado de funil muda a toda hora; um snapshot de ontem mais engana do que
ajuda. O dump segue servindo o `inventario` e as regras de auditoria, como hoje —
as duas leituras coexistem sem se falar. Custo aceito: toda chamada exige a sessão Chrome
logada, e uma chamada extra de rede quando só se queria o nome de um estágio.

**Três tools, no molde das conversas.**

`oportunidades` — leitura, nunca pede confirmação. Operações: `pipelines` (lista os
pipelines com seus estágios), `listar` (cards de um pipeline, com filtro de estágio e de
status), `buscar` (termo livre na subconta), `ver` (um card pelo id).

`oportunidade_acao` — escrita no card, `confirmo=true` obrigatório. Operações: `criar`,
`editar`, `mover` (troca o estágio), `status` (open/won/lost/abandoned), `apagar`,
`restaurar`.

`pipeline` — escrita na estrutura, `confirmo=true` obrigatório. Operações: `criar`,
`editar` (nome e lista de estágios), `apagar`.

A separação entre as três é a mesma de `conversas`/`conversa_acao`: quem só lê nunca
esbarra num parâmetro de confirmação, e a superfície perigosa fica visível pelo nome.

**Escrita deixa rastro.** Antes de qualquer operação destrutiva ou de mudança, o estado
atual do objeto vai para `<dumps>/_oportunidades/<locationId>/<id>/<ts>.json`, com o
resultado depois. Vale para card e para pipeline. É o mesmo mecanismo dos snapshots de
contato em `_contatos/`.

O `restaurar` da API cobre card apagado. Pipeline apagado **não tem restore** — o
snapshot em disco é a única forma de reconstruir, e manualmente. A tool diz isso na
mensagem de erro quando falta `confirmo`.

**Validação ao vivo num pipeline descartável.** A Instaltech (`Xb9gDxwxYhdqtprGcb5E`) tem
um pipeline `Vendas` real, com 9 estágios, que não será tocado. A validação cria um
pipeline `zz-teste-automaster` com estágios próprios, exercita todo o CRUD de card e de
estágio lá dentro usando o contato de teste `uWqujqll20tRuglV3mLt`, e apaga o pipeline no
fim. Nenhum resíduo em dado de produção.

## Arquitetura

`extractor/src/api/opportunities.ts` — funções puras sobre o cliente autenticado, uma por
rota, devolvendo o JSON cru. Molde: `whatsapp.ts`.

`extractor/src/cli.ts` — três comandos novos (`oportunidades`, `oportunidade-acao`,
`pipeline`), cada um com `--json` para stdout e as flags de operação. Três entradas novas
em `package.json`.

`auditor/src/automaster_audit/mcp_server.py` — três funções novas que validam a operação,
exigem `confirmo` na escrita e chamam a CLI por `_run_extractor`. Não tocam em
`loader.py`, `flow.py` nem em `rules/`.

Testes: `auditor/tests/test_mcp_tools.py` ganha casos de validação de operação inválida e
de recusa sem `confirmo`, no padrão dos testes de `whatsapp_enviar`.

## Pontos abertos para a pesquisa

**Qual host.** `docs/endpoints.md` registra `backend.leadconnectorhq.com/opportunities/pipelines`
como a rota que o extractor já usa. As rotas lidas do bundle estão em
`services.leadconnectorhq.com/opportunities`. Pode ser API interna antiga contra v2, ou um
dos dois estar errado. Isso decide qual token vai em qual chamada e precisa ser resolvido
antes do plano.

**Payload de criar e editar card.** Campos obrigatórios, nome exato de cada um, e como o
contato é vinculado. Não confirmado.

**Como mover de estágio.** Se é o mesmo `PUT /<id>` de editar com `pipelineStageId`
trocado, ou uma rota própria. Não confirmado.

**Payload de estágio no pipeline.** Se editar estágios é mandar a lista inteira no
`PUT /pipelines/<id>` (e portanto omitir um estágio o apaga) ou se há rota por estágio.
Não confirmado — e é o mais perigoso dos quatro, porque um PUT parcial pode apagar
estágios com cards dentro.

Atalho de descoberta, na ordem: bundle público em `appcdn.leadconnectorhq.com`
(baixa com `curl -A` de Chrome, 403 sem UA), depois `npm run discover` contra a interface
real se o bundle não fechar o contrato.
