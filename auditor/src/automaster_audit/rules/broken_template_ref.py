"""ERROR: step citando template que não existe mais na subconta.

Duas listas independentes, cada uma opcional no dump: `message` (SMS e os canais
que dividem a coleção `locations/<loc>/templates`) e `whatsapp` (templates da
Meta). Canal sem lista no dump — subconta sem WhatsApp, dump antigo — não gera
achado nenhum: a regra fica no-op para ele, senão todo step viraria falso
positivo.

Ficam de fora, por falta de lista contra a qual cruzar: `email` (o
`template_id` do step não casa com nenhum id do email builder, nem descendo nas
pastas — o step guarda cópia própria) e `proposals_estimates_send_document`.
"""
from __future__ import annotations

from ..finding import ERROR, Finding
from ..loader import DumpContext
from ._helpers import steps_of_type

# `template_id: "0"` é o próprio app dizendo "None - Free form message" (o rótulo
# sai assim em /whatsapp/workflow/options/template_id). Não é referência quebrada.
SEM_TEMPLATE = {"", "0", "none", "None"}

# tipo de step -> canal cuja lista de templates o valida
CANAL_DO_STEP = {
    "sms": "message",
    "instagram-dm": "message",
    "ig_interactive_messenger": "message",
    "whatsapp_v2": "whatsapp",
}


def check(ctx: DumpContext) -> list[Finding]:
    findings: list[Finding] = []
    for wf, step in steps_of_type(ctx, *CANAL_DO_STEP):
        canal = CANAL_DO_STEP[step["type"]]
        conhecidos = ctx.template_ids.get(canal)
        if not conhecidos:  # lista ausente ou vazia: nada a cruzar
            continue
        attrs = step.get("attributes", {}) or {}
        tid = str(attrs.get("template_id") or attrs.get("templateId") or "").strip()
        if tid in SEM_TEMPLATE:
            continue  # mensagem livre: o corpo está em `message`
        if tid and tid not in conhecidos:
            findings.append(
                Finding(
                    rule="broken_template_ref",
                    severity=ERROR,
                    workflow_id=wf.id,
                    workflow_name=wf.name,
                    detail=f"step '{step.get('name', step.get('type'))}' usa template "
                           f"{canal} inexistente: {tid}",
                )
            )
    return findings
