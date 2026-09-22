"""Utilitários compartilhados pelas regras."""

from __future__ import annotations

import re
from collections.abc import Iterator
from urllib.parse import unquote

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


# O id do template de e-mail vem do caminho do arquivo renderizado no Storage, não do
# `template_id` do step: quando o usuário escolhe um template existente, o GHL guarda uma
# cópia e o `template_id` passa a ser o dessa cópia, que não existe na lista do builder.
_PREVIEW_ID = re.compile(r"emails/([^/]+)/index\.html")


def email_template_id(step: dict) -> str:
    """Id do template de e-mail citado por um step, ou string vazia se não der para saber."""
    attrs = step.get("attributes") or {}
    url = unquote(str(attrs.get("previewUrl") or ""))
    m = _PREVIEW_ID.search(url)
    return m.group(1) if m else ""
