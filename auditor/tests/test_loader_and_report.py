import json

import pytest
from conftest import wf

from automaster_audit import rules
from automaster_audit.loader import DumpError, load_dump, sobrepor_entidades
from automaster_audit.report import write_reports


def test_loader_rejects_bad_schema_version(make_dump):
    path = make_dump(workflows=[wf()])
    manifest = path / "manifest.json"
    data = json.loads(manifest.read_text())
    data["schemaVersion"] = 99
    manifest.write_text(json.dumps(data))
    with pytest.raises(DumpError, match="schemaVersion"):
        load_dump(path)


def test_sobrepor_troca_so_as_listas_presentes(make_dump):
    ctx = load_dump(make_dump(workflows=[wf(id="w1")], tags=["velha"]))
    novo = sobrepor_entidades(
        ctx,
        {
            "tags": {"tags": [{"name": "Nova"}]},
            "users": {"users": [{"id": "U1", "name": "Luana"}, {"id": "U2", "name": "X", "deleted": True}]},
            "workflows": [{"_id": "w9", "name": "Recém-criado"}],
        },
    )
    assert novo.has_tag("nova") and not novo.has_tag("velha")
    assert novo.user_ids == {"U1", "U2"} and novo.user_deleted == {"U2"}
    assert "w9" in novo.workflow_ids and novo.workflow_names["w9"] == "Recém-criado"
    assert ctx.has_tag("velha"), "o contexto original não muda"
    assert novo.field_ids == ctx.field_ids, "lista ausente fica a do dump"


def test_loader_rejects_missing_dir(tmp_path):
    with pytest.raises(DumpError):
        load_dump(tmp_path / "inexistente")


def test_write_reports_creates_both_files(make_dump):
    step = {"type": "add_contact_tag", "name": "Add", "attributes": {"tags": ["ghost"]}}
    path = make_dump(workflows=[wf(steps=[step])], tags=[])
    ctx = load_dump(path)
    findings = rules.run_all(ctx)
    md_path, json_path = write_reports(ctx, findings, path)
    assert md_path.exists() and json_path.exists()
    assert "Relatório de auditoria" in md_path.read_text(encoding="utf-8")
    parsed = json.loads(json_path.read_text(encoding="utf-8"))
    assert any(f["rule"] == "broken_tag_ref" for f in parsed)
