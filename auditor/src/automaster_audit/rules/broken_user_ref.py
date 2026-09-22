"""ERROR: workflow atribui/notifica usuário inexistente ou desativado.

Fontes de referência a usuário:
- assign_user: attributes.traffic_weightage (chaves = userIds) + traffic_index[].id
- internal_notification: attributes.sms.selectedUser (quando userType == 'user')

Se a lista de usuários não foi extraída (dump antigo), a regra não roda.
"""

from __future__ import annotations

from ..finding import ERROR, Finding
from ..loader import DumpContext
from ._helpers import steps_of_type


def _user_ids_in_step(step: dict) -> set[str]:
    a = step.get("attributes", {}) or {}
    ids: set[str] = set()
    if step.get("type") == "assign_user":
        ids.update((a.get("traffic_weightage") or {}).keys())
        for ti in a.get("traffic_index", []) or []:
            if ti.get("id"):
                ids.add(ti["id"])
    elif step.get("type") == "internal_notification":
        sms = a.get("sms") or {}
        for uid in sms.get("selectedUser", []) or []:
            ids.add(uid)
    return ids


def check(ctx: DumpContext) -> list[Finding]:
    if not ctx.user_ids:
        return []  # usuários não extraídos neste dump
    findings: list[Finding] = []
    for wf, step in steps_of_type(ctx, "assign_user", "internal_notification"):
        for uid in _user_ids_in_step(step):
            if uid not in ctx.user_ids:
                findings.append(_f(wf, step, f"usuário inexistente: {uid}"))
            elif uid in ctx.user_deleted:
                name = ctx.user_names.get(uid, uid)
                findings.append(_f(wf, step, f"usuário desativado/deletado: {name} ({uid})"))
    return findings


def _f(wf, step, detail: str) -> Finding:
    return Finding(
        rule="broken_user_ref",
        severity=ERROR,
        workflow_id=wf.id,
        workflow_name=wf.name,
        detail=f"step '{step.get('name', step.get('type'))}' {detail}",
    )
