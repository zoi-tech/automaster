---
description: Gera report e paths do dump mais recente de uma subconta
argument-hint: <locationId> [snapshot]
allowed-tools: Bash, mcp__automaster__dumps
---

Gere os relatórios do dump de `$ARGUMENTS` (snapshot mais recente se não informado).

1. Resolva a pasta: `~/.automaster/dumps/<locationId>/<snapshot>/`. Sem locationId, chame `dumps()` e pergunte.
2. Rode, a partir de `${CLAUDE_PLUGIN_ROOT}/auditor`:
   ```bash
   PY="${CLAUDE_PLUGIN_ROOT}/bin/automaster-python.sh"; export PYTHONPATH="${CLAUDE_PLUGIN_ROOT}/auditor/src"
   D=~/.automaster/dumps/<loc>/<snapshot>
   for c in audit paths; do "$PY" -m automaster_audit.cli $c "$D"; done
   ```
   `audit` sai com código 1 quando há ERROR: isso é resultado, não falha.
3. Reporte só os contadores impressos (ERROR/WARN/INFO, caminhos) e o caminho do `report.md`. A interpretação segue a skill `automaster-leitura`.
