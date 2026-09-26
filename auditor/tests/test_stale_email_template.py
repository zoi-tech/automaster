from automaster_audit.loader import load_dump
from automaster_audit.rules.stale_email_template import check

PREVIEW = (
    "https://firebasestorage.googleapis.com/v0/b/highlevel-backend.appspot.com/o/"
    "location%2FLOC%2Femails%2F{id}%2Findex.html?alt=media&token=t"
)


def _wf(preview_id: str | None, template_id: str = "copia") -> dict:
    attrs = {"template_id": template_id, "subject": "Oi"}
    if preview_id:
        attrs["previewUrl"] = PREVIEW.format(id=preview_id)
    return {
        "id": "wf1",
        "name": "Boas-vindas",
        "raw": {
            "list_entry": {"id": "wf1", "name": "Boas-vindas", "status": "published"},
            "steps": {"templates": [{"id": "s1", "type": "email", "name": "manda", "attributes": attrs}]},
            "triggers": [],
        },
    }


def test_acusa_template_fora_da_lista(make_dump):
    ctx = load_dump(
        make_dump(workflows=[_wf("sumiu")], email_templates=[{"id": "existe", "name": "Vivo", "templateType": "html"}])
    )
    findings = check(ctx)
    assert len(findings) == 1
    assert findings[0].rule == "stale_email_template"
    assert findings[0].severity == "WARN"
    assert "sumiu" in findings[0].detail
    assert findings[0].workflow_id == "wf1"


def test_nao_acusa_template_presente(make_dump):
    ctx = load_dump(
        make_dump(workflows=[_wf("existe")], email_templates=[{"id": "existe", "name": "Vivo", "templateType": "html"}])
    )
    assert check(ctx) == []


def test_nunca_julga_pelo_template_id(make_dump):
    """O template_id é cópia interna do step e nunca está na lista; sozinho não acusa."""
    ctx = load_dump(
        make_dump(
            workflows=[_wf("existe", template_id="6aac33b0nuncaexiste")],
            email_templates=[{"id": "existe", "name": "Vivo", "templateType": "html"}],
        )
    )
    assert check(ctx) == []


def test_step_sem_preview_url_nao_acusa(make_dump):
    ctx = load_dump(
        make_dump(workflows=[_wf(None)], email_templates=[{"id": "existe", "name": "Vivo", "templateType": "html"}])
    )
    assert check(ctx) == []


def test_lista_ausente_e_no_op(make_dump):
    ctx = load_dump(make_dump(workflows=[_wf("sumiu")]))
    assert check(ctx) == []


def test_lista_vazia_tambem_e_no_op(make_dump):
    """Subconta sem nenhum template no builder não transforma todo step em achado."""
    ctx = load_dump(make_dump(workflows=[_wf("sumiu")], email_templates=[]))
    assert check(ctx) == []
