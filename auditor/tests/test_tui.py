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

Etapa 6 — tela principal (substitui o placeholder, mantém `#titulo-principal`):

- Dados só por `mcp.dump`: `inventario` (fatias `workflows`, `tags`, `fields`, `pipelines`, `users`,
  `forms`, `templates`), `achados`, `buscar` e `comparar(loc, antes=<anterior>, depois=<aberto>)`.
- Contadores `#kpi-erro`, `#kpi-aviso`, `#kpi-info`, `#kpi-workflows` (Static): o texto traz o número
  total de achados ERROR/WARN/INFO do snapshot e o nº de workflows.
- `#abas` (TabbedContent) com panes de id `workflows`, `achados`, `entidades`, `diff`; abre em
  `workflows`; teclas `1`–`4` trocam de aba nessa ordem.
- `#tabela-workflows` (DataTable): uma linha por workflow com nome, status, passos, erros, avisos e
  trigger; mais ERROR primeiro. `f` abre `#filtro` (Input); Enter nele mostra só os workflows cujo nome
  contém o texto (sem diferenciar maiúsculas).
- `#tabela-achados` (DataTable): uma linha por grupo de `achados`, com a severidade numa célula
  (`ERROR`/`WARN`/`INFO`). Abre com as três ligadas; `e`/`w`/`i` ligam e desligam cada uma.
- `#tipo-entidade` (Static): o tipo atual entre colchetes, ex. `[tags]`; `right`/`left` percorrem
  tags, campos, funis, usuários, formulários, templates. `#tabela-entidades` (DataTable): os itens
  do tipo, com o nome numa célula; `o` alterna só órfãs (`orphan` verdadeiro).
- `#diff` (Static): o diff entre o snapshot aberto e o imediatamente anterior a ele na lista de
  `dumps()`; sem anterior, o texto "não há snapshot anterior para comparar".
- `/` foca `#busca` (Input); Enter nele preenche `#resultados-busca` (DataTable) com uma linha por
  resultado de `buscar`, o nome numa célula.
- Esc volta à seleção.

Etapa 7 — detalhe do workflow e da entidade (`tui/detalhe.py`):

- Enter num workflow de `#tabela-workflows`, `#tabela-achados` (linha do achado leva ao seu workflow) ou
  `#resultados-busca` empurra o detalhe do workflow. Enter numa linha de `#tabela-entidades` empurra a entidade.
- Detalhe do workflow, dados por `mcp.dump.workflow` e `achados`:
  - `#cabecalho-workflow` (Static): nome, status e nº de passos.
  - `#triggers` (Static): o nome de cada trigger.
  - `#arvore` (Tree): os passos, de `flow.enumerate_paths` agrupados por prefixo (`path_report._trie`), com
    rótulos de `path_report.describe_step`. Cada nó de passo tem `data` = id do step.
  - Passo com achado: `Finding` não tem id de passo, então o critério é o `detail` do achado do workflow que
    começa com `step '<nome do step>'` (nome, ou o `type` se não tiver nome — como as regras escrevem). O rótulo
    desse nó leva `✗` (e cor de erro); os outros não levam `✗`.
  - `n` move o cursor de `#arvore` para o próximo passo com achado, na ordem da árvore.
  - Workflow sem passos: `#sem-passos` (Static) com o texto "sem passos". Só existe nesse caso.
  - `enumerate_paths` devolveu corte (cap padrão atingido): `#aviso-corte` (Static) cujo texto cita "caminhos".
    Só existe nesse caso.
  - `#achados-workflow` (Static): o `detail` de cada achado do workflow, e só dele.
  - `#referencias` (DataTable, cursor de linha): uma linha por referência — tags, campos, usuários notificados,
    funis, formulários, templates, com o NOME numa célula — e uma linha por workflow que o chama (`called_by`).
    Enter numa linha de entidade empurra a entidade.
- Entidade, dados pelos `usos` de `inventario`:
  - `#cabecalho-entidade` (Static): o nome da entidade.
  - `#usos` (DataTable, colunas "workflow" e "papel"): uma linha por workflow, com os papéis DAQUELE workflow
    (nunca a soma dos papéis de todos). Enter numa linha empurra o detalhe daquele workflow.
- Esc volta uma tela (entidade → detalhe → principal), sem fechar a app.
"""

import asyncio
import builtins
import json
import re

import pytest
from conftest import LOC, wf

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


# --- etapa 6: tela principal -------------------------------------------------


def _add(tag, n, prefixo="s"):
    return [
        {"id": f"{prefixo}{i}", "type": "add_contact_tag", "name": "Add", "attributes": {"tags": [tag]}}
        for i in range(n)
    ]


_ORFAO = [
    {"id": "root", "type": "sms", "name": "Root", "next": "s2"},
    {"id": "s2", "type": "wait", "name": "Wait", "parent": "root"},
    {"id": "orphan", "type": "sms", "name": "Órfão", "parent": "ghost"},
]


def _dump_principal(root):
    """ERROR 3 (2 em [Z], 1 em [M]), WARN 1 ([W]), INFO 3 (2 em aaa limpo, unused_form em Form Um), 4 workflows.

    Ordem alfabética (aaa, [M], [W], [Z]) difere da ordem por erros ([Z], [M], ...).
    """
    root(
        workflows=[
            wf(id="wa", name="aaa limpo", steps=_add("usada", 1), triggers=[]),
            wf(id="wm", name="[M] Um → Erro", steps=_add("sumida", 1)),
            wf(id="ww", name="[W] Aviso → Orfao", steps=_ORFAO),
            wf(id="wz", name="[Z] Dois → Erros", steps=_add("sumida", 2)),
        ],
        tags=["usada", "orfa"],
        forms=[{"id": "F1", "name": "Form Um"}],
    )


async def _abrir(pilot, descer=0):
    await pilot.press("right", *["down"] * descer, "enter")
    await pilot.pause()


def _num(app, sel) -> str:
    return _texto(app, sel)


def _sevs(app) -> set[str]:
    t = app.screen.query_one("#tabela-achados")
    return {str(c).strip() for i in range(t.row_count) for c in t.get_row_at(i)} & {"ERROR", "WARN", "INFO"}


def test_principal_mostra_contadores(root):
    _dump_principal(root)

    async def corpo(app, pilot):
        await _abrir(pilot)
        for sel, n in (("#kpi-erro", 3), ("#kpi-aviso", 1), ("#kpi-info", 3), ("#kpi-workflows", 4)):
            assert re.search(rf"\b{n}\b", _num(app, sel)), (sel, _num(app, sel))

    _run(corpo)


def test_teclas_1_a_4_trocam_aba(root):
    _dump_principal(root)

    async def corpo(app, pilot):
        await _abrir(pilot)
        abas = app.screen.query_one("#abas")
        assert abas.active == "workflows"
        for tecla, pane in (("2", "achados"), ("3", "entidades"), ("4", "diff"), ("1", "workflows")):
            await pilot.press(tecla)
            await pilot.pause()
            assert abas.active == pane

    _run(corpo)


def test_workflows_ordenados_por_erros(root):
    _dump_principal(root)

    async def corpo(app, pilot):
        await _abrir(pilot)
        linhas = _linhas(app.screen.query_one("#tabela-workflows"))
        assert len(linhas) == 4
        assert "[Z] Dois" in linhas[0] and "[M] Um" in linhas[1]
        assert "published" in linhas[0]
        assert "Trigger" in linhas[0]  # nome do trigger

    _run(corpo)


def test_workflows_linha_traz_passos_erros_avisos(root):
    _dump_principal(root)

    async def corpo(app, pilot):
        await _abrir(pilot)
        t = app.screen.query_one("#tabela-workflows")
        z = [str(c).strip() for c in t.get_row_at(0)]
        assert z.count("2") >= 2  # 2 passos e 2 erros, cada um na sua célula
        w = next([str(c).strip() for c in t.get_row_at(i)] for i in range(t.row_count) if "[W]" in _linhas(t)[i])
        assert "3" in w and "1" in w  # 3 passos, 1 aviso

    _run(corpo)


def test_f_filtra_workflows_por_texto(root):
    _dump_principal(root)

    async def corpo(app, pilot):
        await _abrir(pilot)
        await pilot.press("f")
        await pilot.pause()
        assert app.focused is app.screen.query_one("#filtro")
        await pilot.press(*"LIMPO", "enter")
        await pilot.pause()
        linhas = _linhas(app.screen.query_one("#tabela-workflows"))
        assert len(linhas) == 1 and "aaa limpo" in linhas[0]

    _run(corpo)


def test_achados_abrem_com_tres_severidades(root):
    _dump_principal(root)

    async def corpo(app, pilot):
        await _abrir(pilot)
        await pilot.press("2")
        await pilot.pause()
        assert _sevs(app) == {"ERROR", "WARN", "INFO"}
        assert app.screen.query_one("#tabela-achados").row_count == 6

    _run(corpo)


@pytest.mark.parametrize(("tecla", "sev"), [("e", "ERROR"), ("w", "WARN"), ("i", "INFO")])
def test_achados_tecla_alterna_severidade(root, tecla, sev):
    _dump_principal(root)

    async def corpo(app, pilot):
        await _abrir(pilot)
        await pilot.press("2")
        await pilot.pause()
        await pilot.press(tecla)
        await pilot.pause()
        assert _sevs(app) == {"ERROR", "WARN", "INFO"} - {sev}
        await pilot.press(tecla)
        await pilot.pause()
        assert _sevs(app) == {"ERROR", "WARN", "INFO"}

    _run(corpo)


def test_entidades_setas_trocam_tipo(root):
    _dump_principal(root)

    async def corpo(app, pilot):
        await _abrir(pilot)
        await pilot.press("3")
        await pilot.pause()
        assert "[tags]" in _texto(app, "#tipo-entidade")
        assert any("orfa" in x for x in _linhas(app.screen.query_one("#tabela-entidades")))
        for tipo in ("campos", "funis", "usuários", "formulários", "templates"):
            await pilot.press("right")
            await pilot.pause()
            assert f"[{tipo}]" in _texto(app, "#tipo-entidade")
            if tipo == "formulários":
                assert any("Form Um" in x for x in _linhas(app.screen.query_one("#tabela-entidades")))
        for tipo in ("formulários", "usuários"):
            await pilot.press("left")
            await pilot.pause()
            assert f"[{tipo}]" in _texto(app, "#tipo-entidade")

    _run(corpo)


def test_entidades_o_mostra_so_orfas(root):
    _dump_principal(root)

    async def corpo(app, pilot):
        await _abrir(pilot)
        await pilot.press("3")
        await pilot.pause()
        assert len(_linhas(app.screen.query_one("#tabela-entidades"))) == 2
        await pilot.press("o")
        await pilot.pause()
        linhas = _linhas(app.screen.query_one("#tabela-entidades"))
        assert len(linhas) == 1 and "orfa" in linhas[0]
        await pilot.press("o")
        await pilot.pause()
        assert len(_linhas(app.screen.query_one("#tabela-entidades"))) == 2

    _run(corpo)


def _tres_snapshots(root):
    root(snapshot="2026-06-08_0000", workflows=[wf(id="w1", name="wf-velho")], tags=[])
    root(snapshot="2026-06-09_0000", workflows=[wf(id="w2", name="wf-meio")], tags=[])
    root(snapshot="2026-06-10_0000", workflows=[wf(id="w3", name="wf-novo")], tags=[])


def test_diff_compara_com_o_anterior_ao_aberto(root):
    _tres_snapshots(root)

    async def corpo(app, pilot):
        await _abrir(pilot, descer=1)  # o do meio
        await pilot.press("4")
        await pilot.pause()
        txt = _texto(app, "#diff")
        assert "wf-meio" in txt and "wf-velho" in txt
        assert "wf-novo" not in txt

    _run(corpo)


def test_diff_sem_anterior_avisa(root):
    _tres_snapshots(root)

    async def corpo(app, pilot):
        await _abrir(pilot, descer=2)  # o mais antigo
        await pilot.press("4")
        await pilot.pause()
        assert "não há snapshot anterior para comparar" in _texto(app, "#diff")

    _run(corpo)


def test_diff_um_snapshot_so(root):
    _dump_principal(root)

    async def corpo(app, pilot):
        await _abrir(pilot)
        await pilot.press("4")
        await pilot.pause()
        assert "não há snapshot anterior para comparar" in _texto(app, "#diff")

    _run(corpo)


def test_barra_busca_mostra_resultados(root):
    _dump_principal(root)

    async def corpo(app, pilot):
        await _abrir(pilot)
        await pilot.press("/")
        await pilot.pause()
        assert app.focused is app.screen.query_one("#busca")
        await pilot.press(*"usada", "enter")
        await pilot.pause()
        linhas = _linhas(app.screen.query_one("#resultados-busca"))
        assert any("usada" in x for x in linhas)
        assert not any("aaa limpo" in x for x in linhas)
        await pilot.press("/")
        await pilot.pause()
        busca = app.screen.query_one("#busca")
        busca.value = ""
        await pilot.press(*"limpo", "enter")
        await pilot.pause()
        linhas = _linhas(app.screen.query_one("#resultados-busca"))
        assert len(linhas) == 1 and "aaa limpo" in linhas[0]

    _run(corpo)


def test_esc_volta_a_selecao(root):
    _dump_principal(root)

    async def corpo(app, pilot):
        await _abrir(pilot)
        assert app.screen.query("#abas")
        await pilot.press("escape")
        await pilot.pause()
        assert app.screen.query("#subcontas")
        assert not app.screen.query("#abas")

    _run(corpo)


# --- etapa 7: detalhe do workflow e da entidade ---------------------------------


def _passo(id, tipo, nome, pai=None, prox=None, **attrs):
    s = {"id": id, "type": tipo, "name": nome, "attributes": attrs}
    if pai:
        s["parent"] = pai
    if prox:
        s["next"] = prox
    return s


def _diamante(n=10):
    """if_else encadeados com os dois ramos no mesmo nó: 2**n caminhos, acima do cap padrão (500)."""
    return [
        _passo(f"d{i}", "if_else", f"Cond {i}", pai=f"d{i - 1}" if i else None, prox=[f"d{i + 1}"] * 2)
        for i in range(n)
    ]


def _dump_detalhe(root):
    alfa = [
        _passo("s1", "add_contact_tag", "Um", prox="s2", tags=["usada"]),
        _passo("s2", "add_contact_tag", "Dois", pai="s1", prox="s3", tags=["sumida-a"]),
        _passo("s3", "update_contact_field", "Tres", pai="s2", prox="s4", fields=[{"field": "F1"}]),
        _passo("s4", "internal_notification", "Quatro", pai="s3", prox="s5", sms={"selectedUser": ["U1"]}),
        _passo("s5", "add_contact_tag", "Cinco", pai="s4", tags=["sumida-b"]),
    ]
    trig_beta = [{"id": "tb", "name": "Trig Beta", "conditions": [{"field": "contact.tags", "value": ["usada"]}]}]
    root(
        workflows=[
            wf(id="wa", name="Alfa", steps=alfa),
            wf(
                id="wb",
                name="Beta",
                steps=[_passo("b1", "add_to_workflow", "Chama", workflow_id="wa")],
                triggers=trig_beta,
            ),
            wf(id="wv", name="Vazio", steps=[]),
            wf(id="wx", name="Corte", steps=_diamante()),
        ],
        tags=["usada"],
        fields=[{"id": "F1", "name": "Campo Um"}],
        users=[{"id": "U1", "name": "Ana Nota"}],
    )


async def _enter_em(pilot, tabela, pred):
    linhas = _linhas(tabela)
    i = next(i for i, x in enumerate(linhas) if pred(x))
    tabela.move_cursor(row=i)
    tabela.focus()
    await pilot.pause()
    await pilot.press("enter")
    await pilot.pause()


async def _detalhe(app, pilot, nome):
    await _abrir(pilot)
    await _enter_em(pilot, app.screen.query_one("#tabela-workflows"), lambda x: x.startswith(nome + " "))


def _nos(tree):
    pilha, out = list(tree.root.children), []
    while pilha:
        no = pilha.pop(0)
        out.append(no)
        pilha[:0] = list(no.children)
    return out


def _no(app, sid):
    return next(n for n in _nos(app.screen.query_one("#arvore")) if n.data == sid)


def test_detalhe_cabecalho_e_triggers(root):
    _dump_detalhe(root)

    async def corpo(app, pilot):
        await _detalhe(app, pilot, "Alfa")
        cab = _texto(app, "#cabecalho-workflow")
        assert "Alfa" in cab and "published" in cab and re.search(r"\b5\b", cab)
        assert "Trigger" in _texto(app, "#triggers")

    _run(corpo)


def test_detalhe_arvore_com_rotulos_de_describe_step(root):
    _dump_detalhe(root)

    async def corpo(app, pilot):
        await _detalhe(app, pilot, "Alfa")
        assert {n.data for n in _nos(app.screen.query_one("#arvore"))} >= {"s1", "s2", "s3", "s4", "s5"}
        assert "update field Campo Um" in str(_no(app, "s3").label)
        assert "notificar Ana Nota" in str(_no(app, "s4").label)
        assert not app.screen.query("#sem-passos") and not app.screen.query("#aviso-corte")

    _run(corpo)


def test_detalhe_passo_com_achado_leva_x(root):
    _dump_detalhe(root)

    async def corpo(app, pilot):
        await _detalhe(app, pilot, "Alfa")
        for sid in ("s2", "s5"):
            assert "✗" in str(_no(app, sid).label), sid
        for sid in ("s1", "s3", "s4"):
            assert "✗" not in str(_no(app, sid).label), sid

    _run(corpo)


def test_detalhe_n_pula_para_proximo_erro(root):
    _dump_detalhe(root)

    async def corpo(app, pilot):
        await _detalhe(app, pilot, "Alfa")
        tree = app.screen.query_one("#arvore")
        await pilot.press("n")
        await pilot.pause()
        assert tree.cursor_node.data == "s2"
        await pilot.press("n")
        await pilot.pause()
        assert tree.cursor_node.data == "s5"

    _run(corpo)


def test_detalhe_painel_de_achados_so_do_workflow(root):
    _dump_detalhe(root)

    async def corpo(app, pilot):
        await _detalhe(app, pilot, "Alfa")
        txt = _texto(app, "#achados-workflow")
        assert "sumida-a" in txt and "sumida-b" in txt
        assert "Beta" not in txt and "Vazio" not in txt

    _run(corpo)


def test_detalhe_referencias(root):
    _dump_detalhe(root)

    async def corpo(app, pilot):
        await _detalhe(app, pilot, "Alfa")
        linhas = _linhas(app.screen.query_one("#referencias"))
        for nome in ("usada", "Campo Um", "Ana Nota", "Beta"):
            assert any(nome in x for x in linhas), nome

    _run(corpo)


def test_detalhe_sem_passos(root):
    _dump_detalhe(root)

    async def corpo(app, pilot):
        await _detalhe(app, pilot, "Vazio")
        assert "sem passos" in _texto(app, "#sem-passos")

    _run(corpo)


def test_detalhe_aviso_de_corte(root):
    _dump_detalhe(root)

    async def corpo(app, pilot):
        await _detalhe(app, pilot, "Corte")
        assert "caminhos" in _texto(app, "#aviso-corte")

    _run(corpo)


def test_referencia_abre_entidade_com_papel_por_workflow(root):
    _dump_detalhe(root)

    async def corpo(app, pilot):
        await _detalhe(app, pilot, "Alfa")
        await _enter_em(pilot, app.screen.query_one("#referencias"), lambda x: "usada" in x)
        assert "usada" in _texto(app, "#cabecalho-entidade")
        usos = app.screen.query_one("#usos")
        linhas = _linhas(usos)
        assert len(linhas) == 2
        alfa = next(x for x in linhas if "Alfa" in x)
        beta = next(x for x in linhas if "Beta" in x)
        assert "adiciona" in alfa and "condicao" not in alfa
        assert "condicao" in beta and "adiciona" not in beta

    _run(corpo)


def test_entidade_enter_abre_workflow_e_esc_volta_uma_tela(root):
    _dump_detalhe(root)

    async def corpo(app, pilot):
        await _detalhe(app, pilot, "Alfa")
        await _enter_em(pilot, app.screen.query_one("#referencias"), lambda x: "usada" in x)
        await _enter_em(pilot, app.screen.query_one("#usos"), lambda x: "Beta" in x)
        assert "Beta" in _texto(app, "#cabecalho-workflow")
        await pilot.press("escape")
        await pilot.pause()
        assert "usada" in _texto(app, "#cabecalho-entidade")
        await pilot.press("escape")
        await pilot.pause()
        assert "Alfa" in _texto(app, "#cabecalho-workflow")
        await pilot.press("escape")
        await pilot.pause()
        assert app.screen.query("#abas") and not app.screen.query("#cabecalho-workflow")
        assert app.is_running

    _run(corpo)


def test_enter_nos_achados_abre_workflow(root):
    _dump_detalhe(root)

    async def corpo(app, pilot):
        await _abrir(pilot)
        await pilot.press("2")
        await pilot.pause()
        await _enter_em(pilot, app.screen.query_one("#tabela-achados"), lambda x: "sumida-a" in x)
        assert "Alfa" in _texto(app, "#cabecalho-workflow")

    _run(corpo)


def test_enter_na_busca_abre_workflow(root):
    _dump_detalhe(root)

    async def corpo(app, pilot):
        await _abrir(pilot)
        await pilot.press("/")
        await pilot.pause()
        await pilot.press(*"Beta", "enter")
        await pilot.pause()
        await _enter_em(pilot, app.screen.query_one("#resultados-busca"), lambda x: "Beta" in x)
        assert "Beta" in _texto(app, "#cabecalho-workflow")

    _run(corpo)


def test_enter_nas_entidades_abre_entidade(root):
    _dump_detalhe(root)

    async def corpo(app, pilot):
        await _abrir(pilot)
        await pilot.press("3")
        await pilot.pause()
        await _enter_em(pilot, app.screen.query_one("#tabela-entidades"), lambda x: "usada" in x)
        assert "usada" in _texto(app, "#cabecalho-entidade")
        assert len(_linhas(app.screen.query_one("#usos"))) == 2

    _run(corpo)
