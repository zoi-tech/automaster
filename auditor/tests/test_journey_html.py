from automaster_audit.journey import build_journey
from automaster_audit.journey_html import write_journey_html
from automaster_audit.loader import load_dump
from conftest import wf
from test_journey import step, trig


def test_journey_html_selfcontained_and_xss_safe(make_dump, tmp_path):
    evil = '</script><img src=x onerror=alert(1)>'
    a = wf(id="a", name=evil, steps=[step("s1", "sms")],
           triggers=[trig("contact_created", "a")])
    data = build_journey(load_dump(make_dump(workflows=[a])))
    out = write_journey_html(data, tmp_path / "j.html", title="T")
    html = out.read_text(encoding="utf-8")
    assert "</script><img" not in html
    assert 'src="http' not in html and 'href="http' not in html.replace(
        'href="dashboard.html', "").replace('href="graph.html', "").replace(
        'href="validation.html', "").replace('href="journey.html', "")
    assert "unpkg" not in html


def test_journey_html_renders_tree_and_stats(make_dump, tmp_path):
    a = wf(id="a", name="A", steps=[step("s1", "add_contact_tag", attrs={"tags": ["q"]})],
           triggers=[trig("contact_created", "a")])
    b = wf(id="b", name="B", steps=[step("s2", "sms")],
           triggers=[trig("contact_tag", "b", conditions=[
               {"operator": "index-of-true", "id": "tag-added", "value": "q",
                "title": "Tag Added", "type": "select", "field": "tagsAdded"}], tid="tb")])
    data = build_journey(load_dump(make_dump(workflows=[a, b], tags=["q"])))
    out = write_journey_html(data, tmp_path / "j.html", title="T")
    html = out.read_text(encoding="utf-8")
    assert "Contato criado" in html and "A qualquer momento" in html
    assert "<details" in html and "TAG+" in html
    assert "data-jfilter" in html  # input de filtro presente


def test_cli_journey_subcommand(make_dump, capsys):
    from automaster_audit.cli import main
    a = wf(id="a", name="A", steps=[step("s1", "sms")],
           triggers=[trig("contact_created", "a")])
    path = make_dump(workflows=[a])
    rc = main(["journey", str(path)])
    assert rc == 0
    assert (path / "journey.html").exists()
    outtxt = capsys.readouterr().out
    assert "jornada" in outtxt.lower()
