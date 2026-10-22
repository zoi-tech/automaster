# Sistema visual — manual do cliente (skill automaster-documentar)

Documento para cliente, lido na tela e impresso em A4. Segue o padrão da ZOI já usado no MD
Converter e aprovado no manual entregue à subconta A (15/10/2026).

- **Tipo de tela:** Ler.
- **Direção:** a da marca ZOI (tela que já existe; uma direção só).
- **Botões:** VARIACAO 4, MOVIMENTO 1 (documento impresso, nada se move), DENSIDADE 3.

## Tokens

| Grupo | Token | Valor |
|---|---|---|
| Cor | `--verde-400` (realce, faixa da capa, título em selo) | `#b5ff81` |
| Cor | `--verde-500` (borda de quadro e pílula) | `#90cc67` |
| Cor | `--verde-900` (texto em pílula, sol do rodapé) | `#364c26` |
| Cor | `--neutro-900` (títulos, gatilho, cabeçalho de tabela) | `#141414` |
| Cor | `--neutro-800` (corpo) | `#333333` |
| Cor | `--neutro-600` (texto suave) | `#5c5c5c` |
| Cor | `--neutro-50` (fundo calmo) | `#f7fff2` |
| Cor | `--magenta-500` / `--magenta-50` (perda, alerta) | `#cc3366` / `#fbeef2` |
| Fonte | títulos | Clash Display 500–700 |
| Fonte | corpo | Satoshi 400/700 |
| Texto | corpo na tela / impresso | 16px / 10.5pt |
| Espaço | escala | 4, 8, 12, 16, 24, 32, 48, 64px |
| Raio | quadro, selo / menor / pílula | 12px / 8px / 999px |

## Página impressa

A4, margem 20mm 22mm 22mm; capa sem margem e sem rodapé; rodapé com o logo da ZOI à esquerda e o
número da página à direita, contando a capa como 1. Uma seção por página (`break-before: page`).

## Peças

Capa ZOI, selo de título, quadro (calmo e alerta), aviso, índice, jornada, fluxo com pergunta e
ramos, semana de horários, faixa do funil, linha do tempo, balão de WhatsApp (mensagem, botões,
mapa, rodapé), tabela, pílula, perguntas rápidas.

## Fontes da busca descartadas

A busca do ui-ux-pro-max sugeriu navy com azul e Plus Jakarta Sans para "B2B Service"; fica fora
porque a marca da ZOI já define cor e tipografia.
