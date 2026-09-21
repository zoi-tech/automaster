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


# --- a propriedade que a normalização do detalhe existe para garantir -----------------
#
# A chave de comparação antes/depois não pode depender do NOME do step: renomear um step
# não é introduzir erro. Hoje `_normalizar_detalhe` neutraliza a fraseologia `step '...'`,
# que é a única usada pelas regras. Os dois testes abaixo guardam a propriedade em vez da
# fraseologia: o primeiro prova o efeito, o segundo falha quando nasce uma regra que cita
# nome de step de outro jeito — o caso que traria o falso positivo de volta.

def _steps_com_erro_de_cada_tipo(sufixo=""):
    """Um step por regra ERROR que cita nome de step, todos com referência quebrada."""
    return [
        {"id": "s1", "type": "add_contact_tag", "name": f"Marca{sufixo}",
         "attributes": {"tags": ["tag-fantasma"]}, "next": "s2"},
        {"id": "s2", "type": "update_contact_field", "name": f"Atualiza{sufixo}",
         "attributes": {"fields": [{"field": "GHOST", "title": "Campo X"}]}, "parentKey": "s1", "next": "s3"},
        {"id": "s3", "type": "sms", "name": f"SMS{sufixo}",
         "attributes": {"body": "{{custom_values.fantasma}}"}, "parentKey": "s2", "next": "s4"},
        {"id": "s4", "type": "add_to_workflow", "name": f"Encaminha{sufixo}",
         "attributes": {"workflow_id": "GHOST"}, "parentKey": "s3", "next": "s5"},
        {"id": "s5", "type": "goto", "name": f"Salta{sufixo}",
         "attributes": {"targetNodeId": "NAO-EXISTE"}, "parentKey": "s4"},
    ]


def test_renomear_steps_nao_inventa_erro_novo(make_dump):
    caminho = make_dump(
        workflows=[wf(id="w1", steps=_steps_com_erro_de_cada_tipo())],
        tags=["tag-boa"],
        fields=[{"id": "F1"}],
        custom_values=[{"id": "c1", "name": "Estoque", "fieldKey": "{{ custom_values.estoque }}"}],
    )
    ctx = load_dump(caminho)
    editado = {"workflowData": {"templates": _steps_com_erro_de_cada_tipo(" (renomeado)")}}
    r = validar_edicao(ctx, "w1", editado, triggers=[])

    assert r.total_erros_antes >= 5, "o fixture tem de disparar as regras que citam step"
    assert r.erros_novos == []
    assert r.erros_resolvidos == []
    assert r.pode_gravar is True


def test_regra_que_cita_nome_de_no_usa_uma_fraseologia_normalizada():
    import re
    from pathlib import Path

    from automaster_audit import rules
    from automaster_audit.validacao_escrita import ROTULOS_DE_NO

    conhecida = re.compile("(" + "|".join(re.escape(r) for r in ROTULOS_DE_NO) + r") '\{")
    fora = []
    for arquivo in Path(rules.__file__).parent.glob("*.py"):
        for n, linha in enumerate(arquivo.read_text(encoding="utf-8").splitlines(), 1):
            if "step.get('name'" not in linha and 'step.get("name"' not in linha:
                continue
            if not conhecida.search(linha):
                fora.append(f"{arquivo.name}:{n}")
    assert not fora, (
        "estas linhas põem o nome do nó no detalhe fora das fraseologias que "
        f"`_normalizar_detalhe` neutraliza ({', '.join(ROTULOS_DE_NO)}) — renomear o nó "
        f"passaria a contar como erro novo e recusaria a gravação: {fora}"
    )


def test_normalizacao_cobre_cada_rotulo_conhecido():
    from automaster_audit.validacao_escrita import ROTULOS_DE_NO, _normalizar_detalhe

    for rotulo in ROTULOS_DE_NO:
        antes = _normalizar_detalhe(f"{rotulo} 'Nome Velho' usa tag inexistente: 'x'")
        depois = _normalizar_detalhe(f"{rotulo} 'Nome Novo' usa tag inexistente: 'x'")
        assert antes == depois
        assert "'x'" in antes, "o alvo quebrado não pode sumir junto com o nome"
