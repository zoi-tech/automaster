"""WARN: cria oportunidade sem, antes no mesmo caminho, procurar uma no mesmo pipeline.

Sem um `find_opportunity` do mesmo pipeline cujo ramo "Opportunity Not Found" leve ao passo,
o contato que já tem oportunidade ganha uma duplicada a cada vez que passa por ali.
"""

from __future__ import annotations

from ..finding import WARN, Finding
from ..flow import index_steps, parent_of


def _pipeline_da_busca(step: dict) -> str | None:
    for f in (step.get("attributes") or {}).get("__customInputFields__") or []:
        if isinstance(f, dict) and f.get("filterField") == "pipeline_id":
            return f.get("secondValue")
    return None


def _buscou_antes(by_id: dict[str, dict], step: dict, pipeline: str) -> bool:
    """Algum ancestral é um find_opportunity do pipeline, entrado pelo ramo Not Found."""
    filho, pid = step, parent_of(step)
    seen: set[str] = set()
    while pid and pid not in seen and pid in by_id:
        seen.add(pid)
        pai = by_id[pid]
        if (
            pai.get("type") == "find_opportunity"
            and _pipeline_da_busca(pai) == pipeline
            and filho.get("type") == "transition"
            and filho.get("name") == "Opportunity Not Found"
        ):
            return True
        filho, pid = pai, parent_of(pai)
    return False


def check(ctx) -> list[Finding]:
    findings: list[Finding] = []
    for wf in ctx.workflows:
        if wf.status != "published":
            continue
        by_id = index_steps(wf)
        for step in wf.steps:
            if step.get("type") != "internal_create_opportunity":
                continue
            pipeline = (step.get("attributes") or {}).get("pipelineId")
            if not pipeline or _buscou_antes(by_id, step, pipeline):
                continue
            findings.append(
                Finding(
                    rule="create_opportunity_without_lookup",
                    severity=WARN,
                    workflow_id=wf.id,
                    workflow_name=wf.name,
                    detail=(
                        f"step '{step.get('name', 'Create Opportunity')}' cria oportunidade sem antes procurar "
                        "uma no mesmo pipeline (find_opportunity → Opportunity Not Found) — pode duplicar"
                    ),
                )
            )
    return findings
