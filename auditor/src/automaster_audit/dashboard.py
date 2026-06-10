"""Agrega o dump num inventário navegável (workflows, tags, fields, pipelines).

Reusa a varredura de refs: para cada workflow lista canais, tags/fields tocados,
chamadas a outros fluxos e quem o chama. Para cada entidade, o índice reverso de
quais workflows a usam (e flag de órfã = existe mas ninguém referencia).
"""
from __future__ import annotations

from collections import Counter

from .loader import DumpContext, Workflow
from .rules._helpers import add_to_workflow_targets

CHANNEL_TYPES = ("sms", "email", "whatsapp", "internal_notification", "webhook", "drip", "manual-call")


def _wf_refs(wf: Workflow) -> dict:
    """Extrai tags, fields, pipelines, chamadas e canais de um workflow."""
    tags: set[str] = set()
    fields: set[str] = set()
    pipelines: set[str] = set()
    calls: set[str] = set()
    channels: Counter = Counter()
    for s in wf.steps:
        t = s.get("type")
        a = s.get("attributes", {}) or {}
        if t in CHANNEL_TYPES:
            channels[t] += 1
        if t in ("add_contact_tag", "remove_contact_tag"):
            for tag in a.get("tags", []) or []:
                tags.add(tag)
        elif t == "update_contact_field":
            for f in a.get("fields", []) or []:
                if f.get("field"):
                    fields.add(f["field"])
        elif t == "find_opportunity":
            for inp in a.get("__customInputFields__", []) or []:
                if inp.get("filterField") == "pipeline_id" and inp.get("secondValue"):
                    pipelines.add(inp["secondValue"])
        elif t == "internal_create_opportunity":
            if a.get("pipelineId"):
                pipelines.add(a["pipelineId"])
        elif t == "add_to_workflow":
            if a.get("workflow_id"):
                calls.add(a["workflow_id"])
    return {"tags": tags, "fields": fields, "pipelines": pipelines, "calls": calls, "channels": channels}


def build_dashboard(ctx: DumpContext) -> dict:
    called = add_to_workflow_targets(ctx)
    refs = {wf.id: _wf_refs(wf) for wf in ctx.workflows}

    # índice reverso entidade -> workflows
    tag_users: dict[str, list[str]] = {}
    field_users: dict[str, list[str]] = {}
    pipe_users: dict[str, list[str]] = {}
    called_by: dict[str, list[str]] = {}
    for wf in ctx.workflows:
        r = refs[wf.id]
        for tag in r["tags"]:
            tag_users.setdefault(tag.strip().lower(), []).append(wf.name)
        for fid in r["fields"]:
            field_users.setdefault(fid, []).append(wf.name)
        for pid in r["pipelines"]:
            pipe_users.setdefault(pid, []).append(wf.name)
        for tid in r["calls"]:
            called_by.setdefault(tid, []).append(wf.name)

    workflows = []
    for wf in ctx.workflows:
        r = refs[wf.id]
        workflows.append({
            "id": wf.id,
            "name": wf.name,
            "status": wf.status,
            "n_steps": len(wf.steps),
            "triggers": [t.get("name", "?") for t in wf.triggers],
            "channels": dict(r["channels"]),
            "n_tags": len(r["tags"]),
            "n_fields": len(r["fields"]),
            "calls": sorted(ctx.workflow_names.get(c, f"(externo) {c}") for c in r["calls"]),
            "called_by": sorted(called_by.get(wf.id, [])),
            "has_entry": bool(wf.triggers) or wf.id in called,
        })

    # entidades: todas as existentes + flag órfã
    tags = [
        {"name": name, "used_by": sorted(tag_users.get(name, [])), "orphan": name not in tag_users}
        for name in sorted(ctx.tag_names)
    ]
    fields = [
        {"name": ctx.field_names.get(fid, fid), "used_by": sorted(field_users.get(fid, [])), "orphan": fid not in field_users}
        for fid in sorted(ctx.field_ids, key=lambda x: ctx.field_names.get(x, x).lower())
    ]
    pipelines = [
        {"name": ctx.pipeline_names.get(pid, pid), "used_by": sorted(pipe_users.get(pid, []))}
        for pid in sorted(ctx.pipeline_ids)
    ]

    summary = {
        "workflows": len(ctx.workflows),
        "published": sum(1 for w in ctx.workflows if w.status == "published"),
        "draft": sum(1 for w in ctx.workflows if w.status == "draft"),
        "tags": len(tags),
        "tags_orphan": sum(1 for t in tags if t["orphan"]),
        "fields": len(fields),
        "fields_orphan": sum(1 for f in fields if f["orphan"]),
        "pipelines": len(pipelines),
    }

    return {"summary": summary, "workflows": workflows, "tags": tags, "fields": fields, "pipelines": pipelines}
