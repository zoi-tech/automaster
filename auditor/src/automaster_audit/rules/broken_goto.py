"""ERROR: step goto apontando para um nó que não existe no workflow."""

from __future__ import annotations

from ..finding import ERROR, Finding
from ..flow import index_steps


def check(ctx) -> list[Finding]:
    findings: list[Finding] = []
    for wf in ctx.workflows:
        ids = set(index_steps(wf).keys())
        for step in wf.steps:
            if step.get("type") != "goto":
                continue
            tgt = step.get("attributes", {}).get("targetNodeId")
            if tgt and tgt not in ids:
                findings.append(
                    Finding(
                        rule="broken_goto",
                        severity=ERROR,
                        workflow_id=wf.id,
                        workflow_name=wf.name,
                        detail=f"step '{step.get('name', 'Go To')}' salta para nó inexistente: {tgt}",
                    )
                )
    return findings
