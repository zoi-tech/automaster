"""Etapa 8 do plano de dashboards: as 4 tools MCP do módulo `mcp/paineis.py`.

Assinaturas (reexportadas por `mcp_server`, como as de formularios):
  dashboards(loc, o="lista", id=None, widget=None)
      -> extractor `dashboards -l LOC -o O [-i ID] [--widget W] --json`. o: lista|detalhe|catalogo|versoes|dados|fuso.
  dashboard_acao(loc, acao, id=None, titulo=None, plano=None, tema=None, versao=None, versao_esperada=None,
                 papeis=None, forcar=False, confirmo=False)
      -> `dashboard-acao -l LOC --acao ACAO [-i] [--titulo] [--plano JSON] [--tema JSON] [--versao]
         [--versao-esperada N] [--papeis "a:read,b:read"] [--forcar] [--confirmo] --json`.
      acao: criar|editar|tema|renomear|apagar|restaurar|publicar. `plano`/`tema` chegam como dict e vão como JSON;
      `papeis` chega como lista ["account_admin:read", ...] ou texto e vai como texto separado por vírgula.
      Sem confirmo: chama SEM --confirmo (prévia). Com confirmo: passa --confirmo e exige versao_esperada
      (exceto criar). Recusas locais (ToolError, extractor não é chamado): acao inválida, id ausente
      (todas menos criar), criar sem titulo, renomear sem titulo, editar sem plano, tema sem tema,
      restaurar sem versao, publicar sem papeis, papel inválido.
  dashboard_ver(loc, id) -> `dashboard-ver -l LOC -i ID --json`; devolve o dict do extractor (caminho do PNG).
  dashboard_conferir(loc, id, dias=None) -> `dashboard-conferir -l LOC -i ID [--dias N] --json`.
TOOLS: nome -> (função, descrição, props, obrigatórios). Obrigatórios: dashboards [loc]; dashboard_acao [loc, acao];
dashboard_ver e dashboard_conferir [loc, id]. A descrição do dashboard_acao contém "ESCREVE".
O erro login_pendente de dashboard_ver chega com a dica do `--login` (o perfil de tela, não a janela do
Chrome da dica genérica de `_DICAS_SESSAO`).
"""

import json
import subprocess
from pathlib import Path

import pytest

from automaster_audit import mcp_server as srv
from automaster_audit.mcp import base as mcp_base

RAIZ = Path(__file__).resolve().parents[2]
NOMES = ("dashboards", "dashboard_acao", "dashboard_ver", "dashboard_conferir")


@pytest.fixture
def espiao(monkeypatch):
    chamadas = []

    def falso(*args):
        chamadas.append(args)
        return {"aplicado": True, "png": "/tmp/p.png"}

    monkeypatch.setattr(mcp_base, "_run_extractor", falso)
    monkeypatch.setattr(mcp_base, "_load", lambda loc, snap=None: (None, {"loc": loc}))
    return chamadas


def _valor(args, flag):
    return args[args.index(flag) + 1]


# ---------- declaração ----------


def test_as_quatro_tools_estao_declaradas():
    for nome in NOMES:
        assert nome in srv.TOOLS, nome
        assert callable(getattr(srv, nome)), f"{nome} não reexportada por mcp_server"
    assert set(srv.TOOLS["dashboards"][3]) == {"loc"}
    assert set(srv.TOOLS["dashboard_acao"][3]) == {"loc", "acao"}
    assert set(srv.TOOLS["dashboard_ver"][3]) == {"loc", "id"}
    assert set(srv.TOOLS["dashboard_conferir"][3]) == {"loc", "id"}


def test_descricao_do_dashboard_acao_diz_escreve():
    assert "ESCREVE" in srv.TOOLS["dashboard_acao"][1]


def test_o_servidor_tem_trinta_e_seis_tools_e_o_plugin_diz_36():
    assert len(srv.TOOLS) == 36
    plugin = json.loads((RAIZ / ".claude-plugin" / "plugin.json").read_text(encoding="utf-8"))
    assert "36 tools" in plugin["description"]
    assert "32 tools" not in plugin["description"]


def test_a_skill_de_leitura_lista_as_quatro_tools():
    linhas = (RAIZ / "skills" / "automaster-leitura" / "SKILL.md").read_text(encoding="utf-8").splitlines()
    cabecalho = "\n".join(linhas[:6])  # frontmatter: a descrição lista as tools
    for nome in NOMES:
        assert nome in cabecalho, nome


# ---------- dashboards (leitura) ----------


def test_dashboards_monta_o_comando(espiao):
    srv.dashboards(loc="L1", o="dados", id="P1", widget="w9")
    args = espiao[0]
    assert args[0] == "dashboards" and _valor(args, "-l") == "L1"
    assert _valor(args, "-o") == "dados" and _valor(args, "-i") == "P1" and _valor(args, "--widget") == "w9"
    assert "--json" in args and "--confirmo" not in args


def test_dashboards_padrao_e_lista_sem_id(espiao):
    srv.dashboards(loc="L1")
    args = espiao[0]
    assert _valor(args, "-o") == "lista" and "-i" not in args and "--widget" not in args


def test_dashboards_op_invalida(espiao):
    with pytest.raises(srv.ToolError, match="inválid"):
        srv.dashboards(loc="L1", o="voar")
    assert espiao == []


@pytest.mark.parametrize("o", ["detalhe", "versoes", "dados"])
def test_dashboards_ops_por_painel_exigem_id(espiao, o):
    with pytest.raises(srv.ToolError, match="id"):
        srv.dashboards(loc="L1", o=o)
    assert espiao == []


# ---------- dashboard_acao ----------


def test_acao_invalida(espiao):
    with pytest.raises(srv.ToolError, match="acao inválida"):
        srv.dashboard_acao(loc="L1", acao="voar", id="P1", confirmo=True, versao_esperada=1)
    assert espiao == []


def test_previa_sem_confirmo_chama_sem_confirmo_e_sem_versao(espiao):
    srv.dashboard_acao(loc="L1", acao="renomear", id="P1", titulo="Novo")
    args = espiao[0]
    assert args[0] == "dashboard-acao" and _valor(args, "--acao") == "renomear"
    assert _valor(args, "-l") == "L1" and _valor(args, "-i") == "P1" and _valor(args, "--titulo") == "Novo"
    assert "--confirmo" not in args and "--json" in args


def test_confirmo_passa_a_flag_e_a_versao_esperada(espiao):
    srv.dashboard_acao(loc="L1", acao="apagar", id="P1", confirmo=True, versao_esperada=7)
    args = espiao[0]
    assert "--confirmo" in args and _valor(args, "--versao-esperada") == "7"


@pytest.mark.parametrize("acao", ["editar", "tema", "renomear", "apagar", "restaurar", "publicar"])
def test_confirmo_sem_versao_esperada_recusa_sem_chamar(espiao, acao):
    with pytest.raises(srv.ToolError, match="versao_esperada"):
        srv.dashboard_acao(
            loc="L1",
            acao=acao,
            id="P1",
            titulo="t",
            plano={"layout": []},
            tema={"metricColor": "#000000"},
            versao=2,
            papeis=["account_user:read"],
            confirmo=True,
        )
    assert espiao == []


def test_criar_com_confirmo_nao_exige_versao_esperada(espiao):
    srv.dashboard_acao(loc="L1", acao="criar", titulo="ZZ TESTE AUTOMASTER x", confirmo=True)
    args = espiao[0]
    assert "--confirmo" in args and "--versao-esperada" not in args and "-i" not in args
    assert _valor(args, "--titulo") == "ZZ TESTE AUTOMASTER x"


@pytest.mark.parametrize(
    "acao,kw,trecho",
    [
        ("criar", {}, "titulo"),
        ("renomear", {"id": "P1"}, "titulo"),
        ("editar", {"id": "P1"}, "plano"),
        ("tema", {"id": "P1"}, "tema"),
        ("restaurar", {"id": "P1"}, "versao"),
        ("apagar", {}, "id"),
        ("publicar", {"id": "P1"}, "papeis"),
    ],
)
def test_recusas_locais_de_argumento_faltando(espiao, acao, kw, trecho):
    with pytest.raises(srv.ToolError, match=trecho):
        srv.dashboard_acao(loc="L1", acao=acao, **kw)
    assert espiao == []


def test_plano_e_tema_viram_json(espiao):
    srv.dashboard_acao(loc="L1", acao="editar", id="P1", plano={"remover": ["w2"]})
    assert json.loads(_valor(espiao[0], "--plano")) == {"remover": ["w2"]}
    srv.dashboard_acao(loc="L1", acao="tema", id="P1", tema={"metricColor": "#003366"})
    assert json.loads(_valor(espiao[1], "--tema")) == {"metricColor": "#003366"}


def test_restaurar_passa_a_versao(espiao):
    srv.dashboard_acao(loc="L1", acao="restaurar", id="P1", versao=3)
    assert _valor(espiao[0], "--versao") == "3"


def test_publicar_previa_passa_papeis_em_texto(espiao):
    srv.dashboard_acao(loc="L1", acao="publicar", id="P1", papeis=["account_admin:read", "account_user:read"])
    args = espiao[0]
    assert _valor(args, "--acao") == "publicar"
    assert _valor(args, "--papeis") == "account_admin:read,account_user:read"
    assert "--confirmo" not in args and "--forcar" not in args


def test_publicar_aceita_papeis_ja_em_texto(espiao):
    srv.dashboard_acao(loc="L1", acao="publicar", id="P1", papeis="account_user:read")
    assert _valor(espiao[0], "--papeis") == "account_user:read"


def test_publicar_confirmo_e_forcar(espiao):
    srv.dashboard_acao(
        loc="L1", acao="publicar", id="P1", papeis=["account_user:read"], confirmo=True, versao_esperada=4, forcar=True
    )
    args = espiao[0]
    assert "--confirmo" in args and "--forcar" in args and _valor(args, "--versao-esperada") == "4"


@pytest.mark.parametrize("papeis", [["dono:read"], ["account_user:voar"], ["account_admin"], []])
def test_publicar_papel_invalido_recusa_sem_chamar(espiao, papeis):
    with pytest.raises(srv.ToolError, match="papel|papeis"):
        srv.dashboard_acao(loc="L1", acao="publicar", id="P1", papeis=papeis, confirmo=True, versao_esperada=1)
    assert espiao == []


def test_forcar_so_vai_quando_pedido(espiao):
    srv.dashboard_acao(loc="L1", acao="apagar", id="P1")
    assert "--forcar" not in espiao[0]


# ---------- dashboard_ver e dashboard_conferir ----------


def test_ver_monta_o_comando_e_devolve_o_resultado(espiao):
    r = srv.dashboard_ver(loc="L1", id="P1")
    args = espiao[0]
    assert args[0] == "dashboard-ver" and _valor(args, "-l") == "L1" and _valor(args, "-i") == "P1"
    assert "--json" in args and "--confirmo" not in args
    assert r["png"] == "/tmp/p.png"


def test_conferir_monta_o_comando(espiao):
    srv.dashboard_conferir(loc="L1", id="P1", dias=7)
    args = espiao[0]
    assert args[0] == "dashboard-conferir" and _valor(args, "-i") == "P1" and _valor(args, "--dias") == "7"
    assert "--json" in args and "--confirmo" not in args


def test_conferir_sem_dias_nao_manda_a_flag(espiao):
    srv.dashboard_conferir(loc="L1", id="P1")
    assert "--dias" not in espiao[0]


def _extractor(monkeypatch, tmp_path, stdout, returncode=0):
    tsx = tmp_path / "node_modules" / ".bin" / "tsx"
    tsx.parent.mkdir(parents=True, exist_ok=True)
    tsx.write_text("")
    monkeypatch.setattr(mcp_base, "EXTRACTOR_DIR", tmp_path)
    monkeypatch.setattr(
        mcp_base.subprocess,
        "run",
        lambda cmd, **kw: subprocess.CompletedProcess(cmd, returncode, stdout=stdout, stderr=""),
    )


def test_login_pendente_do_ver_chega_com_a_dica_do_login(monkeypatch, tmp_path):
    _extractor(
        monkeypatch,
        tmp_path,
        '{"ok": false, "error": {"code": "login_pendente", "message": "o perfil de tela não está logado"}}',
        returncode=1,
    )
    with pytest.raises(srv.ToolError) as e:
        srv.dashboard_ver(loc="L1", id="P1")
    msg = str(e.value)
    assert "login_pendente" in msg
    assert "--login" in msg and "dashboard-ver" in msg


def test_login_pendente_de_outra_tool_continua_com_a_dica_antiga(monkeypatch, tmp_path):
    _extractor(
        monkeypatch, tmp_path, '{"ok": false, "error": {"code": "login_pendente", "message": "x"}}', returncode=1
    )
    with pytest.raises(srv.ToolError) as e:
        srv.dashboards(loc="L1")
    assert "janela do Chrome" in str(e.value)
