"""Compara dois dumps da mesma subconta: o que mudou entre dois snapshots.

Trabalho puramente local — os dois dumps já estão no disco e o loader já os lê.
Workflow alterado é detectado por nome, status e pela impressão digital dos
steps e dos triggers (JSON canônico com chaves ordenadas). Entidades comparam
por id (ou por nome, nas tags e nas chaves de custom value).
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from .loader import DumpContext


def _fp(value) -> str:
    """Impressão digital estável de um pedaço do dump."""
    return hashlib.sha1(
        json.dumps(value, sort_keys=True, ensure_ascii=False, default=str).encode("utf-8")
    ).hexdigest()


def _esc(text: str) -> str:
    """Escapa o pipe: nome de workflow vindo do CRM costuma ter um."""
    return (text or "").replace("|", "\\|")


def _tpl(ctx: DumpContext, canal: str) -> dict[str, str] | None:
    ids = ctx.template_ids.get(canal)
    return None if ids is None else {i: ctx.template_names.get(i, i) for i in ids}


def _entities(ctx: DumpContext) -> dict[str, dict[str, str] | None]:
    """Entidades de cada dump como {tipo: {chave: rótulo}}."""
    return {
        "pipelines": dict(ctx.pipeline_names),
        "estágios": dict(ctx.stage_names),
        "tags": {t: t for t in ctx.tag_names},
        "custom fields": dict(ctx.field_names),
        "usuários": dict(ctx.user_names),
        "calendários": {
            c.get("id"): c.get("name", c.get("id", "")) for c in ctx.calendars if c.get("id")
        },
        "custom values": {k: k for k in ctx.cv_keys},
        # None = canal ausente do dump (extração anterior aos templates); comparar
        # contra ele diria "81 templates novos" quando nada mudou.
        "templates de mensagem": _tpl(ctx, "message"),
        "templates de WhatsApp": _tpl(ctx, "whatsapp"),
        "templates de e-mail": _tpl(ctx, "email"),
    }


def build_diff(antes: DumpContext, depois: DumpContext) -> dict:
    """Monta o diff estruturado entre dois DumpContext."""
    a_wf = {w.id: w for w in antes.workflows}
    d_wf = {w.id: w for w in depois.workflows}

    adicionados = [
        {"id": i, "nome": d_wf[i].name, "status": d_wf[i].status} for i in d_wf.keys() - a_wf.keys()
    ]
    removidos = [
        {"id": i, "nome": a_wf[i].name, "status": a_wf[i].status} for i in a_wf.keys() - d_wf.keys()
    ]

    alterados = []
    for wid in a_wf.keys() & d_wf.keys():
        a, d = a_wf[wid], d_wf[wid]
        mudancas = []
        if a.name != d.name:
            mudancas.append(f"nome: {a.name!r} → {d.name!r}")
        if a.status != d.status:
            mudancas.append(f"status: {a.status} → {d.status}")
        if _fp(a.steps) != _fp(d.steps):
            mudancas.append(f"steps: {len(a.steps)} → {len(d.steps)} (conteúdo alterado)")
        if _fp(a.triggers) != _fp(d.triggers):
            mudancas.append(f"triggers: {len(a.triggers)} → {len(d.triggers)} (conteúdo alterado)")
        if mudancas:
            alterados.append({"id": wid, "nome": d.name, "mudancas": mudancas})

    ent_a, ent_d = _entities(antes), _entities(depois)
    entidades = {}
    for tipo in ent_a:
        if ent_a[tipo] is None or ent_d[tipo] is None:
            continue
        novos = sorted(ent_d[tipo][k] for k in ent_d[tipo].keys() - ent_a[tipo].keys())
        sumidos = sorted(ent_a[tipo][k] for k in ent_a[tipo].keys() - ent_d[tipo].keys())
        if novos or sumidos:
            entidades[tipo] = {"adicionados": novos, "removidos": sumidos}

    return {
        "antes": {
            "path": str(antes.path),
            "extractedAt": antes.manifest.get("extractedAt"),
            "locationId": antes.manifest.get("locationId"),
            "workflows": len(antes.workflows),
        },
        "depois": {
            "path": str(depois.path),
            "extractedAt": depois.manifest.get("extractedAt"),
            "locationId": depois.manifest.get("locationId"),
            "workflows": len(depois.workflows),
        },
        "mesma_subconta": antes.manifest.get("locationId") == depois.manifest.get("locationId"),
        "workflows": {
            "adicionados": sorted(adicionados, key=lambda x: x["nome"]),
            "removidos": sorted(removidos, key=lambda x: x["nome"]),
            "alterados": sorted(alterados, key=lambda x: x["nome"]),
        },
        "entidades": entidades,
        "sem_mudanca": not (adicionados or removidos or alterados or entidades),
    }


def render_md(diff: dict) -> str:
    a, d = diff["antes"], diff["depois"]
    w = diff["workflows"]
    lines = [
        f"# Diferença entre snapshots — {d['locationId']}",
        "",
        f"- Antes: `{Path(a['path']).name}` ({a['extractedAt']}) — {a['workflows']} workflows",
        f"- Depois: `{Path(d['path']).name}` ({d['extractedAt']}) — {d['workflows']} workflows",
        "",
    ]
    if not diff["mesma_subconta"]:
        lines += [f"> Atenção: subcontas diferentes ({a['locationId']} vs {d['locationId']}).", ""]
    if diff["sem_mudanca"]:
        lines += ["Nada mudou entre os dois snapshots.", ""]
        return "\n".join(lines)

    lines += [
        "## Sumário",
        "",
        "| Mudança | Quantidade |",
        "|---|---|",
        f"| Workflows adicionados | {len(w['adicionados'])} |",
        f"| Workflows removidos | {len(w['removidos'])} |",
        f"| Workflows alterados | {len(w['alterados'])} |",
        "",
    ]

    for titulo, chave in (("Workflows adicionados", "adicionados"), ("Workflows removidos", "removidos")):
        if w[chave]:
            lines += [f"## {titulo}", "", "| Workflow | Status | Id |", "|---|---|---|"]
            lines += [f"| {_esc(x['nome'])} | {x['status']} | `{x['id']}` |" for x in w[chave]]
            lines.append("")

    if w["alterados"]:
        lines += ["## Workflows alterados", "", "| Workflow | O que mudou |", "|---|---|"]
        for x in w["alterados"]:
            detalhe = "<br>".join(_esc(m) for m in x["mudancas"])
            lines.append(f"| {_esc(x['nome'])} | {detalhe} |")
        lines.append("")

    if diff["entidades"]:
        lines += ["## Entidades", "", "| Tipo | Adicionados | Removidos |", "|---|---|---|"]
        for tipo, e in diff["entidades"].items():
            nov = _esc(", ".join(e["adicionados"]) or "—")
            sum_ = _esc(", ".join(e["removidos"]) or "—")
            lines.append(f"| {tipo} | {nov} | {sum_} |")
        lines.append("")

    return "\n".join(lines)


def write_diff(diff: dict, out: Path) -> Path:
    out = Path(out)
    out.write_text(render_md(diff), encoding="utf-8")
    return out
