from conftest import wf

from automaster_audit.loader import load_dump
from automaster_audit.rules import broken_field_ref


def test_flags_missing_field(make_dump):
    step = {
        "type": "update_contact_field",
        "name": "Update field",
        "attributes": {"fields": [{"field": "GHOST", "title": "Campo X"}]},
    }
    path = make_dump(workflows=[wf(steps=[step])], fields=[{"id": "F1"}])
    findings = broken_field_ref.check(load_dump(path))
    assert len(findings) == 1
    assert findings[0].rule == "broken_field_ref"
    assert findings[0].severity == "ERROR"


def test_clean_when_field_exists(make_dump):
    step = {
        "type": "update_contact_field",
        "name": "Update field",
        "attributes": {"fields": [{"field": "F1", "title": "Campo X"}]},
    }
    path = make_dump(workflows=[wf(steps=[step])], fields=[{"id": "F1"}])
    assert broken_field_ref.check(load_dump(path)) == []
