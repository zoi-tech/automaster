---
name: automaster-formulario-visual
description: Define a identidade visual de um formulário ou survey do GoHighLevel a partir da marca do cliente, produzindo os tokens que a tool `formulario_estilo` aplica. Use ao criar um formulário sob medida, ao redesenhar um existente, ou quando o pedido envolver a aparência de um formulário do GHL.
---

# Identidade visual de formulário do GHL

Produz um conjunto de tokens. Não escreve no formulário: quem escreve é a tool
`formulario_estilo`.

## O que o GHL aceita

Dois destinos, com papéis diferentes:

- **`fieldStyle`** — o painel de estilo do builder. Cor de fundo, cor de texto, cor e
  fonte do rótulo, borda, radius, espaçamento. Sobrevive a qualquer edição que o cliente
  faça na interface. É o destino preferido: tudo que couber aqui vai aqui.
- **`customStyle`** — CSS livre, para o que o painel não modela. Seletores conhecidos:
  `.hl-error`, `.error-message`, `.hl-progress .fill`, `.ghl-footer-preview .ghl-submit-btn`,
  `.ghl-footer-preview .ghl-footer-next`, `.ghl-footer-preview .ghl-footer-back`.

**Nunca escreva em `fieldCSS` nem em `mobileFieldCSS`.** O builder os regenera a partir do
`fieldStyle` a cada edição e apaga o que estiver ali — qualquer CSS colocado direto nesses
dois campos é trabalho perdido na primeira vez que o cliente tocar no formulário na
interface.

CSS do site que embute o formulário não entra: ele roda em iframe. Todo estilo tem que
estar no documento.

## Passos

1. **Leia o que já existe.** `formulario_estilo` com `acao="paleta-ver"` e `acao="temas"`.
   `paleta-ver` devolve a paleta padrão da subconta no formato real da API
   (`GET /forms/default-colors`): `{"colors": [{"name": "...", "value": "..."}]}`, uma
   lista de rótulos livres, não um objeto com chaves fixas — não procure `corPrimaria`
   nem nenhuma outra chave da seção de tokens dentro dessa resposta. Se a subconta já tem
   cor definida ali, ela é o ponto de partida — o formulário novo tem que conversar com os
   que o cliente já usa, não competir com eles.
2. **Decida a estética.** Invoque a skill `impeccable` só para isto: a direção visual a
   partir da marca do cliente. Não peça a ela o documento do formulário nem CSS pronto.
3. **Traduza em tokens.** O formato — esta é a nossa forma de entrada, não a da API:

```json
{
  "corPrimaria": "#0f62fe",
  "corTexto": "#161616",
  "corFundo": "#ffffff",
  "corBorda": "#8d8d8d",
  "corErro": "#da1e28",
  "fonte": "IBM Plex Sans",
  "tamanhoRotulo": 14,
  "pesoRotulo": 600,
  "radius": 4,
  "espacamento": 16,
  "cssLivre": ""
}
```

   Se decidir gravar esses tokens como a paleta padrão da subconta
   (`acao="paleta-gravar"`), saiba que a gravação **mescla**, não substitui: as cores que
   a subconta já tem em `default-colors` são preservadas, e só os cinco papéis da
   identidade acima são sobrescritos. Nenhum rótulo livre que já existia lá se perde.
4. **Veja antes de gravar.** `formulario_estilo` com `acao="previa"`, depois
   `acao="aplicar"` com `confirmo=true` num formulário descartável, depois
   `acao="previa-visual"`, que fotografa a página pública real e devolve o caminho de um
   PNG — aceita `versao` para fotografar uma versão antiga do formulário em vez da atual,
   e `saida` para escolher onde salvar o arquivo. Itere ali.
5. **Só então** aplique no formulário de produção.

## Piso, não opinião

Formulário é a porta de entrada do lead. Independentemente da estética escolhida:

- Contraste de texto e de rótulo em AA (4,5:1 para texto normal).
- Foco de teclado visível — nunca `outline: none` sem substituto.
- Alvo de toque de pelo menos 44px de altura no botão e nos campos.
- Erro legível sem depender de cor: o texto do erro diz o que fazer.
- No survey, a navegação entre slides recebe o mesmo cuidado dos campos. Survey bonito nos
  campos e cru no rodapé não está pronto.
