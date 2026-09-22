"""Servidor MCP (stdio, JSON-RPC): protocolo e junção das tools.

As tools moram em `mcp/`, um módulo por domínio; aqui fica só o transporte.
Importa o auditor como biblioteca: nunca lê os JSON do dump por conta própria.
Raiz dos dumps vem de AUTOMASTER_DUMPS (default ~/.automaster/dumps).
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from .mcp import (
    agenda as _m_agenda,
)
from .mcp import (
    contato as _m_contato,
)
from .mcp import (
    conversas as _m_conversas,
)
from .mcp import (
    dump as _m_dump,
)
from .mcp import (
    emails as _m_emails,
)
from .mcp import (
    formularios as _m_formularios,
)
from .mcp import (
    oportunidades as _m_oportunidades,
)
from .mcp import (
    tags as _m_tags,
)
from .mcp import (
    workflows as _m_workflows,
)

# Re-export de leitura: `mcp_server._ctx` e afins seguem sendo o MESMO objeto.
from .mcp.base import (  # noqa: F401
    EXTRACTOR_DIR,
    ToolError,
    _ctx,
    _load,
    _root,
    _run_extractor,
    _run_timeline,
)

PROTOCOL = "2025-06-18"

TOOLS = {
    **_m_dump.TOOLS,
    **_m_contato.TOOLS,
    **_m_conversas.TOOLS,
    **_m_tags.TOOLS,
    **_m_oportunidades.TOOLS,
    **_m_agenda.TOOLS,
    **_m_formularios.TOOLS,
    **_m_workflows.TOOLS,
    **_m_emails.TOOLS,
}

# Re-export: a tool é chamada por nome a partir daqui, e os testes também.
from .mcp.agenda import agenda, agenda_acao  # noqa: F401
from .mcp.contato import anotacao_acao, anotacoes, contato, editar  # noqa: F401
from .mcp.conversas import config, conversa_acao, conversas, enviar, grupo, whatsapp, whatsapp_enviar  # noqa: F401
from .mcp.dump import achados, buscar, comparar, dumps, inventario, jornada, workflow  # noqa: F401
from .mcp.emails import modelos_email  # noqa: F401
from .mcp.formularios import formulario_acao, formulario_estilo, formularios  # noqa: F401
from .mcp.oportunidades import oportunidade_acao, oportunidades, pipeline  # noqa: F401
from .mcp.tags import tag_acao, tags  # noqa: F401
from .mcp.workflows import (  # noqa: F401  # noqa: E402,F401
    _WF_EDITAR_COM_CORPO,
    WF_EDITAR_ACOES,
    workflow_acao,
    workflow_editar,
    workflows_ao_vivo,
)


def _tool_list() -> list[dict]:
    return [{"name": n, "description": d,
             "inputSchema": {"type": "object", "properties": p, "required": r}}
            for n, (_, d, p, r) in TOOLS.items()]


def _version() -> str:
    """Versão do plugin.json (a raiz vem do shim); "0" quando o servidor roda fora do plugin."""
    root = os.environ.get("CLAUDE_PLUGIN_ROOT")
    if not root:
        return "0"
    try:
        return json.loads((Path(root) / ".claude-plugin" / "plugin.json").read_text())["version"]
    except Exception:  # noqa: BLE001 - versão é informativa; fora do plugin ou com manifesto torto, devolve "0"
        return "0"


def handle(req: dict) -> dict | None:
    rid, method, params = req.get("id"), req.get("method"), req.get("params") or {}
    if method == "initialize":
        result = {"protocolVersion": PROTOCOL, "capabilities": {"tools": {}},
                  "serverInfo": {"name": "automaster", "version": _version()}}
    elif method == "tools/list":
        result = {"tools": _tool_list()}
    elif method == "tools/call":
        name = params.get("name")
        if name not in TOOLS:
            return {"jsonrpc": "2.0", "id": rid, "error": {"code": -32602, "message": f"tool desconhecida: {name}"}}
        try:
            body = TOOLS[name][0](**(params.get("arguments") or {}))
            result = {"content": [{"type": "text", "text": json.dumps(body, ensure_ascii=False)}]}
        except (ToolError, TypeError) as e:
            result = {"content": [{"type": "text", "text": str(e)}], "isError": True}
    elif method == "ping":
        result = {}
    elif rid is None:
        return None  # notificação (initialized, cancelled…)
    else:
        return {"jsonrpc": "2.0", "id": rid, "error": {"code": -32601, "message": f"método desconhecido: {method}"}}
    return {"jsonrpc": "2.0", "id": rid, "result": result}


def main() -> int:
    root = _root()
    if not root.is_dir():
        print(f"automaster mcp: raiz de dumps não existe: {root} (AUTOMASTER_DUMPS)", file=sys.stderr)
        return 1
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            resp = handle(json.loads(line))
        except json.JSONDecodeError:
            resp = {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "JSON inválido"}}
        if resp is not None:
            sys.stdout.write(json.dumps(resp, ensure_ascii=False) + "\n")
            sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
