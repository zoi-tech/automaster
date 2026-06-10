"""Carrega um dump do disco e monta o contexto de auditoria.

Contrato do dump (gerado pelo extractor):

    <dump>/
      manifest.json                 {schemaVersion, locationId, counts, warnings, ...}
      workflows/<id>.json           {id, name, status, fetchedAt, raw:{list_entry,detail,steps,triggers}}
      pipelines.json                {fetchedAt, raw:<resposta API: {pipelines:[...]}>}
      tags.json                     {fetchedAt, raw:<resposta API: {tags:[...]}>}
      custom_fields.json            {fetchedAt, raw:<resposta API: {customFields:[...]}>}

As actions de cada workflow vivem em raw.steps.templates (baixadas do Firebase).
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from . import SCHEMA_VERSION


class DumpError(Exception):
    """Dump ausente, malformado ou de schema incompatível."""


def _read_json(path: Path) -> dict | list:
    if not path.exists():
        raise DumpError(f"arquivo ausente no dump: {path.name} ({path})")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise DumpError(f"JSON inválido em {path.name}: {e}") from e


@dataclass
class Workflow:
    id: str
    name: str
    status: str
    raw: dict

    @property
    def steps(self) -> list[dict]:
        return (self.raw.get("steps") or {}).get("templates", []) or []

    @property
    def triggers(self) -> list[dict]:
        trig = self.raw.get("triggers")
        return trig if isinstance(trig, list) else []

    @property
    def updated_at(self) -> str | None:
        return (self.raw.get("detail") or {}).get("updatedAt")


@dataclass
class DumpContext:
    path: Path
    manifest: dict
    workflows: list[Workflow]
    # lookup de entidades
    pipeline_ids: set[str] = field(default_factory=set)
    stage_ids: set[str] = field(default_factory=set)
    tag_names: set[str] = field(default_factory=set)  # lower-case
    field_ids: set[str] = field(default_factory=set)
    workflow_ids: set[str] = field(default_factory=set)

    def has_tag(self, name: str) -> bool:
        return name.strip().lower() in self.tag_names


def load_dump(path: Path) -> DumpContext:
    path = Path(path)
    if not path.is_dir():
        raise DumpError(f"pasta de dump não encontrada: {path}")

    manifest = _read_json(path / "manifest.json")
    if not isinstance(manifest, dict):
        raise DumpError("manifest.json deve ser um objeto")
    sv = manifest.get("schemaVersion")
    if sv != SCHEMA_VERSION:
        raise DumpError(
            f"schemaVersion incompatível: dump={sv!r}, auditor suporta={SCHEMA_VERSION}. "
            "Re-extraia o dump ou use uma versão compatível do auditor."
        )

    # workflows
    wf_dir = path / "workflows"
    if not wf_dir.is_dir():
        raise DumpError(f"pasta workflows/ ausente em {path}")
    workflows: list[Workflow] = []
    for wf_file in sorted(wf_dir.glob("*.json")):
        d = _read_json(wf_file)
        if not isinstance(d, dict):
            raise DumpError(f"{wf_file.name} deve ser um objeto")
        workflows.append(
            Workflow(
                id=d.get("id", wf_file.stem),
                name=d.get("name", ""),
                status=d.get("status", ""),
                raw=d.get("raw") or {},
            )
        )

    ctx = DumpContext(path=path, manifest=manifest, workflows=workflows)
    ctx.workflow_ids = {w.id for w in workflows}

    # entidades (envelope {raw: <resposta API>})
    pipelines = _entity_raw(path / "pipelines.json").get("pipelines", [])
    for p in pipelines:
        ctx.pipeline_ids.add(p.get("id"))
        for s in p.get("stages", []):
            ctx.stage_ids.add(s.get("id"))

    tags = _entity_raw(path / "tags.json").get("tags", [])
    ctx.tag_names = {t.get("name", "").strip().lower() for t in tags if t.get("name")}

    fields = _entity_raw(path / "custom_fields.json").get("customFields", [])
    for f in fields:
        fid = f.get("id") or f.get("_id")
        if fid:
            ctx.field_ids.add(fid)

    ctx.pipeline_ids.discard(None)
    ctx.stage_ids.discard(None)
    return ctx


def _entity_raw(path: Path) -> dict:
    """Lê um arquivo de entidade e devolve o payload `raw` (resposta intocada da API)."""
    d = _read_json(path)
    if isinstance(d, dict) and "raw" in d:
        raw = d["raw"]
        return raw if isinstance(raw, dict) else {}
    # tolera arquivo já no formato raw direto
    return d if isinstance(d, dict) else {}
