from automaster_audit.graph import build_graph
from automaster_audit.graph_html import write_graph_html
from automaster_audit.loader import load_dump
from conftest import wf


def test_graph_links_tag_to_workflows(make_dump):
    step = {"type": "add_contact_tag", "name": "Add", "attributes": {"tags": ["follow-up"]}}
    path = make_dump(workflows=[wf(id="a", steps=[step]), wf(id="b", steps=[step])], tags=["follow-up"])
    g = build_graph(load_dump(path))
    tag_nodes = [n for n in g["nodes"] if n["type"] == "tag"]
    assert len(tag_nodes) == 1
    tag_id = tag_nodes[0]["id"]
    edges_to_tag = [e for e in g["edges"] if e["to"] == tag_id]
    assert {e["from"] for e in edges_to_tag} == {"wf:a", "wf:b"}


def test_graph_marks_missing_reference(make_dump):
    step = {"type": "add_contact_tag", "name": "Add", "attributes": {"tags": ["ghost"]}}
    path = make_dump(workflows=[wf(steps=[step])], tags=[])
    g = build_graph(load_dump(path))
    tag = next(n for n in g["nodes"] if n["type"] == "tag")
    assert tag["missing"] is True


def test_graph_workflow_to_workflow_edge(make_dump):
    step = {"type": "add_to_workflow", "name": "Add WF", "attributes": {"workflow_id": "b"}}
    path = make_dump(workflows=[wf(id="a", steps=[step]), wf(id="b", name="[X] Y → Z")])
    g = build_graph(load_dump(path))
    assert any(e["from"] == "wf:a" and e["to"] == "wf:b" and e["rel"] == "add_to_workflow" for e in g["edges"])


def test_write_graph_html_has_sri(make_dump, tmp_path):
    path = make_dump(workflows=[wf()])
    out = write_graph_html(build_graph(load_dump(path)), tmp_path / "g.html", title="T")
    html = out.read_text(encoding="utf-8")
    assert "integrity=" in html and "crossorigin=" in html
    assert "const DATA =" in html
