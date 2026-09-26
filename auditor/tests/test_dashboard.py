from conftest import wf

from automaster_audit.dashboard import build_dashboard
from automaster_audit.dashboard_html import write_dashboard_html
from automaster_audit.loader import load_dump


def test_dashboard_aggregates_workflow_refs(make_dump):
    step = {"type": "add_contact_tag", "name": "Add", "attributes": {"tags": ["follow-up"]}}
    sms = {"type": "sms", "name": "SMS", "attributes": {}}
    path = make_dump(workflows=[wf(steps=[step, sms])], tags=["follow-up"])
    d = build_dashboard(load_dump(path))
    w = d["workflows"][0]
    assert w["n_steps"] == 2
    assert w["n_tags"] == 1
    assert w["channels"].get("sms") == 1


def test_dashboard_marks_orphan_tag(make_dump):
    step = {"type": "add_contact_tag", "name": "Add", "attributes": {"tags": ["usada"]}}
    path = make_dump(workflows=[wf(steps=[step])], tags=["usada", "naoUsada"])
    d = build_dashboard(load_dump(path))
    orphans = {t["name"] for t in d["tags"] if t["orphan"]}
    assert "naousada" in {o.lower() for o in orphans}
    assert "usada" not in {o.lower() for o in orphans}
    assert d["summary"]["tags_orphan"] == 1


def test_dashboard_reverse_index_and_called_by(make_dump):
    caller = {"type": "add_to_workflow", "name": "Add WF", "attributes": {"workflow_id": "sub"}}
    path = make_dump(workflows=[wf(id="caller", name="Caller", steps=[caller]), wf(id="sub", name="[X] Y → Z")])
    d = build_dashboard(load_dump(path))
    sub = next(w for w in d["workflows"] if w["id"] == "sub")
    caller_wf = next(w for w in d["workflows"] if w["id"] == "caller")
    assert sub["called_by"] == ["Caller"]
    assert sub["has_entry"] is True  # chamado por outro
    assert caller_wf["calls"] == ["[X] Y → Z"]


def test_dashboard_html_safe_and_selfcontained(make_dump, tmp_path):
    path = make_dump(workflows=[wf(name="</script><img src=x onerror=alert(1)>")], tags=[])
    out = write_dashboard_html(build_dashboard(load_dump(path)), tmp_path / "d.html", title="T")
    html = out.read_text(encoding="utf-8")
    assert "</script><img" not in html
    # auto-contido: sem recurso externo (script/link/@import http). Fonte vai como data: URI.
    assert 'src="http' not in html and 'href="http' not in html and "@import" not in html
    assert "unpkg" not in html
    assert "const DATA =" in html
