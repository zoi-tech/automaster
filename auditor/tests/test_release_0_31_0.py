"""Release 0.31.0 (painéis/dashboards): versões, CHANGELOG, CLAUDE.md e endpoints.md."""

import json
import re
import tomllib
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
ALVO = "0.31.0"


def _secao(texto: str, titulo: str, nivel: str = "##") -> str:
    """Corpo da seção cujo título começa com `titulo`, até o próximo título do mesmo nível."""
    m = re.search(rf"^{nivel} {re.escape(titulo)}\b.*$", texto, re.MULTILINE)
    assert m, f"seção '{nivel} {titulo}' não existe"
    resto = texto[m.end() :]
    fim = re.search(rf"^{nivel} ", resto, re.MULTILINE)
    return resto[: fim.start()] if fim else resto


def _ler(rel: str) -> str:
    return (RAIZ / rel).read_text(encoding="utf-8")


def test_os_tres_manifestos_estao_em_0_31_0():
    v = {
        "plugin.json": json.loads(_ler(".claude-plugin/plugin.json"))["version"],
        "package.json": json.loads(_ler("extractor/package.json"))["version"],
        "pyproject.toml": tomllib.loads(_ler("auditor/pyproject.toml"))["project"]["version"],
    }
    assert v == {k: ALVO for k in v}, v


def test_changelog_0_31_0_cita_o_que_entrou():
    s = _secao(_ler("CHANGELOG.md"), ALVO).lower()
    for termo in ("dashboard-acao", "dashboard-ver", "dashboard-conferir", "automaster-dashboard"):
        assert termo in s, f"CHANGELOG 0.31.0 não cita {termo}"
    assert "painéis" in s or "paineis" in s or "dashboards" in s


def test_changelog_0_31_0_registra_as_pendencias():
    s = _secao(_ler("CHANGELOG.md"), ALVO).lower()
    assert "e-mail" in s and "rota" in s and "não encontrada" in s, "falta a pendência do e-mail"
    assert "meta" in s and "token" in s, "falta a pendência do token Meta"


def test_claude_md_lista_os_comandos_de_dashboard_na_secao_comandos():
    s = _secao(_ler("CLAUDE.md"), "Comandos")
    for cmd in ("dashboards", "dashboard-acao", "dashboard-ver", "dashboard-conferir"):
        assert re.search(rf"npm run {cmd}\b", s), f"'npm run {cmd}' falta na seção Comandos"


def test_claude_md_diz_36_tools_e_cita_o_modulo_paineis():
    t = _ler("CLAUDE.md")
    assert re.search(r"trinta e seis|\b36 tools", t), "contagem de tools não subiu para 36"
    assert not re.search(r"trinta e duas|\b32 tools", t), "sobrou a contagem antiga de 32 tools"
    assert "`paineis`" in t, "módulo paineis não citado"


def test_endpoints_tem_as_subsecoes_de_dashboards():
    s = _secao(_ler("docs/endpoints.md"), "Dashboards")
    titulos = re.findall(r"^#{3,4} (.+)$", s, re.MULTILINE)
    for nome in ("Leitura", "Escrita", "Publicar", "Conferência"):
        assert any(t.startswith(nome) for t in titulos), f"subseção '{nome}' falta em Dashboards"
