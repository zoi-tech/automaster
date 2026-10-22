"""ERROR: chave de API ou token escrito direto em custom value, custom code ou webhook."""

from __future__ import annotations

import re

from ..finding import ERROR, Finding

# grupo 1 = o segredo; a ordem importa: o Bearer só conta se o token não casou antes.
_PADROES = [
    ("chave privada GHL", re.compile(r"(pit-[0-9a-fA-F]{8}-[0-9a-fA-F][0-9a-fA-F-]*)")),
    ("chave sk-", re.compile(r"(sk-[A-Za-z0-9_-]{20,})")),
    ("JWT", re.compile(r"(eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_.-]*)")),
    ("token Bearer", re.compile(r"Bearer\s+([A-Za-z0-9_.~+/=-]{20,})")),
]


def _mascara(segredo: str) -> str:
    return f"{segredo[:6]}…{segredo[-4:]}"


def _segredos(texto: str) -> list[tuple[str, str]]:
    """(tipo, segredo) achados no texto, sem repetir o mesmo trecho em dois padrões."""
    achados: list[tuple[str, str]] = []
    ocupados: list[tuple[int, int]] = []
    for tipo, rx in _PADROES:
        for m in rx.finditer(texto):
            ini, fim = m.span(1)
            if any(ini < f and i < fim for i, f in ocupados):
                continue
            ocupados.append((ini, fim))
            achados.append((tipo, m.group(1)))
    return achados


def _textos(valor) -> list[str]:
    """Todas as strings dentro de um valor (dict/list aninhados)."""
    if isinstance(valor, str):
        return [valor]
    if isinstance(valor, dict):
        return [t for v in valor.values() for t in _textos(v)]
    if isinstance(valor, list):
        return [t for v in valor for t in _textos(v)]
    return []


def _achado(onde: str, texto: str, wf=None) -> list[Finding]:
    return [
        Finding(
            rule="exposed_secret",
            severity=ERROR,
            workflow_id=wf.id if wf else None,
            workflow_name=wf.name if wf else None,
            detail=f"segredo ({tipo}) exposto em {onde}: {_mascara(segredo)} — mova para um lugar protegido",
        )
        for tipo, segredo in _segredos(texto)
    ]


def check(ctx) -> list[Finding]:
    findings: list[Finding] = []
    for cv in ctx.custom_values:
        findings += _achado(f"custom value '{cv.get('name', cv.get('id'))}'", str(cv.get("value") or ""))
    for wf in ctx.workflows:
        for step in wf.steps:
            a = step.get("attributes") or {}
            onde = f"step '{step.get('name', step.get('type'))}'"
            if step.get("type") == "custom_code":
                findings += _achado(f"{onde} (custom code)", str(a.get("code") or ""), wf)
            elif step.get("type") in ("webhook", "custom_webhook"):
                partes = [a.get("headers"), a.get("customData"), a.get("body")]
                texto = "\n".join(t for p in partes for t in _textos(p))
                findings += _achado(f"{onde} (webhook)", texto, wf)
    return findings
