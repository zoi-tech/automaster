from automaster_audit.loader import load_dump
from automaster_audit.rules import broken_pipeline_ref
from conftest import wf

PIPELINES = [{"id": "P1", "stages": [{"id": "S1"}, {"id": "S2"}]}]


def test_flags_missing_pipeline_in_find_opportunity(make_dump):
    step = {
        "type": "find_opportunity",
        "name": "Find Opp",
        "attributes": {"__customInputFields__": [{"filterField": "pipeline_id", "secondValue": "GHOST"}]},
    }
    path = make_dump(workflows=[wf(steps=[step])], pipelines=PIPELINES)
    findings = broken_pipeline_ref.check(load_dump(path))
    assert len(findings) == 1
    assert findings[0].rule == "broken_pipeline_ref"
    assert findings[0].severity == "ERROR"


def test_flags_missing_stage_in_create_opportunity(make_dump):
    step = {
        "type": "internal_create_opportunity",
        "name": "Create Opp",
        "attributes": {
            "pipelineId": "P1",
            "__customInputFields__": [{"filterField": "pipelineStageId", "value": "GHOST_STAGE"}],
        },
    }
    path = make_dump(workflows=[wf(steps=[step])], pipelines=PIPELINES)
    findings = broken_pipeline_ref.check(load_dump(path))
    assert len(findings) == 1
    assert "stage" in findings[0].detail


def test_clean_when_refs_exist(make_dump):
    step = {
        "type": "internal_create_opportunity",
        "name": "Create Opp",
        "attributes": {
            "pipelineId": "P1",
            "__customInputFields__": [{"filterField": "pipelineStageId", "value": "S1"}],
        },
    }
    path = make_dump(workflows=[wf(steps=[step])], pipelines=PIPELINES)
    assert broken_pipeline_ref.check(load_dump(path)) == []
