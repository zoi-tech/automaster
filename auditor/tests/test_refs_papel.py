"""Índice reverso com papel: tag citada só em trigger não é órfã."""
from automaster_audit.dashboard import build_dashboard
from automaster_audit.loader import load_dump
from conftest import wf


def _trigger_tag(tag):
    return {"id": "t1", "name": "Contact Tag", "type": "contact_tag",
            "conditions": [{"field": "tagsAdded", "operator": "index-of-true", "value": tag}]}


def _tags(d):
    return {t["name"]: t for t in d["tags"]}


def test_tag_only_in_trigger_is_not_orphan(make_dump):
    path = make_dump(workflows=[wf(triggers=[_trigger_tag("x")])], tags=["x"])
    t = _tags(build_dashboard(load_dump(path)))["x"]
    assert t["orphan"] is False
    assert t["papeis"] == ["dispara"]
    assert t["used_by"] == ["[Solar] Compra → Boas-vindas"]


def test_papeis_add_remove_condicao(make_dump):
    steps = [
        {"type": "add_contact_tag", "name": "Add", "attributes": {"tags": ["a"]}},
        {"type": "remove_contact_tag", "name": "Rm", "attributes": {"tags": ["b"]}},
        {"type": "if_else", "name": "If", "attributes": {"branches": [{"segments": [{"conditions": [
            {"conditionType": "contact_detail", "conditionSubType": "tags",
             "conditionOperator": "index-of-true", "conditionValue": ["c"]}]}]}]}},
    ]
    trig = {"id": "t1", "name": "Reply", "type": "customer_reply",
            "conditions": [{"field": "contact.tags", "operator": "index-of-true", "value": "d"}]}
    path = make_dump(workflows=[wf(steps=steps, triggers=[trig])], tags=["a", "b", "c", "d", "e"])
    tags = _tags(build_dashboard(load_dump(path)))
    assert tags["a"]["papeis"] == ["adiciona"]
    assert tags["b"]["papeis"] == ["remove"]
    assert tags["c"]["papeis"] == ["condicao"]
    assert tags["d"]["papeis"] == ["condicao"]
    assert tags["e"]["papeis"] == [] and tags["e"]["orphan"] is True
