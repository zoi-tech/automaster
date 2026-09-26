"""Testes da Camada 3: contratos (contract.py) — PASS/FAIL/AMBIGUOUS por caso."""

import json

import pytest
from conftest import wf

from automaster_audit.contract import ContractError, load_contracts, run_contracts
from automaster_audit.loader import load_dump

# Workflow sintético: find_opportunity → criar oportunidade (shape da Fase 0)
OPP_STEPS = [
    {"id": "f", "type": "find_opportunity", "name": "Find", "attributes": {}, "next": ["t1", "t2"]},
    {"id": "t1", "type": "transition", "name": "Opportunity Found", "parent": "f"},
    {"id": "t2", "type": "transition", "name": "Opportunity Not Found", "parent": "f", "next": "a1"},
    {"id": "a1", "type": "internal_create_opportunity", "name": "Criar", "parent": "t2", "attributes": {}},
]

# Workflow com condição NÃO suportada (conditionType opportunity) → ambiguous
AMB_STEPS = [
    {"id": "root", "type": "sms", "name": "Root", "next": "c"},
    {
        "id": "c",
        "type": "if_else",
        "name": "Cond",
        "parent": "root",
        "attributes": {
            "if": True,
            "operator": "and",
            "noneBranchName": "None",
            "branches": [
                {
                    "id": "b1",
                    "name": "X",
                    "operator": "and",
                    "segments": [
                        {
                            "__segmentId": "s1",
                            "operator": "and",
                            "conditions": [
                                {
                                    "conditionType": "opportunity",
                                    "conditionSubType": "pipeline_stage",
                                    "conditionOperator": "==",
                                    "conditionValue": "x",
                                }
                            ],
                        }
                    ],
                }
            ],
        },
        "next": ["b1", "e"],
    },
    {"id": "b1", "type": "if_else", "name": "X", "parent": "c", "attributes": {"if": False}},
    {"id": "e", "type": "if_else", "name": "None", "parent": "c", "attributes": {"else": True}},
]


def _ctx(make_dump, steps):
    return load_dump(make_dump(workflows=[wf(steps=steps)]))


def _contracts(tmp_path, data, name="c1.json"):
    d = tmp_path / "contracts"
    d.mkdir(exist_ok=True)
    (d / name).write_text(
        data if isinstance(data, str) else json.dumps(data, ensure_ascii=False),
        encoding="utf-8",
    )
    return d


def _caso(dado, espera, nome="caso 1"):
    return {"workflow": "wf1", "casos": [{"nome": nome, "dado": dado, "espera": espera}]}


# 1. PASS fim-a-fim: sem oportunidade → cria oportunidade, termina em exit
def test_pass(make_dump, tmp_path):
    ctx = _ctx(make_dump, OPP_STEPS)
    d = _contracts(
        tmp_path,
        _caso(
            {"oportunidade_encontrada": False},
            {"acoes_contem": ["criar oportunidade"], "termina_em": "exit", "nao_faz": []},
        ),
    )
    results = run_contracts(ctx, d)
    assert len(results) == 1
    assert results[0].status == "PASS"
    assert results[0].motivo == ""


# 2. FAIL: acoes_contem com ação inexistente; motivo cita a expectativa
def test_fail_acao_inexistente(make_dump, tmp_path):
    ctx = _ctx(make_dump, OPP_STEPS)
    d = _contracts(
        tmp_path,
        _caso(
            {"oportunidade_encontrada": False},
            {"acoes_contem": ["enviar email fantasma"]},
        ),
    )
    (r,) = run_contracts(ctx, d)
    assert r.status == "FAIL"
    assert "enviar email fantasma" in r.motivo


# 3. FAIL por nao_faz: ação presente no caminho
def test_fail_nao_faz(make_dump, tmp_path):
    ctx = _ctx(make_dump, OPP_STEPS)
    d = _contracts(
        tmp_path,
        _caso(
            {"oportunidade_encontrada": False},
            {"nao_faz": ["criar oportunidade"]},
        ),
    )
    (r,) = run_contracts(ctx, d)
    assert r.status == "FAIL"
    assert "criar oportunidade" in r.motivo


# 4. AMBIGUOUS: condição não suportada → AMBIGUOUS (nunca FAIL), motivo presente
def test_ambiguous_nao_vira_fail(make_dump, tmp_path):
    ctx = _ctx(make_dump, AMB_STEPS)
    d = _contracts(tmp_path, _caso({}, {"acoes_contem": ["sms"]}))
    (r,) = run_contracts(ctx, d)
    assert r.status == "AMBIGUOUS"
    assert r.status != "FAIL"
    assert r.motivo


# 5. workflow do contrato não existe no dump → 1 FAIL por caso
def test_workflow_nao_encontrado(make_dump, tmp_path):
    ctx = _ctx(make_dump, OPP_STEPS)
    d = _contracts(
        tmp_path,
        {
            "workflow": "Inexistente",
            "casos": [
                {"nome": "a", "dado": {}, "espera": {}},
                {"nome": "b", "dado": {}, "espera": {}},
            ],
        },
    )
    results = run_contracts(ctx, d)
    assert len(results) == 2
    assert all(r.status == "FAIL" and r.motivo == "workflow não encontrado" for r in results)


# 6. JSON quebrado → erro claro com o nome do arquivo
def test_json_quebrado_erro_claro(make_dump, tmp_path):
    ctx = _ctx(make_dump, OPP_STEPS)
    d = _contracts(tmp_path, "{not json", name="quebrado.json")
    with pytest.raises(ContractError, match="quebrado.json"):
        run_contracts(ctx, d)


# 7. Shape inválido: caso sem 'espera' e 'casos' não-lista → ContractError
def test_caso_sem_espera_rejeitado(make_dump, tmp_path):
    d = _contracts(tmp_path, {"workflow": "wf1", "casos": [{"nome": "x", "dado": {}}]})
    with pytest.raises(ContractError, match="caso inválido"):
        load_contracts(d)
    # a0.json ordena antes de c1.json → 'casos' não-lista falha primeiro
    d = _contracts(tmp_path, {"workflow": "wf1", "casos": "oops"}, name="a0.json")
    with pytest.raises(ContractError, match="lista"):
        load_contracts(d)
