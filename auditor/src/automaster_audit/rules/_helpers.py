"""Utilitários compartilhados pelas regras."""
from __future__ import annotations

from collections.abc import Iterator

from ..loader import DumpContext, Workflow


def steps_of_type(ctx: DumpContext, *types: str) -> Iterator[tuple[Workflow, dict]]:
    """Itera (workflow, step) para cada step cujo `type` está em `types`."""
    wanted = set(types)
    for wf in ctx.workflows:
        for step in wf.steps:
            if step.get("type") in wanted:
                yield wf, step


def add_to_workflow_targets(ctx: DumpContext) -> set[str]:
    """Ids de workflows que são alvo de algum step add_to_workflow (são chamados)."""
    targets: set[str] = set()
    for _wf, step in steps_of_type(ctx, "add_to_workflow"):
        tid = step.get("attributes", {}).get("workflow_id")
        if tid:
            targets.add(tid)
    return targets
