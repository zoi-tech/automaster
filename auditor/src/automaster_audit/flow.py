"""Grafo de execução de um workflow (derivado dos steps do dump).

Modelo (reverso-engenheirado do GHL):
- step.next = id do próximo step (linear) OU lista de ids de nós-branch (container
  if_else/find_opportunity). Cada nó-branch tem next = início do corpo do ramo.
- step.parentKey ausente → raiz (entrada após o trigger). O servidor usa parentKey;
  `parent` é o campo legado, presente em parte dos dumps e mantido como fallback.
- goto: attributes.targetNodeId = salto para outro step do mesmo workflow.
- next vazio/ausente → terminal (contato sai do workflow).
"""
from __future__ import annotations

from dataclasses import dataclass

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


def parent_of(step: dict) -> str | None:
    """Pai do step. O servidor grava `parentKey`; `parent` é o campo legado."""
    return step.get("parentKey") or step.get("parent")


def roots(wf: Workflow) -> list[str]:
    """Steps sem pai = pontos de entrada (após o trigger)."""
    return [s["id"] for s in wf.steps if s.get("id") and not parent_of(s)]


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
    if step.get("type") == "if_else" and parent_of(step):
        a = step.get("attributes", {})
        return not a.get("branches")  # container tem branches; ramo não
    return False


@dataclass
class Path:
    """Um caminho de execução: (step_id, rótulo do ramo tomado; None se linear) + terminal."""
    steps: list[tuple[str, str | None]]
    terminal: str  # "exit" | "loop → <step_id>"


def _branch_label(container: dict, node: dict) -> str | None:
    """Rótulo do ramo: name em branches do container, name da transition, ou ELSE."""
    if node.get("type") == "transition":
        name = node.get("name")
        return name if isinstance(name, str) else None
    for b in container.get("attributes", {}).get("branches") or []:
        if b.get("id") == node.get("id"):
            return b.get("name")
    if "else" in (node.get("attributes") or {}):
        return "ELSE"
    return None


def enumerate_paths(wf: Workflow, cap: int = 500) -> tuple[list[Path], bool]:
    """Enumera os caminhos de execução a partir das raízes, sem avaliar condições.

    Ciclo (goto/aresta de retorno) corta o caminho com terminal "loop → <id>".
    Devolve (paths, truncated); truncated=True quando o cap foi atingido.
    """
    by_id = index_steps(wf)
    paths: list[Path] = []
    truncated = False

    def emit(trail: list[tuple[str, str | None]], terminal: str) -> None:
        nonlocal truncated
        if len(paths) >= cap:
            truncated = True
            return
        paths.append(Path(steps=trail, terminal=terminal))

    def walk(nid: str, label: str | None, trail: list[tuple[str, str | None]], seen: set[str]) -> None:
        if truncated:
            return
        if nid in seen:
            emit(trail, f"loop → {nid}")
            return
        step = by_id.get(nid)
        if step is None:
            emit(trail, "exit")
            return
        trail = trail + [(nid, label)]
        seen = seen | {nid}
        succ = successors(step)
        if not succ:
            emit(trail, "exit")
            return
        if isinstance(step.get("next"), list):
            for sid in succ:
                walk(sid, _branch_label(step, by_id.get(sid, {})), trail, seen)
        else:
            for sid in succ:
                walk(sid, None, trail, seen)

    for rid in roots(wf):
        walk(rid, None, [], set())
    return paths, truncated
