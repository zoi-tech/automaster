# Etapa 10 — relatório da prova ponta a ponta

- Subconta: Xb9gDxwxYhdqtprGcb5E (ZOI). Em 2026-10-16.
- Painel: `6ad2421cd7803e179ee56ca2`, `ZZ TESTE AUTOMASTER painel ZOI`, **privado**, `__v` 6. Não publicado.
- Caminho: funções do servidor MCP (`dashboard_acao`, `dashboard_ver`, `dashboard_conferir`, `dashboards`)
  chamadas em Python. O painel real `66a8d9e97ec41f7c8672c320` só foi lido (moldes).
- Plano: `plano.md`. Tem 6 blocos: 4 números (valor fechado, vendas fechadas, leads novos e reuniões
  marcadas), a linha de leads novos por dia e a barra horizontal de origem dos leads.
- Processo de fundo logado antes e depois (`rodando: true`, `esperandoLogin: false`).

## Montagem

1. `criar` (confirmo): painel privado vazio.
2. `editar` com 6 widgets novos. Na prévia, `titulo_longo` em 3 números, então encurtei os títulos.
   Depois a prévia veio limpa e gravei com `versao_esperada` 0.
3. `tema`: fundo `#1C1F24`, números `#B5FF81`, títulos `#F2F4F7`, base e link `#B5FF81`. Contraste
   do número com o fundo dá 13,8:1 e o do título com o fundo 15,0:1.
4. Decisão do usuário: os dois números de venda passam a usar a data do fechamento
   (`dateProperty: last_status_change_date`). Mudei por `atualizar` com o widget inteiro, e o
   detalhe relido confirma a mudança.

## Voltas do loop visual

| Volta | PNG | O que falhou | Correção |
|---|---|---|---|
| 1 | `volta-1.png` | título "Vendas fechadas, últimos 30 d" cortado; linha e barra com altura sobrando | títulos "Valor fechado em 30 dias" e "Vendas fechadas em 30 dias"; gráficos com 7 de altura |
| 2 | `volta-2.png` | na barra (5 colunas) os nomes das origens saem girados e cortados | linha 12x7 e barra 12x6 em largura cheia |
| 3 | `volta-3.png` (final) | os nomes da barra continuam cortados ("Lista Claro…") | não fechou, veja abaixo |

A troca de captura (antes do conserto `ab5fbd8`) gravou o painel padrão no lugar deste. Aquelas
imagens não contam como volta.

## Checklist final (volta 3)

- [x] Nenhum widget vazio. Os R$0 e 0 de vendas fechadas são reais, e a recontagem também deu 0.
- [ ] Nada cortado. Títulos e números passam, mas o GHL corta os nomes das categorias da barra
      horizontal mesmo em 12 colunas. É o desenho do gráfico e o painel não tem como mudar isso.
- [x] Números do topo alinhados na mesma linha.
- [x] No máximo 4 números no topo.
- [x] A tendência é o maior bloco (84 contra 72 células).
- [x] Contraste de título e número ≥ 4,5:1. Os rótulos dos eixos, que o GHL desenha em cinza,
      ficam baixos sobre o grafite e não se mudam pelo tema.
- [x] Séries distinguíveis: cada gráfico tem uma série só.
- [x] Sem rolagem interna e sem rolagem lateral (largura 1440).
- [x] A pergunta principal (valor fechado) em cima à esquerda.
- [x] No máximo 8 blocos (6).
- [x] Espaçamento uniforme, grade sem buraco.

## Conferência dos números (`conferencia.json`, janela de 30 dias)

Resumo: **bate 5, diverge 0, sem_conferencia 1**.

| Widget | Resultado | GHL | Recontagem |
|---|---|---|---|
| Valor fechado em 30 dias | bate | R$ 0 | R$ 0 |
| Vendas fechadas em 30 dias | bate | 0 | 0 |
| Leads novos em 30 dias | bate | 509 | 509 |
| Reuniões marcadas em 30 dias | bate | 49 | 49 |
| De onde vêm os leads | bate | 447 (8 origens) | 447, mesmas 8 |
| Leads novos por dia | sem_conferencia | — | série de tempo sem recontagem (`agrupamento sem recontagem: date_added`) |

A tela mostrou 512 leads novos e a conferência, minutos depois, 509 dos dois lados. A janela da
conferência termina "agora", e no meio desse tempo houve contatos apagados ou mesclados. Não é
divergência: GHL e recontagem foram lidos no mesmo instante e bateram.

Nenhuma venda no funil 00 foi fechada como ganha nos últimos 30 dias. A recontagem independente
pelos cards confirma o zero.

## Limitações e achados da ferramenta

1. **Período padrão do painel:** este painel abriu em "Últimos 30 dias", então o dono vê o que
   pediu. A comparação com os 30 anteriores está em cada número (`previous_x_days`). O
   2026-01-01..06-30 é o período salvo do painel real, não deste. Nenhuma ação da ferramenta
   define o período padrão nem o filtro rápido de um painel; se um dia for preciso, o
   `dashboardPreferences` do detalhe é o lugar a investigar.
2. **themeName:** a ação `tema` recusa `themeName: "custom"` (`cor_invalida`), porque a checagem
   de hex passa por todas as chaves. Sem ele o painel ficou com `themeName: "none"`. Os cartões
   pegaram fundo, título e número, mas linha e barra seguem no azul padrão do GHL e não no verde
   de `baseColor`, ao contrário do painel real, que tem `themeName: "custom"`. Para corrigir, a
   checagem de hex precisa ignorar `themeName` (`extractor/src/cli/dashboards.ts`, ação `tema`).
   Depois disso é reaplicar o tema. **Corrigido na sessão principal:** a checagem passou a valer só
   para chaves `*Color`; o tema foi reaplicado com `themeName: "custom"` e linha e barra ficaram no
   verde ZOI (`volta-4.png`, o PNG final).
3. **Avisos da prévia no `atualizar`:** `data_nao_dita_no_titulo` e `titulo_longo` usam o título
   antigo do widget, não o que vem no `atualizar`. Além disso o aviso exige a palavra "data" no
   título, mas "fechado(as)" já diz qual data é. Como são só avisos, não bloquearam nada.
4. A barra horizontal corta os nomes das origens (veja o checklist).

## Decisão do usuário

O usuário viu o painel no GHL e reprovou o resultado: quadros de número grandes demais, painel simplório e feio, fundo escuro. Pediu painéis bem mais completos, fundo branco por padrão, nunca perguntar o dispositivo (é sempre computador) e uma entrevista estilo grill a partir da leitura da subconta. O painel segue privado e é refeito nas etapas 11 e 12. Nada foi publicado.
