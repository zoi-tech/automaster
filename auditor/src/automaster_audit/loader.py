"""Carrega um dump do disco e monta o contexto de auditoria.

Contrato do dump (gerado pelo extractor):

    <dump>/
      manifest.json                 {schemaVersion, locationId, counts, warnings, ...}
      workflows/<id>.json           {id, name, status, fetchedAt, raw:{list_entry,detail,steps,triggers}}
      pipelines.json                {fetchedAt, raw:<resposta API: {pipelines:[...]}>}
      tags.json                     {fetchedAt, raw:<resposta API: {tags:[...]}>}
      custom_fields.json            {fetchedAt, raw:<resposta API: {customFields:[...]}>}
      message_templates.json        {fetchedAt, raw:{templates:[...]}}   (opcional)
      whatsapp_templates.json       {fetchedAt, raw:[...]}               (opcional)
      forms.json                    {fetchedAt, raw:{forms:[...],total:n}}   (opcional)
      surveys.json                  {fetchedAt, raw:{surveys:[...],total:n}} (opcional)

As actions de cada workflow vivem em raw.steps.templates (baixadas do Firebase).
"""
from __future__ import annotations

import json
import re
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
    # nomes legíveis (id -> nome), para rótulos de grafo/relatório
    pipeline_names: dict[str, str] = field(default_factory=dict)
    stage_names: dict[str, str] = field(default_factory=dict)
    field_names: dict[str, str] = field(default_factory=dict)
    workflow_names: dict[str, str] = field(default_factory=dict)
    # usuários, calendários, custom values (podem faltar em dumps antigos)
    user_ids: set[str] = field(default_factory=set)
    user_names: dict[str, str] = field(default_factory=dict)
    user_deleted: set[str] = field(default_factory=set)
    cv_keys: set[str] = field(default_factory=set)  # chaves custom_values, lower-case
    # templates por canal (ausentes em dumps anteriores; lista vazia = regra no-op)
    template_ids: dict[str, set[str]] = field(default_factory=dict)
    template_names: dict[str, str] = field(default_factory=dict)
    # formulários e surveys (ausentes em dumps anteriores; chave ausente = regra no-op)
    form_ids: dict[str, set[str]] = field(default_factory=dict)
    form_names: dict[str, str] = field(default_factory=dict)
    users: list[dict] = field(default_factory=list)
    calendars: list[dict] = field(default_factory=list)
    custom_values: list[dict] = field(default_factory=list)

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
    ctx.workflow_names = {w.id: w.name for w in workflows}

    # entidades (envelope {raw: <resposta API>})
    pipelines = _entity_raw(path / "pipelines.json").get("pipelines", [])
    for p in pipelines:
        ctx.pipeline_ids.add(p.get("id"))
        if p.get("id"):
            ctx.pipeline_names[p["id"]] = p.get("name", p["id"])
        for s in p.get("stages", []):
            ctx.stage_ids.add(s.get("id"))
            if s.get("id"):
                ctx.stage_names[s["id"]] = s.get("name", s["id"])

    tags = _entity_raw(path / "tags.json").get("tags", [])
    ctx.tag_names = {t.get("name", "").strip().lower() for t in tags if t.get("name")}

    fields = _entity_raw(path / "custom_fields.json").get("customFields", [])
    for f in fields:
        fid = f.get("id") or f.get("_id")
        if fid:
            ctx.field_ids.add(fid)
            ctx.field_names[fid] = f.get("name", fid)

    # entidades opcionais (ausentes em dumps anteriores ao schema com users/etc)
    users = _entity_raw_optional(path / "users.json").get("users", [])
    ctx.users = users
    for u in users:
        uid = u.get("id") or u.get("_id")
        if uid:
            ctx.user_ids.add(uid)
            ctx.user_names[uid] = u.get("name") or f"{u.get('firstName','')} {u.get('lastName','')}".strip() or uid
            if u.get("deleted"):
                ctx.user_deleted.add(uid)

    ctx.calendars = _entity_raw_optional(path / "calendars.json").get("calendars", [])

    cvs = _entity_raw_optional(path / "custom_values.json").get("customValues", [])
    ctx.custom_values = cvs
    for cv in cvs:
        for key in _cv_keys(cv):
            ctx.cv_keys.add(key)

    _load_templates(ctx, path)
    _load_forms(ctx, path)

    ctx.pipeline_ids.discard(None)
    ctx.stage_ids.discard(None)
    return ctx


def _load_templates(ctx: DumpContext, path: Path) -> None:
    """Preenche template_ids por canal a partir das 3 listas (todas opcionais).

    `message` cobre SMS e os canais que dividem a mesma coleção (um template de
    step `instagram-dm` vem de lá com type `sms`).
    """
    arquivos = {
        "message": path / "message_templates.json",
        "whatsapp": path / "whatsapp_templates.json",
    }
    msgs = _entity_raw_optional(arquivos["message"]).get("templates", []) or []
    # a resposta de WhatsApp é uma lista, não um objeto — _entity_raw a descartaria
    wa_file = arquivos["whatsapp"]
    wa_raw = _read_json(wa_file).get("raw") if wa_file.exists() else None
    if isinstance(wa_raw, dict):
        wa_raw = wa_raw.get("templates")
    was = wa_raw if isinstance(wa_raw, list) else []

    for canal, itens in (("message", msgs), ("whatsapp", was)):
        if not arquivos[canal].exists():
            continue  # canal ausente do dump: fica fora do template_ids (≠ lista vazia)
        ids = set()
        for t in itens:
            tid = t.get("id") or t.get("_id")
            if tid:
                ids.add(str(tid))
                ctx.template_names[str(tid)] = t.get("name", str(tid))
        ctx.template_ids[canal] = ids


def _load_forms(ctx: DumpContext, path: Path) -> None:
    """Preenche form_ids com as chaves 'form' e 'survey' (as duas listas são opcionais).

    Chave ausente = lista ausente do dump, e a regra que depende dela fica no-op.
    Pasta não aparece nessas listas: o servidor só a devolve com `type=folder`.
    """
    for chave, arquivo, campo in (
        ("form", path / "forms.json", "forms"),
        ("survey", path / "surveys.json", "surveys"),
    ):
        if not arquivo.exists():
            continue
        ids = set()
        for item in _entity_raw_optional(arquivo).get(campo, []) or []:
            fid = item.get("id") or item.get("_id")
            if fid:
                ids.add(str(fid))
                ctx.form_names[str(fid)] = item.get("name", str(fid))
        ctx.form_ids[chave] = ids


_CV_TOKEN = re.compile(r"custom_values\.([a-zA-Z0-9_]+)")


def _cv_keys(cv: dict) -> set[str]:
    """Extrai as chaves custom_values de um registro (do fieldKey/name), lower-case."""
    keys: set[str] = set()
    fk = cv.get("fieldKey", "") or ""
    keys.update(m.lower() for m in _CV_TOKEN.findall(fk))
    if not keys:
        # fallback: fieldKey/name simples (sem template)
        bare = (fk or cv.get("name", "")).strip().lower()
        if bare:
            keys.add(bare)
    return keys


def _entity_raw_optional(path: Path) -> dict:
    """Como _entity_raw, mas devolve {} se o arquivo não existir (compat dumps antigos)."""
    if not path.exists():
        return {}
    return _entity_raw(path)


def _entity_raw(path: Path) -> dict:
    """Lê um arquivo de entidade e devolve o payload `raw` (resposta intocada da API)."""
    d = _read_json(path)
    if isinstance(d, dict) and "raw" in d:
        raw = d["raw"]
        return raw if isinstance(raw, dict) else {}
    # tolera arquivo já no formato raw direto
    return d if isinstance(d, dict) else {}
