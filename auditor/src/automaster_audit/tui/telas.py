from textual.app import ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, Vertical
from textual.screen import ModalScreen, Screen
from textual.widgets import DataTable, Footer, Static

from ..mcp import base
from ..mcp.base import ToolError
from ..mcp.dump import dumps
from .principal import Principal, _quando


def _barra(tela: str) -> Static:
    return Static(f"[b]AUTOMASTER[/b] · {tela}  [$dim]{base._root()}[/]", classes="barra")


class Selecao(Screen):
    BINDINGS = (Binding("right", "snapshots", "snapshots", priority=True),)

    def compose(self) -> ComposeResult:
        yield _barra("seleção")
        try:
            self.subcontas = dumps()
        except ToolError:
            self.subcontas = []
        if not self.subcontas:
            yield Static(f"nenhum dump em {base._root()}", id="vazio")
        else:
            with Horizontal():
                yield DataTable(id="subcontas", cursor_type="row")
                with Vertical(id="lado"):
                    yield Static("", id="titulo-snapshots")
                    yield DataTable(id="snapshots", cursor_type="row")
        yield Footer()

    def on_mount(self) -> None:
        if not self.subcontas:
            return
        t = self.query_one("#subcontas", DataTable)
        t.add_columns("subconta", "id", "snapshots", "mais recente")
        for s in self.subcontas:
            t.add_row(s["nome"] or "(sem nome)", s["loc"], str(len(s["snapshots"])), _quando(s["snapshots"][0]))
        self.query_one("#snapshots", DataTable).add_column("snapshot")
        t.focus()

    def _atual(self) -> dict:
        return self.subcontas[self.query_one("#subcontas", DataTable).cursor_row]

    def on_data_table_row_highlighted(self, ev: DataTable.RowHighlighted) -> None:
        if ev.data_table.id != "subcontas":
            return
        s = self._atual()
        self.query_one("#titulo-snapshots", Static).update(f"SNAPSHOTS · {s['nome'] or s['loc']}")
        snaps = self.query_one("#snapshots", DataTable)
        snaps.clear()
        for snap in s["snapshots"]:  # _snapshots já devolve o mais recente primeiro
            snaps.add_row(_quando(snap))

    def action_snapshots(self) -> None:
        if self.subcontas:
            self.query_one("#snapshots", DataTable).focus()

    def on_data_table_row_selected(self, ev: DataTable.RowSelected) -> None:
        if ev.data_table.id == "subcontas":
            self.action_snapshots()
            return
        s = self._atual()
        i = ev.cursor_row
        snap = s["snapshots"][i]
        anterior = s["snapshots"][i + 1] if i + 1 < len(s["snapshots"]) else None  # lista vem decrescente
        try:
            path, _ = base._snapshot(s["loc"], snap)
            base._ctx(str(path))
        except ToolError as e:
            self.app.push_screen(ErroDump(s["loc"], snap, str(e)))
            return
        self.app.push_screen(Principal(s["nome"] or s["loc"], s["loc"], snap, anterior))


class ErroDump(ModalScreen):
    BINDINGS = (Binding("enter", "app.pop_screen", "voltar à seleção"),)

    def __init__(self, loc: str, snapshot: str, mensagem: str) -> None:
        super().__init__()
        self.loc, self.snapshot, self.mensagem = loc, snapshot, mensagem

    def compose(self) -> ComposeResult:
        with Vertical(id="modal"):
            yield Static("SNAPSHOT RECUSADO", id="modal-titulo")
            yield Static(f"{self.loc} · {_quando(self.snapshot)}", classes="dim")
            yield Static(self.mensagem, id="erro", markup=False)
        yield Footer()
