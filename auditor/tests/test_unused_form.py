from conftest import trig, wf

from automaster_audit.loader import load_dump
from automaster_audit.rules.unused_form import check


def form_cond(field, valores):
    return {"operator": "is-any-of", "field": field, "value": valores,
            "title": "Form is", "type": "string"}


def test_sem_lista_nao_acusa(make_dump):
    assert check(load_dump(make_dump(workflows=[wf(triggers=[])]))) == []


def test_formulario_sem_uso_vira_info(make_dump):
    ctx = load_dump(make_dump(
        workflows=[wf(triggers=[])],
        forms=[{"_id": "F1", "name": "Esquecido"}],
    ))
    f = check(ctx)
    assert len(f) == 1
    assert f[0].severity == "INFO" and "Esquecido" in f[0].detail
    assert "site externo" in f[0].detail


def test_formulario_usado_em_trigger_nao_e_orfao(make_dump):
    ctx = load_dump(make_dump(
        workflows=[wf(triggers=[trig("form_submission", "wf1", conditions=[form_cond("form.id", ["F1"])])])],
        forms=[{"_id": "F1", "name": "Usado"}],
    ))
    assert check(ctx) == []


def test_formulario_usado_em_calendario_nao_e_orfao(make_dump):
    ctx = load_dump(make_dump(
        workflows=[wf(triggers=[])],
        forms=[{"_id": "F1", "name": "Do calendário"}],
        calendars=[{"id": "C1", "name": "Reunião", "formId": "F1"}],
    ))
    assert check(ctx) == []


def test_survey_orfao_tambem_conta(make_dump):
    ctx = load_dump(make_dump(workflows=[wf(triggers=[])], surveys=[{"_id": "S1", "name": "Pesquisa"}]))
    assert len(check(ctx)) == 1
