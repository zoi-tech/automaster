"""WARN: workflow publicado sem nenhum trigger."""
from __future__ import annotations

from ..finding import WARN, Finding
from ..loader import DumpContext


def check(ctx: DumpContext) -> list[Finding]:
    findings: list[Finding] = []
    for wf in ctx.workflows:
        if wf.status == "published" and not wf.triggers:
            findings.append(
                Finding(
                    rule="no_trigger",
                    severity=WARN,
                    workflow_id=wf.id,
                    workflow_name=wf.name,
                    detail="workflow publicado não possui nenhum trigger",
                )
            )
    return findings
