from terminaltexteffects import Color
from textual import events
from textual.app import ComposeResult
from textual.containers import Vertical
from textual.css.scalar import ScalarOffset
from textual.screen import Screen
from textual.widgets import Static
from textualeffects.widgets import EffectLabel

from ..mcp.base import ToolError
from ..mcp.dump import dumps, inventario

MARCA = "▄▀█ █ █ ▀█▀ █▀█ █▀▄▀█ ▄▀█ █▀ ▀█▀ █▀▀ █▀█\n█▀█ █▄█  █  █▄█ █ ▀ █ █▀█ ▄█  █  ██▄ █▀▄\n"


def entrar(tela: Screen) -> None:
    """Transição de entrada: desliza 4 colunas e acende em 0,3 s (o Textual pula com animação desligada)."""
    tela.styles.opacity = 0
    tela.styles.offset = (4, 0)
    tela.styles.animate("opacity", 1.0, duration=0.3)
    tela.styles.animate("offset", ScalarOffset.from_offset((0, 0)), duration=0.3, easing="out_cubic")


def _contagem() -> str:
    try:
        subs = dumps()
        wfs = sum(inventario(s["loc"])["summary"]["workflows"] for s in subs)
    except ToolError:
        subs, wfs = [], 0
    snaps = sum(len(s["snapshots"]) for s in subs)
    return f"{len(subs)} subcontas · {snaps} snapshots · {wfs} workflows"


class Abertura(Screen):
    def compose(self) -> ComposeResult:
        with Vertical(id="abertura"):
            cfg = {"typing_speed": 4, "final_gradient_stops": (Color("#39ff88"),)}
            marca = EffectLabel(MARCA, effect="Decrypt", config=cfg)
            marca.id = "marca"  # EffectLabel não aceita id no construtor
            yield marca
            yield Static("workflows · achados · subcontas", id="linha-abertura")
            yield Static(_contagem(), id="contagem-abertura", markup=False)
            yield Static("qualquer tecla pula", classes="dim")

    def on_mount(self) -> None:
        self.set_timer(2.4, self.pular)

    def on_key(self, ev: events.Key) -> None:
        ev.stop()
        self.pular()

    def pular(self) -> None:
        from .telas import Selecao

        if self.app.screen is self:
            self.app.switch_screen(Selecao())
