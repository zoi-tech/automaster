"""Painéis nativos do GHL: leitura, escrita, captura da tela e conferência dos números."""

from __future__ import annotations

import json

from . import base
from .base import _LOC, ToolError

DASH_LEITURA = ("lista", "detalhe", "catalogo", "versoes", "dados", "fuso")
DASH_ACOES = ("criar", "editar", "tema", "renomear", "apagar", "restaurar", "publicar")
PAPEIS = ("account_admin", "account_user")
ACESSOS = ("read", "write")

_DICA_LOGIN = (
    " O perfil de tela não está logado: rode `npm run dashboard-ver -- --login` em {EXTRACTOR_DIR}, entre na janela "
    "que abrir e chame a tool de novo."
)


def dashboards(loc: str, o: str = "lista", id: str | None = None, widget: str | None = None) -> dict:
    """Leitura ao vivo de painéis nativos, catálogo de widgets, dados de um widget e fuso da subconta."""
    if o not in DASH_LEITURA:
        raise ToolError(f"o inválido: {o}. Aceitos: {', '.join(DASH_LEITURA)}")
    if o in ("detalhe", "versoes", "dados") and not id:
        raise ToolError(f"o={o} exige id do painel")
    args = ["dashboards", "-l", loc, "-o", o]
    for flag, val in (("-i", id), ("--widget", widget)):
        if val:
            args += [flag, val]
    return {"resultado": base._run_extractor(*args, "--json")}


def dashboard_acao(
    loc: str,
    acao: str,
    id: str | None = None,
    titulo: str | None = None,
    plano: dict | None = None,
    tema: dict | None = None,
    versao: int | None = None,
    versao_esperada: int | None = None,
    papeis: list[str] | str | None = None,
    forcar: bool = False,
    confirmo: bool = False,
) -> dict:
    """ESCREVE: cria, edita, tematiza, renomeia, apaga, restaura ou publica um painel."""
    if acao not in DASH_ACOES:
        raise ToolError(f"acao inválida: {acao}. Aceitas: {', '.join(DASH_ACOES)}")
    if acao != "criar" and not id:
        raise ToolError(f"{acao} exige id do painel")
    for a, falta, nome in (
        ("criar", not titulo, "titulo"),
        ("renomear", not titulo, "titulo"),
        ("editar", not plano, "plano"),
        ("tema", not tema, "tema"),
        ("restaurar", not versao, "versao"),
        ("publicar", not papeis, "papeis"),
    ):
        if acao == a and falta:
            raise ToolError(f"{acao} exige {nome}")
    lista = None
    if acao == "publicar":
        lista = [p.strip() for p in (papeis.split(",") if isinstance(papeis, str) else papeis)]
        for p in lista:
            papel, _, acesso = p.partition(":")
            if papel not in PAPEIS or acesso not in ACESSOS:
                raise ToolError(
                    f"papel inválido: {p!r}. Use papel:acesso, papel em {'|'.join(PAPEIS)} e acesso em {'|'.join(ACESSOS)}"
                )
    if confirmo and acao != "criar" and versao_esperada is None:
        raise ToolError("confirmo=true exige versao_esperada (a versão que a prévia mostrou)")
    args = ["dashboard-acao", "-l", loc, "--acao", acao]
    for flag, val in (("-i", id), ("--titulo", titulo), ("--versao", versao)):
        if val:
            args += [flag, str(val)]
    if plano:
        args += ["--plano", json.dumps(plano)]
    if tema:
        args += ["--tema", json.dumps(tema)]
    if lista:
        args += ["--papeis", ",".join(lista)]
    if forcar:
        args.append("--forcar")
    if confirmo:
        args.append("--confirmo")
        if versao_esperada is not None:
            args += ["--versao-esperada", str(versao_esperada)]
    return base._run_extractor(*args, "--json")


def dashboard_ver(loc: str, id: str) -> dict:
    """Carrega o painel no perfil de tela e devolve o caminho do PNG."""
    try:
        return base._run_extractor("dashboard-ver", "-l", loc, "-i", id, "--json")
    except ToolError as e:
        if "login_pendente" in str(e):
            raise ToolError(
                str(e).replace(
                    base._DICAS_SESSAO["login_pendente"], _DICA_LOGIN.format(EXTRACTOR_DIR=base.EXTRACTOR_DIR)
                )
            ) from e
        raise


def dashboard_conferir(loc: str, id: str, dias: int | None = None) -> dict:
    """Confere o número de cada widget do painel contra uma recontagem."""
    args = ["dashboard-conferir", "-l", loc, "-i", id]
    if dias:
        args += ["--dias", str(dias)]
    return base._run_extractor(*args, "--json")


TOOLS = {
    "dashboards": (
        dashboards,
        (
            "Leitura ao vivo de painéis nativos do GHL: `lista`, `detalhe` (widgets com layout e definição), "
            "`catalogo` (tipos de widget disponíveis), `versoes`, `dados` (números de um widget, exige `widget`) "
            "e `fuso` da subconta."
        ),
        {
            "loc": _LOC,
            "o": {"type": "string", "enum": list(DASH_LEITURA), "default": "lista"},
            "id": {"type": "string", "description": "id do painel (detalhe, versoes, dados)"},
            "widget": {"type": "string", "description": "widgetId (o=dados)"},
        },
        ["loc"],
    ),
    "dashboard_acao": (
        dashboard_acao,
        (
            "ESCREVE EM PRODUÇÃO: cria (sempre privado), edita widgets e layout, muda o tema, renomeia, apaga, "
            "restaura versão ou publica um painel. Sem confirmo=true é só prévia; com confirmo exige "
            "versao_esperada (a versão que a prévia mostrou). `publicar` torna o painel visível só para os "
            "`papeis` pedidos (papel:acesso, como account_user:read) e recusa se o último dashboard_conferir "
            "divergiu, a não ser com forcar=true. Registro em <dumps>/_dashboards/."
        ),
        {
            "loc": _LOC,
            "acao": {"type": "string", "enum": list(DASH_ACOES)},
            "id": {"type": "string"},
            "titulo": {"type": "string", "description": "criar, renomear"},
            "plano": {"type": "object", "description": "editar: {criar, atualizar, remover, layout}"},
            "tema": {
                "type": "object",
                "description": "cores #RRGGBB: titleColor, backgroundColor, baseColor, metricColor, linkColor",
            },
            "versao": {"type": "integer", "description": "restaurar: versão para a qual voltar"},
            "versao_esperada": {"type": "integer", "description": "obrigatória com confirmo (exceto criar)"},
            "papeis": {
                "type": "array",
                "items": {"type": "string"},
                "description": "publicar: ['account_admin:read', 'account_user:read']",
            },
            "forcar": {"type": "boolean", "default": False},
            "confirmo": {"type": "boolean", "default": False},
        },
        ["loc", "acao"],
    ),
    "dashboard_ver": (
        dashboard_ver,
        (
            "Carrega o painel no perfil de tela e salva um PNG do painel inteiro; devolve o caminho do arquivo, "
            "a contagem de widgets e os que renderizaram vazios. O app grava preferência de widget ao carregar."
        ),
        {"loc": _LOC, "id": {"type": "string"}},
        ["loc", "id"],
    ),
    "dashboard_conferir": (
        dashboard_conferir,
        (
            "Confere o número de cada widget do painel contra uma recontagem pelas rotas de leitura: bate, "
            "diverge ou sem_conferencia. O resultado fica no rastro e `publicar` o consulta."
        ),
        {"loc": _LOC, "id": {"type": "string"}, "dias": {"type": "integer", "description": "janela até agora (30)"}},
        ["loc", "id"],
    ),
}
