"""Registry de regras de auditoria.

Cada módulo nesta pasta expõe `check(ctx: DumpContext) -> list[Finding]`.
A descoberta é dinâmica via pkgutil — basta adicionar um arquivo novo.
"""

from __future__ import annotations

import importlib
import pkgutil

from ..finding import Finding
from ..loader import DumpContext


def iter_rules():
    """Itera (nome, função check) de cada módulo de regra."""
    for mod_info in pkgutil.iter_modules(__path__, __name__ + "."):
        module = importlib.import_module(mod_info.name)
        check = getattr(module, "check", None)
        if callable(check):
            short = mod_info.name.rsplit(".", 1)[-1]
            yield short, check


def run_all(ctx: DumpContext) -> list[Finding]:
    findings: list[Finding] = []
    for _name, check in iter_rules():
        findings.extend(check(ctx))
    return findings
