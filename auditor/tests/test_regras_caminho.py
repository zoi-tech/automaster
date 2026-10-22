"""Etapa 4: três regras de caminho (criar oportunidade sem procurar antes, notificar o dono
depois de tirar o dono, dois workflows respondendo a mesma resposta do cliente).

Ids, nomes e pipelines daqui são inventados: o repositório é público.
"""

import pytest
from conftest import trig, wf

from automaster_audit.loader import load_dump
from automaster_audit.rules import (
    create_opportunity_without_lookup,
    duplicate_reply_responders,
    notify_owner_after_unassign,
    run_all,
)

DOIS_PIPELINES = [{"id": "P1", "stages": [{"id": "S1"}]}, {"id": "P2", "stages": [{"id": "S2"}]}]


def pub(id="wf1", name=None, status="published", steps=None, triggers=None):
    """Workflow dentro de uma pasta (para não disparar `published_outside_folder` sem querer)."""
    w = wf(id=id, name=name or f"[Teste] Fluxo {id}", status=status, steps=steps, triggers=triggers)
    w["raw"]["list_entry"]["parentId"] = "pasta1"
    return w


def _ctx(make_dump, **kw):
    kw.setdefault("pipelines", DOIS_PIPELINES)
    return load_dump(make_dump(**kw))


def _passo(sid, tipo, parent=None, next=None, attributes=None):
    s = {"id": sid, "type": tipo, "name": f"Passo {sid}", "attributes": attributes or {}}
    if parent:
        s["parentKey"] = parent
    if next:
        s["next"] = next
    return s


def _sms(sid, parent=None, next=None):
    return _passo(sid, "sms", parent=parent, next=next, attributes={"body": "Oi, tudo bem?"})


def _if_else(cid="c", parent=None, ramo_a=None, ramo_b=None):
    """Container if_else com ramo A (`{cid}a`) e else (`{cid}b`); ramo_x = id do 1º passo do ramo."""
    return [
        {
            "id": cid,
            "type": "if_else",
            "name": "Condicao",
            "attributes": {"branches": [{"id": f"{cid}a", "name": "A", "operator": "and", "segments": []}]},
            "next": [f"{cid}a", f"{cid}b"],
            **({"parentKey": parent} if parent else {}),
        },
        {
            "id": f"{cid}a",
            "type": "if_else",
            "name": "A",
            "parentKey": cid,
            "attributes": {"if": False},
            **({"next": ramo_a} if ramo_a else {}),
        },
        {
            "id": f"{cid}b",
            "type": "if_else",
            "name": "None",
            "parentKey": cid,
            "attributes": {"else": True},
            **({"next": ramo_b} if ramo_b else {}),
        },
    ]


# ---------------------------------------------------------------------------
# create_opportunity_without_lookup
# ---------------------------------------------------------------------------


def _find(sid, pipeline, parent=None, nao_achou=None, achou=None):
    """find_opportunity filtrado por pipeline + as duas transições (Not Found = `{sid}n`, Found = `{sid}f`)."""
    find = _passo(
        sid,
        "find_opportunity",
        parent=parent,
        next=[f"{sid}n", f"{sid}f"],
        attributes={
            "sorting": "latest",
            "__customInputFields__": [
                {"filterField": "pipeline_id", "value": "eq", "secondValue": pipeline},
                {"filterField": "status", "value": "eq", "secondValue": "open"},
            ],
        },
    )
    nao = {"id": f"{sid}n", "type": "transition", "name": "Opportunity Not Found", "parentKey": sid}
    sim = {"id": f"{sid}f", "type": "transition", "name": "Opportunity Found", "parentKey": sid}
    if nao_achou:
        nao["next"] = nao_achou
    if achou:
        sim["next"] = achou
    return [find, nao, sim]


def _criar(sid, pipeline, parent=None, next=None):
    return _passo(
        sid,
        "internal_create_opportunity",
        parent=parent,
        next=next,
        attributes={"pipelineId": pipeline, "pipelineStageId": "S1", "opportunityName": "{{contact.name}}"},
    )


def test_criar_oportunidade_sem_procurar_antes_acusa(make_dump):
    ctx = _ctx(make_dump, workflows=[pub(steps=[_sms("s1", next="co"), _criar("co", "P1", parent="s1")])])
    findings = create_opportunity_without_lookup.check(ctx)
    assert len(findings) == 1
    assert findings[0].rule == "create_opportunity_without_lookup"
    assert findings[0].severity == "WARN"
    assert findings[0].workflow_id == "wf1"


def test_criar_no_ramo_nao_achou_de_busca_do_mesmo_pipeline_nao_acusa(make_dump):
    steps = [*_find("fo", "P1", nao_achou="co"), _criar("co", "P1", parent="fon")]
    ctx = _ctx(make_dump, workflows=[pub(steps=steps)])
    assert create_opportunity_without_lookup.check(ctx) == []


def test_busca_certa_vale_mesmo_com_passos_no_meio(make_dump):
    """A busca é ancestral, não precisa ser o pai direto do passo de criar."""
    steps = [
        *_find("fo", "P1", nao_achou="s1"),
        _sms("s1", parent="fon", next="s2"),
        _sms("s2", parent="s1", next="co"),
        _criar("co", "P1", parent="s2"),
    ]
    ctx = _ctx(make_dump, workflows=[pub(steps=steps)])
    assert create_opportunity_without_lookup.check(ctx) == []


def test_busca_de_outro_pipeline_acusa(make_dump):
    steps = [*_find("fo", "P2", nao_achou="co"), _criar("co", "P1", parent="fon")]
    ctx = _ctx(make_dump, workflows=[pub(steps=steps)])
    findings = create_opportunity_without_lookup.check(ctx)
    assert len(findings) == 1
    assert findings[0].workflow_id == "wf1"


def test_criar_no_ramo_achou_de_busca_certa_acusa(make_dump):
    """O ramo que leva ao passo tem de ser o Not Found; no Found a oportunidade já existe."""
    steps = [*_find("fo", "P1", achou="co"), _criar("co", "P1", parent="fof")]
    ctx = _ctx(make_dump, workflows=[pub(steps=steps)])
    findings = create_opportunity_without_lookup.check(ctx)
    assert len(findings) == 1
    assert findings[0].workflow_id == "wf1"


def test_busca_certa_em_outro_ramo_nao_cobre_o_passo(make_dump):
    """A busca existe no workflow, mas no ramo vizinho: não é ancestral do passo de criar."""
    steps = [
        *_if_else("c", ramo_a="fo", ramo_b="co"),
        *_find("fo", "P1", parent="ca"),
        _criar("co", "P1", parent="cb"),
    ]
    ctx = _ctx(make_dump, workflows=[pub(steps=steps)])
    assert len(create_opportunity_without_lookup.check(ctx)) == 1


def test_busca_certa_mais_acima_cobre_mesmo_atras_de_outra_busca(make_dump):
    """Busca P1 (Not Found) → busca P2 (Found) → criar P1: a busca do P1 ancestral cobre."""
    steps = [
        *_find("f1", "P1", nao_achou="f2"),
        *_find("f2", "P2", parent="f1n", achou="co"),
        _criar("co", "P1", parent="f2f"),
    ]
    ctx = _ctx(make_dump, workflows=[pub(steps=steps)])
    assert create_opportunity_without_lookup.check(ctx) == []


def test_criar_oportunidade_sem_procurar_em_rascunho_nao_acusa(make_dump):
    ctx = _ctx(make_dump, workflows=[pub(status="draft", steps=[_criar("co", "P1")])])
    assert create_opportunity_without_lookup.check(ctx) == []


# ---------------------------------------------------------------------------
# notify_owner_after_unassign
# ---------------------------------------------------------------------------


def _notificar(sid, parent=None, next=None, user_type="assign"):
    return _passo(
        sid,
        "internal_notification",
        parent=parent,
        next=next,
        attributes={"type": "notification", "notification": {"userType": user_type, "body": "Lead novo"}},
    )


def _remover(sid, parent=None, next=None):
    return _passo(sid, "remove_assigned_user", parent=parent, next=next)


def _atribuir(sid, parent=None, next=None):
    return _passo(sid, "assign_user", parent=parent, next=next, attributes={"user_list": ["U1"]})


def test_notificar_dono_depois_de_remover_dono_acusa(make_dump):
    steps = [_remover("r", next="n"), _notificar("n", parent="r")]
    ctx = _ctx(make_dump, workflows=[pub(steps=steps)])
    findings = notify_owner_after_unassign.check(ctx)
    assert len(findings) == 1
    assert findings[0].rule == "notify_owner_after_unassign"
    assert findings[0].severity == "WARN"
    assert findings[0].workflow_id == "wf1"


def test_remocao_varios_passos_antes_tambem_acusa(make_dump):
    """A remoção é ancestral, não precisa ser o pai direto da notificação."""
    steps = [
        _remover("r", next="s1"),
        _sms("s1", parent="r", next="s2"),
        _sms("s2", parent="s1", next="n"),
        _notificar("n", parent="s2"),
    ]
    ctx = _ctx(make_dump, workflows=[pub(steps=steps)])
    assert len(notify_owner_after_unassign.check(ctx)) == 1


def test_atribuir_entre_remover_e_notificar_nao_acusa(make_dump):
    steps = [_remover("r", next="a"), _atribuir("a", parent="r", next="n"), _notificar("n", parent="a")]
    ctx = _ctx(make_dump, workflows=[pub(steps=steps)])
    assert notify_owner_after_unassign.check(ctx) == []


def test_atribuir_antes_da_remocao_nao_salva(make_dump):
    """O assign_user só conta se estiver entre a remoção e a notificação."""
    steps = [_atribuir("a", next="r"), _remover("r", parent="a", next="n"), _notificar("n", parent="r")]
    ctx = _ctx(make_dump, workflows=[pub(steps=steps)])
    assert len(notify_owner_after_unassign.check(ctx)) == 1


def test_notificacao_que_nao_e_para_o_dono_nao_acusa(make_dump):
    steps = [_remover("r", next="n"), _notificar("n", parent="r", user_type="user")]
    ctx = _ctx(make_dump, workflows=[pub(steps=steps)])
    assert notify_owner_after_unassign.check(ctx) == []


def test_remocao_em_outro_ramo_nao_acusa(make_dump):
    steps = [*_if_else("c", ramo_a="r", ramo_b="n"), _remover("r", parent="ca"), _notificar("n", parent="cb")]
    ctx = _ctx(make_dump, workflows=[pub(steps=steps)])
    assert notify_owner_after_unassign.check(ctx) == []


def test_remocao_depois_da_notificacao_nao_acusa(make_dump):
    steps = [_notificar("n", next="r"), _remover("r", parent="n")]
    ctx = _ctx(make_dump, workflows=[pub(steps=steps)])
    assert notify_owner_after_unassign.check(ctx) == []


def test_notificar_depois_de_remover_em_rascunho_nao_acusa(make_dump):
    steps = [_remover("r", next="n"), _notificar("n", parent="r")]
    ctx = _ctx(make_dump, workflows=[pub(status="draft", steps=steps)])
    assert notify_owner_after_unassign.check(ctx) == []


# ---------------------------------------------------------------------------
# duplicate_reply_responders
# ---------------------------------------------------------------------------

COND_A = {"field": "message.body", "operator": "string-contains-any-of", "value": ["quero orcamento"]}
COND_B = {"field": "message.type", "operator": "==", "value": "TYPE_WHATSAPP"}
COND_C = {"field": "message.body", "operator": "string-contains-any-of", "value": ["cancelar"]}


def _responde(id, conditions, passo="sms", active=True, status="published", extra_triggers=()):
    """Workflow com gatilho customer_reply e um passo do tipo `passo`."""
    gatilhos = [trig("customer_reply", id, conditions=list(conditions), active=active, tid=f"tr-{id}")]
    gatilhos += list(extra_triggers)
    return pub(
        id=id,
        name=f"[Teste] Resposta {id}",
        status=status,
        triggers=gatilhos,
        steps=[_passo("m", passo, attributes={"body": "Recebemos sua mensagem"})],
    )


def _grupos(ctx):
    findings = duplicate_reply_responders.check(ctx)
    for f in findings:
        assert f.rule == "duplicate_reply_responders"
        assert f.severity == "WARN"
    return findings


def test_dois_workflows_com_mesma_resposta_acusa_um_finding_citando_os_dois(make_dump):
    ctx = _ctx(make_dump, workflows=[_responde("wa", [COND_A]), _responde("wb", [COND_A])])
    findings = _grupos(ctx)
    assert len(findings) == 1
    assert findings[0].workflow_id in {"wa", "wb"}
    assert "[Teste] Resposta wa" in findings[0].detail
    assert "[Teste] Resposta wb" in findings[0].detail


@pytest.mark.parametrize("tipo", ["sms", "whatsapp_v2", "email"])
def test_cada_tipo_de_mensagem_ao_cliente_conta(make_dump, tipo):
    ctx = _ctx(make_dump, workflows=[_responde("wa", [COND_A], passo=tipo), _responde("wb", [COND_A], passo=tipo)])
    assert len(_grupos(ctx)) == 1


def test_sem_filtro_nos_dois_acusa(make_dump):
    ctx = _ctx(make_dump, workflows=[_responde("wa", []), _responde("wb", [])])
    assert len(_grupos(ctx)) == 1


def test_condicoes_iguais_em_ordem_diferente_acusa(make_dump):
    ctx = _ctx(make_dump, workflows=[_responde("wa", [COND_A, COND_B]), _responde("wb", [COND_B, COND_A])])
    assert len(_grupos(ctx)) == 1


def test_condicoes_diferentes_nao_acusam(make_dump):
    ctx = _ctx(make_dump, workflows=[_responde("wa", [COND_A]), _responde("wb", [COND_C])])
    assert _grupos(ctx) == []


def test_sem_filtro_e_com_filtro_nao_acusam(make_dump):
    ctx = _ctx(make_dump, workflows=[_responde("wa", []), _responde("wb", [COND_A])])
    assert _grupos(ctx) == []


def test_subconjunto_de_condicoes_nao_acusa(make_dump):
    ctx = _ctx(make_dump, workflows=[_responde("wa", [COND_A]), _responde("wb", [COND_A, COND_B])])
    assert _grupos(ctx) == []


def test_um_dos_dois_sem_mensagem_ao_cliente_nao_acusa(make_dump):
    ctx = _ctx(make_dump, workflows=[_responde("wa", [COND_A]), _responde("wb", [COND_A], passo="add_contact_tag")])
    assert _grupos(ctx) == []


def test_gatilho_de_resposta_inativo_nao_conta(make_dump):
    ctx = _ctx(make_dump, workflows=[_responde("wa", [COND_A]), _responde("wb", [COND_A], active=False)])
    assert _grupos(ctx) == []


def test_workflow_em_rascunho_nao_conta(make_dump):
    ctx = _ctx(make_dump, workflows=[_responde("wa", [COND_A]), _responde("wb", [COND_A], status="draft")])
    assert _grupos(ctx) == []


def test_tres_workflows_iguais_geram_um_finding_com_os_tres(make_dump):
    ctx = _ctx(make_dump, workflows=[_responde(w, [COND_A]) for w in ("wa", "wb", "wc")])
    findings = _grupos(ctx)
    assert len(findings) == 1
    assert findings[0].workflow_id in {"wa", "wb", "wc"}
    for w in ("wa", "wb", "wc"):
        assert f"[Teste] Resposta {w}" in findings[0].detail


def test_dois_grupos_distintos_geram_dois_findings(make_dump):
    workflows = [
        _responde("wa", [COND_A]),
        _responde("wb", [COND_A]),
        _responde("wc", [COND_C]),
        _responde("wd", [COND_C]),
    ]
    findings = _grupos(_ctx(make_dump, workflows=workflows))
    assert len(findings) == 2
    grupo_a = next(f for f in findings if "[Teste] Resposta wa" in f.detail)
    assert "[Teste] Resposta wb" in grupo_a.detail
    assert "[Teste] Resposta wc" not in grupo_a.detail


def test_mesmo_workflow_com_dois_gatilhos_iguais_nao_acusa(make_dump):
    """A regra é sobre dois workflows respondendo juntos, não dois gatilhos no mesmo workflow."""
    repetido = trig("customer_reply", "wa", conditions=[COND_A], tid="tr-wa-2")
    ctx = _ctx(make_dump, workflows=[_responde("wa", [COND_A], extra_triggers=[repetido])])
    assert _grupos(ctx) == []


def test_gatilho_que_nao_e_de_resposta_nao_conta(make_dump):
    outro = pub(
        id="wb",
        name="[Teste] Resposta wb",
        triggers=[trig("contact_tag", "wb", conditions=[COND_A])],
        steps=[_sms("m")],
    )
    ctx = _ctx(make_dump, workflows=[_responde("wa", [COND_A]), outro])
    assert _grupos(ctx) == []


# ---------------------------------------------------------------------------
# run_all inclui as três regras
# ---------------------------------------------------------------------------


def test_run_all_inclui_as_tres_regras(make_dump):
    workflows = [
        pub(id="cria", steps=[_criar("co", "P1")]),
        pub(id="notifica", steps=[_remover("r", next="n"), _notificar("n", parent="r")]),
        _responde("wa", [COND_A]),
        _responde("wb", [COND_A]),
    ]
    por_regra = {}
    for f in run_all(_ctx(make_dump, workflows=workflows)):
        por_regra.setdefault(f.rule, set()).add(f.workflow_id)
    assert "cria" in por_regra["create_opportunity_without_lookup"]
    assert "notifica" in por_regra["notify_owner_after_unassign"]
    assert por_regra["duplicate_reply_responders"] & {"wa", "wb"}
