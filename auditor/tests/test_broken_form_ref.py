from conftest import trig, wf

from automaster_audit.loader import load_dump
from automaster_audit.rules.broken_form_ref import check


def form_cond(field, valores):
    return {"operator": "is-any-of", "field": field, "value": valores, "title": "Form is", "type": "string"}


def test_sem_lista_nao_acusa(make_dump):
    ctx = load_dump(
        make_dump(
            workflows=[
                wf(triggers=[trig("form_submission", "wf1", conditions=[form_cond("form.id", ["SUMIU"])])]),
            ]
        )
    )
    assert check(ctx) == []


def test_acusa_trigger_com_formulario_inexistente(make_dump):
    ctx = load_dump(
        make_dump(
            workflows=[wf(triggers=[trig("form_submission", "wf1", conditions=[form_cond("form.id", ["SUMIU"])])])],
            forms=[{"_id": "F1", "name": "Contato"}],
        )
    )
    f = check(ctx)
    assert len(f) == 1
    assert f[0].severity == "ERROR" and "SUMIU" in f[0].detail


def test_trigger_com_formulario_existente_fica_calado(make_dump):
    ctx = load_dump(
        make_dump(
            workflows=[wf(triggers=[trig("form_submission", "wf1", conditions=[form_cond("form.id", ["F1"])])])],
            forms=[{"_id": "F1", "name": "Contato"}],
        )
    )
    assert check(ctx) == []


def test_survey_usa_a_lista_de_survey(make_dump):
    ctx = load_dump(
        make_dump(
            workflows=[wf(triggers=[trig("survey_submission", "wf1", conditions=[form_cond("survey.id", ["S9"])])])],
            forms=[{"_id": "F1"}],
            surveys=[{"_id": "S1"}],
        )
    )
    assert len(check(ctx)) == 1


def test_pseudo_formulario_do_facebook_nao_acusa(make_dump):
    ctx = load_dump(
        make_dump(
            workflows=[
                wf(triggers=[trig("form_submission", "wf1", conditions=[form_cond("form.id", ["fb-TESTLOC"])])])
            ],
            forms=[{"_id": "F1"}],
        )
    )
    assert check(ctx) == []


def test_calendario_com_formulario_apagado(make_dump):
    ctx = load_dump(
        make_dump(
            workflows=[wf(triggers=[])],
            forms=[{"_id": "F1"}],
            calendars=[{"id": "C1", "name": "Reunião", "formId": "SUMIU"}],
        )
    )
    f = check(ctx)
    assert len(f) == 1
    assert "Reunião" in f[0].detail and f[0].workflow_id == ""
