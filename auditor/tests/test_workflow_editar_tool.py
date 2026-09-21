import pytest

from automaster_audit import mcp_server


def test_tool_esta_registrada():
    assert "workflow_editar" in mcp_server.TOOLS
    func, descricao, schema, obrigatorios = mcp_server.TOOLS["workflow_editar"]
    assert callable(func)
    assert "loc" in obrigatorios and "acao" in obrigatorios
    assert "ESCREVE" in descricao


def test_acao_invalida_e_recusada_sem_chamar_o_extractor(monkeypatch):
    chamou = []
    monkeypatch.setattr(mcp_server, "_run_extractor", lambda *a: chamou.append(a))
    with pytest.raises(mcp_server.ToolError, match="acao"):
        mcp_server.workflow_editar(loc="L1", acao="explodir", id="W1")
    assert chamou == []


def test_gravar_sem_confirmo_nao_chega_a_escrever(monkeypatch):
    vistos = []

    def falso(*args):
        vistos.append(args)
        return {"aplicado": False, "motivo": "prévia: rode de novo com --confirmo para gravar"}

    monkeypatch.setattr(mcp_server, "_run_extractor", falso)
    r = mcp_server.workflow_editar(loc="L1", acao="trocar-tag", id="W1", de="a", para="b")
    assert r["aplicado"] is False
    assert "--confirmo" not in vistos[0]


def test_confirmo_true_passa_a_flag_para_o_extractor(monkeypatch):
    vistos = []

    def falso(*args):
        vistos.append(args)
        return {"aplicado": True, "registro": "/tmp/x.json"}

    monkeypatch.setattr(mcp_server, "_run_extractor", falso)
    r = mcp_server.workflow_editar(loc="L1", acao="trocar-tag", id="W1", de="a", para="b", confirmo=True)
    assert r["aplicado"] is True
    assert "--confirmo" in vistos[0]
    assert "--json" in vistos[0]
