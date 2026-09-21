import pytest
from automaster_audit import mcp_server as s
from automaster_audit.loader import load_dump
from automaster_audit.mcp import base as mcp_base
from automaster_audit.mcp import emails as mcp_emails

PREVIEW = ("https://firebasestorage.googleapis.com/v0/b/highlevel-backend.appspot.com/o/"
           "location%2FLOC%2Femails%2F{id}%2Findex.html?alt=media&token=t")


def _wf(preview_id: str) -> dict:
    return {
        "id": "wf1", "name": "Boas-vindas",
        "raw": {"list_entry": {"id": "wf1", "name": "Boas-vindas", "status": "published"},
                "steps": {"templates": [{"id": "s1", "type": "email", "name": "manda",
                                         "attributes": {"template_id": "copia", "subject": "Oi",
                                                        "previewUrl": PREVIEW.format(id=preview_id)}}]},
                "triggers": []},
    }


@pytest.fixture
def dump(make_dump, monkeypatch):
    path = make_dump(workflows=[_wf("usado")], email_templates=[
        {"id": "usado", "name": "Em uso", "templateType": "html", "parentId": "f1",
         "lastUpdated": "2026-09-01T00:00:00Z"},
        {"id": "parado", "name": "Esquecido", "templateType": "html"},
    ])
    monkeypatch.setattr(mcp_base, "_load", lambda loc, snapshot=None: (load_dump(path), {"loc": loc}))
    return path


def test_lista_traz_nome_e_pasta(dump):
    r = s.modelos_email("LOC")
    assert {m["nome"] for m in r["modelos"]} == {"Em uso", "Esquecido"}
    assert any(m["pasta"] == "f1" for m in r["modelos"])


def test_usos_liga_template_a_workflow(dump):
    r = s.modelos_email("LOC", o="usos")
    assert r["usos"]["usado"] == [{"workflow": "Boas-vindas", "step": "manda", "assunto": "Oi"}]
    assert "parado" in r["sem_uso"]


def test_operacao_invalida_ensina_o_certo(dump):
    with pytest.raises(s.ToolError) as e:
        s.modelos_email("LOC", o="inventada")
    assert "lista" in str(e.value)


def test_conteudo_exige_id(dump):
    with pytest.raises(s.ToolError):
        s.modelos_email("LOC", o="conteudo")


def test_conteudo_devolve_texto_e_links(dump, monkeypatch):
    html = b"<html><body><h1>Ola</h1><a href='https://x/y'>Clique</a></body></html>"
    monkeypatch.setattr(mcp_emails, "_ler_url", lambda url: html)
    r = s.modelos_email("LOC", o="conteudo", id="usado")
    assert "Ola" in r["texto"]
    assert "Clique" in r["texto"]
    assert "https://x/y" in r["links"]


def test_conteudo_monta_url_sem_token(dump, monkeypatch):
    vistas = []
    monkeypatch.setattr(mcp_emails, "_ler_url", lambda url: vistas.append(url) or b"<html></html>")
    s.modelos_email("LOC", o="conteudo", id="usado")
    assert vistas[0].endswith("index.html?alt=media")
    assert "token=" not in vistas[0]
