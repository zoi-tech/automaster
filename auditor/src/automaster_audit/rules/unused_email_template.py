"""INFO: template de e-mail que existe no builder e nenhum workflow usa.

É INFO, nunca ERROR: um template pode ser usado em campanha de e-mail, disparo manual ou
outra parte do CRM que o dump não enxerga. O achado serve para revisão humana.
"""

from __future__ import annotations

from ..finding import INFO, Finding
from ..loader import DumpContext
from ._helpers import email_template_id, steps_of_type


def check(ctx: DumpContext) -> list[Finding]:
    conhecidos = ctx.template_ids.get("email")
    if not conhecidos:  # lista ausente ou vazia: nada a apontar
        return []
    usados = {email_template_id(step) for _, step in steps_of_type(ctx, "email")}
    return [
        Finding(
            rule="unused_email_template",
            severity=INFO,
            workflow_id="",
            workflow_name="",
            detail=f"template de e-mail '{ctx.template_names.get(tid, tid)}' não é usado por "
            f"nenhum workflow — pode estar em campanha ou disparo manual, que o dump "
            f"não enxerga",
        )
        for tid in sorted(conhecidos - usados)
    ]
