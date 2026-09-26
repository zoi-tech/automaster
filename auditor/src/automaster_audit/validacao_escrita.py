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
    #: True quando o chamador não passou a lista autoritativa de triggers e a
    #: validação usou a do dump. Regra de trigger então vale para o estado do
    #: snapshot, não para o de agora — e quem lê a saída precisa saber disso.
    triggers_do_dump: bool = False


#: Rótulos com que as regras nomeiam um nó do fluxo no `detail` ("step 'Marca'",
#: "if/else 'Tem tag?'"). O nome vem do CRM e muda legitimamente — renomear um step não
#: é introduzir erro —, então ele sai da chave de comparação. Regra nova que nomeie um nó
#: por outra palavra tem de entrar aqui; `test_validacao_escrita` recusa as que não entram.
ROTULOS_DE_NO = ("step", "if/else")

_RE_ROTULO = re.compile("(" + "|".join(re.escape(r) for r in ROTULOS_DE_NO) + r") '[^']*'")


def _normalizar_detalhe(detail: str) -> str:
    """Tira o nome do nó do detalhe, mantendo a essência do erro."""
    return _RE_ROTULO.sub(r"\1 '<...>'", detail)


def _chaves_erro(ctx: DumpContext, workflow_id: str) -> list[str]:
    """Achados ERROR do workflow alvo, como texto estável para comparar."""
    return sorted(
        f"{f.rule}: {_normalizar_detalhe(f.detail)}"
        for f in run_all(ctx)
        if f.severity == ERROR and f.workflow_id == workflow_id
    )


def validar_edicao(
    ctx: DumpContext,
    workflow_id: str,
    doc_editado: dict,
    triggers: list | None = None,
    doc_antes: dict | None = None,
    triggers_antes: list | None = None,
) -> ResultadoValidacao:
    """Valida o documento editado; `triggers` é a lista AUTORITATIVA do workflow.

    `doc_editado` é o documento do GHL (`workflowData.templates`). Ele **não** traz
    trigger nenhum: o `GET /workflow/<loc>/<wid>` só devolve `triggersFilePath`. Por
    isso os triggers do "depois" têm de vir de fora, de
    `GET /workflow/<loc>/trigger?workflowId=<wid>`. Sem eles a validação mantém os
    triggers do dump (o save de corpo não os altera — provado ao vivo) e marca
    `triggers_do_dump`; ela nunca finge que a lista é vazia, senão todo ERROR de
    trigger sairia como "resolvido".

    `doc_antes`/`triggers_antes` cobrem o workflow mais novo que o dump (criado ou
    duplicado depois da extração): sem eles, workflow fora do dump é `ValueError`;
    com eles, o workflow entra no contexto montado a partir do documento lido ao vivo.
    """
    alvo = next((w for w in ctx.workflows if w.id == workflow_id), None)
    if alvo is None:
        if doc_antes is None:
            raise ValueError(f"workflow {workflow_id} não está neste dump — extraia a subconta de novo")
        # Workflow mais novo que o dump (criado ou duplicado depois da extração): entra no
        # contexto montado do documento lido ao vivo. É a montagem do zero, o caso em que
        # mais cabe erro, e até aqui era o único sem guarda.
        alvo = Workflow(
            id=workflow_id,
            name=doc_antes.get("name", ""),
            status=doc_antes.get("status", ""),
            raw={
                "detail": doc_antes,
                "steps": {"templates": (doc_antes.get("workflowData") or {}).get("templates") or []},
                "triggers": triggers_antes if triggers_antes is not None else (triggers or []),
            },
        )
        ctx = copy.copy(ctx)
        ctx.workflows = [*ctx.workflows, alvo]
        ctx.workflow_ids = ctx.workflow_ids | {workflow_id}
        ctx.workflow_names = {**ctx.workflow_names, workflow_id: alvo.name}

    antes = _chaves_erro(ctx, workflow_id)

    # cópia do contexto com o workflow trocado; o ctx do chamador não é tocado
    novo_raw = copy.deepcopy(alvo.raw)
    novo_raw["steps"] = {"templates": (doc_editado.get("workflowData") or {}).get("templates") or []}
    triggers_do_dump = triggers is None
    if triggers is not None:
        novo_raw["triggers"] = triggers
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
        triggers_do_dump=triggers_do_dump,
    )
