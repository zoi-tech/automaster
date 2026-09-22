"""Testes da Camada 3: simulação de cenário contra o grafo (simulate.py)."""

from conftest import wf

from automaster_audit.loader import load_dump
from automaster_audit.simulate import simulate


def _wf(make_dump, steps, triggers=None):
    path = make_dump(workflows=[wf(steps=steps, triggers=triggers)])
    return load_dump(path).workflows[0]


def cond(ctype, csub, cop, cval=...):
    c = {"conditionType": ctype, "conditionSubType": csub, "conditionOperator": cop}
    if cval is not ...:
        c["conditionValue"] = cval
    return c


def seg(conditions, operator="and"):
    return {"__segmentId": "seg1", "operator": operator, "conditions": conditions}


def container(cid, branches, nxt, parent=None):
    """Container if_else: condições vivem AQUI (attributes.branches), shape da Fase 0."""
    s = {
        "id": cid,
        "type": "if_else",
        "name": "Cond",
        "attributes": {
            "operator": "and",
            "if": True,
            "version": 2,
            "noneBranchName": "None",
            "branches": [
                {"id": bid, "name": name, "operator": op, "segments": segs} for bid, name, op, segs in branches
            ],
        },
        "next": nxt,
    }
    if parent:
        s["parent"] = parent
    return s


def branch_yes(bid, name, parent, nxt=None):
    """Nó-branch filho: attributes.if é BOOLEANO false (nunca condição)."""
    s = {"id": bid, "type": "if_else", "name": name, "parent": parent, "attributes": {"if": False}}
    if nxt:
        s["next"] = nxt
    return s


def else_node(eid, parent, nxt=None):
    s = {"id": eid, "type": "if_else", "name": "None", "parent": parent, "attributes": {"else": True}}
    if nxt:
        s["next"] = nxt
    return s


def _tag_steps(conditions=None, extra_branches=()):
    conditions = conditions or [cond("contact_detail", "tags", "index-of-true", ["vip"])]
    branches = [("b1", "VIP", "and", [seg(conditions)])] + list(extra_branches)
    bids = [b[0] for b in branches]
    steps = [
        {"id": "root", "type": "sms", "name": "Root", "next": "c"},
        container("c", branches, bids + ["e"], parent="root"),
    ]
    for i, bid in enumerate(bids):
        steps.append(branch_yes(bid, branches[i][1], "c", f"a{i + 1}"))
        steps.append({"id": f"a{i + 1}", "type": "sms", "name": f"SMS {i + 1}", "parent": bid})
    steps.append(else_node("e", "c", "ae"))
    steps.append({"id": "ae", "type": "sms", "name": "SMS Else", "parent": "e"})
    return steps


# 1. tag index-of-true: case-insensitive; sem a tag → else
def test_tag_case_insensitive_e_else(make_dump):
    w = _wf(make_dump, _tag_steps())
    res = simulate(w, {"tags": ["VIP"]})
    assert res.status == "ok"
    assert ("b1", "VIP") in res.path.steps
    res = simulate(w, {"tags": []})
    assert res.status == "ok"
    assert ("e", "ELSE") in res.path.steps
    assert res.path.terminal == "exit"


# 2. day_week aceita nome pt-BR e int; time com >
def test_day_week_nome_e_int_mesmo_ramo(make_dump):
    steps = _tag_steps(conditions=[cond("date_time", "day_week", "==", "6")])
    w = _wf(make_dump, steps)
    for dado in ({"dia_semana": "sabado"}, {"dia_semana": 6}):
        res = simulate(w, dado)
        assert res.status == "ok"
        assert ("b1", "VIP") in res.path.steps
    res = simulate(w, {"dia_semana": "domingo"})
    assert ("e", "ELSE") in res.path.steps


def test_time_maior_que(make_dump):
    steps = _tag_steps(conditions=[cond("date_time", "time", ">", "11")])
    w = _wf(make_dump, steps)
    res = simulate(w, {"hora": 12})
    assert res.status == "ok"
    assert ("b1", "VIP") in res.path.steps
    res = simulate(w, {"hora": 10})
    assert ("e", "ELSE") in res.path.steps


# 3. Kleene: and(False, None) = False — short-circuit sem ambiguidade
def test_kleene_and_short_circuit(make_dump):
    steps = _tag_steps(
        conditions=[
            cond("date_time", "day_week", "==", "6"),
            cond("date_time", "time", ">", "11"),
        ]
    )
    w = _wf(make_dump, steps)
    # day_week False; 'hora' ausente (None) → branch False → else, NÃO ambiguous
    res = simulate(w, {"dia_semana": 0})
    assert res.status == "ok"
    assert ("e", "ELSE") in res.path.steps
    # ambas True → entra no branch
    res = simulate(w, {"dia_semana": 6, "hora": 12})
    assert res.status == "ok"
    assert ("b1", "VIP") in res.path.steps


# 4. combo fora da tabela → ambiguous com step id; NUNCA path ok
def test_combo_nao_suportado_ambiguous(make_dump):
    steps = _tag_steps(conditions=[cond("opportunity", "pipeline_stage", "==", "x")])
    w = _wf(make_dump, steps)
    res = simulate(w, {"tags": ["vip"], "dia_semana": 6})
    assert res.status == "ambiguous"
    assert res.path is None
    assert "c" in res.motivo  # step id do container


# 5. cenário sem a chave necessária → ambiguous (None ≠ False, não cai no else)
def test_cenario_sem_chave_ambiguous(make_dump):
    w = _wf(make_dump, _tag_steps())
    res = simulate(w, {})
    assert res.status == "ambiguous"
    assert res.path is None
    assert "c" in res.motivo


# 6. find_opportunity: cenário declara; ausente → ambiguous
def test_find_opportunity(make_dump):
    steps = [
        {"id": "f", "type": "find_opportunity", "name": "Find", "attributes": {}, "next": ["t1", "t2"]},
        {"id": "t1", "type": "transition", "name": "Opportunity Found", "parent": "f", "next": "a1"},
        {"id": "t2", "type": "transition", "name": "Opportunity Not Found", "parent": "f"},
        {"id": "a1", "type": "sms", "name": "SMS", "parent": "t1"},
    ]
    w = _wf(make_dump, steps)
    res = simulate(w, {"oportunidade_encontrada": False})
    assert res.status == "ok"
    assert ("t2", "Opportunity Not Found") in res.path.steps
    res = simulate(w, {"oportunidade_encontrada": True})
    assert ("t1", "Opportunity Found") in res.path.steps
    res = simulate(w, {})
    assert res.status == "ambiguous"
    assert "f" in res.motivo


# 7. ciclo via goto → terminal "loop → <id>", status ok, sem recursão infinita
def test_ciclo_goto_ok(make_dump):
    steps = [
        {"id": "root", "type": "sms", "name": "Root", "next": "g"},
        {"id": "g", "type": "goto", "name": "Go To", "parent": "root", "attributes": {"targetNodeId": "root"}},
    ]
    w = _wf(make_dump, steps)
    res = simulate(w, {})
    assert res.status == "ok"
    assert res.path.steps == [("root", None), ("g", None)]
    assert res.path.terminal == "loop → root"


# 8. ordem dos ramos: primeiro True vence; segundo (não suportado) nem é avaliado
def test_ordem_primeiro_true_vence(make_dump):
    extra = [("b2", "Outro", "and", [seg([cond("appointment", "status", "==", "x")])])]
    steps = _tag_steps(extra_branches=extra)
    w = _wf(make_dump, steps)
    res = simulate(w, {"tags": ["vip"]})
    assert res.status == "ok"
    assert ("b1", "VIP") in res.path.steps


# extra: wait reply (shape real do dump: attributes.type wait_reply/wait_timeout)
def test_wait_reply_timeout(make_dump):
    steps = [
        {"id": "w", "type": "wait", "name": "Wait", "attributes": {}, "next": ["tr", "tt"]},
        {
            "id": "tr",
            "type": "transition",
            "name": "wait",
            "parent": "w",
            "attributes": {"type": "wait_reply"},
            "next": "a1",
        },
        {"id": "tt", "type": "transition", "name": "timeout", "parent": "w", "attributes": {"type": "wait_timeout"}},
        {"id": "a1", "type": "sms", "name": "SMS", "parent": "tr"},
    ]
    w = _wf(make_dump, steps)
    res = simulate(w, {"resposta": True})
    assert res.status == "ok"
    assert ("tr", "wait") in res.path.steps
    res = simulate(w, {"resposta": False})
    assert ("tt", "timeout") in res.path.steps
    res = simulate(w, {})
    assert res.status == "ambiguous"
    assert "w" in res.motivo


# extra: trigger == aceita id ou nome resolvido via wf.triggers
def test_trigger_id_ou_nome(make_dump):
    steps = _tag_steps(conditions=[cond("trigger", "trigger", "==", "t1")])
    w = _wf(make_dump, steps, triggers=[{"id": "t1", "name": "Form enviado"}])
    for dado in ({"trigger": "t1"}, {"trigger": "Form enviado"}):
        res = simulate(w, dado)
        assert res.status == "ok"
        assert ("b1", "VIP") in res.path.steps
    res = simulate(w, {"trigger": "outro"})
    assert ("e", "ELSE") in res.path.steps


# extra: sem raiz → ambiguous "sem raiz"
def test_sem_raiz_ambiguous(make_dump):
    w = _wf(make_dump, [])
    res = simulate(w, {})
    assert res.status == "ambiguous"
    assert "sem raiz" in res.motivo
