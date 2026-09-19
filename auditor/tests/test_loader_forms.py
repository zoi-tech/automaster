from automaster_audit.loader import load_dump
from conftest import wf


def test_listas_ausentes_nao_criam_chave(make_dump):
    ctx = load_dump(make_dump(workflows=[wf()]))
    assert ctx.form_ids == {}
    assert ctx.form_names == {}


def test_listas_presentes_viram_ids_e_nomes(make_dump):
    path = make_dump(
        workflows=[wf()],
        forms=[{"_id": "F1", "name": "Contato"}],
        surveys=[{"_id": "S1", "name": "Pesquisa"}],
    )
    ctx = load_dump(path)
    assert ctx.form_ids == {"form": {"F1"}, "survey": {"S1"}}
    assert ctx.form_names["F1"] == "Contato"
    assert ctx.form_names["S1"] == "Pesquisa"


def test_lista_vazia_cria_chave_vazia(make_dump):
    ctx = load_dump(make_dump(workflows=[wf()], forms=[]))
    assert ctx.form_ids == {"form": set()}
