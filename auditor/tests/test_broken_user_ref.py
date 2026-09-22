from conftest import wf

from automaster_audit.loader import load_dump
from automaster_audit.rules import broken_user_ref

USERS = [
    {"id": "u1", "name": "Ativo Um", "deleted": False},
    {"id": "u2", "name": "Deletado Dois", "deleted": True},
]


def test_flags_missing_user_in_assign(make_dump):
    step = {"type": "assign_user", "name": "Assign", "attributes": {"traffic_weightage": {"GHOST": 1}}}
    path = make_dump(workflows=[wf(steps=[step])], users=USERS)
    findings = broken_user_ref.check(load_dump(path))
    assert len(findings) == 1
    assert findings[0].rule == "broken_user_ref"
    assert "inexistente" in findings[0].detail


def test_flags_deleted_user_in_notification(make_dump):
    step = {"type": "internal_notification", "name": "Notify",
            "attributes": {"sms": {"userType": "user", "selectedUser": ["u2"]}}}
    path = make_dump(workflows=[wf(steps=[step])], users=USERS)
    findings = broken_user_ref.check(load_dump(path))
    assert len(findings) == 1
    assert "desativado" in findings[0].detail


def test_clean_when_user_active(make_dump):
    step = {"type": "assign_user", "name": "Assign",
            "attributes": {"traffic_weightage": {"u1": 1}, "traffic_index": [{"id": "u1", "indexes": [1]}]}}
    path = make_dump(workflows=[wf(steps=[step])], users=USERS)
    assert broken_user_ref.check(load_dump(path)) == []


def test_noop_when_users_not_extracted(make_dump):
    # dump sem users.json → regra não roda (sem falso positivo)
    step = {"type": "assign_user", "name": "Assign", "attributes": {"traffic_weightage": {"GHOST": 1}}}
    path = make_dump(workflows=[wf(steps=[step])])
    assert broken_user_ref.check(load_dump(path)) == []
