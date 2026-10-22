# Verificação da etapa 6 — peças visuais do manual

Página verificada: `modelo.html` com o `zoi.css` injetado no marcador e a capa do mockup no lugar de
`{{CAPA}}`, servida por HTTP local. É a mesma composição que o gerador da etapa 7 vai montar.

## Rodada 1

- Prints: `r1-375.png` e `r1-1440.png`. Igual ao mockup aprovado, seção por seção.
- Detector: 0 alarmes em 375 e em 1440.
- Console: sem erro. Fontes Clash Display (500, 600, 700) e Satoshi (400, 700) carregadas.
- Rolagem horizontal: nenhuma (largura do documento igual à da janela nas duas medidas).
- Corpo 16px com entrelinha 1.55; lead 18px.
- Contraste: os mesmos tokens da rodada 3 do mockup (`../relatorio.md`), menor par 4.65.

## Piso

Igual ao relatório do mockup (`../relatorio.md`, seção Piso): nenhum item mudou de resultado, porque o
CSS é o mesmo do mockup aprovado e o corpo é o mesmo, com comentários a mais.
