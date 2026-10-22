"""WARN: espera "antes do compromisso" maior ou igual a uma anterior do mesmo caminho — nunca chega."""

from __future__ import annotations

from ..finding import WARN, Finding
from ..flow import enumerate_paths, index_steps

_MINUTOS = {"minutes": 1, "hours": 60, "days": 1440}


def _minutos_antes(step: dict) -> float | None:
    """Minutos antes do compromisso de uma espera `appointment` "before"; None se não for."""
    if step.get("type") != "wait":
        return None
    a = step.get("attributes") or {}
    if a.get("type") != "appointment":
        return None
    quando = a.get("appointmentStartAfter") or {}
    if quando.get("when") != "before":
        return None
    try:
        return float(quando.get("value")) * _MINUTOS.get(quando.get("type") or "minutes", 1)
    except (TypeError, ValueError):
        return None


def check(ctx) -> list[Finding]:
    findings: list[Finding] = []
    for wf in ctx.workflows:
        if wf.status != "published":
            continue
        by_id = index_steps(wf)
        acusados: set[str] = set()
        paths, _ = enumerate_paths(wf)
        for path in paths:
            menor: tuple[float, dict] | None = None  # espera mais próxima do compromisso até aqui
            for sid, _label in path.steps:
                step = by_id[sid]
                m = _minutos_antes(step)
                if m is None:
                    continue
                if menor is not None and m >= menor[0] and sid not in acusados:
                    acusados.add(sid)
                    findings.append(
                        Finding(
                            rule="appointment_waits_out_of_order",
                            severity=WARN,
                            workflow_id=wf.id,
                            workflow_name=wf.name,
                            detail=(
                                f"step '{step.get('name', 'Wait')}' ({m:g} min antes do compromisso) vem depois de "
                                f"'{menor[1].get('name', 'Wait')}' ({menor[0]:g} min antes) — o horário já passou "
                                "e o passo seguinte é pulado"
                            ),
                        )
                    )
                if menor is None or m < menor[0]:
                    menor = (m, step)
    return findings
