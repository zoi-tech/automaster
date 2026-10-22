"""INFO: cadência que entra pela oportunidade e não tem saída quando ela anda ou é ganha.

Por aproximação: a cadência é entrada por gatilho de oportunidade (dela ou de quem a chama
por `add_to_workflow`) e nenhum workflow publicado com gatilho `pipeline_stage_updated` ou
`opportunity_status_changed` filtrado em `won` remove o contato dela. Pode ser falso positivo.
"""

from __future__ import annotations

from ..finding import INFO, Finding
from ._helpers import GATILHOS_OPORTUNIDADE, cadencias, gatilhos_ativos, remove_de, status_do_gatilho


def _entra_por_oportunidade(wf) -> bool:
    return wf.status == "published" and any(t.get("type") in GATILHOS_OPORTUNIDADE for t in gatilhos_ativos(wf))


def _e_saida(wf) -> bool:
    if wf.status != "published":
        return False
    for t in gatilhos_ativos(wf):
        if t.get("type") == "pipeline_stage_updated":
            return True
        if t.get("type") == "opportunity_status_changed" and "won" in status_do_gatilho(t):
            return True
    return False


def check(ctx) -> list[Finding]:
    findings: list[Finding] = []
    by_id = {wf.id: wf for wf in ctx.workflows}
    chamados: set[str] = set()
    for wf in ctx.workflows:
        if not _entra_por_oportunidade(wf):
            continue
        for step in wf.steps:
            if step.get("type") == "add_to_workflow":
                alvo = (step.get("attributes") or {}).get("workflow_id")
                if alvo:
                    chamados.add(alvo)
    saidas = [wf for wf in ctx.workflows if _e_saida(wf)]
    for cid in cadencias(ctx):
        wf = by_id[cid]
        if not (_entra_por_oportunidade(wf) or cid in chamados):
            continue
        if any(remove_de(s, cid) for s in saidas):
            continue
        findings.append(
            Finding(
                rule="cadence_without_exit",
                severity=INFO,
                workflow_id=wf.id,
                workflow_name=wf.name,
                detail=(
                    "cadência entrada pela oportunidade que nenhum workflow de mudança de etapa ou venda (won) "
                    "remove — o cliente pode seguir recebendo mensagens depois de avançar (a conferir)"
                ),
            )
        )
    return findings
