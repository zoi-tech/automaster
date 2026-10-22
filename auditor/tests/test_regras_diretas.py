"""Etapa 3: cinco regras diretas (gatilho de oportunidade sem pipeline, horário impossível,
esperas de compromisso fora de ordem, publicado fora de pasta, segredo exposto).

Os segredos daqui são falsos de propósito: o repositório é público.
"""

import pytest
from conftest import trig, wf

from automaster_audit.loader import load_dump
from automaster_audit.rules import (
    appointment_waits_out_of_order,
    exposed_secret,
    impossible_time_condition,
    opportunity_trigger_no_pipeline,
    published_outside_folder,
    run_all,
)

DOIS_PIPELINES = [{"id": "P1", "stages": [{"id": "S1"}]}, {"id": "P2", "stages": [{"id": "S2"}]}]
UM_PIPELINE = [{"id": "P1", "stages": [{"id": "S1"}]}]


def pub(id="wf1", status="published", steps=None, triggers=None, parent_id="pasta1"):
    """Workflow dentro de uma pasta (para não disparar `published_outside_folder` sem querer)."""
    w = wf(id=id, status=status, steps=steps, triggers=triggers)
    w["raw"]["list_entry"]["parentId"] = parent_id
    return w


def _ctx(make_dump, **kw):
    return load_dump(make_dump(**kw))


# ---------------------------------------------------------------------------
# opportunity_trigger_no_pipeline
# ---------------------------------------------------------------------------

STATUS_WON = {
    "operator": "==",
    "field": "opportunity.status",
    "value": "won",
    "type": "select",
    "id": "moved-to-status",
}
FILTRO_PIPELINE = {"operator": "==", "field": "opportunity.pipelineId", "value": "P1", "type": "select", "id": "pipe"}


@pytest.mark.parametrize(
    "tipo",
    [
        "opportunity_created",
        "opportunity_status_changed",
        "pipeline_stage_updated",
        "opportunity_decay",
        "opportunity_changed",
    ],
)
def test_gatilho_oportunidade_sem_pipeline_acusa_com_dois_pipelines(make_dump, tipo):
    ctx = _ctx(
        make_dump, workflows=[pub(triggers=[trig(tipo, "wf1", conditions=[STATUS_WON])])], pipelines=DOIS_PIPELINES
    )
    findings = opportunity_trigger_no_pipeline.check(ctx)
    assert len(findings) == 1
    assert findings[0].rule == "opportunity_trigger_no_pipeline"
    assert findings[0].severity == "WARN"
    assert findings[0].workflow_id == "wf1"


def test_gatilho_oportunidade_sem_pipeline_nao_acusa_com_um_pipeline(make_dump):
    ctx = _ctx(
        make_dump,
        workflows=[pub(triggers=[trig("opportunity_status_changed", "wf1", conditions=[STATUS_WON])])],
        pipelines=UM_PIPELINE,
    )
    assert opportunity_trigger_no_pipeline.check(ctx) == []


def test_gatilho_oportunidade_com_filtro_de_pipeline_nao_acusa(make_dump):
    ctx = _ctx(
        make_dump,
        workflows=[pub(triggers=[trig("pipeline_stage_updated", "wf1", conditions=[STATUS_WON, FILTRO_PIPELINE])])],
        pipelines=DOIS_PIPELINES,
    )
    assert opportunity_trigger_no_pipeline.check(ctx) == []


def test_gatilho_oportunidade_inativo_nao_acusa(make_dump):
    ctx = _ctx(
        make_dump,
        workflows=[pub(triggers=[trig("opportunity_created", "wf1", active=False)])],
        pipelines=DOIS_PIPELINES,
    )
    assert opportunity_trigger_no_pipeline.check(ctx) == []


def test_gatilho_oportunidade_em_rascunho_nao_acusa(make_dump):
    ctx = _ctx(
        make_dump,
        workflows=[pub(status="draft", triggers=[trig("opportunity_created", "wf1")])],
        pipelines=DOIS_PIPELINES,
    )
    assert opportunity_trigger_no_pipeline.check(ctx) == []


def test_gatilho_que_nao_e_de_oportunidade_nao_acusa(make_dump):
    ctx = _ctx(make_dump, workflows=[pub(triggers=[trig("contact_tag", "wf1")])], pipelines=DOIS_PIPELINES)
    assert opportunity_trigger_no_pipeline.check(ctx) == []


def test_filtro_de_pipeline_em_outro_gatilho_nao_salva_o_gatilho_sem_filtro(make_dump):
    """O filtro vale por gatilho: um gatilho filtrado não cobre o vizinho sem filtro."""
    gatilhos = [
        trig("opportunity_created", "wf1", conditions=[FILTRO_PIPELINE], tid="com"),
        trig("opportunity_status_changed", "wf1", conditions=[STATUS_WON], tid="sem"),
    ]
    ctx = _ctx(make_dump, workflows=[pub(triggers=gatilhos)], pipelines=DOIS_PIPELINES)
    assert len(opportunity_trigger_no_pipeline.check(ctx)) == 1


# ---------------------------------------------------------------------------
# impossible_time_condition
# ---------------------------------------------------------------------------


def _hora(op, valor):
    return {
        "conditionType": "date_time",
        "conditionSubType": "time",
        "conditionOperator": op,
        "conditionValue": str(valor),
    }


def _if_else(segments, branch_operator="and", nome="Horario comercial"):
    """Container if_else com um ramo (b1) e o else (e)."""
    return [
        {
            "id": "c",
            "type": "if_else",
            "name": "Condicao",
            "attributes": {
                "if": True,
                "operator": "and",
                "branches": [{"id": "b1", "name": nome, "operator": branch_operator, "segments": segments}],
            },
            "next": ["b1", "e"],
        },
        {"id": "b1", "type": "if_else", "name": nome, "parentKey": "c", "attributes": {"if": False}, "next": "a1"},
        {"id": "e", "type": "if_else", "name": "None", "parentKey": "c", "attributes": {"else": True}, "next": "a2"},
        {"id": "a1", "type": "sms", "name": "SMS ramo", "parentKey": "b1", "attributes": {"body": "x"}},
        {"id": "a2", "type": "sms", "name": "SMS else", "parentKey": "e", "attributes": {"body": "y"}},
    ]


def _seg(*conds, operator="and"):
    return {"__segmentId": "s1", "operator": operator, "conditions": list(conds)}


@pytest.mark.parametrize(
    "conds",
    [
        [_hora("<", 9), _hora(">", 21)],
        [_hora(">=", 19), _hora("<", 8)],
        [_hora("<", 9), _hora(">=", 9)],
        [_hora("==", 10), _hora("<", 9)],
    ],
    ids=["antes-9-e-depois-21", "desde-19-e-antes-8", "fronteira-estrita", "igual-fora-do-intervalo"],
)
def test_horario_impossivel_em_segmento_e_acusa(make_dump, conds):
    ctx = _ctx(make_dump, workflows=[pub(steps=_if_else([_seg(*conds)]))])
    findings = impossible_time_condition.check(ctx)
    assert len(findings) == 1
    assert findings[0].rule == "impossible_time_condition"
    assert findings[0].severity == "WARN"
    assert findings[0].workflow_id == "wf1"


@pytest.mark.parametrize(
    "conds",
    [
        [_hora(">=", 8), _hora("<", 19)],
        [_hora("<=", 9), _hora(">=", 9)],
    ],
    ids=["horario-comercial", "fronteira-inclusiva"],
)
def test_horario_possivel_nao_acusa(make_dump, conds):
    ctx = _ctx(make_dump, workflows=[pub(steps=_if_else([_seg(*conds)]))])
    assert impossible_time_condition.check(ctx) == []


def test_horario_em_segmento_ou_nao_acusa(make_dump):
    seg = _seg(_hora("<", 9), _hora(">", 21), operator="or")
    ctx = _ctx(make_dump, workflows=[pub(steps=_if_else([seg], branch_operator="or"))])
    assert impossible_time_condition.check(ctx) == []


def test_horario_em_segmentos_separados_ligados_por_ou_nao_acusa(make_dump):
    """Fora do horário (antes das 9 OU depois das 21) em dois segmentos é possível."""
    segs = [_seg(_hora("<", 9)), {**_seg(_hora(">", 21)), "__segmentId": "s2"}]
    ctx = _ctx(make_dump, workflows=[pub(steps=_if_else(segs, branch_operator="or"))])
    assert impossible_time_condition.check(ctx) == []


def test_horario_impossivel_em_rascunho_nao_acusa(make_dump):
    ctx = _ctx(make_dump, workflows=[pub(status="draft", steps=_if_else([_seg(_hora("<", 9), _hora(">", 21))]))])
    assert impossible_time_condition.check(ctx) == []


# ---------------------------------------------------------------------------
# appointment_waits_out_of_order
# ---------------------------------------------------------------------------


def _espera(sid, minutos, when="before", next=None, parent=None):
    s = {
        "id": sid,
        "type": "wait",
        "name": f"Espera {sid}",
        "attributes": {
            "type": "appointment",
            "appointmentStartAfter": {"when": when, "type": "minutes", "value": minutos},
        },
    }
    if next:
        s["next"] = next
    if parent:
        s["parentKey"] = parent
    return s


def _sms(sid, next=None, parent=None):
    s = {"id": sid, "type": "sms", "name": f"SMS {sid}", "attributes": {"body": "lembrete"}}
    if next:
        s["next"] = next
    if parent:
        s["parentKey"] = parent
    return s


def _linear(*minutos, when=None):
    """Espera → SMS → espera → SMS ... na ordem dada."""
    when = when or ["before"] * len(minutos)
    steps = []
    for i, (m, w) in enumerate(zip(minutos, when, strict=True)):
        anterior = f"m{i - 1}" if i else None
        ultimo = i == len(minutos) - 1
        steps.append(_espera(f"w{i}", m, when=w, next=f"m{i}", parent=anterior))
        steps.append(_sms(f"m{i}", next=None if ultimo else f"w{i + 1}", parent=f"w{i}"))
    return steps


def test_espera_antes_maior_que_a_anterior_acusa(make_dump):
    ctx = _ctx(make_dump, workflows=[pub(steps=_linear(120, 1440))])
    findings = appointment_waits_out_of_order.check(ctx)
    assert len(findings) == 1
    assert findings[0].rule == "appointment_waits_out_of_order"
    assert findings[0].severity == "WARN"
    assert findings[0].workflow_id == "wf1"


def test_espera_antes_igual_a_anterior_acusa(make_dump):
    ctx = _ctx(make_dump, workflows=[pub(steps=_linear(120, 120))])
    assert len(appointment_waits_out_of_order.check(ctx)) == 1


def test_espera_fora_de_ordem_mais_adiante_no_caminho_acusa(make_dump):
    """Compara com qualquer espera anterior do caminho, não só a imediatamente anterior."""
    ctx = _ctx(make_dump, workflows=[pub(steps=_linear(1440, 30, 1440))])
    assert len(appointment_waits_out_of_order.check(ctx)) >= 1


def test_esperas_em_ordem_decrescente_nao_acusam(make_dump):
    ctx = _ctx(make_dump, workflows=[pub(steps=_linear(4320, 1440, 120, 30))])
    assert appointment_waits_out_of_order.check(ctx) == []


def test_ordem_vem_do_caminho_e_nao_da_lista_de_steps(make_dump):
    """No dump o step de 120 vem antes na lista, mas no caminho 1440 roda primeiro."""
    steps = _linear(1440, 120)
    steps.reverse()
    ctx = _ctx(make_dump, workflows=[pub(steps=steps)])
    assert appointment_waits_out_of_order.check(ctx) == []


def test_esperas_em_ramos_diferentes_nao_acusam(make_dump):
    """Ramo A espera 120 antes, ramo B espera 1440 antes: caminhos distintos."""
    steps = [
        {
            "id": "c",
            "type": "if_else",
            "name": "Condicao",
            "attributes": {"branches": [{"id": "b1", "name": "A", "operator": "and", "segments": []}]},
            "next": ["b1", "e"],
        },
        {"id": "b1", "type": "if_else", "name": "A", "parentKey": "c", "attributes": {"if": False}, "next": "wa"},
        {"id": "e", "type": "if_else", "name": "None", "parentKey": "c", "attributes": {"else": True}, "next": "wb"},
        _espera("wa", 120, next="ma", parent="b1"),
        _sms("ma", parent="wa"),
        _espera("wb", 1440, next="mb", parent="e"),
        _sms("mb", parent="wb"),
    ]
    ctx = _ctx(make_dump, workflows=[pub(steps=steps)])
    assert appointment_waits_out_of_order.check(ctx) == []


def test_espera_depois_do_compromisso_nao_entra_na_comparacao(make_dump):
    ctx = _ctx(make_dump, workflows=[pub(steps=_linear(120, 1440, when=["before", "after"]))])
    assert appointment_waits_out_of_order.check(ctx) == []


def test_esperas_fora_de_ordem_em_rascunho_nao_acusam(make_dump):
    ctx = _ctx(make_dump, workflows=[pub(status="draft", steps=_linear(120, 1440))])
    assert appointment_waits_out_of_order.check(ctx) == []


# ---------------------------------------------------------------------------
# published_outside_folder
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("parent_id", [None, ""], ids=["nulo", "vazio"])
def test_publicado_sem_pasta_acusa(make_dump, parent_id):
    ctx = _ctx(make_dump, workflows=[pub(parent_id=parent_id)])
    findings = published_outside_folder.check(ctx)
    assert len(findings) == 1
    assert findings[0].rule == "published_outside_folder"
    assert findings[0].severity == "WARN"
    assert findings[0].workflow_id == "wf1"


def test_publicado_sem_chave_parent_id_acusa(make_dump):
    ctx = _ctx(make_dump, workflows=[wf(id="wf1")])  # list_entry sem parentId
    assert [f.workflow_id for f in published_outside_folder.check(ctx)] == ["wf1"]


def test_publicado_dentro_de_pasta_nao_acusa(make_dump):
    ctx = _ctx(make_dump, workflows=[pub(parent_id="pasta1")])
    assert published_outside_folder.check(ctx) == []


def test_rascunho_fora_de_pasta_nao_acusa(make_dump):
    ctx = _ctx(make_dump, workflows=[pub(status="draft", parent_id=None)])
    assert published_outside_folder.check(ctx) == []


# ---------------------------------------------------------------------------
# exposed_secret
# ---------------------------------------------------------------------------

PIT_FALSO = "pit-00000000-0000-0000-0000-00000000dead"
SK_FALSO = "sk-abcdefghijklmnopqrstuvwxyz"
JWT_FALSO = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0ZSJ9.ZmFrZWZha2VmYWtl"
TOKEN_BEARER_FALSO = "abcdefghijklmnopqrstuvwxyz0123"


def _cv(valor, nome="Chave API"):
    return {"id": "cv1", "name": nome, "fieldKey": "{{ custom_values.chave_api }}", "value": valor}


def _code(codigo):
    return {"id": "cc", "type": "custom_code", "name": "Codigo", "attributes": {"code": codigo, "language": "js"}}


def _webhook(tipo="webhook", headers=None, custom_data=None, body=None):
    attrs = {"method": "POST", "url": "https://exemplo.invalid/hook", "headers": headers or []}
    if custom_data is not None:
        attrs["customData"] = custom_data
    if body is not None:
        attrs["body"] = body
    return {"id": "wh", "type": tipo, "name": "Webhook", "attributes": attrs}


def _assert_mascarado(detail, chave):
    assert chave not in detail
    assert chave[:6] in detail
    assert chave[-4:] in detail


def test_chave_pit_em_custom_value_acusa_mascarada(make_dump):
    ctx = _ctx(make_dump, workflows=[], custom_values=[_cv(PIT_FALSO)])
    findings = exposed_secret.check(ctx)
    assert len(findings) == 1
    assert findings[0].rule == "exposed_secret"
    assert findings[0].severity == "ERROR"
    _assert_mascarado(findings[0].detail, PIT_FALSO)


def test_chave_sk_em_custom_code_acusa_mascarada(make_dump):
    codigo = f"const key = '{SK_FALSO}';\nfetch(url, {{headers: {{Authorization: key}}}});"
    ctx = _ctx(make_dump, workflows=[pub(steps=[_code(codigo)])])
    findings = exposed_secret.check(ctx)
    assert len(findings) == 1
    assert findings[0].severity == "ERROR"
    assert findings[0].workflow_id == "wf1"
    _assert_mascarado(findings[0].detail, SK_FALSO)


def test_bearer_em_cabecalho_de_webhook_acusa(make_dump):
    headers = [{"key": "Authorization", "value": f"Bearer {TOKEN_BEARER_FALSO}"}]
    ctx = _ctx(make_dump, workflows=[pub(steps=[_webhook(headers=headers)])])
    findings = exposed_secret.check(ctx)
    assert len(findings) == 1
    assert findings[0].severity == "ERROR"
    assert TOKEN_BEARER_FALSO not in findings[0].detail


def test_jwt_no_corpo_de_webhook_acusa(make_dump):
    dados = [{"key": "token", "value": JWT_FALSO}]
    ctx = _ctx(make_dump, workflows=[pub(steps=[_webhook(custom_data=dados)])])
    findings = exposed_secret.check(ctx)
    assert len(findings) == 1
    assert JWT_FALSO not in findings[0].detail


def test_chave_em_cabecalho_de_custom_webhook_acusa(make_dump):
    headers = [{"key": "Authorization", "value": f"Bearer {PIT_FALSO}"}]
    ctx = _ctx(make_dump, workflows=[pub(steps=[_webhook("custom_webhook", headers=headers)])])
    findings = exposed_secret.check(ctx)
    assert len(findings) >= 1
    assert all(PIT_FALSO not in f.detail for f in findings)


def test_chave_no_corpo_de_custom_webhook_acusa(make_dump):
    corpo = f'{{"api_key": "{SK_FALSO}"}}'
    ctx = _ctx(make_dump, workflows=[pub(steps=[_webhook("custom_webhook", body=corpo)])])
    findings = exposed_secret.check(ctx)
    assert len(findings) == 1
    _assert_mascarado(findings[0].detail, SK_FALSO)


def test_segredo_em_rascunho_tambem_acusa(make_dump):
    ctx = _ctx(make_dump, workflows=[pub(status="draft", steps=[_code(f"const k = '{SK_FALSO}';")])])
    assert len(exposed_secret.check(ctx)) == 1


def test_referencia_a_custom_value_nao_acusa(make_dump):
    headers = [{"key": "Authorization", "value": "Bearer {{custom_values.token_api_externa}}"}]
    dados = [{"key": "token", "value": "{{custom_values.token_api_externa}}"}]
    ctx = _ctx(
        make_dump,
        workflows=[
            pub(steps=[_webhook(headers=headers, custom_data=dados), _code("const k = '{{custom_values.x}}';")])
        ],
        custom_values=[_cv("{{custom_values.x}}")],
    )
    assert exposed_secret.check(ctx) == []


def test_texto_comum_e_sk_curto_nao_acusam(make_dump):
    ctx = _ctx(
        make_dump,
        workflows=[pub(steps=[_code("const prefixo = 'sk-abc'; // pit-stop")])],
        custom_values=[_cv("Seg a Sex, 8h às 18h")],
    )
    assert exposed_secret.check(ctx) == []


# ---------------------------------------------------------------------------
# run_all inclui as cinco regras
# ---------------------------------------------------------------------------


def test_run_all_inclui_as_cinco_regras(make_dump):
    workflows = [
        pub(id="op", triggers=[trig("opportunity_created", "op")]),
        pub(id="hora", steps=_if_else([_seg(_hora("<", 9), _hora(">", 21))])),
        pub(id="espera", steps=_linear(120, 1440)),
        pub(id="solto", parent_id=None),
        pub(id="codigo", steps=[_code(f"const k = '{SK_FALSO}';")]),
    ]
    ctx = _ctx(make_dump, workflows=workflows, pipelines=DOIS_PIPELINES, custom_values=[_cv(PIT_FALSO)])
    por_regra = {}
    for f in run_all(ctx):
        por_regra.setdefault(f.rule, set()).add(f.workflow_id)
    assert "op" in por_regra["opportunity_trigger_no_pipeline"]
    assert "hora" in por_regra["impossible_time_condition"]
    assert "espera" in por_regra["appointment_waits_out_of_order"]
    assert "solto" in por_regra["published_outside_folder"]
    assert "codigo" in por_regra["exposed_secret"]
