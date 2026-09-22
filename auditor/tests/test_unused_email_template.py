from automaster_audit.loader import load_dump
from automaster_audit.rules.unused_email_template import check

PREVIEW = (
    "https://firebasestorage.googleapis.com/v0/b/highlevel-backend.appspot.com/o/"
    "location%2FLOC%2Femails%2F{id}%2Findex.html?alt=media&token=t"
)


def _wf(preview_id: str) -> dict:
    return {
        "id": "wf1",
        "name": "Boas-vindas",
        "raw": {
            "list_entry": {"id": "wf1", "name": "Boas-vindas", "status": "published"},
            "steps": {
                "templates": [
                    {
                        "id": "s1",
                        "type": "email",
                        "name": "manda",
                        "attributes": {"template_id": "copia", "previewUrl": PREVIEW.format(id=preview_id)},
                    }
                ]
            },
            "triggers": [],
        },
    }


def test_acusa_template_que_ninguem_cita(make_dump):
    ctx = load_dump(
        make_dump(
            workflows=[_wf("usado")],
            email_templates=[
                {"id": "usado", "name": "Em uso", "templateType": "html"},
                {"id": "parado", "name": "Esquecido", "templateType": "html"},
            ],
        )
    )
    findings = check(ctx)
    assert len(findings) == 1
    assert findings[0].rule == "unused_email_template"
    assert findings[0].severity == "INFO"
    assert findings[0].workflow_id == ""
    assert "Esquecido" in findings[0].detail


def test_nao_acusa_o_que_esta_em_uso(make_dump):
    ctx = load_dump(
        make_dump(workflows=[_wf("usado")], email_templates=[{"id": "usado", "name": "Em uso", "templateType": "html"}])
    )
    assert check(ctx) == []


def test_pasta_nunca_vira_achado(make_dump):
    ctx = load_dump(
        make_dump(
            workflows=[_wf("usado")],
            email_templates=[
                {"id": "usado", "name": "Em uso", "templateType": "html"},
                {"id": "f1", "name": "Pasta", "templateType": "folder"},
            ],
        )
    )
    assert check(ctx) == []


def test_lista_ausente_e_no_op(make_dump):
    ctx = load_dump(make_dump(workflows=[_wf("usado")]))
    assert check(ctx) == []
