"""Workflow sem forma de entrada conhecida.

Um workflow tem entrada se: tem trigger próprio OU é alvo de algum step
add_to_workflow (sub-rotina chamada por outro fluxo). Execução manual também é
uma entrada legítima — por isso "sem entrada" nunca é ERROR.

- sem trigger, sem chamada, 0 steps  → WARN  (vazio/morto: não faz nada e ninguém chama)
- sem trigger, sem chamada, com steps → INFO  (provável execução manual; confirmar)
"""
from __future__ import annotations

from ..finding import INFO, WARN, Finding
from ..loader import DumpContext
from ._helpers import add_to_workflow_targets


def check(ctx: DumpContext) -> list[Finding]:
    called = add_to_workflow_targets(ctx)
    findings: list[Finding] = []
    for wf in ctx.workflows:
        if wf.triggers or wf.id in called:
            continue  # tem entrada automática
        if not wf.steps:
            findings.append(
                Finding(
                    rule="workflow_unreachable",
                    severity=WARN,
                    workflow_id=wf.id,
                    workflow_name=wf.name,
                    detail="workflow vazio (0 steps), sem trigger e não é chamado por nenhum outro",
                )
            )
        else:
            findings.append(
                Finding(
                    rule="workflow_unreachable",
                    severity=INFO,
                    workflow_id=wf.id,
                    workflow_name=wf.name,
                    detail="sem trigger e não é chamado por outro fluxo — provável execução manual; confirmar",
                )
            )
    return findings
