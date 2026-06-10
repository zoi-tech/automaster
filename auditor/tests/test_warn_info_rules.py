from automaster_audit.loader import load_dump
from automaster_audit.rules import dead_end_draft, naming_convention, no_trigger
from conftest import wf


# --- no_trigger (WARN) ---
def test_no_trigger_flags_published_without_trigger(make_dump):
    path = make_dump(workflows=[wf(status="published", triggers=[])])
    findings = no_trigger.check(load_dump(path))
    assert len(findings) == 1
    assert findings[0].severity == "WARN"


def test_no_trigger_clean_when_trigger_present(make_dump):
    path = make_dump(workflows=[wf(status="published", triggers=[{"id": "t1"}])])
    assert no_trigger.check(load_dump(path)) == []


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
