"""WARN: ramo de if/else com condições de horário em E que nunca são verdade juntas."""

from __future__ import annotations

from ..finding import WARN, Finding


def _hora(valor) -> float | None:
    """'9' → 9.0; '09:30' → 9.5. None se não der para ler."""
    try:
        h, _, m = str(valor).strip().partition(":")
        return float(h) + (float(m) / 60 if m else 0.0)
    except ValueError:
        return None


def _impossivel(conds: list[dict]) -> bool:
    """Intersecta os intervalos de cada condição; vazio = impossível. `==` vale como `>=` e `<=`."""
    pisos: list[tuple[float, bool]] = [(0.0, False)]  # (hora, estrito)
    tetos: list[tuple[float, bool]] = [(24.0, False)]
    for c in conds:
        v = _hora(c.get("conditionValue"))
        op = c.get("conditionOperator")
        if v is None:
            continue
        if op in (">", ">=", "=="):
            pisos.append((v, op == ">"))
        if op in ("<", "<=", "=="):
            tetos.append((v, op == "<"))
    lo, lo_estrito = max(pisos, key=lambda p: (p[0], p[1]))
    hi, hi_estrito = min(tetos, key=lambda t: (t[0], not t[1]))
    return lo > hi or (lo == hi and (lo_estrito or hi_estrito))


def _condicoes_de_hora(segmento: dict) -> list[dict]:
    return [
        c
        for c in segmento.get("conditions") or []
        if c.get("conditionType") == "date_time" and c.get("conditionSubType") == "time"
    ]


def check(ctx) -> list[Finding]:
    findings: list[Finding] = []
    for wf in ctx.workflows:
        if wf.status != "published":
            continue
        for step in wf.steps:
            if step.get("type") != "if_else":
                continue
            for ramo in (step.get("attributes") or {}).get("branches") or []:
                for seg in ramo.get("segments") or []:
                    if (seg.get("operator") or "and") != "and":
                        continue
                    conds = _condicoes_de_hora(seg)
                    if len(conds) < 2 or not _impossivel(conds):
                        continue
                    regra = " e ".join(f"{c.get('conditionOperator')} {c.get('conditionValue')}" for c in conds)
                    findings.append(
                        Finding(
                            rule="impossible_time_condition",
                            severity=WARN,
                            workflow_id=wf.id,
                            workflow_name=wf.name,
                            detail=(
                                f"if/else '{step.get('name', 'condição')}': "
                                f"ramo '{ramo.get('name', '?')}' exige horário {regra} ao mesmo tempo — nunca é verdade"
                            ),
                        )
                    )
                    break
    return findings
