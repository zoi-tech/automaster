# Etapa 10 — plano do painel `ZZ TESTE AUTOMASTER painel ZOI`

Subconta Xb9gDxwxYhdqtprGcb5E (ZOI). Entrevista: o dono olha todo dia no computador; perguntas, em
ordem: quanto vendemos (principal), quantos leads novos, quantas reuniões marcamos, de onde vêm os
leads. Período: últimos 30 dias contra os 30 anteriores (`comparisonDateProperty: previous_x_days`
nos números). Cores: verde ZOI sobre grafite escuro.

| # | Pergunta | Tipo | Widget | Módulo e filtro | Data | Grade (x,y,l,a) |
|---|---|---|---|---|---|---|
| 1 | Quanto vendemos? (principal) | quanto | número: Valor fechado em 30 dias | oportunidades, soma de `monetary_value`, status = won, funil 00 Pipe de Vendas Geral | fechamento (`last_status_change_date`) | 0,0,3,4 |
| 2 | Quanto vendemos? | quanto | número: Vendas fechadas em 30 dias | oportunidades, contagem, status = won, funil 00 | fechamento (`last_status_change_date`) | 3,0,3,4 |
| 3 | Quantos leads novos? | quanto | número: Leads novos nos últimos 30 dias | contatos, contagem | criação | 6,0,3,4 |
| 4 | Quantas reuniões marcamos? | quanto | número: Reuniões marcadas nos últimos 30 dias | agenda, contagem, todos os calendários | criação do agendamento | 9,0,3,4 |
| 5 | Quantos leads novos? | como evolui | linha: Leads novos por dia, últimos 30 dias | contatos, série diária | criação | 0,4,12,7 |
| 6 | De onde vêm os leads? | quem é maior (top 10) | barra horizontal: De onde vêm os leads nos últimos 30 dias | oportunidades, todos os funis, agrupado por `source` | criação | 0,11,12,6 |

Composição (final, depois da volta 3): 4 números no topo, a linha é o maior bloco (12x7 = 84 células contra 12x6 = 72 da barra),
6 blocos, grade sem buraco, a principal em cima à esquerda, a ordem da entrevista vira a posição.

Moldes: números de oportunidade e a barra copiam `Oportunidades por Fontes`/`Vendas por Fontes` do
painel real `66a8d9e97ec41f7c8672c320` (só lido); agenda copia `Contagem de compromissos
comparecidos`; contatos copia o widget `crm-contacts` gravado na etapa 6 (rastro
`_dashboards/.../6ad239f0dcd26a9062759626/2026-10-16_115213.json`).

Data: criação por padrão; nos widgets 1 e 2 é a data do fechamento, por decisão do usuário ("quanto vendemos"
quer as vendas fechadas na janela, não as de leads criados nela). O título diz "fechado(as)".

Tema: fundo `#1C1F24` (grafite), números `#B5FF81`, títulos `#F2F4F7`, base `#B5FF81`, link `#B5FF81`.
