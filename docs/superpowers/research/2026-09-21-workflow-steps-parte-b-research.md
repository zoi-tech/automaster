# Parte B da escrita de workflows — dossiê de pesquisa

Medido em 2026-09-21 sobre o dump `~/.automaster/dumps/Xb9gDxwxYhdqtprGcb5E/2026-09-20_0856`
(Instaltech, 71 workflows, 4.017 steps) e sobre o código da 0.17.0.

## A forma do step

Campos presentes em TODOS os 4.017 steps: `id`, `order`, `attributes`, `name`, `type`.

| campo | steps | nota |
|---|---:|---|
| `parentKey` | 3.946 | o que o servidor grava |
| `parent` | 3.788 | legado; às vezes é o único |
| `next` | 3.039 | string, array ou ausente |
| `cat` | 2.316 | `transition`, `conditions`, `multi-path`, ou ausente |
| `advanceCanvasMeta` | 1.536 | `{position:{x,y}}` |
| `comments` | 773 | |
| `nodeType` | 771 | `condition-node`, `branch-yes`, `branch-no` |
| `sibling` | 569 | os outros ramos do mesmo container |
| `workflowsActionType` | 479 | |

Não existe campo `_type` em lugar nenhum — nem no código, nem nos dumps.

**`order` não é endereço.** Em 42 dos 71 workflows a sequência de `order` não é contígua; num
deles todos os steps têm `order: 0`. Serve como campo a preencher, nunca para localizar ou
ordenar um step.

## As três famílias de nó

| família | critério | quantidade |
|---|---|---:|
| simples | `next` string ou ausente, e não é ramo | 1.830 |
| container | `next` array com mais de um id | 640 |
| ramo | `type: transition` ou `nodeType` começando em `branch` | 1.547 |

Tipos que aparecem como container (`cat: multi-path` ou `conditions`): `if_else`
condition-node (202), `wait` (176), `whatsapp_v2` (130), `workflow_split` (106),
`find_opportunity` (15), `ig_interactive_messenger` (11).

41 tipos de step distintos no total. Os cinco mais frequentes: `transition` (978),
`if_else` (771), `wait` (439), `add_to_workflow` (350), `goto` (230).

## Como `if_else` se monta (três camadas)

1. **Condition-node** — `type: if_else`, `nodeType: condition-node`, dono de
   `attributes.branches[]`. Cada branch tem `id`, `name`, `operator` e
   `segments[].conditions[]`. `next` é um array com os ids dos nós de ramo, **e esses ids
   são exatamente os `attributes.branches[].id`**, mais o id do ramo `else`.
2. **Nós de ramo** — também `type: if_else`, `nodeType: branch-yes` ou `branch-no`,
   `parentKey` no condition-node, `sibling[]` com os outros ramos, `attributes:
   {if:false, branches:[]}` (yes) ou `{else:true}` (no). O ramo `else` costuma não ter `next`.
3. **Corpo do ramo** — pendura em `next` (string) do nó de ramo e segue linearmente.

Containers `multi-path` seguem a mesma forma, com `type: transition` no lugar do nó de ramo
(`cat: transition`, `attributes: {}`, nome humano como "Opportunity Found").

Consequência: inserir depois de um **nó de ramo** é o caso normal de "acrescentar ação dentro
do ramo sim", e funciona porque o ramo tem `next` simples. Remover um ramo isolado, não:
desmontaria `attributes.branches` do container e o `sibling[]` dos irmãos.

## O que a parte A já dá de graça

Ação que NÃO está em `SEM_CORPO` (`extractor/src/cli/workflow-editar.ts:31`) herda, sem
código novo:

- leitura do documento e `conferirVersaoEsperada` contra a `version` que a prévia viu;
- prévia sem `--confirmo`, devolvendo `documento` + lista autoritativa de triggers;
- `checarPublicavel` — recusa workflow que ficaria vazio e `goto` apontando para step que
  não existe mais;
- `diffWorkflow` no resultado;
- `guardaPublicado` quando o workflow está publicado;
- releitura de `version` imediatamente antes do PUT;
- snapshot em `~/.automaster/dumps/_workflows/<loc>/<wid>/<ts>.json` ANTES da escrita;
- `montarCorpo`, que calcula `createdSteps`/`modifiedSteps`/`deletedSteps` por diff de ids e
  conteúdo — as três ações novas as preenchem sozinhas;
- `conferirEscrita`, que relê e compara o pedido com o gravado (200 não é prova nesta API);
- validação pelas 18 regras nas duas portas (`mcp_server.workflow_editar` e
  `automaster-audit workflow-editar`), com `pode_gravar` bloqueando só ERROR introduzido.

Resta, portanto, apenas a mutação pura do documento.

## O que continua sem resposta

**Posição no canvas.** 1.536 de 4.017 steps têm `advanceCanvasMeta.position`; os outros 2.481
não. Não se sabe se o editor calcula a posição de um step que nasce sem o campo, ou se a
caixa fica sobreposta/invisível. Só a prova ao vivo responde.
