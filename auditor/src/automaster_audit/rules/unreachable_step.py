"""WARN: step que nunca executa (não alcançável a partir da entrada do workflow).

Dead code no canvas — normalmente sobra de edição. Se o workflow não tem raiz
identificável (nenhum step sem parent), a checagem é pulada para esse workflow.
"""
from __future__ import annotations

from ..finding import WARN, Finding
from ..flow import index_steps, reachable, roots


def check(ctx) -> list[Finding]:
    findings: list[Finding] = []
    for wf in ctx.workflows:
        by_id = index_steps(wf)
        if not by_id or not roots(wf):
            continue  # sem entrada determinável
        reach = reachable(wf)
        for sid, step in by_id.items():
            if sid not in reach:
                findings.append(
                    Finding(
                        rule="unreachable_step",
                        severity=WARN,
                        workflow_id=wf.id,
                        workflow_name=wf.name,
                        detail=f"step '{step.get('name', step.get('type'))}' ({step.get('type')}) nunca é alcançado",
                    )
                )
    return findings
