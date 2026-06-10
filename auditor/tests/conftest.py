"""Builder de dumps sintéticos para testes."""
from __future__ import annotations

import json
from pathlib import Path

import pytest


def _write(path: Path, data) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


@pytest.fixture
def make_dump(tmp_path):
    """Cria um dump mínimo no disco e devolve o caminho.

    Uso:
        path = make_dump(
            workflows=[{...envelope...}],
            tags=["follow-up"],
            pipelines=[{"id": "P1", "stages": [{"id": "S1"}]}],
            fields=[{"id": "F1"}],
            extracted_at="2026-06-10T00:00:00+00:00",
        )
    """

    def _build(workflows=None, tags=None, pipelines=None, fields=None, extracted_at="2026-06-10T00:00:00+00:00"):
        root = tmp_path / "dump"
        (root / "workflows").mkdir(parents=True)
        workflows = workflows or []
        for wf in workflows:
            _write(root / "workflows" / f"{wf['id']}.json", wf)
        _write(root / "pipelines.json", {"raw": {"pipelines": pipelines or []}})
        _write(root / "tags.json", {"raw": {"tags": [{"name": t} for t in (tags or [])]}})
        _write(root / "custom_fields.json", {"raw": {"customFields": fields or []}})
        _write(
            root / "manifest.json",
            {
                "schemaVersion": 1,
                "locationId": "TESTLOC",
                "extractedAt": extracted_at,
                "counts": {"workflows": len(workflows)},
                "warnings": [],
            },
        )
        return root

    return _build


def wf(id="wf1", name="[Solar] Compra → Boas-vindas", status="published", steps=None, triggers=None, updated_at=None):
    """Monta o envelope de um workflow."""
    detail = {}
    if updated_at:
        detail["updatedAt"] = updated_at
    return {
        "id": id,
        "name": name,
        "status": status,
        "fetchedAt": "2026-06-10T00:00:00+00:00",
        "raw": {
            "list_entry": {"id": id, "name": name, "status": status},
            "detail": detail,
            "steps": {"templates": steps or []},
            "triggers": triggers if triggers is not None else [{"id": "t1", "name": "Trigger"}],
        },
    }
