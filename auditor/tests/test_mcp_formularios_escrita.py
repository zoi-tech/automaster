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
    monkeypatch.setattr(mcp_base, "_load", lambda loc, snap=None: (None, {"loc": loc}))
    return chamadas


def test_acao_exige_confirmo(espiao):
    with pytest.raises(srv.ToolError, match="confirmo=true"):
        srv.formulario_acao(loc="L1", acao="editar", id="F1",
                            ops=[{"op": "remover-campo", "alvo": "email"}])
    assert espiao == []


def test_previa_nao_exige_confirmo(espiao):
    srv.formulario_acao(loc="L1", acao="previa", id="F1",
                        ops=[{"op": "remover-campo", "alvo": "email"}])
    args = espiao[0]
    assert "--confirmo" not in args
    assert args[:5] == ("formulario-acao", "-l", "L1", "--acao", "editar")


def test_acao_invalida(espiao):
    with pytest.raises(srv.ToolError, match="acao inválida"):
        srv.formulario_acao(loc="L1", acao="voar", id="F1", confirmo=True)
    assert espiao == []


def test_editar_sem_ops(espiao):
    with pytest.raises(srv.ToolError, match="ops"):
        srv.formulario_acao(loc="L1", acao="editar", id="F1", confirmo=True)
    assert espiao == []


def test_ops_viram_json_no_argumento(espiao):
    srv.formulario_acao(loc="L1", acao="editar", id="F1", confirmo=True,
                        ops=[{"op": "remover-campo", "alvo": "email"}])
    args = espiao[0]
    assert "--confirmo" in args
    assert '"remover-campo"' in args[args.index("--ops") + 1]


def test_estilo_exige_tokens(espiao):
    with pytest.raises(srv.ToolError, match="tokens"):
        srv.formulario_estilo(loc="L1", acao="aplicar", id="F1", confirmo=True)
    assert espiao == []


def test_estilo_tipo_invalido(espiao):
    with pytest.raises(srv.ToolError, match="tipo inválido"):
        srv.formulario_estilo(loc="L1", acao="paleta-ver", tipo="voar")
    assert espiao == []


def test_paleta_gravar_exige_confirmo(espiao):
    with pytest.raises(srv.ToolError, match="confirmo=true"):
        srv.formulario_estilo(loc="L1", acao="paleta-gravar", tokens={"corPrimaria": "#000000"})
    assert espiao == []


def test_as_duas_tools_estao_declaradas():
    assert "formulario_acao" in srv.TOOLS
    assert "formulario_estilo" in srv.TOOLS
    for nome in ("formulario_acao", "formulario_estilo"):
        _func, desc, _props, req = srv.TOOLS[nome]
        assert "loc" in req and "acao" in req
        assert "ESCREVE" in desc
