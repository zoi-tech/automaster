# Verificação do mockup — manual do cliente

URL: `http://127.0.0.1:8765/index.html` (pasta servida por HTTP local). Tipo de tela: Ler.
Direção única no estilo existente (padrão ZOI do MD Converter e do manual entregue à subconta A).

Ferramentas: prints e PDF de impressão pelo Playwright do extractor com o Chrome do sistema; CSS
computado, fontes carregadas e console lidos por `page.evaluate` e eventos da página (o MCP do
Chrome DevTools não estava conectado nesta sessão); detector `ferramentas/impeccable/detectar`.
Lighthouse e trace de desempenho não rodaram (dependem do Chrome DevTools); contraste foi medido
por cálculo WCAG sobre os tokens, abaixo.

## Rodada 1

Detector: 15 alarmes em 375 e 17 em 1440.
- `side-tab` (borda grossa de um lado no quadro): corrigido, quadro com borda inteira de 1px.
- `kicker-above-heading` (rótulo acima do título de seção): corrigido, rótulo removido (SLOP-22).
- `nested-cards` (balão dentro do fundo do WhatsApp): corrigido, sombra do balão removida.
- `cramped-padding` no selo do título de seção: corrigido, de 8px para 12px.
- Console: um 404 do favicon em 375; corrigido com ícone vazio. Satoshi não carregava (a Fontshare
  devolvia General Sans quando as duas famílias iam no mesmo link); corrigido com um link por família.

## Rodada 2

Detector: 0 alarmes em 375 e em 1440. Console sem erro. Rolagem horizontal: nenhuma
(largura do documento igual à da janela nas duas medidas).

## Rodada 3

Contraste: a hora do balão do cliente (#667781 sobre #d9fdd3) dava 4.19; trocada por #54656f,
5.46. Rodapé de impressão (logo e número) acrescentado no `@page`. Detector: 0 alarmes nas duas
larguras. PDF de impressão: 8 páginas, capa sem rodapé, numeração a partir de 2
(`impressao-r3.pdf`).

## Piso

| Id | Resultado |
|---|---|
| SLOP-02 | passou: sem gradiente |
| SLOP-37 | passou: sem ícone de biblioteca; emoji só dentro do texto real das mensagens |
| SLOP-10 | passou: regras em lista numerada, não em três cards |
| SLOP-11 | passou após rodada 1 |
| SLOP-22 | passou após rodada 1 |
| SLOP-21 | passou |
| SLOP-46 | passou: cliente e números são exemplo declarado do modelo (cliente inventado) |
| SLOP-44 | passou: sem vidro |
| SLOP-49 | passou |
| TIP-01 | passou: Clash Display e Satoshi |
| TIP-12 | passou: corpo 16px, entrelinha 1.55 na tela (impresso 10.5pt, fora do critério de tela) |
| TIP-20 | passou: h1 capa, h2 seção, h3 subseção |
| TIP-21 | passou: `tabular-nums` em tabela, linha do tempo e índice |
| TIP-22 | passou: `display=swap` nos links da Fontshare, reserva Helvetica/Arial |
| COR-02 | passou: tokens no `:root` |
| COR-12 | passou após rodada 3: menor par 4.65 (hora sobre branco), texto grande e ícones acima de 3 |
| COR-13 | não se aplica: documento sem interativo |
| COR-15 | passou: texto sobre verde é preto (15.43) |
| COR-16 | passou: perda tem cor e texto ("Card perdido") |
| COR-18 | não se aplica: documento impresso sem modo escuro |
| LAY-03 | passou: escala de 4px em tokens |
| LAY-22 | passou: sem rolagem horizontal em 375 e 1440 |
| LAY-26 | passou: botões do balão com 44px na tela (são desenho, não clicáveis) |
| LAY-31 | passou: sem z-index |
| MOV-02 a MOV-23 | não se aplica: nada se move |
| UX-01, UX-08, UX-14 a UX-16, UX-26, UX-11, UX-12, UX-20 | não se aplica: sem interativo nem formulário |
