"""INFO: nome de workflow fora do padrão ZOI `[Produto] Gatilho → Ação`.

Padrão: prefixo entre colchetes + seta U+2192 separando gatilho e ação.
Regra leve — sinaliza ausência do colchete de produto ou da seta.
"""

from __future__ import annotations

import re

from ..finding import INFO, Finding
from ..loader import DumpContext

ARROW = "→"  # →
_PATTERN = re.compile(r"^\[.+\].*" + ARROW)


def check(ctx: DumpContext) -> list[Finding]:
    findings: list[Finding] = []
    for wf in ctx.workflows:
        name = wf.name or ""
        if not _PATTERN.search(name):
            findings.append(
                Finding(
                    rule="naming_convention",
                    severity=INFO,
                    workflow_id=wf.id,
                    workflow_name=wf.name,
                    detail=f"nome fora do padrão ZOI '[Produto] Gatilho {ARROW} Ação'",
                )
            )
    return findings
