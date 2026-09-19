"""Builder de dumps sintéticos para testes."""
from __future__ import annotations

import json
from itertools import count
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

    contador = count()

    def _build(workflows=None, tags=None, pipelines=None, fields=None,
               users=None, custom_values=None, calendars=None,
               extracted_at="2026-06-10T00:00:00+00:00"):
        # sufixo por chamada: o diff precisa de dois dumps no mesmo tmp_path
        n = next(contador)
        root = tmp_path / ("dump" if n == 0 else f"dump{n}")
        (root / "workflows").mkdir(parents=True)
        workflows = workflows or []
        for wf in workflows:
            _write(root / "workflows" / f"{wf['id']}.json", wf)
        _write(root / "pipelines.json", {"raw": {"pipelines": pipelines or []}})
        _write(root / "tags.json", {"raw": {"tags": [{"name": t} for t in (tags or [])]}})
        _write(root / "custom_fields.json", {"raw": {"customFields": fields or []}})
        if users is not None:
            _write(root / "users.json", {"raw": {"users": users}})
        if custom_values is not None:
            _write(root / "custom_values.json", {"raw": {"customValues": custom_values}})
        if calendars is not None:
            _write(root / "calendars.json", {"raw": {"calendars": calendars}})
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


def trig(ttype, target_wf, name="T", conditions=None, active=True, deleted=False, tid="tr1"):
    """Trigger com o shape real do dump (actions = add_to_workflow)."""
    return {
        "id": tid, "type": ttype, "name": name, "active": active, "deleted": deleted,
        "workflow_id": target_wf,
        "actions": [{"workflow_id": target_wf, "type": "add_to_workflow"}],
        "conditions": conditions or [],
    }


def tag_cond(value):
    return {"operator": "index-of-true", "id": "tag-added", "value": value,
            "title": "Tag Added", "type": "select", "field": "tagsAdded"}


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
