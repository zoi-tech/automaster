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


def _versao_minima_ok(versoes, minimo):
    # Import local: se o módulo faltar, só os testes de versão quebram, não o arquivo inteiro.
    from automaster_audit.versao import versao_minima_ok

    return versao_minima_ok(versoes, minimo)


def test_os_tres_manifestos_tem_a_mesma_versao_e_ao_menos_0_31_0():
    v = {
        "plugin.json": json.loads(_ler(".claude-plugin/plugin.json"))["version"],
        "package.json": json.loads(_ler("extractor/package.json"))["version"],
        "pyproject.toml": tomllib.loads(_ler("auditor/pyproject.toml"))["project"]["version"],
    }
    assert _versao_minima_ok(v, (0, 31, 0)) is True, v


def test_versao_minima_ok_tres_iguais_acima_do_minimo():
    v = {"a": "0.31.1", "b": "0.31.1", "c": "0.31.1"}
    assert _versao_minima_ok(v, (0, 31, 0)) is True


def test_versao_minima_ok_tres_iguais_ao_minimo():
    v = {"a": "0.31.0", "b": "0.31.0", "c": "0.31.0"}
    assert _versao_minima_ok(v, (0, 31, 0)) is True


def test_versao_minima_ok_reprova_uma_abaixo_do_minimo():
    v = {"a": "0.31.1", "b": "0.31.1", "c": "0.30.9"}
    assert _versao_minima_ok(v, (0, 31, 0)) is False


def test_versao_minima_ok_reprova_tres_iguais_abaixo_do_minimo():
    # Pega quem só confere igualdade e quem compara só major.minor.
    v = {"a": "0.31.0", "b": "0.31.0", "c": "0.31.0"}
    assert _versao_minima_ok(v, (0, 31, 1)) is False


def test_versao_minima_ok_reprova_versoes_diferentes_mesmo_acima_do_minimo():
    v = {"a": "0.31.1", "b": "0.32.0", "c": "0.31.1"}
    assert _versao_minima_ok(v, (0, 31, 0)) is False


def test_versao_minima_ok_compara_numeros_e_nao_texto():
    # Como texto, "0.31.10" < "0.31.9"; como número, 10 > 9.
    v = {"a": "0.31.10", "b": "0.31.10", "c": "0.31.10"}
    assert _versao_minima_ok(v, (0, 31, 9)) is True


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
