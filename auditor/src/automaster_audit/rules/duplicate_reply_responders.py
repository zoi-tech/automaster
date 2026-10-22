"""WARN: dois ou mais workflows publicados respondem à mesma resposta do cliente.

Gatilho `customer_reply` ativo com as mesmas condições e passo de mensagem ao cliente em
cada um: o contato recebe duas (ou mais) respostas para a mesma mensagem.
"""

from __future__ import annotations

import json

from ..finding import WARN, Finding

MENSAGEM = {"sms", "whatsapp_v2", "email"}


def _chave(trigger: dict) -> frozenset[str]:
    """Conjunto de field/operator/value das condições, independente da ordem."""
    return frozenset(
        json.dumps([c.get("field"), c.get("operator"), c.get("value")], sort_keys=True, ensure_ascii=False)
        for c in trigger.get("conditions") or []
        if isinstance(c, dict)
    )


def check(ctx) -> list[Finding]:
    grupos: dict[frozenset[str], dict[str, object]] = {}
    for wf in ctx.workflows:
        if wf.status != "published":
            continue
        if not any(s.get("type") in MENSAGEM for s in wf.steps):
            continue
        for t in wf.triggers:
            if t.get("type") != "customer_reply" or not t.get("active") or t.get("deleted"):
                continue
            grupos.setdefault(_chave(t), {})[wf.id] = wf

    findings: list[Finding] = []
    for por_id in grupos.values():
        if len(por_id) < 2:
            continue
        wfs = sorted(por_id.values(), key=lambda w: (w.name, w.id))
        nomes = ", ".join(f"'{w.name}'" for w in wfs)
        findings.append(
            Finding(
                rule="duplicate_reply_responders",
                severity=WARN,
                workflow_id=wfs[0].id,
                workflow_name=wfs[0].name,
                detail=(
                    f"{len(wfs)} workflows respondem à mesma resposta do cliente (customer_reply com as mesmas "
                    f"condições) e mandam mensagem: {nomes} — o contato recebe respostas repetidas"
                ),
            )
        )
    return findings
