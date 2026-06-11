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

    def _scoped(self, ttype: str, wf_id: str, scope_field: str) -> list[dict]:
        """Triggers do tipo, restritos por condição scope_field==wf_id quando presente."""
        out = []
        for t in self.of_type(ttype):
            scope = [c for c in t["conditions"] if _cond_field(c) == scope_field]
            others = [c for c in t["conditions"] if _cond_field(c) != scope_field]
            if scope and not any(str(c.get("value")) == wf_id for c in scope):
                continue
            out.append({**t, "rest": others})
        return out

    def for_reply(self, wf_id: str) -> list[dict]:
        return self._scoped("customer_reply", wf_id, "workflow.id")

    def for_call(self, wf_id: str) -> list[dict]:
        return self._scoped("call_status", wf_id, "workflow.id")

    def for_opportunity_created(self, pipeline_id: str) -> list[dict]:
        out = []
        for t in self.of_type("opportunity_created"):
            pconds = [c for c in t["conditions"] if _cond_field(c) == "opportunity.pipelineId"]
            others = [c for c in t["conditions"] if _cond_field(c) != "opportunity.pipelineId"]
            if pconds and not any(str(c.get("value")) == pipeline_id for c in pconds):
                continue
            out.append({**t, "rest": others})
        return out

    def for_decay(self, pipeline_id: str) -> list[dict]:
        out = []
        for t in self.of_type("opportunity_decay"):
            pconds = [c for c in t["conditions"] if "pipeline" in _cond_field(c).lower()]
            others = [c for c in t["conditions"] if "pipeline" not in _cond_field(c).lower()]
            if pconds and not any(str(c.get("value")) == pipeline_id for c in pconds):
                continue
            out.append({**t, "rest": others})
        return out

    def for_field_change(self) -> list[dict]:
        return [{**t, "rest": t["conditions"]} for t in self.of_type("contact_changed")]


# rótulos por tipo de efeito (prefixo mono fica no HTML; aqui só semântica)
def _effect_label(ctx: DumpContext, s: dict) -> tuple[str, str]:
    """(label, detail) de um step de efeito."""
    t = s.get("type")
    a = s.get("attributes") or {}
    name = s.get("name") or t
    if t == "add_contact_tag":
        return "adiciona tag", ", ".join(a.get("tags") or [])
    if t == "remove_contact_tag":
        return "remove tag", ", ".join(a.get("tags") or [])
    if t in MESSAGE_TYPES:
        return f"mensagem ({t})", str(name)
    if t == "internal_create_opportunity":
        pid = a.get("pipelineId") or ""
        stage = ""
        for inp in a.get("__customInputFields__") or []:
            if inp.get("filterField") == "pipelineStageId" and inp.get("value"):
                stage = ctx.stage_names.get(inp["value"], inp["value"])
        pname = ctx.pipeline_names.get(pid, pid)
        det = f"{pname}" + (f" · stage {stage}" if stage else "")
        return "cria oportunidade", det
    if t == "internal_update_opportunity":
        return "atualiza oportunidade", str(name)
    if t == "update_contact_field":
        fids = [f.get("field") for f in a.get("fields") or [] if f.get("field")]
        return "atualiza campo", ", ".join(ctx.field_names.get(f, f) for f in fids)
    if t == "assign_user":
        uids = sorted((a.get("traffic_weightage") or {}).keys())
        return "atribui usuário", ", ".join(ctx.user_names.get(u, u) for u in uids)
    if t == "webhook":
        return "webhook", str(name)
    if t == "internal_notification":
        return "notificação interna", str(name)
    if t == "manual-call":
        return "ligação manual", str(name)
    return str(t), str(name)


EFFECT_TYPES = {
    "add_contact_tag", "remove_contact_tag", "update_contact_field",
    "internal_create_opportunity", "internal_update_opportunity",
    "assign_user", "webhook", "internal_notification", "manual-call",
} | MESSAGE_TYPES


class _Budget:
    """Cap global de nós; estourou → flag truncated (nunca silencioso)."""

    def __init__(self, max_nodes: int):
        self.left = max_nodes
        self.truncated = False

    def take(self) -> bool:
        if self.left <= 0:
            self.truncated = True
            return False
        self.left -= 1
        return True


def _branch_label_of(container: dict, node: dict) -> str:
    if node.get("type") == "transition":
        return str(node.get("name") or "ramo")
    for b in (container.get("attributes") or {}).get("branches") or []:
        if b.get("id") == node.get("id"):
            return str(b.get("name") or "ramo")
    if "else" in (node.get("attributes") or {}):
        return "ELSE"
    return "ramo"


class _Walker:
    def __init__(self, ctx: DumpContext, idx: TriggerIndex,
                 max_depth: int, budget: _Budget, stats: dict):
        self.ctx = ctx
        self.idx = idx
        self.max_depth = max_depth
        self.budget = budget
        self.stats = stats
        self.wf_by_id = {w.id: w for w in ctx.workflows}

    def workflow_node(self, wf_id: str, wf_stack: frozenset, depth: int) -> dict:
        """Nó de entrada num workflow + corpo condensado (ou loop/truncado/missing)."""
        if not self.budget.take():
            return _node("truncated", "✂ truncado (cap de nós)")
        w = self.wf_by_id.get(wf_id)
        if w is None:
            return _node("terminal", f"workflow inexistente: {wf_id}", flags=["missing"])
        if wf_id in wf_stack:
            self.stats["loops"] += 1
            return _node("loop", f"loop → {w.name or wf_id}")
        if depth > self.max_depth:
            self.budget.truncated = True
            return _node("truncated", f"✂ profundidade máx ({self.max_depth})")
        self.stats["_wf_seen"].add(wf_id)
        flags = ["draft"] if str(w.status or "").lower() != "published" else []
        children = self._walk_steps_from_roots(w, wf_stack | {wf_id}, depth)
        return _node("workflow", w.name or wf_id, detail=f"{len(w.steps)} steps",
                     flags=flags, children=children)

    def _walk_steps_from_roots(self, w, wf_stack: frozenset, depth: int) -> list[dict]:
        by_id = index_steps(w)
        out: list[dict] = []
        for rid in roots(w):
            out.extend(self._walk(rid, by_id, w, set(), wf_stack, depth))
        if not out:
            out.append(_node("terminal", "[fim]", detail="workflow vazio"))
        return out

    def _walk(self, nid: str, by_id: dict, w, seen: set, wf_stack: frozenset,
              depth: int) -> list[dict]:
        """Sequência condensada de nós a partir do step nid (dentro do workflow)."""
        out: list[dict] = []
        neutrals: list[dict] = []

        def flush_neutrals():
            if neutrals:
                grp = _node("neutral_group", f"+{len(neutrals)} steps neutros",
                            children=list(neutrals))
                out.append(grp)
                neutrals.clear()

        cur: str | None = nid
        while cur is not None:
            if cur in seen:
                flush_neutrals()
                self.stats["loops"] += 1
                tgt = by_id.get(cur, {})
                out.append(_node("loop", f"loop → {tgt.get('name') or cur}"))
                return out
            s = by_id.get(cur)
            if s is None:
                break
            seen = seen | {cur}
            stype = s.get("type")
            nxt = s.get("next")

            if isinstance(nxt, list):  # container: forka em branches
                flush_neutrals()
                if not self.budget.take():
                    out.append(_node("truncated", "✂ truncado (cap de nós)"))
                    return out
                for bid in successors(s):
                    bnode = by_id.get(bid)
                    if bnode is None:
                        continue
                    label = _branch_label_of(s, bnode)
                    body_next = bnode.get("next")
                    if isinstance(body_next, str) and body_next:
                        kids = self._walk(body_next, by_id, w, seen, wf_stack, depth)
                    else:
                        kids = [_node("terminal", "[fim]")]
                        self.stats["terminais"] += 1
                    out.append(_node("branch", label, children=kids))
                return out

            if stype in EFFECT_TYPES:
                flush_neutrals()
                if not self.budget.take():
                    out.append(_node("truncated", "✂ truncado (cap de nós)"))
                    return out
                label, detail = _effect_label(self.ctx, s)
                eff = _node("effect", label, detail=detail)
                eff["children"] = self._events_for_effect(s, w, wf_stack, depth)
                out.append(eff)
            elif stype == "add_to_workflow":
                flush_neutrals()
                target = (s.get("attributes") or {}).get("workflow_id") or ""
                eff = _node("effect", "envia para workflow",
                            detail=self.ctx.workflow_names.get(target, target))
                eff["children"] = [self.workflow_node(target, wf_stack, depth + 1)]
                out.append(eff)
            elif stype in NEUTRAL_TYPES:
                if self.budget.take():
                    neutrals.append(_node("effect", str(s.get("name") or stype),
                                          detail=str(stype)))
            elif stype == "goto":
                pass  # transparente: successors já inclui o alvo
            else:
                pass  # if_else nó-branch nunca chega aqui; tipos desconhecidos: neutros invisíveis

            succ = [x for x in successors(s)]
            cur = succ[0] if succ else None

        flush_neutrals()
        self.stats["terminais"] += 1
        out.append(_node("terminal", "[fim]"))
        return out

    def _events_for_effect(self, s: dict, w, wf_stack: frozenset, depth: int) -> list[dict]:
        """Eventos externos ancorados neste efeito (regra de ancoragem da spec)."""
        out: list[dict] = []
        stype = s.get("type")
        a = s.get("attributes") or {}

        if stype == "add_contact_tag":
            for tag in a.get("tags") or []:
                for t in self.idx.for_tag(tag):
                    out.append(self._event_node(
                        f"tag “{tag}” adicionada dispara", t, wf_stack, depth))

        elif stype in MESSAGE_TYPES:
            for t in self.idx.for_reply(w.id):
                out.append(self._event_node("se responder", t, wf_stack, depth))

        elif stype == "manual-call":
            for t in self.idx.for_call(w.id):
                disp = [c for c in t.get("rest", []) if _cond_field(c) == "custom_disposition"]
                rest = [c for c in t.get("rest", []) if _cond_field(c) != "custom_disposition"]
                if disp:
                    vals = []
                    for c in disp:
                        v = c.get("value")
                        vals.extend(v if isinstance(v, list) else [v])
                    label = "ligação: " + ", ".join(str(v) for v in vals)
                else:
                    label = "após a ligação"
                out.append(self._event_node(label, {**t, "rest": rest}, wf_stack, depth))

        elif stype == "internal_create_opportunity":
            pid = a.get("pipelineId") or ""
            for t in self.idx.for_opportunity_created(pid):
                out.append(self._event_node("oportunidade criada dispara", t, wf_stack, depth))
            for t in self.idx.for_decay(pid):
                out.append(self._event_node("se a oportunidade estagnar (decay)", t, wf_stack, depth))

        elif stype == "update_contact_field":
            for t in self.idx.for_field_change():
                out.append(self._event_node("campo alterado dispara", t, wf_stack, depth))

        return out

    def _event_node(self, label: str, t: dict, wf_stack: frozenset, depth: int) -> dict:
        """Nó de evento → workflow alvo do trigger. Conds restantes viram chips."""
        self.stats["eventos_externos"] += 1
        flags = [] if t.get("active", True) else ["inactive"]
        conds = [_cond_summary(c) for c in t.get("rest", t.get("conditions") or [])]
        ev = _node("event", label, detail=t.get("name") or "", flags=flags, conds=conds)
        ev["children"] = [self.workflow_node(t["target"], wf_stack, depth + 1)]
        return ev


def build_journey(ctx: DumpContext, max_depth: int = DEFAULT_MAX_DEPTH,
                  max_nodes: int = DEFAULT_MAX_NODES) -> dict:
    idx = TriggerIndex(ctx)
    budget = _Budget(max_nodes)
    stats = {"terminais": 0, "loops": 0, "eventos_externos": 0, "_wf_seen": set()}
    walker = _Walker(ctx, idx, max_depth, budget, stats)

    criacao: list[dict] = []
    for t in idx.of_type("contact_created"):
        flags = [] if t["active"] else ["inactive"]
        conds = [_cond_summary(c) for c in t["conditions"]]
        ev = _node("event", "Contato criado", detail=t["name"], flags=flags, conds=conds)
        ev["children"] = [walker.workflow_node(t["target"], frozenset(), 1)]
        criacao.append(ev)

    anytime: list[dict] = []  # Task 5

    stats["workflows_alcancaveis"] = len(stats.pop("_wf_seen"))
    return {
        "meta": {
            "locationId": ctx.manifest.get("locationId", ""),
            "extractedAt": ctx.manifest.get("extractedAt", ""),
            "n_workflows": len(ctx.workflows),
        },
        "criacao": criacao,
        "anytime": anytime,
        "stats": {**stats, "triggers_ignorados": dict(idx.ignored)},
        "truncated": budget.truncated,
    }
