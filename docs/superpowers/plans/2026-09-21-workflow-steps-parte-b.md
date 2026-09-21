# Parte B da escrita de workflows — manipular steps do canvas

## Contexto

Hoje o `workflow_editar` do plugin automaster escreve só a casca do workflow: criar,
renomear, mover de pasta, duplicar, apagar, trocar referência, trocar tag, limpar órfãos,
um atributo de step e trigger. O corpo do fluxo — as caixas do canvas — não se monta pelo
MCP. Quem precisa acrescentar uma ação, tirar uma que ficou errada ou reordenar o fluxo
ainda abre o editor do GHL à mão.

A parte A deixou o terreno pronto: as ações que mexem no corpo já ganham de graça snapshot
antes da escrita, guarda de workflow publicado, releitura de `version` contra edição
concorrente, conferência por releitura (`conferirEscrita`) e validação pelas 18 regras nas
duas portas. Falta a mutação pura do documento.

Débitos da 0.15/0.16 fechados na 0.17.0 (`e757ee8`); 163 testes no extractor, 323 no auditor.

## Decisões já tomadas (respondidas pelo usuário)

- **Corpo do step novo vai em JSON cru** (`--corpo`). Não modelamos os `attributes` dos
  41 tipos de step: o comando cuida de `id`, `parentKey`/`parent`, `next`, `order` e da
  recostura. Inventar schema por tipo geraria step que o editor não abre.
- **Remover container é permitido com `--com-subarvore`**, que apaga o container, os nós de
  ramo e tudo que pende deles. Sem a flag, recusa.
- **A prova ao vivo entra nesta entrega**, no fim, na Instaltech.

## O que a exploração mediu (4.017 steps da Instaltech)

Campos universais do step: `id`, `order`, `attributes`, `name`, `type`. `parentKey` em
3.946, `parent` legado em 3.788, `next` em 3.039. Opcionais frequentes: `cat`, `nodeType`,
`sibling`, `advanceCanvasMeta.position`, `comments`.

`order` **não** é índice confiável: em 42 dos 71 workflows não é sequencial (num deles todos
os steps têm `order: 0`). Serve como campo a preencher, não como endereço.

Três famílias de nó:

- **simples** — `next` string ou ausente: 1.830 steps.
- **container** — `next` array com mais de um id: 640 steps (`if_else` condition-node,
  `workflow_split`, `find_opportunity`, `wait` multi-path, `whatsapp_v2` multi-path,
  `ig_interactive_messenger`).
- **ramo** — `nodeType: branch-yes|branch-no` (`type: if_else`) ou `type: transition`:
  1.547 steps. Cada ramo tem `parentKey` no container, `sibling[]` com os outros ramos, e
  `next` string apontando para o corpo do ramo. Os ids dos ramos `if_else` são exatamente
  os `attributes.branches[].id` do container; o ramo `else` tem `attributes.else: true` e
  costuma não ter `next`.

Consequência de desenho: inserir depois de um **ramo** é o caso normal de "adicionar ação
dentro do ramo sim" e precisa funcionar — o ramo tem `next` simples. Remover um ramo
isolado, não: desmontaria `attributes.branches` e `sibling` do container.

## Escopo de cada ação

| ação | alvo/âncora aceita | recusa |
|---|---|---|
| `step-criar` | âncora = qualquer step sem `next` ou com `next` string (3.377 de 4.017) | âncora container (`next` array): ambíguo, a mensagem manda ancorar no nó de ramo |
| `step-remover` | step simples; container só com `--com-subarvore` | nó de ramo (estrutura do container) |
| `step-mover` | step simples, âncora nas mesmas regras de `step-criar` | container, ramo, e âncora dentro da própria subárvore (ciclo) |

Mover container fica de fora por decisão declarada: a cauda do container pende dos ramos,
não dele, então "o que emenda onde" não tem resposta única.

## Implementação

### 1. Funções puras — `extractor/src/api/workflow-edit.ts`

É onde mora toda decisão (o `workflows-write.ts` é transporte puro). Seguem o contrato
existente: recebem `Documento`, clonam com `clonar`, devolvem `Resultado {doc, mudancas,
avisos?}` e nunca mutam o original.

```ts
export function criarStep(doc: Documento, corpo: Record<string, unknown>, depoisDe: string): Resultado
export function removerStep(doc: Documento, stepId: string, comSubarvore?: boolean): Resultado
export function moverStep(doc: Documento, stepId: string, depoisDe: string): Resultado
```

Helpers novos, pequenos, ao lado de `paiDe` (`workflow-edit.ts:136`) e `porId` (`:210`):

- `ehRamo(s)` — `s.type === "transition" || String(s.nodeType ?? "").startsWith("branch")`.
- `ehContainer(s)` — `Array.isArray(s.next) && s.next.length > 1`.
- `trocarNext(s, de, para)` — troca preservando a forma (string continua string, array
  continua array; `para === undefined` remove).
- `descendentes(steps, id)` — fecho transitivo por `paiDe`, não por `next`. `next` de ramo
  entra no corpo e `goto` arrastaria o workflow inteiro.
- `reparentar(s, novoPai)` — escreve `parentKey`, e `parent` só se o step já o tinha (não
  ressuscitar o campo legado onde o servidor não o usa).

`criarStep`: id novo por `crypto.randomUUID()`; `order` = maior `order` do workflow + 1;
`parentKey` = âncora; `next` = o que a âncora apontava; o filho antigo é reparentado no
step novo; a âncora passa a apontar para ele. `id`, `parentKey`, `parent` e `next` vindos
no `--corpo` são sobrescritos, com aviso em `avisos`.

`removerStep` simples: o pai emenda no `next` do alvo e o filho é reparentado no pai; alvo
sem pai (raiz) deixa o filho virar raiz (`parentKey`/`parent` removidos). Container com
`--com-subarvore`: saem o alvo e todos os descendentes, e o pai emenda em nada.

`moverStep` = retirar como em `removerStep` simples, inserir como em `criarStep`,
preservando o step (mesmo id). Recusa se `depoisDe` está em `descendentes(alvo)` ou é o
próprio alvo.

Nada muda em `montarCorpo` (`:220`): as listas `createdSteps`/`modifiedSteps`/`deletedSteps`
já saem do diff de ids e conteúdo, então as três ações as preenchem sozinhas.

`checarPublicavel` (`:238`) já recusa workflow que ficaria vazio e `goto` apontando para
step inexistente — é o que protege remover um step que um `goto` alcança. Sem código novo.

**Canvas:** o step novo nasce sem `advanceCanvasMeta.position` (1.536 de 4.017 steps reais
também não o têm). Se a prova ao vivo mostrar a caixa fora do lugar ou invisível, a correção
é copiar a posição da âncora com deslocamento em `y`. Pendência declarada, não código
especulativo.

### 2. Comando — `extractor/src/cli/workflow-editar.ts`

- `WF_EDITAR_ACOES` (`:18`) ganha `"step-criar"`, `"step-remover"`, `"step-mover"`. **Não**
  entram em `SEM_CORPO` (`:31`) — é justamente por ficarem fora que herdam diff, snapshot,
  guarda de publicado, releitura de `version`, conferência e validação.
- `Opts` (`:23`) e o parser (`:425`) ganham `--corpo <json>`, `--depois-de <id>`,
  `--com-subarvore`. `--step` já existe e endereça o alvo.
- Três `case` em `aplicarOperacao` (`:184`), com as exigências de argumento no mesmo estilo
  dos atuais. O `--corpo` passa por `JSON.parse` estrito (diferente de `parseValor`, `:205`:
  aqui texto que não é JSON é erro, não valor).

### 3. Guarda das 18 regras — lado Python

Ação nova entra nas duas portas, como manda o CLAUDE.md:

- `auditor/src/automaster_audit/mcp_server.py`: as três em `WF_EDITAR_ACOES` (`:1006`) e em
  `_WF_EDITAR_COM_CORPO` (`:1013`); parâmetros `corpo` (dict ou str, serializado como
  `trigger_corpo` já é em `:1044`), `depois_de`, `com_subarvore` na assinatura (`:1016`), na
  closure `_args` (`:1046`) e no schema da tool (`:1488`).
- `auditor/src/automaster_audit/cli.py`: mesmos três argumentos no parser (`:255`) e na
  tupla `campos` (`:189`). Zero lógica duplicada — `run_workflow_editar` só repassa.

### 4. Testes

- `extractor/test/workflow-edit.test.ts`, com o helper `doc([...])` (`:8`): inserir no meio,
  inserir no fim, inserir depois de um nó de ramo, recusar âncora container; remover
  recosturando, remover a raiz, recusar ramo, recusar container sem a flag, remover
  container com subárvore inteira; mover reposicionando, recusar mover para dentro da
  própria subárvore; e a asserção de não-mutação do original em pelo menos uma das três.
- `auditor/tests/test_workflow_editar_tool.py`: três entradas em `_ARGS_POR_ACAO` (`:364`) —
  sem elas `test_toda_acao_da_tool_tem_caso_de_teste` quebra de propósito. O parametrizado
  então cobre linha de comando e validação das três.
- `auditor/tests/test_cli_workflow_editar.py`: o teste de repasse dos campos (`:36`) passa a
  esperar os três argumentos novos.

### 5. Prova ao vivo (serial, um comando por vez)

Instaltech `Xb9gDxwxYhdqtprGcb5E`, workflow descartável `test.cmd [review]`
`457e3101-9aa4-4733-acaa-9f7a90bf6f90`, deixado em `draft`. **Nunca** `delete.cmd`
`33f5ba6f-...`, que apaga o contato.

O perfil do Chrome é único: dois comandos de escrita ao vivo em paralelo travam no
`SingletonLock`. Um de cada vez, sem subagentes concorrentes.

Roteiro: prévia e gravação de `step-criar` (um `add_contact_tag` com a tag de teste), abrir
o editor em `https://app.gohighlevel.com/v2/location/<loc>/automation/workflow/<wid>`
(singular) e conferir que a caixa aparece no canvas e no lugar certo; `step-mover` do mesmo
step; `step-remover` dele; e uma rodada de `step-remover --com-subarvore` num `if_else`
criado e descartado na hora. Cada gravação confere pelo `residual` do `conferirEscrita`, e o
registro fica em `~/.automaster/dumps/_workflows/<loc>/<wid>/`.

### 6. Entrega

`CHANGELOG.md` + `.claude-plugin/plugin.json` → **0.18.0**. `CLAUDE.md`: a lista de ações do
`workflow-editar` e a contagem de testes. `docs/endpoints.md`: o que a prova ao vivo mediu
(em especial a resposta sobre `advanceCanvasMeta`). Handoff novo em
`docs/superpowers/handoffs/` com o que ficou fora (mover container, remover ramo isolado,
posição no canvas se não tiver sido resolvida).

O CLAUDE.md exige o `spec-flow` antes do código: a spec, o dossiê de pesquisa e o plano
saem para `docs/superpowers/{specs,research,plans}/` como primeiro passo da execução,
escritos a partir do que já foi medido aqui — sem refazer a investigação.

## Verificação

```bash
cd extractor && npx tsc --noEmit && npm test          # 163 + ~11 testes
cd auditor && .venv/bin/python -m pytest -q           # 323 + ~4 testes
```

Depois, ao vivo, a sequência da seção 5 — e, no fim, um `automaster-audit audit` do dump da
Instaltech para confirmar que nenhum achado novo apareceu por causa das edições de teste.
