"""Etapa 3: cada tag, campo, funil e usuário ganha `usos` com o papel por workflow."""

from conftest import wf

from automaster_audit.dashboard import build_dashboard
from automaster_audit.loader import load_dump


def _add_tag(name, t="add_contact_tag"):
    return {"type": t, "name": "Tag", "attributes": {"tags": [name]}}


def _cond_tag(name):
    cond = {"conditionType": "contact_detail", "conditionSubType": "tags", "conditionValue": [name]}
    return {"type": "if_else", "name": "Se", "attributes": {"branches": [{"segments": [{"conditions": [cond]}]}]}}


def _por_nome(itens, nome):
    return next(i for i in itens if i["name"] == nome)


def _sem_usos(item):
    return {k: v for k, v in item.items() if k != "usos"}


def test_tag_dois_workflows_papeis_separados_e_ordem_por_nome(make_dump):
    # "Beta" entra antes no dump: a ordem da saída tem que vir do nome, não da iteração
    path = make_dump(
        workflows=[
            wf(id="wb", name="Beta", steps=[_add_tag("vip")]),
            wf(id="wa", name="Alfa", steps=[_cond_tag("vip")]),
        ],
        tags=["vip"],
    )
    t = _por_nome(build_dashboard(load_dump(path))["tags"], "vip")
    assert t["usos"] == [
        {"workflow_id": "wa", "workflow": "Alfa", "papeis": ["condicao"]},
        {"workflow_id": "wb", "workflow": "Beta", "papeis": ["adiciona"]},
    ]


def test_tag_campos_antigos_intactos(make_dump):
    path = make_dump(
        workflows=[
            wf(id="wb", name="Beta", steps=[_add_tag("vip")]),
            wf(id="wa", name="Alfa", steps=[_cond_tag("vip")]),
        ],
        tags=["vip", "sobra"],
    )
    d = build_dashboard(load_dump(path))
    assert _sem_usos(_por_nome(d["tags"], "vip")) == {
        "name": "vip",
        "used_by": ["Alfa", "Beta"],
        "orphan": False,
        "papeis": ["adiciona", "condicao"],
    }
    orfa = _por_nome(d["tags"], "sobra")
    assert orfa["usos"] == []
    assert _sem_usos(orfa) == {"name": "sobra", "used_by": [], "orphan": True, "papeis": []}


def test_tag_papeis_do_mesmo_workflow_ordenados(make_dump):
    steps = [_add_tag("vip", "remove_contact_tag"), _add_tag("vip")]
    path = make_dump(workflows=[wf(id="w1", name="Um", steps=steps)], tags=["vip"])
    t = _por_nome(build_dashboard(load_dump(path))["tags"], "vip")
    assert t["usos"] == [{"workflow_id": "w1", "workflow": "Um", "papeis": ["adiciona", "remove"]}]


def test_campo_escrito_tem_papel_escreve(make_dump):
    step = {"type": "update_contact_field", "name": "Campo", "attributes": {"fields": [{"field": "F1", "value": "x"}]}}
    path = make_dump(
        workflows=[wf(id="w1", name="Um", steps=[step])],
        fields=[{"id": "F1", "name": "Etapa"}, {"id": "F2", "name": "Outro"}],
    )
    d = build_dashboard(load_dump(path))
    f = _por_nome(d["fields"], "Etapa")
    assert f["usos"] == [{"workflow_id": "w1", "workflow": "Um", "papeis": ["escreve"]}]
    assert _sem_usos(f) == {"name": "Etapa", "used_by": ["Um"], "orphan": False}
    outro = _por_nome(d["fields"], "Outro")
    assert outro["usos"] == []
    assert _sem_usos(outro) == {"name": "Outro", "used_by": [], "orphan": True}


def test_funil_cria_e_busca(make_dump):
    cria = {"type": "internal_create_opportunity", "name": "Cria", "attributes": {"pipelineId": "P1"}}
    busca = {
        "type": "find_opportunity",
        "name": "Busca",
        "attributes": {"__customInputFields__": [{"filterField": "pipeline_id", "secondValue": "P1"}]},
    }
    path = make_dump(
        workflows=[wf(id="wz", name="Zeta", steps=[cria]), wf(id="wa", name="Alfa", steps=[busca])],
        pipelines=[{"id": "P1", "name": "Vendas", "stages": [{"id": "S1"}]}],
    )
    p = _por_nome(build_dashboard(load_dump(path))["pipelines"], "Vendas")
    assert p["usos"] == [
        {"workflow_id": "wa", "workflow": "Alfa", "papeis": ["busca"]},
        {"workflow_id": "wz", "workflow": "Zeta", "papeis": ["cria"]},
    ]
    assert _sem_usos(p) == {"name": "Vendas", "used_by": ["Alfa", "Zeta"]}


def test_funil_cria_e_busca_no_mesmo_workflow(make_dump):
    cria = {"type": "internal_create_opportunity", "name": "Cria", "attributes": {"pipelineId": "P1"}}
    busca = {
        "type": "find_opportunity",
        "name": "Busca",
        "attributes": {"__customInputFields__": [{"filterField": "pipeline_id", "secondValue": "P1"}]},
    }
    path = make_dump(
        workflows=[wf(id="w1", name="Um", steps=[cria, busca])],
        pipelines=[{"id": "P1", "name": "Vendas", "stages": [{"id": "S1"}]}],
    )
    p = _por_nome(build_dashboard(load_dump(path))["pipelines"], "Vendas")
    assert p["usos"] == [{"workflow_id": "w1", "workflow": "Um", "papeis": ["busca", "cria"]}]


def test_usuario_atribui_e_notifica(make_dump):
    peso = {"type": "assign_user", "name": "Atribui", "attributes": {"traffic_weightage": {"U1": 50}}}
    indice = {"type": "assign_user", "name": "Atribui", "attributes": {"traffic_index": [{"id": "U2"}]}}
    notif = {"type": "internal_notification", "name": "Avisa", "attributes": {"sms": {"selectedUser": ["U1"]}}}
    path = make_dump(
        workflows=[
            wf(id="wb", name="Beta", steps=[notif]),
            wf(id="wa", name="Alfa", steps=[peso, indice]),
        ],
        users=[
            {"id": "U1", "name": "Ana", "email": "a@x"},
            {"id": "U2", "name": "Bia", "email": "b@x"},
            {"id": "U3", "name": "Caio", "email": "c@x"},
        ],
    )
    d = build_dashboard(load_dump(path))
    ana = _por_nome(d["users"], "Ana")
    assert ana["usos"] == [
        {"workflow_id": "wa", "workflow": "Alfa", "papeis": ["atribui"]},
        {"workflow_id": "wb", "workflow": "Beta", "papeis": ["notifica"]},
    ]
    assert _sem_usos(ana) == {
        "name": "Ana",
        "email": "a@x",
        "deleted": False,
        "used_by": ["Alfa", "Beta"],
        "orphan": False,
    }
    assert _por_nome(d["users"], "Bia")["usos"] == [{"workflow_id": "wa", "workflow": "Alfa", "papeis": ["atribui"]}]
    caio = _por_nome(d["users"], "Caio")
    assert caio["usos"] == [] and caio["orphan"] is True and caio["used_by"] == []


def test_usuario_atribui_e_notifica_no_mesmo_workflow(make_dump):
    peso = {"type": "assign_user", "name": "Atribui", "attributes": {"traffic_weightage": {"U1": 50}}}
    notif = {"type": "internal_notification", "name": "Avisa", "attributes": {"sms": {"selectedUser": ["U1"]}}}
    path = make_dump(
        workflows=[wf(id="w1", name="Um", steps=[notif, peso])],
        users=[{"id": "U1", "name": "Ana", "email": "a@x"}],
    )
    ana = _por_nome(build_dashboard(load_dump(path))["users"], "Ana")
    assert ana["usos"] == [{"workflow_id": "w1", "workflow": "Um", "papeis": ["atribui", "notifica"]}]
