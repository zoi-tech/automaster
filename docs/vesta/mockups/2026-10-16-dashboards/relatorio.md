# Relatório — mockup de painéis (rodada 3)

Tipo de tela: Operar. Tela existente (página de dashboard do GHL), modo direto, uma direção, no
estilo do GHL. Prints: `r3-375.png`, `r3-1440.png` (aba da clínica) e `abas/<largura>-<aba>.png`
para as seis abas. Referência do estilo atual: `abas/referencia-ghl-atual.png`.

Respostas deduzidas: VARIACAO 3, MOVIMENTO 1, DENSIDADE 6; tema de cada painel pelo
`themeConfig` do cliente; tipografia e cinzas do próprio GHL.

## Rodadas

- r1: abas não trocavam por hash no print; seta verde com número negativo; total do donut
  diferente do número de consultas; rótulo do eixo cortado no gráfico de linha; números
  escondidos dentro de barras curtas do funil no celular; tabela cortando coluna no celular.
- r2: rótulos de barra truncados em 5 colunas; widgets de funil e barra altos demais para o
  conteúdo; tabela espremida no celular.
- r3: medido em script nas 6 abas e 2 larguras: sem rolagem lateral, nenhum título cortado,
  nenhum widget transbordando, console sem erro.

## Piso

| id | resultado |
|---|---|
| SLOP-02, 10, 11, 21, 22, 37, 44, 49 | passou |
| SLOP-46 | passou: dados de exemplo rotulados por cliente fictício |
| TIP-01 | refutado: o GHL usa Inter na página de dashboard (`abas/referencia-ghl-atual.png`); tela existente segue o estilo dela |
| TIP-12 | passou no texto corrido (16px); rótulos de widget em 13–14px reproduzem o GHL |
| TIP-20, TIP-21, TIP-22 | passou (`tnum` no body, `display=swap`) |
| COR-02, 12, 13, 15, 16, 18 | passou; COR-16: variação também por seta e sinal; COR-18 n/a (GHL sem modo escuro no painel) |
| LAY-03, 22, 26, 31 | passou (abas com 44px de altura) |
| MOV-02, 03, 05, 09, 10, 23 | passou (só escala no clique da aba, desligada em reduced-motion) |
| UX-01 | abas com padrão, hover, foco, pressionado e selecionado; o resto é estático |
| UX-08, 11, 12, 14, 15, 16, 26 | n/a (mockup sem formulário nem ação destrutiva) |
| UX-20 | passou: abas por Tab e setas |

## Detector

`r3-detector-375.json` e `r3-detector-1440.json`: um alarme, `overused-font` (Inter). Refutado
acima (TIP-01).
