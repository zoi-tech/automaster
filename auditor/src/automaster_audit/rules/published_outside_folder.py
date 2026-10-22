"""WARN: workflow publicado fora de qualquer pasta."""

from __future__ import annotations

from ..finding import WARN, Finding


def check(ctx) -> list[Finding]:
    findings: list[Finding] = []
    for wf in ctx.workflows:
        if wf.status != "published":
            continue
        if (wf.raw.get("list_entry") or {}).get("parentId"):
            continue
        findings.append(
            Finding(
                rule="published_outside_folder",
                severity=WARN,
                workflow_id=wf.id,
                workflow_name=wf.name,
                detail="workflow publicado solto, fora de pasta",
            )
        )
    return findings
