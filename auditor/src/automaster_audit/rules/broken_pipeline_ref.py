"""ERROR: action referenciando pipeline ou stage inexistente.

Fontes de referência a pipeline/stage:
- find_opportunity: attributes.__customInputFields__[] com filterField=='pipeline_id' → secondValue
- internal_create_opportunity: attributes.pipelineId; e __customInputFields__[] com
  filterField=='pipelineStageId' → value (stage id)
"""
from __future__ import annotations

from ..finding import ERROR, Finding
from ..loader import DumpContext
from ._helpers import steps_of_type


def check(ctx: DumpContext) -> list[Finding]:
    findings: list[Finding] = []

    for wf, step in steps_of_type(ctx, "find_opportunity"):
        for inp in step.get("attributes", {}).get("__customInputFields__", []) or []:
            if inp.get("filterField") == "pipeline_id":
                pid = inp.get("secondValue")
                if pid and pid not in ctx.pipeline_ids:
                    findings.append(_f(wf, step, f"pipeline inexistente: {pid!r}"))

    for wf, step in steps_of_type(ctx, "internal_create_opportunity"):
        attrs = step.get("attributes", {})
        pid = attrs.get("pipelineId")
        if pid and pid not in ctx.pipeline_ids:
            findings.append(_f(wf, step, f"pipeline inexistente: {pid!r}"))
        for inp in attrs.get("__customInputFields__", []) or []:
            if inp.get("filterField") == "pipelineStageId":
                sid = inp.get("value")
                if sid and sid not in ctx.stage_ids:
                    findings.append(_f(wf, step, f"stage inexistente: {sid!r}"))

    return findings


def _f(wf, step, detail: str) -> Finding:
    return Finding(
        rule="broken_pipeline_ref",
        severity=ERROR,
        workflow_id=wf.id,
        workflow_name=wf.name,
        detail=f"step '{step.get('name', step.get('type'))}' {detail}",
    )
