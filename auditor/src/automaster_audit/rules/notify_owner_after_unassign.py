"""WARN: notifica o dono do contato depois de tirar o dono, sem atribuir outro no meio.

A notificação para o usuário atribuído (`userType == "assign"`) não tem para quem ir.
"""

from __future__ import annotations

from ..finding import WARN, Finding
from ..flow import index_steps, parent_of


def _dono_removido(by_id: dict[str, dict], step: dict) -> bool:
    """Subindo pelos ancestrais, acha remove_assigned_user antes de algum assign_user."""
    pid = parent_of(step)
    seen: set[str] = set()
    while pid and pid not in seen and pid in by_id:
        seen.add(pid)
        pai = by_id[pid]
        if pai.get("type") == "assign_user":
            return False
        if pai.get("type") == "remove_assigned_user":
            return True
        pid = parent_of(pai)
    return False


def check(ctx) -> list[Finding]:
    findings: list[Finding] = []
    for wf in ctx.workflows:
        if wf.status != "published":
            continue
        by_id = index_steps(wf)
        for step in wf.steps:
            if step.get("type") != "internal_notification":
                continue
            notif = (step.get("attributes") or {}).get("notification") or {}
            if notif.get("userType") != "assign" or not _dono_removido(by_id, step):
                continue
            findings.append(
                Finding(
                    rule="notify_owner_after_unassign",
                    severity=WARN,
                    workflow_id=wf.id,
                    workflow_name=wf.name,
                    detail=(
                        f"step '{step.get('name', 'Notification')}' notifica o usuário atribuído, mas antes o "
                        "caminho remove o dono (remove_assigned_user) sem atribuir outro — ninguém recebe"
                    ),
                )
            )
    return findings
