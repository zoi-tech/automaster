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


def test_loop_visual_com_checklist_de_11_itens(secoes):
    c = _corpo(secoes, 5)
    assert "dashboard_ver" in c
    itens = re.findall(r"^\s*- \[ \] .+$", c, flags=re.MULTILINE)
    assert len(itens) == 11, len(itens)
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


def test_claude_md_lista_a_skill():
    assert "skills/automaster-dashboard/" in (RAIZ / "CLAUDE.md").read_text(encoding="utf-8")

# a skill fica em skills/automaster-dashboard/SKILL.md
