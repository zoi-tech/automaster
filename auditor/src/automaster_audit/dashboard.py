"""Agrega o dump num inventário navegável (workflows, tags, fields, pipelines).

Reusa a varredura de refs: para cada workflow lista canais, tags/fields tocados,
chamadas a outros fluxos e quem o chama. Para cada entidade, o índice reverso de
quais workflows a usam (e flag de órfã = existe mas ninguém referencia).
"""
from __future__ import annotations

import json
import re
from collections import Counter

from .loader import DumpContext, Workflow
from .rules._helpers import add_to_workflow_targets

CHANNEL_TYPES = ("sms", "email", "whatsapp", "internal_notification", "webhook", "drip", "manual-call")
_CV_TOKEN = re.compile(r"custom_values\.([a-zA-Z0-9_]+)")


def _cond_tags(obj) -> set[str]:
    """Tags citadas em condições de branch (contact_detail/tags), em qualquer profundidade."""
    out: set[str] = set()
    if isinstance(obj, dict):
        if obj.get("conditionType") == "contact_detail" and obj.get("conditionSubType") == "tags":
            v = obj.get("conditionValue")
            out.update(x for x in (v if isinstance(v, list) else [v]) if isinstance(x, str))
        for v in obj.values():
            out |= _cond_tags(v)
    elif isinstance(obj, list):
        for v in obj:
            out |= _cond_tags(v)
    return out


def _wf_refs(wf: Workflow) -> dict:
    """Extrai tags (nome -> papéis), fields, pipelines, chamadas, canais, usuários e custom values.

    Papéis de tag: dispara (trigger contact_tag), adiciona, remove, condicao (branch ou trigger).
    """
    tags: dict[str, set[str]] = {}

    def tag(name, papel):
        tags.setdefault(name, set()).add(papel)

    for t in wf.triggers:
        for c in t.get("conditions", []) or []:
            if c.get("field") == "tagsAdded" and isinstance(c.get("value"), str):
                tag(c["value"], "dispara")
            elif c.get("field") == "contact.tags":
                v = c.get("value")
                for x in (v if isinstance(v, list) else [v]):
                    if isinstance(x, str):
                        tag(x, "condicao")
    fields: set[str] = set()
    pipelines: set[str] = set()
    calls: set[str] = set()
    users: set[str] = set()
    cvs: set[str] = set()
    channels: Counter = Counter()
    for s in wf.steps:
        t = s.get("type")
        a = s.get("attributes", {}) or {}
        if t in CHANNEL_TYPES:
            channels[t] += 1
        if t in ("add_contact_tag", "remove_contact_tag"):
            for name in a.get("tags", []) or []:
                tag(name, "adiciona" if t == "add_contact_tag" else "remove")
        elif t == "if_else":
            for name in _cond_tags(a):
                tag(name, "condicao")
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
        elif t == "assign_user":
            users.update((a.get("traffic_weightage") or {}).keys())
            users.update(ti["id"] for ti in a.get("traffic_index", []) or [] if ti.get("id"))
        elif t == "internal_notification":
            users.update((a.get("sms") or {}).get("selectedUser", []) or [])
        cvs.update(m.lower() for m in _CV_TOKEN.findall(json.dumps(a, ensure_ascii=False)))
    return {"tags": tags, "fields": fields, "pipelines": pipelines, "calls": calls,
            "users": users, "cvs": cvs, "channels": channels}


def build_dashboard(ctx: DumpContext) -> dict:
    called = add_to_workflow_targets(ctx)
    refs = {wf.id: _wf_refs(wf) for wf in ctx.workflows}

    # índice reverso entidade -> workflows
    tag_users: dict[str, list[str]] = {}
    tag_papeis: dict[str, set[str]] = {}
    field_users: dict[str, list[str]] = {}
    pipe_users: dict[str, list[str]] = {}
    called_by: dict[str, list[str]] = {}
    user_users: dict[str, list[str]] = {}
    cv_users: dict[str, list[str]] = {}
    for wf in ctx.workflows:
        r = refs[wf.id]
        for tag, papeis in r["tags"].items():
            key = tag.strip().lower()
            tag_users.setdefault(key, []).append(wf.name)
            tag_papeis.setdefault(key, set()).update(papeis)
        for fid in r["fields"]:
            field_users.setdefault(fid, []).append(wf.name)
        for pid in r["pipelines"]:
            pipe_users.setdefault(pid, []).append(wf.name)
        for tid in r["calls"]:
            called_by.setdefault(tid, []).append(wf.name)
        for uid in r["users"]:
            user_users.setdefault(uid, []).append(wf.name)
        for cv in r["cvs"]:
            cv_users.setdefault(cv, []).append(wf.name)

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
        {"name": name, "used_by": sorted(tag_users.get(name, [])), "orphan": name not in tag_users,
         "papeis": sorted(tag_papeis.get(name, ()))}
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

    # usuários
    users = []
    for u in ctx.users:
        uid = u.get("id") or u.get("_id")
        used = sorted(user_users.get(uid, []))
        users.append({
            "name": u.get("name") or f"{u.get('firstName','')} {u.get('lastName','')}".strip() or uid,
            "email": u.get("email", ""),
            "deleted": bool(u.get("deleted")),
            "used_by": used,
            "orphan": not used,
        })
    users.sort(key=lambda x: x["name"].lower())

    # custom values (chave -> usado por)
    custom_values = []
    for cv in ctx.custom_values:
        keys = _CV_TOKEN.findall(cv.get("fieldKey", "") or "")
        keyset = {k.lower() for k in keys} or {(cv.get("name", "")).strip().lower()}
        used = sorted({w for k in keyset for w in cv_users.get(k, [])})
        custom_values.append({
            "name": cv.get("name", "") or next(iter(keyset), ""),
            "token": next(iter(keyset), ""),
            "used_by": used,
            "orphan": not used,
        })
    custom_values.sort(key=lambda x: x["name"].lower())

    # calendários (backup; sem refs de workflow)
    calendars = sorted(
        ({"name": c.get("name", c.get("id", "")), "active": bool(c.get("isActive", True)),
          "type": c.get("eventType", "")} for c in ctx.calendars),
        key=lambda x: x["name"].lower(),
    )

    summary = {
        "workflows": len(ctx.workflows),
        "published": sum(1 for w in ctx.workflows if w.status == "published"),
        "draft": sum(1 for w in ctx.workflows if w.status == "draft"),
        "tags": len(tags),
        "tags_orphan": sum(1 for t in tags if t["orphan"]),
        "fields": len(fields),
        "fields_orphan": sum(1 for f in fields if f["orphan"]),
        "pipelines": len(pipelines),
        "users": len(users),
        "calendars": len(calendars),
        "custom_values": len(custom_values),
        "cv_orphan": sum(1 for c in custom_values if c["orphan"]),
    }

    return {"summary": summary, "workflows": workflows, "tags": tags, "fields": fields,
            "pipelines": pipelines, "users": users, "calendars": calendars, "custom_values": custom_values}
