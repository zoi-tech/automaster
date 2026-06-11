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


def test_decay_scoped_to_uncreated_pipeline_goes_to_anytime(make_dump):
    # decay vigia P2, mas os steps só criam em P1 → não pode sumir da árvore
    pipe_cond = {"operator": "==", "field": "opportunity.pipelineId", "value": "P2",
                 "title": "In pipeline", "type": "select"}
    create = step("s1", "internal_create_opportunity", attrs={"pipelineId": "P1"})
    a = wf(id="a", name="A", steps=[create], triggers=[trig("contact_created", "a")])
    d = wf(id="d", name="Decay", steps=[step("s2", "sms")],
           triggers=[trig("opportunity_decay", "d", conditions=[pipe_cond], tid="t-d")])
    data = build_journey(load_dump(make_dump(
        workflows=[a, d],
        pipelines=[{"id": "P1", "name": "Vendas", "stages": []},
                   {"id": "P2", "name": "Suporte", "stages": []}])))
    decay_evs = [n for n in data["anytime"] if "estagnada" in n["label"]]
    assert len(decay_evs) == 1
    assert decay_evs[0]["children"][0]["label"] == "Decay"


def test_unscoped_tag_trigger_goes_to_anytime_when_nothing_adds_tags(make_dump):
    # trigger contact_tag SEM filtro de tag e nenhum step add_contact_tag no
    # sistema → único disparo possível é tag manual → anytime (não some)
    a = wf(id="a", name="A", steps=[step("s1", "sms")], triggers=[trig("contact_created", "a")])
    v = wf(id="v", name="QualquerTag", steps=[step("s2", "sms")],
           triggers=[trig("contact_tag", "v", tid="t-v")])
    data = build_journey(load_dump(make_dump(workflows=[a, v])))
    evs = [n for n in data["anytime"] if "qualquer tag" in n["label"]]
    assert len(evs) == 1
    assert evs[0]["children"][0]["label"] == "QualquerTag"


def test_budget_is_per_root_anytime_survives_criacao_exhaustion(make_dump):
    # cap por raiz (spec): estourar a raiz de criação não pode matar a anytime
    a = wf(id="a", name="A",
           steps=[step(f"s{i}", "sms", next=f"s{i+1}" if i < 30 else None,
                       parent=f"s{i-1}" if i > 0 else None) for i in range(31)],
           triggers=[trig("contact_created", "a")])
    b = wf(id="b", name="Aniversário", steps=[step("x1", "sms")],
           triggers=[trig("birthday_reminder", "b", tid="t-b")])
    data = build_journey(load_dump(make_dump(workflows=[a, b])), max_nodes=5)
    assert data["truncated"] is True  # criação estourou
    bday = next(n for n in data["anytime"] if "nivers" in n["label"])
    assert bday["children"][0]["kind"] == "workflow"  # anytime inteira, sem inanição


def test_budget_counts_every_node_kind(make_dump):
    # nós branch/terminal/event/loop também consomem budget: o total de nós
    # (exceto marcadores ✂ e wrapper de neutros) nunca passa do cap por raiz
    steps = [
        step("c", "if_else", next=["b1", "b2"],
             attrs={"branches": [{"id": "b1", "name": "Sim"}, {"id": "b2", "name": "ELSE"}]}),
        step("b1", "if_else", parent="c", next="x1", attrs={"if": {}}),
        step("b2", "if_else", parent="c", attrs={"else": True}),
        step("x1", "sms", parent="b1", next="x2"),
        step("x2", "sms", parent="x1"),
    ]
    a = wf(id="a", name="A", steps=steps, triggers=[trig("contact_created", "a")])
    cap = 4
    data = build_journey(load_dump(make_dump(workflows=[a])), max_nodes=cap)

    def count(n):
        own = 0 if n["kind"] in ("truncated", "neutral_group") else 1
        return own + sum(count(k) for k in n["children"])

    total = sum(count(ev) - 1 for ev in data["criacao"])  # -1: nó-evento da raiz
    assert data["truncated"] is True
    assert total <= cap


def test_neutral_step_hitting_cap_emits_truncated_marker(make_dump):
    # budget esgota num step neutro → marcador ✂ no ponto, nunca drop silencioso
    a = wf(id="a", name="A",
           steps=[step("s1", "sms", next="s2"),
                  step("s2", "wait", parent="s1", next="s3"),
                  step("s3", "sms", parent="s2")],
           triggers=[trig("contact_created", "a")])
    data = build_journey(load_dump(make_dump(workflows=[a])), max_nodes=2)
    wnode = data["criacao"][0]["children"][0]
    assert [c["kind"] for c in wnode["children"]] == ["effect", "truncated"]


def test_repeated_unscoped_reply_anchor_is_deduplicated(make_dump):
    # reply sem workflow.id ancora em toda mensagem; a cascata do alvo expande
    # 1x por árvore de raiz — âncoras seguintes referenciam (corte tipo loop)
    a = wf(id="a", name="A",
           steps=[step("s1", "sms", next="s2"), step("s2", "sms", parent="s1")],
           triggers=[trig("contact_created", "a")])
    r = wf(id="r", name="Resposta", steps=[step("x1", "sms")],
           triggers=[trig("customer_reply", "r", tid="t-r")])
    data = build_journey(load_dump(make_dump(workflows=[a, r])))
    wnode = data["criacao"][0]["children"][0]
    msgs = [c for c in wnode["children"] if c["kind"] == "effect"]
    ev1 = [c for c in msgs[0]["children"] if c["kind"] == "event"][0]
    ev2 = [c for c in msgs[1]["children"] if c["kind"] == "event"][0]
    assert ev1["children"][0]["kind"] == "workflow"   # primeira âncora expande
    assert ev2["children"][0]["kind"] == "loop"        # demais referenciam
    assert "já expandido" in ev2["children"][0]["label"]
    assert data["truncated"] is False


def test_goto_with_next_and_target_forks_both_paths(make_dump):
    # goto com next E targetNodeId: os dois sucessores aparecem (camada 2 bifurca)
    steps = [
        step("g", "goto", next="s2", attrs={"targetNodeId": "s3"}),
        step("s2", "sms", name="MsgNext", parent="g"),
        step("s3", "email", name="MsgGoto", parent="g"),
    ]
    a = wf(id="a", name="A", steps=steps, triggers=[trig("contact_created", "a")])
    data = build_journey(load_dump(make_dump(workflows=[a])))
    wnode = data["criacao"][0]["children"][0]
    branches = [c for c in wnode["children"] if c["kind"] == "branch"]
    assert len(branches) == 2
    flat = str(wnode)
    assert "MsgNext" in flat and "MsgGoto" in flat


def test_birthday_always_anytime_and_stats(make_dump):
    a = wf(id="a", name="A", steps=[step("s1", "sms")],
           triggers=[trig("contact_created", "a"), trig("birthday_reminder", "a", tid="t-b")])
    data = build_journey(load_dump(make_dump(workflows=[a])))
    assert any(n["detail"] == "birthday_reminder" or "anivers" in n["label"].lower()
               for n in data["anytime"])
    s = data["stats"]
    assert s["workflows_alcancaveis"] >= 1
    assert "triggers_ignorados" in s
