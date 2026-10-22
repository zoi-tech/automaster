"""Peças visuais do manual (skill automaster-documentar): `zoi.css`, `modelo.html` e os SVGs da ZOI.

O CSS sai do mockup aprovado (docs/vesta/mockups/2026-10-22-documentar/index.html) e vira o
modelo que o gerador usa. Estes testes travam o que o manual impresso mostra: tokens da marca,
classes de cada peça, a regra de página A4 e a ausência de dado de cliente real (repo público).
"""

import re
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[2]
MANUAL = RAIZ / "skills" / "automaster-documentar" / "manual"
CSS = MANUAL / "zoi.css"
MODELO = MANUAL / "modelo.html"
SOL = MANUAL / "assets" / "sol.svg"
LOGO = MANUAL / "assets" / "logo-zoi.svg"

# Início do `d` do sol da ZOI (MD Converter `_SUN_PATH`, copiado no mockup).
SOL_INICIO = "M336.73,790.56 C315.96,784.91 298.67,780"

TOKENS = {
    "--verde-400": "#b5ff81",
    "--verde-500": "#90cc67",
    "--verde-900": "#364c26",
    "--neutro-900": "#141414",
    "--neutro-800": "#333333",
    "--neutro-600": "#5c5c5c",
    "--neutro-50": "#f7fff2",
    "--magenta-500": "#cc3366",
    "--magenta-50": "#fbeef2",
    "--esp-1": "4px",
    "--esp-2": "8px",
    "--esp-3": "12px",
    "--esp-4": "16px",
    "--esp-5": "24px",
    "--esp-6": "32px",
    "--esp-7": "48px",
    "--esp-8": "64px",
    "--raio": "12px",
    "--raio-menor": "8px",
    "--raio-pilula": "999px",
}

CLASSES_CAPA = [
    "capa",
    "capa-regua",
    "capa-contatos",
    "capa-centro",
    "capa-sol",
    "capa-marca",
    "capa-bloco",
    "capa-sub",
    "capa-desc",
    "capa-faixa",
]
# Peças do corpo do manual: o modelo mostra todas, a capa vem do gerador.
CLASSES_PECAS = [
    "cab",
    "quadro",
    "aviso",
    "indice",
    "jornada",
    "fluxo",
    "no",
    "seta",
    "ramos",
    "ramo",
    "rot",
    "semana",
    "funil",
    "tempo",
    "zap",
    "bolha",
    "botoes",
    "mapa",
    "pilula",
    "faq",
    "folha",
]
COMPOSTAS = ["quadro.alerta", "no.gatilho", "no.pergunta", "no.acao", "no.perda"]

# peça -> palavras que um comentário dela deve trazer
COMENTARIOS_PECAS = {
    "fluxo": ["fluxo"],
    "semana": ["semana"],
    "funil": ["funil"],
    "tempo": ["tempo"],
    "zap": ["zap", "whatsapp"],
    "tabela": ["tabela"],
    "faq": ["faq", "perguntas"],
}

MARCADOR_CSS = "<!-- CSS DA ZOI -->"


# ---------- auxiliares ----------


def _sem_comentarios_css(texto: str) -> str:
    return re.sub(r"/\*.*?\*/", "", texto, flags=re.DOTALL)


def _bloco(texto: str, abertura: re.Pattern) -> str | None:
    """Conteúdo entre as chaves do primeiro bloco cuja abertura casa `abertura` (que termina em `{`).

    Conta chaves fora de strings, para aguentar `@page { @bottom-left { ... } }` e data URIs.
    """
    m = abertura.search(texto)
    if not m:
        return None
    i, nivel, aspa = m.end(), 1, None
    inicio = i
    while i < len(texto):
        c = texto[i]
        if aspa:
            if c == aspa:
                aspa = None
        elif c in "\"'":
            aspa = c
        elif c == "{":
            nivel += 1
        elif c == "}":
            nivel -= 1
            if nivel == 0:
                return texto[inicio:i]
        i += 1
    return None


def _seletores_de_classe(css: str) -> set[str]:
    return set(re.findall(r"\.([A-Za-z_][\w-]*)", css))


def _comentarios_html(html: str) -> list[str]:
    return [c.strip() for c in re.findall(r"<!--(.*?)-->", html, flags=re.DOTALL)]


def _pais(raiz: ET.Element) -> dict[ET.Element, ET.Element]:
    return {filho: pai for pai in raiz.iter() for filho in pai}


def _preenchimento(el: ET.Element, pais: dict) -> str | None:
    """Cor de `fill` do elemento ou do ancestral mais próximo que a define (atributo ou style)."""
    while el is not None:
        fill = el.get("fill")
        if not fill:
            m = re.search(r"fill\s*:\s*([^;]+)", el.get("style", ""))
            fill = m.group(1) if m else None
        if fill:
            return fill.strip().lower()
        el = pais.get(el)
    return None


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


# ---------- fixtures ----------


@pytest.fixture(scope="module")
def css() -> str:
    assert CSS.exists(), f"falta {CSS}"
    return _sem_comentarios_css(CSS.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def modelo() -> str:
    assert MODELO.exists(), f"falta {MODELO}"
    return MODELO.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def root_vars(css) -> dict[str, str]:
    corpo = _bloco(css, re.compile(r":root\s*\{"))
    assert corpo is not None, "zoi.css não tem bloco :root"
    return {k: v.strip() for k, v in re.findall(r"(--[\w-]+)\s*:\s*([^;]+);?", corpo)}


@pytest.fixture(scope="module")
def page(css) -> str:
    corpo = _bloco(css, re.compile(r"@page\s*\{"))
    assert corpo is not None, "zoi.css não tem @page"
    return corpo


@pytest.fixture(scope="module")
def page_first(css) -> str:
    corpo = _bloco(css, re.compile(r"@page\s*:first\s*\{"))
    assert corpo is not None, "zoi.css não tem @page :first"
    return corpo


# ---------- zoi.css: tokens ----------


@pytest.mark.parametrize("token", sorted(TOKENS))
def test_css_declara_token_no_root(root_vars, token):
    assert token in root_vars, f"{token} não está no :root"
    assert root_vars[token].lower() == TOKENS[token], f"{token} = {root_vars[token]!r}, esperado {TOKENS[token]!r}"


@pytest.mark.parametrize(("token", "fonte"), [("--fonte-titulo", "Clash Display"), ("--fonte-corpo", "Satoshi")])
def test_css_fonte_da_marca_com_reserva(root_vars, token, fonte):
    assert token in root_vars, f"{token} não está no :root"
    valor = root_vars[token]
    assert fonte in valor, f"{token} sem {fonte!r}: {valor!r}"
    assert re.search(r"Helvetica|Arial", valor), f"{token} sem reserva Helvetica/Arial: {valor!r}"
    assert valor.index(fonte) < min(valor.find(x) for x in ("Helvetica", "Arial") if x in valor), (
        f"{token}: a fonte da marca tem que vir antes da reserva"
    )


def test_css_nao_traz_font_face(css):
    assert "@font-face" not in css, "o @font-face é injetado pelo gerador, não fica no zoi.css"


# ---------- zoi.css: classes das peças ----------


@pytest.mark.parametrize("classe", CLASSES_CAPA + CLASSES_PECAS)
def test_css_tem_classe_da_peca(css, classe):
    assert classe in _seletores_de_classe(css), f"zoi.css não estiliza .{classe}"


@pytest.mark.parametrize("composta", COMPOSTAS)
def test_css_tem_variante_da_peca(css, composta):
    seletor = r"\." + r"\.".join(re.escape(p) for p in composta.split(".")) + r"(?![\w-])"
    assert re.search(seletor, css), f"zoi.css não tem .{composta}"


# ---------- zoi.css: página A4 ----------


def test_pagina_a4_com_margens_do_manual(page):
    assert re.search(r"size\s*:\s*A4\b", page), "@page sem size: A4"
    assert re.search(r"margin\s*:\s*20mm\s+22mm\s+22mm\s*(;|$|\})", page), "@page sem margin: 20mm 22mm 22mm"


def test_rodape_tem_logo_a_esquerda(page):
    esquerda = _bloco(page, re.compile(r"@bottom-left\s*\{"))
    assert esquerda is not None, "@page sem @bottom-left"
    m = re.search(r"content\s*:\s*url\(", esquerda)
    assert m, "@bottom-left não mostra imagem (content: url(...))"
    assert "svg" in esquerda[m.end() :].lower(), "o logo do rodapé deve ser SVG"


def test_rodape_tem_numero_da_pagina_a_direita(page):
    direita = _bloco(page, re.compile(r"@bottom-right\s*\{"))
    assert direita is not None, "@page sem @bottom-right"
    assert re.search(r"content\s*:[^;]*counter\(\s*page\s*\)", direita), "@bottom-right sem counter(page)"


def test_capa_sem_margem_e_sem_rodape(page_first):
    assert re.search(r"(^|[;\s{])margin\s*:\s*0\s*(;|$|\})", page_first), "@page :first sem margin: 0"
    for lado in ("bottom-left", "bottom-right"):
        bloco = _bloco(page_first, re.compile(rf"@{lado}\s*\{{"))
        assert bloco is not None, f"@page :first não zera @{lado}"
        assert re.search(r"content\s*:\s*none", bloco), f"@page :first: @{lado} sem content: none"


def test_cada_folha_comeca_pagina_na_impressao(css):
    impressao = _bloco(css, re.compile(r"@media\s+print\s*\{"))
    assert impressao is not None, "zoi.css sem @media print"
    regras = re.findall(r"(?:^|[\s,}])\.folha\s*\{([^}]*)\}", impressao)
    assert regras, "@media print não tem regra para .folha"
    assert any(re.search(r"break-before\s*:\s*page", r) for r in regras), ".folha sem break-before: page na impressão"


# ---------- modelo.html ----------


def test_modelo_so_usa_classes_do_css(css, modelo):
    existentes = _seletores_de_classe(css)
    usadas = {c for attr in re.findall(r'class="([^"]*)"', modelo) for c in attr.split() if "{" not in c}
    faltam = sorted(usadas - existentes)
    assert not faltam, f"classes usadas em modelo.html sem regra em zoi.css: {faltam}"


# `.no.perda` fica só no CSS: o mockup aprovado não tem exemplo dela.
@pytest.mark.parametrize("classe", CLASSES_PECAS + [c for c in COMPOSTAS if c != "no.perda"])
def test_modelo_mostra_cada_peca(modelo, classe):
    partes = classe.split(".")
    achou = any(all(p in attr.split() for p in partes) for attr in re.findall(r'class="([^"]*)"', modelo))
    assert achou, f"modelo.html não tem exemplo da peça .{classe}"


def test_modelo_mostra_tabela(modelo):
    assert re.search(r"<table\b", modelo), "modelo.html não tem exemplo de tabela"


def test_modelo_nao_tem_style_proprio(modelo):
    assert "<style" not in modelo.lower(), "modelo.html não pode ter <style>; o CSS vem do zoi.css"


def test_modelo_tem_marcador_do_css_no_head(modelo):
    assert modelo.count(MARCADOR_CSS) == 1, f"modelo.html deve ter {MARCADOR_CSS!r} exatamente uma vez"
    head = re.search(r"<head\b[^>]*>(.*?)</head>", modelo, flags=re.DOTALL | re.IGNORECASE)
    assert head, "modelo.html sem <head>"
    assert MARCADOR_CSS in head.group(1), f"{MARCADOR_CSS!r} tem que ficar dentro do <head>"


def test_modelo_tem_lugar_da_capa_no_corpo(modelo):
    assert modelo.count("{{CAPA}}") == 1, "modelo.html deve ter {{CAPA}} exatamente uma vez"
    body = re.search(r"<body\b[^>]*>(.*?)</body>", modelo, flags=re.DOTALL | re.IGNORECASE)
    assert body and "{{CAPA}}" in body.group(1), "{{CAPA}} tem que ficar no <body>"
    corpo = body.group(1)
    primeira_folha = re.search(r'class="[^"]*\bfolha\b', corpo)
    assert primeira_folha and corpo.index("{{CAPA}}") < primeira_folha.start(), "{{CAPA}} vem antes das folhas"
    assert not re.search(r'class="[^"]*\bcapa-marca\b', modelo), "a capa do mockup tem que sair; o gerador a injeta"


@pytest.mark.parametrize("peca", sorted(COMENTARIOS_PECAS))
def test_modelo_explica_cada_peca_em_comentario(modelo, peca):
    comentarios = [c for c in _comentarios_html(modelo) if c != MARCADOR_CSS.strip("<!->").strip()]
    palavras = COMENTARIOS_PECAS[peca]
    do_tema = [c for c in comentarios if any(p in c.lower() for p in palavras)]
    assert do_tema, f"modelo.html sem comentário explicando a peça {peca}"
    assert any(re.search(r"\b(quando|use|usar|usa|serve)\b", c.lower()) for c in do_tema), (
        f"o comentário da peça {peca} não diz quando usar: {do_tema}"
    )


def test_modelo_usa_cliente_de_exemplo(modelo):
    assert "Ribeira Seminovos" in modelo


# ---------- dados proibidos (repo público) ----------


def _arquivos_do_manual() -> list[Path]:
    return sorted(p for p in MANUAL.rglob("*") if p.is_file()) if MANUAL.exists() else []


def test_pasta_do_manual_tem_as_pecas():
    for arquivo in (CSS, MODELO, SOL, LOGO):
        assert arquivo.exists(), f"falta {arquivo.relative_to(RAIZ)}"
    pngs = [p.name for p in _arquivos_do_manual() if p.suffix.lower() == ".png"]
    assert not pngs, f"o .gitignore ignora PNG; use SVG: {pngs}"


PROIBIDOS = [
    (re.compile(r"nick|seller|multimarcas", re.IGNORECASE), "nome de cliente real"),
    (re.compile(r"\bpit-"), "token de integração privada"),
    (re.compile(r"\bsk-"), "chave de API"),
    (re.compile(r"eyJ"), "JWT"),
    (re.compile(r"99250"), "telefone pessoal"),
]


def test_manual_sem_dado_de_cliente_nem_segredo():
    arquivos = _arquivos_do_manual()
    assert arquivos, f"pasta {MANUAL} vazia ou ausente"
    achados = []
    for arquivo in arquivos:
        texto = arquivo.read_text(encoding="utf-8", errors="ignore")
        for padrao, motivo in PROIBIDOS:
            for m in padrao.finditer(texto):
                achados.append(f"{arquivo.name}: {motivo} ({m.group(0)!r})")
        for palavra in re.findall(r"\b[A-Za-z0-9]{20,}\b", texto):
            if re.search(r"[A-Za-z]", palavra) and re.search(r"\d", palavra):
                achados.append(f"{arquivo.name}: parece id ou token ({palavra!r})")
    assert not achados, "\n".join(achados)


# ---------- SVGs ----------


@pytest.mark.parametrize("arquivo", [SOL, LOGO], ids=["sol", "logo"])
def test_svg_e_xml_valido(arquivo):
    assert arquivo.exists(), f"falta {arquivo}"
    raiz = ET.parse(arquivo).getroot()
    assert _local(raiz.tag) == "svg", f"raiz de {arquivo.name} é {raiz.tag}, não svg"


def test_sol_usa_o_caminho_da_zoi():
    raiz = ET.parse(SOL).getroot()
    assert raiz.get("viewBox") == "0 0 796 801", f"viewBox do sol: {raiz.get('viewBox')!r}"
    caminhos = [el.get("d", "") for el in raiz.iter() if _local(el.tag) == "path"]
    assert any(d.strip().startswith(SOL_INICIO) for d in caminhos), "sol.svg não usa o caminho vetorial do sol da ZOI"


def test_logo_quadrado_verde_arredondado():
    raiz = ET.parse(LOGO).getroot()
    pais = _pais(raiz)
    quadrados = [
        el
        for el in raiz.iter()
        if _local(el.tag) == "rect"
        and _preenchimento(el, pais) == "#b5ff81"
        and el.get("rx")
        and float(re.sub(r"[^\d.]", "", el.get("rx")) or 0) > 0
        and el.get("width") == el.get("height")
    ]
    assert quadrados, "logo-zoi.svg sem quadrado verde (#b5ff81) de cantos arredondados"


def test_logo_tem_sol_verde_escuro():
    raiz = ET.parse(LOGO).getroot()
    pais = _pais(raiz)
    sois = [el for el in raiz.iter() if _local(el.tag) == "path" and el.get("d", "").strip().startswith(SOL_INICIO)]
    assert sois, "logo-zoi.svg não desenha o sol da ZOI"
    assert any(_preenchimento(el, pais) == "#364c26" for el in sois), "o sol do logo tem que ser #364c26"


def test_logo_escreve_zoi_em_preto():
    raiz = ET.parse(LOGO).getroot()
    pais = _pais(raiz)
    textos = [el for el in raiz.iter() if _local(el.tag) == "text" and "".join(el.itertext()).strip() == "ZOI"]
    assert textos, 'logo-zoi.svg sem o texto "ZOI"'
    assert any(_preenchimento(el, pais) == "#141414" for el in textos), '"ZOI" do logo tem que ser #141414'
