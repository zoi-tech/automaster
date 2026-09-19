"""INFO: formulário ou survey que existe na subconta e ninguém referencia.

É INFO, nunca ERROR: um formulário embutido num site externo, num funil ou numa
landing page não aparece em lugar nenhum do dump, e seria acusado à toa. O achado
serve para revisão humana, não para conserto automático.
"""
from __future__ import annotations

from ..finding import INFO, Finding
from ..loader import DumpContext
from .broken_form_ref import TRIGGER, _citados


def _referenciados(ctx: DumpContext) -> set[str]:
    usados: set[str] = set()
    for wf in ctx.workflows:
        for trigger in wf.triggers:
            alvo = TRIGGER.get(trigger.get("type"))
            if not alvo:
                continue
            _, campo = alvo
            for cond in trigger.get("conditions") or []:
                if cond.get("field") == campo:
                    usados.update(_citados(cond))
    for cal in ctx.calendars:
        fid = str(cal.get("formId") or "").strip()
        if fid:
            usados.add(fid)
    return usados


def check(ctx: DumpContext) -> list[Finding]:
    usados = _referenciados(ctx)
    findings: list[Finding] = []
    for chave, rotulo in (("form", "formulário"), ("survey", "survey")):
        for fid in sorted(ctx.form_ids.get(chave, set())):
            if fid in usados:
                continue
            findings.append(
                Finding(
                    rule="unused_form",
                    severity=INFO,
                    workflow_id="",
                    workflow_name="",
                    detail=f"{rotulo} '{ctx.form_names.get(fid, fid)}' não é citado por nenhum "
                           f"trigger nem calendário — pode estar embutido num site externo, "
                           f"que o dump não enxerga",
                )
            )
    return findings
