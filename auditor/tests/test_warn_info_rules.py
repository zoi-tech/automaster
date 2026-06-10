from automaster_audit.loader import load_dump
from automaster_audit.rules import dead_end_draft, naming_convention, workflow_unreachable
from conftest import wf

STEP = {"type": "sms", "name": "SMS", "attributes": {}}


# --- workflow_unreachable ---
def test_unreachable_warn_for_empty_workflow(make_dump):
    # sem trigger, sem chamada, 0 steps → WARN (morto)
    path = make_dump(workflows=[wf(triggers=[], steps=[])])
    findings = workflow_unreachable.check(load_dump(path))
    assert len(findings) == 1
    assert findings[0].severity == "WARN"


def test_unreachable_info_for_manual_candidate(make_dump):
    # sem trigger, sem chamada, com steps → INFO (provável manual)
    path = make_dump(workflows=[wf(triggers=[], steps=[STEP])])
    findings = workflow_unreachable.check(load_dump(path))
    assert len(findings) == 1
    assert findings[0].severity == "INFO"


def test_unreachable_clean_when_has_trigger(make_dump):
    path = make_dump(workflows=[wf(triggers=[{"id": "t1"}], steps=[])])
    assert workflow_unreachable.check(load_dump(path)) == []


def test_unreachable_clean_when_called_by_another(make_dump):
    # 'sub' não tem trigger mas é chamado por 'caller' via add_to_workflow → OK
    caller_step = {"type": "add_to_workflow", "name": "Add", "attributes": {"workflow_id": "sub"}}
    path = make_dump(
        workflows=[
            wf(id="caller", triggers=[{"id": "t1"}], steps=[caller_step]),
            wf(id="sub", triggers=[], steps=[STEP]),
        ]
    )
    findings = workflow_unreachable.check(load_dump(path))
    assert all(f.workflow_id != "sub" for f in findings)


# --- naming_convention (INFO) ---
def test_naming_flags_bad_name(make_dump):
    path = make_dump(workflows=[wf(name="1A - Fluxo qualquer")])
    findings = naming_convention.check(load_dump(path))
    assert len(findings) == 1
    assert findings[0].severity == "INFO"


def test_naming_clean_for_zoi_pattern(make_dump):
    path = make_dump(workflows=[wf(name="[Solar] Compra aprovada → Boas-vindas")])
    assert naming_convention.check(load_dump(path)) == []


# --- dead_end_draft (INFO) ---
def test_dead_end_flags_old_draft(make_dump):
    path = make_dump(
        workflows=[wf(status="draft", updated_at="2026-01-01T00:00:00+00:00")],
        extracted_at="2026-06-10T00:00:00+00:00",  # >90 dias depois
    )
    findings = dead_end_draft.check(load_dump(path))
    assert len(findings) == 1
    assert findings[0].severity == "INFO"


def test_dead_end_clean_for_recent_draft(make_dump):
    path = make_dump(
        workflows=[wf(status="draft", updated_at="2026-06-01T00:00:00+00:00")],
        extracted_at="2026-06-10T00:00:00+00:00",  # <90 dias
    )
    assert dead_end_draft.check(load_dump(path)) == []
