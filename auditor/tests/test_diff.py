"""Diff entre dois snapshots da mesma subconta."""
from automaster_audit.diff import build_diff, render_md
from automaster_audit.loader import load_dump

from conftest import wf


def _step(sid="s1", name="Add tag", tags=("x",)):
    return {"id": sid, "type": "add_contact_tag", "name": name, "attributes": {"tags": list(tags)}}


def test_dump_identico_nao_acusa_mudanca(make_dump):
    a = load_dump(make_dump(workflows=[wf(id="w1", steps=[_step()])], tags=["x"]))
    b = load_dump(make_dump(workflows=[wf(id="w1", steps=[_step()])], tags=["x"]))
    d = build_diff(a, b)
    assert d["sem_mudanca"] is True
    assert "Nada mudou" in render_md(d)


def test_pega_workflow_adicionado_removido_e_alterado(make_dump):
    a = load_dump(make_dump(
        workflows=[wf(id="w1", name="A", steps=[_step()]), wf(id="w2", name="Sai")],
        tags=["x"],
    ))
    b = load_dump(make_dump(
        workflows=[
            wf(id="w1", name="A renomeado", status="draft", steps=[_step(tags=("y",))]),
            wf(id="w3", name="Entra"),
        ],
        tags=["x", "y"],
    ))
    d = build_diff(a, b)
    assert [x["nome"] for x in d["workflows"]["adicionados"]] == ["Entra"]
    assert [x["nome"] for x in d["workflows"]["removidos"]] == ["Sai"]
    (alt,) = d["workflows"]["alterados"]
    assert alt["id"] == "w1"
    assert any("nome:" in m for m in alt["mudancas"])
    assert any("status: published → draft" in m for m in alt["mudancas"])
    assert any("steps:" in m for m in alt["mudancas"])
    assert d["entidades"]["tags"] == {"adicionados": ["y"], "removidos": []}


def test_markdown_escapa_pipe_do_nome(make_dump):
    a = load_dump(make_dump(workflows=[]))
    b = load_dump(make_dump(workflows=[wf(id="w1", name="Fluxo | Carlos")]))
    md = render_md(build_diff(a, b))
    assert "Fluxo \\| Carlos" in md


def test_avisa_subcontas_diferentes(make_dump, monkeypatch):
    a_path = make_dump(workflows=[])
    b_path = make_dump(workflows=[])
    import json
    m = json.loads((b_path / "manifest.json").read_text())
    m["locationId"] = "OUTRA"
    (b_path / "manifest.json").write_text(json.dumps(m))
    d = build_diff(load_dump(a_path), load_dump(b_path))
    assert d["mesma_subconta"] is False
    assert "subcontas diferentes" in render_md(d)
