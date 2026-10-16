# Etapa 12: relatório do painel da ZOI refeito

- Subconta Xb9gDxwxYhdqtprGcb5E (ZOI), em 2026-10-16.
- Painel `6ad2421cd7803e179ee56ca2`, `ZZ TESTE AUTOMASTER painel ZOI`. Continua **privado**, está em `__v` 25 e não foi publicado.
- O painel real `66a8d9e97ec41f7c8672c320` e os painéis "Pipe de Vendas", "Prospecção ativa", "Cursos" e "– Clonar" foram só lidos, para servir de molde (`object-title`, ligações, campos Campanha/Público/Criativo).
- Caminho usado: a CLI `dashboard-acao editar`, sempre com prévia e depois `--confirmo --versao-esperada`, em 4 lotes de criação, uma atualização dos títulos e 3 correções. Em seguida, `tema`.
- O processo de fundo estava logado antes e depois (`rodando: true`, `esperandoLogin: false`).

## Plano (resumo; a tabela completa está em `plano.md`)

São 72 itens na grade: **58 widgets de dado** e 14 títulos (o cabeçalho e 13 seções), com altura total de 141 linhas.

| Seção | Conteúdo |
|---|---|
| Cabeçalho | "ZOI · Painel da empresa · últimos 30 dias, comparado aos 30 anteriores" |
| Resumo | 4 números de 3x3: faturamento (ganhos pela data do ganho), reuniões realizadas (`showed`), pipeline aberto em R$ (até hoje) e leads novos |
| Alertas · trabalho atrasado | reuniões passadas sem desfecho (confirmadas com data no período), cards abertos sem dono, conversas sem dono e sem resposta, cards abertos por funil (estoque) e fila sem dono por canal |
| Funil consolidado | régua com 3 números (lista: cards criados → reunião: reuniões marcadas → venda: ganhos), linha de cards criados por dia e donut com os motivos de perda |
| 00, 01, 02 e 03 (uma seção por funil) | barra de abertos por estágio (até hoje) e donut com o desfecho dos cards criados |
| Reuniões | 4 números (no período, realizadas, no-show, canceladas) e 3 gráficos: por pessoa, por origem (calendário) e por status |
| Ligações | 4 números (feitas, atendidas, duração média, não atendidas), linha por dia, donut de status, duração média por pessoa e ligações por pessoa (N/A = sem dono) |
| Atendimento | 4 números (no prazo %, fora do prazo %, tempo médio de resposta, não lidas), linha do SLA por dia e tabela do SLA por pessoa e canal |
| Origem e tráfego | leads por fonte, cards por fonte e 3 donuts: campanha, público e criativo (os campos de oportunidade) |
| Anúncios · CA Zoi Pré-Pago | conta `act_589801984042614` fixada: investimento, leads, custo por lead, cliques, leads do Facebook por dia e investimento por campanha |
| Iscas e curso | inscrições no curso, reuniões do calendário Iscas, vendas do funil 03 e inscrições por dia |

Tema: `themeName: custom`, fundo `#FFFFFF`, títulos e números `#101828`, link `#101828`, barras e linhas `#b5ff81` (`baseColor`).
Os títulos de seção usam `object-title` com fundo `#F2F4F7`, e o cabeçalho usa fundo branco.

Mudei uma coisa em relação à ordem da entrevista: a seção Alertas subiu para logo depois do Resumo. O dono pediu que o trabalho atrasado "grite", e no fim de um painel de 141 linhas ninguém ia ver.

## Voltas do loop visual (`dashboard-ver`, 1440 de largura, 72 de 72 widgets renderizados)

| Volta | PNG | O que falhou | O que corrigi |
|---|---|---|---|
| 1 | `volta-1.png` | o título "Faturamento (data do fechame…" saía cortado; a tabela do SLA mostrava "Erro ao carregar dados" (faltava `tableProperties`); a linha de leads do anúncio vinha vazia, porque o módulo fb-ads recusa série no tempo (422); "Custo por lead" aparecia sem unidade; e os 3 donuts de tráfego tinham altura sobrando | título "Faturamento, data do ganho"; `tableProperties` copiado do catálogo; a linha passou a ser de contatos com fonte "Facebook" por dia; "Custo por lead (R$)"; donuts com altura 6 |
| 2 | `volta-2.png` | a tabela do SLA passou a carregar, mas ficou maior que a tendência da seção; e o título "zero = dia sem lead" estava errado, porque a linha não preenche zero depois do último lead | linha do SLA em 12 colunas; novo título "(a linha para no último lead)" |
| 3 | `volta-3.png` | a tabela com 8 colunas de largura cortava a 5ª coluna e criava rolagem interna (regressão da volta 3) | tabela de volta para 12 colunas; linha do SLA com 12x8; a fila sem dono por canal foi para Alertas, ao lado do estoque por funil (8 + 4) |
| 4 | `volta-4.png` (final) | só confirmou a correção da volta 3; nada novo falhou | — |

A volta 4 passou do limite de 3. Ela só existiu para confirmar a correção de uma regressão que a própria volta 3 criou.

## Checklist final (volta 4)

- [x] Nenhum widget vazio onde deveria haver dado. Os zeros são reais: não lidas 0, reuniões do calendário Iscas 0 (a leitura também deu zero) e vendas do 03 = 0.
- [x] Nenhum título ou número cortado. Os **rótulos de categoria** saem girados e truncados nas barras ("Felipe Remo…") e nas legendas dos donuts ("Desqualific…"). É o desenho do GHL, e o painel real tem o mesmo problema (veja `abas/referencia-ghl-atual.png`).
- [x] Os números do topo estão alinhados na mesma linha.
- [x] São 4 números no topo, com altura 3.
- [x] A tendência é o maior bloco da sua seção: Funil consolidado 56 contra 28, Ligações 56 contra 42, Atendimento 96 contra 84, Anúncios 56 contra 28 e Iscas 72 contra 12.
- [x] Contraste do texto: `#101828` sobre `#FFFFFF` dá 17,7:1. Ressalva: as barras `#b5ff81` sobre o branco ficam em cerca de 1,2:1, abaixo dos 3:1 de elemento gráfico (WCAG 1.4.11). É a cor que o usuário pediu, e cada barra tem o eixo com o valor.
- [x] As séries são distinguíveis. Cada gráfico tem uma série só, e os donuts têm legenda com o rótulo e o valor, então não dependem só da cor.
- [x] Sem rolagem interna e sem rolagem lateral (`scrollWidth` 1440; a tabela ocupa 12 colunas).
- [x] A pergunta principal (faturamento) está em cima à esquerda.
- [x] Pelo menos 12 widgets: são 58 de dado, cobrindo funil, agenda, ligações, atendimento, origem, anúncios e isca.
- [x] Espaçamento uniforme e grade sem buraco (o validador não acusou `buraco` em nenhuma prévia).
- [x] Cabeçalho no topo, com o título e o período.
- [x] As 13 seções abrem com um `object-title` de largura 12.
- [x] Larguras repetidas por linha: 4x3, 3x4, 8+4, 6+6 e 12.
- [x] Hierarquia: resumo e alertas no topo, detalhe embaixo.

## Verificação de tela da Vesta (rodada 1)

- Prints: `r1-1440.png` e `r1-375.png`, tirados do perfil de tela com a sessão salva importada, pela fila de escrita, com o painel inteiro.
- Detector: rodei a reserva `detect-antipatterns-browser.js` dentro da página do GHL. O `detectar` direto não serve porque abriria a URL sem login. A saída passou por `filtrar.py` e está em `r1-detector-1440.json` (89 elementos) e `r1-detector-375.json` (91). A reserva perde 4 regras de texto.
- O que os alarmes acusam e por que não são do painel:
  - `layout-transition` (76), `clipped-overflow-container` (4 e 5), `undersized-ui-text` (6), `text-occlusion` (1), `bounce-easing` (1) e `marquee` (1) vêm de seletores da casca do app do GHL: `#app`, `#sidebar-v2`, `.pmd-app__side-dock-main-surface`, `.navigation-title` ("Recentes", "Contatos"), o selo "Beta" do menu, `.app-shell-bar::after` e `div.grid-stack` (a grade do próprio GHL). Nenhum vem de configuração do painel, e o painel não tem como mudar nenhum deles.
  - `low-contrast` (2): são os rótulos "Anterior" e "Seguinte" da paginação da tabela do SLA, `#d0d5dd` sobre `#ffffff` (1,5:1). Lidos na página: `color rgb(208,213,221)`, fundo `rgb(255,255,255)` e `button.disabled = true`. Botão inativo fica fora do 1.4.3 da WCAG, e a tabela tem 1 página só. O recorte está em `r1-prova-paginacao-desabilitada.png`.
  - `body-text-viewport-edge` (2, só em 375): os títulos de seção encostam na borda porque o GHL não refaz a grade em 375 e mantém a barra lateral.
- Mobile não é alvo: o painel é sempre visto no computador. O 375 é só a prova exigida. O GHL não tem layout de celular para o painel, só espreme as colunas.
- Console, Lighthouse e trace não rodaram. A página é do GHL e não é uma tela nossa servida localmente.

## Conferência (`conferencia.json`, janela de 30 dias)

Resumo: **bate 15, diverge 2, sem_conferencia 55**. Dos 55, 14 são títulos sem número.

Os dois `diverge` têm causa, e as duas são da ferramenta, não do filtro do widget:

| Widget | GHL | Recontagem | Causa |
|---|---|---|---|
| Ligações não atendidas | 609 | 0 | A rota de resumo de ligações devolve o rótulo `No answer`, mas `ROTULO_STATUS` (`extractor/src/api/dashboards-conferir.ts:235`) só traduz `Missed` para `no-answer`. A recontagem tem os 609 com a chave errada. |
| Status das ligações feitas | 1968 | 1968 | Mesmo problema, com `No answer` (609) e `Busy` (6): os totais por status batem, só as chaves não casam. |

O conserto é acrescentar `"No answer": "no-answer"` e `"Busy": "busy"` ao `ROTULO_STATUS`. Não mexi no código porque esta etapa proíbe.

Dois `bate` não valem para o que a tela mostra:

- **Pipeline aberto em R$ (hoje)**: bate em 0 = 0, mas a tela mostra R$ 392,33 mil.
- **Cards abertos por funil**: bate em 429 = 429, mas a tela mostra o estoque inteiro (cerca de 3.460 no 02).

Os dois widgets usam `dateRangeOverride: till_date`, e a conferência recorta os 30 dias sem respeitar esse override. Não é número do GHL errado: é uma lacuna da conferência.

O que ficou `sem_conferencia`: agenda por `startTime` (as 10 de reunião); `not_exists`; `avg`; agrupamento por estágio, por campo personalizado, por `userId` e por série no tempo; SLA (fonte ainda não implementada); condição `source eq`; e os anúncios do Meta (sem `AUTOMASTER_META_TOKEN`).

## Limitações: o que o catálogo do GHL não oferece das respostas do usuário

1. **Cards parados há mais de 30 dias:** o módulo de oportunidades não tem data de "última mudança de estágio" nem filtro "há mais de N dias" (as datas são criação, atualização e mudança de status, sempre com faixa relativa até hoje). Usei o estoque aberto por funil (Alertas) e por estágio (seção de cada funil). Não é o "parado há mais de 30 dias".
2. **Ligações com mais de 60 s:** o módulo de ligações não filtra por duração. Entraram a duração média geral e a média por pessoa.
3. **Ligações sem dono:** `userId` não aceita "está vazio". O sem dono aparece como `N/A` na barra de ligações por pessoa.
4. **Ligações por dia por pessoa:** a linha agrupada por pessoa dá 400. Ficaram separadas a linha por dia (total) e a barra por pessoa.
5. **Dias sem lead do anúncio:** os widgets de fb-ads não aceitam série no tempo (422 `filter_validation_error`). Usei os contatos com fonte "Facebook" por dia, e a linha para no último lead (18/09). O custo por lead sai sem o símbolo R$ (formato do GHL); por isso o título diz "(R$)".
6. **Inscrições na survey "Forms / Curso Zoi":** não existe módulo de formulário nem de survey no catálogo. Usei os contatos novos com fonte "Forms / Curso Zoi" (7 em 30 dias). Quem já era contato e se inscreveu não entra, e a leitura contou 12 envios. Também não existe ligação de reunião com origem isca: o calendário "Iscas Digitais" tem zero reuniões, e a reunião de quem veio da isca cai no calendário do Felipe.
7. **Régua consolidada lista → reunião → venda:** não existe widget que cruze módulos. A régua são 3 números lado a lado, sem a taxa entre as etapas. O widget custom "Funnel" escolhe o funil dentro do próprio widget, e essa escolha não aparece no detalhe pela API, então não entrou.
8. **Estágio sem filtro de funil:** agrupado por estágio sem filtrar o funil, o GHL mostra o id cru do estágio. Por isso o estágio só aparece dentro da seção de cada funil.
9. O GHL corta os rótulos das barras e das legendas e deixa em inglês o cabeçalho da tabela do SLA ("User", "SLA met %") e o `__unassigned__`. Nada disso se configura pelo widget.
10. Pela ferramenta: o `criar` não copia `objectWidgetOptions` (falta em `CAMPOS_WIDGET_NOVO`, `extractor/src/cli/dashboards.ts:173`). Sem isso, o título de seção nasce sem texto configurado. Contornei com um `atualizar` logo depois, e o detalhe relido confirma a gravação. Não houve BLOCKED.

## Decisão do usuário

Pendente. O usuário precisa ver o painel no GHL (`https://app.gohighlevel.com/v2/location/Xb9gDxwxYhdqtprGcb5E/dashboard/6ad2421cd7803e179ee56ca2`) e aprovar ou pedir ajuste.
