# Plano — painéis nativos do GHL montados pelo automaster

Objetivo: o automaster monta, valida (visual e números) e publica painéis na área nativa de
dashboards do GHL, sob medida para o que o cliente quer ver.

- Spec: `docs/vesta/specs/2026-10-16-dashboards-design.md` (com `## Decisões do grill`)
- Pesquisa: `docs/vesta/research/2026-10-16-dashboards-research.md` (rotas em A1, A4, A5)
- Comando de teste (da raiz): `(cd extractor && npm test) && (cd auditor && .venv/bin/python -m pytest -q)`
- Pastas de tela: nenhuma no repositório. O que é visível é o painel dentro do GHL, montado na
  etapa 10.
- Mockup: `docs/vesta/mockups/2026-10-16-dashboards/index.html`

Regras que valem para todas as etapas:

- Comando novo emite por `emitir(opts.json, dado)` e erra por `.catch(falhar)`
  (`extractor/src/saida.ts:29,44`). Nunca `console.log(JSON.stringify(...))`.
- Escrita passa por `withClient(loc, log, fn, { escrita: ... })` (`extractor/src/cli/shared.ts:45`)
  e deixa rastro com `registroEscrita(loc, "_dashboards", <dashboardId>, dados)`
  (`shared.ts:69`).
- Teste de API usa cliente falso que registra chamadas, como `extractor/test/workflows-write.test.ts:9-24`.
  O extractor testa com `node:test` + `node:assert/strict` (`npm test` roda `tsx --test test/*.test.ts`).
- Prova ao vivo SÓ na subconta `Xb9gDxwxYhdqtprGcb5E` (subconta da ZOI). O painel existente
  "Visão Geral das Vendas" (`66a8d9e97ec41f7c8672c320`) é só lido, nunca gravado. Todo painel de
  teste nasce privado, com título começando por `ZZ TESTE AUTOMASTER`, e é apagado no fim da
  etapa que o criou. Fato de API descoberto ao vivo vai para `docs/endpoints.md`, seção nova
  `## Dashboards`, na mesma etapa.
- Texto novo (descrição de tool, skill, comentário em `src/`) não usa as frases proibidas de
  `auditor/tests/test_sessao_de_fundo_docs.py:21-24` ("abre o Chrome", "abre um navegador" e
  afins). Diga "carrega a página no perfil de tela".

---

## Etapa 1 — Leitura de painéis e fuso da subconta

**Tela:** não.

**Arquivos:**
- criar `extractor/src/api/dashboards.ts`
- criar `extractor/src/cli/dashboards.ts` (exporta `registrarDashboards(program)`)
- mudar `extractor/src/cli.ts` (import + `registrarDashboards(program)`, como os outros em `:8-36`)
- mudar `extractor/package.json` (script `"dashboards": "tsx src/cli.ts dashboards"`, igual aos vizinhos)
- mudar `extractor/src/cli/smoke.ts` (`CHECAGENS`, `:109`): checagens `dashboards-lista`,
  `dashboards-catalogo`, `subconta-fuso`
- criar `extractor/test/dashboards.test.ts`
- mudar `extractor/test/cli-comandos.test.ts:14-21` (lista `COMANDOS` ganha `dashboards`)
- mudar `extractor/test/fila-escrita.test.ts:9-12` (`LEITURA` ganha `runDashboards`; o total do
  assert em `:51-54` sobe 1)
- mudar `docs/endpoints.md` (seção `## Dashboards`, leitura)

**O que prova a etapa:**
- `listarPaineis` faz `GET https://backend.leadconnectorhq.com/reporting/dashboards?locationId=<loc>`
  e devolve id, título, `isDefault`, `isPrivate`, `__v` de cada painel.
- `detalhePainel` faz `GET .../reporting/dashboards/<id>?locationId=<loc>` e devolve, por widget,
  `widgetId`, título, `chartType`, `module`, `layout {x,y,w,h,minW,minH}`, `options`, `apiConfig`,
  juntando `data.dashboardWidgets` (layout) com `data.widgets` (definição) pelo `widgetId`; devolve
  também `themeConfig`, `isPrivate`, `isDefault` e a versão do painel (`__v`).
- Widget presente em `dashboardWidgets` sem par em `widgets` aparece com `definicao: null`, não some.
- `catalogoWidgets` faz `GET .../reporting/dashboards/widgets-definitions?locationId=<loc>`.
- `versoesPainel` faz `GET .../reporting/dashboards/<id>/versions?locationId=<loc>`.
- `dadosWidget` faz `POST https://backend.leadconnectorhq.com/reporting<apiConfig.path>?locationId=<loc>`
  com o corpo `{chartType, options}` do widget e devolve `data` sem tocar.
- `fusoDaSubconta` faz `GET` da subconta e devolve o fuso IANA (ex.: `America/Sao_Paulo`). A
  rota exata se confirma ao vivo nesta etapa (candidata: `GET https://services.leadconnectorhq.com/locations/<loc>`,
  campo `location.timezone`); a escolhida vai para `docs/endpoints.md`.
- CLI: `npm run dashboards -- -l <loc> -o lista|detalhe|catalogo|versoes|dados|fuso [-i <id>] [--widget <wid>] --json`
  devolve o envelope `{ok, data}`. `-o detalhe` sem `-i` erra com mensagem que diz que falta o id.
  `-o dados` exige `-i` e `--widget`.
- Prova ao vivo (registrada em `docs/endpoints.md`): lista e detalhe da Xb9g; `-o dados` do widget
  "Oportunidades por Status" devolve as contagens por status; o `__v` e o `updatedAt` do painel
  são iguais antes e depois de chamar `-o dados` três vezes — é a prova de que a rota de dados não
  grava (achado A5).
- `npm run smoke -- -l Xb9gDxwxYhdqtprGcb5E --json` passa com as três checagens novas.

**Como fazer:**
- Módulo no formato de `extractor/src/api/forms.ts:1-10`: comentário de topo com host e onde
  está a doc, constante `BASE = "https://backend.leadconnectorhq.com/reporting"`, uma função
  exportada por rota recebendo `(client: GhlClient, loc, ...)`.
- O app manda `Version: 2021-04-15` nessas rotas; o `GhlClient` manda `2021-07-28`
  (`extractor/src/api/client.ts:58-71`). Faça a prova ao vivo primeiro. Se o servidor recusar
  por causa da versão, acrescente um parâmetro opcional `extraHeaders` a `getJson/putJson/postJson/deleteJson`
  repassado a `request`/`enviar`, no mesmo formato que `postMultipart` já tem (`client.ts:126`),
  e use `{version: "2021-04-15"}` em `dashboards.ts`. Se aceitar, não mexa no cliente.
- CLI no formato de `registrarFormularios` (`extractor/src/cli/formularios.ts:447-496`):
  `runDashboards(opts)` com `withClient(loc, log, fn)` sem escrita.
- Checagem de smoke no formato de `smoke.ts:88-99` (`nome`, `chamar`, `conferir` que devolve
  `null` quando a forma bate). O cassete (`extractor/test/fixtures/api-forma.json`) só é regravado
  na etapa 10.

---

## Etapa 2 — Validador de layout e das regras de composição

**Tela:** não.

**Arquivos:**
- criar `extractor/src/api/dashboards-layout.ts`
- criar `extractor/test/dashboards-layout.test.ts`

**O que prova a etapa:**
- `validarLayout(itens)` recebe `[{id, x, y, w, h, chartType}]` e devolve a lista de problemas
  (vazia quando passa). Cada problema tem `codigo` e `mensagem` em português, nomeando o widget.
- Recusa: widget com `x < 0`, `w < 1` ou `x + w > 12` (`fora_da_grade`); dois widgets que se
  sobrepõem em alguma célula (`sobreposicao`, nomeando os dois); largura ou altura abaixo do
  mínimo do tipo (`abaixo_do_minimo`): `numeric` 4x4 em área, mas o GHL aceita `w` 3 nos números
  do topo — use mínimo `w 3, h 4` para `numeric`, `w 6, h 6` para `table`, `w 5, h 6` para
  `funnel`, e `w 4, h 6` para os demais; buraco (`buraco`): uma linha da grade, entre a primeira e
  a última linha ocupadas, com célula vazia que nenhum widget abaixo poderia ocupar sem subir.
  Objetos de layout (`chartType` `objectWidget`) entram na conta de sobreposição como qualquer
  widget.
- `validarComposicao(plano)` recebe os widgets com `chartType` e `options` e devolve avisos (não
  bloqueiam a gravação, vão para a prévia): mais de 4 `numeric` com `y` igual ao menor `y` do
  painel (`numeros_demais_no_topo`); `donut` com `options.groupBy.limit` ausente ou maior que 5
  (`donut_com_fatias_demais`); widget de oportunidade (`module` `crm-opportunities`) cuja
  propriedade de data não é `date_added` e cujo título não cita a data usada
  (`data_nao_dita_no_titulo`); título com mais de 32 caracteres numa largura de até 4 colunas
  (`titulo_longo`).
- Painel vazio passa. Um widget só, 12 de largura, passa. Os 19 widgets do painel real da Xb9g
  (layout copiado da pesquisa como fixture, só `x,y,w,h,chartType`) passam no `validarLayout`.

**Como fazer:**
- Funções puras, sem cliente. A grade é 12 colunas, linha de 54 px (`cellHeight`), igual ao
  GridStack do app (pesquisa A4).
- Buraco: monte a matriz de ocupação; para cada célula vazia entre a menor e a maior linha
  ocupadas, é buraco se existe widget começando abaixo dela que caberia ali (mesmas colunas
  livres). Mantenha simples; marque o limite com comentário `ponytail:` se usar varredura O(n²).

---

## Etapa 3 — Escrita de painel: criar privado, editar, tema, apagar, restaurar

**Tela:** não.

**Arquivos:**
- mudar `extractor/src/api/dashboards.ts` (funções de escrita)
- mudar `extractor/src/cli/dashboards.ts` (comando `dashboard-acao`, `runDashboardAcao`)
- mudar `extractor/src/cli.ts`, `extractor/package.json` (script `dashboard-acao`)
- mudar `extractor/test/dashboards.test.ts`
- mudar `extractor/test/cli-comandos.test.ts` (ganha `dashboard-acao`)
- mudar `extractor/test/fila-escrita.test.ts` (`ESCRITA` ganha `runDashboardAcao: "!!o.confirmo"`;
  total sobe 1)
- mudar `docs/endpoints.md` (`## Dashboards`, subseção `### Escrita`)

**O que prova a etapa:**
- `criarPainel` faz `POST .../reporting/dashboards` com `{locationId, title, isPrivate: true, permissionAccess: []}`.
  O CLI nunca cria painel público: `--acao criar` não tem opção de público.
- `salvarPainel` faz `PUT .../reporting/dashboards/<id>?locationId=<loc>` com
  `{title, activityBuffer, layout, themeConfig, version}`; `activityBuffer` no formato
  `{create:[{<idTemporario>: <widget>}], update:[{<widgetId>: <widget>}], delete:[<widgetId>]}`.
- `apagarPainel` faz `DELETE .../reporting/dashboards/<id>` com corpo `{locationId, version}`
  (corpo, não query — pesquisa A1).
- `restaurarVersao` faz `POST .../reporting/dashboards/<id>/versions/<v>/restore?locationId=<loc>`.
- `dashboard-acao` aceita `--acao criar|editar|tema|renomear|apagar|restaurar` e:
  - sem `--confirmo`, não faz nenhum PUT/POST/DELETE (o cliente falso registra zero escritas) e
    devolve a prévia: o painel atual, o que muda, os problemas de `validarLayout` e os avisos de
    `validarComposicao`, e a `versao` lida;
  - `editar` recebe `--plano <json|arquivo>` com `{criar:[widget], atualizar:[widget], remover:[widgetId], layout:[{id,x,y,w,h}]}`;
    widget novo sem `molde` erra dizendo para copiar um widget do mesmo tipo (`-o catalogo` ou
    `-o detalhe` de outro painel);
  - com `--confirmo` e `validarLayout` com problema, recusa sem gravar e lista os problemas;
  - com `--confirmo`, exige `--versao-esperada <n>`; se a versão lida for outra, recusa com
    "o painel mudou desde a prévia" e não grava;
  - `apagar` e `editar` recusam painel com `isDefault: true` ("é o painel padrão da subconta");
  - `tema` recebe `--tema '{"titleColor":"#...","backgroundColor":"#...","baseColor":"#...","metricColor":"#...","linkColor":"#..."}'`
    e recusa cor fora do formato `#RRGGBB` e contraste menor que 4.5:1 entre `metricColor` e
    `backgroundColor` e entre `titleColor` e `backgroundColor`;
  - toda gravação lê antes `GET .../versions` e grava no rastro (`registroEscrita`, pasta
    `_dashboards`) a versão anterior, para `restaurar` saber para onde voltar; o envelope traz
    `escrita.rastros`.
- Prova ao vivo na Xb9g: criar `ZZ TESTE AUTOMASTER etapa 3` (privado), editar com 1 widget
  `numeric` de oportunidades copiado do painel real, trocar tema, renomear, restaurar a versão
  anterior, apagar; listar no fim e confirmar que o painel sumiu. A prévia de `apagar` no painel
  real recusa por ser o padrão.

**Como fazer:**
- Prévia, guarda e recusa no formato de `extractor/src/cli/workflow-editar.ts:68,110,131-152`
  (`conferirVersaoEsperada`, `aplicado:false` com motivo).
- `withClient(..., { escrita: !!o.confirmo })`, igual a `formularios.ts:281`.
- Contraste: luminância relativa WCAG; função pura no próprio `dashboards-layout.ts`, com teste.
- Se o servidor recusar o `activityBuffer` no formato do bundle, capture o corpo real do app
  carregando a página no perfil de tela (etapa 4) ou ajuste pela mensagem do 4xx; o formato que
  funcionou vai para `docs/endpoints.md`.

---

## Etapa 4 — Perfil de tela com login próprio e captura do painel

**Tela:** não (gera PNG; a tela do GHL não muda).

**Arquivos:**
- criar `extractor/src/tela/perfil.ts`
- mudar `extractor/src/cli/dashboards.ts` (comando `dashboard-ver`, `runDashboardVer`)
- mudar `extractor/src/cli.ts`, `extractor/package.json` (script `dashboard-ver`)
- criar `extractor/test/perfil-tela.test.ts`
- mudar `extractor/test/sem-cliente-antigo.test.ts` (exceção nomeada para `tela/perfil.ts`)
- mudar `extractor/test/cli-comandos.test.ts`, `extractor/test/fila-escrita.test.ts`
  (`ESCRITA` ganha `runDashboardVer: "true"`)
- mudar `docs/sessao-de-fundo.md` (parágrafo: o perfil de tela, onde fica, que nunca toca no
  perfil do processo de fundo)

**O que prova a etapa:**
- `abrirPerfilDeTela({ visivel })` usa `chromium.launchPersistentContext` em
  `~/.automaster/perfil-tela/` (raiz trocável por `AUTOMASTER_PERFIL_TELA` para teste), canal
  `chrome`, e trava `~/.automaster/perfil-tela.lock` com `travarChrome(arquivo, "perfil-tela")`
  (`extractor/src/auth/lock.ts:83`). Dois `dashboard-ver` ao mesmo tempo: o segundo espera a fila
  de escrita e não abre o perfil em paralelo.
- Nunca lê `~/.automaster/sessao/estado-ghl.json` nem `~/.automaster/chrome-profile` (teste
  estático: as duas strings não aparecem em `tela/perfil.ts`).
- `dashboard-ver -l <loc> -i <id>` carrega `https://app.gohighlevel.com/v2/location/<loc>/dashboard?dashboardId=<id>`
  (rota exata confirmada ao vivo; a escolhida vai para `docs/endpoints.md`), espera por seletor
  de widget (`.location-dashboard-numeric-card`, `.chart-container` ou o que a prova ao vivo
  mostrar) até 40 s, nunca por `networkidle`; rola o contêiner interno do painel até o fim, ou
  aumenta a altura da janela até o painel caber, e salva PNG em
  `~/.automaster/dumps/_dashboards/<loc>/<id>/<carimbo>.png`. O envelope traz `{arquivo, largura, altura, widgets: <quantos renderizados>, vazios: [títulos com "sem dados"]}`.
- Página que cai na tela de login: erra com código `login_pendente` e a mensagem manda rodar
  `npm run dashboard-ver -- --login`. `--login` abre o perfil visível na tela de login do GHL e
  espera até a URL sair de `/login` (até 10 min), depois fecha.
- Teste com abridor falso (o mesmo truque de `fotografarWidget`, `formularios.ts:288-311`, que
  recebe o abridor por parâmetro): página que responde com URL de login dá `login_pendente`; página
  com widgets dá PNG no caminho certo; o contexto é sempre fechado, inclusive no erro (fechar as
  páginas antes do contexto: a memória `sessao-de-fundo` registra que `context.close()` direto
  marca o perfil como `Crashed`).
- Prova ao vivo: o usuário faz o login uma vez com `--login`; depois `dashboard-ver` do painel
  real da Xb9g gera PNG inteiro (todos os 19 widgets, não só a primeira dobra); `npm run sessao -- --acao status --json`
  antes e depois mostra o processo de fundo logado nas duas vezes.

**Como fazer:**
- `withClient` não serve aqui (não precisa de tokens); use `entrarNaFila(caminhosDaSessao().escrita, log)`
  direto (`extractor/src/auth/lock.ts:114`, `extractor/src/fundo/comum.ts:49`), porque carregar a
  página grava `widget-preference` (achado A11).
- Erro `login_pendente`: o mesmo código que o servidor MCP já entende (`auditor/src/automaster_audit/mcp/base.py:120-124`).
- Exceção no `sem-cliente-antigo.test.ts`: acrescente um teste que só `tela/perfil.ts` chama
  `launchPersistentContext` fora de `auth/` e `fundo/`, em vez de afrouxar o teste existente.

---

## Etapa 5 — Conferência: comparador, oportunidades e agenda

**Tela:** não.

**Arquivos:**
- criar `extractor/src/api/dashboards-conferir.ts`
- mudar `extractor/src/cli/dashboards.ts` (comando `dashboard-conferir`, `runDashboardConferir`)
- mudar `extractor/src/cli.ts`, `extractor/package.json` (script `dashboard-conferir`)
- criar `extractor/test/dashboards-conferir.test.ts`
- mudar `extractor/test/cli-comandos.test.ts`, `extractor/test/fila-escrita.test.ts`
  (`LEITURA` ganha `runDashboardConferir`)

**O que prova a etapa:**
- `comparar(ghl, recontagem)` devolve `bate` quando contagens são iguais e valores monetários
  diferem menos de 1 centavo; `diverge` com os dois números caso contrário; agrupamentos (donut,
  barra) comparam rótulo a rótulo pelo `id` e listam cada grupo divergente.
- `filtroDoWidget(widget, fuso)` traduz as `options` do widget para o filtro da recontagem:
  período (`time_series` em ms, ou o `dateRange` do painel quando o widget não tem override),
  campo de data (`date_added`, `updated_at`, `last_status_change_at`), `pipeline_id`, `status`,
  `assigned_to`, e grupos de condição AND/OR. Condição que a recontagem não sabe reproduzir faz o
  widget sair `sem_conferencia` com o motivo, nunca `bate`.
- Oportunidades: recontagem pela busca existente (`extractor/src/api/opportunities.ts:62-66`,
  `listOpportunities`), paginada até o fim, filtrando pelo campo de data no lado do automaster
  quando a rota não filtra; soma `monetaryValue` para widgets de valor.
- Agenda: recontagem por `listEvents` (`extractor/src/api/calendars.ts:85-105`), um calendário
  por vez, datas em ms no fuso da subconta (`epochMs`, `calendars.ts:26`), agrupando por status.
- `dashboard-conferir -l <loc> -i <id> --json` devolve um item por widget:
  `{widgetId, titulo, modulo, resultado: "bate"|"diverge"|"sem_conferencia", ghl, recontagem, motivo?, filtro}`
  e um resumo `{bate, diverge, sem_conferencia}`. Widget de módulo ainda sem fonte (contatos,
  conversas, e-mail, ligações, anúncios até as etapas 6 e 7) sai `sem_conferencia` com
  "fonte entra numa etapa seguinte".
- Teste: período que cruza a meia-noite no fuso `America/Sao_Paulo` conta o card criado às 23:30
  locais no dia certo; widget com `dateProperty` de mudança de status é recontado pelo campo de
  mudança de status, não pelo de criação.
- Prova ao vivo na Xb9g, painel real (só leitura): os widgets de oportunidades e de agendamentos
  saem `bate`; qualquer `diverge` é investigado até a causa (filtro, fuso ou campo de data) e a
  causa vai para `docs/endpoints.md`. Tempo total medido e registrado.

**Como fazer:**
- O número do GHL vem de `dadosWidget` (etapa 1). Fuso de `fusoDaSubconta` (etapa 1).
- A rota pública `GET /opportunities/search` documenta `date`/`endDate` (`mm-dd-yyyy`). Teste ao
  vivo se a interna aceita e qual campo filtra; se filtrar por criação e o widget for de
  criação, use o filtro do servidor; senão, filtre no automaster. O que valeu vai para a doc.
- Cada recontagem é uma função `recontar<Modulo>(client, widget, filtro)`; o despachante escolhe
  pelo `module` do widget.

---

## Etapa 6 — Conferência: contatos novos e conversas

**Tela:** não.

**Arquivos:**
- mudar `extractor/src/api/dashboards-conferir.ts` (`recontarContatos`, `recontarConversas`)
- criar ou mudar a função de rota em `extractor/src/api/contacts.ts` e `extractor/src/api/conversations.ts`
- mudar `extractor/test/dashboards-conferir.test.ts`
- mudar `docs/endpoints.md` (rotas novas de busca por período)

**O que prova a etapa:**
- Rota de busca de contatos por data de criação, com total: descoberta lendo o bundle público do
  app de contatos (`appcdn.leadconnectorhq.com/crm/<app>/<build>/static/js/*.js` com UA de browser,
  `docs/endpoints.md:577-581`) e confirmada ao vivo; filtrando por intervalo, devolve o total do
  período sem paginar tudo quando a rota der total.
- Rota de conversas/mensagens por período e canal, idem.
- Widgets dos módulos `crm-contacts` e `crm-conversations` do painel real da Xb9g saem `bate`, ou
  `diverge` com causa investigada e escrita na doc. Widget desses módulos com agrupamento que a
  rota não reproduz sai `sem_conferencia` com o motivo.
- Teste com cliente falso: a recontagem monta a URL/corpo com o intervalo em ms no fuso da
  subconta e lê o total da resposta.

**Como fazer:**
- O painel real da Xb9g pode não ter widget de contatos/conversas. Nesse caso, crie
  `ZZ TESTE AUTOMASTER etapa 6` privado com um widget de cada módulo copiado do catálogo, confira,
  e apague no fim.

---

## Etapa 7 — Conferência: e-mail, ligações e anúncios do Meta

**Tela:** não.

**Arquivos:**
- mudar `extractor/src/api/dashboards-conferir.ts` (`recontarEmails`, `recontarLigacoes`, `recontarMetaAds`)
- criar `extractor/src/api/meta-ads.ts`
- mudar `extractor/test/dashboards-conferir.test.ts`
- mudar `docs/endpoints.md`

**O que prova a etapa:**
- E-mail e ligações: recontagem pelos relatórios do próprio GHL (rotas de `/reporting/reports`
  de e-mail e de chamadas, mapeadas no bundle do `reportingApp`, build lido em
  `production.app-manifest.leadconnectorhq.com/latest/manifest.json`). O item sai com
  `fonte: "ghl"` e `independente: false`, e o resumo diz que essa conferência é o GHL contra o GHL.
- Meta: `recontarMetaAds` chama `https://graph.facebook.com/v21.0/<act_id>/insights` com
  `fields=spend,impressions,clicks,actions`, o mesmo período, `time_increment` conforme o widget;
  token lido de `AUTOMASTER_META_TOKEN` (nunca gravado em disco pelo automaster); `amount_spent`/
  `spend` comparados em reais. Sem token, ou conta de anúncio do widget sem acesso: `sem_conferencia`
  com o motivo ("defina AUTOMASTER_META_TOKEN" ou "token sem acesso à conta act_...").
- Teste com `fetch` injetado: monta a URL certa, converte o período para `time_range` em datas
  locais, lê `actions` do tipo `lead`.
- Prova ao vivo: e-mail e ligações num painel `ZZ TESTE AUTOMASTER etapa 7` privado na Xb9g
  (apagado no fim). Meta: se o usuário fornecer um token válido, confere um widget de anúncio;
  sem token, a prova é o `sem_conferencia` com o motivo certo, e isso fica escrito na doc como
  pendência.

**Como fazer:**
- Conta, app e como gerar token: `~/.claude/memory/tools/meta-ads.md`. O Ad Manager do GHL na
  Xb9g está desconectado (mesma memória): widget de anúncio nessa subconta pode vir vazio; nesse
  caso o vazio é o achado, não falha da recontagem.

---

## Etapa 8 — Tools MCP do módulo `paineis`

**Tela:** não.

**Arquivos:**
- criar `auditor/src/automaster_audit/mcp/paineis.py`
- mudar `auditor/src/automaster_audit/mcp_server.py` (import em `:15-41`, `**_m_paineis.TOOLS` em `:56-66`, re-export)
- criar `auditor/tests/test_mcp_paineis.py`
- mudar `skills/automaster-leitura/SKILL.md` (lista de tools da descrição, `:3`)
- mudar `.claude-plugin/plugin.json` (descrição: 32 → 36 tools)

**O que prova a etapa:**
- Quatro tools: `dashboards` (leitura: lista, detalhe, catalogo, versoes, dados, fuso),
  `dashboard_acao` (criar, editar, tema, renomear, apagar, restaurar, publicar), `dashboard_ver`
  (devolve o caminho do PNG), `dashboard_conferir`.
- `dashboard_acao` sem `confirmo=true` chama o extractor sem `--confirmo` (prévia); com, passa
  `--confirmo` e exige `versao_esperada`; a descrição contém "ESCREVE"
  (`auditor/tests/test_mcp_formularios_escrita.py:95` cobra isso).
- `publicar` (nova ação, implementada aqui no extractor e no MCP): sem `confirmo` mostra quem passa
  a ver; com `confirmo`, faz o `PUT .../permissions` com `isPrivate:false` e `permissionAccess` dos
  papéis pedidos (`--papeis account_admin:read,account_user:read`), e recusa se o último
  `dashboard_conferir` gravado no rastro do painel tiver `diverge` (a não ser com `forcar=true`).
- Erros `login_pendente` do `dashboard_ver` chegam ao usuário com a dica do `--login`.
- Testes com a fixture `espiao` (`auditor/tests/test_mcp_formularios_escrita.py:7-16`) conferem
  o comando montado de cada tool e as recusas locais.
- `auditor/tests/test_sessao_de_fundo_docs.py` e `auditor/tests/test_versoes.py` passam.

**Como fazer:**
- Formato de `auditor/src/automaster_audit/mcp/formularios.py`: funções, depois `TOOLS = {nome: (função, descrição, schema, obrigatórios)}`.
- Chamada ao extractor por `base._run_extractor(*args, "--json")` (`mcp/base.py:132-181`).
- O nome do módulo é `paineis` porque `dashboard.py` já é o inventário do dump.
- `publicar` no extractor: `POST .../reporting/dashboards/<id>/permissions` (rota do bundle,
  pesquisa A1); o corpo exato se confirma ao vivo num painel `ZZ TESTE AUTOMASTER etapa 8`
  privado, publicado e apagado na mesma prova; ao publicar, só os papéis pedidos ganham acesso.

---

## Etapa 9 — Skill `automaster-dashboard`: método, entrevista, regras e loops

**Tela:** não.

**Arquivos:**
- criar `skills/automaster-dashboard/SKILL.md`
- mudar `CLAUDE.md` (lista de skills na seção do plugin)

**O que prova a etapa:**
- A skill tem frontmatter `name`/`description` ("Use ao montar ou refazer um painel do GHL…") e as
  seções, no formato de `skills/automaster-formulario-visual/SKILL.md`:
  1. **Leitura da subconta** com as tools existentes: `pipeline`/`oportunidades -o pipelines`,
     `agenda` (calendários), `config`, `dashboards -o catalogo`, usuários; o que existe vira opção.
  2. **Entrevista** pelo `AskUserQuestion`, uma pergunta por vez, opções tiradas da leitura:
     quem olha; quando e onde; que perguntas (múltipla); a principal; período e comparação; cores
     da marca (ou ler do site do cliente).
  3. **Plano do painel**: tabela pergunta → tipo de pergunta → widget → módulo e filtro → data →
     posição, mostrada antes de gravar. Mapa tipo de pergunta → widget e as regras de composição
     da spec (no máximo 4 números no topo, donut até 5 fatias, data de criação por padrão,
     título diz pergunta e período, altura proporcional ao conteúdo).
  4. **Montagem**: `dashboard_acao criar` (privado), `editar` com o plano, `tema`.
  5. **Loop visual**: `dashboard_ver`, ler o PNG, checklist de 11 itens da pesquisa (A17), corrigir,
     até 3 voltas.
  6. **Loop de dados**: `dashboard_conferir`; `diverge` corrige o filtro, nunca o número; repete.
  7. **Publicação**: só depois dos dois loops, `dashboard_acao publicar` com `confirmo`.
  8. **Escada**: nativo, métrica personalizada; pedido que precisaria de página externa (Embed) é
     atendido até o degrau 2 e o resultado diz o que ficou de fora.
- `auditor/tests/test_sessao_de_fundo_docs.py` passa sobre o texto novo.

**Como fazer:**
- Reaproveite o texto do mockup aprovado (aba "Plano do painel" e "Validação") como exemplo
  trabalhado da clínica dentro da skill.

---

## Etapa 10 — Prova ponta a ponta, documentação e versão 0.31.0

**Tela:** sim — implementa os painéis do mockup (`docs/vesta/mockups/2026-10-16-dashboards/index.html`,
abas 3a–3c e 4): um painel real montado pelo método dentro do GHL.

**Arquivos:**
- mudar `extractor/test/fixtures/api-forma.json` (regravado com `npm run smoke -- -l Xb9gDxwxYhdqtprGcb5E --contato ZlkU3kiMDr0xiIGLiMC5 --gravar test/fixtures/api-forma.json`)
- mudar `extractor/test/cassete.test.ts:41` se a contagem de checagens mudar
- mudar `CLAUDE.md` (comandos novos na seção `## Comandos`, 36 tools, módulo `paineis`, contagens
  de teste), `CHANGELOG.md` (seção `## 0.31.0`), `.claude-plugin/plugin.json`,
  `extractor/package.json`, `auditor/pyproject.toml` (versão 0.31.0 nos três)
- criar `docs/vesta/mockups/2026-10-16-dashboards/etapa-10/` (PNG do painel montado, relatório)

**O que prova a etapa:**
- Pelo servidor MCP (não pela CLI), na Xb9g, seguindo a skill: leitura da subconta, entrevista com
  o usuário (perguntas reais pelo menu), plano mostrado, painel `ZZ TESTE AUTOMASTER painel ZOI`
  criado privado, loop visual até passar (PNGs de cada volta salvos em `etapa-10/`), loop de
  dados com o resumo `{bate, diverge, sem_conferencia}` salvo em `etapa-10/conferencia.json`, sem
  nenhum `diverge` sem causa explicada.
- O PNG final passa no checklist visual: nenhum widget vazio, nada cortado, números do topo
  alinhados, sem rolagem lateral, a pergunta principal no topo à esquerda.
- O usuário vê o painel no GHL (logado como ele) e decide: fica privado como painel da ZOI, ou é
  apagado. A decisão e o estado final ficam no relatório da etapa.
- Processo de fundo logado antes e depois da prova inteira (`npm run sessao -- --acao status --json`).
- Suítes completas passam: `(cd extractor && npm test) && (cd auditor && .venv/bin/python -m pytest -q)`;
  `npm run typecheck`, `npm run lint`, `ruff check` e `ruff format --check` passam.

**Como fazer:**
- Versão: o working tree já está em 0.30.0 (não commitado, fora deste plano). Esta etapa sobe para
  0.31.0 nos três arquivos e escreve a seção do CHANGELOG; `auditor/tests/test_versoes.py` confere.
