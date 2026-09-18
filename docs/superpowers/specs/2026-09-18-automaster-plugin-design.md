# Automaster como plugin do Claude Code — spec

**Data:** 2026-09-18
**Status:** Aprovado — decidido pelo mapa [Automaster como plugin do Claude Code](../../wayfinder/map-plugin-claude-code.md), oito tickets
**Objetivo:** Empacotar o automaster (extractor TypeScript + auditor Python) como plugin interno da ZOI, com um MCP server que responde as quatro perguntas de uso sem despejar o dump no contexto.

## Visão geral

O plugin é uma casca sobre as CLIs que já existem. A lógica determinística fica onde está —
TypeScript e Python, com os 100 testes do auditor. O agente interpreta o resultado, não o
produz. Regra de auditoria continua sendo um arquivo em
`auditor/src/automaster_audit/rules/`.

Três peças:

1. **MCP server** (Python, stdio) — sete tools de consulta. Seis leem o dump offline e
   respondem em milissegundos; uma (`contato`) dispara o extractor e espera segundos.
2. **Comandos** — `/automaster-extract` (o único que abre browser) e `/automaster-audit`
   (gera os quatro HTML e abre).
3. **Skill `automaster-leitura`** — ensina a interpretar o domínio, separada das descrições
   das tools.

O que justifica o MCP: o dump bruto da Instaltech tem **1,73 milhão de tokens**, 86% deles
nos 94 workflows. O inventário equivalente, que o `build_dashboard` já monta antes de virar
HTML, custa **20.111**. A redução de 86 vezes é de código que já existe
([001](../../wayfinder/tickets/001-o-que-o-dump-ja-responde.md)).

## Fronteira

**O MCP importa o auditor como biblioteca**, nunca lê os JSON do dump por conta própria.
`build_dashboard`, `build_paths_report`, `build_journey` e `rules.run_all` já produzem as
estruturas certas em Python; o trabalho do servidor é recortar e serializar. Essa restrição
é o que mantém o custo do plugin baixo, e romper com ela reabre o 001.

Uma exceção conhecida, e é código novo de verdade: o índice reverso precisa varrer triggers
além de steps (ver "Bug a consertar").

## As sete tools

Todas recebem `loc` e, opcionalmente, `snapshot` (default: o mais recente). Todas devolvem
`_snapshot` com `extractedAt` e `idade_dias` — o agente vê a idade do dado em toda resposta
e decide se ela importa para a pergunta. Não há limiar nem aviso automático.

| Tool | Devolve | Custo medido |
|---|---|---|
| `dumps()` | subcontas, nome, snapshots, data | ~200 tok |
| `inventario(loc, fatia?)` | `summary` por default; fatias sob demanda | 82 tok / 20.111 inteiro |
| `workflow(loc, id)` | meta, caminhos, achados do workflow | 155 tok + caminhos |
| `achados(loc, severidade?)` | achados agrupados + `counts` sempre | 1.921 tok nos 20 ERROR |
| `buscar(loc, termo)` | quem dispara, adiciona, remove, testa em condição | pequeno |
| `jornada(loc, caminho?, profundidade?)` | um nível da árvore por chamada | 61 tok/nó |
| `contato(loc, id, days?)` | eventos do contato, ao vivo | **não medido** |

Quatro exigências de forma, cada uma vinda de uma resposta real no
[007](../../wayfinder/tickets/007-a-sessao-ideal.md):

**`inventario` devolve o `summary` por default.** 82 tokens contra 20.111. Quem documenta a
operação começa pelo mapa, não pelos 94 workflows.

**`achados` agrupa por `(rule, workflow, detail)`**, não só filtra: o mesmo campo quebrado
aparece uma vez por step, quatro vezes no mesmo workflow. E devolve `counts` mesmo com
filtro, senão o agente não sabe o que deixou de pedir.

**`workflow` tem teto na árvore de caminhos.** A seção do `paths.md` tem mediana de 173
tokens, mas o maior workflow do dump custa 18.665. Acima do teto, resumo mais aviso de
truncagem.

**`jornada` navega, não fatia.** `build_journey` devolve 215.372 tokens e o recorte por raiz
não funciona: das 18 raízes, 17 têm 37 tokens e uma tem 214.545. A tool devolve um nível por
chamada e o agente desce. Os nós não têm id — `_node()` devolve `kind`, `label`, `detail`,
`flags`, `conds`, `children` —, então o endereço é o **caminho posicional** (`[0,3,1]`),
que evita mexer em `journey.py`.

### `contato` é de outra natureza

As outras seis respondem offline. Esta abre Chrome, recaptura os dois tokens e pagina
`audit/search/v2` mais oportunidades e agendamentos
([006](../../wayfinder/tickets/006-destino-da-timeline.md)). A spec não a descreve como se
fosse igual às outras: ela espera segundos e exige o setup do extractor.

Ela **resolve `sourceId` para nome de workflow** na própria resposta. É o campo que a costura
às outras seis: o agente lê "tag adicionada por `WORKFLOW_NEW`/9fd53332", chama
`workflow("9fd53332…")` e explica o porquê. Sem resolver, a resposta é uma lista de ids.

O comando `timeline` ganha uma flag `--json` que imprime os eventos em vez de renderizar
HTML. O array já existe montado antes da renderização, e `AuditLog`
(`extractor/src/api/audit.ts:4`) já é serializável.

### O que não é tool

`validacao` foi cortada no 007. `_camada1` é literalmente `rules.run_all(ctx)`, o mesmo que
`achados` devolve; `_camada2` é `enumerate_paths` por workflow, o mesmo que `workflow`
devolve; `camada3` são os contratos, 7 tokens e vazia sem a pasta. O `validation.html`
continua como entrega para humano, e `verify-contracts` fica fora do MCP na v1.

Rodar a auditoria inteira e abrir o dashboard são ações do humano, não perguntas do agente.

## Bug a consertar antes da v1

`buscar("recuperacao-reativacao")` devolve `orphan: true` para uma tag que **dispara um
workflow publicado**. O índice reverso do `build_dashboard` (`_wf_refs`) só varre os steps,
nunca os triggers.

**6 das 59 tags que o `dashboard.html` chama de órfãs são gatilhos de workflow**:
`form-custom-site`, `gestor de follow up`, `ia manual`, `ia-teste`, `indicacao-rodrigo`,
`recuperacao-reativacao`. O HTML com esse erro já foi entregue.

O conserto serve aos dois: `_wf_refs` passa a varrer triggers e a marcar o **papel** de cada
referência — dispara, adiciona, remove, testa em condição. `buscar` devolve o papel;
`dashboard.html` para de mentir.

## Onde as coisas moram

**Dumps:** `~/.automaster/dumps/<loc>/<YYYY-MM-DD_HHmm>/`, acervo único da ZOI, ao lado do
`chrome-profile` que já vive em `~/.automaster/`. Uma subconta extraída de qualquer sessão
fica visível para todas. O MCP serve várias subcontas na mesma sessão: a raiz vem por `env`,
a subconta vem por argumento
([005](../../wayfinder/tickets/005-casca-dumps-setup.md)).

**Código:** `${CLAUDE_PLUGIN_ROOT}`. O repositório original não precisa existir na máquina
([002](../../wayfinder/tickets/002-anatomia-plugin.md)).

**Python:** um shim descobre o interpretador e a raiz do plugin (pela própria posição: `${CLAUDE_PLUGIN_ROOT}` só expande em `command`/`args`, não em `env`) — testa `python3.14`, `python3.13`,
`python3.12`, `python3`, confere `sys.version_info >= (3,12)` e faz `exec`. **Não há venv
para provisionar:** `auditor/pyproject.toml` não declara nenhuma dependência e tudo é
stdlib. O piso importa: o `/usr/bin/python3` do macOS é 3.9.6 e quebra no `str | None` de
`finding.py`.

**Setup do extractor:** sob demanda. `npm ci` e `npx playwright install chromium` (~410 MB)
rodam na primeira chamada de `/automaster-extract` **ou** de `contato`, avisando antes.
Quem só consulta dump e não pergunta sobre contato nunca paga.

**Diagnóstico:** um hook `SessionStart` barato confere que existe um `python3` ≥ 3.12 e
imprime uma linha apontando para o comando de setup quando falta. Ele é obrigatório porque
um MCP server que não sobe **falha mudo**: o plugin instala "ok" e as tools simplesmente não
existem, e o erro só aparece na aba Errors do `/plugin`.

Não existe gancho de pós-instalação no Claude Code. `SessionStart` é o substituto, e é o
padrão do próprio Anthropic.

## A skill `automaster-leitura`

As descrições das tools dizem o que cada uma devolve e quanto custa, e só isso. A leitura do
domínio fica numa skill separada, porque descrição de tool é lida sempre, mesmo quando a
tool não é chamada.

O que a skill ensina, com os números da Instaltech como referência:

- **Draft é o estado normal**, não abandono: 66 de 94 workflows. `dead_end_draft` é INFO.
- **`naming_convention` é ruído**: 94 dos 152 achados. Filtre por severidade antes de ler.
- **Tag órfã quase nunca importa**: 59 de 95 — e, até o conserto, seis delas são gatilhos
  mal classificados.
- **Ciclo de `add_to_workflow` nem sempre é bug**: pode ser desenho com guarda. Leia os
  caminhos antes de chamar de erro.
- **Referência quebrada é sempre erro**: `broken_*_ref` aponta entidade que não existe mais.
- **Jornada de criação vazia é informação**, não falha: na Instaltech não há nenhum trigger
  `contact_created` em 94 workflows — o contato entra por tag, por resposta e por ligação.

## Fora de escopo

Marketplace público e empacotamento portável de Python e Node: o custo não se paga num
plugin de uso interno.

~~Escrita no GHL pelo plugin. O automaster lê; mudar produção é outro problema, com outro
risco.~~ Revogado no mesmo dia por
[contato-editar](2026-09-18-contato-editar-design.md): escrita de contato com snapshot prévio.

`verify-contracts` e a pasta `contracts/` como tool.

Os 38 scripts soltos de `extractor/`, que o
[003](../../wayfinder/tickets/003-inventario-scripts-soltos.md) mediu: nenhum versionado,
nenhum alcançável por `npm run`, 19 clicando na interface do GHL. Antes de apagar, resgatar
dois endpoints que só existem ali e são leitura pura — execuções de um workflow
(`workflows/logs/v2`) e versões de um workflow (`workflow/<loc>/<id>/history`).

## Lacuna conhecida

Ninguém mediu quanto custa, em tokens e em segundos, a resposta de uma timeline real. O
comando abre sessão autenticada em produção e não foi executado durante o mapa. É o único
número que falta para dimensionar `contato`, e a primeira coisa a medir quando a
implementação começar.
