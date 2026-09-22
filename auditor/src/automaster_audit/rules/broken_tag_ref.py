"""ERROR: action add/remove tag referenciando tag inexistente.

Tags em GHL são referenciadas por nome (em add_contact_tag/remove_contact_tag,
campo attributes.tags = lista de nomes).
"""

from __future__ import annotations

from ..finding import ERROR, Finding
from ..loader import DumpContext
from ._helpers import steps_of_type


def check(ctx: DumpContext) -> list[Finding]:
    findings: list[Finding] = []
    for wf, step in steps_of_type(ctx, "add_contact_tag", "remove_contact_tag"):
        for tag in step.get("attributes", {}).get("tags", []) or []:
            if not ctx.has_tag(tag):
                findings.append(
                    Finding(
                        rule="broken_tag_ref",
                        severity=ERROR,
                        workflow_id=wf.id,
                        workflow_name=wf.name,
                        detail=f"step '{step.get('name', step.get('type'))}' usa tag inexistente: {tag!r}",
                    )
                )
    return findings
