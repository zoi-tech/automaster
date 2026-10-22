"""Etapa 10: ajustes vistos nas provas parciais (ficha, cadência em laço e tabela do `zoi.css`).

- Ficha: e-mail sem corpo mostra o assunto; aviso interno que usa modelo mostra o nome e o
  corpo do modelo (ou "modelo <id>" quando o dump não tem o modelo).
- `cadencias`: follow-up que repete com `goto` voltando para uma espera de tempo conta; laço
  sem espera de tempo no ciclo não conta; laço nunca trava.
- `zoi.css`: a tabela cabe na largura com a borda direita visível.

Ids, nomes e textos daqui são inventados: o repositório é público.
"""

import re
import signal
from contextlib import contextmanager
from itertools import pairwise
from pathlib import Path

import pytest
from conftest import wf

from automaster_audit.ficha import gerar_fichas
from automaster_audit.loader import load_dump
from automaster_audit.rules._helpers import cadencias

RAIZ = Path(__file__).resolve().parents[2]
CSS = RAIZ / "skills" / "automaster-documentar" / "manual" / "zoi.css"


def _plano(texto):
    """Texto sem marcação de ênfase/código, em minúsculas: o formato do Markdown é livre."""
    return re.sub(r"[*`]", "", texto).lower()


def _ficha(make_dump, steps, **kw):
    envelope = wf(id="w1", name="Fluxo Teste", steps=steps)
    return gerar_fichas(load_dump(make_dump(workflows=[envelope], **kw)))


# ---------------------------------------------------------------------------
# ficha: assunto do e-mail
# ---------------------------------------------------------------------------


def test_email_sem_corpo_mostra_assunto(make_dump):
    steps = [
        {
            "id": "m",
            "type": "email",
            "name": "Confirmacao",
            "attributes": {"subject": "Sua visita está confirmada", "template_id": "t1"},
        }
    ]
    out = _plano(_ficha(make_dump, steps))
    assert "assunto: sua visita está confirmada" in out


def test_email_com_corpo_continua_mostrando_corpo(make_dump):
    steps = [
        {
            "id": "m",
            "type": "email",
            "name": "Confirmacao",
            "attributes": {"subject": "Sua visita está confirmada", "body": "Te esperamos na loja amanhã"},
        }
    ]
    assert "Te esperamos na loja amanhã" in _ficha(make_dump, steps)


# ---------------------------------------------------------------------------
# ficha: aviso interno com modelo
# ---------------------------------------------------------------------------

MODELOS = [
    {"id": "tpl1", "name": "Aviso de novo lead", "template": {"body": "Você tem um novo lead"}, "type": "sms"},
    {"id": "tpl9", "name": "Modelo de outro fluxo", "template": {"body": "Texto que não é deste passo"}, "type": "sms"},
]


def _aviso(canal, template_id="tpl1"):
    """Notificação interna (`attributes.type` = sms/email) que tira o texto de um modelo."""
    return [
        {
            "id": "n",
            "type": "internal_notification",
            "name": "Avisa vendedor",
            "attributes": {
                "type": canal,
                canal: {"template_id": template_id, "userType": "user", "selectedUser": ["u1"]},
            },
        }
    ]


@pytest.mark.parametrize("canal", ["sms", "email"])
def test_aviso_interno_mostra_nome_e_corpo_do_modelo(make_dump, canal):
    out = _ficha(make_dump, _aviso(canal), message_templates=MODELOS)
    assert "Aviso de novo lead" in out
    assert "Você tem um novo lead" in out
    # só o modelo do passo, não a lista inteira do dump
    assert "Modelo de outro fluxo" not in out
    assert "Texto que não é deste passo" not in out


@pytest.mark.parametrize("canal", ["sms", "email"])
def test_aviso_interno_sem_modelo_no_dump_mostra_id(make_dump, canal):
    out = _ficha(make_dump, _aviso(canal, template_id="tpl1"), message_templates=MODELOS[1:])
    assert "modelo tpl1" in _plano(out)
    assert "Aviso de novo lead" not in out


@pytest.mark.parametrize("canal", ["sms", "email"])
def test_aviso_interno_sem_arquivo_de_modelos_mostra_id(make_dump, canal):
    out = _ficha(make_dump, _aviso(canal, template_id="tpl1"))
    assert "modelo tpl1" in _plano(out)


def test_aviso_interno_com_texto_proprio_continua_mostrando_texto(make_dump):
    steps = [
        {
            "id": "n",
            "type": "internal_notification",
            "name": "Avisa vendedor",
            "attributes": {"notification": {"body": "Lead novo chegou pelo site"}},
        }
    ]
    out = _ficha(make_dump, steps, message_templates=MODELOS)
    assert "Lead novo chegou pelo site" in out
    assert "Aviso de novo lead" not in out


# ---------------------------------------------------------------------------
# cadencias: follow-up em laço com goto
# ---------------------------------------------------------------------------


@contextmanager
def _prazo(segundos=5):
    """Falha (em vez de travar a suíte) se a chamada não voltar no prazo."""

    def estourou(_sig, _frame):
        raise TimeoutError(f"cadencias não voltou em {segundos}s: laço infinito")

    anterior = signal.signal(signal.SIGALRM, estourou)
    signal.alarm(segundos)
    try:
        yield
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, anterior)


def _cadencias(make_dump, steps, status="published"):
    w = wf(id="wf1", name="[Teste] Follow-up", status=status, steps=steps)
    w["raw"]["list_entry"]["parentId"] = "pasta1"
    ctx = load_dump(make_dump(workflows=[w]))
    with _prazo():
        return cadencias(ctx)


def _passo(sid, tipo, parent=None, next=None, attributes=None):
    s = {"id": sid, "type": tipo, "name": f"Passo {sid}", "attributes": attributes or {}}
    if parent:
        s["parentKey"] = parent
    if next:
        s["next"] = next
    return s


def _msg(sid, parent=None, next=None):
    return _passo(sid, "sms", parent, next, {"body": "Oi, ainda tem interesse no carro?"})


def _espera(sid, parent=None, next=None):
    return _passo(
        sid, "wait", parent, next, {"type": "time", "startAfter": {"type": "days", "value": 1, "when": "after"}}
    )


def _zera(sid, parent=None, next=None):
    return _passo(sid, "update_contact_field", parent, next, {"fields": [{"field": "contador", "value": "0"}]})


def _goto(sid, alvo, parent=None):
    return _passo(sid, "goto", parent, attributes={"targetNodeId": alvo})


def _cadeia(*passos):
    passos = [dict(p) for p in passos]
    for anterior, atual in pairwise(passos):
        anterior["next"] = atual["id"]
        atual["parentKey"] = anterior["id"]
    return passos


def _follow_up(alvo_goto=None):
    """zera → espera 1 dia → if_else pelo contador (ramos "1" e "2", senão sai) → sms → goto `alvo_goto`.

    Sem `alvo_goto` os ramos terminam no sms (não repete).
    """
    passos = [
        _zera("z", next="e"),
        _espera("e", parent="z", next="c"),
        {
            "id": "c",
            "type": "if_else",
            "name": "Contador",
            "parentKey": "e",
            "attributes": {
                "branches": [
                    {"id": "r1", "name": "1", "operator": "and", "segments": []},
                    {"id": "r2", "name": "2", "operator": "and", "segments": []},
                ]
            },
            "next": ["r1", "r2", "rn"],
        },
        {"id": "r1", "type": "if_else", "name": "1", "parentKey": "c", "attributes": {"if": False}, "next": "m1"},
        {"id": "r2", "type": "if_else", "name": "2", "parentKey": "c", "attributes": {"if": False}, "next": "m2"},
        {"id": "rn", "type": "if_else", "name": "None", "parentKey": "c", "attributes": {"else": True}},
        _msg("m1", parent="r1", next="g1" if alvo_goto else None),
        _msg("m2", parent="r2", next="g2" if alvo_goto else None),
    ]
    if alvo_goto:
        passos += [_goto("g1", alvo_goto, parent="m1"), _goto("g2", alvo_goto, parent="m2")]
    return passos


def test_follow_up_que_volta_para_a_espera_e_cadencia(make_dump):
    assert _cadencias(make_dump, _follow_up(alvo_goto="e")) == ["wf1"]


def test_follow_up_que_volta_para_antes_da_espera_e_cadencia(make_dump):
    """O goto volta para o passo que zera: a espera de tempo continua dentro do ciclo."""
    assert _cadencias(make_dump, _follow_up(alvo_goto="z")) == ["wf1"]


def test_mensagem_espera_e_goto_de_volta_para_a_mensagem_e_cadencia(make_dump):
    steps = [*_cadeia(_msg("m1"), _espera("e")), _goto("g", "m1", parent="e")]
    steps[1]["next"] = "g"
    assert _cadencias(make_dump, steps) == ["wf1"]


def test_follow_up_sem_goto_nao_e_cadencia(make_dump):
    """Espera antes de uma única mensagem por ramo, sem repetir: não é cadência."""
    assert _cadencias(make_dump, _follow_up(alvo_goto=None)) == []


def test_follow_up_em_rascunho_nao_e_cadencia(make_dump):
    assert _cadencias(make_dump, _follow_up(alvo_goto="e"), status="draft") == []


@pytest.mark.parametrize("alvo", ["m1", "z"], ids=["goto-para-o-sms", "goto-para-passo-antes"])
def test_laco_sem_espera_no_ciclo_nao_e_cadencia(make_dump, alvo):
    """Há espera de tempo antes do laço, mas o ciclo (z → sms → goto) não passa por ela."""
    steps = [*_cadeia(_espera("e"), _zera("z"), _msg("m1")), _goto("g", alvo, parent="m1")]
    steps[2]["next"] = "g"
    assert _cadencias(make_dump, steps) == []


def test_goto_circular_termina(make_dump):
    """Dois gotos que apontam um para o outro e um goto para si mesmo: a função tem que voltar."""
    steps = [
        _msg("m1", next="g1"),
        _goto("g1", "g2", parent="m1"),
        _goto("g2", "g1", parent="g1"),
        _goto("g3", "g3", parent="g2"),
    ]
    steps[1]["next"] = "g2"
    steps[2]["next"] = "g3"
    assert _cadencias(make_dump, steps) == []


def test_ramos_que_voltam_para_pontos_diferentes_terminam(make_dump):
    """Cada ramo do follow-up volta para um ponto diferente do ciclo; tudo tem que voltar."""
    steps = _follow_up(alvo_goto="e")
    for s in steps:
        if s["id"] == "g2":
            s["attributes"]["targetNodeId"] = "z"
    assert _cadencias(make_dump, steps) == ["wf1"]


# ---------------------------------------------------------------------------
# zoi.css: tabela cabe na largura com a borda direita visível
# ---------------------------------------------------------------------------


def _regras_table(css: str) -> list[dict[str, str]]:
    """Declarações de cada regra cujo seletor é `table` (inclusive dentro de @media)."""
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.DOTALL)
    regras = []
    for seletor, corpo in re.findall(r"([^{}]+)\{([^{}]*)\}", css):
        if "table" not in [s.strip() for s in seletor.split(",")]:
            continue
        decl = {}
        for item in corpo.split(";"):
            if ":" in item:
                k, v = item.split(":", 1)
                decl[k.strip().lower()] = re.sub(r"\s+", " ", v.strip().lower())
        regras.append(decl)
    return regras


def test_tabela_cabe_na_largura_com_borda_direita():
    regras = [r for r in _regras_table(CSS.read_text(encoding="utf-8")) if "width" in r]
    assert regras, "zoi.css não tem regra `table` com width"
    for r in regras:
        largura = r["width"].replace(" ", "")
        cabe = largura == "calc(100%-1px)" or (largura == "100%" and r.get("box-sizing") == "border-box")
        assert cabe, f"tabela com width {r['width']!r} sem box-sizing: border-box corta a borda direita: {r}"
