"""INFO: draft sem modificação há mais de 90 dias.

Determinístico: compara workflow.updatedAt com manifest.extractedAt (data da
extração), não com o relógio atual. Assim a auditoria do mesmo dump é reprodutível.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from ..finding import INFO, Finding
from ..loader import DumpContext

STALE_AFTER = timedelta(days=90)


def _parse(ts: str | None) -> datetime | None:
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts)
    except (ValueError, TypeError):
        return None


def check(ctx: DumpContext) -> list[Finding]:
    ref = _parse(ctx.manifest.get("extractedAt"))
    if ref is None:
        return []  # sem data de referência, não dá pra avaliar
    findings: list[Finding] = []
    for wf in ctx.workflows:
        if wf.status != "draft":
            continue
        updated = _parse(wf.updated_at)
        if updated is not None and ref - updated > STALE_AFTER:
            age = (ref - updated).days
            findings.append(
                Finding(
                    rule="dead_end_draft",
                    severity=INFO,
                    workflow_id=wf.id,
                    workflow_name=wf.name,
                    detail=f"draft sem modificação há {age} dias",
                )
            )
    return findings
