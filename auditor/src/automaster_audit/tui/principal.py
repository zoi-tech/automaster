"""Tela principal: contadores, quatro abas (workflows, achados, entidades, diff) e busca."""

from rich.text import Text
from textual.actions import SkipAction
from textual.app import ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, Vertical
from textual.message import Message
from textual.reactive import reactive
from textual.screen import Screen
from textual.widgets import DataTable, Footer, Input, Static, TabbedContent, TabPane

from ..mcp.dump import achados, buscar, comparar, inventario
from .abertura import entrar

ABAS = ("workflows", "achados", "entidades", "diff")
SEVS = ("ERROR", "WARN", "INFO")
# (fatia do inventario, rótulo na tela)
TIPOS = (
    ("tags", "tags"),
    ("fields", "campos"),
    ("pipelines", "funis"),
    ("users", "usuários"),
    ("forms", "formulários"),
    ("templates", "templates"),
)


def _quando(snap: str) -> str:
    dia, _, hora = snap.partition("_")
    return f"{dia} {hora[:2]}:{hora[2:]}" if len(hora) == 4 else snap


class PaneDiff(TabPane):
    """O pane desenha o diff ele mesmo: `#diff` é o id do pane."""

    def __init__(self, titulo: str, texto: str, id: str) -> None:
        super().__init__(titulo, id=id)
        self.texto = texto

    def render(self) -> Text:
        return Text(self.texto)


class Kpi(Static):
    """Contador que sobe de 0 ao total; com animação desligada nasce no total."""

    valor = reactive(0)

    def __init__(self, rotulo: str, total: int, id: str) -> None:
        super().__init__(id=id, classes="kpi")
        self.rotulo, self.total = rotulo, total

    def on_mount(self) -> None:
        if self.app.animation_level == "full":
            self.animate("valor", self.total, duration=0.9, easing="out_cubic")
        else:
            self.valor = self.total

    def watch_valor(self, valor: float) -> None:
        self.update(f"{self.rotulo}\n{round(valor)}")


class Principal(Screen):
    BINDINGS = (
        *(Binding(str(i), f"aba('{a}')", a, show=False) for i, a in enumerate(ABAS, 1)),
        Binding("escape", "app.pop_screen", "voltar"),
        Binding("slash", "buscar", "buscar"),
        Binding("f", "filtrar", "filtrar"),
        Binding("e", "sev('ERROR')", "erro"),
        Binding("w", "sev('WARN')", "aviso"),
        Binding("i", "sev('INFO')", "info"),
        Binding("left", "tipo(-1)", "tipo", show=False, priority=True),
        Binding("right", "tipo(1)", "tipo", show=False, priority=True),
        Binding("o", "orfas", "só órfãs"),
    )

    class AbrirWorkflow(Message):
        """Enter num workflow; a app empurra o detalhe."""

        def __init__(self, id: str) -> None:
            super().__init__()
            self.id = id

    class AbrirEntidade(Message):
        """Enter numa entidade; a app empurra o detalhe."""

        def __init__(self, fatia: str, nome: str) -> None:
            super().__init__()
            self.fatia, self.nome = fatia, nome

    def __init__(self, titulo: str, loc: str, snapshot: str, anterior: str | None) -> None:
        super().__init__()
        self.titulo, self.loc, self.snapshot, self.anterior = titulo, loc, snapshot, anterior
        self.sevs = set(SEVS)
        self.tipo = 0
        self.so_orfas = False
        self.filtro = ""

    def compose(self) -> ComposeResult:
        self.wfs = inventario(self.loc, "workflows", self.snapshot)["workflows"]
        self.wfs.sort(key=lambda w: (-w["achados"]["ERROR"], -w["achados"]["WARN"]))
        ach = achados(self.loc, snapshot=self.snapshot)
        self.grupos, n = ach["achados"], ach["counts"]
        titulo = f"{self.titulo.upper()} · {_quando(self.snapshot)}"
        yield Static(titulo, id="titulo-principal", classes="barra", markup=False)
        with Horizontal(id="kpis"):
            yield Kpi("erro", n["ERROR"], id="kpi-erro")
            yield Kpi("aviso", n["WARN"], id="kpi-aviso")
            yield Kpi("info", n["INFO"], id="kpi-info")
            yield Kpi("workflows", len(self.wfs), id="kpi-workflows")
        with Vertical(id="painel-busca"):
            yield Input(placeholder="buscar workflows, tags, campos, funis, usuários", id="busca")
            yield DataTable(id="resultados-busca", cursor_type="row")
        with TabbedContent(id="abas", initial="workflows"):
            with TabPane("1 workflows", id="workflows"):
                yield Input(placeholder="filtrar por nome", id="filtro")
                yield DataTable(id="tabela-workflows", cursor_type="row")
            with TabPane("2 achados", id="achados"):
                yield Static("", id="sevs")
                yield DataTable(id="tabela-achados", cursor_type="row")
            with TabPane("3 entidades", id="entidades"):
                yield Static("", id="tipo-entidade", markup=False)
                yield DataTable(id="tabela-entidades", cursor_type="row")
            yield PaneDiff("4 diff", self._diff(), id="diff")
        yield Footer()

    def on_mount(self) -> None:
        self.query_one("#resultados-busca", DataTable).add_columns("tipo", "nome")
        self.query_one("#tabela-workflows", DataTable).add_columns(
            "workflow", "status", "passos", "err", "avi", "trigger"
        )
        self.query_one("#tabela-achados", DataTable).add_columns("sev", "regra", "workflow", "detalhe", "n")
        self._workflows()
        self._achados()
        self._entidades()
        self.query_one("#tabela-workflows", DataTable).focus()
        entrar(self)
        erro = self.query_one("#kpi-erro", Kpi)
        if self.app.animation_level == "full" and erro.total:
            self.set_interval(0.4, lambda: erro.toggle_class("pulso"))

    # --- workflows -----------------------------------------------------------

    def _workflows(self) -> None:
        t = self.query_one("#tabela-workflows", DataTable)
        t.clear()
        q = self.filtro.lower()
        for w in self.wfs:
            if q in (w["name"] or "").lower():
                a = w["achados"]
                trig = ", ".join(w["triggers"]) or "—"
                t.add_row(w["name"], w["status"], str(w["n_steps"]), str(a["ERROR"]), str(a["WARN"]), trig, key=w["id"])

    def action_filtrar(self) -> None:
        self.query_one("#abas", TabbedContent).active = "workflows"
        f = self.query_one("#filtro", Input)
        f.display = True
        f.focus()

    # --- achados ---------------------------------------------------------------

    def _achados(self) -> None:
        self.query_one("#sevs", Static).update(
            "   ".join(f"{'■' if s in self.sevs else '□'} {s}" for s in SEVS) + "   [$dim]e/w/i alternam[/]"
        )
        t = self.query_one("#tabela-achados", DataTable)
        t.clear()
        self.ids_achados = []
        for g in self.grupos:
            if g["severity"] in self.sevs:
                self.ids_achados.append(g["workflow_id"])
                t.add_row(g["severity"], g["rule"], g["workflow"] or "—", g["detail"], str(g["n"]))

    def action_sev(self, sev: str) -> None:
        self.sevs ^= {sev}
        self._achados()

    # --- entidades -------------------------------------------------------------

    def _entidades(self) -> None:
        fatia, rotulo = TIPOS[self.tipo]
        outros = " · ".join(r for _, r in TIPOS if r != rotulo)
        self.query_one("#tipo-entidade", Static).update(
            f"[{rotulo}]  {outros}" + ("   só órfãs" if self.so_orfas else "")
        )
        t = self.query_one("#tabela-entidades", DataTable)
        t.clear(columns=True)
        t.add_columns(rotulo, "workflows", "situação")
        for e in inventario(self.loc, fatia, self.snapshot)[fatia]:
            if self.so_orfas and not e.get("orphan"):
                continue
            usos = len(e.get("used_by") or e.get("usos") or [])
            t.add_row(e["name"], str(usos), "órfã" if e.get("orphan") else "")

    def action_tipo(self, passo: int) -> None:
        if self.query_one("#abas", TabbedContent).active != "entidades" or isinstance(self.focused, Input):
            raise SkipAction()
        self.tipo = (self.tipo + passo) % len(TIPOS)
        self._entidades()

    def action_orfas(self) -> None:
        self.so_orfas = not self.so_orfas
        self._entidades()

    # --- diff ------------------------------------------------------------------

    def _diff(self) -> str:
        if self.anterior is None:
            return "não há snapshot anterior para comparar"
        d = comparar(self.loc, antes=self.anterior, depois=self.snapshot)
        w = d["workflows"]
        linhas = [f"● {_quando(self.anterior)} · {d['antes']['workflows']} workflows", "│"]
        linhas += [f"│  adicionado  {x['nome']}" for x in w["adicionados"]]
        linhas += [f"│  removido    {x['nome']}" for x in w["removidos"]]
        linhas += [f"│  alterado    {x['nome']}  {'; '.join(x['mudancas'])}" for x in w["alterados"]]
        ents = d["entidades"]
        linhas += [
            f"│  {tipo}: +{', '.join(e['adicionados']) or '—'}  -{', '.join(e['removidos']) or '—'}"
            for tipo, e in ents.items()
        ]
        resumo = f"{len(w['adicionados'])} adicionados · {len(w['removidos'])} removidos · "
        resumo += "entidades mudaram" if ents else "entidades sem mudança"
        linhas += ["│", f"│  {resumo}", f"● {_quando(self.snapshot)} · {d['depois']['workflows']} workflows"]
        return "\n".join(linhas)

    # --- abas e busca ----------------------------------------------------------

    def action_aba(self, aba: str) -> None:
        self.query_one("#abas", TabbedContent).active = aba

    def action_buscar(self) -> None:
        self.query_one("#painel-busca").display = True
        self.query_one("#busca", Input).focus()

    def on_input_submitted(self, ev: Input.Submitted) -> None:
        if ev.input.id == "filtro":
            self.filtro = ev.value
            self._workflows()
            self.query_one("#tabela-workflows", DataTable).focus()
            return
        r = buscar(self.loc, ev.value, self.snapshot)
        t = self.query_one("#resultados-busca", DataTable)
        t.clear()
        for fatia, itens in r.items():
            if fatia == "_snapshot":
                continue
            for e in itens:
                key = f"wf:{e['id']}" if fatia == "workflows" else None
                t.add_row(fatia, e["name"], key=key)
        t.focus()

    def on_data_table_row_selected(self, ev: DataTable.RowSelected) -> None:
        key = ev.row_key.value or ""
        if ev.data_table.id == "tabela-workflows":
            self.post_message(self.AbrirWorkflow(key))
        elif ev.data_table.id == "tabela-achados" and self.ids_achados[ev.cursor_row]:
            self.post_message(self.AbrirWorkflow(self.ids_achados[ev.cursor_row]))
        elif ev.data_table.id == "resultados-busca" and key.startswith("wf:"):
            self.post_message(self.AbrirWorkflow(key[3:]))
        elif ev.data_table.id == "tabela-entidades":
            self.post_message(self.AbrirEntidade(TIPOS[self.tipo][0], str(ev.data_table.get_row_at(ev.cursor_row)[0])))
