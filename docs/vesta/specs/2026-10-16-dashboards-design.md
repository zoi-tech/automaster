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
  (relatório/widget customizável dentro do próprio GHL); HTML embutido só quando a informação
  não sai por nenhum dos dois anteriores. Usar HTML exige dizer, no resultado, qual informação
  forçou o degrau.
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
  - `dashboard-ver` — abre o dashboard num Chrome com perfil próprio usando a sessão de
    `~/.automaster/sessao/estado-ghl.json` (nunca o perfil do processo de fundo, decisão A45)
    e salva PNG em `~/.automaster/dumps/_dashboards/<loc>/<dashboardId>/<ts>.png`.
- Saída `--json` no envelope de sempre (`emitir`/`falhar`).

Auditor, servidor MCP (`auditor/src/automaster_audit/mcp/dashboards.py`), quatro tools:

- `dashboards` — leitura;
- `dashboard_acao` — criar, editar layout e widgets, duplicar, apagar;
- `dashboard_ver` — devolve o caminho do screenshot para o Claude olhar;
- `dashboard_conferir` — validação dos números (ver abaixo).

Skill `skills/automaster-dashboard/`: o que é design e processo. Grade e hierarquia
(números-chave em cima, funil e tendência no meio, tabelas embaixo), nomes de widget, cores,
a escada de widgets, e os dois loops.

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

`dashboard_conferir` pega, para cada widget, o número que o GHL mostra (pela rota de dados do
widget se existir; senão, do DOM da página capturada) e recalcula pelas rotas que o automaster
já tem (oportunidades, agenda, contatos, conversas) com o mesmo filtro: período, funil,
usuário, fuso da subconta. Resultado por widget: `bate`, `diverge` (com os dois números) ou
`sem_conferencia` (widget sem rota independente que reproduza o número).

Divergência é achado. O loop corrige o filtro do widget quando o filtro está errado; nunca
ajusta o número para bater.

## Erros e guardas

- Prévia antes de gravar, como em `workflow-editar`.
- Guarda de concorrência: se o dashboard mudou entre prévia e gravação, recusa.
- Apagar exige `--confirmo` e nunca toca no dashboard padrão da subconta.
- Layout com widget sobreposto ou fora da grade é recusado localmente, antes do request.
- Datas: fuso da subconta e o formato que a rota aceita. A agenda já mostrou que formato
  errado devolve lista vazia sem erro, o que viraria um "bate" falso.

## Testes

- Unitários: montagem da grade (sobreposição, largura, ordem) e comparador de números.
- Rotas novas no `smoke` e no cassete do CI (`test/fixtures/api-forma.json`).
- Prova ao vivo: dashboard descartável criado, passado nos dois loops e apagado na subconta de
  teste, sem resíduo.
- Versão do plugin sobe nas três frentes, com seção no `CHANGELOG.md`.
