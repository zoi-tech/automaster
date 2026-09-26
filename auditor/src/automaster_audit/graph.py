"""Constrói um grafo de conexões entre entidades do dump GHL.

Nós: workflows, tags, pipelines, stages, custom fields, triggers.
Arestas: cada referência de um workflow a uma entidade (via steps/triggers).

Entidades só entram no grafo se forem referenciadas ao menos uma vez (evita
poluir com tags/fields órfãos); workflows entram sempre.
"""

from __future__ import annotations

from .loader import DumpContext, Workflow

# tipos de nó e cores (usadas no HTML)
NODE_TYPES = {
    "workflow": "#4f86f7",
    "tag": "#21ba45",
    "pipeline": "#a333c8",
    "stage": "#c956b1",
    "field": "#f2a900",
    "trigger": "#00b5ad",
    "user": "#c77dff",
}


def _field_name(ctx: DumpContext, fid: str) -> str:
    return ctx.field_names.get(fid, fid)


def _add_node(nodes: dict, nid: str, label: str, ntype: str, *, missing: bool = False) -> str:
    if nid not in nodes:
        nodes[nid] = {"id": nid, "label": label, "type": ntype, "missing": missing}
    return nid


def build_graph(ctx: DumpContext) -> dict:
    nodes: dict[str, dict] = {}
    edges: list[dict] = []

    # workflows entram sempre
    for wf in ctx.workflows:
        _add_node(nodes, f"wf:{wf.id}", wf.name or wf.id, "workflow")

    for wf in ctx.workflows:
        wf_node = f"wf:{wf.id}"
        for step in wf.steps:
            _edges_from_step(ctx, wf, wf_node, step, nodes, edges)
        for trig in wf.triggers:
            tname = trig.get("name") or trig.get("masterType") or "trigger"
            tnode = _add_node(nodes, f"trig:{wf.id}:{tname}", tname, "trigger")
            edges.append({"from": tnode, "to": wf_node, "rel": "trigger"})

    # consolida arestas duplicadas em peso
    merged: dict[tuple, dict] = {}
    for e in edges:
        key = (e["from"], e["to"], e["rel"])
        if key in merged:
            merged[key]["weight"] += 1
        else:
            merged[key] = {**e, "weight": 1}

    return {"nodes": list(nodes.values()), "edges": list(merged.values())}


def _edges_from_step(ctx: DumpContext, wf: Workflow, wf_node: str, step: dict, nodes: dict, edges: list) -> None:
    t = step.get("type")
    attrs = step.get("attributes", {}) or {}

    if t in ("add_contact_tag", "remove_contact_tag"):
        for tag in attrs.get("tags", []) or []:
            missing = not ctx.has_tag(tag)
            n = _add_node(nodes, f"tag:{tag.strip().lower()}", tag, "tag", missing=missing)
            edges.append({"from": wf_node, "to": n, "rel": t.replace("_contact", "")})

    elif t == "update_contact_field":
        for f in attrs.get("fields", []) or []:
            fid = f.get("field")
            if fid:
                missing = fid not in ctx.field_ids
                label = f.get("title") or _field_name(ctx, fid)
                n = _add_node(nodes, f"field:{fid}", label, "field", missing=missing)
                edges.append({"from": wf_node, "to": n, "rel": "update_field"})

    elif t == "find_opportunity":
        for inp in attrs.get("__customInputFields__", []) or []:
            if inp.get("filterField") == "pipeline_id":
                pid = inp.get("secondValue")
                if pid:
                    _pipeline_edge(ctx, wf_node, pid, nodes, edges, "find_opportunity")

    elif t == "internal_create_opportunity":
        pid = attrs.get("pipelineId")
        if pid:
            _pipeline_edge(ctx, wf_node, pid, nodes, edges, "create_opportunity")
        for inp in attrs.get("__customInputFields__", []) or []:
            if inp.get("filterField") == "pipelineStageId":
                sid = inp.get("value")
                if sid:
                    missing = sid not in ctx.stage_ids
                    label = ctx.stage_names.get(sid, sid)
                    n = _add_node(nodes, f"stage:{sid}", label, "stage", missing=missing)
                    edges.append({"from": wf_node, "to": n, "rel": "create_in_stage"})

    elif t == "add_to_workflow":
        target = attrs.get("workflow_id")
        if target:
            missing = target not in ctx.workflow_ids
            label = ctx.workflow_names.get(target, target) if not missing else f"(externo) {target}"
            n = _add_node(nodes, f"wf:{target}", label, "workflow", missing=missing)
            edges.append({"from": wf_node, "to": n, "rel": "add_to_workflow"})

    elif t == "assign_user":
        uids = set((attrs.get("traffic_weightage") or {}).keys())
        uids.update(ti["id"] for ti in attrs.get("traffic_index", []) or [] if ti.get("id"))
        for uid in uids:
            _user_edge(ctx, wf_node, uid, nodes, edges, "assign")

    elif t == "internal_notification":
        for uid in (attrs.get("sms") or {}).get("selectedUser", []) or []:
            _user_edge(ctx, wf_node, uid, nodes, edges, "notify")


def _pipeline_edge(ctx: DumpContext, wf_node: str, pid: str, nodes: dict, edges: list, rel: str) -> None:
    missing = pid not in ctx.pipeline_ids
    label = ctx.pipeline_names.get(pid, pid)
    n = _add_node(nodes, f"pipe:{pid}", label, "pipeline", missing=missing)
    edges.append({"from": wf_node, "to": n, "rel": rel})


def _user_edge(ctx: DumpContext, wf_node: str, uid: str, nodes: dict, edges: list, rel: str) -> None:
    # missing se usuários foram extraídos e o id não existe ou está deletado
    known = bool(ctx.user_ids)
    missing = known and (uid not in ctx.user_ids or uid in ctx.user_deleted)
    label = ctx.user_names.get(uid, uid)
    n = _add_node(nodes, f"user:{uid}", label, "user", missing=missing)
    edges.append({"from": wf_node, "to": n, "rel": rel})
