# Changelog — plugin `automaster`

Versões do `.claude-plugin/plugin.json`. Toda mudança que afete o que o plugin
instalado faz sobe a versão aqui; o time atualiza com
`claude plugin marketplace update zoi && claude plugin install automaster@zoi`.

## 0.3.0 — 2026-09-19

### Novidade

- **Tool `conversas`**: lê ao vivo as mensagens trocadas com um contato (SMS, e-mail,
  WhatsApp, chat). Cada mensagem traz tipo, direção, autor e `origem`
  (`app`/`workflow`/`campaign`/`api`) — é a `origem` que diz se a mensagem saiu de uma
  automação ou de uma pessoa. Corpo cortado em 400 caracteres; eventos de timeline ficam
  de fora salvo `atividades=true`. Na CLI: `npm run conversas`.
- `discover` ganhou `--rota` (abre qualquer tela) e `--filtro` (mostra também a resposta
  dos GET), que era o que faltava para mapear leitura da API interna.

### Cuidado

Automação não se reconhece pela falta de autor: e-mail disparado por workflow vem com
`userId` preenchido. Use `origem`.

## 0.2.1 — 2026-09-18 (`289beb9`)

- **Corrige o servidor MCP não conectar em sessões abertas no próprio repo.** A
  config saiu da raiz para `.claude-plugin/mcp.json`, apontada pelo campo
  `mcpServers` do plugin.json: um `.mcp.json` na raiz o Claude Code carrega
  também como servidor de projeto, contexto em que `${CLAUDE_PLUGIN_ROOT}` não
  expande e o servidor morre com ENOENT.
- `editar` e `contato-editar` recusam custom field `FILE_UPLOAD`: a API forja o
  metadado do anexo a partir da URL sem baixar nada, gravando um anexo que não
  existe.
- `--set` aceita valor JSON (`{...}` / `[...]`), exigido por `TEXTBOX_LIST` —
  string crua respondia 200 e gravava `{}` em silêncio (`819d00b`).
- `serverInfo.version` do MCP sai do plugin.json em vez de fixo em `0.1.0`.

## 0.2.0 — 2026-09-18 (`a303277`)

- Oitava tool: **`editar`**, que escreve campos e tags de um contato pela API
  interna, grava snapshot antes e devolve `dispara` (workflows cujo trigger
  reage à mudança).
- Campo padrão só limpa com `null`; resolvedor de nome aceita camelCase e filtra
  `model: contact` (`00cf466`).

## 0.1.0 — 2026-09-18 (`af3573e`)

- Casca do plugin: manifesto, config MCP, shim de Python ≥ 3.12, hook de
  SessionStart, comandos `/automaster-extract` e `/automaster-audit`, skill
  `automaster-leitura`.
- Sete tools MCP de leitura sobre dumps offline: `dumps`, `inventario`,
  `workflow`, `achados`, `buscar`, `jornada`, `contato`.
