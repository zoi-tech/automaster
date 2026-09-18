# 002 — Anatomia de um plugin do Claude Code

Map: [Automaster como plugin do Claude Code](../map-plugin-claude-code.md)
Type: `wayfinder:research`
Status: fechado (2026-09-18)
Assignee: claude
Blocked by: —

## Pergunta

O que o manifesto de plugin do Claude Code suporta, especificamente para este caso:

Um MCP server que precisa de um interpretador do projeto (o `.venv` do auditor) ou de Node
— como se declara o comando, e o que acontece quando a dependência não está instalada.

Comandos que rodam processo longo e interativo (a extração abre Chrome e pode pedir login).

Diretório de trabalho: o plugin roda a partir da sessão do usuário, que pode não ser este
repositório. Como as tools acham os dumps.

Setup: existe gancho de instalação, ou o setup vira um comando que o usuário roda uma vez.

Resposta vai para `docs/wayfinder/pesquisa-002-anatomia-plugin.md`, linkada daqui.

## Resolução

Pesquisa completa em
[pesquisa-002-anatomia-plugin.md](../pesquisa-002-anatomia-plugin.md), com as cinco seções
respondidas contra a doc oficial e contra os manifestos reais em `~/.claude/plugins/`.

O manifesto é `.claude-plugin/plugin.json` na raiz, e o MCP server se declara em `.mcp.json`
com `command`/`args`/`env`. Existem três variáveis, e elas separam três coisas que é fácil
confundir: `${CLAUDE_PLUGIN_ROOT}` é onde o código do automaster vai morar (o repositório
original do usuário não precisa existir), `${CLAUDE_PLUGIN_DATA}` é o lugar declarado para
dependências e caches, e `${CLAUDE_PROJECT_DIR}` é o projeto da sessão.

Quatro achados que mudam decisão:

**O venv não viaja.** Binários e shebangs com caminho absoluto do criador quebram na
instalação por marketplace. O venv tem que ser criado em `${CLAUDE_PLUGIN_DATA}` no
primeiro uso, e o `command` aponta para lá. `cwd` não existe como campo, e caminho relativo
puro não é resolvido contra a raiz do plugin.

**Não existe gancho de pós-instalação.** Nenhum evento `PostInstall` na lista. O padrão
real, usado pelo próprio Anthropic, é um `SessionStart` barato que só detecta o que falta e
imprime uma linha apontando para um comando de setup que o usuário roda uma vez.

**O diretório do dump é argumento da tool, não ambiente.** `${CLAUDE_PROJECT_DIR}` é
resolvido quando o servidor sobe, e não está confirmado se o servidor reinicia ao trocar de
projeto na mesma sessão. O servidor nunca deve adivinhar onde estão os dumps.

**MCP server que não sobe falha mudo.** O plugin instala "ok" e as tools simplesmente não
existem; o erro só aparece na aba Errors do `/plugin`. É o que torna o SessionStart de
diagnóstico obrigatório, não opcional.

A extração com login manual cabe melhor no MCP server que num comando Bash: o servidor é um
processo longo por natureza e pode manter o browser vivo entre chamadas, que é o que o
plugin `playwright` faz. Bash em foreground esperando login trava o turno e não tem stdin.

Seis itens ficaram não confirmados, listados no fim da pesquisa. Nenhum deles bloqueia o
004 ou o 005 — todos têm caminho seguro conhecido.
