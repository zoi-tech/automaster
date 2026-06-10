"""Estrutura de um achado de auditoria."""
from dataclasses import dataclass

# Severidades válidas, da mais crítica à informativa.
ERROR = "ERROR"
WARN = "WARN"
INFO = "INFO"


@dataclass
class Finding:
    rule: str
    severity: str
    workflow_id: str | None = None
    workflow_name: str | None = None
    detail: str = ""
