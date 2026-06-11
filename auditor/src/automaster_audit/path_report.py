"""Gera paths.md: árvore de caminhos de execução por workflow (Camada 2).

Rotula ações com os nomes legíveis do DumpContext; não avalia condições.
"""
from __future__ import annotations

from pathlib import Path

from .flow import enumerate_paths, index_steps
from .loader import DumpContext

_SIMPLE = {
    "sms": "SMS",
    "wait": "Wait",
    "drip": "Drip",
    "webhook": "Webhook",
    "manual-call": "Manual call",
}


def _resolve(ids: list[str], names: dict[str, str]) -> str:
    return ", ".join(names.get(i, i) for i in ids)


def describe_step(step: dict, ctx: DumpContext) -> str:
    """Rótulo legível de um step. Id sem nome → id cru; tipo desconhecido → o type."""
    t = step.get("type") or "?"
    a = step.get("attributes") or {}
    if t in _SIMPLE:
        return _SIMPLE[t]
    if t in ("add_contact_tag", "remove_contact_tag"):
        verb = "add tag" if t == "add_contact_tag" else "remove tag"
        tags = [x for x in (a.get("tags") or []) if isinstance(x, str)]
        return f"{verb} {', '.join(tags)}" if tags else verb
    if t == "update_contact_field":
        ids = [f.get("field") for f in (a.get("fields") or []) if isinstance(f, dict) and f.get("field")]
        return f"update field {_resolve(ids, ctx.field_names)}" if ids else "update field"
    if t == "add_to_workflow":
        wid = a.get("workflow_id") or ""
        return f"add to workflow {ctx.workflow_names.get(wid, wid)}"
    if t == "internal_notification":
        sms = a.get("sms")
        sel = sms.get("selectedUser") if isinstance(sms, dict) else None
        if isinstance(sel, str):
            sel = [sel]
        sel = [x for x in (sel or []) if isinstance(x, str)]
        return f"notificar {_resolve(sel, ctx.user_names)}" if sel else "notificar"
    if t == "internal_create_opportunity":
        parts = []
        pid = a.get("pipelineId") or ""
        if pid:
            parts.append(ctx.pipeline_names.get(pid, pid))
        for f in a.get("__customInputFields__") or []:
            if isinstance(f, dict) and f.get("filterField") == "pipelineStageId" and f.get("value"):
                parts.append(f"stage {ctx.stage_names.get(f['value'], f['value'])}")
                break
        return "criar oportunidade" + (f" ({', '.join(parts)})" if parts else "")
    if t == "assign_user":
        tw = a.get("traffic_weightage")
        uids = [k for k in tw if isinstance(k, str)] if isinstance(tw, dict) else []
        return f"assign user {_resolve(uids, ctx.user_names)}" if uids else "assign user"
    if t == "goto":
        return f"goto → {a.get('targetNodeId') or '?'}"
    if t in ("if_else", "find_opportunity"):
        return step.get("name") or t
    return t


class _Trie:
    """Árvore de prefixos dos paths: os caminhos compartilham prefixo até divergir num ramo."""

    __slots__ = ("children", "terminals")

    def __init__(self) -> None:
        self.children: dict[tuple[str, str | None], _Trie] = {}
        self.terminals: list[str] = []


def _trie(paths) -> _Trie:
    root = _Trie()
    for p in paths:
        node = root
        for key in p.steps:
            node = node.children.setdefault(key, _Trie())
        node.terminals.append(p.terminal)
    return root


def _fmt_terminal(t: str, by_id: dict[str, dict]) -> str:
    if t == "exit":
        return "[fim]"
    if t.startswith("loop → "):
        sid = t[len("loop → "):]
        return f"(loop → {(by_id.get(sid) or {}).get('name') or sid})"
    return f"({t})"


def _render(node: _Trie, seg: list[str], indent: int, lines: list[str],
            by_id: dict[str, dict], ctx: DumpContext) -> None:
    while True:
        for t in node.terminals:
            lines.append("    " * indent + "- " + " → ".join(seg + [_fmt_terminal(t, by_id)]))
        if not node.children:
            return
        if len(node.children) == 1:
            (sid, label), child = next(iter(node.children.items()))
            if label is None:
                seg = seg + [describe_step(by_id.get(sid) or {}, ctx)]
                node = child
                continue
        break
    if seg:
        lines.append("    " * indent + "- " + " → ".join(seg))
        indent += 1
    for (sid, label), child in node.children.items():
        head = label if label is not None else describe_step(by_id.get(sid) or {}, ctx)
        _render(child, [head], indent, lines, by_id, ctx)


def build_paths_report(ctx: DumpContext, cap: int = 500) -> str:
    lines = [
        f"# Caminhos de execução — {ctx.manifest.get('locationId', '?')}",
        "",
        f"- Extraído em: {ctx.manifest.get('extractedAt', '?')}",
        f"- Workflows: {len(ctx.workflows)}",
        "",
    ]
    for wf in ctx.workflows:
        paths, truncated = enumerate_paths(wf, cap=cap)
        lines += [f"## {wf.name or wf.id}", ""]
        if truncated:
            lines += [f"⚠ truncado em {cap} caminhos", ""]
        if not paths:
            lines += ["(sem steps)", ""]
            continue
        _render(_trie(paths), [], 0, lines, index_steps(wf), ctx)
        lines.append("")
    return "\n".join(lines)


def write_paths_report(ctx: DumpContext, out: Path, cap: int = 500) -> Path:
    out = Path(out)
    out.write_text(build_paths_report(ctx, cap=cap), encoding="utf-8")
    return out
