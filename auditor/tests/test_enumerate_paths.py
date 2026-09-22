"""Testes da Camada 2: enumeração de caminhos de execução."""
from conftest import wf

from automaster_audit.flow import enumerate_paths
from automaster_audit.loader import load_dump


def _wf(make_dump, steps):
    path = make_dump(workflows=[wf(steps=steps)])
    return load_dump(path).workflows[0]


def test_linear_three_steps_one_path(make_dump):
    steps = [
        {"id": "root", "type": "sms", "name": "Root", "next": "s2"},
        {"id": "s2", "type": "wait", "name": "Wait", "parent": "root", "next": "s3"},
        {"id": "s3", "type": "sms", "name": "Fim", "parent": "s2"},
    ]
    paths, truncated = enumerate_paths(_wf(make_dump, steps))
    assert truncated is False
    assert len(paths) == 1
    assert paths[0].steps == [("root", None), ("s2", None), ("s3", None)]
    assert paths[0].terminal == "exit"


def test_if_else_two_branches_two_labeled_paths(make_dump):
    steps = [
        {"id": "c", "type": "if_else", "name": "Cond",
         "attributes": {"branches": [{"id": "b1", "name": "VIP"}]}, "next": ["b1", "b2"]},
        {"id": "b1", "type": "if_else", "name": "VIP", "parent": "c", "attributes": {"if": []}, "next": "a1"},
        {"id": "b2", "type": "if_else", "name": "Else", "parent": "c", "attributes": {"else": []}, "next": "a2"},
        {"id": "a1", "type": "sms", "name": "SMS VIP", "parent": "b1"},
        {"id": "a2", "type": "sms", "name": "SMS Else", "parent": "b2"},
    ]
    paths, truncated = enumerate_paths(_wf(make_dump, steps))
    assert truncated is False
    assert len(paths) == 2
    assert {p.steps[1] for p in paths} == {("b1", "VIP"), ("b2", "ELSE")}
    assert all(p.terminal == "exit" for p in paths)


def test_find_opportunity_transitions_labeled(make_dump):
    steps = [
        {"id": "f", "type": "find_opportunity", "name": "Find", "attributes": {}, "next": ["t1", "t2"]},
        {"id": "t1", "type": "transition", "name": "Opportunity Found", "parent": "f", "next": "a1"},
        {"id": "t2", "type": "transition", "name": "Opportunity Not Found", "parent": "f"},
        {"id": "a1", "type": "sms", "name": "SMS", "parent": "t1"},
    ]
    paths, truncated = enumerate_paths(_wf(make_dump, steps))
    assert truncated is False
    assert len(paths) == 2
    assert {p.steps[1][1] for p in paths} == {"Opportunity Found", "Opportunity Not Found"}


def test_goto_loop_cuts_without_infinite_recursion(make_dump):
    steps = [
        {"id": "root", "type": "sms", "name": "Root", "next": "g"},
        {"id": "g", "type": "goto", "name": "Go To", "parent": "root",
         "attributes": {"targetNodeId": "root"}},
    ]
    paths, truncated = enumerate_paths(_wf(make_dump, steps))
    assert truncated is False
    assert len(paths) == 1
    assert paths[0].steps == [("root", None), ("g", None)]
    assert paths[0].terminal == "loop → root"


def test_cap_truncates(make_dump):
    steps = [
        {"id": "c", "type": "if_else", "name": "Cond",
         "attributes": {"branches": [{"id": f"b{i}", "name": f"R{i}"} for i in (1, 2, 3)]},
         "next": ["b1", "b2", "b3"]},
        {"id": "b1", "type": "if_else", "name": "R1", "parent": "c", "attributes": {"if": []}},
        {"id": "b2", "type": "if_else", "name": "R2", "parent": "c", "attributes": {"if": []}},
        {"id": "b3", "type": "if_else", "name": "R3", "parent": "c", "attributes": {"if": []}},
    ]
    paths, truncated = enumerate_paths(_wf(make_dump, steps), cap=2)
    assert truncated is True
    assert len(paths) == 2


def test_empty_branch_exits_without_exception(make_dump):
    steps = [
        {"id": "c", "type": "if_else", "name": "Cond",
         "attributes": {"branches": [{"id": "b1", "name": "X"}]}, "next": ["b1"]},
        {"id": "b1", "type": "if_else", "name": "X", "parent": "c", "attributes": {"if": []}, "next": None},
    ]
    paths, truncated = enumerate_paths(_wf(make_dump, steps))
    assert truncated is False
    assert len(paths) == 1
    assert paths[0].steps == [("c", None), ("b1", "X")]
    assert paths[0].terminal == "exit"
