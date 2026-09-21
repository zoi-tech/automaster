import pytest

from automaster_audit import mcp_server


class _ResultadoFalso:
    def __init__(self, pode_gravar, erros_novos=None, erros_resolvidos=None):
        self.pode_gravar = pode_gravar
        self.erros_novos = erros_novos or []
        self.erros_resolvidos = erros_resolvidos or []


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
    # "L1" não tem dump em disco: cai no caminho "sem dump", que não trava a escrita.
    vistos = []

    def falso(*args):
        vistos.append(args)
        return {"aplicado": True, "registro": "/tmp/x.json"}

    monkeypatch.setattr(mcp_server, "_run_extractor", falso)
    r = mcp_server.workflow_editar(loc="L1", acao="trocar-tag", id="W1", de="a", para="b", confirmo=True)
    assert r["aplicado"] is True
    assert any("--confirmo" in v for v in vistos)
    assert any("--json" in v for v in vistos)
    assert r["validacao"]["rodou"] is False


def test_sem_dump_em_disco_nao_trava_a_escrita(monkeypatch):
    vistos = []

    def falso(*args):
        vistos.append(args)
        if "--confirmo" in args:
            return {"aplicado": True, "registro": "/tmp/x.json"}
        return {"aplicado": False, "motivo": "prévia", "diff": {"x": 1},
                "documento": {"name": "wf"}}

    monkeypatch.setattr(mcp_server, "_run_extractor", falso)

    def sem_dump(loc, snap):
        raise mcp_server.ToolError("subconta sem dump")

    monkeypatch.setattr(mcp_server, "_load", sem_dump)
    r = mcp_server.workflow_editar(loc="L1", acao="trocar-tag", id="W1", de="a", para="b", confirmo=True)
    assert r["aplicado"] is True
    assert len(vistos) == 2
    assert r["validacao"]["rodou"] is False


def test_gravacao_recusada_por_erro_novo_nao_chama_a_segunda_vez(monkeypatch):
    vistos = []

    def falso(*args):
        vistos.append(args)
        return {"aplicado": False, "motivo": "prévia", "diff": {"x": 1},
                "documento": {"name": "wf"}}

    monkeypatch.setattr(mcp_server, "_run_extractor", falso)
    monkeypatch.setattr(mcp_server, "_load", lambda loc, snap: (object(), {"snapshot": "2026-01-01_0000"}))
    monkeypatch.setattr(
        mcp_server, "validar_edicao",
        lambda ctx, wid, doc: _ResultadoFalso(pode_gravar=False, erros_novos=["broken_tag_ref: x"]),
    )
    r = mcp_server.workflow_editar(loc="L1", acao="trocar-tag", id="W1", de="a", para="b", confirmo=True)
    assert r["aplicado"] is False
    assert "broken_tag_ref" in r["motivo"]
    assert r["validacao"]["pode_gravar"] is False
    assert len(vistos) == 1  # só a prévia — a segunda chamada (--confirmo) não aconteceu
    assert not any("--confirmo" in v for v in vistos)


def test_gravacao_passa_pela_validacao_e_grava(monkeypatch):
    vistos = []

    def falso(*args):
        vistos.append(args)
        if "--confirmo" in args:
            return {"aplicado": True, "registro": "/tmp/x.json"}
        return {"aplicado": False, "motivo": "prévia", "diff": {"x": 1},
                "documento": {"name": "wf"}}

    monkeypatch.setattr(mcp_server, "_run_extractor", falso)
    monkeypatch.setattr(mcp_server, "_load", lambda loc, snap: (object(), {"snapshot": "2026-01-01_0000"}))
    monkeypatch.setattr(
        mcp_server, "validar_edicao",
        lambda ctx, wid, doc: _ResultadoFalso(pode_gravar=True),
    )
    r = mcp_server.workflow_editar(loc="L1", acao="trocar-tag", id="W1", de="a", para="b", confirmo=True)
    assert r["aplicado"] is True
    assert r["validacao"]["rodou"] is True
    assert r["validacao"]["pode_gravar"] is True
    assert len(vistos) == 2
    assert any("--confirmo" in v for v in vistos)
