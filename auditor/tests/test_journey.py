"""Testes do motor da árvore de jornada do contato."""
from automaster_audit.journey import TriggerIndex
from automaster_audit.loader import load_dump
from conftest import wf


def trig(ttype, target_wf, name="T", conditions=None, active=True, deleted=False, tid="tr1"):
    """Trigger com o shape real do dump (actions = add_to_workflow)."""
    return {
        "id": tid, "type": ttype, "name": name, "active": active, "deleted": deleted,
        "workflow_id": target_wf,
        "actions": [{"workflow_id": target_wf, "type": "add_to_workflow"}],
        "conditions": conditions or [],
    }


def tag_cond(value):
    return {"operator": "index-of-true", "id": "tag-added", "value": value,
            "title": "Tag Added", "type": "select", "field": "tagsAdded"}


def test_trigger_index_groups_by_type_and_respects_inactive(make_dump):
    t1 = trig("contact_created", "a", tid="t1")
    t2 = trig("contact_tag", "a", conditions=[tag_cond("quente")], tid="t2")
    t3 = trig("contact_created", "a", active=False, tid="t3")
    t4 = trig("contact_created", "a", deleted=True, tid="t4")
    path = make_dump(workflows=[wf(id="a", triggers=[t1, t2, t3, t4])])
    idx = TriggerIndex(load_dump(path))
    created = idx.of_type("contact_created")
    # deleted some; inactive fica com flag
    assert len(created) == 2
    assert {t["id"] for t in created} == {"t1", "t3"}
    inactive = next(t for t in created if t["id"] == "t3")
    assert inactive["active"] is False
    assert len(idx.of_type("contact_tag")) == 1


def test_for_tag_matches_condition_value_case_insensitive(make_dump):
    t = trig("contact_tag", "a", conditions=[tag_cond("Quente")])
    any_tag = trig("contact_tag", "b", tid="t-any")  # sem condição de tag = qualquer tag
    path = make_dump(workflows=[wf(id="a", triggers=[t]), wf(id="b", triggers=[any_tag])])
    idx = TriggerIndex(load_dump(path))
    hits = idx.for_tag("quente")
    assert {h["id"] for h in hits} == {"tr1", "t-any"}
    assert idx.for_tag("frio") and idx.for_tag("frio")[0]["id"] == "t-any"


def test_unknown_trigger_type_counted_not_crashed(make_dump):
    t = trig("form_submitted", "a", tid="t-x")
    path = make_dump(workflows=[wf(id="a", triggers=[t])])
    idx = TriggerIndex(load_dump(path))
    assert idx.ignored.get("form_submitted") == 1
