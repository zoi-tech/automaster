from automaster_audit.loader import load_dump
from automaster_audit.report import _render_md
from conftest import wf


def test_dump_sem_listas_avisa_que_as_regras_estao_cegas(make_dump):
    md = _render_md(load_dump(make_dump(workflows=[wf()])), [])
    assert "Regras cegas" in md
    assert "broken_template_ref" in md and "broken_form_ref" in md
    assert "forms.json" in md


def test_dump_completo_nao_tem_secao(make_dump):
    ctx = load_dump(make_dump(
        workflows=[wf()], forms=[], surveys=[],
        message_templates=[], whatsapp_templates=[],
    ))
    assert "Regras cegas" not in _render_md(ctx, [])


def test_so_a_lista_que_falta_aparece(make_dump):
    ctx = load_dump(make_dump(
        workflows=[wf()], message_templates=[], whatsapp_templates=[],
    ))
    md = _render_md(ctx, [])
    assert "broken_form_ref" in md and "broken_template_ref" not in md
