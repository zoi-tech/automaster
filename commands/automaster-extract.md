---
description: Extrai workflows e entidades de uma subconta GHL para ~/.automaster/dumps (pode pedir login numa janela do Chrome na primeira vez)
argument-hint: <locationId>
allowed-tools: Bash
---

Extraia a subconta `$ARGUMENTS` com o extractor do plugin.

1. Se `${CLAUDE_PLUGIN_ROOT}/extractor/node_modules` não existir, avise que o setup baixa ~410 MB (Chromium) e rode uma vez:
   ```bash
   cd "${CLAUDE_PLUGIN_ROOT}/extractor" && npm ci && npx playwright install chromium
   ```
2. Rode a extração (se o GHL pedir login, ele acontece numa janela que o processo de fundo mostra; a sessão fica salva em `~/.automaster/chrome-profile`):
   ```bash
   cd "${CLAUDE_PLUGIN_ROOT}/extractor" && AUTOMASTER_DUMPS="$HOME/.automaster/dumps" npm run extract -- --location $ARGUMENTS
   ```
3. Ao terminar, chame a tool `dumps()` e confirme o snapshot novo. Reporte contagem de workflows e warnings do manifest, nada mais.

Sem `locationId`, pergunte qual subconta antes de rodar qualquer coisa.
