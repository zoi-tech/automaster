# Verificação da etapa 10 — ajustes do zoi.css

Mudanças de tela: tabela com `width: calc(100% - 1px)` (a borda direita aparecia cortada no PDF) e o
layout de celular só em `@media screen` (a impressão herdava o empilhamento de celular e a medição
de seção acusava estouro falso).

## Rodada 1

- Prints `r1-375.png` e `r1-1440.png`: na tela, iguais à etapa 6; em 375 o layout continua empilhando.
- Detector: 0 alarmes em 375 e em 1440. Console sem erro. Sem rolagem horizontal.
- PDF do modelo pelo `manual-pdf`: 8 páginas, nenhuma seção estourada, nenhum termo interno, nenhum
  aviso; a borda direita das tabelas aparece (página 5).

## Piso

Sem mudança em relação a `../relatorio.md`: cores, fontes e espaçamento são os mesmos.
