# 005 — Casca, dumps e setup

Map: [Automaster como plugin do Claude Code](../map-plugin-claude-code.md)
Type: `wayfinder:grilling`
Status: fechado (2026-09-18)
Assignee: claude
Blocked by: 002

## Pergunta

Onde os dumps moram quando o plugin roda fora deste repositório, como o plugin acha o
`.venv` e o `node_modules`, e o que o usuário faz numa máquina nova antes da primeira
pergunta funcionar.

Três rotas para o setup, com custos diferentes: um comando `/automaster-setup` que
provisiona tudo; o plugin exigir o repositório clonado e configurado; ou o MCP falhar com
mensagem que ensina.

Depende do 002: as rotas viáveis são as que o manifesto permite.

## Resolução

Grilling com o usuário em 2026-09-18, depois de uma medição que mudou a pergunta.

### O achado: o auditor não precisa de setup nenhum

`auditor/pyproject.toml` **não declara nenhuma dependência**, e todos os imports de
`src/automaster_audit/` são stdlib: `argparse`, `collections`, `dataclasses`, `datetime`,
`html`, `importlib`, `json`, `operator`, `pathlib`, `pkgutil`, `re`, `sys`. Rodei
`build_dashboard` sobre o dump da Instaltech com `PYTHONPATH=src python3`, sem venv: passou.

Isso invalida a recomendação do [002](002-anatomia-plugin.md) de provisionar o venv em
`${CLAUDE_PLUGIN_DATA}` — seria um venv vazio. O 002 estava certo sobre o venv não viajar;
errado ao supor que ele precisa existir.

A ressalva é a versão. `/usr/bin/python3` do macOS é 3.9.6 e **quebra**: `finding.py` usa
`str | None` numa dataclass, que é avaliado em runtime. O Homebrew desta máquina tem 3.11,
3.13 e 3.14. O piso real é 3.10 pela sintaxe, 3.12 pelo `requires-python`.

Consequência direta: das sete tools do [004](004-superficie-do-mcp.md), **nenhuma precisa
de provisionamento**. Só o extractor precisa — 54 MB de `node_modules` e cerca de 356 MB de
Chromium do Playwright.

### Os dumps moram em `~/.automaster/dumps`

Acervo único da ZOI, ao lado do `chrome-profile` que já vive em `~/.automaster/` (346 MB,
caminho fixado em `extractor/src/auth/session.ts:12`). Uma subconta extraída de qualquer
sessão fica visível para todas as outras, que é o ponto do plugin.

Recusadas: `${CLAUDE_PLUGIN_DATA}`, correto no papel mas enterrado em
`~/.claude/plugins/data/` e apagável junto com o plugin; e dumps por projeto, que
transforma a mesma subconta em dois acervos e esbarra no congelamento do
`${CLAUDE_PROJECT_DIR}` que o 002 levantou.

Migração: os 57 MB e 12 subcontas de `dumps/` deste repositório vão uma vez para lá. Atenção
ao symlink `dumps/6ICT3KsGLmamzMUI7VQS` → `dumps/clientec Odontologia/`, que existe porque
o comando `timeline` procura por locationId — ele precisa sobreviver à mudança.

O código quase não muda: `dump/writer.ts` já recebe `baseDir` por parâmetro. O que está
hardcoded é uma linha, `extractor/src/cli.ts:27` (`path.resolve(process.cwd(), "..", "dumps")`).

### O Python vem de um shim que descobre

Script que testa `python3.14`, `python3.13`, `python3.12` e `python3`, confere
`sys.version_info >= (3,12)` e faz `exec`. É o padrão do próprio Anthropic — o 002 achou o
exemplo literal em `sg-python.sh` do plugin `security-guidance`. Falhando todos, escreve em
stderr a linha que ensina, porque o 002 também mediu que um MCP server que não sobe falha
mudo: o plugin instala "ok" e as tools simplesmente não existem.

### O extractor entra na v1, com setup sob demanda

`/automaster-extract` existe desde a v1, mas só provisiona `npm ci` e
`npx playwright install chromium` na primeira vez que for chamado, avisando antes do custo.
Quem só consulta dump nunca paga os ~410 MB.

Recusadas: um `/automaster-setup` que provisiona tudo de uma vez, que cobra os 410 MB de
quem talvez nunca extraia; e deixar o extractor fora da v1, que contradiz a nota do mapa de
que o plugin cobre extractor e auditor.

O `SessionStart` do 002 continua valendo, mas fica barato de verdade: ele não checa venv
nem `node_modules`, só que existe um `python3` ≥ 3.12. O resto é o comando que avisa.

## Verificação

```
grep -c dependencies auditor/pyproject.toml          # 0
grep -rhoE '^(import|from) [a-z_]+' auditor/src | awk '{print $2}' | sort -u   # só stdlib
cd auditor && PYTHONPATH=src python3 -c "
from automaster_audit.dashboard import build_dashboard
from automaster_audit.loader import load_dump
from pathlib import Path
print(build_dashboard(load_dump(Path('../dumps/Xb9gDxwxYhdqtprGcb5E/2026-07-30_1221')))['summary'])
"
PYTHONPATH=src /usr/bin/python3 -c "import automaster_audit.finding"   # TypeError, 3.9.6
du -sh extractor/node_modules ~/Library/Caches/ms-playwright/chromium-1243
```
