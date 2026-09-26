"""Etapa 4: formulários, surveys e templates no inventário, com `usos` por workflow."""

from conftest import trig, wf

from automaster_audit.dashboard import build_dashboard
from automaster_audit.loader import load_dump

PREVIEW = (
    "https://firebasestorage.googleapis.com/v0/b/highlevel-backend.appspot.com/o/"
    "location%2FLOC%2Femails%2F{id}%2Findex.html?alt=media&token=t"
)


def _cond(field, valores):
    return {"operator": "is-any-of", "field": field, "value": valores, "title": "Form is", "type": "string"}


def _form_trig(fid, tid="tr1"):
    return trig("form_submission", "x", conditions=[_cond("form.id", [fid])], tid=tid)


def _survey_trig(sid, tid="tr1"):
    return trig("survey_submission", "x", conditions=[_cond("survey.id", [sid])], tid=tid)


def _por_id(itens, iid):
    return next(i for i in itens if i["id"] == iid)


def _step(tipo, **attrs):
    return {"id": f"s-{tipo}", "type": tipo, "name": tipo, "attributes": attrs}


def test_formulario_citado_por_trigger_tem_uso_dispara_ordenado_por_nome(make_dump):
    path = make_dump(
        workflows=[
            wf(id="wb", name="Beta", triggers=[_form_trig("F1")]),
            wf(id="wa", name="Alfa", triggers=[_form_trig("F1")]),
        ],
        forms=[{"_id": "F1", "name": "Contato"}, {"_id": "F2", "name": "Sobra"}],
    )
    forms = build_dashboard(load_dump(path))["forms"]
    f1 = _por_id(forms, "F1")
    assert f1["tipo"] == "form" and f1["name"] == "Contato" and f1["orphan"] is False
    assert f1["usos"] == [
        {"workflow_id": "wa", "workflow": "Alfa", "papeis": ["dispara"]},
        {"workflow_id": "wb", "workflow": "Beta", "papeis": ["dispara"]},
    ]
    f2 = _por_id(forms, "F2")
    assert f2["usos"] == [] and f2["orphan"] is True and f2["tipo"] == "form"


def test_survey_tem_tipo_survey(make_dump):
    path = make_dump(
        workflows=[wf(id="w1", name="Um", triggers=[_survey_trig("S1")])],
        forms=[{"_id": "F1", "name": "Contato"}],
        surveys=[{"_id": "S1", "name": "Pesquisa"}],
    )
    forms = build_dashboard(load_dump(path))["forms"]
    s1 = _por_id(forms, "S1")
    assert s1["tipo"] == "survey" and s1["name"] == "Pesquisa" and s1["orphan"] is False
    assert s1["usos"] == [{"workflow_id": "w1", "workflow": "Um", "papeis": ["dispara"]}]
    assert _por_id(forms, "F1")["tipo"] == "form"


def test_formulario_citado_fora_do_trigger_nao_conta(make_dump):
    # outro workflow cita o id num step, sem trigger de formulário: não é uso
    step = _step("webhook", formId="F1", body="F1")
    path = make_dump(
        workflows=[wf(id="w1", name="Um", steps=[step])],
        forms=[{"_id": "F1", "name": "Contato"}],
    )
    f1 = _por_id(build_dashboard(load_dump(path))["forms"], "F1")
    assert f1["usos"] == [] and f1["orphan"] is True


def test_sem_forms_json_lista_vazia(make_dump):
    path = make_dump(workflows=[wf(id="w1", name="Um", triggers=[_form_trig("F1")])])
    assert build_dashboard(load_dump(path))["forms"] == []


def test_template_sms_e_whatsapp_tem_uso_envia(make_dump):
    path = make_dump(
        workflows=[
            wf(id="wb", name="Beta", steps=[_step("sms", template_id="T1")]),
            wf(id="wa", name="Alfa", steps=[_step("whatsapp_v2", templateId="W1")]),
        ],
        message_templates=[{"id": "T1", "name": "Follow-up"}, {"id": "T2", "name": "Sobra"}],
        whatsapp_templates=[{"id": "W1", "name": "Lembrete"}],
    )
    tpls = build_dashboard(load_dump(path))["templates"]
    t1 = _por_id(tpls, "T1")
    assert t1["canal"] == "message" and t1["name"] == "Follow-up" and t1["orphan"] is False
    assert t1["usos"] == [{"workflow_id": "wb", "workflow": "Beta", "papeis": ["envia"]}]
    w1 = _por_id(tpls, "W1")
    assert w1["canal"] == "whatsapp" and w1["name"] == "Lembrete"
    assert w1["usos"] == [{"workflow_id": "wa", "workflow": "Alfa", "papeis": ["envia"]}]
    t2 = _por_id(tpls, "T2")
    assert t2["usos"] == [] and t2["orphan"] is True


def test_template_usos_ordenados_por_nome_do_workflow(make_dump):
    path = make_dump(
        workflows=[
            wf(id="wz", name="Zeta", steps=[_step("sms", template_id="T1")]),
            wf(id="wa", name="Alfa", steps=[_step("sms", template_id="T1")]),
        ],
        message_templates=[{"id": "T1", "name": "Follow-up"}],
    )
    t1 = _por_id(build_dashboard(load_dump(path))["templates"], "T1")
    assert [u["workflow"] for u in t1["usos"]] == ["Alfa", "Zeta"]


def test_template_zero_nao_conta_como_uso(make_dump):
    # até se a lista tiver um item de id "0", o "0" do step é mensagem livre
    path = make_dump(
        workflows=[wf(id="w1", name="Um", steps=[_step("whatsapp_v2", template_id="0", message="oi")])],
        whatsapp_templates=[{"id": "0", "name": "Zero"}, {"id": "W1", "name": "Lembrete"}],
    )
    tpls = build_dashboard(load_dump(path))["templates"]
    assert all(t["usos"] == [] and t["orphan"] is True for t in tpls)


def test_email_sai_do_preview_url_e_nao_do_template_id(make_dump):
    step = _step("email", template_id="E1", previewUrl=PREVIEW.format(id="E2"), subject="Oi")
    path = make_dump(
        workflows=[wf(id="w1", name="Um", steps=[step])],
        email_templates=[
            {"id": "E1", "name": "Copia", "templateType": "html"},
            {"id": "E2", "name": "Original", "templateType": "html"},
        ],
    )
    tpls = build_dashboard(load_dump(path))["templates"]
    e2 = _por_id(tpls, "E2")
    assert e2["canal"] == "email" and e2["name"] == "Original" and e2["orphan"] is False
    assert e2["usos"] == [{"workflow_id": "w1", "workflow": "Um", "papeis": ["envia"]}]
    e1 = _por_id(tpls, "E1")
    assert e1["usos"] == [] and e1["orphan"] is True


def test_sem_templates_lista_vazia(make_dump):
    path = make_dump(workflows=[wf(id="w1", name="Um", steps=[_step("sms", template_id="T1")])])
    assert build_dashboard(load_dump(path))["templates"] == []
