#!/usr/bin/env bash
# Diagnóstico barato: o MCP que não sobe falha mudo, então avisamos aqui. Silencioso quando tudo ok.
root="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
if ! "$root/bin/automaster-python.sh" -c 'pass' 2>/dev/null; then
  echo "automaster: falta python3 >= 3.12 — as tools MCP não vão subir. 'brew install python@3.12' e reabra."
fi
dumps="${AUTOMASTER_DUMPS:-$HOME/.automaster/dumps}"
if [ ! -d "$dumps" ] || [ -z "$(ls -A "$dumps" 2>/dev/null)" ]; then
  echo "automaster: nenhum dump em $dumps — rode /automaster-extract <locationId> para a primeira extração."
fi
exit 0
