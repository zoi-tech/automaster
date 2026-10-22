"""Etapa 2: ficha por workflow (`automaster-audit ficha <dump>` e `gerar_fichas`).

Os testes cobram só o que quem lê a ficha vê: textos presentes, ordem relativa e
indentação. O formato exato do Markdown fica livre.
"""

import re

import pytest
from conftest import wf

from automaster_audit import cli, ficha
from automaster_audit.loader import load_dump

gerar_fichas = ficha.gerar_fichas


def _env(id, name, status="published", steps=None, triggers=None, pasta=None, detail=None):
    """Envelope com pasta (`list_entry.parentId`) e configurações (`detail`)."""
    e = wf(id=id, name=name, status=status, steps=steps, triggers=triggers)
    if pasta is not None:
        e["raw"]["list_entry"]["parentId"] = pasta
    e["raw"]["detail"].update(detail or {})
    return e


def _ficha(make_dump, steps=None, triggers=None, **kw):
    path = make_dump(workflows=[_env("w1", "Fluxo Teste", steps=steps, triggers=triggers)], **kw)
    return gerar_fichas(load_dump(path))


def _linha(texto, trecho, depois=0):
    """Índice da primeira linha (a partir de `depois`) que contém `trecho`."""
    linhas = texto.splitlines()
    for i in range(depois, len(linhas)):
        if trecho in linhas[i]:
            return i
    raise AssertionError(f"{trecho!r} não aparece na ficha:\n{texto}")


def _indent(texto, i):
    linha = texto.splitlines()[i]
    return len(linha) - len(linha.lstrip())


def _plano(texto):
    """Texto sem marcação de ênfase/código, em minúsculas: o formato do Markdown é livre."""
    return re.sub(r"[*`]", "", texto).lower()


def _trigger(ttype, conditions, active=True, tid="t1", name="Gatilho"):
    return {"id": tid, "type": ttype, "name": name, "active": active, "conditions": conditions}


# --- cabeçalho: nome, status, pasta, configurações ---------------------------------


def test_ficha_traz_nome_e_status(make_dump):
    path = make_dump(
        workflows=[
            _env("w1", "Boas-vindas Solar", status="published"),
            _env("w2", "Cobrança Pendente", status="draft"),
        ]
    )
    ctx = load_dump(path)
    pub = gerar_fichas(ctx, "w1").lower()
    rasc = gerar_fichas(ctx, "w2").lower()
    assert "boas-vindas solar" in pub
    assert "cobrança pendente" in rasc
    assert "published" in pub or "publicado" in pub
    assert "draft" in rasc or "rascunho" in rasc
    assert "published" not in rasc and "publicado" not in rasc


def test_pasta_mostra_id_ou_fora_de_pasta(make_dump):
    path = make_dump(
        workflows=[
            _env("w1", "Dentro", pasta="pasta-xyz-123"),
            _env("w2", "Solto", pasta=""),
            _env("w3", "Sem chave"),
        ]
    )
    ctx = load_dump(path)
    dentro = gerar_fichas(ctx, "w1")
    assert "pasta-xyz-123" in dentro
    assert "fora de pasta" not in dentro.lower()
    assert "fora de pasta" in gerar_fichas(ctx, "w2").lower()
    assert "fora de pasta" in gerar_fichas(ctx, "w3").lower()


def test_configuracoes_sim_e_nao(make_dump):
    path = make_dump(
        workflows=[
            _env(
                "w1",
                "Um",
                detail={"allowMultiple": True, "stopOnResponse": False, "allowMultipleOpportunity": True},
            ),
            _env(
                "w2",
                "Dois",
                detail={"allowMultiple": False, "stopOnResponse": True, "allowMultipleOpportunity": False},
            ),
        ]
    )
    ctx = load_dump(path)
    um = _plano(gerar_fichas(ctx, "w1"))
    dois = _plano(gerar_fichas(ctx, "w2"))
    assert "reentrada: sim" in um
    assert "parar quando responder: não" in um
    assert "várias oportunidades: sim" in um
    assert "reentrada: não" in dois
    assert "parar quando responder: sim" in dois
    assert "várias oportunidades: não" in dois


# --- ordem e filtro por workflow -------------------------------------------------


def test_fichas_em_ordem_de_pasta_e_nome(make_dump):
    # ids em ordem diferente da esperada: a ordem tem que vir da pasta e do nome
    path = make_dump(
        workflows=[
            _env("a1", "Gama", pasta="pasta-b"),
            _env("a2", "Delta", pasta="pasta-a"),
            _env("a3", "Alfa", pasta="pasta-b"),
            _env("a4", "Beta", pasta="pasta-a"),
        ]
    )
    out = gerar_fichas(load_dump(path))
    pos = [out.index(n) for n in ("Beta", "Delta", "Alfa", "Gama")]
    assert pos == sorted(pos)


def test_workflow_id_limita_a_um(make_dump):
    path = make_dump(workflows=[_env("w1", "Primeiro Fluxo"), _env("w2", "Segundo Fluxo")])
    out = gerar_fichas(load_dump(path), "w2")
    assert "Segundo Fluxo" in out
    assert "Primeiro Fluxo" not in out


def test_workflow_id_inexistente_levanta_value_error(make_dump):
    path = make_dump(workflows=[_env("w1", "Primeiro Fluxo")])
    with pytest.raises(ValueError):
        gerar_fichas(load_dump(path), "nao-existe")


def test_dump_sem_workflows(make_dump):
    out = gerar_fichas(load_dump(make_dump(workflows=[])))
    assert "nenhum workflow" in out.lower()


# --- gatilhos --------------------------------------------------------------------


def test_gatilho_com_tipo_ativo_e_filtros(make_dump):
    conds = [
        {"field": "tagsAdded", "operator": "index-of-true", "value": "vip"},
        {"field": "contact.source", "operator": "==", "value": "instagram"},
    ]
    out = _plano(_ficha(make_dump, triggers=[_trigger("contact_tag", conds)]))
    assert "contact_tag" in out
    assert "tagsadded index-of-true vip" in out
    assert "contact.source == instagram" in out
    assert re.search(r"(?<!in)ativo", out)
    assert "inativo" not in out


def test_gatilho_inativo(make_dump):
    conds = [{"field": "form.id", "operator": "is-any-of", "value": "form-abc"}]
    out = _plano(_ficha(make_dump, triggers=[_trigger("form_submission", conds, active=False)]))
    assert "form_submission" in out
    assert "inativo" in out
    assert "form.id is-any-of form-abc" in out


def test_varios_gatilhos_aparecem_todos(make_dump):
    out = _plano(
        _ficha(
            make_dump,
            triggers=[
                _trigger("contact_tag", [{"field": "tagsAdded", "operator": "index-of-true", "value": "a"}], tid="t1"),
                _trigger("customer_reply", [{"field": "channel", "operator": "==", "value": "whatsapp"}], tid="t2"),
            ],
        )
    )
    assert "contact_tag" in out and "customer_reply" in out
    assert "tagsadded index-of-true a" in out
    assert "channel == whatsapp" in out


# --- passos ----------------------------------------------------------------------


def test_passos_em_ordem_de_execucao(make_dump):
    # dump traz os steps fora de ordem; a ficha segue next/parentKey
    steps = [
        {"id": "s3", "type": "sms", "name": "Passo Terceiro", "parentKey": "s2", "attributes": {"body": "c"}},
        {"id": "s1", "type": "sms", "name": "Passo Primeiro", "next": "s2", "attributes": {"body": "a"}},
        {"id": "s2", "type": "add_contact_tag", "name": "Passo Segundo", "parentKey": "s1", "next": "s3"},
    ]
    out = _ficha(make_dump, steps=steps)
    pos = [out.index(n) for n in ("Passo Primeiro", "Passo Segundo", "Passo Terceiro")]
    assert pos == sorted(pos)


@pytest.mark.parametrize(
    ("tipo", "attributes"),
    [
        ("sms", {"body": "Oi, texto do sms aqui"}),
        ("email", {"subject": "Assunto", "body": "Oi, texto do email aqui"}),
        ("whatsapp_v2", {"message": "Oi, texto do whatsapp aqui"}),
        ("internal_notification", {"notification": {"body": "Oi, texto da notificacao aqui"}}),
    ],
)
def test_passo_de_mensagem_mostra_texto(make_dump, tipo, attributes):
    steps = [{"id": "m", "type": tipo, "name": "Mensagem", "attributes": attributes}]
    out = _ficha(make_dump, steps=steps)
    texto = attributes.get("body") or attributes.get("message") or attributes["notification"]["body"]
    assert texto in out


def test_texto_da_mensagem_cortado_em_300(make_dump):
    inicio = "inicio-" + "a" * 293
    assert len(inicio) == 300
    texto = inicio + "FIMDOTEXTO" + "b" * 90
    steps = [{"id": "m", "type": "sms", "name": "Mensagem", "attributes": {"body": texto}}]
    out = _ficha(make_dump, steps=steps)
    assert inicio in out
    assert "FIMDOTEXTO" not in out
    assert texto not in out


def test_espera_de_tempo(make_dump):
    steps = [
        {
            "id": "w",
            "type": "wait",
            "name": "Wait",
            "attributes": {"type": "time", "startAfter": {"type": "days", "value": 1, "when": "after"}},
        }
    ]
    assert "1 dia depois" in _ficha(make_dump, steps=steps)


def test_espera_de_compromisso(make_dump):
    steps = [
        {
            "id": "w",
            "type": "wait",
            "name": "Wait",
            "attributes": {
                "type": "appointment",
                "appointmentStartAfter": {"when": "before", "type": "minutes", "value": 120},
            },
        }
    ]
    assert "120 min antes do compromisso" in _ficha(make_dump, steps=steps)


def _cond_tag(valor):
    return {
        "conditionType": "contact_detail",
        "conditionSubType": "tags",
        "conditionOperator": "index-of-true",
        "conditionValue": [valor],
    }


IF_ELSE_STEPS = [
    {"id": "r", "type": "sms", "name": "Passo Antes", "next": "c", "attributes": {"body": "x"}},
    {
        "id": "c",
        "type": "if_else",
        "name": "Condicao Cliente",
        "parentKey": "r",
        "attributes": {
            "if": True,
            "operator": "and",
            "noneBranchName": "None",
            "branches": [
                {
                    "id": "b1",
                    "name": "Clientes VIP",
                    "operator": "and",
                    "segments": [{"__segmentId": "s1", "operator": "and", "conditions": [_cond_tag("vip")]}],
                }
            ],
        },
        "next": ["b1", "e"],
    },
    {"id": "e", "type": "if_else", "name": "None", "parentKey": "c", "attributes": {"else": True}, "next": "a2"},
    {"id": "a1", "type": "sms", "name": "Mensagem para VIP", "parentKey": "b1", "attributes": {"body": "y"}},
    {
        "id": "b1",
        "type": "if_else",
        "name": "Clientes VIP",
        "parentKey": "c",
        "attributes": {"if": False},
        "next": "a1",
    },
    {"id": "a2", "type": "sms", "name": "Mensagem para os demais", "parentKey": "e", "attributes": {"body": "z"}},
]


def test_if_else_ramo_com_passos_indentados(make_dump):
    out = _ficha(make_dump, steps=IF_ELSE_STEPS)
    antes = _linha(out, "Passo Antes")
    container = _linha(out, "Condicao Cliente")
    ramo = _linha(out, "Clientes VIP", depois=container + 1)
    dentro = _linha(out, "Mensagem para VIP")
    outro = _linha(out, "Mensagem para os demais")
    assert antes < container < ramo < dentro
    assert _indent(out, dentro) > _indent(out, ramo)
    assert _indent(out, outro) > _indent(out, container)


def test_if_else_mostra_condicoes_do_ramo(make_dump):
    out = _ficha(make_dump, steps=IF_ELSE_STEPS)
    linhas = out.splitlines()
    ramo = _linha(out, "Clientes VIP", depois=_linha(out, "Condicao Cliente") + 1)
    dentro = _linha(out, "Mensagem para VIP")
    trecho = "\n".join(linhas[ramo : dentro + 1])
    assert "tags" in trecho
    assert "vip" in trecho


FIND_OPP_STEPS = [
    {
        "id": "f",
        "type": "find_opportunity",
        "name": "Busca Oportunidade",
        "attributes": {
            "__customInputFields__": [{"filterField": "pipeline_id", "value": "eq", "secondValue": "PIPE-VENDAS-1"}],
        },
        "next": ["t1", "t2"],
    },
    {"id": "t1", "type": "transition", "name": "Opportunity Found", "parentKey": "f", "next": "a1"},
    {"id": "t2", "type": "transition", "name": "Opportunity Not Found", "parentKey": "f", "next": "a2"},
    {"id": "a1", "type": "sms", "name": "Passo Achou", "parentKey": "t1", "attributes": {"body": "x"}},
    {"id": "a2", "type": "sms", "name": "Passo Nao Achou", "parentKey": "t2", "attributes": {"body": "y"}},
]
PIPELINES = [{"id": "PIPE-VENDAS-1", "name": "Funil Vendas", "stages": [{"id": "STAGE-NOVO-1", "name": "Lead Novo"}]}]


def test_find_opportunity_filtros_e_ramos(make_dump):
    out = _ficha(make_dump, steps=FIND_OPP_STEPS, pipelines=PIPELINES)
    filtro = out.splitlines()[_linha(out, "PIPE-VENDAS-1")]
    assert "pipeline_id" in filtro
    busca = _linha(out, "Busca Oportunidade")
    achou_ramo = _linha(out, "Opportunity Found", depois=busca + 1)
    achou = _linha(out, "Passo Achou")
    nao_ramo = _linha(out, "Opportunity Not Found", depois=busca + 1)
    nao = _linha(out, "Passo Nao Achou")
    assert achou_ramo < achou < nao_ramo < nao
    assert _indent(out, achou) > _indent(out, achou_ramo)
    assert _indent(out, nao) > _indent(out, nao_ramo)


# --- nomes ao lado dos ids --------------------------------------------------------


def test_nome_ao_lado_do_id(make_dump):
    conds = [
        {"field": "pipelineId", "operator": "==", "value": "PIPE-VENDAS-1"},
        {"field": "pipelineStageId", "operator": "==", "value": "STAGE-NOVO-1"},
        {"field": "assignedTo", "operator": "==", "value": "USER-ANA-1"},
        {"field": "workflowId", "operator": "==", "value": "wf-destino"},
    ]
    path = make_dump(
        workflows=[
            _env("w1", "Origem", triggers=[_trigger("opportunity_status_changed", conds)], steps=FIND_OPP_STEPS),
            _env("wf-destino", "Destino Final"),
        ],
        pipelines=PIPELINES,
        users=[{"id": "USER-ANA-1", "name": "Ana Souza"}],
    )
    out = gerar_fichas(load_dump(path), "w1")
    linhas = out.splitlines()
    for ident, nome in [
        ("PIPE-VENDAS-1", "Funil Vendas"),
        ("STAGE-NOVO-1", "Lead Novo"),
        ("USER-ANA-1", "Ana Souza"),
        ("wf-destino", "Destino Final"),
    ]:
        com_id = [ln for ln in linhas if ident in ln]
        assert com_id, f"{ident} não aparece"
        assert all(nome in ln for ln in com_id), f"{ident} sem o nome {nome!r} ao lado: {com_id}"


def test_id_sem_nome_no_dump_aparece_sozinho(make_dump):
    conds = [{"field": "pipelineId", "operator": "==", "value": "PIPE-FANTASMA"}]
    out = _ficha(make_dump, triggers=[_trigger("opportunity_status_changed", conds)], pipelines=PIPELINES)
    assert "pipelineid == pipe-fantasma" in _plano(out)
    assert "Funil Vendas" not in out


# --- CLI -------------------------------------------------------------------------


def test_cli_ficha_imprime_no_stdout(make_dump, capsys):
    path = make_dump(workflows=[_env("w1", "Primeiro Fluxo"), _env("w2", "Segundo Fluxo")])
    codigo = cli.main(["ficha", str(path)])
    out = capsys.readouterr().out
    assert codigo == 0
    assert "Primeiro Fluxo" in out and "Segundo Fluxo" in out


def test_cli_ficha_grava_em_arquivo(make_dump, capsys, tmp_path):
    path = make_dump(workflows=[_env("w1", "Primeiro Fluxo")])
    destino = tmp_path / "fichas.md"
    codigo = cli.main(["ficha", str(path), "-o", str(destino)])
    assert codigo == 0
    assert "Primeiro Fluxo" in destino.read_text(encoding="utf-8")


def test_cli_ficha_workflow_limita(make_dump, capsys):
    path = make_dump(workflows=[_env("w1", "Primeiro Fluxo"), _env("w2", "Segundo Fluxo")])
    codigo = cli.main(["ficha", str(path), "--workflow", "w2"])
    out = capsys.readouterr().out
    assert codigo == 0
    assert "Segundo Fluxo" in out
    assert "Primeiro Fluxo" not in out


def test_cli_ficha_workflow_inexistente_sai_com_erro(make_dump, capsys):
    path = make_dump(workflows=[_env("w1", "Primeiro Fluxo")])
    try:
        codigo = cli.main(["ficha", str(path), "--workflow", "nao-existe"])
    except SystemExit as e:
        codigo = e.code
    saida = capsys.readouterr()
    assert codigo not in (0, None)
    assert "Primeiro Fluxo" not in saida.out
    assert "nao-existe" in saida.err


def test_cli_ficha_dump_sem_workflows(make_dump, capsys):
    path = make_dump(workflows=[])
    codigo = cli.main(["ficha", str(path)])
    assert codigo == 0
    assert "nenhum workflow" in capsys.readouterr().out.lower()
