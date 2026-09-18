# Mapa: Automaster como plugin do Claude Code

Aberto em 2026-09-18

## Destino

Uma spec e um plano de implementação do plugin `automaster` para Claude Code: casca sobre
as CLIs existentes (extractor TypeScript, auditor Python) mais um MCP server que consulta o
dump, com as quatro perguntas de uso resolvidas no desenho.

O mapa **não** constrói o plugin. Ele fecha quando não sobra decisão antes de escrever
código.

## Notas

Decisões já travadas no grilling de abertura, com o porquê:

O plugin cobre extractor **e** auditor. Extrair pela mão e auditar pelo agente deixaria o
dump velho invisível para quem pergunta.

A lógica determinística fica onde está — TypeScript e Python, com os 100 testes. O agente
interpreta o resultado, não o produz. Regra de auditoria continua sendo arquivo em
`auditor/src/automaster_audit/rules/`.

Além dos comandos, um MCP server expõe consultas ao dump como tools. As quatro perguntas
que ele precisa atender: auditar subconta nova, responder pergunta sobre automação,
diagnosticar um contato, documentar a operação para o cliente.

Instalação só na ZOI, a partir deste repositório. Não há problema de empacotar Python e
Node de forma portável — mas há o de deixar o setup reprodutível numa máquina nova.

`/automaster-extract` é a única coisa que abre browser, e avisa que pode pedir login. O
resto do plugin só lê dumps.

O MCP lê o dump direto e devolve JSON pequeno. Os quatro HTML continuam existindo como
entrega para humano, gerados sob demanda.

Sobrevivem a qualquer troca de mecanismo: a fronteira casca/agente, o contrato do dump, o
humano no loop da extração. Dependem do mecanismo escolhido: a superfície do MCP e a forma
do setup.

## Ordem de execução

| Fase | Tickets | Por quê |
|---|---|---|
| 1. O que ainda não foi medido | **001** o que o dump já responde · **002** anatomia de um plugin · **003** inventário dos scripts soltos | Três premissas não olhadas: que as quatro perguntas cabem no dump atual, que o manifesto de plugin aguenta MCP com venv e cwd, e que a timeline do contato é produto e não rascunho. Um "não" em qualquer uma redesenha o plugin inteiro. |
| 2. As decisões que o achado permite | **004** superfície do MCP · **005** casca, dumps e setup · **006** destino da timeline | Cada uma só pode ser escrita depois da medição correspondente. |
| 3. A prova no papel | **007** a sessão ideal | Rascunhar o transcript das quatro perguntas é o que revela tool que falta ou sobra, antes de existir código. |
| 4. A entrega | **008** spec e plano | Escrever o que já foi decidido. |

## Decisões até aqui

O dump não precisa caber no contexto, e o código que o encolhe já existe. O
[001](tickets/001-o-que-o-dump-ja-responde.md) mediu: 1,73 milhão de tokens de dump bruto
viram **20 mil tokens** de inventário pelo `build_dashboard` que o dashboard HTML já usa, e
a explicação de um workflow cai de 6.291 para 173 tokens pela seção do `paths.md`. O MCP
custa menos do que parecia — desde que importe o auditor como biblioteca em vez de ler os
JSON do dump. Auditar subconta nova já está respondida hoje pelo `report.md`, 6.056 tokens.
O caro ficou isolado em diagnosticar um contato: nenhum dump tem contato ou timeline, e a
timeline do extractor é efêmera. Isso é o 006, não é superfície de MCP.

O plugin é um pacote que viaja sozinho, e é isso que obriga o setup a existir. O
[002](tickets/002-anatomia-plugin.md) confirmou que o código vai para
`${CLAUDE_PLUGIN_ROOT}` e o repositório do usuário não precisa existir — mas o `.venv` do
auditor **não viaja**, e tem que ser criado em `${CLAUDE_PLUGIN_DATA}` no primeiro uso. Não
há gancho de pós-instalação: o padrão é um `SessionStart` barato que detecta o que falta e
aponta para um comando de setup. Sem ele o plugin instala "ok" e as tools somem em
silêncio. Duas restrições para o 004: o diretório do dump é **argumento da tool**, nunca
ambiente, e a extração com login manual cabe no MCP server, que mantém o browser vivo entre
chamadas, não num Bash que trava o turno.

Os 38 scripts soltos do extractor não são o embrião de nada. O
[003](tickets/003-inventario-scripts-soltos.md) contou: zero versionados, zero alcançáveis
por `npm run`, 37 com a subconta do clienteb hardcoded, 19 clicando na interface do GHL. E
**nenhum é timeline de contato** — a premissa do ticket caiu. A timeline já está pronta e
versionada em `src/cli.ts` e `src/timeline_html.ts`, documentada desde 2026-06-11: o 006
decide o destino dela, não a constrói. Antes de apagar o resto, resgatar dois endpoints que
só existem ali e são leitura pura: execuções de um workflow (`workflows/logs/v2`) e versões
de um workflow (`workflow/<loc>/<id>/history`).

O MCP expõe sete tools finas, todas de leitura e todas importando o auditor como
biblioteca. O [004](tickets/004-superficie-do-mcp.md) recusou a tool genérica, que faz o
agente reaprender a consulta a cada chamada, e a tool por pergunta de uso, que congela hoje
as perguntas de amanhã: `dumps`, `inventario`, `workflow`, `achados`, `buscar`, `validacao`
e `jornada`. A raiz de `dumps/` vem por `env` e o alvo vem por argumento — o servidor nunca
adivinha. O achado que mudou o desenho: a **jornada não se fatia**. Das 18 raízes, 17 têm
37 tokens e uma tem 214.545, então a tool navega a árvore um nível por chamada em vez de
devolver um recorte. A validação se fatia bem, por camada e por workflow.

O auditor não precisa de setup nenhum, e isso corrige o 002. O
[005](tickets/005-casca-dumps-setup.md) mediu que `pyproject.toml` não declara dependência
alguma e que tudo é stdlib: o `build_dashboard` roda com `PYTHONPATH=src python3`, sem
venv. O venv que o 002 mandava provisionar seria vazio. O que fica é um shim que **descobre**
o interpretador — piso 3.12, porque o `/usr/bin/python3` do macOS é 3.9.6 e quebra no
`str | None` do `finding.py`. Os dumps passam a morar em `~/.automaster/dumps`, ao lado do
`chrome-profile` que já vive lá, como acervo único da ZOI. O extractor entra na v1 com
setup sob demanda: quem só consulta dump nunca paga os ~410 MB de `node_modules` e Chromium.

Diagnosticar um contato entra na v1, como oitava tool — e ela é de outra natureza. O
[006](tickets/006-destino-da-timeline.md) decidiu a rota ao vivo: a tool dispara o extractor
como subprocesso em vez de ler dump. Sete tools respondem offline em milissegundos; esta
abre Chrome, recaptura os dois tokens e pagina a API, em troca de dado nunca obsoleto. Três
consequências para o plano: o comando `timeline` precisa de uma flag `--json`, porque hoje
só renderiza HTML; o setup do extractor ganha um segundo gatilho, então "quem só consulta
dump nunca paga os 410 MB" passa a valer só para quem não pergunta sobre contato; e manter
um processo Node vivo entre chamadas vira a otimização óbvia. Falta um número: quanto custa
em tokens a resposta de uma timeline real.

Os transcripts escritos à mão mataram uma tool e acharam um bug que já está em produção.
O [007](tickets/007-a-sessao-ideal.md) rodou as quatro perguntas contra as oito tools com
respostas extraídas do dump real: `validacao` não apareceu em nenhuma, porque suas camadas 1
e 2 são literalmente o que `achados` e `workflow` já devolvem — **são sete tools**. E
`buscar` responde errado hoje: `recuperacao-reativacao` volta como órfã, embora dispare um
workflow publicado, porque o índice reverso só varre steps e nunca triggers. **6 das 59
tags órfãs do `dashboard.html` são gatilhos.** Consertar isso é a primeira coisa no plugin
que é código novo de verdade, e não recorte do que já existe.

A spec e o plano estão escritos, e o mapa acabou. O
[008](tickets/008-spec-e-plano.md) entregou
[a spec](../superpowers/specs/2026-09-18-automaster-plugin-design.md) e
[o plano](../superpowers/plans/2026-09-18-automaster-plugin-plan.md) em seis fases, e
nenhuma decisão nova apareceu durante a escrita. Os quatro itens que faltavam foram
fechados: a idade do dump vai em toda resposta e o agente decide; a interpretação do domínio
vira a skill `automaster-leitura`, com as descrições das tools secas; `contracts/` fica fora
da v1; e o MCP serve várias subcontas na mesma sessão.

**Fechado em 2026-09-18** — oito tickets, quatro medições, dois documentos de entrega.

## Ainda não especificado

Nada. Os quatro itens que estavam aqui foram fechados pelo 008.

## Fora de escopo

Marketplace público e empacotamento portável de Python e Node — o custo não se paga para um
plugin de uso interno.

Construir o plugin. O mapa entrega spec e plano; a construção é outro trabalho.

Escrita no GHL pelo plugin. O automaster lê; mudar produção é outro problema, com outro
risco.
