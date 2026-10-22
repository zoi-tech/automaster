"""Etapa 9: prova do automaster-documentar em duas subcontas.

O registro em `docs/vesta/provas/2026-10-22-documentar.md` traz uma tabela com uma linha por
subconta (A já reestruturada, B concessionária) e um resumo anonimizado do relatório da B.
O repositório é público: o registro não pode ter nome de cliente, id, telefone, e-mail nem
caminho local.
"""

import re
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[2]
REGISTRO = RAIZ / "docs" / "vesta" / "provas" / "2026-10-22-documentar.md"

COLUNAS = [
    "Prova",
    "Data",
    "Páginas",
    "Seções estouradas",
    "Termos internos",
    "Regras novas que acusaram",
    "Conferido página a página",
]
PROVA_A = "subconta A (concessionária, já reestruturada)"
PROVA_B = "subconta B (concessionária)"
REGRAS_NOVAS = {
    "opportunity_trigger_no_pipeline",
    "impossible_time_condition",
    "appointment_waits_out_of_order",
    "published_outside_folder",
    "exposed_secret",
    "create_opportunity_without_lookup",
    "notify_owner_after_unassign",
    "duplicate_reply_responders",
    "loss_keeps_cadence",
    "cadence_without_exit",
    "ai_leftover_published",
}

NOMES_CLIENTE = re.compile(r"nick|seller|multimarcas", re.IGNORECASE)
TELEFONE = re.compile(r"\(?\d{2}\)?\s?9?\d{4}-?\d{4}")


def _celulas(linha: str) -> list[str]:
    return [c.strip() for c in linha.strip().strip("|").split("|")]


@pytest.fixture(scope="module")
def texto() -> str:
    assert REGISTRO.is_file(), f"falta {REGISTRO}"
    return REGISTRO.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def linhas(texto) -> list[dict[str, str]]:
    """Linhas da tabela cujo cabeçalho é exatamente COLUNAS, como dicionários coluna -> valor."""
    todas = texto.splitlines()
    for i, linha in enumerate(todas):
        if linha.strip().startswith("|") and _celulas(linha) == COLUNAS:
            corpo = []
            for seguinte in todas[i + 2 :]:
                if not seguinte.strip().startswith("|"):
                    break
                corpo.append(dict(zip(COLUNAS, _celulas(seguinte), strict=False)))
            return corpo
    pytest.fail(f"o registro não tem tabela com o cabeçalho {' | '.join(COLUNAS)}")


def _linha(linhas, prova: str) -> dict[str, str]:
    achadas = [ln for ln in linhas if ln["Prova"].startswith(prova)]
    assert achadas, f"falta a linha de prova {prova!r}"
    return achadas[0]


def _secao(texto: str, titulo: str) -> str | None:
    m = re.search(rf"^## {re.escape(titulo)}\s*$.*?(?=^## |\Z)", texto, re.MULTILINE | re.DOTALL)
    return m.group(0) if m else None


# ---------------------------------------------------------------------------
# tabela de provas
# ---------------------------------------------------------------------------


def test_tabela_tem_duas_linhas_de_prova(linhas):
    assert len(linhas) >= 2, f"a tabela precisa de pelo menos duas linhas, tem {len(linhas)}"
    _linha(linhas, PROVA_A)
    _linha(linhas, PROVA_B)


@pytest.mark.parametrize("prova", [PROVA_A, PROVA_B])
def test_linha_tem_todas_as_colunas(linhas, prova):
    linha = _linha(linhas, prova)
    vazias = [c for c in COLUNAS if not linha.get(c)]
    assert not vazias, f"{prova}: colunas vazias {vazias}"


@pytest.mark.parametrize("prova", [PROVA_A, PROVA_B])
def test_data_no_formato_iso(linhas, prova):
    data = _linha(linhas, prova)["Data"]
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", data), f"{prova}: data {data!r} fora de AAAA-MM-DD"


@pytest.mark.parametrize("prova", [PROVA_A, PROVA_B])
def test_paginas_inteiro_maior_que_um(linhas, prova):
    paginas = _linha(linhas, prova)["Páginas"]
    assert re.fullmatch(r"\d+", paginas), f"{prova}: páginas {paginas!r} não é inteiro"
    assert int(paginas) > 1, f"{prova}: o PDF tem {paginas} página(s)"


@pytest.mark.parametrize("prova", [PROVA_A, PROVA_B])
@pytest.mark.parametrize("coluna", ["Seções estouradas", "Termos internos"])
def test_contagem_zerada(linhas, prova, coluna):
    valor = _linha(linhas, prova)[coluna]
    assert valor == "0", f"{prova}: {coluna} = {valor!r}, deveria ser 0"


@pytest.mark.parametrize("prova", [PROVA_A, PROVA_B])
def test_regras_novas_que_acusaram(linhas, prova):
    valor = _linha(linhas, prova)["Regras novas que acusaram"]
    if valor == "nenhuma":
        return
    for item in valor.split(","):
        m = re.fullmatch(r"\s*`?([a-z_]+)`?\s*:\s*(\d+)\s*", item)
        assert m, f"{prova}: item {item.strip()!r} fora do formato nome_da_regra: N"
        nome, n = m.group(1), int(m.group(2))
        assert nome in REGRAS_NOVAS, f"{prova}: {nome!r} não é uma das regras novas"
        assert n >= 1, f"{prova}: {nome} com contagem {n}"


@pytest.mark.parametrize("prova", [PROVA_A, PROVA_B])
def test_conferido_pagina_a_pagina(linhas, prova):
    valor = _linha(linhas, prova)["Conferido página a página"]
    assert valor == "sim", f"{prova}: conferido página a página = {valor!r}"


# ---------------------------------------------------------------------------
# relatório da subconta B
# ---------------------------------------------------------------------------


def test_relatorio_da_subconta_b_abaixo_da_tabela(texto, linhas):
    _linha(linhas, PROVA_B)
    secao = _secao(texto, "Relatório da subconta B")
    assert secao, "falta a seção '## Relatório da subconta B'"
    linha_b = next(ln for ln in texto.splitlines() if ln.strip().startswith("|") and PROVA_B in ln)
    assert texto.index(secao) > texto.index(linha_b), "o relatório da subconta B precisa vir abaixo da tabela"
    itens = re.findall(r"^\s*(?:[-*]|\d+\.)\s+\S", secao, re.MULTILINE)
    assert len(itens) >= 3, f"o relatório da subconta B tem {len(itens)} item(ns), precisa de pelo menos 3"


# ---------------------------------------------------------------------------
# repositório público
# ---------------------------------------------------------------------------


def test_sem_nome_de_cliente(texto):
    achados = sorted({m.group(0) for m in NOMES_CLIENTE.finditer(texto)})
    assert not achados, f"o registro cita cliente: {achados}"


def test_sem_id_de_subconta(texto):
    ids = [
        t
        for t in re.findall(r"[A-Za-z0-9]+", texto)
        if len(t) >= 20 and re.search(r"[A-Za-z]", t) and re.search(r"\d", t)
    ]
    assert not ids, f"o registro tem cara de id: {ids}"


def test_sem_caminho_local(texto):
    assert "/Users/" not in texto, "o registro tem caminho de pasta local"


def test_sem_telefone(texto):
    achados = [m.group(0) for m in TELEFONE.finditer(texto)]
    assert not achados, f"o registro tem telefone: {achados}"


def test_sem_email(texto):
    assert "@" not in texto, "o registro tem '@' (e-mail)"
