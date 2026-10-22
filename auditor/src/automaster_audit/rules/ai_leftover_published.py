"""INFO: passo de IA (ou webhook/código que chama provedor de IA) em workflow publicado.

Por aproximação: tipo de passo com `ai` como palavra (`ai_agent`, `conversation_ai`…) ou
`webhook`/`custom_code` cuja URL ou código cite openai, anthropic, gemini ou chatgpt. Pode ser
uso de propósito, não sobra de teste.
"""

from __future__ import annotations

import re

from ..finding import INFO, Finding

_PALAVRA_AI = re.compile(r"(?<![a-z0-9])ai(?![a-z0-9])", re.IGNORECASE)
_PROVEDOR = re.compile(r"openai|anthropic|gemini|chatgpt", re.IGNORECASE)


def _motivo(step: dict) -> str | None:
    tipo = str(step.get("type") or "")
    if _PALAVRA_AI.search(tipo):
        return f"passo de IA ({tipo})"
    if tipo in ("webhook", "custom_code"):
        a = step.get("attributes") or {}
        texto = f"{a.get('url') or ''} {a.get('code') or ''}"
        m = _PROVEDOR.search(texto)
        if m:
            return f"{tipo} que cita {m.group(0).lower()}"
    return None


def check(ctx) -> list[Finding]:
    findings: list[Finding] = []
    for wf in ctx.workflows:
        if wf.status != "published":
            continue
        motivos = [(step, m) for step in wf.steps if (m := _motivo(step))]
        if not motivos:
            continue
        step, motivo = motivos[0]
        extra = f" (e mais {len(motivos) - 1})" if len(motivos) > 1 else ""
        findings.append(
            Finding(
                rule="ai_leftover_published",
                severity=INFO,
                workflow_id=wf.id,
                workflow_name=wf.name,
                detail=(
                    f"step '{step.get('name', step.get('type'))}': {motivo}{extra} em workflow publicado — "
                    "pode ser sobra de teste com IA (a conferir)"
                ),
            )
        )
    return findings
