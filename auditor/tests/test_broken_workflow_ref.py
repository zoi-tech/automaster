from conftest import wf

from automaster_audit.loader import load_dump
from automaster_audit.rules import broken_workflow_ref


def test_flags_missing_target(make_dump):
    step = {"type": "add_to_workflow", "name": "Add to WF", "attributes": {"workflow_id": "GHOST"}}
    path = make_dump(workflows=[wf(id="wf1", steps=[step])])
    findings = broken_workflow_ref.check(load_dump(path))
    assert len(findings) == 1
    assert findings[0].rule == "broken_workflow_ref"
    assert findings[0].severity == "ERROR"


def test_clean_when_target_exists(make_dump):
    step = {"type": "add_to_workflow", "name": "Add to WF", "attributes": {"workflow_id": "wf2"}}
    path = make_dump(workflows=[wf(id="wf1", steps=[step]), wf(id="wf2", name="[Solar] X → Y")])
    assert broken_workflow_ref.check(load_dump(path)) == []
