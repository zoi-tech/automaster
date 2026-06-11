"""Teste de contrato (Camada 3): cenário declarado vs caminho simulado.

Contrato = arquivo JSON num diretório (um por workflow). Exemplo canônico:

    {
      "workflow": "Cria oportunidades!",
      "casos": [
        {
          "nome": "contato sem oportunidade → cria em Novo lead",
          "dado": {"oportunidade_encontrada": false},
          "espera": {"acoes_contem": ["criar oportunidade"], "termina_em": "exit", "nao_faz": []}
        }
      ]
    }

`workflow` casa por id exato ou nome exato. Expectativas comparam substring
case-insensitive contra os rótulos `describe_step` do caminho (sem outra
normalização). Status por caso: PASS | FAIL | AMBIGUOUS — simulação ambígua
NUNCA vira PASS/FAIL silencioso. Erros de formato → ContractError (estilo
loader.DumpError: mensagem clara com o nome do arquivo, sem traceback cru).
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from .flow import index_steps
from .loader import DumpContext, Workflow
from .path_report import describe_step
from .simulate import simulate


class ContractError(Exception):
    """Contrato ausente ou malformado."""


def load_contracts(dir: Path) -> list[dict]:
    """Lê todos os *.json do diretório; valida presença de `workflow` e `casos`."""
    dir = Path(dir)
    if not dir.is_dir():
        raise ContractError(f"diretório de contratos não encontrado: {dir}")
    files = sorted(dir.glob("*.json"))
    if not files:
        raise ContractError(f"nenhum contrato *.json em {dir}")
    contracts: list[dict] = []
    for f in files:
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            raise ContractError(f"JSON inválido em {f.name}: {e}") from e
        if not isinstance(data, dict) or "workflow" not in data or "casos" not in data:
            raise ContractError(f"contrato {f.name} deve ter as chaves 'workflow' e 'casos'")
        if not isinstance(data["casos"], list):
            raise ContractError(f"contrato {f.name}: 'casos' deve ser uma lista")
        for c in data["casos"]:
            if (not isinstance(c, dict) or not {"nome", "dado", "espera"} <= c.keys()
                    or not isinstance(c["dado"], dict) or not isinstance(c["espera"], dict)):
                raise ContractError(
                    f"contrato {f.name}: caso inválido — exige 'nome', 'dado' e 'espera' (dicts)")
        contracts.append(data)
    return contracts


@dataclass
class CaseResult:
    """Resultado de um caso de contrato. `motivo` vazio em PASS."""
    workflow: str
    caso: str
    status: str  # "PASS" | "FAIL" | "AMBIGUOUS"
    motivo: str = ""


def _find_wf(ctx: DumpContext, key: str) -> Workflow | None:
    for w in ctx.workflows:
        if w.id == key or w.name == key:
            return w
    return None


def _check_espera(espera: dict, labels: list[str], terminal: str) -> str:
    """Compara expectativas (substring case-insensitive); '' se tudo passou."""
    low = [lb.lower() for lb in labels]
    resumo = " → ".join(labels + [terminal])
    for want in espera.get("acoes_contem") or []:
        if not any(str(want).lower() in lb for lb in low):
            return f'esperava ação contendo "{want}"; caminho: {resumo}'
    for ban in espera.get("nao_faz") or []:
        if any(str(ban).lower() in lb for lb in low):
            return f'não deveria conter "{ban}"; caminho: {resumo}'
    fim = espera.get("termina_em")
    if fim is not None:
        last = low[-1] if low else ""
        if str(fim).lower() not in terminal.lower() and str(fim).lower() not in last:
            return f'esperava terminar em "{fim}"; caminho: {resumo}'
    return ""


def run_contracts(ctx: DumpContext, contracts_dir: Path) -> list[CaseResult]:
    """Roda todos os contratos do diretório contra o dump carregado."""
    results: list[CaseResult] = []
    for contract in load_contracts(Path(contracts_dir)):
        key = contract["workflow"]
        casos = contract["casos"] or []
        w = _find_wf(ctx, key)
        if w is None:
            results += [CaseResult(key, c.get("nome", "?"), "FAIL", "workflow não encontrado")
                        for c in casos]
            continue
        by_id = index_steps(w)
        for c in casos:
            nome = c.get("nome", "?")
            res = simulate(w, c.get("dado") or {})
            if res.status != "ok":
                results.append(CaseResult(key, nome, "AMBIGUOUS", res.motivo or ""))
                continue
            labels = [describe_step(by_id.get(sid) or {}, ctx) for sid, _ in res.path.steps]
            motivo = _check_espera(c.get("espera") or {}, labels, res.path.terminal)
            results.append(CaseResult(key, nome, "FAIL" if motivo else "PASS", motivo))
    return results


_MARK = {"PASS": "✓", "FAIL": "✗", "AMBIGUOUS": "?"}


def format_results(results: list[CaseResult]) -> str:
    """Texto por workflow/caso + sumário 'N PASS, N FAIL, N AMBIGUOUS'."""
    lines: list[str] = []
    atual: str | None = None
    for r in results:
        if r.workflow != atual:
            atual = r.workflow
            lines.append(r.workflow)
        sufixo = f" — {r.motivo}" if r.motivo else ""
        lines.append(f"  {_MARK[r.status]} {r.status} {r.caso}{sufixo}")
    n = {s: sum(1 for r in results if r.status == s) for s in ("PASS", "FAIL", "AMBIGUOUS")}
    lines += ["", f"{n['PASS']} PASS, {n['FAIL']} FAIL, {n['AMBIGUOUS']} AMBIGUOUS"]
    return "\n".join(lines)
