from automaster_audit.loader import load_dump
from automaster_audit.rules import broken_custom_value_ref
from conftest import wf

CVS = [{"id": "c1", "name": "Estoque", "fieldKey": "{{ custom_values.estoque }}", "value": "X"}]


def test_flags_unknown_custom_value(make_dump):
    step = {"type": "sms", "name": "SMS", "attributes": {"body": "Temos {{custom_values.fantasma}} unidades"}}
    path = make_dump(workflows=[wf(steps=[step])], custom_values=CVS)
    findings = broken_custom_value_ref.check(load_dump(path))
    assert len(findings) == 1
    assert "fantasma" in findings[0].detail


def test_clean_when_custom_value_exists(make_dump):
    step = {"type": "sms", "name": "SMS", "attributes": {"body": "Temos {{ custom_values.estoque }} unidades"}}
    path = make_dump(workflows=[wf(steps=[step])], custom_values=CVS)
    assert broken_custom_value_ref.check(load_dump(path)) == []


def test_noop_when_custom_values_not_extracted(make_dump):
    step = {"type": "sms", "name": "SMS", "attributes": {"body": "{{custom_values.qualquer}}"}}
    path = make_dump(workflows=[wf(steps=[step])])
    assert broken_custom_value_ref.check(load_dump(path)) == []
