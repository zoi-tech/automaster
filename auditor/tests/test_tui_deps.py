"""A TUI depende do extra `tui` (Textual 8 + textualeffects) e os dois convivem."""

import asyncio
import re
import tomllib
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[2]


def _extra_tui() -> list[str]:
    pyproject = tomllib.loads((RAIZ / "auditor" / "pyproject.toml").read_text(encoding="utf-8"))
    return pyproject["project"]["optional-dependencies"].get("tui", [])


def test_extra_tui_prende_textual_8():
    assert ">=8,<9" in [d.replace(" ", "").removeprefix("textual") for d in _extra_tui() if d.startswith("textual")]


def test_extra_tui_fixa_versao_do_textualeffects():
    assert any(re.fullmatch(r"textualeffects==\d+(\.\d+)*", d.replace(" ", "")) for d in _extra_tui())


def test_ci_instala_extra_tui_e_desliga_animacoes():
    ci = (RAIZ / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
    assert "pip install -e '.[dev,tui]'" in ci
    assert re.search(r"TEXTUAL_ANIMATIONS:\s*['\"]?none", ci)


def test_app_com_effect_label_monta_e_fecha():
    textual_app = pytest.importorskip("textual.app")
    from textualeffects.widgets import EffectLabel

    class Mini(textual_app.App):
        def compose(self):
            yield EffectLabel("automaster", effect="Print")

    async def rodar():
        app = Mini()
        async with app.run_test() as pilot:
            await pilot.pause()
            assert len(app.query(EffectLabel)) == 1
        return app.return_code

    assert asyncio.run(rodar()) in (None, 0)
