from pathlib import Path

from textual.app import App
from textual.binding import Binding
from textual.theme import Theme

from .abertura import Abertura
from .detalhe import DetalheEntidade, DetalheWorkflow
from .principal import Principal
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
        if not animacao:  # sem a flag, vale o TEXTUAL_ANIMATIONS do ambiente
            self.animation_level = "none"

    def on_mount(self) -> None:
        self.push_screen(Abertura() if self.animation_level == "full" else Selecao())

    def on_principal_abrir_workflow(self, ev: Principal.AbrirWorkflow) -> None:
        self.push_screen(DetalheWorkflow(self.screen.loc, self.screen.snapshot, ev.id))

    def on_principal_abrir_entidade(self, ev: Principal.AbrirEntidade) -> None:
        self.push_screen(DetalheEntidade(self.screen.loc, self.screen.snapshot, ev.fatia, ev.nome))
