"""Etapa 5: três regras por aproximação (perdido segue na cadência, cadência sem saída na venda,
sobra de IA publicada), a função `cadencias` e a contagem de regras nos textos.

As três regras são INFO e o detalhe diz "a conferir": podem acusar falso positivo.
Ids, nomes e URLs daqui são inventados: o repositório é público.
"""

from itertools import pairwise
from pathlib import Path

import pytest
from conftest import trig, wf

from automaster_audit import cli, mcp_server
from automaster_audit.loader import load_dump
from automaster_audit.rules import (
    ai_leftover_published,
    cadence_without_exit,
    iter_rules,
    loss_keeps_cadence,
    run_all,
)
from automaster_audit.rules._helpers import cadencias

RAIZ = Path(__file__).resolve().parents[2]
DOIS_PIPELINES = [{"id": "P1", "stages": [{"id": "S1"}]}, {"id": "P2", "stages": [{"id": "S2"}]}]
GATILHOS_OPORTUNIDADE = [
    "opportunity_created",
    "opportunity_status_changed",
    "pipeline_stage_updated",
    "opportunity_decay",
    "opportunity_changed",
]


def pub(id="wf1", status="published", steps=None, triggers=None):
    """Workflow dentro de uma pasta (para não disparar `published_outside_folder` sem querer)."""
    w = wf(id=id, name=f"[Teste] Fluxo {id}", status=status, steps=steps, triggers=triggers)
    w["raw"]["list_entry"]["parentId"] = "pasta1"
    return w


def _ctx(make_dump, **kw):
    kw.setdefault("pipelines", DOIS_PIPELINES)
    return load_dump(make_dump(**kw))


def _passo(sid, tipo, parent=None, next=None, attributes=None):
    s = {"id": sid, "type": tipo, "name": f"Passo {sid}", "attributes": attributes or {}}
    if parent:
        s["parentKey"] = parent
    if next:
        s["next"] = next
    return s


def _msg(sid, tipo="sms"):
    return _passo(sid, tipo, attributes={"body": "Oi, tudo bem?"})


def _espera(sid, unidade="days", valor=1):
    return _passo(
        sid, "wait", attributes={"type": "time", "startAfter": {"type": unidade, "value": valor, "when": "after"}}
    )


def _espera_compromisso(sid):
    return _passo(
        sid,
        "wait",
        attributes={"type": "appointment", "appointmentStartAfter": {"when": "before", "type": "minutes", "value": 60}},
    )


def _tag(sid):
    return _passo(sid, "add_contact_tag", attributes={"tags": ["teste"]})


def _cadeia(*passos):
    """Liga os passos em linha: cada um aponta (`next`) para o seguinte e tem o anterior como pai."""
    passos = [dict(p) for p in passos]
    for anterior, atual in pairwise(passos):
        anterior["next"] = atual["id"]
        atual["parentKey"] = anterior["id"]
    return passos


def _cadencia(id="cad", status="published", triggers=None):
    """SMS → espera de 1 dia → WhatsApp: a cadência mínima."""
    return pub(
        id=id,
        status=status,
        triggers=triggers,
        steps=_cadeia(_msg(f"{id}-m1"), _espera(f"{id}-e"), _msg(f"{id}-m2", "whatsapp_v2")),
    )


def _if_else(cid="c", parent=None, ramo_a=None, ramo_b=None):
    """Container if_else com ramo A (`{cid}a`) e else (`{cid}b`); ramo_x = id do 1º passo do ramo."""
    return [
        {
            "id": cid,
            "type": "if_else",
            "name": "Condicao",
            "attributes": {"branches": [{"id": f"{cid}a", "name": "A", "operator": "and", "segments": []}]},
            "next": [f"{cid}a", f"{cid}b"],
            **({"parentKey": parent} if parent else {}),
        },
        {
            "id": f"{cid}a",
            "type": "if_else",
            "name": "A",
            "parentKey": cid,
            "attributes": {"if": False},
            **({"next": ramo_a} if ramo_a else {}),
        },
        {
            "id": f"{cid}b",
            "type": "if_else",
            "name": "None",
            "parentKey": cid,
            "attributes": {"else": True},
            **({"next": ramo_b} if ramo_b else {}),
        },
    ]


def _status(valor):
    return {"operator": "==", "field": "opportunity.status", "value": valor, "type": "select", "id": "moved-to-status"}


def _remover(sid="rm", alvos=(), todos=False):
    return _passo(sid, "remove_from_workflow", attributes={"workflow_id": list(alvos), "allWorkflows": todos})


def _limpeza(id, tipo, valor=None, alvos=(), todos=False, status="published"):
    """Workflow com gatilho `tipo` (filtrado por status `valor`, se houver) que remove o contato de `alvos`."""
    condicoes = [_status(valor)] if valor else []
    return pub(
        id=id,
        status=status,
        triggers=[trig(tipo, id, conditions=condicoes, tid=f"tr-{id}")],
        steps=[_remover(alvos=alvos, todos=todos)],
    )


def _confere(findings, regra, workflow_id):
    assert len(findings) == 1, findings
    assert findings[0].rule == regra
    assert findings[0].severity == "INFO"
    assert findings[0].workflow_id == workflow_id
    assert "a conferir" in findings[0].detail


# ---------------------------------------------------------------------------
# cadencias
# ---------------------------------------------------------------------------


def test_duas_mensagens_com_espera_de_tempo_entre_elas_e_cadencia(make_dump):
    ctx = _ctx(make_dump, workflows=[_cadencia("cad")])
    assert cadencias(ctx) == ["cad"]


@pytest.mark.parametrize(
    ("primeira", "segunda"),
    [("sms", "sms"), ("whatsapp_v2", "email"), ("email", "sms"), ("email", "whatsapp_v2")],
)
def test_cada_tipo_de_mensagem_ao_cliente_conta(make_dump, primeira, segunda):
    steps = _cadeia(_msg("m1", primeira), _espera("e"), _msg("m2", segunda))
    assert cadencias(_ctx(make_dump, workflows=[pub(steps=steps)])) == ["wf1"]


def test_espera_em_horas_tambem_e_espera_de_tempo(make_dump):
    steps = _cadeia(_msg("m1"), _espera("e", unidade="hours", valor=3), _msg("m2"))
    assert cadencias(_ctx(make_dump, workflows=[pub(steps=steps)])) == ["wf1"]


def test_passos_no_meio_nao_atrapalham(make_dump):
    steps = _cadeia(_msg("m1"), _tag("t1"), _espera("e"), _tag("t2"), _msg("m2"))
    assert cadencias(_ctx(make_dump, workflows=[pub(steps=steps)])) == ["wf1"]


def test_uma_mensagem_so_nao_e_cadencia(make_dump):
    steps = _cadeia(_msg("m1"), _espera("e"), _tag("t1"))
    assert cadencias(_ctx(make_dump, workflows=[pub(steps=steps)])) == []


def test_duas_mensagens_sem_espera_entre_elas_nao_e_cadencia(make_dump):
    antes = pub(id="antes", steps=_cadeia(_espera("e"), _msg("m1"), _msg("m2")))
    depois = pub(id="depois", steps=_cadeia(_msg("m1"), _msg("m2"), _espera("e")))
    assert cadencias(_ctx(make_dump, workflows=[antes, depois])) == []


def test_espera_de_compromisso_entre_mensagens_nao_conta(make_dump):
    steps = _cadeia(_msg("m1"), _espera_compromisso("e"), _msg("m2"))
    assert cadencias(_ctx(make_dump, workflows=[pub(steps=steps)])) == []


def test_passos_que_nao_sao_mensagem_nao_contam(make_dump):
    steps = _cadeia(_tag("t1"), _espera("e"), _passo("n", "internal_notification"), _tag("t2"))
    assert cadencias(_ctx(make_dump, workflows=[pub(steps=steps)])) == []


def test_rascunho_nao_e_cadencia(make_dump):
    assert cadencias(_ctx(make_dump, workflows=[_cadencia("cad", status="draft")])) == []


def test_ordem_vem_do_caminho_e_nao_da_lista_de_steps(make_dump):
    """Na lista a espera vem por último, mas no caminho ela fica entre as duas mensagens."""
    m1, e, m2 = _cadeia(_msg("m1"), _espera("e"), _msg("m2"))
    assert cadencias(_ctx(make_dump, workflows=[pub(steps=[m1, m2, e])])) == ["wf1"]


def test_mensagens_em_ramos_diferentes_nao_formam_cadencia(make_dump):
    """Ramo A: SMS → espera; ramo B: SMS. Nenhum caminho passa pelas duas mensagens."""
    steps = [
        *_if_else("c", ramo_a="m1", ramo_b="m2"),
        _passo("m1", "sms", parent="ca", next="e", attributes={"body": "Oi"}),
        {**_espera("e"), "parentKey": "m1"},
        _passo("m2", "sms", parent="cb", attributes={"body": "Oi"}),
    ]
    assert cadencias(_ctx(make_dump, workflows=[pub(steps=steps)])) == []


def test_cadencia_que_atravessa_condicao_conta(make_dump):
    """SMS → condição → (ramo A) espera → SMS."""
    steps = [
        _passo("m1", "sms", next="c", attributes={"body": "Oi"}),
        *_if_else("c", parent="m1", ramo_a="e"),
        {**_espera("e"), "parentKey": "ca", "next": "m2"},
        _passo("m2", "sms", parent="e", attributes={"body": "Oi"}),
    ]
    assert cadencias(_ctx(make_dump, workflows=[pub(steps=steps)])) == ["wf1"]


def test_varias_cadencias_voltam_em_ids_ordenados(make_dump):
    simples = pub(id="b-simples", steps=[_msg("m1")])
    ctx = _ctx(make_dump, workflows=[_cadencia("c-cad"), simples, _cadencia("a-cad")])
    assert cadencias(ctx) == ["a-cad", "c-cad"]


# ---------------------------------------------------------------------------
# loss_keeps_cadence
# ---------------------------------------------------------------------------


def test_cadencia_sem_limpeza_na_perda_acusa(make_dump):
    ctx = _ctx(make_dump, workflows=[_cadencia("cad")])
    _confere(loss_keeps_cadence.check(ctx), "loss_keeps_cadence", "cad")


def test_perda_que_remove_a_cadencia_pela_lista_nao_acusa(make_dump):
    limpeza = _limpeza("perdeu", "opportunity_status_changed", "lost", alvos=["outro", "cad"])
    ctx = _ctx(make_dump, workflows=[_cadencia("cad"), limpeza])
    assert loss_keeps_cadence.check(ctx) == []


def test_perda_que_remove_de_todos_os_workflows_nao_acusa(make_dump):
    limpeza = _limpeza("perdeu", "opportunity_status_changed", "lost", todos=True)
    ctx = _ctx(make_dump, workflows=[_cadencia("cad"), limpeza])
    assert loss_keeps_cadence.check(ctx) == []


def test_perda_que_remove_outro_workflow_acusa(make_dump):
    limpeza = _limpeza("perdeu", "opportunity_status_changed", "lost", alvos=["outro"])
    ctx = _ctx(make_dump, workflows=[_cadencia("cad"), limpeza])
    _confere(loss_keeps_cadence.check(ctx), "loss_keeps_cadence", "cad")


def test_limpeza_na_venda_nao_vale_como_limpeza_na_perda(make_dump):
    limpeza = _limpeza("ganhou", "opportunity_status_changed", "won", alvos=["cad"])
    ctx = _ctx(make_dump, workflows=[_cadencia("cad"), limpeza])
    _confere(loss_keeps_cadence.check(ctx), "loss_keeps_cadence", "cad")


def test_limpeza_por_gatilho_que_nao_e_de_status_nao_vale(make_dump):
    limpeza = _limpeza("etiqueta", "contact_tag", alvos=["cad"])
    ctx = _ctx(make_dump, workflows=[_cadencia("cad"), limpeza])
    _confere(loss_keeps_cadence.check(ctx), "loss_keeps_cadence", "cad")


def test_limpeza_na_perda_em_rascunho_nao_vale(make_dump):
    limpeza = _limpeza("perdeu", "opportunity_status_changed", "lost", alvos=["cad"], status="draft")
    ctx = _ctx(make_dump, workflows=[_cadencia("cad"), limpeza])
    _confere(loss_keeps_cadence.check(ctx), "loss_keeps_cadence", "cad")


def test_limpeza_de_uma_cadencia_nao_cobre_a_outra(make_dump):
    limpeza = _limpeza("perdeu", "opportunity_status_changed", "lost", alvos=["cad-a"])
    ctx = _ctx(make_dump, workflows=[_cadencia("cad-a"), _cadencia("cad-b"), limpeza])
    _confere(loss_keeps_cadence.check(ctx), "loss_keeps_cadence", "cad-b")


def test_workflow_que_nao_e_cadencia_nao_acusa_na_perda(make_dump):
    uma_mensagem = pub(id="aviso", steps=_cadeia(_msg("m1"), _espera("e")))
    rascunho = _cadencia("rasc", status="draft")
    ctx = _ctx(make_dump, workflows=[uma_mensagem, rascunho])
    assert loss_keeps_cadence.check(ctx) == []


# ---------------------------------------------------------------------------
# cadence_without_exit
# ---------------------------------------------------------------------------


def _entrada(id="entrada", tipo="opportunity_created", alvo="cad", status="published"):
    """Workflow com gatilho `tipo` que chama `alvo` por add_to_workflow."""
    return pub(
        id=id,
        status=status,
        triggers=[trig(tipo, id, tid=f"tr-{id}")],
        steps=[_passo("aw", "add_to_workflow", attributes={"workflow_id": alvo})],
    )


def _cad_oportunidade(id="cad", tipo="opportunity_created", active=True):
    return _cadencia(id, triggers=[trig(tipo, id, active=active, tid=f"tr-{id}")])


@pytest.mark.parametrize("tipo", GATILHOS_OPORTUNIDADE)
def test_cadencia_com_gatilho_de_oportunidade_sem_saida_acusa(make_dump, tipo):
    ctx = _ctx(make_dump, workflows=[_cad_oportunidade(tipo=tipo)])
    _confere(cadence_without_exit.check(ctx), "cadence_without_exit", "cad")


def test_cadencia_chamada_por_workflow_de_oportunidade_sem_saida_acusa(make_dump):
    cad = _cadencia("cad", triggers=[])
    ctx = _ctx(make_dump, workflows=[cad, _entrada(tipo="pipeline_stage_updated")])
    _confere(cadence_without_exit.check(ctx), "cadence_without_exit", "cad")


def test_cadencia_que_so_entra_por_tag_nao_e_considerada(make_dump):
    cad = _cadencia("cad", triggers=[trig("contact_tag", "cad", tid="tr-cad")])
    ctx = _ctx(make_dump, workflows=[cad])
    assert cadence_without_exit.check(ctx) == []


def test_cadencia_chamada_por_workflow_de_tag_nao_e_considerada(make_dump):
    cad = _cadencia("cad", triggers=[])
    ctx = _ctx(make_dump, workflows=[cad, _entrada(tipo="contact_tag")])
    assert cadence_without_exit.check(ctx) == []


def test_gatilho_de_oportunidade_inativo_nao_conta_como_entrada(make_dump):
    ctx = _ctx(make_dump, workflows=[_cad_oportunidade(active=False)])
    assert cadence_without_exit.check(ctx) == []


def test_chamada_por_rascunho_nao_conta_como_entrada(make_dump):
    cad = _cadencia("cad", triggers=[])
    ctx = _ctx(make_dump, workflows=[cad, _entrada(status="draft")])
    assert cadence_without_exit.check(ctx) == []


def test_saida_por_mudanca_de_etapa_nao_acusa(make_dump):
    saida = _limpeza("etapa", "pipeline_stage_updated", alvos=["cad"])
    ctx = _ctx(make_dump, workflows=[_cad_oportunidade(), saida])
    assert cadence_without_exit.check(ctx) == []


def test_saida_na_venda_nao_acusa(make_dump):
    saida = _limpeza("ganhou", "opportunity_status_changed", "won", alvos=["cad"])
    ctx = _ctx(make_dump, workflows=[_cad_oportunidade(), saida])
    assert cadence_without_exit.check(ctx) == []


def test_saida_de_todos_os_workflows_na_venda_nao_acusa(make_dump):
    saida = _limpeza("ganhou", "opportunity_status_changed", "won", todos=True)
    ctx = _ctx(make_dump, workflows=[_cad_oportunidade(), saida])
    assert cadence_without_exit.check(ctx) == []


def test_saida_so_na_perda_nao_vale_como_saida_na_venda(make_dump):
    saida = _limpeza("perdeu", "opportunity_status_changed", "lost", alvos=["cad"])
    ctx = _ctx(make_dump, workflows=[_cad_oportunidade(), saida])
    _confere(cadence_without_exit.check(ctx), "cadence_without_exit", "cad")


def test_saida_por_gatilho_que_nao_e_de_oportunidade_nao_vale(make_dump):
    saida = _limpeza("etiqueta", "contact_tag", alvos=["cad"])
    ctx = _ctx(make_dump, workflows=[_cad_oportunidade(), saida])
    _confere(cadence_without_exit.check(ctx), "cadence_without_exit", "cad")


def test_saida_que_remove_outro_workflow_acusa(make_dump):
    saida = _limpeza("ganhou", "opportunity_status_changed", "won", alvos=["outro"])
    ctx = _ctx(make_dump, workflows=[_cad_oportunidade(), saida])
    _confere(cadence_without_exit.check(ctx), "cadence_without_exit", "cad")


def test_saida_em_rascunho_nao_vale(make_dump):
    saida = _limpeza("ganhou", "opportunity_status_changed", "won", alvos=["cad"], status="draft")
    ctx = _ctx(make_dump, workflows=[_cad_oportunidade(), saida])
    _confere(cadence_without_exit.check(ctx), "cadence_without_exit", "cad")


def test_workflow_de_oportunidade_que_nao_e_cadencia_nao_acusa(make_dump):
    uma_mensagem = pub(id="aviso", triggers=[trig("opportunity_created", "aviso")], steps=[_msg("m1")])
    ctx = _ctx(make_dump, workflows=[uma_mensagem])
    assert cadence_without_exit.check(ctx) == []


# ---------------------------------------------------------------------------
# ai_leftover_published
# ---------------------------------------------------------------------------


def _webhook(url, tipo="webhook"):
    return _passo("wh", tipo, attributes={"method": "POST", "url": url, "headers": []})


def _codigo(codigo):
    return _passo("cc", "custom_code", attributes={"code": codigo, "language": "js"})


@pytest.mark.parametrize("tipo", ["ai_agent", "ai_prompt", "conversation_ai"])
def test_passo_de_ia_em_publicado_acusa(make_dump, tipo):
    ctx = _ctx(make_dump, workflows=[pub(steps=[_passo("ia", tipo)])])
    _confere(ai_leftover_published.check(ctx), "ai_leftover_published", "wf1")


@pytest.mark.parametrize("tipo", ["email", "wait", "sms", "add_contact_tag"])
def test_tipo_que_so_contem_as_letras_ai_nao_acusa(make_dump, tipo):
    """`email` e `wait` têm "ai" no meio, mas não como palavra."""
    ctx = _ctx(make_dump, workflows=[pub(steps=[_passo("p", tipo)])])
    assert ai_leftover_published.check(ctx) == []


@pytest.mark.parametrize(
    "url",
    [
        "https://api.openai.com/v1/chat/completions",
        "https://api.anthropic.com/v1/messages",
        "https://generativelanguage.exemplo.invalid/gemini/v1",
        "https://exemplo.invalid/proxy/chatgpt",
    ],
)
def test_webhook_que_cita_provedor_de_ia_acusa(make_dump, url):
    ctx = _ctx(make_dump, workflows=[pub(steps=[_webhook(url)])])
    _confere(ai_leftover_published.check(ctx), "ai_leftover_published", "wf1")


@pytest.mark.parametrize("nome", ["openai", "anthropic", "gemini", "chatgpt"])
def test_codigo_que_cita_provedor_de_ia_acusa(make_dump, nome):
    codigo = f"const r = await fetch('https://exemplo.invalid/{nome}/responder', {{method: 'POST'}});"
    ctx = _ctx(make_dump, workflows=[pub(steps=[_codigo(codigo)])])
    _confere(ai_leftover_published.check(ctx), "ai_leftover_published", "wf1")


def test_webhook_e_codigo_sem_ia_nao_acusam(make_dump):
    steps = [_webhook("https://exemplo.invalid/hook"), _codigo("return {ok: true};")]
    ctx = _ctx(make_dump, workflows=[pub(steps=steps)])
    assert ai_leftover_published.check(ctx) == []


def test_mensagem_que_cita_provedor_de_ia_nao_acusa(make_dump):
    """Só URL de webhook e código contam: texto de SMS falando de chatgpt não é sobra de IA."""
    sms = _passo("m", "sms", attributes={"body": "Use o chatgpt ou o gemini, tanto faz"})
    ctx = _ctx(make_dump, workflows=[pub(steps=[sms])])
    assert ai_leftover_published.check(ctx) == []


def test_ia_em_rascunho_nao_acusa(make_dump):
    steps = [_passo("ia", "ai_agent"), _webhook("https://api.openai.com/v1/chat/completions")]
    ctx = _ctx(make_dump, workflows=[pub(status="draft", steps=steps)])
    assert ai_leftover_published.check(ctx) == []


# ---------------------------------------------------------------------------
# run_all inclui as três regras; a contagem nos textos
# ---------------------------------------------------------------------------


def test_run_all_inclui_as_tres_regras(make_dump):
    workflows = [_cad_oportunidade("cad"), pub(id="ia", steps=[_passo("ia", "ai_agent")])]
    por_regra = {}
    for f in run_all(_ctx(make_dump, workflows=workflows)):
        por_regra.setdefault(f.rule, set()).add(f.workflow_id)
    assert "cad" in por_regra["loss_keeps_cadence"]
    assert "cad" in por_regra["cadence_without_exit"]
    assert "ia" in por_regra["ai_leftover_published"]


def test_sao_29_regras_descobertas():
    nomes = [nome for nome, _check in iter_rules()]
    assert len(nomes) == 29, nomes
    assert {"loss_keeps_cadence", "cadence_without_exit", "ai_leftover_published"} <= set(nomes)


@pytest.mark.parametrize("arquivo", ["CLAUDE.md", "skills/automaster-leitura/SKILL.md"])
def test_textos_citam_29_regras_e_nao_18(arquivo):
    texto = (RAIZ / arquivo).read_text(encoding="utf-8")
    assert "18 regras" not in texto
    assert "29 regras" in texto


def test_claude_md_conta_29_na_lista_de_regras():
    texto = (RAIZ / "CLAUDE.md").read_text(encoding="utf-8")
    assert "Regras de auditoria (18)" not in texto
    assert "Regras de auditoria (29)" in texto


def test_help_do_workflow_editar_cita_29_regras():
    ajuda = cli.build_parser().format_help()
    assert "18 regras" not in ajuda
    assert "29 regras" in ajuda


@pytest.mark.parametrize("nome", sorted(mcp_server.TOOLS))
def test_descricao_da_tool_nao_cita_18_regras(nome):
    assert "18 regras" not in mcp_server.TOOLS[nome][1]
