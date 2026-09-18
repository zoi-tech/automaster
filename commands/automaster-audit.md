---
description: Gera report, dashboard, graph, validation e journey do dump mais recente de uma subconta e abre o dashboard
argument-hint: <locationId> [snapshot]
allowed-tools: Bash, mcp__automaster__dumps
---

Gere as entregas para humano do dump de `$ARGUMENTS` (snapshot mais recente se não informado).

1. Resolva a pasta: `~/.automaster/dumps/<locationId>/<snapshot>/`. Sem locationId, chame `dumps()` e pergunte.
2. Rode, a partir de `${CLAUDE_PLUGIN_ROOT}/auditor`:
   ```bash
   PY="${CLAUDE_PLUGIN_ROOT}/bin/automaster-python.sh"; export PYTHONPATH="${CLAUDE_PLUGIN_ROOT}/auditor/src"
   D=~/.automaster/dumps/<loc>/<snapshot>
   for c in audit dashboard graph validation journey; do "$PY" -m automaster_audit.cli $c "$D"; done
   open "$D/dashboard.html"
   ```
   `audit` sai com código 1 quando há ERROR: isso é resultado, não falha.
3. Reporte só os contadores impressos (ERROR/WARN/INFO, órfãs, caminhos) e o caminho do dashboard. A interpretação segue a skill `automaster-leitura`.
