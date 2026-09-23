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

import copy
import json
import re
from dataclasses import dataclass, field
from pathlib import Path

from . import SCHEMA_VERSION
from .dump_schema import validar_dump


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
    email_templates: list[dict] = field(default_factory=list)
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

    problemas = validar_dump(path)
    if problemas:
        mostra = "\n  ".join(problemas[:5])
        resto = f"\n  (+{len(problemas) - 5} outro(s))" if len(problemas) > 5 else ""
        raise DumpError(
            f"dump fora do contrato de formato (dump_schema.json):\n  {mostra}{resto}\n"
            "Re-extraia a subconta; se o formato do extractor mudou de propósito, atualize "
            "dump_schema.json e o loader juntos."
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
    _aplicar_pipelines(ctx, _entity_raw(path / "pipelines.json"))
    _aplicar_tags(ctx, _entity_raw(path / "tags.json"))
    _aplicar_fields(ctx, _entity_raw(path / "custom_fields.json"))

    # entidades opcionais (ausentes em dumps anteriores ao schema com users/etc)
    _aplicar_users(ctx, _entity_raw_optional(path / "users.json"))
    ctx.calendars = _entity_raw_optional(path / "calendars.json").get("calendars", [])
    _aplicar_custom_values(ctx, _entity_raw_optional(path / "custom_values.json"))

    _load_templates(ctx, path)
    _load_forms(ctx, path)

    return ctx


def _aplicar_pipelines(ctx: DumpContext, raw: dict) -> None:
    ids, stages, nomes, nomes_stage = set(), set(), {}, {}
    for p in raw.get("pipelines", []):
        if p.get("id"):
            ids.add(p["id"])
            nomes[p["id"]] = p.get("name", p["id"])
        for s in p.get("stages", []):
            if s.get("id"):
                stages.add(s["id"])
                nomes_stage[s["id"]] = s.get("name", s["id"])
    ctx.pipeline_ids, ctx.stage_ids, ctx.pipeline_names, ctx.stage_names = ids, stages, nomes, nomes_stage


def _aplicar_tags(ctx: DumpContext, raw: dict) -> None:
    ctx.tag_names = {t.get("name", "").strip().lower() for t in raw.get("tags", []) if t.get("name")}


def _aplicar_fields(ctx: DumpContext, raw: dict) -> None:
    ids, nomes = set(), {}
    for f in raw.get("customFields", []):
        fid = f.get("id") or f.get("_id")
        if fid:
            ids.add(fid)
            nomes[fid] = f.get("name", fid)
    ctx.field_ids, ctx.field_names = ids, nomes


def _aplicar_users(ctx: DumpContext, raw: dict) -> None:
    users = raw.get("users", [])
    ids, nomes, apagados = set(), {}, set()
    for u in users:
        uid = u.get("id") or u.get("_id")
        if uid:
            ids.add(uid)
            nomes[uid] = u.get("name") or f"{u.get('firstName', '')} {u.get('lastName', '')}".strip() or uid
            if u.get("deleted"):
                apagados.add(uid)
    ctx.users, ctx.user_ids, ctx.user_names, ctx.user_deleted = users, ids, nomes, apagados


def _aplicar_custom_values(ctx: DumpContext, raw: dict) -> None:
    cvs = raw.get("customValues", [])
    ctx.custom_values = cvs
    ctx.cv_keys = {k for cv in cvs for k in _cv_keys(cv)}


def _aplicar_lista_workflows(ctx: DumpContext, lista: list) -> None:
    """Lista ao vivo (`ListEntry[]`): só ids e nomes. O corpo de cada workflow continua do dump."""
    ids = {w.get("_id") or w.get("id") for w in lista} - {None}
    ctx.workflow_ids = ids | {w.id for w in ctx.workflows}
    ctx.workflow_names = {
        **ctx.workflow_names,
        **{(w.get("_id") or w.get("id")): w.get("name", "") for w in lista if (w.get("_id") or w.get("id"))},
    }


_SOBREPOSICAO = {
    "pipelines": _aplicar_pipelines,
    "tags": _aplicar_tags,
    "custom_fields": _aplicar_fields,
    "users": _aplicar_users,
    "custom_values": _aplicar_custom_values,
    "workflows": _aplicar_lista_workflows,
}


def sobrepor_entidades(ctx: DumpContext, entidades: dict) -> DumpContext:
    """Cópia rasa do ctx com as listas lidas AO VIVO no lugar das do dump.

    Entidade criada depois da extração não pode virar referência quebrada na validação de
    escrita. Chave ausente em `entidades` (rota que falhou) mantém a lista do dump.
    """
    novo = copy.copy(ctx)
    for chave, aplicar in _SOBREPOSICAO.items():
        if chave in entidades and entidades[chave] is not None:
            aplicar(novo, entidades[chave])
    return novo


def _load_templates(ctx: DumpContext, path: Path) -> None:
    """Preenche template_ids por canal a partir das 3 listas (todas opcionais).

    `message` cobre SMS e os canais que dividem a mesma coleção (um template de
    step `instagram-dm` vem de lá com type `sms`).
    """
    arquivos = {
        "message": path / "message_templates.json",
        "whatsapp": path / "whatsapp_templates.json",
        "email": path / "email_templates.json",
    }
    msgs = _entity_raw_optional(arquivos["message"]).get("templates", []) or []
    # a resposta de WhatsApp é uma lista, não um objeto — _entity_raw a descartaria
    wa_file = arquivos["whatsapp"]
    wa_raw = _read_json(wa_file).get("raw") if wa_file.exists() else None
    if isinstance(wa_raw, dict):
        wa_raw = wa_raw.get("templates")
    was = wa_raw if isinstance(wa_raw, list) else []

    # `builders` traz pastas junto; pasta não é template e não pode virar achado.
    builders = _entity_raw_optional(arquivos["email"]).get("builders", []) or []
    emails = [b for b in builders if b.get("templateType") != "folder"]
    ctx.email_templates = emails

    for canal, itens in (("message", msgs), ("whatsapp", was), ("email", emails)):
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
