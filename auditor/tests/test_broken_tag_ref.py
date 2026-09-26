from conftest import wf

from automaster_audit.loader import load_dump
from automaster_audit.rules import broken_tag_ref


def test_flags_missing_tag(make_dump):
    step = {"type": "add_contact_tag", "name": "Add Tag", "attributes": {"tags": ["inexistente"]}}
    path = make_dump(workflows=[wf(steps=[step])], tags=["follow-up"])
    findings = broken_tag_ref.check(load_dump(path))
    assert len(findings) == 1
    assert findings[0].rule == "broken_tag_ref"
    assert findings[0].severity == "ERROR"


def test_clean_when_tag_exists(make_dump):
    step = {"type": "add_contact_tag", "name": "Add Tag", "attributes": {"tags": ["Follow-Up"]}}
    path = make_dump(workflows=[wf(steps=[step])], tags=["follow-up"])  # case-insensitive
    assert broken_tag_ref.check(load_dump(path)) == []
