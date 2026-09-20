from automaster_audit.loader import load_dump
from automaster_audit.rules._helpers import email_template_id


def _step(preview: str | None, template_id: str = "copia123") -> dict:
    attrs = {"template_id": template_id}
    if preview is not None:
        attrs["previewUrl"] = preview
    return {"id": "s1", "type": "email", "name": "manda", "attributes": attrs}


def test_id_sai_do_preview_url_percent_encoded():
    url = ("https://firebasestorage.googleapis.com/v0/b/highlevel-backend.appspot.com/o/"
           "location%2FLOC%2Femails%2Fabc123%2Findex.html?alt=media&token=x")
    assert email_template_id(_step(url)) == "abc123"


def test_id_sai_do_preview_url_ja_decodificado():
    url = "https://x/location/LOC/emails/def456/index.html?alt=media"
    assert email_template_id(_step(url)) == "def456"


def test_sem_preview_url_devolve_vazio():
    assert email_template_id(_step(None)) == ""


def test_template_id_nunca_e_usado():
    assert email_template_id(_step(None, template_id="6aac33b07919774ef2a15f09")) == ""


def test_loader_le_builders_ignorando_pasta(make_dump):
    path = make_dump(email_templates=[
        {"id": "t1", "name": "Bem-vindo", "templateType": "html"},
        {"id": "f1", "name": "Pasta", "templateType": "folder"},
    ])
    ctx = load_dump(path)
    assert ctx.template_ids["email"] == {"t1"}
    assert ctx.template_names["t1"] == "Bem-vindo"
    assert [b["id"] for b in ctx.email_templates] == ["t1"]


def test_lista_ausente_deixa_canal_fora(make_dump):
    ctx = load_dump(make_dump())
    assert "email" not in ctx.template_ids
    assert ctx.email_templates == []
