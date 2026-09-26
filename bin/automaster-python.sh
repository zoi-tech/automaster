#!/usr/bin/env bash
# Acha um Python >= 3.12 (o auditor usa `str | None`; o /usr/bin/python3 do macOS é 3.9) e faz exec.
# A raiz do plugin sai da posição deste script: ${CLAUDE_PLUGIN_ROOT} não é expandido no bloco env do .mcp.json.
root="$(cd "$(dirname "$0")/.." && pwd)"
export CLAUDE_PLUGIN_ROOT="$root"
export PYTHONPATH="$root/auditor/src${PYTHONPATH:+:$PYTHONPATH}"
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"
for py in python3.14 python3.13 python3.12 python3; do
  if command -v "$py" >/dev/null 2>&1 && "$py" -c 'import sys; sys.exit(0 if sys.version_info >= (3,12) else 1)' 2>/dev/null; then
    exec "$py" "$@"
  fi
done
echo "automaster: nenhum python3 >= 3.12 no PATH. Instale com 'brew install python@3.12' (ou uv/pyenv) e reabra a sessão." >&2
exit 1
