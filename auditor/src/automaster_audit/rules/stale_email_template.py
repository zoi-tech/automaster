"""WARN: step de e-mail apontando para um template que não está mais no email builder.

É WARN e não ERROR porque o e-mail continua sendo enviado: o conteúdo renderizado vive no
Storage, e foi medido ao vivo respondendo 200 mesmo para os ids ausentes da lista. O que se
perdeu é a possibilidade de editar aquele e-mail pelo app — quem abrir o template de mesmo
nome no builder estará mexendo em outro registro.

O id vem do `previewUrl`, nunca do `template_id`: quando o usuário escolhe um template
existente, o GHL guarda uma cópia dentro do step e o `template_id` passa a ser o dessa
cópia, que por construção não aparece na lista do builder. Detalhes em `docs/endpoints.md`,
seção `## Templates de e-mail`.
"""

from __future__ import annotations

from ..finding import WARN, Finding
from ..loader import DumpContext
from ._helpers import email_template_id, steps_of_type


def check(ctx: DumpContext) -> list[Finding]:
    conhecidos = ctx.template_ids.get("email")
    if not conhecidos:  # lista ausente ou vazia: nada a cruzar
        return []
    findings: list[Finding] = []
    for wf, step in steps_of_type(ctx, "email"):
        tid = email_template_id(step)
        if not tid or tid in conhecidos:
            continue
        assunto = (step.get("attributes") or {}).get("subject") or ""
        findings.append(
            Finding(
                rule="stale_email_template",
                severity=WARN,
                workflow_id=wf.id,
                workflow_name=wf.name,
                detail=f"step '{step.get('name', step.get('type'))}' (assunto {assunto!r}) usa "
                f"template de e-mail que não está mais no builder: {tid} — o e-mail "
                f"ainda é enviado, mas não dá para editá-lo pelo app",
            )
        )
    return findings
