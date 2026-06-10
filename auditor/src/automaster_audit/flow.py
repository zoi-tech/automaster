"""Grafo de execução de um workflow (derivado dos steps do dump).

Modelo (reverso-engenheirado do GHL):
- step.next = id do próximo step (linear) OU lista de ids de nós-branch (container
  if_else/find_opportunity). Cada nó-branch tem next = início do corpo do ramo.
- step.parent ausente → raiz (entrada após o trigger).
- goto: attributes.targetNodeId = salto para outro step do mesmo workflow.
- next vazio/ausente → terminal (contato sai do workflow).
"""
from __future__ import annotations

from .loader import Workflow


def successors(step: dict) -> list[str]:
    """Ids dos próximos nós a partir de um step (trata lista, string, goto)."""
    out: list[str] = []
    nxt = step.get("next")
    if isinstance(nxt, list):
        out += [x for x in nxt if isinstance(x, str) and x]
    elif isinstance(nxt, str) and nxt:
        out.append(nxt)
    if step.get("type") == "goto":
        tgt = step.get("attributes", {}).get("targetNodeId")
        if isinstance(tgt, str) and tgt:
            out.append(tgt)
    return out


def index_steps(wf: Workflow) -> dict[str, dict]:
    return {s["id"]: s for s in wf.steps if s.get("id")}


def roots(wf: Workflow) -> list[str]:
    """Steps sem parent = pontos de entrada (após o trigger)."""
    return [s["id"] for s in wf.steps if s.get("id") and not s.get("parent")]


def reachable(wf: Workflow) -> set[str]:
    """Conjunto de ids alcançáveis a partir das raízes seguindo successors+goto."""
    by_id = index_steps(wf)
    start = roots(wf)
    seen: set[str] = set()
    stack = list(start)
    while stack:
        nid = stack.pop()
        if nid in seen or nid not in by_id:
            continue
        seen.add(nid)
        stack.extend(successors(by_id[nid]))
    return seen


def is_branch_node(step: dict) -> bool:
    """Nó-branch = ramo de um container (transition, ou if_else filho com else/condição)."""
    if step.get("type") == "transition":
        return True
    if step.get("type") == "if_else" and step.get("parent"):
        a = step.get("attributes", {})
        return not a.get("branches")  # container tem branches; ramo não
    return False
