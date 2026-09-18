# 004 — Superfície do MCP

Map: [Automaster como plugin do Claude Code](../map-plugin-claude-code.md)
Type: `wayfinder:grilling`
Status: fechado (2026-09-18)
Assignee: claude
Blocked by: 001

## Pergunta

Quais tools o MCP expõe, com que granularidade, e o que cada uma devolve?

Granularidade é a decisão real: uma tool genérica de consulta ao dump, ou uma tool por
pergunta de uso. A primeira transfere trabalho para o agente a cada chamada; a segunda
congela as perguntas que alguém pensou hoje.

Também: o que é tool e o que é comando. Rodar a auditoria inteira e abrir o dashboard são
ações do humano; buscar um workflow é pergunta do agente.

Depende do 001: se o dump já responde barato, a superfície pode ser fina.

## Resolução

Grilling com o usuário em 2026-09-18. Três decisões, e uma medição nova que uma delas
obrigou.

### Granularidade: sete tools finas, todas de leitura

Escolhida a superfície fina contra a tool genérica de consulta e contra a tool por pergunta
de uso. A genérica faz o agente reaprender a linguagem de consulta a cada chamada; a tool
por pergunta congela hoje as perguntas de amanhã. O 001 mostrou que o recorte barato já
existe em Python, então a superfície fina não custa código novo — custa serialização.

```
dumps()                              -> subcontas, nome, snapshots, data
inventario(loc, snapshot?, fatia?)   -> build_dashboard; 20.111 tok inteiro, 130/workflow
workflow(loc, id, snapshot?)         -> meta (130) + caminhos (173 mediana) + achados dele
achados(loc, severidade?, snapshot?) -> report filtrado; 20 ERROR em vez de 152
buscar(loc, termo, snapshot?)        -> índice reverso: quem usa esta tag/campo/pipeline
validacao(loc, camada, workflow?)    -> camada 1 inteira (8.429); camada 2 por workflow
jornada(loc, caminho?, profundidade?) -> um nível da árvore por chamada
```

Todas importam o auditor como biblioteca — `build_dashboard`, `build_paths_report`,
`build_validation`, `build_journey` —, nunca leem os JSON do dump por conta própria. Essa
é a restrição que o 001 levantou e é o que mantém o código novo em serialização.

Fora do MCP, como comando do humano: `/automaster-extract`, o único que abre browser, e
`/automaster-audit`, que gera os quatro HTML e abre. Rodar a auditoria inteira e abrir o
dashboard são ações do humano; buscar um workflow é pergunta do agente.

### journey e validation entram como tool, e o recorte não é o óbvio

Decidido incluir as duas. A medição que faltava, feita depois da decisão, mudou o desenho
do recorte:

`build_validation` devolve 120.506 tokens. A camada 1 cabe inteira (8.429, 152 achados);
a camada 2 tem 111.983 divididos em 94 workflows, média de 1.191 cada — recorte por
workflow resolve. Assinatura: `validacao(loc, camada, workflow?)`.

`build_journey` devolve 215.372 tokens, e **o recorte por raiz não funciona**: das 18
raízes de "a qualquer momento", 17 têm 37 tokens e uma tem 214.545. A árvore inteira está
pendurada num nó só. A tool tem que navegar a árvore, não fatiá-la: devolve um nível por
chamada, e o agente desce pedindo o próximo. Um nó sem os filhos custa 61 tokens.

Detalhe de implementação que isso cria: os nós do `journey` não têm id — `_node()` devolve
`kind`, `label`, `detail`, `flags`, `conds`, `children`. Endereçar um nó por **caminho
posicional** (`[0, 3, 1]`) evita mexer em `journey.py`. É a opção barata; dar id aos nós é
a alternativa se o caminho posicional se mostrar frágil.

### O dump é argumento, a raiz é ambiente

O `.mcp.json` passa a raiz de `dumps/` por `env`, e cada tool recebe a subconta e,
opcionalmente, o snapshot — default, o mais recente. A tool `dumps()` lista o que existe.
O servidor nunca adivinha o alvo, que é a restrição que o 002 levantou: o
`${CLAUDE_PROJECT_DIR}` congela quando o servidor sobe, e não está confirmado se ele
reinicia ao trocar de projeto na mesma sessão.

Recusadas: caminho absoluto em toda chamada, que obriga o agente a descobrir o caminho
antes de qualquer pergunta; e raiz fixa no projeto da sessão, que quebra exatamente no caso
que o 002 não conseguiu confirmar.

### O que fica para o 005

Onde a raiz de `dumps/` aponta numa instalação por marketplace — `${CLAUDE_PLUGIN_DATA}`
ou uma pasta do usuário — é decisão do 005, não desta. Aqui só ficou travado que ela vem
por `env` e que o alvo vem por argumento.

## Verificação

```
cd auditor && D=../dumps/Xb9gDxwxYhdqtprGcb5E/2026-07-30_1221
.venv/bin/python -c "
import json,tiktoken,statistics
from pathlib import Path
from automaster_audit.loader import load_dump
from automaster_audit.journey import build_journey
from automaster_audit.validation import build_validation
e=tiktoken.get_encoding('cl100k_base')
tk=lambda o: len(e.encode(json.dumps(o,ensure_ascii=False,default=str)))
ctx=load_dump(Path('$D'))
j=build_journey(ctx); t=sorted(tk(r) for r in j['anytime'])
print('journey', tk(j), '| raizes menor', t[0], 'maior', t[-1])
v=build_validation(ctx, Path('../contracts'))
print('validation', tk(v), '| camada1', tk(v['camada1']), '| camada2', tk(v['camada2']))
"
```

## Emenda (2026-09-18, pelo 007)

`validacao` saiu. O [007](007-a-sessao-ideal.md) escreveu os transcripts e ela não apareceu
em nenhum: `_camada1` é `rules.run_all(ctx)`, igual a `achados`; `_camada2` é
`enumerate_paths` por workflow, igual a `workflow`. A decisão aqui foi tomada antes de a
sobreposição ter sido medida. **São sete tools**: `dumps`, `inventario`, `workflow`,
`achados`, `buscar`, `jornada` e `contato` (esta última pelo [006](006-destino-da-timeline.md)).

O 007 também corrigiu a forma de quatro delas e achou um bug em `buscar` — detalhe lá.
