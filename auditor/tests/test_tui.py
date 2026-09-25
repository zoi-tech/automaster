"""Etapa 5 da TUI: subcomando `tui`, tela de seleção e tela de erro de dump.

Contrato que a implementação cumpre:

- `automaster_audit.tui.app.AutomasterApp(animacao: bool = True)` — com `animacao=False`,
  `app.animation_level == "none"`. A app abre direto na tela de seleção.
- Dados só por `automaster_audit.mcp.dump.dumps()` (raiz em `AUTOMASTER_DUMPS`).
- Tela de seleção:
  - `#subcontas` (DataTable), focada ao abrir: uma linha por subconta com nome (ou "(sem nome)"),
    id, nº de snapshots e snapshot mais recente.
  - `#snapshots` (DataTable): os snapshots da subconta sob o cursor, mais recente primeiro;
    tecla `right` leva o foco para ela.
  - Enter num snapshot válido empurra a tela principal; nesta etapa um placeholder com
    `#titulo-principal`, cujo texto contém o nome da subconta (ou o id, se sem nome).
  - Enter num snapshot recusado empurra a tela de erro, com `#erro` contendo a mensagem do
    `ToolError`; Enter nela volta à seleção.
  - Raiz sem dump nenhum: `#vazio` com o texto "nenhum dump em <raiz>".
- `q` sai da app.
- `automaster-audit tui [--sem-animacao]`; sem o Textual, código 1 e `pip install -e '.[tui]'` em stderr.
"""

import asyncio
import builtins
import json

import pytest
from conftest import LOC

from automaster_audit import cli

BOM = "2026-06-10_0000"
RUIM = "2026-06-11_0000"


def _app(**kw):
    pytest.importorskip("textual")
    from automaster_audit.tui.app import AutomasterApp

    return AutomasterApp(**kw)


def _texto(app, sel):
    return str(app.screen.query_one(sel).render())


def _linhas(tabela) -> list[str]:
    return [" ".join(str(c) for c in tabela.get_row_at(i)) for i in range(tabela.row_count)]


def _run(corpo, app=None):
    app = app or _app(animacao=False)

    async def main():
        async with app.run_test(size=(140, 40)) as pilot:
            await pilot.pause()
            await corpo(app, pilot)

    asyncio.run(main())
    return app


def _dois_snapshots(root):
    root(snapshot=BOM)
    ruim = root(snapshot=RUIM, extracted_at="2026-06-11T00:00:00+00:00")
    m = json.loads((ruim / "manifest.json").read_text())
    m["schemaVersion"] = 999
    (ruim / "manifest.json").write_text(json.dumps(m))


def test_sem_textual_sai_com_1_e_instrucao(monkeypatch, capsys):
    real = builtins.__import__

    def falso(name, *a, **kw):
        if name == "textual" or name.startswith(("textual.", "automaster_audit.tui")):
            raise ImportError(name)
        return real(name, *a, **kw)

    monkeypatch.setattr(builtins, "__import__", falso)
    assert cli.main(["tui"]) == 1
    assert "pip install -e '.[tui]'" in capsys.readouterr().err


def test_parser_aceita_sem_animacao():
    args = cli.build_parser().parse_args(["tui", "--sem-animacao"])
    assert args.sem_animacao is True
    assert cli.build_parser().parse_args(["tui"]).sem_animacao is False


def test_sem_animacao_desliga_animacao():
    assert _app(animacao=False).animation_level == "none"
    assert _app().animation_level != "none"


def test_selecao_lista_subcontas(root):
    _dois_snapshots(root)

    async def corpo(app, pilot):
        linhas = _linhas(app.screen.query_one("#subcontas"))
        assert len(linhas) == 1
        assert LOC in linhas[0]
        celulas = [str(c).strip() for c in app.screen.query_one("#subcontas").get_row_at(0)]
        assert "2" in celulas  # nº de snapshots, numa célula própria
        assert "2026-06-11" in linhas[0]  # mais recente

    _run(corpo)


def test_direita_mostra_snapshots_da_subconta(root):
    _dois_snapshots(root)

    async def corpo(app, pilot):
        await pilot.press("right")
        snaps = app.screen.query_one("#snapshots")
        assert app.focused is snaps
        linhas = _linhas(snaps)
        assert len(linhas) == 2
        assert "2026-06-11" in linhas[0] and "2026-06-10" in linhas[1]

    _run(corpo)


def test_enter_em_snapshot_valido_abre_principal(root):
    _dois_snapshots(root)

    async def corpo(app, pilot):
        await pilot.press("right", "down", "enter")
        await pilot.pause()
        assert LOC in _texto(app, "#titulo-principal")
        assert not app.screen.query("#erro")

    _run(corpo)


def test_enter_em_snapshot_recusado_mostra_erro_e_volta(root):
    _dois_snapshots(root)

    async def corpo(app, pilot):
        await pilot.press("right", "enter")
        await pilot.pause()
        assert "schemaVersion incompatível" in _texto(app, "#erro")
        assert not app.screen.query("#titulo-principal")
        await pilot.press("enter")
        await pilot.pause()
        assert app.screen.query("#subcontas")
        assert not app.screen.query("#erro")

    _run(corpo)


def test_q_sai(root):
    _dois_snapshots(root)

    async def corpo(app, pilot):
        await pilot.press("q")
        await pilot.pause()
        assert not app.is_running

    _run(corpo)


def test_raiz_vazia(tmp_path, monkeypatch):
    raiz = tmp_path / "vazia"
    raiz.mkdir()
    monkeypatch.setenv("AUTOMASTER_DUMPS", str(raiz))

    async def corpo(app, pilot):
        assert f"nenhum dump em {raiz}" in _texto(app, "#vazio")

    _run(corpo)
