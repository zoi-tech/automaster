"""Árvore de jornada do contato — motor (caminhada causal sobre flow.py).

Spec: docs/superpowers/specs/2026-06-11-contact-journey-tree-design.md.
Raiz dupla ("Contato criado" + "A qualquer momento"); eventos externos
ancorados inline no step que pode causá-los; condensação nativa; ciclos
cortados com nó loop; caps explícitos (nunca silenciosos).
"""
from __future__ import annotations

from collections import Counter

from .loader import DumpContext
from .flow import index_steps, roots, successors

# Tipos de trigger que o motor entende (demais → stats.triggers_ignorados)
KNOWN_TRIGGERS = {
    "contact_created", "contact_tag", "customer_reply", "call_status",
    "opportunity_created", "opportunity_decay", "contact_changed",
    "birthday_reminder", "appointment",
}
# Steps que mandam mensagem ao contato (âncora de customer_reply)
MESSAGE_TYPES = {"sms", "email", "whatsapp"}
# Steps neutros (colapsam em "+N steps neutros")
NEUTRAL_TYPES = {"wait", "drip"}

DEFAULT_MAX_DEPTH = 8
DEFAULT_MAX_NODES = 4000


def _node(kind: str, label: str, detail: str = "", flags: list[str] | None = None,
          conds: list[str] | None = None, children: list | None = None) -> dict:
    return {"kind": kind, "label": label, "detail": detail,
            "flags": flags or [], "conds": conds or [], "children": children or []}


def _cond_summary(c: dict) -> str:
    """Resumo legível de uma condição de trigger (não avaliada — vira chip)."""
    title = c.get("title") or c.get("field") or "condição"
    op = c.get("operator") or ""
    val = c.get("value")
    if isinstance(val, list):
        val = ", ".join(str(v) for v in val)
    return f"{title} {op} {val}".strip()


def _cond_field(c: dict) -> str:
    return str(c.get("field") or "")


class TriggerIndex:
    """Triggers de todos os workflows normalizados e indexados por tipo.

    Trigger normalizado: {id, type, name, target (workflow alvo das actions),
    active, conditions}. Deleted é descartado; inactive entra com active=False
    (a árvore mostra com chip INATIVO — auditoria vê o que está desligado).
    """

    def __init__(self, ctx: DumpContext):
        self.by_type: dict[str, list[dict]] = {}
        self.ignored: Counter = Counter()
        for w in ctx.workflows:
            for t in w.triggers or []:
                if t.get("deleted"):
                    continue
                ttype = t.get("type") or ""
                if ttype not in KNOWN_TRIGGERS:
                    if ttype:
                        self.ignored[ttype] += 1
                    continue
                target = t.get("workflow_id") or ""
                for a in t.get("actions") or []:
                    if a.get("type") == "add_to_workflow" and a.get("workflow_id"):
                        target = a["workflow_id"]
                        break
                self.by_type.setdefault(ttype, []).append({
                    "id": t.get("id") or "",
                    "type": ttype,
                    "name": t.get("name") or ttype,
                    "target": target,
                    "active": bool(t.get("active", True)),
                    "conditions": t.get("conditions") or [],
                })

    def of_type(self, ttype: str) -> list[dict]:
        return self.by_type.get(ttype, [])

    # --- matching por evento (devolve (trigger, conds_restantes) embutido) ---

    def for_tag(self, tag: str) -> list[dict]:
        """contact_tag cujo filtro de tag casa (ou sem filtro = qualquer tag)."""
        out = []
        for t in self.of_type("contact_tag"):
            tag_conds = [c for c in t["conditions"] if _cond_field(c) == "tagsAdded"]
            others = [c for c in t["conditions"] if _cond_field(c) != "tagsAdded"]
            if not tag_conds:
                out.append({**t, "rest": others})
                continue
            wanted = {str(c.get("value") or "").strip().lower() for c in tag_conds}
            if tag.strip().lower() in wanted:
                out.append({**t, "rest": others})
        return out
