"""A skill automaster-dashboard ensina o método do painel: leitura, entrevista, plano, montagem,
dois loops, publicação e escada. Estes testes travam a estrutura, não a redação."""

import re
from pathlib import Path

import pytest
from test_sessao_de_fundo_docs import PROIBIDO

RAIZ = Path(__file__).resolve().parents[2]
SKILL = RAIZ / "skills" / "automaster-dashboard" / "SKILL.md"
SECOES = [
    "Leitura da subconta",
    "Entrevista",
    "Plano do painel",
    "Montagem",
    "Loop visual",
    "Loop de dados",
    "Publicação",
    "Escada",
]


@pytest.fixture(scope="module")
def texto() -> str:
    assert SKILL.exists(), f"falta {SKILL}"
    return SKILL.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def secoes(texto) -> dict[int, tuple[str, str]]:
    """Seções `## N. Título` -> (título, corpo)."""
    partes = re.split(r"^## (\d+)\. (.+)$", texto, flags=re.MULTILINE)
    return {int(partes[i]): (partes[i + 1].strip(), partes[i + 2]) for i in range(1, len(partes), 3)}


def _corpo(secoes, n: int) -> str:
    return secoes[n][1]


def test_frontmatter(texto):
    m = re.match(r"---\nname: (.+)\ndescription: (.+)\n---\n", texto)
    assert m, "frontmatter ausente ou fora do formato"
    assert m.group(1).strip() == "automaster-dashboard"
    assert "Use ao montar ou refazer um painel do GHL" in m.group(2)


def test_oito_secoes_numeradas_em_ordem(secoes):
    assert sorted(secoes) == list(range(1, 9))
    for n, titulo in enumerate(SECOES, start=1):
        assert titulo.lower() in secoes[n][0].lower(), (n, secoes[n][0])


def test_leitura_usa_as_tools_de_leitura(secoes):
    c = _corpo(secoes, 1)
    for termo in ("pipeline", "oportunidades", "agenda", "config", "dashboards"):
        assert termo in c, termo


def test_entrevista_usa_askuserquestion(secoes):
    assert "AskUserQuestion" in _corpo(secoes, 2)
    assert "AskUserQuestion" not in _corpo(secoes, 7)


def test_regras_de_composicao_no_plano(secoes):
    c = _corpo(secoes, 3).lower()
    assert re.search(r"(no máximo|até|máx\w*)\s*4\s+n[úu]meros", c)
    assert re.search(r"donut[^\n]*5|5[^\n]*fatias", c)
    assert "data de criação" in c
    assert "período" in c and "título" in c
    assert "altura" in c and "proporcional" in c


def test_montagem_usa_dashboard_acao(secoes):
    c = _corpo(secoes, 4)
    assert "dashboard_acao" in c
    for acao in ("criar", "editar", "tema"):
        assert acao in c, acao
    assert "privado" in c.lower()


def test_loop_visual_com_checklist_de_15_itens(secoes):
    # etapa 11: os 11 itens de antes + 4 de cara profissional (cabeçalho, títulos de seção,
    # grade alinhada com larguras repetidas, hierarquia resumo-no-topo)
    c = _corpo(secoes, 5)
    assert "dashboard_ver" in c
    itens = re.findall(r"^\s*- \[ \] .+$", c, flags=re.MULTILINE)
    assert len(itens) == 15, len(itens)
    checklist = "\n".join(itens).lower()
    for termo in ("cabeçalho", "título de seção", "larguras", "hierarquia"):
        assert termo in checklist, termo
    assert re.search(r"(até|no máximo)\s*3\s+voltas", c)
    baixo = c.lower()
    for termo in ("vazio", "cortado", "alinhad", "rolagem", "contraste"):
        assert termo in baixo, termo


def test_loop_de_dados(secoes):
    c = _corpo(secoes, 6)
    assert "dashboard_conferir" in c and "diverge" in c
    assert re.search(r"filtro", c) and re.search(r"nunca[^\n]*número", c)


def test_publicar_so_depois_dos_loops_e_com_confirmo(secoes):
    c = _corpo(secoes, 7)
    assert "publicar" in c and "confirmo" in c
    assert "dois loops" in c.lower()
    # publicar não pode aparecer antes da seção 7 como ação a executar
    for n in range(1, 7):
        assert "dashboard_acao publicar" not in _corpo(secoes, n)


def test_escada_diz_o_que_ficou_de_fora(secoes):
    c = _corpo(secoes, 8)
    assert "Embed" in c
    assert re.search(r"resultado[^\n]*(fic\w+ de fora|fora)", c, flags=re.IGNORECASE)


def test_exemplo_trabalhado_da_clinica(texto):
    assert "Sorriso Pleno" in texto
    assert re.search(r"cl[ií]nica", texto, flags=re.IGNORECASE)


def test_nenhuma_frase_proibida(texto):
    assert not PROIBIDO.search(texto)


# ---------- etapa 11: leitura a fundo, grill, painel completo, tema branco ----------


def test_leitura_a_fundo_termina_num_retrato(secoes):
    c = _corpo(secoes, 1).lower()
    for termo in (
        "funis",
        "estágios",
        "calendários",
        "workflows",
        "formulários",
        "surveys",
        "canais de conversa",
        "campos personalizados",
        "usuários",
        "anúncios",
        "retrato",
    ):
        assert termo in c, termo


def test_entrevista_e_um_grill_sem_pergunta_de_dispositivo(secoes):
    c = _corpo(secoes, 2)
    baixo = c.lower()
    assert "grill" in baixo
    assert "uma pergunta por vez" in baixo
    assert "AskUserQuestion" in c
    # cada pergunta cita o que a leitura achou
    assert re.search(r"cit\w*[^\n]*leitura|leitura[^\n]*cit\w*", baixo)
    assert "recomendad" in baixo
    assert "ramo" in baixo
    # o painel é sempre para computador; nunca se pergunta o dispositivo
    assert "computador" in baixo
    assert "celular" not in baixo
    assert not re.search(r"dispositivo[^\n.]*\?", baixo)


def test_plano_pede_painel_completo(secoes):
    c = _corpo(secoes, 3).lower()
    assert re.search(r"(pelo menos|no mínimo|mínimo de)\s*12 widgets", c)
    assert re.search(r"altura\s*3[^\n]*(no máximo|até|máx\w*)\s*4", c)
    assert "objectWidget".lower() in c
    for tipo in ("número", "tendência", "funil", "tabela", "ranking"):
        assert tipo in c, tipo


def _luminancia(hexa: str) -> float:
    def canal(v: int) -> float:
        s = v / 255
        return s / 12.92 if s <= 0.03928 else ((s + 0.055) / 1.055) ** 2.4

    r, g, b = (int(hexa[i : i + 2], 16) for i in (1, 3, 5))
    return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b)


def test_tema_padrao_branco_e_nenhum_fundo_escuro(texto):
    assert "#ffffff" in texto.lower()
    assert "grafite" not in texto.lower()
    fundos = re.findall(r"backgroundColor\W{0,4}(#[0-9a-fA-F]{6})", texto)
    for cor in fundos:
        assert _luminancia(cor) > 0.8, f"fundo escuro no exemplo: {cor}"


def test_cara_profissional_com_molde_de_layout(secoes, texto):
    # objetos de layout do GHL (catálogo ao vivo): object-title, object-textbox, object-image,
    # object-embed, todos chartType objectWidget. Não existe divisor próprio: o separador é o
    # object-title de largura 12.
    c = _corpo(secoes, 3)
    baixo = c.lower()
    assert "cabeçalho" in baixo and "período" in baixo
    assert "título de seção" in baixo
    assert re.search(r"separador|divisor", baixo)
    assert "objectWidget" in c and "object-title" in c
    assert re.search(r"molde[^\n]*profissional|profissional[^\n]*molde", baixo)
    assert "hierarquia" in baixo
    # o molde dá seções, larguras e alturas: ao menos uma linha com w e h
    assert re.search(r"\bw\s*[:=]?\s*12\b", c) and re.search(r"\bh\s*[:=]?\s*1\b", c)


def test_claude_md_lista_a_skill():
    assert "skills/automaster-dashboard/" in (RAIZ / "CLAUDE.md").read_text(encoding="utf-8")


# a skill fica em skills/automaster-dashboard/SKILL.md


def test_divisoes_na_cor_de_destaque_e_painel_padrao(texto):
    # pedido do usuário na aprovação: faixas de título na cor de destaque, e o painel da ZOI como padrão
    assert "objectWidgetOptions" in texto
    assert re.search(r"object-title[^\n]*(destaque|baseColor)|(destaque|baseColor)[^\n]*object-title", texto)
    assert "etapa-12/plano.md" in texto
