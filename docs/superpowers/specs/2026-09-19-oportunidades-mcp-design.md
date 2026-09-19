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

**Pela sessão Chrome, como todo o resto.** O CRUD de card também existe na API pública
documentada do GHL, mas essa exige uma credencial gerada e guardada em cada subconta — a
mesma que o projeto já descartou para workflows. A ferramenta usa o caminho de sempre: os
dois tokens capturados do Chrome logado. É também o único caminho que alcança a gestão de
pipeline. Custo aceito: rota interna, não documentada, que pode mudar sem aviso.

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

Criar exige pipeline, nome, status e contato. Editar aceita nome, valor, dono, estágio,
data e probabilidade de fechamento, e campos personalizados — **mas não o contato**: o
vínculo com a pessoa se define quando o card nasce e não se troca depois. A tool recusa
uma tentativa de mudar o contato com essa explicação, em vez de apagar e recriar o card
por conta própria, o que perderia o histórico dele.

Mover de estágio não é uma rota própria: é a mesma edição, trocando o estágio. A operação
existe separada só porque é o caso de uso mais comum e merece nome próprio.

`pipeline` — escrita na estrutura, `confirmo=true` obrigatório. Operações: `criar`,
`editar` (nome e lista de estágios), `apagar`.

**Guarda do estágio com cards dentro.** Antes de gravar uma edição de estágios, a tool
conta quantos cards estão em cada estágio que sumiria. Havendo qualquer um, ela recusa e
diz quantos são e em que estágio. Só passa com um segundo parâmetro de confirmação,
separado do `confirmo`, porque é uma destruição de outra ordem: não some um card, some
uma coluna inteira do funil junto com tudo que estava nela.

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

## Reuso

Listar pipelines já existe: `fetchPipelines` em `extractor/src/api/entities.ts:6-9`. A
operação `pipelines` reusa essa função em vez de reescrevê-la.

O rastro em disco também tem função pronta: `registroEscrita` em
`extractor/src/cli.ts:498-505` grava em `<dumps>/<pasta>/<loc>/<chave>/<ts>.json`. Basta
chamá-la com `_oportunidades`.

Acrescentar tool ao MCP é uma entrada no dict `TOOLS` (`mcp_server.py:543-668`), que serve
de catálogo e de despacho ao mesmo tempo. Nenhum teste afere a contagem total; nada quebra.

## O que sobra a descobrir

O contrato do card está fechado pela documentação pública: os campos de criar e editar, e
o fato de mover ser a mesma edição com o estágio trocado. O que a documentação pública
**não** cobre é a escrita de pipeline — ela só tem leitura. As rotas de criar, editar e
apagar pipeline existem, lidas do código do site, mas o payload e o comportamento
destrutivo não.

Três perguntas continuam sem fonte, todas sobre pipeline: se a edição exige mandar a lista
inteira de estágios (e portanto omitir um o apaga), se há rota por estágio, e o que
acontece com os cards de um estágio removido.

Fechar isso é a **primeira fase da implementação**, antes de qualquer código de pipeline:
abrir o Chrome contra a Instaltech, capturar as chamadas reais da interface de pipeline, e
escrever o contrato em `docs/endpoints.md`. O tentativa de baixar o bundle pelo CDN falhou
— o build referenciado não existe mais e o S3 não lista, então a URL do bundle atual só
sai abrindo o app.

O CRUD de card não depende dessa fase e pode ser construído em paralelo.

## Tarefas de borda que o plano precisa cobrir

A descrição do plugin (`.claude-plugin/plugin.json:3`) ainda diz "oito tools" e está três
releases atrasada. O frontmatter da skill de leitura
(`skills/automaster-leitura/SKILL.md:2`) enumera as tools por nome — tool fora dessa lista
não dispara a skill. E o repo exige entrada de `CHANGELOG.md` por release, no formato da
0.5.0.

## Decisões do grill

- **A1** — sessão Chrome e os dois tokens, não a API pública. Motivo: a credencial da API
  pública precisa ser criada em cada subconta e já foi descartada no projeto, e ela não
  alcança a gestão de pipeline de jeito nenhum.
- **A2, A3** — sem mudança na spec, os pontos abertos de payload de card e de mover
  estágio foram fechados pela documentação pública e viraram contrato escrito acima.
- **A4** — trocar o contato do card fica de fora, com recusa explicada. Motivo: o vínculo
  é de nascença; a alternativa seria recriar o card e perder o histórico dele.
- **A5** — gestão de pipeline continua no escopo desta rodada. Motivo: decisão do usuário,
  aceito o custo da sondagem ao vivo.
- **A6** — a sondagem vira a primeira fase do plano, e a remoção de estágio com cards
  dentro exige uma segunda confirmação além do `confirmo`.
- **A7, A8, A9** — achados de reuso incorporados na seção Reuso.
- **A10** — plugin.json, SKILL.md e CHANGELOG.md entram como tarefas do plano.
