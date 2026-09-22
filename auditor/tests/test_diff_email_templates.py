from automaster_audit.diff import build_diff
from automaster_audit.loader import load_dump


def test_template_de_email_novo_aparece_no_diff(make_dump):
    antes = load_dump(make_dump(email_templates=[{"id": "t1", "name": "Um", "templateType": "html"}]))
    depois = load_dump(
        make_dump(
            email_templates=[
                {"id": "t1", "name": "Um", "templateType": "html"},
                {"id": "t2", "name": "Dois", "templateType": "html"},
            ]
        )
    )
    d = build_diff(antes, depois)
    assert "templates de e-mail" in str(d)
    assert "Dois" in str(d)


def test_canal_ausente_nao_vira_diferenca(make_dump):
    """Dump anterior à extração de e-mail não pode parecer 'todos os templates sumiram'."""
    antes = load_dump(make_dump())
    depois = load_dump(make_dump(email_templates=[{"id": "t1", "name": "Um", "templateType": "html"}]))
    d = build_diff(antes, depois)
    assert "Um" not in str(d)
