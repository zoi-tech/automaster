"""Etapa 11: falhas vistas na prova em duas subcontas (ficha, sobra de IA, `zoi.css` e manual).

- Ficha: passo de WhatsApp com `template_id` mostra o modelo do dump (nome e BODY), não o
  `message` guardado no passo, que pode ser prévia velha; sem o modelo, mostra o id e marca o
  `message` como prévia. Aviso interno por WhatsApp mostra o modelo. `goto` mostra o nome do
  passo de destino.
- `ai_leftover_published`: passos `chatgpt`, `gpt_*` e `openai_*` acusam em publicado.
- `zoi.css`: a faixa de fases usa colunas automáticas; `.ramos.tres` tem três colunas.
- `manual.md`: o texto do passo de WhatsApp pode ser prévia velha; vale o modelo pelo id.

Ids, nomes e textos daqui são inventados: o repositório é público.
"""

import re
from pathlib import Path

import pytest
from conftest import wf

from automaster_audit.ficha import gerar_fichas
from automaster_audit.loader import load_dump
from automaster_audit.rules import ai_leftover_published

RAIZ = Path(__file__).resolve().parents[2]
CSS = RAIZ / "skills" / "automaster-documentar" / "manual" / "zoi.css"
MANUAL = RAIZ / "skills" / "automaster-documentar" / "manual.md"


def _plano(texto):
    """Texto sem marcação de ênfase/código, em minúsculas: o formato do Markdown é livre."""
    return re.sub(r"[*`]", "", texto).lower()


def _ficha(make_dump, steps, **kw):
    envelope = wf(id="w1", name="Fluxo Teste", steps=steps)
    return gerar_fichas(load_dump(make_dump(workflows=[envelope], **kw)))


def _linha_com(texto, trecho):
    """Primeira linha da ficha que contém `trecho` (e o índice dela)."""
    linhas = texto.splitlines()
    for i, linha in enumerate(linhas):
        if trecho in linha:
            return i, linha
    raise AssertionError(f"{trecho!r} não aparece na ficha:\n{texto}")


# ---------------------------------------------------------------------------
# ficha: passo de WhatsApp com modelo
# ---------------------------------------------------------------------------

MODELOS_WA = [
    {
        "id": "t2h",
        "name": "lembrete_2_horas",
        "components": [
            # o BODY não é o primeiro componente: o texto vem do BODY, não de components[0]
            {"type": "HEADER", "format": "TEXT", "text": "Lembrete"},
            {"type": "BODY", "text": "Seu horário é daqui a 2 horas"},
        ],
    },
    {
        "id": "t9",
        "name": "modelo_de_outro_fluxo",
        "components": [{"type": "BODY", "text": "Texto que não é deste passo"}],
    },
]


def _zap(template_id="t2h", message="texto velho de 3 dias"):
    attributes = {"message": message}
    if template_id:
        attributes["template_id"] = template_id
    return [{"id": "z", "type": "whatsapp_v2", "name": "Lembrete", "attributes": attributes}]


def test_whatsapp_com_modelo_mostra_nome_e_body_do_modelo(make_dump):
    out = _ficha(make_dump, _zap(), whatsapp_templates=MODELOS_WA)
    assert "lembrete_2_horas" in out
    assert "Seu horário é daqui a 2 horas" in out
    # só o modelo do passo, não a lista inteira do dump
    assert "modelo_de_outro_fluxo" not in out
    assert "Texto que não é deste passo" not in out


def test_whatsapp_com_modelo_nao_mostra_previa_velha(make_dump):
    out = _ficha(make_dump, _zap(), whatsapp_templates=MODELOS_WA)
    assert "texto velho de 3 dias" not in out


def _confere_previa(out):
    assert "modelo t2h" in _plano(out)
    i, linha = _linha_com(out, "texto velho de 3 dias")
    anterior = out.splitlines()[i - 1] if i else ""
    assert "prévia" in linha.lower() or "prévia" in anterior.lower(), (
        f"o texto guardado no passo não está marcado como prévia:\n{out}"
    )


def test_whatsapp_sem_o_modelo_no_dump_mostra_id_e_previa(make_dump):
    out = _ficha(make_dump, _zap(), whatsapp_templates=MODELOS_WA[1:])
    _confere_previa(out)
    assert "modelo_de_outro_fluxo" not in out


def test_whatsapp_sem_arquivo_de_modelos_mostra_id_e_previa(make_dump):
    _confere_previa(_ficha(make_dump, _zap()))


def test_whatsapp_sem_template_id_continua_mostrando_message(make_dump):
    out = _ficha(make_dump, _zap(template_id=None, message="Oi, seu carro ficou pronto"), whatsapp_templates=MODELOS_WA)
    assert "Oi, seu carro ficou pronto" in out
    assert "prévia" not in out.lower()
    assert "lembrete_2_horas" not in out


# ---------------------------------------------------------------------------
# ficha: aviso interno por WhatsApp com modelo
# ---------------------------------------------------------------------------

MODELO_AVISO = {
    "id": "tav",
    "name": "cliente_parado",
    "components": [{"type": "BODY", "text": "Cliente parado há 3 dias"}],
}


def _aviso_zap(template_id="tav"):
    return [
        {
            "id": "n",
            "type": "internal_notification",
            "name": "Avisa vendedor",
            "attributes": {"type": "whatsapp", "whatsapp": {"userType": "assign", "template_id": template_id}},
        }
    ]


def test_aviso_interno_por_whatsapp_mostra_nome_e_body_do_modelo(make_dump):
    out = _ficha(make_dump, _aviso_zap(), whatsapp_templates=[MODELO_AVISO, MODELOS_WA[1]])
    assert "cliente_parado" in out
    assert "Cliente parado há 3 dias" in out
    assert "modelo_de_outro_fluxo" not in out


def test_aviso_interno_por_whatsapp_sem_modelo_no_dump_mostra_id(make_dump):
    out = _ficha(make_dump, _aviso_zap(), whatsapp_templates=MODELOS_WA)
    assert "modelo tav" in _plano(out)
    assert "cliente_parado" not in out


def test_aviso_interno_por_whatsapp_sem_arquivo_de_modelos_mostra_id(make_dump):
    assert "modelo tav" in _plano(_ficha(make_dump, _aviso_zap()))


# ---------------------------------------------------------------------------
# ficha: goto mostra o nome do destino
# ---------------------------------------------------------------------------


def _com_goto(alvo):
    return [
        {
            "id": "passo-espera",
            "type": "wait",
            "name": "Espera 1 dia",
            "attributes": {"type": "time", "startAfter": {"type": "days", "value": 1, "when": "after"}},
            "next": "m",
        },
        {
            "id": "m",
            "type": "sms",
            "name": "Cobra resposta",
            "parentKey": "passo-espera",
            "attributes": {"body": "Ainda tem interesse?"},
            "next": "g",
        },
        {"id": "g", "type": "goto", "name": "Repete", "parentKey": "m", "attributes": {"targetNodeId": alvo}},
    ]


def test_goto_mostra_nome_do_destino_na_linha(make_dump):
    out = _ficha(make_dump, _com_goto("passo-espera"))
    _, linha = _linha_com(out, "`goto`")
    assert "Espera 1 dia" in linha, f"a linha do goto não cita o destino: {linha!r}"
    assert "passo-espera" in linha


def test_goto_para_destino_inexistente_mostra_so_o_id(make_dump):
    out = _ficha(make_dump, _com_goto("passo-sumido"))
    _, linha = _linha_com(out, "`goto`")
    assert "passo-sumido" in linha
    assert "Espera 1 dia" not in linha
    assert "Cobra resposta" not in linha
    assert "None" not in linha


# ---------------------------------------------------------------------------
# ai_leftover_published: tipos de passo do ChatGPT/OpenAI
# ---------------------------------------------------------------------------


def _ctx_ia(make_dump, tipo, status="published"):
    w = wf(id="wf1", name="[Teste] Fluxo IA", status=status, steps=[{"id": "p", "type": tipo, "name": "Passo"}])
    w["raw"]["list_entry"]["parentId"] = "pasta1"
    return load_dump(make_dump(workflows=[w]))


@pytest.mark.parametrize("tipo", ["chatgpt", "gpt_4", "openai_assistant"])
def test_passo_de_chatgpt_em_publicado_acusa(make_dump, tipo):
    findings = ai_leftover_published.check(_ctx_ia(make_dump, tipo))
    assert len(findings) == 1, findings
    assert findings[0].rule == "ai_leftover_published"
    assert findings[0].workflow_id == "wf1"
    assert "a conferir" in findings[0].detail


@pytest.mark.parametrize("tipo", ["chatgpt", "gpt_4", "openai_assistant"])
def test_passo_de_chatgpt_em_rascunho_nao_acusa(make_dump, tipo):
    assert ai_leftover_published.check(_ctx_ia(make_dump, tipo, status="draft")) == []


@pytest.mark.parametrize("tipo", ["email", "wait"])
def test_tipo_comum_continua_sem_acusar(make_dump, tipo):
    assert ai_leftover_published.check(_ctx_ia(make_dump, tipo)) == []


# ---------------------------------------------------------------------------
# zoi.css: faixa de fases com colunas automáticas e ramos em três colunas
# ---------------------------------------------------------------------------


def _regras_topo(css: str) -> list[tuple[list[str], dict[str, str]]]:
    """(seletores, declarações) das regras fora de @media: o layout de tela cheia é o que conta."""
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.DOTALL)
    regras, nivel, inicio, seletor = [], 0, 0, ""
    for i, c in enumerate(css):
        if c == "{":
            if nivel == 0:
                seletor, inicio = css[inicio:i], i + 1
            nivel += 1
        elif c == "}":
            nivel -= 1
            if nivel == 0:
                corpo = css[inicio:i]
                inicio = i + 1
                if "{" in corpo or seletor.strip().startswith("@"):
                    continue
                decl = {}
                for item in corpo.split(";"):
                    if ":" in item:
                        k, v = item.split(":", 1)
                        decl[k.strip().lower()] = re.sub(r"\s+", " ", v.strip().lower())
                regras.append(([s.strip() for s in seletor.split(",")], decl))
    return regras


def _colunas(seletor: str) -> list[str]:
    return [
        d["grid-template-columns"]
        for seletores, d in _regras_topo(CSS.read_text(encoding="utf-8"))
        if seletor in seletores and "grid-template-columns" in d
    ]


def test_jornada_usa_colunas_automaticas():
    colunas = _colunas(".jornada")
    assert colunas, "zoi.css não tem regra `.jornada` com grid-template-columns"
    for valor in colunas:
        assert "auto-fit" in valor, f".jornada com colunas fixas: {valor!r}"
        assert "repeat(4" not in valor.replace(" ", ""), valor


def test_ramos_tres_tem_tres_colunas():
    colunas = _colunas(".ramos.tres")
    assert colunas, "zoi.css não tem regra `.ramos.tres` com grid-template-columns"
    valor = colunas[-1]
    tres = valor.replace(" ", "").startswith("repeat(3,") or valor.split() == ["1fr", "1fr", "1fr"]
    assert tres, f".ramos.tres não tem três colunas: {valor!r}"


# ---------------------------------------------------------------------------
# manual.md: prévia velha no passo de WhatsApp
# ---------------------------------------------------------------------------


def test_manual_diz_que_o_texto_do_passo_pode_ser_previa_e_vale_o_modelo_pelo_id():
    texto = MANUAL.read_text(encoding="utf-8")
    # parágrafo ou item de lista: itens colados não contam como um parágrafo só
    blocos = re.split(r"\n\s*\n|\n(?=\s*(?:[-*]|\d+\.)\s)", texto)
    achou = [b for b in map(_plano, blocos) if "prévia" in b and ("template_id" in b or "pelo id" in b)]
    assert achou, "manual.md não diz que o texto do passo pode ser prévia e que vale o modelo pelo id"
