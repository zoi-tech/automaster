"""WARN: ciclo de chamadas entre workflows (add_to_workflow).

Ex.: A chama B e B chama A. Pode ser handoff intencional (com condição de saída)
ou loop infinito. Reportado uma vez por ciclo para revisão.
"""

from __future__ import annotations

from ..finding import WARN, Finding
from ._helpers import steps_of_type


def check(ctx) -> list[Finding]:
    # grafo de chamadas: wf -> {wf alvos existentes no dump}
    graph: dict[str, set[str]] = {w.id: set() for w in ctx.workflows}
    for wf, step in steps_of_type(ctx, "add_to_workflow"):
        tgt = step.get("attributes", {}).get("workflow_id")
        if tgt in graph:
            graph[wf.id].add(tgt)

    cycles = _find_cycles(graph)
    findings: list[Finding] = []
    reported: set[frozenset] = set()
    for cycle in cycles:
        key = frozenset(cycle)
        if key in reported:
            continue
        reported.add(key)
        # O ciclo é um anel: qual nó o DFS vê primeiro depende da ordem de iteração, e
        # ancorar nele fazia o MESMO dump gerar relatórios diferentes em duas rodadas —
        # ruído puro no `diff` de snapshots. Começa sempre no menor id.
        inicio = cycle.index(min(cycle))
        cycle = cycle[inicio:] + cycle[:inicio]
        names = " → ".join(ctx.workflow_names.get(c, c) for c in cycle + [cycle[0]])
        # ancora o achado no primeiro workflow do ciclo
        findings.append(
            Finding(
                rule="workflow_call_cycle",
                severity=WARN,
                workflow_id=cycle[0],
                workflow_name=ctx.workflow_names.get(cycle[0], cycle[0]),
                detail=f"ciclo de chamadas add_to_workflow: {names}",
            )
        )
    return findings


def _find_cycles(graph: dict[str, set[str]]) -> list[list[str]]:
    """DFS detectando ciclos; retorna um caminho por ciclo encontrado."""
    cycles: list[list[str]] = []
    WHITE, GREY, BLACK = 0, 1, 2
    color = {n: WHITE for n in graph}
    stack: list[str] = []

    def dfs(n: str) -> None:
        color[n] = GREY
        stack.append(n)
        for m in sorted(graph.get(n, ())):
            if color.get(m, WHITE) == GREY:
                # ciclo: do ponto m até o topo da pilha
                idx = stack.index(m)
                cycles.append(stack[idx:])
            elif color.get(m, WHITE) == WHITE:
                dfs(m)
        stack.pop()
        color[n] = BLACK

    for n in graph:
        if color[n] == WHITE:
            dfs(n)
    return cycles
