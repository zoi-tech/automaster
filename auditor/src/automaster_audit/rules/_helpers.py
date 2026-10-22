"""Utilitários compartilhados pelas regras."""

from __future__ import annotations

import re
from collections.abc import Iterator
from urllib.parse import unquote

from ..flow import enumerate_paths, index_steps
from ..loader import DumpContext, Workflow

# passos que mandam mensagem ao cliente
MENSAGEM_AO_CLIENTE = {"sms", "whatsapp_v2", "email"}

GATILHOS_OPORTUNIDADE = {
    "opportunity_created",
    "opportunity_status_changed",
    "pipeline_stage_updated",
    "opportunity_decay",
    "opportunity_changed",
}


def steps_of_type(ctx: DumpContext, *types: str) -> Iterator[tuple[Workflow, dict]]:
    """Itera (workflow, step) para cada step cujo `type` está em `types`."""
    wanted = set(types)
    for wf in ctx.workflows:
        for step in wf.steps:
            if step.get("type") in wanted:
                yield wf, step


def add_to_workflow_targets(ctx: DumpContext) -> set[str]:
    """Ids de workflows que são alvo de algum step add_to_workflow (são chamados)."""
    targets: set[str] = set()
    for _wf, step in steps_of_type(ctx, "add_to_workflow"):
        tid = step.get("attributes", {}).get("workflow_id")
        if tid:
            targets.add(tid)
    return targets


# O id do template de e-mail vem do caminho do arquivo renderizado no Storage, não do
# `template_id` do step: quando o usuário escolhe um template existente, o GHL guarda uma
# cópia e o `template_id` passa a ser o dessa cópia, que não existe na lista do builder.
_PREVIEW_ID = re.compile(r"emails/([^/]+)/index\.html")


def email_template_id(step: dict) -> str:
    """Id do template de e-mail citado por um step, ou string vazia se não der para saber."""
    attrs = step.get("attributes") or {}
    url = unquote(str(attrs.get("previewUrl") or ""))
    m = _PREVIEW_ID.search(url)
    return m.group(1) if m else ""


def step_template_id(step: dict) -> str:
    """Id do template SMS/WhatsApp citado por um step (`template_id` ou `templateId`)."""
    attrs = step.get("attributes", {}) or {}
    return str(attrs.get("template_id") or attrs.get("templateId") or "").strip()


def _espera_de_tempo(step: dict) -> bool:
    return step.get("type") == "wait" and (step.get("attributes") or {}).get("type") == "time"


def _tem_cadencia(wf: Workflow) -> bool:
    """Algum caminho passa por mensagem → espera de tempo → mensagem (com outros passos no meio).

    Caminho que fecha laço (`goto` que volta) conta quando o ciclo tem mensagem e espera de
    tempo: a mensagem repete depois da espera.
    """
    by_id = index_steps(wf)
    paths, _ = enumerate_paths(wf)
    for path in paths:
        if path.terminal.startswith("loop → "):
            alvo = path.terminal.removeprefix("loop → ")
            ids = [sid for sid, _label in path.steps]
            ciclo = [by_id[sid] for sid in ids[ids.index(alvo) :]] if alvo in ids else []
            if any(s.get("type") in MENSAGEM_AO_CLIENTE for s in ciclo) and any(map(_espera_de_tempo, ciclo)):
                return True
        mensagem = esperou = False
        for sid, _label in path.steps:
            step = by_id[sid]
            if step.get("type") in MENSAGEM_AO_CLIENTE:
                if esperou:
                    return True
                mensagem = True
            elif mensagem and _espera_de_tempo(step):
                esperou = True
    return False


def cadencias(ctx: DumpContext) -> list[str]:
    """Ids (ordenados) dos workflows publicados com 2+ mensagens ao cliente e espera de tempo entre elas."""
    return sorted(wf.id for wf in ctx.workflows if wf.status == "published" and _tem_cadencia(wf))


def gatilhos_ativos(wf: Workflow) -> list[dict]:
    return [t for t in wf.triggers if t.get("active") and not t.get("deleted")]


def status_do_gatilho(trigger: dict) -> set[str]:
    """Valores de `opportunity.status` filtrados pelo gatilho (vazio se não filtra)."""
    valores: set[str] = set()
    for c in trigger.get("conditions") or []:
        if c.get("field") != "opportunity.status":
            continue
        v = c.get("value")
        valores.update(str(x) for x in (v if isinstance(v, list) else [v]))
    return valores


def remove_de(wf: Workflow, alvo: str) -> bool:
    """O workflow tem passo `remove_from_workflow` que tira o contato de `alvo` (ou de todos)."""
    for step in wf.steps:
        if step.get("type") != "remove_from_workflow":
            continue
        a = step.get("attributes") or {}
        if a.get("allWorkflows"):
            return True
        ids = a.get("workflow_id")
        if ids == alvo or (isinstance(ids, list) and alvo in ids):
            return True
    return False
