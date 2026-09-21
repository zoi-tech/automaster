import pytest
from automaster_audit import mcp_server as srv
from automaster_audit.mcp import base as mcp_base


@pytest.fixture
def espiao(monkeypatch):
    chamadas = []

    def falso(*args):
        chamadas.append(args)
        return {"aplicado": True}

    monkeypatch.setattr(mcp_base, "_run_extractor", falso)
    # nenhum _load aqui de propósito: estas tools não podem depender de dump
    monkeypatch.setattr(mcp_base, "_load", lambda loc, snap=None: pytest.fail(
        "tool ao vivo de workflow não pode chamar o loader"))
    return chamadas


def test_leitura_lista_monta_os_argumentos(espiao):
    srv.workflows_ao_vivo(loc="L1")
    assert espiao[0] == ("workflows-ao-vivo", "-l", "L1", "-o", "lista", "--json")


def test_leitura_dentro_exige_id(espiao):
    with pytest.raises(srv.ToolError, match="id"):
        srv.workflows_ao_vivo(loc="L1", o="dentro")
    assert espiao == []


def test_leitura_contato_exige_contato(espiao):
    with pytest.raises(srv.ToolError, match="contato"):
        srv.workflows_ao_vivo(loc="L1", o="contato")
    assert espiao == []


def test_leitura_o_invalido(espiao):
    with pytest.raises(srv.ToolError, match="o inválido"):
        srv.workflows_ao_vivo(loc="L1", o="voar")
    assert espiao == []


def test_leitura_passa_limite_e_nomes(espiao):
    srv.workflows_ao_vivo(loc="L1", o="dentro", id="W1", limite=50, nomes=True)
    args = espiao[0]
    assert "--limite" in args and args[args.index("--limite") + 1] == "50"
    assert "--nomes" in args


def test_leitura_sem_nomes_nao_manda_a_flag(espiao):
    srv.workflows_ao_vivo(loc="L1", o="dentro", id="W1")
    assert "--nomes" not in espiao[0]


def test_leitura_nao_traz_snapshot(espiao):
    out = srv.workflows_ao_vivo(loc="L1")
    assert "_snapshot" not in out


def test_acao_exige_confirmo(espiao):
    with pytest.raises(srv.ToolError, match="confirmo=true"):
        srv.workflow_acao(loc="L1", acao="publicar", id="W1", status="draft")
    assert espiao == []


def test_acao_invalida(espiao):
    with pytest.raises(srv.ToolError, match="acao inválida"):
        srv.workflow_acao(loc="L1", acao="voar", id="W1", confirmo=True)
    assert espiao == []


def test_publicar_exige_status_valido(espiao):
    with pytest.raises(srv.ToolError, match="status"):
        srv.workflow_acao(loc="L1", acao="publicar", id="W1", confirmo=True)
    with pytest.raises(srv.ToolError, match="status inválido"):
        srv.workflow_acao(loc="L1", acao="publicar", id="W1", status="voando", confirmo=True)
    assert espiao == []


def test_inscrever_exige_contato(espiao):
    with pytest.raises(srv.ToolError, match="contato"):
        srv.workflow_acao(loc="L1", acao="inscrever", id="W1", confirmo=True)
    assert espiao == []


def test_retomar_aceita_contato_ou_inscricao(espiao):
    srv.workflow_acao(loc="L1", acao="retomar", id="W1", inscricao="S1", confirmo=True)
    assert "--inscricao" in espiao[0]
    srv.workflow_acao(loc="L1", acao="retomar", id="W1", contato="C1", confirmo=True)
    assert "--contato" in espiao[1]
    with pytest.raises(srv.ToolError, match="inscricao"):
        srv.workflow_acao(loc="L1", acao="retomar", id="W1", confirmo=True)


def test_acao_monta_os_argumentos_com_confirmo(espiao):
    srv.workflow_acao(loc="L1", acao="remover", id="W1", contato="C1", confirmo=True)
    args = espiao[0]
    assert args[:6] == ("workflow-acao", "-l", "L1", "--acao", "remover", "--confirmo")
    assert "--json" in args


def test_as_duas_tools_estao_declaradas():
    for nome in ("workflows_ao_vivo", "workflow_acao"):
        assert nome in srv.TOOLS
    func, desc, props, req = srv.TOOLS["workflow_acao"]
    assert "ESCREVE" in desc
    assert req == ["loc", "acao", "id"]
    assert "snapshot" not in props, "tool ao vivo de workflow não usa dump"


def test_tool_do_dump_avisa_que_e_do_dump():
    _, desc, _, _ = srv.TOOLS["workflow"]
    assert "dump" in desc.lower()
