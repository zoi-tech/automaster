"""Agrega as 3 camadas de validação de um dump num único dado para o validation.html.

Camada 1 = regras de auditoria (rules.run_all); Camada 2 = enumeração de
caminhos (flow.enumerate_paths, árvore com semântica do paths.md);
Camada 3 = contratos declarados (opcional — sem diretório → indisponível).
"""

from __future__ import annotations

from pathlib import Path

from . import rules
from .contract import ContractError, run_contracts
from .finding import ERROR, INFO, WARN
from .flow import enumerate_paths, index_steps
from .loader import DumpContext
from .path_report import _fmt_terminal, _Trie, _trie, describe_step

_SEV_ORDER = {ERROR: 0, WARN: 1, INFO: 2}


def _tree(node: _Trie, seg: list[str], by_id: dict[str, dict], ctx: DumpContext) -> list[dict]:
    """Trie de paths → nós {text, children}; colapsa trechos lineares (como paths.md)."""
    out: list[dict] = []
    while True:
        for t in node.terminals:
            out.append({"text": " → ".join(seg + [_fmt_terminal(t, by_id)]), "children": []})
        if not node.children:
            return out
        if len(node.children) == 1:
            (sid, label), child = next(iter(node.children.items()))
            if label is None:
                seg = seg + [describe_step(by_id.get(sid) or {}, ctx)]
                node = child
                continue
        break
    children: list[dict] = []
    for (sid, label), child in node.children.items():
        head = label if label is not None else describe_step(by_id.get(sid) or {}, ctx)
        children.extend(_tree(child, [head], by_id, ctx))
    if seg:
        return out + [{"text": " → ".join(seg), "children": children}]
    return out + children


def _camada1(ctx: DumpContext) -> dict:
    findings = sorted(rules.run_all(ctx), key=lambda f: (_SEV_ORDER.get(f.severity, 9), f.rule))
    return {
        "achados": [
            {"rule": f.rule, "severity": f.severity, "workflow_name": f.workflow_name or "", "detail": f.detail}
            for f in findings
        ],
        "counts": {s: sum(1 for f in findings if f.severity == s) for s in (ERROR, WARN, INFO)},
    }


def _camada2(ctx: DumpContext) -> dict:
    wfs: list[dict] = []
    total = 0
    n_trunc = 0
    for wf in ctx.workflows:
        paths, truncated = enumerate_paths(wf)
        total += len(paths)
        n_trunc += 1 if truncated else 0
        by_id = index_steps(wf)
        wfs.append(
            {
                "id": wf.id,
                "name": wf.name or wf.id,
                "status": wf.status,
                "n_paths": len(paths),
                "truncated": truncated,
                "tree": _tree(_trie(paths), [], by_id, ctx) if paths else [],
            }
        )
    return {"workflows": wfs, "total_paths": total, "truncated": n_trunc}


def _camada3(ctx: DumpContext, contracts_dir: Path | None) -> dict:
    if contracts_dir is None or not Path(contracts_dir).is_dir():
        return {"disponivel": False}
    try:
        results = run_contracts(ctx, contracts_dir)
    except ContractError as e:
        return {"disponivel": False, "erro": str(e)}
    return {
        "disponivel": True,
        "casos": [{"workflow": r.workflow, "caso": r.caso, "status": r.status, "motivo": r.motivo} for r in results],
        "counts": {s: sum(1 for r in results if r.status == s) for s in ("PASS", "FAIL", "AMBIGUOUS")},
    }


def build_validation(ctx: DumpContext, contracts_dir: Path | None = None) -> dict:
    """Monta o dado das 3 camadas (meta + camada1/2/3) para renderizar o HTML."""
    return {
        "meta": {
            "locationId": ctx.manifest.get("locationId", "?"),
            "extractedAt": ctx.manifest.get("extractedAt", "?"),
            "n_workflows": len(ctx.workflows),
        },
        "camada1": _camada1(ctx),
        "camada2": _camada2(ctx),
        "camada3": _camada3(ctx, contracts_dir),
    }
