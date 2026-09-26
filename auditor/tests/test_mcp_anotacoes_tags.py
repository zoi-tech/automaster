from typing import ClassVar

import pytest

from automaster_audit import mcp_server as srv
from automaster_audit.mcp import base as mcp_base
from automaster_audit.mcp import tags as mcp_tags
from automaster_audit.mcp_server import ToolError


@pytest.fixture
def espiao(monkeypatch):
    chamadas = []

    def falso(*args):
        chamadas.append(args)
        return {"aplicado": True}

    monkeypatch.setattr(mcp_base, "_run_extractor", falso)
    return chamadas


def test_anotacoes_lista_monta_o_argv(espiao):
    srv.anotacoes("L1", o="lista", tipo="tarefa", contato="C1")
    assert espiao[0][:7] == ("anotacoes", "-l", "L1", "-o", "lista", "--tipo", "tarefa")
    assert "--contato" in espiao[0] and "C1" in espiao[0]


def test_anotacoes_recusa_op_invalida(espiao):
    with pytest.raises(ToolError):
        srv.anotacoes("L1", o="inventada", contato="C1")
    assert espiao == []


def test_anotacoes_exige_contato_fora_da_busca(espiao):
    with pytest.raises(ToolError):
        srv.anotacoes("L1", o="lista")
    assert espiao == []


def test_anotacoes_busca_dispensa_contato_mas_exige_tarefa(espiao):
    srv.anotacoes("L1", o="buscar", tipo="tarefa", concluidas=False)
    assert espiao[0][0] == "anotacoes"
    with pytest.raises(ToolError):
        srv.anotacoes("L1", o="buscar", tipo="nota")


def test_anotacao_acao_sem_confirmo_nao_manda_a_flag(espiao):
    srv.anotacao_acao("L1", acao="criar", tipo="nota", contato="C1", texto="oi")
    assert "--confirmo" not in espiao[0]


def test_anotacao_acao_com_confirmo_manda_a_flag(espiao):
    srv.anotacao_acao("L1", acao="criar", tipo="nota", contato="C1", texto="oi", confirmo=True)
    assert "--confirmo" in espiao[0]


def test_criar_tarefa_exige_titulo_e_prazo(espiao):
    with pytest.raises(ToolError):
        srv.anotacao_acao("L1", acao="criar", tipo="tarefa", contato="C1", titulo="T")
    assert espiao == []


def test_concluir_so_existe_para_tarefa(espiao):
    with pytest.raises(ToolError):
        srv.anotacao_acao("L1", acao="concluir", tipo="nota", contato="C1", id="N1")
    assert espiao == []


def test_editar_exige_id(espiao):
    with pytest.raises(ToolError):
        srv.anotacao_acao("L1", acao="editar", tipo="nota", contato="C1", texto="x")
    assert espiao == []


def test_contrato_das_tools_de_anotacao():
    for nome in ("anotacoes", "anotacao_acao"):
        assert nome in srv.TOOLS
        func, desc, props, obrig = srv.TOOLS[nome]
        assert callable(func) and desc and "loc" in props and "loc" in obrig


def test_tags_cruza_com_o_indice_reverso(monkeypatch):
    monkeypatch.setattr(
        mcp_base,
        "_run_extractor",
        lambda *a: {"total": 2, "tags": [{"id": "T1", "name": "Alfa"}, {"id": "T2", "name": "beta"}]},
    )
    monkeypatch.setattr(mcp_base, "_load", lambda loc, snap=None: (_CtxFalso(), {"snapshot": "S"}))
    monkeypatch.setattr(
        mcp_base,
        "_dash",
        lambda p: {
            "tags": [
                {"name": "alfa", "used_by": ["WF um", "WF dois"], "papeis": ["adiciona", "dispara"], "orphan": False},
            ]
        },
    )
    r = srv.tags("L1")
    por_nome = {t["name"]: t for t in r["tags"]}
    # o cruzamento ignora maiúscula: "Alfa" ao vivo casa com "alfa" do índice
    assert por_nome["Alfa"]["workflows"] == ["WF dois", "WF um"]
    assert por_nome["Alfa"]["papeis"] == ["adiciona", "dispara"]
    assert por_nome["beta"]["workflows"] == []
    assert r["_snapshot"]["snapshot"] == "S"


def test_tags_degrada_sem_dump(monkeypatch):
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: {"total": 1, "tags": [{"id": "T1", "name": "alfa"}]})

    def sem_dump(loc, snap=None):
        raise ToolError("nenhum dump para L1")

    monkeypatch.setattr(mcp_base, "_load", sem_dump)
    r = srv.tags("L1")
    assert r["tags"][0]["workflows"] is None
    assert "sem dump" in r["aviso"].lower()


def test_tag_acao_apagar_citada_exige_a_guarda(monkeypatch):
    chamadas = []
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: chamadas.append(a) or {"ok": True})
    monkeypatch.setattr(
        mcp_tags,
        "_impacto_tags",
        lambda loc, snap=None: ({"alfa": {"workflows": ["WF um"], "papeis": ["dispara"]}}, None),
    )
    with pytest.raises(ToolError) as e:
        srv.tag_acao("L1", acao="apagar", tag="alfa", confirmo=True)
    assert "WF um" in str(e.value)
    assert chamadas == []
    srv.tag_acao("L1", acao="apagar", tag="alfa", confirmo=True, apagar_citada=True)
    assert chamadas and "--confirmo" in chamadas[0]


def test_tag_acao_renomear_nao_exige_guarda(monkeypatch):
    chamadas = []
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: chamadas.append(a) or {"ok": True})
    monkeypatch.setattr(
        mcp_tags,
        "_impacto_tags",
        lambda loc, snap=None: ({"alfa": {"workflows": ["WF um"], "papeis": ["dispara"]}}, None),
    )
    srv.tag_acao("L1", acao="renomear", tag="alfa", nome="gama", confirmo=True)
    assert "--confirmo" in chamadas[0]


def test_tag_acao_valida_os_argumentos(espiao):
    with pytest.raises(ToolError):
        srv.tag_acao("L1", acao="inventada", tag="x")
    with pytest.raises(ToolError):
        srv.tag_acao("L1", acao="criar")
    with pytest.raises(ToolError):
        srv.tag_acao("L1", acao="renomear", tag="alfa")
    assert espiao == []


def test_contrato_das_tools_de_tag():
    for nome in ("tags", "tag_acao"):
        assert nome in srv.TOOLS
        func, desc, props, obrig = srv.TOOLS[nome]
        assert callable(func) and desc and "loc" in props and "loc" in obrig


class _CtxFalso:
    path = "/tmp/dump-falso"
    workflows: ClassVar[list] = []
