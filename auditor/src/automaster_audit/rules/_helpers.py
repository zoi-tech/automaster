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
