"""WARN: gatilho de oportunidade sem filtro de pipeline numa subconta com 2 ou mais pipelines."""

from __future__ import annotations

from ..finding import WARN, Finding

TIPOS = {
    "opportunity_created",
    "opportunity_status_changed",
    "pipeline_stage_updated",
    "opportunity_decay",
    "opportunity_changed",
}


def _filtra_pipeline(trigger: dict) -> bool:
    return any(c.get("field") == "opportunity.pipelineId" for c in trigger.get("conditions") or [])


def check(ctx) -> list[Finding]:
    findings: list[Finding] = []
    if len(ctx.pipeline_ids) < 2:
        return findings
    for wf in ctx.workflows:
        if wf.status != "published":
            continue
        for t in wf.triggers:
            if t.get("type") not in TIPOS or not t.get("active") or t.get("deleted"):
                continue
            if _filtra_pipeline(t):
                continue
            findings.append(
                Finding(
                    rule="opportunity_trigger_no_pipeline",
                    severity=WARN,
                    workflow_id=wf.id,
                    workflow_name=wf.name,
                    detail=(
                        f"gatilho '{t.get('name', t.get('type'))}' ({t.get('type')}) não filtra pipeline — "
                        f"dispara em qualquer um dos {len(ctx.pipeline_ids)} pipelines"
                    ),
                )
            )
    return findings
