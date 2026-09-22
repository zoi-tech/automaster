"""ERROR: mensagem usa {{custom_values.X}} que não existe na subconta.

Varre o corpo de cada step procurando tokens custom_values.X e compara com as
custom values definidas. Se a lista não foi extraída (dump antigo), não roda.
"""

from __future__ import annotations

import re

from ..finding import ERROR, Finding
from ..loader import DumpContext

_TOKEN = re.compile(r"custom_values\.([a-zA-Z0-9_]+)")


def check(ctx: DumpContext) -> list[Finding]:
    if not ctx.cv_keys:
        return []  # custom values não extraídas neste dump
    findings: list[Finding] = []
    for wf in ctx.workflows:
        for step in wf.steps:
            seen: set[str] = set()
            for key in _TOKEN.findall(str(step.get("attributes", ""))):
                k = key.lower()
                if k in seen or k in ctx.cv_keys:
                    continue
                seen.add(k)
                findings.append(
                    Finding(
                        rule="broken_custom_value_ref",
                        severity=ERROR,
                        workflow_id=wf.id,
                        workflow_name=wf.name,
                        detail=f"step '{step.get('name', step.get('type'))}' usa custom value inexistente: {{{{custom_values.{key}}}}}",
                    )
                )
    return findings
