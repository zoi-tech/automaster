"""Detalhe do workflow (árvore de passos, achados, referências) e detalhe da entidade (workflow × papel)."""

import re

from rich.text import Text
from textual.app import ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, Vertical
from textual.screen import Screen
from textual.widgets import DataTable, Footer, Static, Tree

from ..flow import enumerate_paths
from ..mcp import base
from ..mcp.dump import inventario, workflow
from ..path_report import _trie, describe_step
from .abertura import entrar
from .principal import TIPOS, Principal

_STEP = re.compile(r"^step '(.*?)'")


class DetalheWorkflow(Screen):
    BINDINGS = (
        Binding("escape", "app.pop_screen", "voltar"),
        Binding("n", "proximo_erro", "próximo erro"),
    )

    def __init__(self, loc: str, snapshot: str, id: str) -> None:
        super().__init__()
        self.loc, self.snapshot, self.id = loc, snapshot, id

    def compose(self) -> ComposeResult:
        d = workflow(self.loc, self.id, self.snapshot)
        m, self.achados = d["meta"], d["achados"]
        self.chamadores = m["called_by"]
        ctx, _ = base._load(self.loc, self.snapshot)
        wf = next(w for w in ctx.workflows if w.id == self.id)
        self.ctx, self.by_id = ctx, {s.get("id"): s for s in wf.steps}
        self.com_erro = {m_.group(1) for a in self.achados if (m_ := _STEP.match(a["detail"]))}
        yield Static(f"WORKFLOW · {m['name']}", classes="barra", markup=False)
        yield Static(f"{m['name']}  ·  {m['status']}  ·  {m['n_steps']} passos", id="cabecalho-workflow", markup=False)
        yield Static("triggers: " + (", ".join(m["triggers"]) or "—"), id="triggers", markup=False)
        self.paths, cortado = enumerate_paths(wf)
        if cortado:
            yield Static(f"⚠ árvore cortada: mais de {len(self.paths)} caminhos", id="aviso-corte")
        with Horizontal():
            with Vertical(id="col-arvore"):
                if wf.steps:
                    yield Tree("passos", id="arvore")
                else:
                    yield Static("sem passos", id="sem-passos")
            with Vertical(id="col-lado"):
                txt = "\n".join(f"✗ {a['severity']} {a['detail']}" for a in self.achados) or "nenhum achado"
                yield Static(txt, id="achados-workflow", markup=False)
                yield DataTable(id="referencias", cursor_type="row")
        yield Footer()

    def _rotulo(self, sid: str, ramo: str | None) -> Text:
        step = self.by_id.get(sid) or {}
        txt = describe_step(step, self.ctx)
        if ramo:
            txt = f"{ramo}: {txt}"
        if (step.get("name", step.get("type"))) in self.com_erro:
            return Text(f"✗ {txt}", style=f"bold {self.app.current_theme.error}")
        return Text(txt)

    def _montar(self, pai, no) -> None:
        # trecho linear fica no mesmo nível; ramo vira filho
        while len(no.children) == 1:
            (sid, ramo), filho = next(iter(no.children.items()))
            if ramo is not None:
                break
            pai.add_leaf(self._rotulo(sid, None), data=sid)
            no = filho
        for (sid, ramo), filho in no.children.items():
            self._montar(pai.add(self._rotulo(sid, ramo), data=sid, expand=True), filho)

    def on_mount(self) -> None:
        entrar(self)
        refs = self.query_one("#referencias", DataTable)
        refs.add_columns("tipo", "nome")
        for fatia, rotulo in TIPOS:
            for e in inventario(self.loc, fatia, self.snapshot)[fatia]:
                if any(u["workflow_id"] == self.id for u in e.get("usos") or []):
                    refs.add_row(rotulo, e["name"], key=f"{fatia}:{e['name']}")
        ids = {w.name: w.id for w in self.ctx.workflows}
        for nome in self.chamadores:
            refs.add_row("chamado por", nome, key=f"wf:{ids.get(nome, '')}")
        if self.query("#arvore"):
            tree = self.query_one("#arvore", Tree)
            tree.show_root = False
            self._montar(tree.root, _trie(self.paths))
            tree.root.expand()
            tree.focus()

    def _nos(self) -> list:
        pilha, out = list(self.query_one("#arvore", Tree).root.children), []
        while pilha:
            no = pilha.pop(0)
            out.append(no)
            pilha[:0] = list(no.children)
        return out

    def action_proximo_erro(self) -> None:
        if not self.query("#arvore"):
            return
        tree = self.query_one("#arvore", Tree)
        nos = self._nos()
        atual = nos.index(tree.cursor_node) if tree.cursor_node in nos else -1
        for no in nos[atual + 1 :] + nos[: atual + 1]:
            if "✗" in str(no.label):
                tree.move_cursor(no)
                return

    def on_data_table_row_selected(self, ev: DataTable.RowSelected) -> None:
        fatia, _, resto = (ev.row_key.value or "").partition(":")
        if fatia == "wf":
            self.post_message(Principal.AbrirWorkflow(resto))
        else:
            self.post_message(Principal.AbrirEntidade(fatia, resto))


class DetalheEntidade(Screen):
    BINDINGS = (Binding("escape", "app.pop_screen", "voltar"),)

    def __init__(self, loc: str, snapshot: str, fatia: str, nome: str) -> None:
        super().__init__()
        self.loc, self.snapshot, self.fatia, self.nome = loc, snapshot, fatia, nome

    def compose(self) -> ComposeResult:
        rotulo = dict(TIPOS)[self.fatia]
        yield Static(f"ENTIDADE · {rotulo}", classes="barra", markup=False)
        yield Static(self.nome, id="cabecalho-entidade", markup=False)
        yield DataTable(id="usos", cursor_type="row")
        yield Footer()

    def on_mount(self) -> None:
        entrar(self)
        e = next(x for x in inventario(self.loc, self.fatia, self.snapshot)[self.fatia] if x["name"] == self.nome)
        t = self.query_one("#usos", DataTable)
        t.add_columns("workflow", "papel")
        cor = self.app.current_theme.secondary
        for u in e.get("usos") or []:
            t.add_row(u["workflow"], Text(", ".join(u.get("papeis") or []) or "—", style=cor), key=u["workflow_id"])
        t.focus()

    def on_data_table_row_selected(self, ev: DataTable.RowSelected) -> None:
        self.post_message(Principal.AbrirWorkflow(ev.row_key.value or ""))
