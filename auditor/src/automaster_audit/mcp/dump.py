"""Tools que só leem o dump em disco."""

from __future__ import annotations

from collections import Counter
from pathlib import Path

from ..diff import build_diff
from ..path_report import workflow_paths_lines
from . import base
from .base import _LOC, _SNAP, FATIAS, ToolError, _findings, _journey, _manifest, _root, _snapshot, _snapshots


def dumps() -> list[dict]:
    root = _root()
    if not root.is_dir():
        raise ToolError(f"raiz de dumps não existe: {root}; rode /automaster-extract")
    seen: dict[Path, dict] = {}
    for d in sorted(root.iterdir()):
        if not d.is_dir():
            continue
        snaps = _snapshots(d)
        if not snaps:
            continue
        real = d.resolve()
        m = _manifest(d / snaps[0])
        loc = m.get("locationId") or d.name
        entry = seen.setdefault(
            real, {"loc": loc, "nome": "", "snapshots": snaps, "extractedAt": m.get("extractedAt", "")}
        )
        if d.name != loc:
            entry["nome"] = d.name
    return list(seen.values())


def inventario(loc: str, fatia: str | None = None, snapshot: str | None = None) -> dict:
    ctx, meta = base._load(loc, snapshot)
    dash = base._dash(str(ctx.path))
    if fatia is None:
        return {"summary": dash["summary"], "_snapshot": meta}
    if fatia not in FATIAS:
        raise ToolError(f"fatia {fatia!r} inválida; use uma de {FATIAS}")
    if fatia == "workflows":
        por_wf: dict[str, Counter] = {}
        for f in _findings(str(ctx.path)):
            if f.workflow_id:
                por_wf.setdefault(f.workflow_id, Counter())[f.severity] += 1
        vazio = Counter()
        wfs = [
            {**w, "achados": {s: por_wf.get(w["id"], vazio)[s] for s in ("ERROR", "WARN", "INFO")}}
            for w in dash["workflows"]
        ]
        return {"workflows": wfs, "_snapshot": meta}
    return {fatia: dash[fatia], "_snapshot": meta}


def workflow(loc: str, id: str, snapshot: str | None = None) -> dict:
    ctx, meta = base._load(loc, snapshot)
    w = next((x for x in ctx.workflows if x.id == id), None)
    if w is None:
        hint = [x.id for x in ctx.workflows if id.lower() in (x.name or "").lower()]
        raise ToolError(
            f"workflow {id!r} não existe"
            + (
                f"; por nome, candidatos: {hint[:5]}"
                if hint
                else "; use buscar(termo) ou inventario(fatia='workflows')"
            )
        )
    dash = base._dash(str(ctx.path))
    entry = next(e for e in dash["workflows"] if e["id"] == id)
    meta_wf = {
        k: entry[k]
        for k in (
            "id",
            "name",
            "status",
            "n_steps",
            "triggers",
            "channels",
            "n_tags",
            "n_fields",
            "calls",
            "called_by",
            "has_entry",
        )
    }
    meta_wf["updatedAt"] = w.updated_at
    text = "\n".join(workflow_paths_lines(w, ctx))
    truncated = len(text) > base.PATHS_MAX_CHARS
    if truncated:
        text = text[: base.PATHS_MAX_CHARS].rsplit("\n", 1)[0] + "\n… (árvore truncada; abra paths.md para o resto)"
    achados = [_finding_dict(f) for f in _findings(str(ctx.path)) if f.workflow_id == id]
    return {"meta": meta_wf, "caminhos": text, "caminhos_truncado": truncated, "achados": achados, "_snapshot": meta}


def _finding_dict(f) -> dict:
    return {
        "rule": f.rule,
        "severity": f.severity,
        "workflow_id": f.workflow_id,
        "workflow": f.workflow_name,
        "detail": f.detail,
    }


def achados(loc: str, severidade: str | None = None, snapshot: str | None = None) -> dict:
    ctx, meta = base._load(loc, snapshot)
    all_f = _findings(str(ctx.path))
    counts = Counter({"ERROR": 0, "WARN": 0, "INFO": 0})
    counts.update(f.severity for f in all_f)
    if severidade and severidade not in counts:
        raise ToolError("severidade deve ser ERROR, WARN ou INFO")
    groups: dict[tuple, dict] = {}
    for f in all_f:
        if severidade and f.severity != severidade:
            continue
        g = groups.setdefault((f.rule, f.workflow_id, f.detail), {**_finding_dict(f), "n": 0})
        g["n"] += 1
    order = {"ERROR": 0, "WARN": 1, "INFO": 2}
    out = sorted(groups.values(), key=lambda g: (order[g["severity"]], g["rule"], g["workflow"] or ""))
    return {"counts": dict(counts), "achados": out, "_snapshot": meta}


def buscar(loc: str, termo: str, snapshot: str | None = None) -> dict:
    ctx, meta = base._load(loc, snapshot)
    dash = base._dash(str(ctx.path))
    q = termo.strip().lower()
    hit = lambda e: q in str(e.get("name", "")).lower() or q in str(e.get("token", "")).lower()
    out = {k: [e for e in dash[k] if hit(e)] for k in ("tags", "fields", "pipelines", "users", "custom_values")}
    out["workflows"] = [{"id": e["id"], "name": e["name"], "status": e["status"]} for e in dash["workflows"] if hit(e)]
    out["_snapshot"] = meta
    return out


def _slim(n: dict, profundidade: int) -> dict:
    out = {k: n.get(k) for k in ("kind", "label", "detail", "flags", "conds")}
    if "ttype" in n:
        out["ttype"] = n["ttype"]
    out["n_filhos"] = len(n.get("children") or [])
    if profundidade > 1 and out["n_filhos"]:
        out["filhos"] = [_slim(c, profundidade - 1) for c in n["children"]]
    return out


def jornada(loc: str, caminho: list[int] | None = None, profundidade: int = 1, snapshot: str | None = None) -> dict:
    ctx, meta = base._load(loc, snapshot)
    j = _journey(str(ctx.path))
    if not caminho:
        return {
            "criacao": [_slim(n, profundidade) for n in j["criacao"]],
            "anytime": [_slim(n, profundidade) for n in j["anytime"]],
            "_snapshot": meta,
        }
    roots = j["criacao"] + j["anytime"]
    node, trail = None, []
    for i in caminho:
        kids = roots if node is None else node.get("children") or []
        if not isinstance(i, int) or not 0 <= i < len(kids):
            raise ToolError(f"caminho {caminho} inválido em {trail}: só há {len(kids)} filho(s)")
        node = kids[i]
        trail.append(i)
    return {
        "caminho": caminho,
        "no": _slim(node, 1) | {"n_filhos": len(node.get("children") or [])},
        "filhos": [_slim(c, profundidade) for c in node.get("children") or []],
        "_snapshot": meta,
    }


def comparar(loc: str, antes: str | None = None, depois: str | None = None) -> dict:
    path_ultimo, _ = _snapshot(loc)  # valida a subconta e a raiz
    snaps = _snapshots(path_ultimo.parent)
    if len(snaps) < 2 and not (antes and depois):
        raise ToolError(f"subconta {loc!r} só tem {len(snaps)} snapshot; o diff precisa de dois")
    # _snapshots vem do mais recente para o mais antigo
    ctx_depois, meta_depois = base._load(loc, depois or snaps[0])
    ctx_antes, meta_antes = base._load(loc, antes or snaps[1])
    diff = build_diff(ctx_antes, ctx_depois)
    diff["_snapshot"] = {"antes": meta_antes, "depois": meta_depois}
    return diff


TOOLS = {
    "comparar": (
        comparar,
        (
            "Diff entre dois snapshots da mesma subconta: workflows adicionados/removidos/"
            "alterados (nome, status, steps, triggers) e entidades que entraram ou sumiram. Sem antes/depois, "
            "compara os dois mais recentes. Só lê o disco."
        ),
        {
            "loc": _LOC,
            "antes": {"type": "string", "description": "snapshot mais antigo (default: o penúltimo)"},
            "depois": {"type": "string", "description": "snapshot mais recente (default: o último)"},
        },
        ["loc"],
    ),
    "dumps": (dumps, "Lista subcontas com dump, snapshots e data. ~200 tokens.", {}, []),
    "inventario": (
        inventario,
        (
            "summary (~80 tokens) ou uma fatia: workflows, tags, fields, pipelines, "
            "users, calendars, custom_values (até ~20k tokens)."
        ),
        {"loc": _LOC, "fatia": {"type": "string", "enum": list(FATIAS)}, "snapshot": _SNAP},
        ["loc"],
    ),
    "workflow": (
        workflow,
        (
            "DO DUMP (pode estar velho; para o estado corrente use `workflows_ao_vivo`): "
            "meta, árvore de caminhos (teto ~1.5k tokens, flag caminhos_truncado) e achados de um workflow."
        ),
        {"loc": _LOC, "id": {"type": "string"}, "snapshot": _SNAP},
        ["loc", "id"],
    ),
    "achados": (
        achados,
        "Achados agrupados por (rule, workflow, detail) com n; counts por severidade sempre.",
        {"loc": _LOC, "severidade": {"type": "string", "enum": ["ERROR", "WARN", "INFO"]}, "snapshot": _SNAP},
        ["loc"],
    ),
    "buscar": (
        buscar,
        (
            "Termo em tags (com papeis: dispara/adiciona/remove/condicao), fields, pipelines, users, "
            "custom values e nomes de workflow."
        ),
        {"loc": _LOC, "termo": {"type": "string"}, "snapshot": _SNAP},
        ["loc", "termo"],
    ),
    "jornada": (
        jornada,
        (
            "Um nível da árvore de jornada por chamada (~60 tokens/nó). caminho é posicional, "
            "ex. [0,3,1], sobre criacao+anytime; profundidade expande filhos."
        ),
        {
            "loc": _LOC,
            "caminho": {"type": "array", "items": {"type": "integer"}},
            "profundidade": {"type": "integer", "default": 1},
            "snapshot": _SNAP,
        },
        ["loc"],
    ),
}
