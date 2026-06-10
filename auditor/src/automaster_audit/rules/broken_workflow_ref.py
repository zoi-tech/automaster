"""ERROR: add_to_workflow apontando para workflow inexistente no dump.

attributes.workflow_id = id do workflow alvo.
"""
from __future__ import annotations

from ..finding import ERROR, Finding
from ..loader import DumpContext
from ._helpers import steps_of_type


def check(ctx: DumpContext) -> list[Finding]:
    findings: list[Finding] = []
    for wf, step in steps_of_type(ctx, "add_to_workflow"):
        target = step.get("attributes", {}).get("workflow_id")
        if target and target not in ctx.workflow_ids:
            findings.append(
                Finding(
                    rule="broken_workflow_ref",
                    severity=ERROR,
                    workflow_id=wf.id,
                    workflow_name=wf.name,
                    detail=f"step '{step.get('name', step.get('type'))}' aponta para workflow inexistente: {target}",
                )
            )
    return findings
