import pytest
from automaster_audit import mcp_server as srv
from automaster_audit.mcp_server import ToolError


@pytest.fixture
def espiao(monkeypatch):
    chamadas = []

    def falso(*args):
        chamadas.append(args)
        return {"aplicado": True}

    monkeypatch.setattr(srv, "_run_extractor", falso)
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
