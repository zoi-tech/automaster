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


def _trigger_form_morto():
    return {"id": "tr1", "type": "form_submission", "name": "Formulário Enviado",
            "active": True, "deleted": False, "workflow_id": "w1",
            "actions": [{"workflow_id": "w1", "type": "add_to_workflow"}],
            "conditions": [{"field": "form.id", "value": "formQueSumiu"}]}


def _dump_com_trigger_quebrado(make_dump):
    return make_dump(
        workflows=[wf(id="w1", steps=[_passo_tag("s1", ["tag-boa"])],
                      triggers=[_trigger_form_morto()])],
        tags=["tag-boa"],
        forms=[{"id": "formVivo", "name": "Vivo"}],
    )


def test_erro_de_trigger_nao_sai_como_resolvido_quando_a_edicao_e_so_de_corpo(make_dump):
    """O documento do GHL não traz trigger. Tratar a lista como vazia fazia todo ERROR
    de trigger pré-existente sair como 'resolvido' — e nenhum novo ser detectável."""
    ctx = load_dump(_dump_com_trigger_quebrado(make_dump))
    editado = {"workflowData": {"templates": [_passo_tag("s1", ["tag-boa"])]}}
    r = validar_edicao(ctx, "w1", editado)
    assert r.erros_resolvidos == []
    assert r.triggers_do_dump is True
    assert r.pode_gravar is True


def test_triggers_passados_pelo_chamador_mandam(make_dump):
    ctx = load_dump(_dump_com_trigger_quebrado(make_dump))
    editado = {"workflowData": {"templates": [_passo_tag("s1", ["tag-boa"])]}}
    r = validar_edicao(ctx, "w1", editado, triggers=[])  # trigger removido de verdade
    assert r.triggers_do_dump is False
    assert any("formQueSumiu" in e for e in r.erros_resolvidos)
