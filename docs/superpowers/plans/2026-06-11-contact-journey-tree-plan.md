# Árvore de Jornada do Contato — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Página `journey.html` com a árvore de tudo que pode acontecer com um contato desde a criação (triggers → workflows → efeitos → cascatas) até os terminais.

**Architecture:** Novo motor `journey.py` (caminhada causal sobre `flow.py` + índice de triggers) produz dict-árvore; `journey_html.py` renderiza no shell "Sala de Controle" com `<details>` nativo. Spec: `docs/superpowers/specs/2026-06-11-contact-journey-tree-design.md` (5 decisões aprovadas — NÃO rediscutir).

**Tech Stack:** Python 3 (auditor, src-layout), pytest, HTML auto-contido (zero CDN), theme.py Carbon existente.

**Comandos-base (de `auditor/`):**
- Testes: `.venv/bin/python -m pytest -q` (hoje: 82 verdes; cada task termina verde)
- Um teste: `.venv/bin/python -m pytest tests/test_journey.py::<nome> -v`
- Regenerar no dump real: `.venv/bin/automaster-audit journey ../dumps/WPIUKW3L4lDyMhLhKYKG/2026-06-10_2221/`

**Regras do projeto (CLAUDE.md — invioláveis):**
- `raw` intocado; builders de dados existentes intocados.
- XSS-safe: todo nome de CRM via `html.escape`; HTML auto-contido (fontes data-URI).
- Templates `str.format`: CSS/JS com chaves em constante separada injetada como valor.
- Caps nunca silenciosos (nó `truncated` + flag + stats).

---

## Estrutura de arquivos

| Arquivo | Papel |
|---|---|
| Create `auditor/src/automaster_audit/journey.py` | Motor: `TriggerIndex` + `build_journey(ctx) -> dict` |
| Create `auditor/src/automaster_audit/journey_html.py` | Apresentação: `write_journey_html(data, out, title)` |
| Create `auditor/tests/test_journey.py` | Testes do motor (fixtures sintéticas) |
| Create `auditor/tests/test_journey_html.py` | Testes de render + XSS + auto-contenção |
| Modify `auditor/src/automaster_audit/cli.py` | Subcomando `journey` |
| Modify `auditor/src/automaster_audit/theme.py:333-336` | Item "Jornada do contato" no grupo Análise |
| Modify `CLAUDE.md` | 6ª saída documentada |

**Formato do nó (contrato entre motor e HTML):**
```python
{
  "kind": str,        # event|workflow|branch|effect|neutral_group|terminal|loop|truncated
  "label": str,       # texto principal (nome de CRM SEM escapar — escape é do HTML)
  "detail": str,      # complemento ("3 steps", nome do stage, etc.)
  "flags": list[str], # "draft" | "inactive" | "missing"
  "conds": list[str], # condições não avaliadas (viram chips "se: ...")
  "children": list,   # nós filhos
}
```

**Retorno de `build_journey(ctx, max_depth=8, max_nodes=4000)`:**
```python
{
  "meta": {"locationId": str, "extractedAt": str, "n_workflows": int},
  "criacao": list[node],   # raiz "Contato criado"
  "anytime": list[node],   # raiz "A qualquer momento"
  "stats": {"workflows_alcancaveis": int, "terminais": int, "loops": int,
            "eventos_externos": int, "triggers_ignorados": dict[str, int]},
  "truncated": bool,
}
```

---

### Task 1: `TriggerIndex` — normalização e matching de triggers

**Files:**
- Create: `auditor/src/automaster_audit/journey.py`
- Create: `auditor/tests/test_journey.py`

- [ ] **Step 1: Escrever testes falhando**

Criar `auditor/tests/test_journey.py`:

```python
"""Testes do motor da árvore de jornada do contato."""
from automaster_audit.journey import TriggerIndex, build_journey
from automaster_audit.loader import load_dump
from conftest import wf


def trig(ttype, target_wf, name="T", conditions=None, active=True, deleted=False, tid="tr1"):
    """Trigger com o shape real do dump (actions = add_to_workflow)."""
    return {
        "id": tid, "type": ttype, "name": name, "active": active, "deleted": deleted,
        "workflow_id": target_wf,
        "actions": [{"workflow_id": target_wf, "type": "add_to_workflow"}],
        "conditions": conditions or [],
    }


def tag_cond(value):
    return {"operator": "index-of-true", "id": "tag-added", "value": value,
            "title": "Tag Added", "type": "select", "field": "tagsAdded"}


def test_trigger_index_groups_by_type_and_respects_inactive(make_dump):
    t1 = trig("contact_created", "a", tid="t1")
    t2 = trig("contact_tag", "a", conditions=[tag_cond("quente")], tid="t2")
    t3 = trig("contact_created", "a", active=False, tid="t3")
    t4 = trig("contact_created", "a", deleted=True, tid="t4")
    path = make_dump(workflows=[wf(id="a", triggers=[t1, t2, t3, t4])])
    idx = TriggerIndex(load_dump(path))
    created = idx.of_type("contact_created")
    # deleted some; inactive fica com flag
    assert len(created) == 2
    assert {t["id"] for t in created} == {"t1", "t3"}
    inactive = next(t for t in created if t["id"] == "t3")
    assert inactive["active"] is False
    assert len(idx.of_type("contact_tag")) == 1


def test_for_tag_matches_condition_value_case_insensitive(make_dump):
    t = trig("contact_tag", "a", conditions=[tag_cond("Quente")])
    any_tag = trig("contact_tag", "b", tid="t-any")  # sem condição de tag = qualquer tag
    path = make_dump(workflows=[wf(id="a", triggers=[t]), wf(id="b", triggers=[any_tag])])
    idx = TriggerIndex(load_dump(path))
    hits = idx.for_tag("quente")
    assert {h["id"] for h in hits} == {"tr1", "t-any"}
    assert idx.for_tag("frio") and idx.for_tag("frio")[0]["id"] == "t-any"


def test_unknown_trigger_type_counted_not_crashed(make_dump):
    t = trig("form_submitted", "a", tid="t-x")
    path = make_dump(workflows=[wf(id="a", triggers=[t])])
    idx = TriggerIndex(load_dump(path))
    assert idx.ignored.get("form_submitted") == 1
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd auditor && .venv/bin/python -m pytest tests/test_journey.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'automaster_audit.journey'`

- [ ] **Step 3: Implementar `journey.py` (índice apenas)**

Criar `auditor/src/automaster_audit/journey.py`:

```python
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
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd auditor && .venv/bin/python -m pytest tests/test_journey.py -v`
Expected: 3 PASS (o import de `build_journey` ainda falha? Não — `build_journey` só é usado nos testes das próximas tasks; se o import quebrar, adicionar stub `def build_journey(*a, **k): raise NotImplementedError` temporário. Melhor: remover `build_journey` do import do teste por enquanto e adicionar na Task 2).

Ajuste: na Task 1 o import do teste é só `from automaster_audit.journey import TriggerIndex`.

- [ ] **Step 5: Suíte inteira verde + commit**

Run: `cd auditor && .venv/bin/python -m pytest -q` → 85 passed
```bash
git add auditor/src/automaster_audit/journey.py auditor/tests/test_journey.py
git commit -m "feat(journey): TriggerIndex — normalização e matching de triggers"
```

---

### Task 2: caminhada básica — contact_created → workflow condensado

**Files:**
- Modify: `auditor/src/automaster_audit/journey.py`
- Test: `auditor/tests/test_journey.py`

- [ ] **Step 1: Testes falhando**

Adicionar em `tests/test_journey.py`:

```python
def step(id, type="sms", name=None, next=None, parent=None, attrs=None):
    s = {"id": id, "type": type, "name": name or id, "attributes": attrs or {}}
    if next is not None:
        s["next"] = next
    if parent is not None:
        s["parent"] = parent
    return s


def test_contact_created_cascade_with_effects_and_neutrals(make_dump):
    steps = [
        step("s1", "add_contact_tag", next="s2", attrs={"tags": ["quente"]}),
        step("s2", "wait", next="s3", parent="s1"),
        step("s3", "wait", next="s4", parent="s2"),
        step("s4", "sms", parent="s3"),  # sem next = terminal
    ]
    w = wf(id="a", name="Boas-vindas", steps=steps,
           triggers=[trig("contact_created", "a", name="Contato criado")])
    data = build_journey(load_dump(make_dump(workflows=[w])))
    assert len(data["criacao"]) == 1
    ev = data["criacao"][0]
    assert ev["kind"] == "event"
    wnode = ev["children"][0]
    assert wnode["kind"] == "workflow" and wnode["label"] == "Boas-vindas"
    kinds = [c["kind"] for c in wnode["children"]]
    # TAG+ , "+2 steps neutros", MSG, [fim]
    assert kinds == ["effect", "neutral_group", "effect", "terminal"]
    assert wnode["children"][1]["label"] == "+2 steps neutros"
    assert len(wnode["children"][1]["children"]) == 2


def test_branch_container_forks_with_labels(make_dump):
    steps = [
        step("c", "if_else", next=["b1", "b2"],
             attrs={"branches": [{"id": "b1", "name": "Respondeu"}, {"id": "b2", "name": "ELSE"}]}),
        step("b1", "if_else", parent="c", next="x1", attrs={"if": {}}),
        step("b2", "if_else", parent="c", attrs={"else": True}),  # ramo vazio → sai
        step("x1", "sms", parent="b1"),
    ]
    w = wf(id="a", steps=steps, triggers=[trig("contact_created", "a")])
    data = build_journey(load_dump(make_dump(workflows=[w])))
    wnode = data["criacao"][0]["children"][0]
    branches = [c for c in wnode["children"] if c["kind"] == "branch"]
    assert [b["label"] for b in branches] == ["Respondeu", "ELSE"]
    assert branches[1]["children"][0]["kind"] == "terminal"
```

(Import do teste vira `from automaster_audit.journey import TriggerIndex, build_journey`.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `.venv/bin/python -m pytest tests/test_journey.py -v`
Expected: FAIL — `ImportError: cannot import name 'build_journey'`

- [ ] **Step 3: Implementar caminhada + build_journey**

Adicionar em `journey.py` (depois de `TriggerIndex`):

```python
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
                if stype == "add_to_workflow":
                    pass  # add_to_workflow tratado abaixo (não está em EFFECT_TYPES)
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
        """Eventos externos ancorados neste efeito (Tasks 3-4 preenchem)."""
        return []


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
```

Nota de implementação: `add_to_workflow` NÃO entra em `EFFECT_TYPES` (tem tratamento próprio). Conferir que o `elif stype == "add_to_workflow"` é alcançável (está depois do `if stype in EFFECT_TYPES`).

- [ ] **Step 4: Rodar e ver passar**

Run: `.venv/bin/python -m pytest tests/test_journey.py -v` → todos PASS

- [ ] **Step 5: Suíte inteira + commit**

Run: `.venv/bin/python -m pytest -q` → verde
```bash
git add -A auditor/src/automaster_audit/journey.py auditor/tests/test_journey.py
git commit -m "feat(journey): caminhada condensada contact_created → workflow"
```

---

### Task 3: cascata por tag + ciclo entre workflows + caps

**Files:**
- Modify: `auditor/src/automaster_audit/journey.py` (métodos `_events_for_effect`, testes de cap)
- Test: `auditor/tests/test_journey.py`

- [ ] **Step 1: Testes falhando**

```python
def test_tag_added_cascades_into_triggered_workflow(make_dump):
    a = wf(id="a", name="A", steps=[step("s1", "add_contact_tag", attrs={"tags": ["quente"]})],
           triggers=[trig("contact_created", "a")])
    b = wf(id="b", name="B", steps=[step("s2", "sms")],
           triggers=[trig("contact_tag", "b", conditions=[tag_cond("quente")], tid="tb")])
    data = build_journey(load_dump(make_dump(workflows=[a, b], tags=["quente"])))
    eff = data["criacao"][0]["children"][0]["children"][0]
    assert eff["kind"] == "effect" and eff["label"] == "adiciona tag"
    ev = eff["children"][0]
    assert ev["kind"] == "event" and "quente" in ev["label"]
    assert ev["children"][0]["label"] == "B"


def test_workflow_cycle_marks_loop_not_infinite(make_dump):
    a = wf(id="a", name="A", steps=[step("s1", "add_contact_tag", attrs={"tags": ["t1"]})],
           triggers=[trig("contact_created", "a"),
                     trig("contact_tag", "a", conditions=[tag_cond("t2")], tid="ta2")])
    b = wf(id="b", name="B", steps=[step("s2", "add_contact_tag", attrs={"tags": ["t2"]})],
           triggers=[trig("contact_tag", "b", conditions=[tag_cond("t1")], tid="tb")])
    data = build_journey(load_dump(make_dump(workflows=[a, b], tags=["t1", "t2"])))
    # A → tag t1 → B → tag t2 → A (loop)
    ev_b = data["criacao"][0]["children"][0]["children"][0]["children"][0]
    wf_b = ev_b["children"][0]
    ev_a = wf_b["children"][0]["children"][0]
    assert ev_a["children"][0]["kind"] == "loop"
    assert data["stats"]["loops"] >= 1


def test_node_cap_produces_truncated_flag(make_dump):
    a = wf(id="a", name="A",
           steps=[step(f"s{i}", "sms", next=f"s{i+1}" if i < 30 else None,
                       parent=f"s{i-1}" if i > 0 else None) for i in range(31)],
           triggers=[trig("contact_created", "a")])
    data = build_journey(load_dump(make_dump(workflows=[a])), max_nodes=5)
    assert data["truncated"] is True
    flat = str(data)
    assert "truncated" in flat and "✂" in flat


def test_inactive_trigger_and_draft_workflow_flagged(make_dump):
    a = wf(id="a", name="A", status="draft", steps=[step("s1", "sms")],
           triggers=[trig("contact_created", "a", active=False)])
    data = build_journey(load_dump(make_dump(workflows=[a])))
    ev = data["criacao"][0]
    assert "inactive" in ev["flags"]
    assert "draft" in ev["children"][0]["flags"]
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `.venv/bin/python -m pytest tests/test_journey.py -v`
Expected: os 2 primeiros FAIL (cascade vazio — `_events_for_effect` devolve []); cap e flags podem já passar parcialmente (flags já implementadas na Task 2 — ok se passarem).

- [ ] **Step 3: Implementar ancoragem de tag em `_events_for_effect`**

Substituir o método `_events_for_effect` da classe `_Walker`:

```python
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
        return out

    def _event_node(self, label: str, t: dict, wf_stack: frozenset, depth: int) -> dict:
        """Nó de evento → workflow alvo do trigger. Conds restantes viram chips."""
        self.stats["eventos_externos"] += 1
        flags = [] if t.get("active", True) else ["inactive"]
        conds = [_cond_summary(c) for c in t.get("rest", t.get("conditions") or [])]
        ev = _node("event", label, detail=t.get("name") or "", flags=flags, conds=conds)
        ev["children"] = [self.workflow_node(t["target"], wf_stack, depth + 1)]
        return ev
```

- [ ] **Step 4: Rodar e ver passar**

Run: `.venv/bin/python -m pytest tests/test_journey.py -v` → todos PASS

- [ ] **Step 5: Suíte + commit**

```bash
git add -A && git commit -m "feat(journey): cascata por tag, loop entre workflows, caps explícitos"
```

---

### Task 4: reply/ligação ancorados + oportunidade + campo

**Files:**
- Modify: `auditor/src/automaster_audit/journey.py`
- Test: `auditor/tests/test_journey.py`

- [ ] **Step 1: Testes falhando**

```python
def wf_id_cond(wf_id):
    return {"operator": "==", "field": "workflow.id", "value": wf_id,
            "title": "In Workflow", "type": "select"}


def test_reply_anchors_only_in_scoped_workflow(make_dump):
    a = wf(id="a", name="A", steps=[step("s1", "sms")], triggers=[trig("contact_created", "a")])
    b = wf(id="b", name="B", steps=[step("s2", "sms")], triggers=[])
    r = wf(id="r", name="Resposta", steps=[step("s3", "sms")],
           triggers=[trig("customer_reply", "r", conditions=[wf_id_cond("a")], tid="tr-r")])
    data = build_journey(load_dump(make_dump(workflows=[a, b, r])))
    wf_a = data["criacao"][0]["children"][0]
    msg = wf_a["children"][0]
    assert msg["label"].startswith("mensagem")
    reply_ev = [c for c in msg["children"] if c["kind"] == "event"]
    assert len(reply_ev) == 1 and "se responder" in reply_ev[0]["label"]
    assert reply_ev[0]["children"][0]["label"] == "Resposta"


def test_reply_with_message_condition_becomes_chip(make_dump):
    cond = {"operator": "string-contains-any-of", "field": "message.body",
            "value": ["oi"], "title": "Contains phrase", "type": "string"}
    a = wf(id="a", name="A", steps=[step("s1", "sms")], triggers=[trig("contact_created", "a")])
    r = wf(id="r", name="R", steps=[step("s2", "sms")],
           triggers=[trig("customer_reply", "r", conditions=[cond], tid="tr-r")])
    data = build_journey(load_dump(make_dump(workflows=[a, r])))
    msg = data["criacao"][0]["children"][0]["children"][0]
    ev = [c for c in msg["children"] if c["kind"] == "event"][0]
    assert any("Contains phrase" in c for c in ev["conds"])


def test_opportunity_created_anchors_by_pipeline(make_dump):
    pipe_cond = {"operator": "==", "field": "opportunity.pipelineId", "value": "P1",
                 "title": "In pipeline", "type": "select"}
    create = step("s1", "internal_create_opportunity",
                  attrs={"pipelineId": "P1",
                         "__customInputFields__": [{"filterField": "pipelineStageId", "value": "S1"}]})
    a = wf(id="a", name="A", steps=[create], triggers=[trig("contact_created", "a")])
    o = wf(id="o", name="Opp", steps=[step("s2", "sms")],
           triggers=[trig("opportunity_created", "o", conditions=[pipe_cond], tid="t-o")])
    other = wf(id="x", name="Outro", steps=[step("s3", "sms")],
               triggers=[trig("opportunity_created", "x",
                              conditions=[{**pipe_cond, "value": "P2"}], tid="t-x")])
    data = build_journey(load_dump(make_dump(
        workflows=[a, o, other],
        pipelines=[{"id": "P1", "name": "Vendas", "stages": [{"id": "S1", "name": "Novo"}]}])))
    opp = data["criacao"][0]["children"][0]["children"][0]
    assert opp["label"] == "cria oportunidade"
    evs = [c for c in opp["children"] if c["kind"] == "event"]
    assert len(evs) == 1 and evs[0]["children"][0]["label"] == "Opp"


def test_call_disposition_becomes_event_label(make_dump):
    disp = {"operator": "contains-any", "field": "custom_disposition",
            "value": ["Desqualificado"], "title": "Custom Disposition", "type": "multiselect"}
    a = wf(id="a", name="A", steps=[step("s1", "manual-call")],
           triggers=[trig("contact_created", "a")])
    c = wf(id="c", name="PosCall", steps=[step("s2", "sms")],
           triggers=[trig("call_status", "c", conditions=[wf_id_cond("a"), disp], tid="t-c")])
    data = build_journey(load_dump(make_dump(workflows=[a, c])))
    call = data["criacao"][0]["children"][0]["children"][0]
    evs = [x for x in call["children"] if x["kind"] == "event"]
    assert len(evs) == 1 and "Desqualificado" in evs[0]["label"]
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `.venv/bin/python -m pytest tests/test_journey.py -v` → 4 novos FAIL

- [ ] **Step 3: Implementar matching de reply/call/opportunity/field**

Adicionar métodos em `TriggerIndex`:

```python
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
```

Estender `_Walker._events_for_effect` (substituir o método inteiro):

```python
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
```

- [ ] **Step 4: Rodar e ver passar**

Run: `.venv/bin/python -m pytest tests/test_journey.py -v` → todos PASS

- [ ] **Step 5: Suíte + commit**

```bash
git add -A && git commit -m "feat(journey): eventos reply/ligação/oportunidade/campo ancorados inline"
```

---

### Task 5: grupo "A qualquer momento" + stats finais

**Files:**
- Modify: `auditor/src/automaster_audit/journey.py` (função `build_journey` + helper `_anytime`)
- Test: `auditor/tests/test_journey.py`

- [ ] **Step 1: Testes falhando**

```python
def test_manual_tag_trigger_goes_to_anytime(make_dump):
    # ninguém adiciona "vip" por step → trigger é manual → anytime
    a = wf(id="a", name="A", steps=[step("s1", "sms")], triggers=[trig("contact_created", "a")])
    v = wf(id="v", name="VIP", steps=[step("s2", "sms")],
           triggers=[trig("contact_tag", "v", conditions=[tag_cond("vip")], tid="t-v")])
    data = build_journey(load_dump(make_dump(workflows=[a, v], tags=["vip"])))
    labels = [n["label"] for n in data["anytime"]]
    assert any("vip" in l for l in labels)
    vip = next(n for n in data["anytime"] if "vip" in n["label"])
    assert vip["children"][0]["label"] == "VIP"


def test_birthday_always_anytime_and_stats(make_dump):
    a = wf(id="a", name="A", steps=[step("s1", "sms")],
           triggers=[trig("contact_created", "a"), trig("birthday_reminder", "a", tid="t-b")])
    data = build_journey(load_dump(make_dump(workflows=[a])))
    assert any(n["detail"] == "birthday_reminder" or "anivers" in n["label"].lower()
               for n in data["anytime"])
    s = data["stats"]
    assert s["workflows_alcancaveis"] >= 1
    assert "triggers_ignorados" in s
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `.venv/bin/python -m pytest tests/test_journey.py -v` → 2 FAIL

- [ ] **Step 3: Implementar `_anytime`**

Em `build_journey`, substituir `anytime: list[dict] = []  # Task 5` por
`anytime = _build_anytime(ctx, idx, walker)` e adicionar a função:

```python
_ANYTIME_LABELS = {
    "birthday_reminder": "Aniversário do contato",
    "appointment": "Agendamento",
    "customer_reply": "Contato responde (sem âncora)",
    "call_status": "Resultado de ligação (sem âncora)",
    "contact_changed": "Campo do contato alterado (manual)",
    "opportunity_decay": "Oportunidade estagnada (decay)",
}


def _build_anytime(ctx: DumpContext, idx: TriggerIndex, walker: _Walker) -> list[dict]:
    """Eventos que nenhum step do sistema causa → grupo na raiz.

    Regra de ancoragem invertida: o trigger entra aqui quando seu causador
    interno não existe (tag que ninguém adiciona, pipeline que ninguém cria,
    reply/call com workflow.id que não manda mensagem/liga, ou tipos
    intrinsecamente externos: birthday/appointment).
    """
    # capacidades internas do sistema (o que os steps conseguem causar)
    tags_addable: set[str] = set()
    pipes_creatable: set[str] = set()
    wfs_messaging: set[str] = set()
    wfs_calling: set[str] = set()
    any_field_update = False
    for w in ctx.workflows:
        for s in w.steps:
            a = s.get("attributes") or {}
            t = s.get("type")
            if t == "add_contact_tag":
                tags_addable.update(x.strip().lower() for x in a.get("tags") or [])
            elif t == "internal_create_opportunity" and a.get("pipelineId"):
                pipes_creatable.add(a["pipelineId"])
            elif t in MESSAGE_TYPES:
                wfs_messaging.add(w.id)
            elif t == "manual-call":
                wfs_calling.add(w.id)
            elif t == "update_contact_field":
                any_field_update = True

    out: list[dict] = []

    def add(label: str, t: dict):
        out.append(walker._event_node(label, {**t, "rest": t["conditions"]}, frozenset(), 1))

    for t in idx.of_type("contact_tag"):
        tag_conds = [c for c in t["conditions"] if _cond_field(c) == "tagsAdded"]
        if not tag_conds:
            continue  # "qualquer tag" já ancora em todo add_contact_tag
        vals = {str(c.get("value") or "").strip().lower() for c in tag_conds}
        if not (vals & tags_addable):
            add(f"tag “{', '.join(sorted(vals))}” adicionada manualmente", t)

    for t in idx.of_type("opportunity_created"):
        pconds = [c for c in t["conditions"] if _cond_field(c) == "opportunity.pipelineId"]
        vals = {str(c.get("value")) for c in pconds}
        if pconds and not (vals & pipes_creatable):
            add("oportunidade criada manualmente", t)
        elif not pconds and not pipes_creatable:
            add("oportunidade criada manualmente", t)

    for t in idx.of_type("customer_reply"):
        scope = [c for c in t["conditions"] if _cond_field(c) == "workflow.id"]
        vals = {str(c.get("value")) for c in scope}
        if scope and not (vals & wfs_messaging):
            add(_ANYTIME_LABELS["customer_reply"], t)
        elif not scope and not wfs_messaging:
            add(_ANYTIME_LABELS["customer_reply"], t)

    for t in idx.of_type("call_status"):
        scope = [c for c in t["conditions"] if _cond_field(c) == "workflow.id"]
        vals = {str(c.get("value")) for c in scope}
        if scope and not (vals & wfs_calling):
            add(_ANYTIME_LABELS["call_status"], t)
        elif not scope and not wfs_calling:
            add(_ANYTIME_LABELS["call_status"], t)

    if not any_field_update:
        for t in idx.of_type("contact_changed"):
            add(_ANYTIME_LABELS["contact_changed"], t)

    if not pipes_creatable:
        for t in idx.of_type("opportunity_decay"):
            add(_ANYTIME_LABELS["opportunity_decay"], t)

    for ttype in ("birthday_reminder", "appointment"):
        for t in idx.of_type(ttype):
            add(_ANYTIME_LABELS[ttype], t)

    return out
```

Atenção à ordem em `build_journey`: `_build_anytime` usa `walker` (e consome budget) — chamar DEPOIS do laço de `criacao` e ANTES de fechar `stats["workflows_alcancaveis"]`.

- [ ] **Step 4: Rodar e ver passar**

Run: `.venv/bin/python -m pytest tests/test_journey.py -v` → todos PASS

- [ ] **Step 5: Sanidade no dump real + commit**

Run:
```bash
.venv/bin/python -c "
from automaster_audit.loader import load_dump
from automaster_audit.journey import build_journey
d = build_journey(load_dump('../dumps/WPIUKW3L4lDyMhLhKYKG/2026-06-10_2221'))
print('criacao:', len(d['criacao']), 'anytime:', len(d['anytime']))
print('stats:', d['stats']); print('truncated:', d['truncated'])
"
```
Expected: roda sem crash; criacao=2 (2 triggers contact_created); loops ≥ 1 (ciclo 1A⇄1B); truncated False.

```bash
git add -A && git commit -m "feat(journey): grupo 'a qualquer momento' + stats"
```

---

### Task 6: `journey_html.py` — página no shell Sala de Controle

**Files:**
- Create: `auditor/src/automaster_audit/journey_html.py`
- Create: `auditor/tests/test_journey_html.py`

- [ ] **Step 1: Testes falhando**

Criar `auditor/tests/test_journey_html.py`:

```python
from automaster_audit.journey import build_journey
from automaster_audit.journey_html import write_journey_html
from automaster_audit.loader import load_dump
from conftest import wf
from test_journey import step, trig


def test_journey_html_selfcontained_and_xss_safe(make_dump, tmp_path):
    evil = '</script><img src=x onerror=alert(1)>'
    a = wf(id="a", name=evil, steps=[step("s1", "sms")],
           triggers=[trig("contact_created", "a")])
    data = build_journey(load_dump(make_dump(workflows=[a])))
    out = write_journey_html(data, tmp_path / "j.html", title="T")
    html = out.read_text(encoding="utf-8")
    assert "</script><img" not in html
    assert 'src="http' not in html and 'href="http' not in html.replace(
        'href="dashboard.html', "").replace('href="graph.html', "").replace(
        'href="validation.html', "").replace('href="journey.html', "")
    assert "unpkg" not in html


def test_journey_html_renders_tree_and_stats(make_dump, tmp_path):
    a = wf(id="a", name="A", steps=[step("s1", "add_contact_tag", attrs={"tags": ["q"]})],
           triggers=[trig("contact_created", "a")])
    b = wf(id="b", name="B", steps=[step("s2", "sms")],
           triggers=[trig("contact_tag", "b", conditions=[
               {"operator": "index-of-true", "id": "tag-added", "value": "q",
                "title": "Tag Added", "type": "select", "field": "tagsAdded"}], tid="tb")])
    data = build_journey(load_dump(make_dump(workflows=[a, b], tags=["q"])))
    out = write_journey_html(data, tmp_path / "j.html", title="T")
    html = out.read_text(encoding="utf-8")
    assert "Contato criado" in html and "A qualquer momento" in html
    assert "<details" in html and "TAG+" in html
    assert "data-jfilter" in html  # input de filtro presente
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `.venv/bin/python -m pytest tests/test_journey_html.py -v`
Expected: FAIL — módulo inexistente

- [ ] **Step 3: Implementar `journey_html.py`**

```python
"""Renderiza a árvore de jornada do contato — shell "Sala de Controle" (IBM Carbon).

Árvore com <details> nativo; prefixos mono por tipo de nó; chips para condições
não avaliadas, DRAFT/INATIVO e referência quebrada. JS mínimo (expandir/recolher
tudo + filtro de texto) em constante separada (padrão str.format do projeto).
"""
from __future__ import annotations

import html as _html
import re
from pathlib import Path

from .theme import head_assets, shell_meta, sidebar, topbar


def _esc(s) -> str:
    return _html.escape("" if s is None else str(s), quote=True)


_DUMP_DIR_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})$")


def _extracted_from_path(out_path: Path) -> str:
    m = _DUMP_DIR_RE.match(out_path.parent.name)
    return f"{m.group(1)} {m.group(2)}:{m.group(3)}" if m else ""


# prefixo mono por (kind, label-base)
def _prefix(n: dict) -> str:
    k = n["kind"]
    if k == "event":
        return "EVT"
    if k == "workflow":
        return "WF"
    if k == "branch":
        return "RAMO"
    if k == "loop":
        return "LOOP"
    if k == "truncated":
        return "CAP"
    if k == "terminal":
        return "FIM"
    if k == "neutral_group":
        return "···"
    lbl = n["label"]
    if lbl.startswith("adiciona tag"):
        return "TAG+"
    if lbl.startswith("remove tag"):
        return "TAG−"
    if lbl.startswith("mensagem"):
        return "MSG"
    if "oportunidade" in lbl:
        return "OPP"
    if lbl.startswith("envia para workflow"):
        return "→WF"
    if lbl.startswith("atualiza campo"):
        return "FLD"
    if lbl.startswith("atribui"):
        return "USR"
    if lbl.startswith("webhook"):
        return "HOOK"
    if lbl.startswith("notificação"):
        return "NOTIF"
    if lbl.startswith("ligação"):
        return "CALL"
    return "·"


_FLAG_CHIP = {
    "draft": '<span class="chip warn">DRAFT</span>',
    "inactive": '<span class="chip warn">INATIVO</span>',
    "missing": '<span class="chip err">REF QUEBRADA</span>',
}


def _node_html(n: dict) -> str:
    pre = f'<span class="jpre jpre-{n["kind"]}">{_esc(_prefix(n))}</span>'
    label = f'<span class="jlbl">{_esc(n["label"])}</span>'
    detail = f'<span class="jdet">{_esc(n["detail"])}</span>' if n["detail"] else ""
    chips = "".join(_FLAG_CHIP.get(f, "") for f in n["flags"])
    chips += "".join(f'<span class="chip cond">se: {_esc(c)}</span>' for c in n["conds"])
    head = f"{pre}{label}{detail}{chips}"
    if not n["children"]:
        return f'<div class="jleaf jk-{n["kind"]}">{head}</div>'
    kids = "".join(_node_html(c) for c in n["children"])
    op = "" if n["kind"] == "neutral_group" else " open"
    return (f'<details class="jnode jk-{n["kind"]}"{op}><summary>{head}</summary>'
            f'<div class="jkids">{kids}</div></details>')


# CSS da página (chaves NÃO passam pelo str.format — injetado como valor)
_PAGE_CSS = """
.jtree{background:var(--panel);border:1px solid var(--border);padding:8px 16px 16px}
.jtree+.jtree{margin-top:24px}
.jroot{font-size:14px;font-weight:600;padding:12px 0 4px}
.jnode,.jleaf{margin:0;padding:0}
.jkids{margin-left:14px;padding-left:14px;border-left:1px solid var(--border)}
.jnode>summary{cursor:pointer;list-style:none;display:flex;align-items:baseline;gap:8px;
  padding:5px 0;flex-wrap:wrap}
.jnode>summary::-webkit-details-marker{display:none}
.jnode>summary::before{content:"+";font-family:var(--mono);color:var(--ink-3);width:12px}
.jnode[open]>summary::before{content:"−"}
.jleaf{display:flex;align-items:baseline;gap:8px;padding:5px 0 5px 12px;flex-wrap:wrap}
.jpre{font-family:var(--mono);font-size:10px;letter-spacing:.06em;color:var(--ink-2);
  border:1px solid var(--border);padding:1px 6px;flex:none}
.jpre-event{background:var(--gray-tint);border-color:var(--border-strong)}
.jpre-workflow{background:#161616;color:#fff;border-color:#161616}
.jpre-terminal,.jpre-loop{border-style:dashed}
.jk-loop .jlbl,.jk-loop .jpre{color:var(--amber-ink)}
.jk-truncated .jlbl,.jk-truncated .jpre{color:var(--red-ink)}
.jlbl{font-size:13.5px}
.jk-workflow>summary .jlbl{font-weight:600}
.jdet{font-family:var(--mono);font-size:11px;color:var(--ink-3)}
.chip{font-family:var(--mono);font-size:10px;padding:1px 6px;border:1px solid var(--border-strong);
  background:var(--gray-tint);color:var(--gray-ink)}
.chip.warn{background:var(--amber-tint);color:var(--amber-ink);border-color:var(--amber)}
.chip.err{background:var(--red-tint);color:var(--red-ink);border-color:var(--red)}
.chip.cond{background:var(--selected);color:var(--blue);border-color:var(--blue)}
.jbar{display:flex;gap:8px;align-items:center;margin:0 0 16px}
.jbar input{flex:0 1 380px;height:36px;border:1px solid var(--border);padding:0 12px;
  font-size:13px;background:var(--panel);color:var(--ink)}
.jbar button{height:36px;border:1px solid var(--border);background:var(--panel);
  font-size:12px;padding:0 12px;cursor:pointer;color:var(--ink-2)}
.jbar button:hover{background:var(--bg)}
.jhidden{display:none!important}
"""

_JS = """
const q = document.querySelector('[data-jfilter]');
const all = () => Array.from(document.querySelectorAll('.jnode,.jleaf'));
document.querySelector('[data-jexpand]').onclick = () =>
  document.querySelectorAll('details.jnode').forEach(d => d.open = true);
document.querySelector('[data-jcollapse]').onclick = () =>
  document.querySelectorAll('details.jnode').forEach(d => d.open = false);
q.addEventListener('input', () => {
  const v = q.value.trim().toLowerCase();
  all().forEach(el => el.classList.remove('jhidden'));
  if (!v) return;
  const match = el => el.textContent.toLowerCase().includes(v);
  document.querySelectorAll('.jtree > details.jnode').forEach(root => {
    if (!match(root)) { root.classList.add('jhidden'); return; }
    root.querySelectorAll('.jnode,.jleaf').forEach(el => {
      if (!match(el)) el.classList.add('jhidden');
    });
  });
});
"""

_TEMPLATE = """<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AUTOMASTER // JORNADA {title}</title>
{head_assets}
<style>{page_css}</style>
</head><body>
{topbar}
{sidebar}
<main class="main">
<div class="crumb">{loc} / <b>Jornada do contato</b></div>
<h1>Jornada do contato</h1>
<div class="h1-sub">{sub}</div>
<div class="jbar">
  <input data-jfilter placeholder="filtrar na árvore..." autocomplete="off">
  <button data-jexpand>expandir tudo</button>
  <button data-jcollapse>recolher tudo</button>
</div>
{trees}
</main>
<script>{js}</script>
</body></html>"""


def _tree_section(title: str, nodes: list[dict], empty: str) -> str:
    body = "".join(_node_html(n) for n in nodes) if nodes else \
        f'<div class="jleaf"><span class="jdet">{_esc(empty)}</span></div>'
    return f'<section class="jtree"><div class="jroot">{_esc(title)}</div>{body}</section>'


def write_journey_html(data: dict, out: Path, title: str = "") -> Path:
    out = Path(out)
    meta = data["meta"]
    s = data["stats"]
    sub_parts = [
        f"{s['workflows_alcancaveis']} workflows alcançáveis",
        f"{s['terminais']} terminais",
        f"{s['loops']} loops",
        f"{s['eventos_externos']} eventos externos",
    ]
    if data.get("truncated"):
        sub_parts.append("⚠ árvore truncada (caps)")
    ign = s.get("triggers_ignorados") or {}
    if ign:
        sub_parts.append("ignorados: " + ", ".join(f"{k}×{v}" for k, v in sorted(ign.items())))
    sm = shell_meta(out.parent)
    trees = (
        _tree_section("Contato criado", data["criacao"],
                      "nenhum trigger de criação de contato no dump")
        + _tree_section("A qualquer momento", data["anytime"],
                        "nenhum evento sem âncora interna")
    )
    html = _TEMPLATE.format(
        title=_esc(title or meta.get("locationId") or "dump"),
        head_assets=head_assets(),
        page_css=_PAGE_CSS,
        topbar=topbar(meta.get("locationId", ""),
                      _extracted_from_path(out) or str(meta.get("extractedAt") or ""),
                      schema=sm.get("schema")),
        sidebar=sidebar("journey", sm.get("counts")),
        loc=_esc(meta.get("locationId", "")),
        sub=_esc(" · ".join(sub_parts)),
        trees=trees,
        js=_JS,
    )
    out.write_text(html, encoding="utf-8")
    return out
```

- [ ] **Step 4: Rodar e ver passar**

Run: `.venv/bin/python -m pytest tests/test_journey_html.py -v` → PASS
(Se o teste de auto-contenção acusar os href do sidebar: a asserção já exclui os
4 links relativos — conferir que só eles aparecem.)

- [ ] **Step 5: Suíte + commit**

```bash
git add -A && git commit -m "feat(journey): journey.html no shell Sala de Controle"
```

---

### Task 7: subcomando CLI `journey`

**Files:**
- Modify: `auditor/src/automaster_audit/cli.py`
- Test: `auditor/tests/test_journey_html.py` (append)

- [ ] **Step 1: Teste falhando**

Adicionar em `tests/test_journey_html.py`:

```python
def test_cli_journey_subcommand(make_dump, capsys):
    from automaster_audit.cli import main
    a = wf(id="a", name="A", steps=[step("s1", "sms")],
           triggers=[trig("contact_created", "a")])
    path = make_dump(workflows=[a])
    rc = main(["journey", str(path)])
    assert rc == 0
    assert (path / "journey.html").exists()
    outtxt = capsys.readouterr().out
    assert "jornada" in outtxt.lower()
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `.venv/bin/python -m pytest tests/test_journey_html.py::test_cli_journey_subcommand -v`
Expected: FAIL — argparse `invalid choice: 'journey'`

- [ ] **Step 3: Implementar no `cli.py`**

Imports (junto dos demais):
```python
from .journey import build_journey
from .journey_html import write_journey_html
```

Handler (depois de `run_validation`):
```python
def run_journey(args: argparse.Namespace) -> int:
    try:
        ctx = load_dump(args.dump_path)
    except DumpError as e:
        print(f"erro: {e}", file=sys.stderr)
        return 2
    data = build_journey(ctx)
    out = args.output or (Path(args.dump_path) / "journey.html")
    write_journey_html(data, out, title=ctx.manifest.get("locationId", ""))
    s = data["stats"]
    print(f"jornada: {len(data['criacao'])} entradas na criação, "
          f"{len(data['anytime'])} eventos avulsos, "
          f"{s['workflows_alcancaveis']} workflows alcançáveis, {s['loops']} loops")
    if data["truncated"]:
        print("atenção: árvore truncada (caps de profundidade/nós)", file=sys.stderr)
    print(f"abra no browser: {out}")
    return 0
```

No `build_parser()` (depois do bloco `p_val`):
```python
    p_journey = sub.add_parser("journey", help="gera árvore de jornada do contato (HTML)")
    p_journey.add_argument("dump_path", type=Path, help="caminho da pasta de dump")
    p_journey.add_argument("-o", "--output", type=Path,
                           help="arquivo HTML de saída (default: <dump>/journey.html)")
    p_journey.set_defaults(func=run_journey)
```

No atalho do `main()`, incluir `"journey"` na tupla de subcomandos:
```python
    if raw and raw[0] not in ("audit", "graph", "dashboard", "paths", "verify-contracts", "validation", "journey", "-h", "--help") and Path(raw[0]).exists():
```

- [ ] **Step 4: Rodar e ver passar**

Run: `.venv/bin/python -m pytest tests/test_journey_html.py -v` → PASS

- [ ] **Step 5: Suíte + commit**

```bash
git add -A && git commit -m "feat(journey): subcomando automaster-audit journey"
```

---

### Task 8: item na sidebar (theme.py) + regenerar as 4 páginas

**Files:**
- Modify: `auditor/src/automaster_audit/theme.py:333-336`

- [ ] **Step 1: Editar `_SIDEBAR_GROUPS`**

No grupo "Análise", adicionar a linha da jornada entre grafo e validação:

```python
    ("Análise", [
        ("graph", "Grafo de conexões", "graph.html", None),
        ("journey", "Jornada do contato", "journey.html", None),
        ("validation", "Validação", "validation.html", None),
    ]),
```

- [ ] **Step 2: Suíte (nenhum teste depende da lista de nav — deve seguir verde)**

Run: `.venv/bin/python -m pytest -q` → verde

- [ ] **Step 3: Regenerar as 4 páginas no dump real**

```bash
.venv/bin/automaster-audit dashboard ../dumps/WPIUKW3L4lDyMhLhKYKG/2026-06-10_2221/
.venv/bin/automaster-audit graph ../dumps/WPIUKW3L4lDyMhLhKYKG/2026-06-10_2221/
.venv/bin/automaster-audit validation ../dumps/WPIUKW3L4lDyMhLhKYKG/2026-06-10_2221/ --contracts contracts/
.venv/bin/automaster-audit journey ../dumps/WPIUKW3L4lDyMhLhKYKG/2026-06-10_2221/
```
Expected: 4 páginas regeneradas; journey imprime stats com loops ≥ 1.

- [ ] **Step 4: Commit**

```bash
git add auditor/src/automaster_audit/theme.py
git commit -m "feat(journey): item 'Jornada do contato' na sidebar compartilhada"
```

---

### Task 9: CLAUDE.md + verificação visual final

**Files:**
- Modify: `CLAUDE.md` (lista de saídas + comandos)

- [ ] **Step 1: Documentar a 6ª saída no CLAUDE.md**

Na lista de saídas do auditor, adicionar:
```markdown
  - `journey.html` — árvore de jornada do contato: tudo que pode acontecer desde a criação (`automaster-audit journey`)
```
No bloco de comandos:
```bash
.venv/bin/automaster-audit journey dumps/<loc>/<ts>/      # journey.html (árvore de jornada)
```
E em "Módulos do auditor", acrescentar `journey.py`+`journey_html.py`.

- [ ] **Step 2: Screenshots + interação (Playwright)**

Da raiz do projeto:
```bash
npx playwright screenshot --viewport-size=1440,900 \
  "file://$PWD/dumps/WPIUKW3L4lDyMhLhKYKG/2026-06-10_2221/journey.html" _temp/journey-top.png
node -e '
const { chromium } = require(process.cwd()+"/extractor/node_modules/playwright");
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({viewport:{width:1440,height:900}});
  const errs = []; p.on("pageerror", e => errs.push(e.message));
  await p.goto("file://"+process.cwd()+"/dumps/WPIUKW3L4lDyMhLhKYKG/2026-06-10_2221/journey.html");
  await p.click("[data-jcollapse]"); await p.click("[data-jexpand]");
  await p.fill("[data-jfilter]", "1B"); await p.waitForTimeout(200);
  await p.screenshot({path:"_temp/journey-filter.png"});
  console.log("pageerrors:", errs.length ? errs.join("|") : "0");
  await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
'
```
Expected: `pageerrors: 0`. Abrir os 2 PNGs (tool Read) e conferir: árvore legível,
chips visíveis, loop âmbar do ciclo 1A⇄1B presente, filtro escondendo ramos.

- [ ] **Step 3: Suíte final + commit**

Run: `.venv/bin/python -m pytest -q` → verde (≥ 95 testes)
```bash
git add CLAUDE.md
git commit -m "docs: journey.html documentado como 6ª saída do auditor"
```

---

## Self-review (executado na escrita do plano)

- **Cobertura da spec:** raiz dupla (T2/T5), ancoragem inline das 7 linhas da tabela (T3/T4; `add_to_workflow` direto na T2), condensação+neutral_group (T2), loop por ramo (T2 step-level, T3 wf-level), caps explícitos (T3), DRAFT/INATIVO (T2/T3), chips de condição (T3/T4), página+sidebar+CLI (T6/T7/T8), CLAUDE.md+verificação (T9), 8 testes da spec mapeados (T1-T7 + sanidade real em T5/T8).
- **Placeholders:** nenhum — todo step com código completo.
- **Consistência de tipos:** nó `{kind,label,detail,flags,conds,children}` idêntico em journey.py (_node) e journey_html.py (_node_html); `build_journey` assinatura única; `trig`/`step`/`tag_cond` definidos uma vez no test file e importados no segundo via `from test_journey import`.
