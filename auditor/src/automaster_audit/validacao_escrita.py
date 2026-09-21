"""Valida uma edição de workflow ANTES de gravá-la.

Roda as 18 regras sobre o dump com o workflow editado no lugar do antigo, em
memória — nada é escrito em disco. A edição é recusada só se INTRODUZIR um
achado ERROR novo; ERROR que já existia não bloqueia, senão nenhum workflow
com achado poderia ser corrigido.
"""
from __future__ import annotations

import copy
import re
from dataclasses import dataclass, field

from .finding import ERROR
from .loader import DumpContext, Workflow
from .rules import run_all


@dataclass
class ResultadoValidacao:
    pode_gravar: bool
    erros_novos: list[str] = field(default_factory=list)
    erros_resolvidos: list[str] = field(default_factory=list)
    total_erros_antes: int = 0
    total_erros_depois: int = 0


def _normalizar_detalhe(detail: str) -> str:
    """Remove nomes de steps (que podem mudar legitimamente) do detalhe, mantendo a essência do erro."""
    # Remove "step 'XXX'" do detalhe para tornar a chave estável em relação a mudanças de nome
    return re.sub(r"step '[^']*'", "step '<...>'", detail)


def _chaves_erro(ctx: DumpContext, workflow_id: str) -> list[str]:
    """Achados ERROR do workflow alvo, como texto estável para comparar."""
    return sorted(
        f"{f.rule}: {_normalizar_detalhe(f.detail)}"
        for f in run_all(ctx)
        if f.severity == ERROR and f.workflow_id == workflow_id
    )


def validar_edicao(ctx: DumpContext, workflow_id: str, doc_editado: dict) -> ResultadoValidacao:
    """`doc_editado` é o documento do GHL (com `workflowData.templates` e `triggersData`)."""
    alvo = next((w for w in ctx.workflows if w.id == workflow_id), None)
    if alvo is None:
        raise ValueError(f"workflow {workflow_id} não está neste dump — extraia a subconta de novo")

    antes = _chaves_erro(ctx, workflow_id)

    # cópia do contexto com o workflow trocado; o ctx do chamador não é tocado
    novo_raw = copy.deepcopy(alvo.raw)
    novo_raw["steps"] = {"templates": (doc_editado.get("workflowData") or {}).get("templates") or []}
    novo_raw["triggers"] = doc_editado.get("triggersData") or []
    editado = Workflow(
        id=alvo.id,
        name=doc_editado.get("name") or alvo.name,
        status=doc_editado.get("status") or alvo.status,
        raw=novo_raw,
    )
    ctx_novo = copy.copy(ctx)
    ctx_novo.workflows = [editado if w.id == workflow_id else w for w in ctx.workflows]

    depois = _chaves_erro(ctx_novo, workflow_id)
    novos = [e for e in depois if e not in antes]
    resolvidos = [e for e in antes if e not in depois]
    return ResultadoValidacao(
        pode_gravar=not novos,
        erros_novos=novos,
        erros_resolvidos=resolvidos,
        total_erros_antes=len(antes),
        total_erros_depois=len(depois),
    )
