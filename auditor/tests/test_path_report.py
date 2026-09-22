"""Testes da Camada 2: rótulos de ação e relatório Markdown de caminhos."""
from conftest import wf

from automaster_audit.loader import load_dump
from automaster_audit.path_report import build_paths_report, describe_step, write_paths_report


def _ctx(make_dump, **kw):
    return load_dump(make_dump(**kw))


def test_describe_add_contact_tag(make_dump):
    ctx = _ctx(make_dump, workflows=[wf()])
    step = {"id": "s", "type": "add_contact_tag", "attributes": {"tags": ["vip", "novo"]}}
    out = describe_step(step, ctx)
    assert "vip" in out and "novo" in out


def test_describe_add_to_workflow_resolves_name(make_dump):
    ctx = _ctx(make_dump, workflows=[wf(id="alvo", name="Fluxo Alvo")])
    step = {"id": "s", "type": "add_to_workflow", "attributes": {"workflow_id": "alvo"}}
    assert "Fluxo Alvo" in describe_step(step, ctx)


def test_describe_id_sem_nome_mostra_id_cru(make_dump):
    ctx = _ctx(make_dump, workflows=[wf()])
    step = {"id": "s", "type": "add_to_workflow", "attributes": {"workflow_id": "sumido"}}
    assert "sumido" in describe_step(step, ctx)


def test_describe_unknown_type_falls_back_to_type(make_dump):
    ctx = _ctx(make_dump, workflows=[wf()])
    assert describe_step({"id": "s", "type": "tipo_misterioso"}, ctx) == "tipo_misterioso"


_IF_ELSE_STEPS = [
    {"id": "c", "type": "if_else", "name": "Cond",
     "attributes": {"branches": [{"id": "b1", "name": "VIP"}]}, "next": ["b1", "b2"]},
    {"id": "b1", "type": "if_else", "name": "VIP", "parent": "c", "attributes": {"if": []}, "next": "a1"},
    {"id": "b2", "type": "if_else", "name": "Else", "parent": "c", "attributes": {"else": []}, "next": "a2"},
    {"id": "a1", "type": "sms", "name": "SMS VIP", "parent": "b1"},
    {"id": "a2", "type": "sms", "name": "SMS Else", "parent": "b2"},
]


def test_build_paths_report_if_else_two_branches(make_dump):
    ctx = _ctx(make_dump, workflows=[wf(name="Fluxo Teste", steps=_IF_ELSE_STEPS)])
    md = build_paths_report(ctx)
    assert "## Fluxo Teste" in md
    assert "VIP" in md and "ELSE" in md
    assert md.count("[fim]") == 2
    assert "truncado" not in md


def test_build_paths_report_truncation_line(make_dump):
    steps = [
        {"id": "c", "type": "if_else", "name": "Cond",
         "attributes": {"branches": [{"id": f"b{i}", "name": f"R{i}"} for i in (1, 2, 3)]},
         "next": ["b1", "b2", "b3"]},
        {"id": "b1", "type": "if_else", "name": "R1", "parent": "c", "attributes": {"if": []}},
        {"id": "b2", "type": "if_else", "name": "R2", "parent": "c", "attributes": {"if": []}},
        {"id": "b3", "type": "if_else", "name": "R3", "parent": "c", "attributes": {"if": []}},
    ]
    ctx = _ctx(make_dump, workflows=[wf(steps=steps)])
    md = build_paths_report(ctx, cap=2)
    assert "⚠ truncado em 2 caminhos" in md


def test_write_paths_report(make_dump):
    ctx = _ctx(make_dump, workflows=[wf(steps=_IF_ELSE_STEPS)])
    out = ctx.path / "paths.md"
    written = write_paths_report(ctx, out)
    assert written == out
    assert "VIP" in out.read_text(encoding="utf-8")


def test_describe_step_shapes_malformados_nao_levantam(make_dump):
    ctx = _ctx(make_dump, workflows=[wf()])
    assert describe_step({"type": "internal_notification", "attributes": {"sms": ["x"]}}, ctx) == "notificar"
    assert describe_step({"type": "assign_user", "attributes": {"traffic_weightage": ["u1"]}}, ctx) == "assign user"
