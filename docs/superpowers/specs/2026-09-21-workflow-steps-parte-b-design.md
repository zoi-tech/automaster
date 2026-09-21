# Parte B da escrita de workflows: manipular steps do canvas

## O problema

O `workflow_editar` escreve a casca do workflow e um atributo de step. O corpo do fluxo — as
caixas do canvas — não se monta pelo MCP: quem precisa acrescentar uma ação, tirar uma que
ficou errada ou reordenar ainda abre o editor do GHL à mão.

Medições que fundamentam este desenho: `docs/superpowers/research/2026-09-21-workflow-steps-parte-b-research.md`.

## As três ações

Nomes: `step-criar`, `step-remover`, `step-mover`. Nenhuma entra em `SEM_CORPO`, e é
justamente por isso que herdam snapshot, guarda de publicado, releitura de `version`,
conferência por releitura e validação pelas 18 regras.

### `step-criar`

    --acao step-criar -i <wid> --depois-de <stepId> --corpo '<json do step>'

O corpo vai em **JSON cru**. Os `attributes` dos 41 tipos de step não são modelados: o
comando cuida de `id`, `parentKey`/`parent`, `next` e `order`, e da recostura. Inventar
schema por tipo produziria step que o editor não abre; o caminho seguro é copiar um step
existente do mesmo tipo como molde.

`id`, `parentKey`, `parent` e `next` que venham no `--corpo` são sobrescritos, com aviso.

Recostura: o step novo entra ENTRE a âncora e o que ela apontava. `parentKey` = âncora,
`next` = o `next` antigo da âncora, o filho antigo é reparentado no step novo, e a âncora
passa a apontar para ele.

Âncora aceita: qualquer step sem `next` ou com `next` string — 3.377 dos 4.017 da Instaltech,
incluindo nós de ramo, que é o caso normal de "acrescentar ação dentro do ramo sim". Âncora
container (`next` array) é recusada: inserir logo abaixo dela é ambíguo, e a mensagem manda
ancorar no nó de ramo.

### `step-remover`

    --acao step-remover -i <wid> --step <stepId> [--com-subarvore]

Step simples: o pai emenda no `next` do alvo, e o filho é reparentado no pai. Alvo sem pai
(raiz) deixa o filho virar raiz.

Container: recusado sem `--com-subarvore`; com a flag, saem o container, os nós de ramo e
tudo que pende deles, e o pai emenda em nada. A mensagem de recusa diz quantos steps sairiam.

Nó de ramo isolado: **nunca**. É estrutura do container — removê-lo desmontaria
`attributes.branches` e o `sibling[]` dos irmãos. Para tirar um ramo, remove-se o container.

Step alcançado por um `goto` não precisa de guarda nova: `checarPublicavel` já recusa `goto`
apontando para step que não existe mais, e aborta antes de gravar.

### `step-mover`

    --acao step-mover -i <wid> --step <stepId> --depois-de <stepId>

Retirar como em `step-remover` simples, inserir como em `step-criar`, preservando o id.
Só step simples; container e ramo são recusados. Recusa também âncora dentro da própria
subárvore do alvo, ou igual a ele — seria um ciclo.

## Limites declarados

**Mover container fica de fora.** A cauda de um container pende dos ramos, não dele: "o que
emenda onde" não tem resposta única, e qualquer escolha seria semântica inventada.

**Remover ramo isolado fica de fora**, pelo motivo acima.

**A posição no canvas é pergunta aberta.** O step novo nasce sem `advanceCanvasMeta.position`,
como 2.481 dos 4.017 steps reais. Se a prova ao vivo mostrar a caixa fora do lugar, a correção
é copiar a posição da âncora com deslocamento em `y` — não se escreve código especulativo antes.

## Decisões do grill

- **Corpo do step em JSON cru, não catálogo de tipos.** Um catálogo seria palpite por tipo
  até haver prova ao vivo de cada um, e um `attributes` errado gera step que o app não abre.
- **Remover container é permitido, com `--com-subarvore`.** Recusar cobriria só 46% dos steps.
  A variante "emendar o pai num dos ramos" foi descartada: mais recostura, mais erro sutil.
- **A prova ao vivo entra nesta entrega.** É o único jeito de responder a pergunta do canvas.
