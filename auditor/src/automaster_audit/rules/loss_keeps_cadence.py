"""INFO: cadência publicada que nenhum workflow de oportunidade perdida limpa.

Por aproximação: sem um workflow publicado com gatilho `opportunity_status_changed` filtrado
em `lost` que tenha `remove_from_workflow` cobrindo a cadência, o cliente perdido segue
recebendo as mensagens. Pode ser falso positivo (a limpeza pode estar em outro lugar).
"""

from __future__ import annotations

from ..finding import INFO, Finding
from ._helpers import cadencias, gatilhos_ativos, remove_de, status_do_gatilho


def _limpa_na_perda(wf) -> bool:
    return wf.status == "published" and any(
        t.get("type") == "opportunity_status_changed" and "lost" in status_do_gatilho(t) for t in gatilhos_ativos(wf)
    )


def check(ctx) -> list[Finding]:
    findings: list[Finding] = []
    limpezas = [wf for wf in ctx.workflows if _limpa_na_perda(wf)]
    by_id = {wf.id: wf for wf in ctx.workflows}
    for cid in cadencias(ctx):
        if any(remove_de(wf, cid) for wf in limpezas):
            continue
        wf = by_id[cid]
        findings.append(
            Finding(
                rule="loss_keeps_cadence",
                severity=INFO,
                workflow_id=wf.id,
                workflow_name=wf.name,
                detail=(
                    "cadência de mensagens que nenhum workflow de oportunidade perdida (status lost) remove — "
                    "o cliente perdido pode seguir recebendo mensagens (a conferir)"
                ),
            )
        )
    return findings
