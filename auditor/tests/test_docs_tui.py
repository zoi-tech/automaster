"""A 0.27.0 (TUI) sobe a versão e documenta a TUI no changelog e no CLAUDE.md."""

import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]


def _secao_changelog(versao: str) -> str:
    texto = (RAIZ / "CHANGELOG.md").read_text(encoding="utf-8")
    m = re.search(rf"^## {re.escape(versao)}\b.*?(?=^## |\Z)", texto, re.MULTILINE | re.DOTALL)
    assert m, f"CHANGELOG.md sem seção ## {versao}"
    return m.group(0)


def test_changelog_mantem_a_secao_0_27_0():
    # a versão atual é conferida por test_versoes.py; aqui só não se perde o registro da TUI
    assert _secao_changelog("0.27.0")


def test_changelog_0_27_0_cita_a_tui():
    # \b evita casar "substituir"/"constituir"
    assert re.search(r"\btui\b", _secao_changelog("0.27.0"), re.IGNORECASE)


def test_claude_md_documenta_a_tui():
    texto = (RAIZ / "CLAUDE.md").read_text(encoding="utf-8")
    assert "automaster-audit tui" in texto
    assert ".[tui]" in texto
    assert "`tui/`" in texto
