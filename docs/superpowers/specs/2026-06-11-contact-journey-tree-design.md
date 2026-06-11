# Spec — Árvore de jornada do contato (journey.html)

**Status:** aprovado pelo usuário em 2026-06-11 (brainstorming completo).
**Objetivo:** página que mostra a árvore de TUDO que pode acontecer com um contato
na subconta desde a criação — triggers, workflows em cascata, tags, branches
(respondeu/não respondeu), até os estados terminais ("nada mais pode acontecer").

## Decisões tomadas (com o usuário)

1. **Eventos externos inline no ponto certo.** Depois de cada step que manda
   mensagem aparece o ramo "se responder → workflow X" (usando as condições do
   trigger para ancorar só onde faz sentido). Ligação → ramos por disposition.
   Eventos que nenhum step causa ficam num grupo "A qualquer momento" na raiz.
2. **Granularidade condensada + expansão.** Por padrão o workflow mostra só o que
   muda o destino do contato: branches rotulados, efeitos, terminais. Steps
   neutros (wait, drip…) colapsam em "+N steps neutros" expandível.
3. **Ciclos: expande 1x por ramo + marca loop.** Workflow revisitado dentro do
   mesmo ramo vira nó `↺ loop → X` (corta ali, padrão camada 2). Em ramos irmãos,
   expande de novo — cada linha do tempo é legível de cima a baixo.
4. **Entrega: página `journey.html`** no shell Sala de Controle + item "Jornada do
   contato" na sidebar (seção Análise) + subcomando `automaster-audit journey`.
5. **Motor: abordagem A** — `journey.py` dedicado (caminhada causal sobre
   `flow.py` + índice de triggers). Camada 2 intocada.

## Semântica da árvore

### Raiz dupla
- **"Contato criado"** → triggers `contact_created` → cascata completa.
- **"A qualquer momento"** → eventos sem causador interno: tag com trigger que
  nenhum workflow adiciona (= manual), oportunidade criada à mão (pipeline que
  nenhum step cria), aniversário (`birthday_reminder`), agendamento
  (`appointment`), `customer_reply`/`call_status` não-ancoráveis, decay sem
  âncora. Cada um desce sua própria cascata.

### Regra de ancoragem
Efeito de step pode causar o evento → ramo inline no ponto do step.
Ninguém causa → grupo da raiz. Tabela de matching:

| Efeito no caminho | Evento | Matching |
|---|---|---|
| `add_contact_tag` T | `contact_tag` | condição `tagsAdded == T` (sem filtro de tag = qualquer tag) |
| `internal_create_opportunity` em pipeline P | `opportunity_created` | condição `pipelineId == P` (ou sem filtro) |
| `update_contact_field` F | `contact_changed` | filtros do trigger quando houver |
| mensagem enviada (sms/whatsapp/email) | `customer_reply` | condição `workflow.id` restringe ao workflow atual; demais filtros viram chip "se: …" |
| `manual-call` | `call_status` | `workflow.id` idem; disposition vira rótulo do ramo |
| `add_to_workflow` W | (direto) | aresta direta para W |
| oportunidade criada | `opportunity_decay` | ancora após a criação; filtro de pipeline |

- Triggers têm `actions: [{workflow_id, type: add_to_workflow}]` — o destino da
  aresta é o workflow do trigger.
- `active: false` ou trigger `deleted` → aparece com chip `INATIVO` (não some).
- Workflow DRAFT → aparece com chip `DRAFT` (auditoria vê o que está desligado).

### Condições não avaliáveis
Filosofia camada 3: nunca descartar, nunca fingir. Condição que o motor não
avalia (ex.: "message contains X", campo do contato) vira chip **"se: <resumo>"**
na aresta. O ramo aparece; o usuário julga.

### Nós (modo condensado)
`kind ∈ {event, workflow, branch, effect, neutral_group, terminal, loop, truncated}`
- **event** — "tag X adicionada", "respondeu", "ligação: Desqualificado"…
- **workflow** — entrada num workflow (nome + status).
- **branch** — rótulo do ramo (camada 2: `_branch_label`).
- **effect** — tag±, mensagem, oportunidade criada/movida, atribui user, webhook,
  notificação interna, update de campo.
- **neutral_group** — "+N steps neutros" expandível (wait, drip, goto transparente…).
- **terminal** — `[fim]`, workflow inexistente (ref quebrada, vermelho).
- **loop** — `↺ loop → <workflow/step>`.
- **truncated** — `✂ truncado +N` (cap atingido; nunca silencioso).

### Controle de explosão
- Revisita de workflow no MESMO ramo → `↺ loop` (corta).
- Cap de profundidade de cascata: 8 níveis de workflow (default).
- Cap de nós por raiz: 4000 (default).
- Caps estourados → nó `truncated` visível + flag `truncated` no dado + stats.

## Componentes

### Novos (2 módulos)
- **`journey.py`** — motor.
  - `TriggerIndex`: constrói de `wf.triggers` de todos os workflows; indexa por
    tipo de evento com condições normalizadas; respeita `active`/`deleted`.
  - `build_journey(ctx: DumpContext) -> dict`:
    `{meta, criacao: [nós], anytime: [nós], stats, truncated}`.
    Nó = `{kind, label, detail, flags, children}`.
  - Caminhada reusa `flow.successors`, `flow.is_branch_node`, `flow._branch_label`.
    Condensação no motor (HTML leve).
- **`journey_html.py`** — apresentação no shell Sala de Controle.
  - `topbar(loc, extracted)` + `sidebar(active="journey")` do theme.py.
  - Árvore `<details>` nativo, indentação por hairline vertical (padrão camada 2
    do validation.html).
  - Prefixos mono por tipo: `TAG+` `TAG−` `MSG` `OPP` `→WF` `↺` `✂`.
  - Chips: evento (cinza), "se: …" (condicional), `DRAFT`/`INATIVO` (âmbar),
    ref quebrada (vermelho `#da1e28`).
  - Topo: stats (workflows alcançáveis desde a criação, terminais, loops) +
    expandir/recolher tudo + filtro de texto que esconde ramos sem match
    (JS vanilla pequeno; padrão `_JS` constante injetada como valor).
  - XSS-safe: `_esc` em todo nome de CRM; sem CDN; fontes via `head_assets()`.

### Integrações (3 toques)
- `cli.py`: subcomando `automaster-audit journey <dump> [-o journey.html]`.
- `theme.py`: item "Jornada do contato" na sidebar (seção Análise) — links
  relativos `journey.html`; as outras 3 páginas ganham o item ao regenerar.
- `CLAUDE.md`: 6ª saída documentada (journey.html + comando).

### Fluxo de dados
`load_dump → DumpContext → build_journey → write_journey_html` — builder separado
da apresentação, `raw` intocado, mesma anatomia das outras saídas.

## Testes

Fixtures sintéticas via `conftest.make_dump(...)`:
1. **Cascata:** wf A (trigger `contact_created`) adiciona tag T → wf B (trigger
   `contact_tag` T) é filho do efeito TAG+.
2. **Ciclo A→B→A:** nó `loop`, sem recursão infinita.
3. **Reply ancorado:** `customer_reply` com condição `workflow.id` só aparece no
   workflow certo.
4. **Tag manual:** tag com trigger que nenhum wf adiciona → grupo "a qualquer
   momento".
5. **Cap:** estourar cap → nó `truncated` + flag.
6. **Inativos:** trigger `active:false` e wf DRAFT aparecem com flag.
7. **XSS:** nome malicioso escapado no HTML.
8. **Dump real (sanidade):** Instaltech — ciclo 1A⇄1B marcado, sem crash.

## Verificação final
Regenerar no dump Instaltech + screenshots (raiz, cascata expandida, grupo
"a qualquer momento") + teste interativo Playwright (expand/recolher, filtro,
0 pageerrors).

## Fora de escopo
- Avaliar condições (camada 3 já cobre o subconjunto suportado).
- journey.md (versão markdown) — fica para depois se pedirem.
- Eventos que o dump não tem (ex.: form submitted) — o motor ignora tipos de
  trigger desconhecidos com contagem em stats (`triggers_ignorados`), nunca
  silenciosamente.
