"""O subcomando `automaster-audit workflow-editar`: a guarda das 18 regras por linha de comando.

Ele não reimplementa nada — repassa para `mcp_server.workflow_editar`, a mesma função
que a tool MCP usa. O que estes testes fixam é o repasse, o JSON na stdout e o código
de saída, que é o que um roteiro lê.
"""
import json

import pytest

from automaster_audit import cli, mcp_server


def _rodar(monkeypatch, capsys, argv, resposta=None, erro=None):
    vistos = {}

    def falso(**kwargs):
        vistos.update(kwargs)
        if erro is not None:
            raise erro
        return resposta

    monkeypatch.setattr(mcp_server, "workflow_editar", falso)
    codigo = cli.main(argv)
    return codigo, vistos, capsys.readouterr()


def test_repassa_todos_os_parametros(monkeypatch, capsys):
    codigo, vistos, saida = _rodar(
        monkeypatch, capsys,
        ["workflow-editar", "-l", "L1", "--acao", "trocar-tag", "-i", "W1",
         "--de", "a", "--para", "b", "--snapshot", "2026-01-01_0000", "--confirmo", "--publicado"],
        resposta={"aplicado": True},
    )
    assert codigo == 0
    assert vistos == {
        "loc": "L1", "acao": "trocar-tag", "id": "W1", "nome": None, "pasta": None,
        "de": "a", "para": "b", "step": None, "caminho": None, "valor": None,
        "trigger_acao": None, "trigger_id": None, "trigger_corpo": None,
        "corpo": None, "depois_de": None, "com_subarvore": False,
        "confirmo": True, "publicado": True, "snapshot": "2026-01-01_0000",
    }
    assert json.loads(saida.out) == {"aplicado": True}


def test_sem_confirmo_a_previa_sai_com_codigo_1(monkeypatch, capsys):
    codigo, vistos, saida = _rodar(
        monkeypatch, capsys,
        ["workflow-editar", "-l", "L1", "--acao", "trocar-tag", "-i", "W1", "--de", "a", "--para", "b"],
        resposta={"aplicado": False, "motivo": "prévia"},
    )
    assert codigo == 1
    assert vistos["confirmo"] is False
    assert json.loads(saida.out)["motivo"] == "prévia"


def test_gravacao_recusada_pela_validacao_sai_com_codigo_1(monkeypatch, capsys):
    codigo, _, saida = _rodar(
        monkeypatch, capsys,
        ["workflow-editar", "-l", "L1", "--acao", "trocar-ref", "-i", "W1",
         "--de", "x" * 20, "--para", "y" * 20, "--confirmo"],
        resposta={"aplicado": False, "motivo": "gravação recusada: ...",
                  "validacao": {"rodou": True, "pode_gravar": False, "erros_novos": ["broken_tag_ref: ..."]}},
    )
    assert codigo == 1
    assert json.loads(saida.out)["validacao"]["pode_gravar"] is False


def test_duvidoso_nao_sai_como_sucesso(monkeypatch, capsys):
    # a releitura não confirmou a escrita: quem lê o código de saída não pode ver 0
    codigo, _, _ = _rodar(
        monkeypatch, capsys,
        ["workflow-editar", "-l", "L1", "--acao", "trocar-tag", "-i", "W1",
         "--de", "a", "--para", "b", "--confirmo"],
        resposta={"aplicado": "duvidoso", "residual": {}},
    )
    assert codigo == 3


def test_tool_error_vira_codigo_2_no_stderr(monkeypatch, capsys):
    codigo, _, saida = _rodar(
        monkeypatch, capsys,
        ["workflow-editar", "-l", "L1", "--acao", "criar", "--nome", "X"],
        erro=mcp_server.ToolError("acao 'criar' exige `pasta`"),
    )
    assert codigo == 2
    assert "exige `pasta`" in saida.err
    assert saida.out == ""


def test_acao_invalida_morre_no_parser(monkeypatch, capsys):
    with pytest.raises(SystemExit):
        cli.main(["workflow-editar", "-l", "L1", "--acao", "inventada"])


def test_subcomando_nao_e_confundido_com_pasta_de_dump(monkeypatch, capsys, tmp_path):
    # o atalho de `main` assume 'audit' quando o 1º argumento é um caminho existente;
    # um diretório chamado 'workflow-editar' no cwd não pode sequestrar o subcomando.
    (tmp_path / "workflow-editar").mkdir()
    monkeypatch.chdir(tmp_path)
    codigo, vistos, _ = _rodar(
        monkeypatch, capsys,
        ["workflow-editar", "-l", "L1", "--acao", "historico", "-i", "W1"],
        resposta={"aplicado": True, "historico": []},
    )
    assert codigo == 0
    assert vistos["acao"] == "historico"
