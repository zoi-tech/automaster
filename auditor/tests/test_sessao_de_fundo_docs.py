"""O texto do repo descreve a sessão de fundo, e não o Chrome aberto a cada comando.

Desde a 0.28.0 um processo de fundo do extractor é o único dono do perfil, mantém um Chrome
invisível e entrega os tokens por um socket Unix; os comandos chamam o GHL por `fetch` e a
escrita espera a vez numa fila. Descrição de tool, skill e doc que ainda digam "abre o
Chrome" ou "escrita serial" ensinam o agente a esperar o comportamento antigo.
"""

import json
import re
import tomllib
from pathlib import Path

import pytest

from automaster_audit import mcp_server

RAIZ = Path(__file__).resolve().parents[2]
ESTE = Path(__file__).resolve()

PROIBIDO = re.compile(
    r"abr(e|em|ir) (o |um )?(chrome|browser|navegador)|serial por constru|escrita ao vivo é serial|serialização da escrita",
    re.IGNORECASE,
)

DOCS = [
    "CLAUDE.md",
    "skills/automaster-leitura/SKILL.md",
    "commands/automaster-extract.md",
    "docs/endpoints.md",
    "docs/backlog-arquitetura.md",
    "docs/sessao-de-fundo.md",
]

# As pastas do grep de prova da etapa 15; o próprio arquivo cita a expressão e fica de fora.
PASTAS = ["skills", "commands", "hooks", "auditor/src", "auditor/tests", "extractor/src"]


def _arquivos() -> list[str]:
    vistos = set(DOCS)
    for pasta in PASTAS:
        for p in (RAIZ / pasta).rglob("*"):
            if p.is_file() and p != ESTE and "__pycache__" not in p.parts and p.suffix != ".pyc":
                vistos.add(p.relative_to(RAIZ).as_posix())
    return sorted(vistos)


def _casos(texto: str) -> list[str]:
    return [f"{n}: {linha.strip()}" for n, linha in enumerate(texto.splitlines(), 1) if PROIBIDO.search(linha)]


def _secao(texto: str, titulo: str) -> str | None:
    m = re.search(rf"^## {re.escape(titulo)}\b.*?(?=^## |\Z)", texto, re.MULTILINE | re.DOTALL)
    return m.group(0) if m else None


@pytest.mark.parametrize("nome", sorted(mcp_server.TOOLS))
def test_descricao_da_tool_nao_fala_do_chrome_antigo(nome):
    descricao = mcp_server.TOOLS[nome][1]
    casou = PROIBIDO.search(descricao)
    assert not casou, f"a descrição da tool {nome!r} ainda diz {casou.group(0)!r}: {descricao}"


@pytest.mark.parametrize("arquivo", _arquivos())
def test_arquivo_nao_fala_do_chrome_antigo(arquivo):
    caminho = RAIZ / arquivo
    assert caminho.is_file(), f"{arquivo} não existe"
    casos = _casos(caminho.read_text(encoding="utf-8", errors="ignore"))
    assert not casos, f"{arquivo} ainda descreve o comportamento antigo:\n" + "\n".join(casos)


def test_lista_de_arquivos_cobre_src_e_tests_do_auditor():
    """Guarda do próprio teste: sem isso, um rglob errado passaria verde sem olhar nada."""
    arquivos = _arquivos()
    assert "auditor/src/automaster_audit/mcp/contato.py" in arquivos
    assert "auditor/tests/test_workflow_editar_tool.py" in arquivos
    assert "auditor/tests/test_sessao_de_fundo_docs.py" not in arquivos


def _versoes() -> dict[str, str]:
    plugin = json.loads((RAIZ / ".claude-plugin" / "plugin.json").read_text(encoding="utf-8"))
    extractor = json.loads((RAIZ / "extractor" / "package.json").read_text(encoding="utf-8"))
    auditor = tomllib.loads((RAIZ / "auditor" / "pyproject.toml").read_text(encoding="utf-8"))
    return {
        ".claude-plugin/plugin.json": plugin["version"],
        "extractor/package.json": extractor["version"],
        "auditor/pyproject.toml": auditor["project"]["version"],
    }


@pytest.mark.parametrize("arquivo", [".claude-plugin/plugin.json", "extractor/package.json", "auditor/pyproject.toml"])
def test_versao_e_0_28_0_ou_mais(arquivo):
    # a sessão de fundo entrou na 0.28.0; as versões seguintes só sobem, e test_versoes.py garante que andam juntas
    atual = tuple(int(p) for p in _versoes()[arquivo].split("."))
    assert atual >= (0, 28, 0), f"{arquivo} está em {_versoes()[arquivo]}, esperado 0.28.0 ou mais"


@pytest.mark.parametrize("termo", ["0.12.0", "0.22.0", "fila", "processo de fundo"])
def test_changelog_0_28_0_cita(termo):
    secao = _secao((RAIZ / "CHANGELOG.md").read_text(encoding="utf-8"), "0.28.0")
    assert secao is not None, "o CHANGELOG.md não tem a seção ## 0.28.0"
    assert termo in secao, f"a seção ## 0.28.0 do CHANGELOG.md não cita {termo!r}"


@pytest.mark.parametrize(
    "termo",
    [
        "/tokens",
        "/renovar",
        "/versao",
        "/encerrar",
        "login_pendente",
        "sessao_indisponivel",
        "~/.automaster/sessao/sock",
    ],
)
def test_contrato_do_socket_cita(termo):
    secao = _secao((RAIZ / "docs" / "sessao-de-fundo.md").read_text(encoding="utf-8"), "Contrato do socket")
    assert secao is not None, "docs/sessao-de-fundo.md não tem a seção ## Contrato do socket"
    assert termo in secao, f"a seção ## Contrato do socket de docs/sessao-de-fundo.md não cita {termo!r}"
