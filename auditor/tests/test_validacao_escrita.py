import pytest

from automaster_audit.loader import load_dump
from automaster_audit.validacao_escrita import validar_edicao
from conftest import wf


def _passo_tag(sid, tags):
    return {"id": sid, "type": "add_contact_tag", "name": "Marca", "attributes": {"tags": tags}}


def test_edicao_que_conserta_ref_quebrada_pode_gravar(make_dump):
    caminho = make_dump(
        workflows=[wf(id="w1", steps=[_passo_tag("s1", ["tag-que-sumiu"])])],
        tags=["tag-boa"],
    )
    ctx = load_dump(caminho)
    editado = {"workflowData": {"templates": [_passo_tag("s1", ["tag-boa"])]}, "triggersData": []}
    r = validar_edicao(ctx, "w1", editado)
    assert r.pode_gravar is True
    assert r.erros_novos == []
    assert any("tag-que-sumiu" in e for e in r.erros_resolvidos)


def test_edicao_que_introduz_ref_quebrada_e_recusada(make_dump):
    caminho = make_dump(
        workflows=[wf(id="w1", steps=[_passo_tag("s1", ["tag-boa"])])],
        tags=["tag-boa"],
    )
    ctx = load_dump(caminho)
    editado = {"workflowData": {"templates": [_passo_tag("s1", ["inventada"])]}, "triggersData": []}
    r = validar_edicao(ctx, "w1", editado)
    assert r.pode_gravar is False
    assert any("inventada" in e for e in r.erros_novos)


def test_erro_que_ja_existia_nao_bloqueia(make_dump):
    caminho = make_dump(
        workflows=[wf(id="w1", steps=[_passo_tag("s1", ["sumida"]), _passo_tag("s2", ["sumida"])])],
        tags=[],
    )
    ctx = load_dump(caminho)
    # muda só o nome de um step: os dois ERROR de tag continuam iguais
    editado = {
        "workflowData": {"templates": [
            {**_passo_tag("s1", ["sumida"]), "name": "Outro nome"},
            _passo_tag("s2", ["sumida"]),
        ]},
        "triggersData": [],
    }
    r = validar_edicao(ctx, "w1", editado)
    assert r.pode_gravar is True
    assert r.erros_novos == []


def test_workflow_fora_do_dump_e_erro_claro(make_dump):
    ctx = load_dump(make_dump(workflows=[wf(id="w1")]))
    with pytest.raises(ValueError, match="w9"):
        validar_edicao(ctx, "w9", {"workflowData": {"templates": []}})


def test_validacao_nao_altera_o_contexto_carregado(make_dump):
    caminho = make_dump(workflows=[wf(id="w1", steps=[_passo_tag("s1", ["tag-boa"])])], tags=["tag-boa"])
    ctx = load_dump(caminho)
    antes = [s["attributes"]["tags"] for s in ctx.workflows[0].steps]
    validar_edicao(ctx, "w1", {"workflowData": {"templates": [_passo_tag("s1", ["outra"])]}, "triggersData": []})
    assert [s["attributes"]["tags"] for s in ctx.workflows[0].steps] == antes
