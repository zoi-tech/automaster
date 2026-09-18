# 006 — Destino da timeline do contato

Map: [Automaster como plugin do Claude Code](../map-plugin-claude-code.md)
Type: `wayfinder:grilling`
Status: fechado (2026-09-18)
Assignee: claude
Blocked by: 003

## Pergunta

"Diagnosticar um contato" entra na spec do plugin, entra como fase posterior, ou sai de
escopo?

A resposta depende do que o 003 medir. Se há um caminho mínimo funcionando, é empacotamento.
Se são 35 rascunhos, a pergunta vira: vale construir isso agora, ou o plugin nasce com três
perguntas em vez de quatro?

Decisão de produto — apresentar o custo de cada rota e perguntar, não escolher.

## Resolução

Decisão do usuário em 2026-09-18: **entra na v1, como tool ao vivo que dispara o
extractor.**

### O que o 003 achou, e o que ele não viu

O [003](003-inventario-scripts-soltos.md) derrubou a premissa de que a timeline era
rascunho: nenhum dos 38 arquivos soltos a toca. Ela está versionada e funcionando, e faz
mais do que o ticket supunha — funde três fontes (audit logs, oportunidades via
`associations`, agendamentos) e resolve nomes de workflow, usuário, pipeline e estágio a
partir do dump mais recente. Já depende do acervo, o que combina com o `~/.automaster/dumps`
que o [005](005-casca-dumps-setup.md) decidiu.

Então não é empacotamento nem construção. É uma decisão de fronteira.

### O custo que a rota escolhida assume

A timeline vive do lado errado da fronteira desenhada pelo [004](004-superficie-do-mcp.md).
As sete tools são Python lendo dump offline; a timeline é TypeScript com Playwright e os
dois tokens capturados do browser. Uma tool `contato` **não é leitura de dump** — é chamada
ao vivo com sessão logada.

Aceito conscientemente, em troca de dado nunca obsoleto. Quatro consequências que o
[008](008-spec-e-plano.md) precisa carregar:

**A oitava tool é de outra natureza.** `contato(loc, id, days?)` chama o extractor como
subprocesso e lê JSON de volta. As outras sete respondem em milissegundos sem rede; esta
abre Chrome, recaptura tokens e pagina a API. A spec não pode descrever as oito como se
fossem a mesma coisa, e o [007](007-a-sessao-ideal.md) deve rascunhar a espera no
transcript.

**O comando precisa de saída JSON.** Hoje `runTimeline` escreve HTML em `os.tmpdir()` e
abre no navegador. O array de eventos já existe montado antes da renderização, e
`AuditLog` em `extractor/src/api/audit.ts:4` já é uma interface serializável. Falta uma
flag `--json` que imprima em vez de renderizar.

**O setup do extractor ganha um segundo gatilho.** O 005 decidiu provisionar os ~410 MB sob
demanda, na primeira chamada de `/automaster-extract`. Agora a tool `contato` dispara o
mesmo setup. A decisão do 005 não muda — continua sob demanda —, mas "quem só consulta dump
nunca paga" passa a valer só para quem não pergunta sobre contato.

**A sessão logada volta a ser o gargalo.** O 002 notou que um MCP server pode manter o
browser vivo entre chamadas, mas aqui quem abre o browser é o extractor em Node, não o MCP
em Python. Cada pergunta sobre contato paga a abertura do Chrome e a recaptura dos tokens.
Manter um processo Node vivo entre chamadas é a otimização óbvia, e fica como detalhe do
plano, não desta decisão.

### O que não foi medido

Quanto custa, em tokens, a resposta de uma timeline real — não rodei o comando, porque ele
abre sessão autenticada no GHL de produção. É o único número que falta para dimensionar a
tool, e o 007 vai precisar dele para rascunhar a quarta pergunta com honestidade.

Rotas recusadas: persistir no dump e ler offline depois, que era a mais barata e a mais
consistente com "o MCP lê o dump direto", mas entrega dado velho e reverteria a decisão
registrada em `docs/endpoints.md` de não gravar timeline em `dumps/`; adiar para fase
posterior; e tirar de escopo.
