"""INFO: if/else sem ramo ELSE — contato que não casa nenhuma condição sai em silêncio.

Pode ser intencional, mas costuma ser um buraco lógico ("lead vaza"). find_opportunity
é ignorado (sempre tem Found/Not Found).
"""

from __future__ import annotations

from ..finding import INFO, Finding
from ..flow import index_steps


def check(ctx) -> list[Finding]:
    findings: list[Finding] = []
    for wf in ctx.workflows:
        by_id = index_steps(wf)
        for step in wf.steps:
            a = step.get("attributes", {})
            if step.get("type") != "if_else" or not a.get("branches"):
                continue  # só containers if_else
            branch_nodes = [by_id.get(x) for x in (step.get("next") or []) if x in by_id]
            has_else = any("else" in (b.get("attributes", {}) if b else {}) for b in branch_nodes)
            if not has_else:
                findings.append(
                    Finding(
                        rule="uncovered_condition",
                        severity=INFO,
                        workflow_id=wf.id,
                        workflow_name=wf.name,
                        detail=f"if/else '{step.get('name', 'condição')}' não tem ramo ELSE — contato sem match sai do fluxo",
                    )
                )
    return findings
