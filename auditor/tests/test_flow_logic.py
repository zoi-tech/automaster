"""Testes da camada 1 (lógica sã): flow graph + regras estruturais."""
from automaster_audit.flow import reachable, successors
from automaster_audit.loader import load_dump
from automaster_audit.rules import broken_goto, unreachable_step, uncovered_condition, workflow_call_cycle
from conftest import wf


# --- flow.successors ---
def test_successors_handles_list_string_and_goto():
    assert set(successors({"next": ["a", "b"]})) == {"a", "b"}
    assert successors({"next": "c"}) == ["c"]
    assert successors({"next": None}) == []
    assert successors({"type": "goto", "attributes": {"targetNodeId": "z"}}) == ["z"]


# --- unreachable_step ---
def _steps_linear_with_orphan():
    # root → s2 ; s_orphan não é alcançável
    return [
        {"id": "root", "type": "sms", "name": "Root", "next": "s2"},
        {"id": "s2", "type": "wait", "name": "Wait", "parent": "root"},
        {"id": "orphan", "type": "sms", "name": "Órfão", "parent": "ghost"},
    ]


def test_unreachable_flags_orphan(make_dump):
    path = make_dump(workflows=[wf(steps=_steps_linear_with_orphan())])
    f = unreachable_step.check(load_dump(path))
    assert len(f) == 1 and f[0].severity == "WARN"
    assert "Órfão" in f[0].detail


def test_reachable_set_excludes_orphan(make_dump):
    path = make_dump(workflows=[wf(steps=_steps_linear_with_orphan())])
    w = load_dump(path).workflows[0]
    assert reachable(w) == {"root", "s2"}


# --- broken_goto ---
def test_broken_goto_flags_missing_target(make_dump):
    steps = [
        {"id": "root", "type": "goto", "name": "Go To", "attributes": {"targetNodeId": "ghost"}},
    ]
    path = make_dump(workflows=[wf(steps=steps)])
    f = broken_goto.check(load_dump(path))
    assert len(f) == 1 and f[0].severity == "ERROR"


def test_goto_valid_target_clean(make_dump):
    steps = [
        {"id": "root", "type": "sms", "name": "Root", "next": "g"},
        {"id": "g", "type": "goto", "name": "Go To", "parent": "root", "attributes": {"targetNodeId": "root"}},
    ]
    path = make_dump(workflows=[wf(steps=steps)])
    assert broken_goto.check(load_dump(path)) == []


# --- workflow_call_cycle ---
def test_call_cycle_detected(make_dump):
    a = {"type": "add_to_workflow", "name": "Add", "attributes": {"workflow_id": "B"}}
    b = {"type": "add_to_workflow", "name": "Add", "attributes": {"workflow_id": "A"}}
    path = make_dump(workflows=[wf(id="A", name="A", steps=[a]), wf(id="B", name="B", steps=[b])])
    f = workflow_call_cycle.check(load_dump(path))
    assert len(f) == 1 and f[0].severity == "WARN"
    assert "ciclo" in f[0].detail.lower()


def test_no_cycle_clean(make_dump):
    a = {"type": "add_to_workflow", "name": "Add", "attributes": {"workflow_id": "B"}}
    path = make_dump(workflows=[wf(id="A", name="A", steps=[a]), wf(id="B", name="B")])
    assert workflow_call_cycle.check(load_dump(path)) == []


# --- uncovered_condition ---
def test_uncovered_condition_flags_missing_else(make_dump):
    steps = [
        {"id": "c", "type": "if_else", "name": "Cond", "attributes": {"branches": [{"id": "b1", "name": "X"}]},
         "next": ["b1"]},
        {"id": "b1", "type": "if_else", "name": "X", "parent": "c", "attributes": {"if": []}},
    ]
    path = make_dump(workflows=[wf(steps=steps)])
    f = uncovered_condition.check(load_dump(path))
    assert len(f) == 1 and f[0].severity == "INFO"


def test_covered_condition_clean(make_dump):
    steps = [
        {"id": "c", "type": "if_else", "name": "Cond", "attributes": {"branches": [{"id": "b1", "name": "X"}]},
         "next": ["b1", "b2"]},
        {"id": "b1", "type": "if_else", "name": "X", "parent": "c", "attributes": {"if": []}},
        {"id": "b2", "type": "if_else", "name": "Else", "parent": "c", "attributes": {"else": []}},
    ]
    path = make_dump(workflows=[wf(steps=steps)])
    assert uncovered_condition.check(load_dump(path)) == []
