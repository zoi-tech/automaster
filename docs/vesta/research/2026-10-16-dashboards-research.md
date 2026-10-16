# Pesquisa — dashboards nativos do GHL

Spec: `docs/vesta/specs/2026-10-16-dashboards-design.md`

Sete frentes em paralelo (subagentes Haiku): reuso interno, docs e blast radius, bundle
público do app, rede ao vivo da página (subconta `Xb9gDxwxYhdqtprGcb5E`, só leitura), docs
oficiais do GHL, API pública e engenharia reversa existente, referências visuais. Artefatos
brutos em `/tmp/ghl-bundle-dash/` e `/tmp/ghl-dash-net/` (temporários).

## Achados

### A1 — A API interna de dashboards está inteira no bundle público
- Fonte: micro-frontend `reportingApp`, build 306,
  `appcdn.leadconnectorhq.com/automation-reporting/reporting/306/remoteEntry.js`; rotas e
  enums em `reporting.59125fffbea7741b.js`. Base `https://backend.leadconnectorhq.com/reporting`,
  headers `Channel: APP`, `Source: WEB_USER`, `Version: 2021-04-15`, `token-id` + `Bearer`.
- Rotas: `GET /dashboards?locationId`, `POST /dashboards` (`locationId,title,isPrivate,permissionAccess`),
  `GET|PUT|DELETE /dashboards/{id}` (PUT: `{title,activityBuffer,layout,themeConfig,version}`;
  DELETE leva `{locationId,version}` no CORPO), `POST /dashboards/{id}/duplicate`
  (aceita `targetLocationId`), `GET|POST /dashboards/{id}/permissions`, `/set-default`,
  `/versions`, `/versions/{v}/restore`, `GET /dashboards/widgets-definitions`,
  `/custom-metrics` (CRUD), sticky-notes.
- Contradiz a spec: não. Confirma a abordagem por API.
- Pergunta que levanta: nenhuma.

### A2 — Todo dashboard tem histórico de versões com restauração
- Fonte: `GET|POST /dashboards/{id}/versions`, `POST .../versions/{v}/restore`, `.../versions/commit`
  (`reporting.59125fffbea7741b.js`).
- Contradiz a spec: parcial. A spec não prevê desfazer; o GHL já dá isso de graça.
- Pergunta que levanta: toda edição deve registrar a versão anterior e oferecer "voltar" com um
  comando, para o cliente nunca ficar com um painel quebrado?

### A3 — O PUT exige `version`: a guarda de concorrência é nativa
- Fonte: corpo do PUT e do DELETE em `reporting.076ece4f185529.js` (~150033).
- Contradiz a spec: não. A guarda da spec sai da própria API, como em workflow.

### A4 — Grade de 12 colunas, mínimos por tipo, edição por buffer de atividades
- Fonte: GridStack `column:12`, `cellHeight 54px` (`reporting.534da9d677f1f7.js` ~50274); mínimos
  numeric 4x4, tabela ~6, padrão 6x8 (`reporting.56fae4dfa62dc8.js` ~97771); `activityBuffer`
  `{create:[{id:payload}], update:[...], delete:[ids]}` (`reporting.3c6530554614de.js`).
- Contradiz a spec: não. Dá a regra concreta para o validador local de layout.

### A5 — O número que o GHL mostra sai de uma rota POST, não precisa ler o DOM
- Fonte: rede ao vivo, `/tmp/ghl-dash-net/requests.json`: `POST /reporting/dashboards/crm/opportunities`,
  `/automations/appointments`, `/custom/funnel`, `/custom/funnel/stage-distribution`, `/custom`.
  Corpo com `aggregations`, `groupBy`, `filters` (`date_added` `time_series` em ms). Resposta
  `{data:[{metricKey,data:[{label,value,id}]}]}`.
- Contradiz a spec: parcial. A spec deixava o DOM como alternativa; não precisa. Não está
  provado que esses POST não têm efeito colateral (nenhum devolveu id).

### A6 — A conferência independente só cobre bem oportunidades e agenda
- Fonte: `extractor/src/api/opportunities.ts:12-22` (busca sem filtro de data, só
  funil/estágio/status/dono); `extractor/src/api/calendars.ts:85-105` (eventos por período, ms);
  sem rota de contatos por período (`contacts.ts:10` só por id); conversas sem contagem por
  período (`conversations.ts:53-64`); API pública idem (`ghl-api-docs`).
- Contradiz a spec: sim. A spec promete conferir "cada número" contra contagem independente.
- Pergunta que levanta: widget de contatos novos, conversas, e-mail, chamadas e anúncios vai
  aparecer como "sem conferência". Aceita isso, ou só entram no painel widgets que dão para
  conferir?

### A7 — A mesma métrica dá números diferentes conforme a data escolhida
- Fonte: help.gohighlevel.com art. 155000008109 (mod. 18/06/2026): Date Property = Created On,
  Updated On ou Status Change; Status Change reseta ao reabrir. ideas.gohighlevel.com
  "opportunity on dashboard does not match": dashboard e lista de oportunidades divergiam por isso.
- Contradiz a spec: não, mas é a armadilha principal do loop de dados.
- Pergunta que levanta: o automaster deve fixar "data de criação" como padrão em todo widget
  de oportunidade (número estável, recomendação oficial)?

### A8 — Não existe widget de HTML livre; existe um objeto Embed por URL
- Fonte: `widgets-definitions` ao vivo (objetos Title, Image, Text Box, Embed com `type`/`content`);
  changelog oficial "embed external content on your dashboards"; enum `objectWidget` no bundle.
- Contradiz a spec: sim. O degrau 3 não é HTML embutido, é uma página hospedada fora do GHL
  mostrada por iframe.
- Pergunta que levanta: onde essa página mora (ela precisa estar no ar sempre e pode mostrar
  dado do cliente), ou o degrau 3 fica fora desta entrega?

### A9 — "Estatística personalizada" existe como métrica customizada
- Fonte: `/custom-metrics` e `/custom-metrics/dashboard` no bundle; art. 155000001207 (widget
  customizado: métricas, agrupamento, filtros AND/OR, comparação). Memória `~/.claude/memory/tools/ghl.md:551`:
  widget nativo não divide uma métrica por outra (custo por lead impossível).
- Contradiz a spec: não. O payload de `/custom-metrics` não foi lido; não se sabe se aceita fórmula.

### A10 — Widget personalizado pode depender do plano
- Fonte: FAQ oficial (art. 155000001230, 2025: só $297/$497+) contra art. 155000001531
  (2025-11: todos os planos).
- Contradiz a spec: parcial. A spec supõe que tudo está disponível em toda subconta.
- Pergunta que levanta: nenhuma de design; a prova ao vivo descobre e o erro vira mensagem clara.

### A11 — O screenshot funciona sem humano, mas abrir a página ESCREVE
- Fonte: rede ao vivo. Chromium headless com `storageState` de `estado-ghl.json` carregou
  logado, widgets em ~12 s, `networkidle` nunca resolve. Ao carregar, a página mandou sozinha
  `PUT /reporting/dashboards/<id>/widget-preference` duas vezes (grava filtro de widget do usuário).
  PNG só da janela: a rolagem é de um contêiner interno, `fullPage` não pega o resto.
- Contradiz a spec: sim. `dashboard-ver` não é leitura pura.
- Pergunta que levanta: ver vira uma operação que passa pela fila de escrita?

### A12 — Abrir o GHL logado fora do processo de fundo esbarra numa decisão registrada
- Fonte: A45 em `docs/vesta/specs/2026-10-09-sessao-de-fundo-design.md:129-134` (quem precisa de
  tela usa perfil com login PRÓPRIO); `docs/vesta/research/2026-10-09-sessao-de-fundo-research.md:227`
  (4 de 24 telas de login vieram de `/dashboard`); `extractor/test/sem-cliente-antigo.test.ts`
  proíbe `openSession`/perfil persistente em `src/`.
- Contradiz a spec: sim. A spec importa a sessão do processo de fundo num Chrome à parte.
- Pergunta que levanta: arriscar derrubar o login do processo de fundo a cada screenshot, ou
  usar um perfil de tela com login próprio (um login a mais, uma vez)?

### A13 — O automaster não sabe o fuso da subconta
- Fonte: nenhuma rota `locations/<loc>` no repo; `calendars.ts:15-28` exige ISO com fuso; FAQ
  oficial: widgets usam fuso do sistema; bundle: `PUT /dashboards/{id}/timezone`.
- Contradiz a spec: sim. A spec supõe o fuso disponível.
- Pergunta que levanta: nenhuma de produto; precisa ler a subconta antes de conferir.

### A14 — Já existe um dashboard real para servir de molde
- Fonte: `GET /reporting/dashboards/66a8d9e97ec41f7c8672c320` na Xb9g ("Visão Geral das Vendas",
  19 widgets com `layout`, `chartType`, `module`, `apiConfig`, `options`), em
  `/tmp/ghl-dash-net/reporting_completo.json`.
- Contradiz a spec: não. Widget novo pode copiar molde, como o step do canvas.

### A15 — Duplicar aceita outra subconta
- Fonte: `POST /dashboards/{id}/duplicate` com `targetLocationId`.
- Contradiz a spec: não. Fica registrado: abre caminho barato para modelo entre subcontas
  depois.

### A16 — Objetos Título e Texto existem para dar estrutura ao painel
- Fonte: `widgets-definitions` ao vivo (Title, Text Box, Image).
- Contradiz a spec: não. Ferramenta de layout para o "bonito" (cabeçalhos de seção).

### A17 — Padrão visual recorrente e checklist
- Fonte: inspo (ghost.org, tinybird.co, statsig.com): 3 a 4 números no topo, um gráfico de
  tendência largo, detalhe embaixo, uma cor de destaque. Checklist de 11 itens (widget vazio,
  texto cortado, KPIs alinhados, ≤4 KPIs, tendência é o maior bloco, contraste 4.5:1, séries
  distinguíveis, sem rolagem interna, hierarquia, ≤8 blocos, espaçamento uniforme).
- Contradiz a spec: não. A skill `dataviz` não foi achada em disco pelo subagente, mas está
  disponível pelo Skill tool; entra no mockup.

### A18 — Nome colide e contagens travam em teste
- Fonte: `auditor/src/automaster_audit/dashboard.py:112` (inventário do dump, outra coisa);
  `extractor/test/cli-comandos.test.ts:14-21`, `fila-escrita.test.ts:51-54`,
  `auditor/tests/test_sessao_de_fundo_docs.py:21-24` (frases proibidas como "abre o Chrome"),
  `auditor/tests/test_versoes.py`. Versão no working tree já é 0.30.0, não commitada.
- Contradiz a spec: parcial. O módulo MCP precisa de outro nome e a feature entra numa versão
  depois da 0.30.0.

### A19 — Ninguém publicou engenharia reversa disso
- Fonte: buscas em GitHub, npm, PyPI, fóruns (subagente de API pública). API pública sem rota de
  dashboard (`~/.claude/skills/ghl-api-docs/docs/ENDPOINTS.md`).
- Contradiz a spec: não. Só registro.

## Fila do grill

Ordenada por dependência.

1. A12 — screenshot com login importado (risco de derrubar o processo de fundo) ou perfil de tela com login próprio? (trava A11)
2. A11 — ver o painel grava preferência: passa pela fila de escrita?
3. A6 — widgets sem conferência possível entram marcados "sem conferência" ou ficam fora? (trava A7, A13)
4. A7 — fixar "data de criação" como padrão nos widgets de oportunidade?
5. A8 — degrau 3 vira página externa por iframe: onde hospeda, ou sai desta entrega?
6. A2 — toda edição guarda a versão anterior e oferece voltar?
7. A5 — usar a rota de dados do widget como fonte do número mostrado, sem DOM?
8. A18 — nome do módulo MCP e versão-alvo.
