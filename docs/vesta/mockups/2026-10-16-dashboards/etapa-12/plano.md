# Etapa 12 — plano do painel da ZOI

Painel `ZZ TESTE AUTOMASTER painel ZOI` (`6ad2421cd7803e179ee56ca2`), privado, subconta Xb9g. Período padrão: últimos 30 dias;
os números comparam com os 30 anteriores. Público: dono e time. Tema: fundo `#FFFFFF`, títulos `#101828`,
números `#101828` (grafite/preto), barras e linhas `#b5ff81` (`baseColor`), `themeName: custom`.

Decisões da entrevista que viraram regra: venda = card ganho com valor; reunião realizada = status `showed`; anúncios
fixados na conta CA Zoi Pré-Pago (`act_589801984042614`); a seção Alertas sobe para logo depois do Resumo porque o dono
pediu que o trabalho atrasado "grite".

Total: 72 itens na grade, 58 widgets de dado, 14 títulos (cabeçalho + seções).

| Seção | Pergunta | Tipo | Widget (título) | Módulo e filtro | Data | Grade (x,y,w,h) |
|---|---|---|---|---|---|---|
| ZOI · Painel da empresa · últimos 30 dias, comparado aos 30 anteriores | — | — | object-title: ZOI · Painel da empresa · últimos 30 dias, comparado aos 30 anteriores | —: object-title | — | 0,0,12,1 |
| Resumo | — | — | object-title: Resumo | —: object-title | — | 0,1,12,1 |
| Resumo | Quanto faturamos? | quanto | numeric: Faturamento, data do ganho | crm-opportunities: oportunidades, 4 funis, ganho, soma do valor | fechamento | 0,2,3,3 |
| Resumo | Quantas reuniões aconteceram? | quanto | numeric: Reuniões realizadas | automation-appointments: agenda, status compareceu | data da reunião | 3,2,3,3 |
| Resumo | Quanto está em negociação? | quanto | numeric: Pipeline aberto em R$ (hoje) | crm-opportunities: oportunidades, 4 funis, aberto, soma do valor | até hoje | 6,2,3,3 |
| Resumo | Quantos leads entraram? | quanto | numeric: Leads novos | crm-contacts: contatos criados | criação | 9,2,3,3 |
| Alertas · trabalho atrasado | — | — | object-title: Alertas · trabalho atrasado | —: object-title | — | 0,5,12,1 |
| Alertas | Tem reunião sem desfecho? | quanto | numeric: Reuniões passadas sem desfecho | automation-appointments: agenda, status confirmada, data da reunião no período | data da reunião | 0,6,4,3 |
| Alertas | Tem card sem dono? | quanto | numeric: Cards abertos sem dono (hoje) | crm-opportunities: oportunidades, aberto, sem dono | até hoje | 4,6,4,3 |
| Alertas | Tem conversa esquecida? | quanto | numeric: Conversas sem dono, sem resposta | crm-conversations: conversas sem responsável, última mensagem do cliente | criação | 8,6,4,3 |
| Alertas | Onde o trabalho está acumulado? | quem é maior | horizontal_bar: Cards abertos por funil (estoque de hoje) | crm-opportunities: oportunidades abertas por funil | até hoje | 0,9,8,6 |
| Alertas | Em que canal está a fila? | parte de um todo | donut: Fila sem dono por canal | crm-conversations: conversas sem responsável, por canal | criação | 8,9,4,6 |
| Funil consolidado · lista → reunião → venda | — | — | object-title: Funil consolidado · lista → reunião → venda | —: object-title | — | 0,15,12,1 |
| Funil consolidado | Quanto entrou na lista? | quanto | numeric: 1 · Lista: cards criados | crm-opportunities: oportunidades, 4 funis | criação | 0,16,4,3 |
| Funil consolidado | Quanto virou reunião? | quanto | numeric: 2 · Reunião: reuniões marcadas | automation-appointments: agenda, todos os status | criação da reunião | 4,16,4,3 |
| Funil consolidado | Quanto virou venda? | quanto | numeric: 3 · Venda (data do fechamento) | crm-opportunities: oportunidades, 4 funis, ganho | fechamento | 8,16,4,3 |
| Funil consolidado | Como a lista evolui? | como evolui | line: Cards criados por dia nos 4 funis | crm-opportunities: oportunidades, 4 funis, por dia | criação | 0,19,8,7 |
| Funil consolidado | Por que perdemos? | parte de um todo | donut: Motivos de perda (data de perda) | crm-opportunities: oportunidades perdidas por motivo | mudança de status | 8,19,4,7 |
| 00 · Pipe de Vendas Geral | — | — | object-title: 00 · Pipe de Vendas Geral | —: object-title | — | 0,26,12,1 |
| 00 Pipe de Vendas Geral | Em que etapa estão os abertos? | em que etapa | horizontal_bar: 00 · Abertos por estágio (hoje) | crm-opportunities: funil 00, aberto, por estágio | até hoje | 0,27,6,7 |
| 00 Pipe de Vendas Geral | O que aconteceu com os novos? | parte de um todo | donut: 00 · Desfecho dos cards criados | crm-opportunities: funil 00, por status | criação | 6,27,6,7 |
| 01 · Reativação de Base | — | — | object-title: 01 · Reativação de Base | —: object-title | — | 0,34,12,1 |
| 01 Reativação de Base | Em que etapa estão os abertos? | em que etapa | horizontal_bar: 01 · Abertos por estágio (hoje) | crm-opportunities: funil 01, aberto, por estágio | até hoje | 0,35,6,7 |
| 01 Reativação de Base | O que aconteceu com os novos? | parte de um todo | donut: 01 · Desfecho dos cards criados | crm-opportunities: funil 01, por status | criação | 6,35,6,7 |
| 02 · Prospecção Ativa | — | — | object-title: 02 · Prospecção Ativa | —: object-title | — | 0,42,12,1 |
| 02 Prospecção Ativa | Em que etapa estão os abertos? | em que etapa | horizontal_bar: 02 · Abertos por estágio (hoje) | crm-opportunities: funil 02, aberto, por estágio | até hoje | 0,43,6,7 |
| 02 Prospecção Ativa | O que aconteceu com os novos? | parte de um todo | donut: 02 · Desfecho dos cards criados | crm-opportunities: funil 02, por status | criação | 6,43,6,7 |
| 03 · Iscas Digitais | — | — | object-title: 03 · Iscas Digitais | —: object-title | — | 0,50,12,1 |
| 03 Iscas Digitais | Em que etapa estão os abertos? | em que etapa | horizontal_bar: 03 · Abertos por estágio (hoje) | crm-opportunities: funil 03, aberto, por estágio | até hoje | 0,51,6,7 |
| 03 Iscas Digitais | O que aconteceu com os novos? | parte de um todo | donut: 03 · Desfecho dos cards criados | crm-opportunities: funil 03, por status | criação | 6,51,6,7 |
| Reuniões | — | — | object-title: Reuniões | —: object-title | — | 0,58,12,1 |
| Reuniões | Quantas reuniões no período? | quanto | numeric: Reuniões no período | automation-appointments: agenda, todos os status | data da reunião | 0,59,3,3 |
| Reuniões | Quantas aconteceram? | quanto | numeric: Realizadas (compareceu) | automation-appointments: status compareceu | data da reunião | 3,59,3,3 |
| Reuniões | Quantos faltaram? | quanto | numeric: No-show | automation-appointments: status no-show | data da reunião | 6,59,3,3 |
| Reuniões | Quantas caíram? | quanto | numeric: Canceladas | automation-appointments: status cancelada | data da reunião | 9,59,3,3 |
| Reuniões | Quem faz mais reunião? | quem é maior | horizontal_bar: Reuniões por pessoa | automation-appointments: agenda por responsável | data da reunião | 0,62,4,7 |
| Reuniões | De onde vêm as reuniões? | quem é maior | horizontal_bar: Reuniões por origem (calendário) | automation-appointments: agenda por calendário | data da reunião | 4,62,4,7 |
| Reuniões | Qual o desfecho? | parte de um todo | donut: Reuniões por status | automation-appointments: agenda por status | data da reunião | 8,62,4,7 |
| Ligações | — | — | object-title: Ligações | —: object-title | — | 0,69,12,1 |
| Ligações | Quanto o time ligou? | quanto | numeric: Ligações feitas | revex-calls: saindo | data da ligação | 0,70,3,3 |
| Ligações | Quantas foram atendidas? | quanto | numeric: Ligações atendidas | revex-calls: saindo, atendida | data da ligação | 3,70,3,3 |
| Ligações | Quanto dura uma ligação? | quanto | numeric: Duração média (s) | revex-calls: saindo, média da duração | data da ligação | 6,70,3,3 |
| Ligações | Quantas ninguém atendeu? | quanto | numeric: Ligações não atendidas | revex-calls: saindo, sem resposta | data da ligação | 9,70,3,3 |
| Ligações | O time liga todo dia? | como evolui | line: Ligações feitas por dia | revex-calls: saindo, por dia | data da ligação | 0,73,8,7 |
| Ligações | Com que resultado? | parte de um todo | donut: Status das ligações feitas | revex-calls: saindo, por status | data da ligação | 8,73,4,7 |
| Ligações | Quem conversa mais tempo? | quem é maior | horizontal_bar: Duração média por pessoa (s) | revex-calls: saindo, média por quem ligou | data da ligação | 0,80,6,7 |
| Ligações | Quem liga mais? | quem é maior | horizontal_bar: Ligações por pessoa (N/A = sem dono) | revex-calls: saindo, por quem ligou | data da ligação | 6,80,6,7 |
| Atendimento | — | — | object-title: Atendimento | —: object-title | — | 0,87,12,1 |
| Atendimento | Respondemos no prazo? | quanto | numeric: Respondidas no prazo (SLA) | crm-conversations-sla: SLA cumprido, % | chegada da mensagem | 0,88,3,3 |
| Atendimento | Quantas estouraram? | quanto | numeric: Fora do prazo (SLA) | crm-conversations-sla: SLA estourado, % | chegada da mensagem | 3,88,3,3 |
| Atendimento | Quanto demoramos? | quanto | numeric: Tempo médio de resposta | crm-conversations-sla: média do tempo de resposta | chegada da mensagem | 6,88,3,3 |
| Atendimento | Quanto está sem ler? | quanto | numeric: Conversas não lidas | crm-conversations: conversas não lidas | criação | 9,88,3,3 |
| Atendimento | O prazo melhora? | como evolui | line: Respondidas no prazo por dia (SLA) | crm-conversations-sla: SLA cumprido por dia | chegada da mensagem | 0,91,12,8 |
| Atendimento | Quem cumpre o prazo? | quais são | table: SLA por pessoa | crm-conversations-sla: SLA por responsável e canal | chegada da mensagem | 0,99,12,7 |
| Origem e tráfego | — | — | object-title: Origem e tráfego | —: object-title | — | 0,106,12,1 |
| Origem e tráfego | De onde vêm os leads? | quem é maior | horizontal_bar: Leads novos por fonte (N/A = sem fonte) | crm-contacts: contatos por fonte | criação | 0,107,6,7 |
| Origem e tráfego | De onde vêm os cards? | quem é maior | horizontal_bar: Cards criados por fonte (N/A = sem fonte) | crm-opportunities: oportunidades por fonte | criação | 6,107,6,7 |
| Origem e tráfego | Qual campanha traz card? | parte de um todo | donut: Cards por campanha | crm-opportunities: oportunidades por Campanha | criação | 0,114,4,6 |
| Origem e tráfego | Qual público traz card? | parte de um todo | donut: Cards por público | crm-opportunities: oportunidades por Público | criação | 4,114,4,6 |
| Origem e tráfego | Qual criativo traz card? | parte de um todo | donut: Cards por criativo | crm-opportunities: oportunidades por Anúncio (criativo) | criação | 8,114,4,6 |
| Anúncios · CA Zoi Pré-Pago | — | — | object-title: Anúncios · CA Zoi Pré-Pago | —: object-title | — | 0,120,12,1 |
| Anúncios | Quanto investimos? | quanto | numeric: Investimento | automation-admanager-fb-ads: conta CA Zoi Pré-Pago | dia do anúncio | 0,121,3,3 |
| Anúncios | Quantos leads o anúncio trouxe? | quanto | numeric: Leads do anúncio | automation-admanager-fb-ads: conta CA Zoi Pré-Pago, conversões | dia do anúncio | 3,121,3,3 |
| Anúncios | Quanto custa um lead? | quanto | numeric: Custo por lead (R$) | automation-admanager-fb-ads: conta CA Zoi Pré-Pago, custo por conversão | dia do anúncio | 6,121,3,3 |
| Anúncios | Quantos clicaram? | quanto | numeric: Cliques | automation-admanager-fb-ads: conta CA Zoi Pré-Pago | dia do anúncio | 9,121,3,3 |
| Anúncios | Tem dia sem lead? | como evolui | line: Leads do Facebook por dia (a linha para no último lead) | crm-contacts: contatos com fonte "Facebook" (lead gen), por dia | criação | 0,124,8,7 |
| Anúncios | Onde vai o dinheiro? | quem é maior | horizontal_bar: Investimento por campanha | automation-admanager-fb-ads: conta CA Zoi Pré-Pago, por campanha | dia do anúncio | 8,124,4,7 |
| Iscas e curso · da inscrição à venda | — | — | object-title: Iscas e curso · da inscrição à venda | —: object-title | — | 0,131,12,1 |
| Iscas e curso | Quantos se inscreveram? | quanto | numeric: Inscrições no curso | crm-contacts: contatos com fonte "Forms / Curso Zoi" | criação | 0,132,4,3 |
| Iscas e curso | A isca vira reunião? | quanto | numeric: Reuniões do calendário Iscas | automation-appointments: agenda, calendário Iscas Digitais | data da reunião | 4,132,4,3 |
| Iscas e curso | A isca vira venda? | quanto | numeric: Vendas 03 (data do fechamento) | crm-opportunities: funil 03, ganho | fechamento | 8,132,4,3 |
| Iscas e curso | As inscrições seguem chegando? | como evolui | line: Inscrições no curso por dia | crm-contacts: contatos com fonte "Forms / Curso Zoi", por dia | criação | 0,135,12,6 |
