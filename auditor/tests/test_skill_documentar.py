"""A skill automaster-documentar faz duas entregas a partir da mesma leitura da subconta: a
auditoria (relatório interno) e o manual do cliente (HTML e PDF). Estes testes travam a
estrutura dos três arquivos da skill, não a redação. O repositório é público: nenhum arquivo
da skill pode ter nome de cliente real, id, IP ou caminho de máquina."""

import json
import re
import tomllib
from pathlib import Path

import pytest
from test_sessao_de_fundo_docs import PROIBIDO

RAIZ = Path(__file__).resolve().parents[2]
PASTA = RAIZ / "skills" / "automaster-documentar"
SKILL = PASTA / "SKILL.md"
AUDITORIA = PASTA / "auditoria.md"
MANUAL = PASTA / "manual.md"
ARQUIVOS = [SKILL, AUDITORIA, MANUAL]
VERSAO = "0.33.0"

SECOES = ["Quando usar", "Regras comuns", "Parte 1: auditoria", "Parte 2: manual do cliente", "Entrega"]

REGRAS_NOVAS = [
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
]

SECOES_RELATORIO = [
    "Resumo",
    "Urgente",
    "Diagnóstico por área",
    "Proposta de estrutura",
    "Ordem sugerida",
    "Números de referência",
]

TOOLS_DE_ESCRITA = ["workflow_editar", "workflow_acao", "oportunidade_acao", "tag_acao", "whatsapp_enviar"]

CLIENTE_REAL = re.compile(r"\b(Nick|Seller|Multimarcas)\b", re.IGNORECASE)
ID_GHL = re.compile(r"\b(?=[A-Za-z0-9]*[A-Za-z])(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{20}\b")
IP = re.compile(r"\b\d{1,3}(\.\d{1,3}){3}\b")


def _ler(caminho: Path) -> str:
    assert caminho.exists(), f"falta {caminho}"
    return caminho.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def texto() -> str:
    return _ler(SKILL)


@pytest.fixture(scope="module")
def auditoria() -> str:
    return _ler(AUDITORIA)


@pytest.fixture(scope="module")
def manual() -> str:
    return _ler(MANUAL)


@pytest.fixture(scope="module")
def secoes(texto) -> dict[int, tuple[str, str]]:
    """Seções `## N. Título` -> (título, corpo)."""
    partes = re.split(r"^## (\d+)\. (.+)$", texto, flags=re.MULTILINE)
    return {int(partes[i]): (partes[i + 1].strip(), partes[i + 2]) for i in range(1, len(partes), 3)}


def _secao_por_titulo(secoes, titulo: str) -> tuple[int, str]:
    for n, (t, corpo) in secoes.items():
        if titulo.lower() in t.lower():
            return n, corpo
    raise AssertionError(f"SKILL.md sem a seção {titulo!r}: {[t for t, _ in secoes.values()]}")


def _bloco_do_cabecalho(texto: str, padrao: str) -> str:
    """Do cabeçalho markdown que casa `padrao` até o próximo cabeçalho de nível igual ou maior."""
    m = re.search(rf"^(#{{1,4}}) [^\n]*{padrao}[^\n]*$", texto, flags=re.MULTILINE | re.IGNORECASE)
    assert m, f"sem cabeçalho com {padrao!r}"
    nivel = len(m.group(1))
    resto = texto[m.end() :]
    fim = re.search(rf"^#{{1,{nivel}}} ", resto, flags=re.MULTILINE)
    return resto[: fim.start()] if fim else resto


# ---------- SKILL.md ----------


def test_frontmatter(texto):
    m = re.match(r"---\nname: (.+)\ndescription: (.+)\n---\n", texto)
    assert m, "frontmatter ausente ou fora do formato"
    assert m.group(1).strip() == "automaster-documentar"
    assert "Use ao" in m.group(2)


def test_secoes_numeradas_com_as_cinco_minimas_em_ordem(secoes):
    assert sorted(secoes) == list(range(1, len(secoes) + 1)), sorted(secoes)
    posicoes = [_secao_por_titulo(secoes, t)[0] for t in SECOES]
    assert posicoes == sorted(posicoes), list(zip(SECOES, posicoes, strict=True))


def test_skill_cita_os_dois_arquivos_e_a_ordem(secoes, texto):
    assert "auditoria.md" in texto and "manual.md" in texto
    _, parte1 = _secao_por_titulo(secoes, "Parte 1: auditoria")
    _, parte2 = _secao_por_titulo(secoes, "Parte 2: manual do cliente")
    assert "auditoria.md" in parte1
    assert "manual.md" in parte2


def test_regras_comuns_leitura_fresca_e_ao_vivo(secoes):
    _, c = _secao_por_titulo(secoes, "Regras comuns")
    baixo = c.lower()
    assert re.search(r"(só|somente) leitura", baixo)
    assert "extra" in baixo  # extrair / extração antes de ler
    assert "workflows_ao_vivo" in c


def test_regras_comuns_confere_entrega_do_canal(secoes):
    _, c = _secao_por_titulo(secoes, "Regras comuns")
    assert "conversas" in c
    assert re.search(r"entreg", c.lower())


def test_regras_comuns_numero_so_desta_rodada(secoes):
    _, c = _secao_por_titulo(secoes, "Regras comuns")
    assert re.search(r"(desta|nesta) (rodada|leitura)", c.lower())


def test_entrega_sai_em_docs(secoes):
    _, c = _secao_por_titulo(secoes, "Entrega")
    assert "docs/" in c


@pytest.mark.parametrize("tool", TOOLS_DE_ESCRITA)
def test_nenhuma_tool_de_escrita_na_skill(tool):
    for caminho in ARQUIVOS:
        assert tool not in _ler(caminho), f"{caminho.name} cita {tool}"


# ---------- auditoria.md ----------


def test_auditoria_usa_o_comando_ficha(auditoria):
    assert re.search(r"\bficha\b", auditoria)


@pytest.mark.parametrize("regra", REGRAS_NOVAS)
def test_auditoria_cita_as_regras_novas(auditoria, regra):
    assert regra in auditoria, regra


def test_auditoria_tem_lista_de_verificacao(auditoria):
    bloco = _bloco_do_cabecalho(auditoria, "verifica")
    itens = re.findall(r"^\s*(?:[-*]|\d+\.) .+$", bloco, flags=re.MULTILINE)
    assert len(itens) >= 13, len(itens)


def test_auditoria_modelo_do_relatorio_com_seis_secoes_em_ordem(auditoria):
    m = re.search(r"modelo do relat[óo]rio", auditoria, flags=re.IGNORECASE)
    assert m, "sem o modelo do relatório"
    resto = auditoria[m.end() :]
    posicoes = []
    for titulo in SECOES_RELATORIO:
        achou = re.search(rf"^#{{2,3}} (?:\d+\.\s*)?{re.escape(titulo)}", resto, flags=re.MULTILINE | re.IGNORECASE)
        assert achou, f"modelo do relatório sem o cabeçalho {titulo!r}"
        posicoes.append(achou.start())
    assert posicoes == sorted(posicoes), list(zip(SECOES_RELATORIO, posicoes, strict=True))


def test_auditoria_sem_uso_entra_como_pergunta(auditoria):
    paragrafos = re.split(r"\n\s*\n", auditoria)
    assert any("sem uso" in p.lower() and "pergunta" in p.lower() for p in paragrafos)


def test_auditoria_sai_em_docs(auditoria):
    assert "docs/" in auditoria


# ---------- manual.md ----------


def test_manual_chama_o_gerador_pelo_plugin_root(manual):
    assert re.search(r"\$\{CLAUDE_PLUGIN_ROOT\}[^\n]*manual-pdf|manual-pdf[^\n]*\$\{CLAUDE_PLUGIN_ROOT\}", manual), (
        "manual-pdf não aparece pelo caminho ${CLAUDE_PLUGIN_ROOT}"
    )


def test_manual_usa_o_modelo_html(manual):
    assert "modelo.html" in manual


def test_manual_tem_estrutura_de_secoes(manual):
    bloco = _bloco_do_cabecalho(manual, "estrutura").lower()
    assert "capa" in bloco
    assert "pergunta" in bloco


def test_manual_cita_as_pecas_do_modelo(manual):
    baixo = manual.lower()
    for peca in ("fluxo", "linha do tempo", "semana", "funil", "balão"):
        assert peca in baixo, peca


def test_manual_regras_de_linguagem_proibem_termos_tecnicos(manual):
    bloco = _bloco_do_cabecalho(manual, "linguagem").lower()
    assert re.search(r"\bids?\b", bloco)
    assert "tag" in bloco
    assert "workflow" in bloco


def test_manual_confere_pagina_a_pagina(manual):
    assert re.search(r"página (a|por) página", manual.lower())


def test_manual_texto_dos_modelos_pela_whatsapp_e_pela_meta(manual):
    assert "whatsapp" in manual
    assert "o=templates" in manual
    assert "message_templates" in manual
    assert "token" in manual.lower() and "Hub" in manual


def test_manual_sem_credencial(manual):
    assert not re.search(r"\bEAA[A-Za-z0-9]{20,}", manual), "token da Meta no texto"
    assert not re.search(r"Bearer\s+[A-Za-z0-9._-]{10,}", manual), "credencial no texto"


def test_manual_sai_em_docs(manual):
    assert "docs/" in manual


# ---------- repositório público ----------


@pytest.mark.parametrize("caminho", ARQUIVOS, ids=lambda p: p.name)
def test_nenhuma_frase_proibida(caminho):
    casou = PROIBIDO.search(_ler(caminho))
    assert not casou, casou.group(0)


@pytest.mark.parametrize("caminho", ARQUIVOS, ids=lambda p: p.name)
def test_sem_nome_de_cliente_real(caminho):
    casou = CLIENTE_REAL.search(_ler(caminho))
    assert not casou, casou.group(0)


@pytest.mark.parametrize("caminho", ARQUIVOS, ids=lambda p: p.name)
def test_sem_id_de_20_caracteres(caminho):
    casou = ID_GHL.search(_ler(caminho))
    assert not casou, casou.group(0)


@pytest.mark.parametrize("caminho", ARQUIVOS, ids=lambda p: p.name)
def test_sem_ip(caminho):
    casou = IP.search(_ler(caminho))
    assert not casou, casou.group(0)


@pytest.mark.parametrize("caminho", ARQUIVOS, ids=lambda p: p.name)
def test_sem_caminho_de_maquina(caminho):
    assert "/Users/" not in _ler(caminho)


# ---------- docs do repo ----------


def test_claude_md_cita_a_skill():
    assert "automaster-documentar" in (RAIZ / "CLAUDE.md").read_text(encoding="utf-8")


def test_leitura_diz_que_a_cli_grava_em_automaster_dumps():
    leitura = (RAIZ / "skills" / "automaster-leitura" / "SKILL.md").read_text(encoding="utf-8")
    assert "automaster_v2/dumps" not in leitura
    assert "~/.automaster/dumps" in leitura


# ---------- versão ----------


def test_manifestos_e_lock_em_0_33_0():
    plugin = json.loads((RAIZ / ".claude-plugin" / "plugin.json").read_text(encoding="utf-8"))
    pacote = json.loads((RAIZ / "extractor" / "package.json").read_text(encoding="utf-8"))
    lock = json.loads((RAIZ / "extractor" / "package-lock.json").read_text(encoding="utf-8"))
    auditor = tomllib.loads((RAIZ / "auditor" / "pyproject.toml").read_text(encoding="utf-8"))
    versoes = {
        "plugin.json": plugin["version"],
        "package.json": pacote["version"],
        "package-lock.json": lock["version"],
        'package-lock.json packages[""]': lock["packages"][""]["version"],
        "pyproject.toml": auditor["project"]["version"],
    }
    assert set(versoes.values()) == {VERSAO}, versoes


def test_changelog_tem_secao_0_33_0():
    changelog = (RAIZ / "CHANGELOG.md").read_text(encoding="utf-8")
    assert re.search(rf"^## {re.escape(VERSAO)}\b", changelog, flags=re.MULTILINE)
