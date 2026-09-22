"""Simulação de cenário (Camada 3): avalia condições e escolhe UM caminho.

As condições de um if_else vivem no CONTAINER, em
`attributes.branches[j].segments[k].conditions[l]` (NUNCA em `attributes.if`
do nó-branch — é booleano). Lógica trivalente (Kleene): combo fora da tabela
ou chave ausente no cenário → None (não False); None decisivo → ambiguous.

Combos suportados (inventário do dump real 2026-06-10_2038; fora disso → None):

| conditionType / SubType / Operator       | conditionValue          | chave do cenário (`dado`)                      |
|------------------------------------------|-------------------------|------------------------------------------------|
| contact_detail / tags / index-of-true    | list[str] nomes de tag  | `tags` — alguma das tags, case-insensitive     |
| date_time / day_week / ==                | "0"(domingo)…"6"(sabado)| `dia_semana` — int 0-6 ou nome pt-BR           |
| date_time / time / > < >= <=             | str hora (ex. "11")     | `hora` — int, comparação numérica              |
| trigger / trigger / ==                   | str id do trigger       | `trigger` — id ou nome resolvido em wf.triggers|
| contact_detail / phone / contain         | str substring           | `telefone` — substring                         |
| contact_detail / assigned_to / has_value | (chave ausente)         | `assigned_to` — truthy                         |

Nós de decisão não-condicionais (cenário declara):
- find_opportunity → `oportunidade_encontrada: bool` (Found/Not Found).
- wait com transitions → `resposta: bool` (True=reply/primary, False=timeout).
"""

from __future__ import annotations

import operator
from dataclasses import dataclass

from .flow import Path, _branch_label, index_steps, roots, successors
from .loader import Workflow

_DIAS = {
    "domingo": 0,
    "segunda": 1,
    "terca": 2,
    "terça": 2,
    "quarta": 3,
    "quinta": 4,
    "sexta": 5,
    "sabado": 6,
    "sábado": 6,
}
_OPS = {">": operator.gt, "<": operator.lt, ">=": operator.ge, "<=": operator.le}


@dataclass
class SimResult:
    """Resultado da simulação: caminho escolhido ou ambiguidade com motivo."""

    path: Path | None
    status: str  # "ok" | "ambiguous"
    motivo: str | None = None


def _dia(valor) -> int | None:
    """Normaliza dia da semana: int 0-6 ou nome pt-BR ("segunda-feira" ok)."""
    if isinstance(valor, int):
        return valor if 0 <= valor <= 6 else None
    if isinstance(valor, str):
        return _DIAS.get(valor.strip().lower().split("-")[0])
    return None


def _eval_condition(cond: dict, dado: dict, triggers: list[dict] | None = None) -> bool | None:
    """True/False se o combo é suportado E o cenário declara a chave; senão None."""
    combo = (cond.get("conditionType"), cond.get("conditionSubType"), cond.get("conditionOperator"))
    val = cond.get("conditionValue")
    if combo == ("contact_detail", "tags", "index-of-true"):
        if "tags" not in dado or not isinstance(val, list):
            return None
        have = {str(t).strip().lower() for t in dado["tags"]}
        return any(str(v).strip().lower() in have for v in val)
    if combo == ("date_time", "day_week", "=="):
        dia = _dia(dado["dia_semana"]) if "dia_semana" in dado else None
        if dia is None or not (isinstance(val, str) and val.isdigit()):
            return None
        return dia == int(val)
    if combo[:2] == ("date_time", "time") and combo[2] in _OPS:
        if "hora" not in dado:
            return None
        try:
            return _OPS[combo[2]](int(dado["hora"]), int(val))
        except (TypeError, ValueError):
            return None
    if combo == ("trigger", "trigger", "=="):
        if "trigger" not in dado or not isinstance(val, str):
            return None
        t = dado["trigger"]
        if t == val:
            return True
        return any(tr.get("id") == val and tr.get("name") == t for tr in triggers or [])
    if combo == ("contact_detail", "phone", "contain"):
        if "telefone" not in dado or not isinstance(val, str):
            return None
        return val in str(dado["telefone"])
    if combo == ("contact_detail", "assigned_to", "has_value"):
        if "assigned_to" not in dado:
            return None
        return bool(dado["assigned_to"])
    return None


def _join(values: list[bool | None], op: str) -> bool | None:
    """Junção trivalente (Kleene). Lista vazia → None (shape fora do inventário)."""
    if not values:
        return None
    if op == "or":
        if any(v is True for v in values):
            return True
        return None if any(v is None for v in values) else False
    if any(v is False for v in values):
        return False
    return None if any(v is None for v in values) else True


def _eval_branch(branch: dict, dado: dict, triggers: list[dict] | None = None) -> bool | None:
    """Condições unidas por segment.operator; segments por branch.operator."""
    segs = []
    for seg in branch.get("segments") or []:
        vals = [_eval_condition(c, dado, triggers) for c in seg.get("conditions") or []]
        segs.append(_join(vals, (seg.get("operator") or "and").lower()))
    return _join(segs, (branch.get("operator") or "and").lower())


def _motivo_branch(branch: dict, dado: dict, triggers: list[dict] | None) -> str:
    """Primeira condição não avaliável do branch (para o motivo da ambiguidade)."""
    for seg in branch.get("segments") or []:
        for c in seg.get("conditions") or []:
            if _eval_condition(c, dado, triggers) is None:
                return f"{c.get('conditionType')}/{c.get('conditionSubType')}/{c.get('conditionOperator')}"
    return "sem condições"


def _decide(step: dict, dado: dict, wf: Workflow, by_id: dict[str, dict]):
    """Escolhe o sucessor de um nó de decisão: (next_id, rótulo) ou str = motivo."""
    sid = step.get("id")
    branches = (step.get("attributes") or {}).get("branches") or []
    if step.get("type") == "if_else" and branches:
        for b in branches:
            v = _eval_branch(b, dado, wf.triggers)
            if v is True:
                node = by_id.get(b.get("id"), {})
                return b.get("id"), _branch_label(step, node) or b.get("name")
            if v is None:
                return (
                    f"step {sid}: condição não avaliável no ramo "
                    f'"{b.get("name")}" ({_motivo_branch(b, dado, wf.triggers)})'
                )
        for nid in successors(step):  # todos False → nó else
            node = by_id.get(nid) or {}
            if "else" in (node.get("attributes") or {}):
                return nid, _branch_label(step, node)
        return f"step {sid}: todos os ramos falsos e sem nó else"
    if step.get("type") == "find_opportunity":
        if "oportunidade_encontrada" not in dado:
            return f"step {sid}: cenário não declara 'oportunidade_encontrada'"
        wanted = "Opportunity Found" if dado["oportunidade_encontrada"] else "Opportunity Not Found"
        for nid in successors(step):
            node = by_id.get(nid) or {}
            if node.get("name") == wanted:
                return nid, wanted
        return f'step {sid}: transition "{wanted}" não encontrada'
    if step.get("type") == "wait":
        if "resposta" not in dado:
            return f"step {sid}: cenário não declara 'resposta'"
        # plano: condition primary/timeout; dump real: attributes.type wait_reply/wait_timeout
        wanted = ("primary", "wait_reply") if dado["resposta"] else ("timeout", "wait_timeout")
        for nid in successors(step):
            node = by_id.get(nid) or {}
            marks = (node.get("condition"), (node.get("attributes") or {}).get("type"))
            if any(m in wanted for m in marks if m):
                return nid, _branch_label(step, node)
        return f"step {sid}: transition de resposta não encontrada"
    return f'step {sid}: nó de decisão "{step.get("type")}" não suportado'


def simulate(wf: Workflow, dado: dict) -> SimResult:
    """Anda o grafo a partir da raiz escolhendo ramos pelo cenário `dado`.

    Decisão não resolvível (combo fora da tabela, chave ausente) → ambiguous
    com motivo; nunca um caminho "ok" silencioso.
    """
    by_id = index_steps(wf)
    rts = roots(wf)
    if not rts:
        return SimResult(path=None, status="ambiguous", motivo="sem raiz")
    trail: list[tuple[str, str | None]] = []
    seen: set[str] = set()
    nid, label = rts[0], None
    while True:
        if nid in seen:
            return SimResult(Path(steps=trail, terminal=f"loop → {nid}"), "ok")
        step = by_id.get(nid)
        if step is None:
            return SimResult(Path(steps=trail, terminal="exit"), "ok")
        trail.append((nid, label))
        seen.add(nid)
        if not successors(step):
            return SimResult(Path(steps=trail, terminal="exit"), "ok")
        if isinstance(step.get("next"), list):
            escolha = _decide(step, dado, wf, by_id)
            if isinstance(escolha, str):
                return SimResult(path=None, status="ambiguous", motivo=escolha)
            nid, label = escolha
        else:
            nid, label = successors(step)[0], None
