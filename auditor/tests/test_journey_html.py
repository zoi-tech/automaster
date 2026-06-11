import re

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


def test_view_switcher_present(make_dump, tmp_path):
    a = wf(id="a", name="A", steps=[step("s1", "sms")],
           triggers=[trig("contact_created", "a")])
    data = build_journey(load_dump(make_dump(workflows=[a])))
    out = write_journey_html(data, tmp_path / "j.html", title="T")
    html = out.read_text(encoding="utf-8")
    for v in ("lista", "flux", "metro"):
        assert f'data-jview="{v}"' in html
    assert "const JOURNEY" in html


def test_journey_json_embed_is_safe(make_dump, tmp_path):
    evil = '</script><img src=x>'
    a = wf(id="a", name=evil, steps=[step("s1", "sms")],
           triggers=[trig("contact_created", "a")])
    data = build_journey(load_dump(make_dump(workflows=[a])))
    out = write_journey_html(data, tmp_path / "j.html", title="T")
    html = out.read_text(encoding="utf-8")
    m = re.search(r"const JOURNEY = (.+);", html)
    assert m, "bloco JSON embutido ausente"
    blob = m.group(1)
    assert "</script" not in blob          # fechamento escapado
    assert "<\\/script" in blob            # ...com <\/
    # auto-contido: nenhum recurso externo além dos 4 links relativos do sidebar
    stripped = (html.replace('href="dashboard.html', "")
                    .replace('href="graph.html', "")
                    .replace('href="validation.html', "")
                    .replace('href="journey.html', ""))
    assert 'src="http' not in stripped and 'href="http' not in stripped
    assert "unpkg" not in html and "fonts.googleapis" not in html


def test_views_lazy_containers(make_dump, tmp_path):
    a = wf(id="a", name="A", steps=[step("s1", "sms")],
           triggers=[trig("contact_created", "a")])
    data = build_journey(load_dump(make_dump(workflows=[a])))
    out = write_journey_html(data, tmp_path / "j.html", title="T")
    html = out.read_text(encoding="utf-8")
    assert '<div id="view-flux"></div>' in html
    assert '<div id="view-metro"></div>' in html


def test_metro_js_classifies_by_structured_fields_not_labels(make_dump, tmp_path):
    # review: loop real vs ref e badge DECAY eram parse de string pt-BR do
    # label (acoplamento oculto com journey.py + falso positivo com tag "decay")
    a = wf(id="a", name="A", steps=[step("s1", "sms")],
           triggers=[trig("contact_created", "a")])
    data = build_journey(load_dump(make_dump(workflows=[a])))
    out = write_journey_html(data, tmp_path / "j.html", title="T")
    html = out.read_text(encoding="utf-8")
    # discriminadores estruturais presentes no JS do metrô
    assert "s.flags.indexOf('ref')" in html
    assert "s.ttype==='opportunity_decay'" in html
    # heurísticas por texto de label banidas
    assert "label.indexOf('loop')" not in html
    assert "/decay|estagnar/i" not in html


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
