"""As três versões do repo andam juntas.

O plugin, o extractor e o auditor são publicados como uma coisa só: o servidor MCP
roda a CLI do extractor por subprocess, e o `CHANGELOG.md` conta a história das três
numa lista só. Até a 0.24.0 os dois manifestos de pacote ficaram parados em `0.1.0`
enquanto o plugin andava — ninguém notou porque nada lê essas versões. Este teste
transforma "lembrar de subir as três" em erro de CI.
"""

import json
import re
import tomllib
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]


def _versoes() -> dict[str, str]:
    plugin = json.loads((RAIZ / ".claude-plugin" / "plugin.json").read_text(encoding="utf-8"))
    extractor = json.loads((RAIZ / "extractor" / "package.json").read_text(encoding="utf-8"))
    auditor = tomllib.loads((RAIZ / "auditor" / "pyproject.toml").read_text(encoding="utf-8"))
    return {
        ".claude-plugin/plugin.json": plugin["version"],
        "extractor/package.json": extractor["version"],
        "auditor/pyproject.toml": auditor["project"]["version"],
    }


def test_as_tres_versoes_sao_iguais():
    v = _versoes()
    assert len(set(v.values())) == 1, f"versões divergentes: {v}"


def test_a_versao_esta_no_changelog():
    versao = _versoes()[".claude-plugin/plugin.json"]
    changelog = (RAIZ / "CHANGELOG.md").read_text(encoding="utf-8")
    assert re.search(rf"^## {re.escape(versao)}\b", changelog, re.MULTILINE), (
        f"a versão {versao} não tem seção própria no CHANGELOG.md"
    )
