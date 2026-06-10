"""ERROR: update_contact_field referenciando custom field inexistente.

attributes.fields[] = [{field: <id>, value, title, ...}]. `field` é o id do custom field.
"""
from __future__ import annotations

from ..finding import ERROR, Finding
from ..loader import DumpContext
from ._helpers import steps_of_type


def check(ctx: DumpContext) -> list[Finding]:
    findings: list[Finding] = []
    for wf, step in steps_of_type(ctx, "update_contact_field"):
        for f in step.get("attributes", {}).get("fields", []) or []:
            fid = f.get("field")
            if fid and fid not in ctx.field_ids:
                title = f.get("title") or fid
                findings.append(
                    Finding(
                        rule="broken_field_ref",
                        severity=ERROR,
                        workflow_id=wf.id,
                        workflow_name=wf.name,
                        detail=f"step '{step.get('name', step.get('type'))}' usa custom field inexistente: {title!r} (id {fid})",
                    )
                )
    return findings
