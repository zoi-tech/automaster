# Dashboards nativos do GHL — design

Data: 2026-10-16. Classificação: estrutural.

## Objetivo

O automaster monta dashboards completos na área nativa de dashboards do GoHighLevel, a partir
de um pedido em texto ao Claude ("monta um painel de vendas pra Nick"), sem ninguém clicar na
interface. O público é o cliente final da ZOI: o dono do negócio abre o GHL e vê funil, leads,
agendamentos e vendas num painel bonito e correto.

Sucesso é um dashboard que:

1. foi criado e editado só por API;
2. passou no loop de validação visual (sem widget vazio, texto cortado, desalinhamento,
   rolagem lateral, e com hierarquia clara);
3. passou no loop de validação de dados (cada número conferido contra uma contagem
   independente, com o mesmo filtro e o mesmo fuso).

## Restrições

- Escada de widgets, nesta ordem: widget nativo do GHL; estatística personalizada do GHL
  (widget customizável e métrica personalizada, `/custom-metrics`). O GHL não aceita HTML
  dentro do painel; o terceiro degrau seria uma página externa mostrada pelo bloco Embed, e
  fica FORA desta entrega (decisão A8). Pedido que caia no degrau 3 é atendido até o degrau 2,
  e o resultado diz qual informação ficou de fora e por quê.
- Objetos de layout do próprio GHL (Título, Texto, Imagem) podem estruturar o painel.
- Mesmo padrão do resto do automaster: API interna chamada por `fetch` com os tokens do
  processo de fundo. Nada de montar clicando. Tela só na captura para a validação visual.
- Sempre ao vivo, sem passar pelo dump. Dashboard no dump (backup e diff) fica fora desta
  entrega.

## Arquitetura

Extractor (`extractor/`):

- `src/api/dashboards.ts` — uma função por rota (listar, ler, criar, editar layout e widgets,
  duplicar, apagar, e a rota de dados do widget se existir).
- `src/cli/dashboards.ts` exportando `registrarDashboards(program)`, com três comandos:
  - `dashboards` — leitura (lista, detalhe, widgets disponíveis);
  - `dashboard-acao` — escrita, prévia sem `--confirmo`, fila de escrita da máquina;
  - `dashboard-ver` — carrega o dashboard num perfil de tela próprio
    (`~/.automaster/perfil-tela/`), com login PRÓPRIO feito uma vez pelo usuário numa janela
    visível; nunca importa a sessão do processo de fundo nem abre o perfil dele (decisão A45).
    Sem login válido no perfil de tela, erra com `login_pendente` e a janela aparece. Salva PNG
    em `~/.automaster/dumps/_dashboards/<loc>/<dashboardId>/<ts>.png`. Passa pela fila de
    escrita: carregar a página faz o GHL gravar sozinho `PUT .../widget-preference`. A rolagem
    do painel é de um contêiner interno, então a captura rola esse contêiner (ou aumenta a
    janela até caber) para pegar o painel inteiro; espera os widgets por seletor, nunca por
    `networkidle`, que não resolve nessa página.
- Saída `--json` no envelope de sempre (`emitir`/`falhar`).

API: `https://backend.leadconnectorhq.com/reporting/dashboards...` (rotas mapeadas em
`docs/vesta/research/2026-10-16-dashboards-research.md`, A1). Edição pelo `activityBuffer`
`{create,update,delete}` do próprio GHL, mais `layout` e `version`. Widget novo copia um molde
do mesmo tipo (dashboard existente ou `widgets-definitions`), como o step do canvas.

Auditor, servidor MCP (`auditor/src/automaster_audit/mcp/paineis.py` — o nome `dashboard` já é
o inventário do dump em `dashboard.py`), quatro tools:

- `dashboards` — leitura;
- `dashboard_acao` — criar, editar layout e widgets, duplicar, apagar;
- `dashboard_ver` — devolve o caminho do screenshot para o Claude olhar;
- `dashboard_conferir` — validação dos números (ver abaixo).

Skill `skills/automaster-dashboard/`: o que é design e processo. Grade e hierarquia
(números-chave em cima, funil e tendência no meio, tabelas embaixo), nomes de widget, cores,
a escada de widgets, e os dois loops.

## Ciclo de vida do painel

Todo painel nasce PRIVADO na própria subconta de destino (`isPrivate: true`), só visível ao
usuário do automaster. Os dois loops rodam sobre ele assim. Só depois de passar nos dois,
`dashboard_acao publicar` abre o acesso (`isPrivate: false` + `permissionAccess`), com
`--confirmo`. Editar um painel já publicado segue o mesmo caminho: duplica privado, valida,
e a troca só acontece com `--confirmo`.

## Loop visual

Monta, chama `dashboard_ver`, avalia o PNG contra um checklist fixo da skill:

- nenhum widget vazio ou com "sem dados" quando deveria haver dado;
- nenhum título ou número cortado;
- widgets alinhados na grade, sem buraco;
- sem rolagem lateral no viewport desktop;
- hierarquia: o que o dono olha primeiro está no topo à esquerda.

Falhou, corrige por `dashboard_acao` e repete. Teto de três voltas; passou disso, entrega e
diz o que não fechou.

## Loop de dados

`dashboard_conferir` pega, para cada widget, o número que o GHL mostra pela rota de dados do
próprio widget (`POST /reporting/dashboards/crm/opportunities`, `/custom`, `/custom/funnel`,
`/automations/appointments` e afins, com o `apiConfig` e as `options` do widget), sem ler a
tela. Antes de usar, a prova ao vivo confirma que esses POST não gravam nada. Depois recalcula por outra fonte com o mesmo
filtro: período, funil, usuário, fuso da subconta. Resultado por widget: `bate`, `diverge`
(com os dois números) ou `sem_conferencia` (widget sem fonte independente que reproduza o
número).

Fontes de conferência desta entrega (decisão A6):

- oportunidades (contagem, valor, status, funil, estágio) — busca de oportunidades que já
  existe, paginada e filtrada por data no lado do automaster quando a rota não filtra;
- agendamentos — eventos da agenda por período, que já existe;
- contatos novos — rota NOVA de busca de contatos por data de criação (mapear);
- conversas — rota NOVA de conversas e mensagens por período e canal (mapear);
- e-mail e ligações — relatórios de e-mail e de chamadas do próprio GHL (rotas NOVAS a
  mapear). Conferência fraca, porque é o GHL contra o GHL; o relatório diz isso;
- anúncios do Facebook/Instagram — API do Meta Ads, fora do GHL (conta e token como em
  `~/.claude/memory/tools/meta-ads.md`).

Widget de oportunidade nasce com data de criação (`date_added`) como propriedade de data.
Outra data só quando o pedido exigir ("vendas fechadas no mês" usa mudança de status), e aí o
título do widget diz qual data usa. A conferência sempre reproduz a propriedade de data que o
widget tem, nunca a padrão.

Qualquer outro módulo (pagamentos, reputação, redes sociais, Google Analytics, Google Ads)
entra no painel com `sem_conferencia`.

Divergência é achado. O loop corrige o filtro do widget quando o filtro está errado; nunca
ajusta o número para bater.

## Erros e guardas

- Prévia antes de gravar, como em `workflow-editar`.
- Guarda de concorrência: o `PUT`/`DELETE` do GHL exigem `version`; a prévia devolve a versão
  lida e a gravação manda `--versao-esperada`. Se o dashboard mudou entre prévia e gravação,
  recusa.
- Desfazer (decisão A2): toda gravação registra no rastro a versão anterior do GHL
  (`/dashboards/{id}/versions`), e `dashboard_acao` ganha `restaurar` (`.../versions/{v}/restore`).
- Apagar exige `--confirmo` e nunca toca no dashboard padrão da subconta.
- Layout com widget sobreposto ou fora da grade é recusado localmente, antes do request. A
  grade é a do GHL: 12 colunas, mínimos por tipo (número 4x4, tabela ~6 de largura, padrão
  6x8), cada item `{id,x,y,w,h,minW,minH}`.
- Fuso: o automaster passa a ler o fuso da subconta (rota de `locations/<loc>` a mapear) antes
  de qualquer conferência; hoje não lê.
- Datas: fuso da subconta e o formato que a rota aceita. A agenda já mostrou que formato
  errado devolve lista vazia sem erro, o que viraria um "bate" falso.

## Testes

- Unitários: montagem da grade (sobreposição, largura, ordem) e comparador de números.
- Rotas novas no `smoke` e no cassete do CI (`test/fixtures/api-forma.json`).
- Prova ao vivo: na própria subconta de destino, como painel privado (decisão do grill). A
  primeira prova é na subconta da ZOI (`Xb9gDxwxYhdqtprGcb5E`): painel privado montado, passado
  nos dois loops e apagado no fim; o painel existente "Visão Geral das Vendas" só é lido.
- Versão do plugin sobe nas três frentes, com seção no `CHANGELOG.md`: 0.31.0, depois da
  0.30.0 que está no working tree. Contagens em teste sobem junto (`cli-comandos.test.ts`,
  `fila-escrita.test.ts`, lista de tools no `CLAUDE.md`, `plugin.json` e skill
  `automaster-leitura`). Texto novo evita as frases proibidas de
  `auditor/tests/test_sessao_de_fundo_docs.py` ("abre o Chrome" e afins).
- O guarda `extractor/test/sem-cliente-antigo.test.ts` proíbe perfil persistente em `src/`;
  o perfil de tela entra como exceção nomeada nesse teste, não como afrouxamento geral.

## Decisões do grill

- **A12** — print com perfil de tela e login próprio, nunca a sessão importada do processo de
  fundo. Motivo: decisão A45 e 4 de 24 quedas de login vindas de `/dashboard`.
- **A11** — print passa pela fila de escrita. Motivo: carregar a página grava
  `widget-preference` sozinho.
- **A6** — conferência ampliada com rotas novas: contatos, conversas, e-mail, ligações e Meta
  Ads, além de oportunidades e agenda. Motivo: o usuário quer os números conferidos, não
  marcados. Resto dos módulos fica `sem_conferencia`.
- **A7** — data de criação como padrão nos widgets de oportunidade. Motivo: recomendação
  oficial do GHL e causa conhecida de número que não bate.
- **A8** — degrau HTML/Embed fora desta entrega. Motivo: o GHL só aceita página externa por
  URL, o que exige hospedagem e decisão de privacidade próprias.
- **A2** — desfazer por versão incluído. Motivo: rota nativa já mapeada.
- **A3** — guarda de concorrência pela `version` nativa. Motivo: o PUT/DELETE já exigem.
- **A5** — número mostrado vem da rota de dados do widget, não do DOM. Motivo: rota observada ao
  vivo; DOM de gráfico ECharts não expõe barras como texto. Falta provar que o POST não grava.
- **A13** — ler o fuso da subconta antes de conferir. Motivo: o automaster não lê hoje.
- **A18** — módulo MCP `paineis.py`, versão 0.31.0. Motivo: `dashboard.py` já é o inventário.
- **Ciclo de vida** — todo painel nasce privado na subconta de destino e só é liberado depois
  dos dois loops, com `--confirmo`. Motivo: resposta do usuário sobre onde provar.
- **A10, A14, A15, A16, A17, A19** — registro, sem mudança de decisão (plano por subconta vira
  mensagem de erro clara; molde do painel existente; duplicar entre subcontas fica para
  depois; objetos de layout e checklist entram na skill).
