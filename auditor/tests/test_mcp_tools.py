"""Contrato e teto das seis tools offline do servidor MCP."""
import json
import shutil

import pytest

from automaster_audit import mcp_server as srv
from conftest import wf

LOC = "TESTLOC"


@pytest.fixture
def root(make_dump, tmp_path, monkeypatch):
    """Monta <root>/<loc>/<snapshot>/ a partir do make_dump e aponta o servidor pra lá."""
    def _build(snapshot="2026-06-10_0000", **kw):
        d = make_dump(**kw)
        dest = tmp_path / "root" / LOC / snapshot
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(d), str(dest))
        monkeypatch.setenv("AUTOMASTER_DUMPS", str(tmp_path / "root"))
        srv._ctx.cache_clear()
        return dest
    return _build


def _steps_tag(tag):
    return [{"type": "add_contact_tag", "name": "Add", "attributes": {"tags": [tag]}}]


def test_dumps_lists_snapshots(root):
    root(snapshot="2026-06-01_0000")
    root(snapshot="2026-06-10_0000", workflows=[wf()])
    out = srv.dumps()
    assert out[0]["loc"] == LOC
    assert out[0]["snapshots"] == ["2026-06-10_0000", "2026-06-01_0000"]
    assert out[0]["extractedAt"] == "2026-06-10T00:00:00+00:00"


def test_every_tool_carries_snapshot_block(root):
    root(workflows=[wf()], tags=["x"])
    for out in (srv.inventario(LOC), srv.workflow(LOC, "wf1"), srv.achados(LOC),
                srv.buscar(LOC, "x"), srv.jornada(LOC)):
        assert set(out["_snapshot"]) == {"snapshot", "extractedAt", "idade_dias"}
        assert isinstance(out["_snapshot"]["idade_dias"], int)


def test_unknown_loc_is_error(root):
    root()
    with pytest.raises(srv.ToolError):
        srv.inventario("NOPE")


def test_inventario_default_is_summary_only(root):
    root(workflows=[wf(steps=_steps_tag("a"))], tags=["a", "b"])
    out = srv.inventario(LOC)
    assert set(out) == {"summary", "_snapshot"}
    assert out["summary"]["tags_orphan"] == 1
    fatia = srv.inventario(LOC, "tags")
    assert [t["name"] for t in fatia["tags"]] == ["a", "b"]
    with pytest.raises(srv.ToolError):
        srv.inventario(LOC, "nada")


def test_workflow_meta_paths_and_findings(root):
    steps = [{"id": "s1", "type": "add_contact_tag", "name": "Add", "attributes": {"tags": ["sumida"]}}]
    root(workflows=[wf(steps=steps)], tags=[])
    out = srv.workflow(LOC, "wf1")
    assert out["meta"]["name"] == "[Solar] Compra → Boas-vindas"
    assert out["meta"]["n_steps"] == 1
    assert "add tag" in out["caminhos"] and out["caminhos_truncado"] is False
    assert [f["rule"] for f in out["achados"]] == ["broken_tag_ref"]
    with pytest.raises(srv.ToolError):
        srv.workflow(LOC, "nope")


def test_workflow_paths_have_ceiling(root, monkeypatch):
    # cadeia de 60 if_else = muitos caminhos; o teto corta e avisa
    steps, prev = [], None
    for i in range(40):
        b = {"id": f"b{i}", "type": "if_else", "name": f"If{i}", "attributes": {"branches": [
            {"id": f"y{i}", "name": "Sim"}, {"id": f"n{i}", "name": "Não"}]}}
        steps.append(b)
    root(workflows=[wf(steps=steps)])
    monkeypatch.setattr(srv, "PATHS_MAX_CHARS", 200)
    out = srv.workflow(LOC, "wf1")
    assert out["caminhos_truncado"] is True
    assert len(out["caminhos"]) <= 260


def test_achados_groups_and_keeps_counts(root):
    steps = [{"id": f"s{i}", "type": "add_contact_tag", "name": "Add", "attributes": {"tags": ["sumida"]}}
             for i in range(3)]
    root(workflows=[wf(steps=steps)], tags=[])
    out = srv.achados(LOC, "ERROR")
    assert out["counts"]["ERROR"] == 3 and "INFO" in out["counts"]
    grp = [a for a in out["achados"] if a["rule"] == "broken_tag_ref"]
    assert len(grp) == 1 and grp[0]["n"] == 3
    assert all(a["severity"] == "ERROR" for a in out["achados"])


def test_buscar_returns_papel(root):
    trig = {"id": "t1", "name": "Contact Tag", "type": "contact_tag",
            "conditions": [{"field": "tagsAdded", "operator": "index-of-true", "value": "gatilho"}]}
    root(workflows=[wf(name="Fluxo Gatilho", triggers=[trig], steps=_steps_tag("outra"))],
         tags=["gatilho", "outra"], fields=[{"id": "F1", "name": "Gatilho de campo"}])
    out = srv.buscar(LOC, "gatilho")
    tags = {t["name"]: t for t in out["tags"]}
    assert tags["gatilho"]["papeis"] == ["dispara"] and tags["gatilho"]["orphan"] is False
    assert out["workflows"][0]["name"] == "Fluxo Gatilho"
    assert out["fields"][0]["name"] == "Gatilho de campo"
    assert "outra" not in tags


def test_jornada_one_level_never_full_subtree(root):
    trig = {"id": "t1", "name": "Novo", "type": "contact_created", "conditions": [], "active": True,
            "workflow_id": "wf1", "actions": [{"workflow_id": "wf1", "type": "add_to_workflow"}]}
    steps = [{"id": "s1", "type": "add_contact_tag", "name": "Add", "attributes": {"tags": ["a"]}, "next": ["s2"]},
             {"id": "s2", "type": "sms", "name": "SMS", "attributes": {}, "parent": "s1"}]
    root(workflows=[wf(triggers=[trig], steps=steps)], tags=["a"])
    raiz = srv.jornada(LOC)
    assert set(raiz) == {"criacao", "anytime", "_snapshot"}
    n0 = raiz["criacao"][0]
    assert "children" not in json.dumps(raiz)
    assert n0["n_filhos"] == 1
    nivel = srv.jornada(LOC, [0])
    assert nivel["no"]["label"] == "Contato criado" and nivel["filhos"][0]["kind"] == "workflow"
    assert "children" not in json.dumps(nivel)
    fundo = srv.jornada(LOC, [0, 0], profundidade=2)
    assert "filhos" in fundo["filhos"][0]
    with pytest.raises(srv.ToolError):
        srv.jornada(LOC, [9])


def test_rpc_roundtrip(root, capsys):
    root(workflows=[wf()])
    req = [{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}},
           {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
           {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "inventario", "arguments": {"loc": LOC}}},
           {"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "inventario", "arguments": {"loc": "NOPE"}}}]
    resps = [srv.handle(r) for r in req]
    assert resps[0]["result"]["protocolVersion"]
    assert {t["name"] for t in resps[1]["result"]["tools"]} >= {"dumps", "inventario", "workflow", "achados", "buscar", "jornada"}
    body = json.loads(resps[2]["result"]["content"][0]["text"])
    assert body["summary"]["workflows"] == 1
    assert resps[3]["result"]["isError"] is True


def _ev(i):
    return {"id": f"e{i}", "type": "TAG", "createdAt": f"2026-06-{10 - i:02d}T00:00:00.000Z",
            "sourceId": "wf1", "sourceWorkflowName": "Boas-vindas"}


def test_contato_returns_events_and_snapshot(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(srv, "_run_timeline", lambda loc, id, days: {"events": [_ev(0), _ev(1)]})
    out = srv.contato(LOC, "c1")
    assert [e["id"] for e in out["eventos"]] == ["e0", "e1"]
    assert out["truncado"] is False and "_snapshot" in out


def test_contato_ceiling_pages_by_time(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(srv, "_run_timeline", lambda loc, id, days: {"events": [_ev(i) for i in range(9)]})
    monkeypatch.setattr(srv, "CONTATO_MAX_CHARS", 400)
    out = srv.contato(LOC, "c1")
    assert out["truncado"] is True and len(out["eventos"]) < 9
    assert out["proximo_ate"] == out["eventos"][-1]["createdAt"]
    page2 = srv.contato(LOC, "c1", ate=out["proximo_ate"])
    assert page2["eventos"][0]["createdAt"] < out["proximo_ate"]


def test_contato_without_setup_teaches(root, monkeypatch, tmp_path):
    root(workflows=[wf()])
    monkeypatch.setattr(srv, "EXTRACTOR_DIR", tmp_path / "nao-existe")
    with pytest.raises(srv.ToolError, match="automaster-extract"):
        srv.contato(LOC, "c1")
