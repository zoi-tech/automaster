# Pesquisa 002 — Anatomia de um plugin do Claude Code

Método: li os plugins realmente instalados nesta máquina em `~/.claude/plugins/` (manifestos `.claude-plugin/plugin.json`, arquivos `.mcp.json`, `hooks/hooks.json` e scripts de bootstrap de plugins como `claude-mem`, `watch`, `superpowers`, `security-guidance`, `playwright`, `ponytail`), o catálogo `~/.claude/plugins/marketplaces/claude-plugins-official/.claude-plugin/marketplace.json` e o registro `~/.claude/plugins/installed_plugins.json`; e cruzei com a documentação oficial em https://code.claude.com/docs/en/plugins-reference e https://code.claude.com/docs/en/plugins. A skill `claude-code-guide` citada no pedido não existe neste ambiente (o Skill tool retornou "Unknown skill"). Onde não houve confirmação por arquivo local nem por doc, marquei explicitamente.

## 1. Manifesto e estrutura de diretórios

O manifesto fica em `<plugin-root>/.claude-plugin/plugin.json`. **Só o `plugin.json` mora dentro de `.claude-plugin/`** — todo o resto (skills, commands, agents, hooks, `.mcp.json`) fica na raiz do plugin. A doc marca isso como o erro mais comum.

Exemplos locais mínimos (name/description/author bastam):
- `~/.claude/plugins/cache/claude-video/watch/0.2.0/.claude-plugin/plugin.json` — name, version, description, author, homepage, repository, license, keywords.
- `~/.claude/plugins/cache/claude-plugins-official/playwright/1aa8f02ec832/.claude-plugin/plugin.json` — só name, description, author (sem version; a versão vem do marketplace/commit).
- `~/.claude/plugins/cache/ponytail/ponytail/4.8.4/.claude-plugin/plugin.json` — usa o campo de caminho `"hooks": "./hooks/claude-codex-hooks.json"`.

Campos do `plugin.json` (doc oficial, plugins-reference):
- Obrigatório: `name` (kebab-case; vira o namespace `/<plugin>:<skill>`).
- Metadados: `displayName`, `version`, `description`, `author`, `homepage`, `repository`, `license`, `keywords`, `metadata`, `defaultEnabled`.
- Caminhos de componentes (relativos à raiz, começando com `./`): `skills`, `commands`, `agents`, `workflows`, `hooks`, `mcpServers`, `outputStyles`, `lspServers`, `experimental.themes`, `experimental.monitors`.
- Configuração: `userConfig` (valores pedidos ao usuário no enable), `channels`, `dependencies`.
- Semântica citada na doc: `skills` **soma** ao diretório padrão `skills/`; `commands` e `agents` **substituem** os padrões.

Locais padrão auto-descobertos (nenhum campo necessário no manifesto):

| Componente | Local padrão |
|---|---|
| Skills | `skills/<nome>/SKILL.md` |
| Commands (legado, markdown plano) | `commands/` |
| Agents | `agents/` |
| Workflows | `workflows/` |
| Hooks | `hooks/hooks.json` |
| MCP servers | `.mcp.json` (raiz do plugin) |
| LSP servers | `.lsp.json` |
| Output styles | `output-styles/` |
| Monitors (experimental) | `monitors/monitors.json` |
| Executáveis no PATH | `bin/` |
| Settings padrão | `settings.json` (só chaves `agent` e `subagentStatusLine`) |

Marketplace: `<repo>/.claude-plugin/marketplace.json` com `name`, `description`, `owner`, `plugins[]` (e, no catálogo oficial, também `$schema` e `renames`). Cada entrada de plugin tem `name`, `description`, `author`, `category`, `source`, `homepage`. `source` pode ser caminho relativo (`"./plugins/agent-sdk-dev"`), objeto git-subdir (`{"source":"git-subdir","url":...,"path":...,"ref":...,"sha":...}`), comando com `sha256`, ou npm. Evidência: `~/.claude/plugins/marketplaces/claude-plugins-official/.claude-plugin/marketplace.json`.

Para o automaster: um repo único com `.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json` na raiz basta (o próprio repo vira marketplace de um plugin, padrão que `ponytail` e `caveman` usam aqui).

## 2. Declarar o MCP server do plugin

Duas formas equivalentes (doc oficial):

1. `.mcp.json` na raiz do plugin, com wrapper `mcpServers`:
```json
{
  "mcpServers": {
    "automaster": {
      "command": "${CLAUDE_PLUGIN_ROOT}/auditor/.venv/bin/python",
      "args": ["${CLAUDE_PLUGIN_ROOT}/auditor/mcp_server.py"],
      "env": { "AUTOMASTER_HOME": "${CLAUDE_PLUGIN_ROOT}" }
    }
  }
}
```
2. Inline no `plugin.json`, no campo `mcpServers` (mesmo objeto).

Campos do servidor (doc): `command` (obrigatório em stdio), `args`, `env`, e para HTTP `url`, `headers`, `headersHelper`. Exemplos locais reais: `~/.claude/plugins/cache/claude-plugins-official/playwright/1aa8f02ec832/.mcp.json` (`npx` + `args`, e curiosamente **sem** o wrapper `mcpServers` — forma aceita na prática), `~/.claude/plugins/cache/thedotmack/claude-mem/13.25.1/.mcp.json` (`"type": "stdio"` + `command: node` + `-e` com um localizador de raiz), `~/.claude/plugins/synced/*/design/.mcp.json` (`"type": "http"` + `url` + bloco `oauth` com `clientId`/`callbackPort`).

**`cwd`: não confirmado.** Nenhum `.mcp.json` ou `plugin.json` sob `~/.claude/plugins/` usa `cwd`, e a doc de plugins não lista esse campo. Assuma que o servidor herda o cwd da sessão e passe caminhos absolutos via `${CLAUDE_PLUGIN_ROOT}` / `env` em vez de depender de cwd.

**Interpretador de venv:** a substituição de `${CLAUDE_PLUGIN_ROOT}` vale em `command`, `args` e `env` de servidores stdio (doc, tabela de escopo de substituição), então `"command": "${CLAUDE_PLUGIN_ROOT}/auditor/.venv/bin/python"` é a forma correta de apontar para um venv empacotado. Caminho relativo puro (`./auditor/.venv/bin/python`) **não** é confirmado como resolvido contra a raiz do plugin — não use. Caminho absoluto fixo (`/Users/.../automaster_v2/auditor/.venv/bin/python`) funciona, mas só na sua máquina.

Detalhe importante: o venv **não** viaja bem via git/marketplace (binários, shebangs com path absoluto do criador). O padrão usado pelos plugins oficiais é um shim que descobre o interpretador em runtime — veja `~/.claude/plugins/cache/claude-plugins-official/security-guidance/2.0.8/hooks/sg-python.sh`, que testa `python3.13…3.10`, `python3`, `python`, `py -3` e faz `exec`. Alternativa da doc: `${CLAUDE_PLUGIN_DATA}` (`~/.claude/plugins/data/{id}/`) é o lugar declarado para "dependências, caches e código gerado" — ou seja, criar o venv lá no primeiro uso e apontar `command` para `${CLAUDE_PLUGIN_DATA}/venv/bin/python`.

**Falha do comando / dependência ausente:** a doc descreve o comportamento para LSP e diz que o mesmo painel vale para plugins: servidor que não sobe aparece na aba **Errors** do `/plugin` (ex.: `Executable not found in $PATH`); entrada com configuração inválida é ignorada silenciosamente e só aparece com `claude --debug`. Para MCP, `/mcp` mostra o estado de conexão. O resto da sessão continua funcionando — as ferramentas do servidor apenas não existem. Efeito prático: se o venv não existir, o plugin instala "ok" e falha mudo; trate isso com um hook SessionStart de diagnóstico (item 5). O padrão de erro explícito está no `.mcp.json` do claude-mem: se não acha o script, escreve em stderr e `process.exit(1)`.

## 3. Diretório de trabalho e descoberta do projeto

Sim, existe `${CLAUDE_PLUGIN_ROOT}` — diretório de instalação do plugin, caminho absoluto. Uso local comprovado em `~/.claude/plugins/cache/claude-video/watch/0.2.0/hooks/hooks.json` e `.../superpowers/6.3.0/hooks/hooks.json`. Variáveis documentadas:

| Variável | Resolve para |
|---|---|
| `${CLAUDE_PLUGIN_ROOT}` | diretório de instalação do plugin (absoluto) |
| `${CLAUDE_PLUGIN_DATA}` | `~/.claude/plugins/data/{id}/`, persistente entre updates |
| `${CLAUDE_PROJECT_DIR}` | raiz do projeto da sessão |

Onde o plugin é instalado de fato: `~/.claude/plugins/cache/<marketplace>/<plugin>/<versão>/`, registrado com `installPath` absoluto em `~/.claude/plugins/installed_plugins.json`. Ou seja, o código do automaster viaja junto com o plugin e é achável por `${CLAUDE_PLUGIN_ROOT}` — o repositório original do usuário não precisa existir na máquina.

A sessão roda no projeto do usuário, não no seu repo. Três eixos distintos, não confunda:
- **código da ferramenta** → `${CLAUDE_PLUGIN_ROOT}` (extractor/, auditor/).
- **dados/saídas do run** → decisão sua: `${CLAUDE_PROJECT_DIR}` (dentro do projeto do usuário) ou `${CLAUDE_PLUGIN_DATA}` (fora, persistente). Passe a escolha por `env` no `.mcp.json`; o servidor não deve adivinhar.
- **cwd do processo MCP** → não especificado pela doc; trate como desconhecido e nunca use caminhos relativos no servidor.

Note que, para o processo MCP stdio, `${CLAUDE_PROJECT_DIR}` é resolvido **no momento de iniciar o servidor** — se o usuário abrir outro projeto, o servidor é de outra sessão. Não confirmado se um servidor de plugin é reiniciado ao trocar de diretório (existe evento de hook `CwdChanged`, o que sugere que o cwd pode mudar em sessão). Caminho seguro: o servidor recebe o diretório-alvo como **argumento da tool**, não do ambiente.

## 4. Comando longo e interativo (Chrome + login manual)

Viável, com ressalvas. O que a doc/os arquivos suportam:
- Um comando/skill de plugin é markdown; o trabalho pesado sai de um `Bash` que roda um script do plugin (`${CLAUDE_PLUGIN_ROOT}/extractor/...`). Não há limite de tempo documentado para comandos de plugin — o limite prático é a ferramenta Bash (timeout por chamada, máximo alto mas finito) e o fato de o processo bloquear o turno.
- Hooks **têm** `timeout` explícito (ex.: `"timeout": 5` em `~/.claude/plugins/cache/claude-video/watch/0.2.0/hooks/hooks.json`) — então nunca coloque o login no hook.
- "Esperar login manual" dentro de um Bash em foreground é o modo errado: o agente fica travado e não há stdin do usuário para o script. Padrões viáveis: (a) lançar o Chrome em background/desanexado e o comando faz polling de uma condição (cookie/arquivo de sessão gravado) até aparecer, com timeout e mensagem clara; (b) o processo grava um `storageState` do Playwright em `${CLAUDE_PLUGIN_DATA}` e o comando só instrui "faça login na janela aberta; me diga quando terminar", encerrando o turno e retomando no próximo — o usuário é o sinal.
- Um MCP server do plugin pode manter o browser vivo entre chamadas (é um processo longo por natureza), o que é mais limpo que um Bash: tool `abrir_login` retorna imediatamente, tool `checar_sessao` responde depois. É exatamente o que o plugin `playwright` faz (`@playwright/mcp`, servidor persistente com browser).
- Limitações: nada headless-obrigatório (precisa de display/macOS GUI, ok aqui); a UI do Claude Code não exibe a janela; e não há mecanismo documentado para o comando "pausar e pedir input do usuário" no meio de um Bash.

## 5. Hook de pós-instalação

**Não existe evento de post-install documentado.** A lista de eventos na doc é: `SessionStart`/`SessionEnd`, `UserPromptSubmit`/`UserPromptExpansion`, `PreToolUse`/`PostToolUse`/`PostToolUseFailure`/`PostToolBatch`, `PermissionRequest`/`PermissionDenied`, `SubagentStart`/`SubagentStop`, `FileChanged`, `CwdChanged`, `DirectoryAdded`, `ConfigChange`, `InstructionsLoaded` — nenhum `PostInstall`. Tipos de hook: `command`, `http`, `mcp_tool`, `prompt`, `agent`.

O padrão real de setup é **SessionStart que detecta e instrui**, com o setup pesado num script rodado uma vez. Exemplo exato do que você quer, já em disco: `~/.claude/plugins/cache/claude-video/watch/0.2.0/hooks/scripts/check-setup.sh` — verifica `ffmpeg`/`yt-dlp` e chaves em `~/.config/watch/.env`, sai silencioso se tudo ok, e senão imprime uma linha `"/watch: needs ffmpeg + yt-dlp. Run python3 $CLAUDE_PLUGIN_ROOT/skills/watch/scripts/setup.py once"`. Hook com `"timeout": 5`, o que reforça: detectar é rápido, instalar não é do hook.

Dois complementos: `userConfig` no `plugin.json` pede valores ao usuário no momento do enable (não roda código); e a doc de hooks sugere explicitamente `SessionStart` chamando um `install-deps.sh` em `${CLAUDE_PLUGIN_DATA}` — ou seja, o próprio Anthropic trata SessionStart como o substituto de post-install. Há também `after-install.md` na raiz do ponytail (`~/.claude/plugins/cache/ponytail/ponytail/4.8.4/after-install.md`), mas **não confirmei** que o Claude Code leia esse arquivo automaticamente; pode ser só documentação do autor.

Recomendação para o automaster: `hooks/hooks.json` com SessionStart barato (existe `${CLAUDE_PLUGIN_ROOT}/auditor/.venv/bin/python`? `node_modules` do extractor? browsers do Playwright instalados?) que, faltando algo, imprime uma linha apontando para `/automaster:setup` — e o comando `setup` faz `python3 -m venv`, `pip install`, `npm ci`, `npx playwright install chromium`, tudo dentro de `${CLAUDE_PLUGIN_ROOT}` ou `${CLAUDE_PLUGIN_DATA}`.

## Itens não confirmados

- Campo `cwd` em servidor MCP de plugin (ausente na doc e em todos os manifestos locais).
- Resolução de caminho relativo puro em `command`/`args` (use `${CLAUDE_PLUGIN_ROOT}`).
- Se o MCP server do plugin reinicia ao mudar de projeto/cwd na mesma sessão.
- Se `after-install.md` na raiz do plugin tem semântica para o Claude Code.
- Comportamento exato de erro de um MCP server de plugin que falha ao subir (inferido da seção de LSP + aba Errors do `/plugin`; não vi texto específico para MCP de plugin).
- Timeout máximo real de um comando de plugin que roda um processo longo via Bash.
