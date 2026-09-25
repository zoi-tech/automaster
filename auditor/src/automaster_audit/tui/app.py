from pathlib import Path

from textual.app import App
from textual.binding import Binding
from textual.theme import Theme

from .telas import Selecao

TEMA = Theme(
    name="automaster",
    dark=True,
    background="#050706",
    surface="#0a0e0c",
    panel="#0a0e0c",
    foreground="#c9d6cf",
    primary="#ffb000",
    secondary="#3fd6e6",
    accent="#3fd6e6",
    warning="#ffb000",
    success="#39ff88",
    error="#ff4d4d",
    variables={"rule": "#1d2a24", "dim": "#5d6f66"},
)


class AutomasterApp(App):
    CSS_PATH = Path(__file__).with_name("tema.tcss")
    BINDINGS = (Binding("q", "quit", "sair"),)

    def __init__(self, animacao: bool = True) -> None:
        super().__init__()
        # antes do CSS ser lido: o tcss usa $rule e $dim, que só existem neste tema
        self.register_theme(TEMA)
        self.theme = "automaster"
        # explícito nos dois sentidos: a flag da CLI manda, não o TEXTUAL_ANIMATIONS
        self.animation_level = "full" if animacao else "none"

    def on_mount(self) -> None:
        self.push_screen(Selecao())
