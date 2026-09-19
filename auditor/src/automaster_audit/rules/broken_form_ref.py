"""ERROR: referência a formulário ou survey que não existe mais na subconta.

Duas fontes: o trigger `form_submission`/`survey_submission`, cuja condição lista os
ids que disparam o fluxo, e o `formId` do calendário. As duas listas do dump são
opcionais — sem lista, sem achado, senão toda subconta com dump antigo viraria erro.

Id começado por `fb-` é o pseudo-formulário do lead gen do Facebook: ele nunca aparece
na lista de formulários e não é referência quebrada.
"""
from __future__ import annotations

from ..finding import ERROR, Finding
from ..loader import DumpContext

# tipo de trigger -> (lista que o valida, campo da condição)
TRIGGER = {
    "form_submission": ("form", "form.id"),
    "survey_submission": ("survey", "survey.id"),
}

FACEBOOK = "fb-"


def _citados(cond: dict) -> list[str]:
    valor = cond.get("value")
    if isinstance(valor, list):
        return [str(v) for v in valor if v]
    return [str(valor)] if valor else []


def check(ctx: DumpContext) -> list[Finding]:
    findings: list[Finding] = []

    for wf in ctx.workflows:
        for trigger in wf.triggers:
            alvo = TRIGGER.get(trigger.get("type"))
            if not alvo:
                continue
            chave, campo = alvo
            conhecidos = ctx.form_ids.get(chave)
            if conhecidos is None:  # lista ausente do dump: nada a cruzar
                continue
            for cond in trigger.get("conditions") or []:
                if cond.get("field") != campo:
                    continue
                for fid in _citados(cond):
                    if fid.startswith(FACEBOOK) or fid in conhecidos:
                        continue
                    rotulo = "formulário" if chave == "form" else "survey"
                    findings.append(
                        Finding(
                            rule="broken_form_ref",
                            severity=ERROR,
                            workflow_id=wf.id,
                            workflow_name=wf.name,
                            detail=f"trigger '{trigger.get('name', trigger.get('type'))}' "
                                   f"dispara por {rotulo} inexistente: {fid}",
                        )
                    )

    conhecidos = ctx.form_ids.get("form")
    if conhecidos is not None:
        for cal in ctx.calendars:
            fid = str(cal.get("formId") or "").strip()
            if not fid or fid.startswith(FACEBOOK) or fid in conhecidos:
                continue
            findings.append(
                Finding(
                    rule="broken_form_ref",
                    severity=ERROR,
                    workflow_id="",
                    workflow_name="",
                    detail=f"calendário '{cal.get('name', cal.get('id'))}' usa formulário "
                           f"inexistente: {fid}",
                )
            )
    return findings
