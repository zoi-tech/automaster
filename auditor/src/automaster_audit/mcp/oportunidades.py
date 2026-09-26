"""Oportunidades e pipelines."""

from __future__ import annotations

import json

from . import base
from .base import _LOC, _SNAP, ToolError

OPP_LEITURA = ("pipelines", "listar", "buscar", "ver")

OPP_ACOES = ("criar", "editar", "mover", "status", "apagar", "restaurar")

PIPE_ACOES = ("criar", "editar", "apagar")


def oportunidades(
    loc: str,
    o: str = "pipelines",
    id: str | None = None,
    pipeline: str | None = None,
    estagio: str | None = None,
    status: str | None = None,
    contato: str | None = None,
    termo: str | None = None,
    limite: int | None = None,
    pagina: int | None = None,
    snapshot: str | None = None,
) -> dict:
    """Leitura ao vivo de pipelines e oportunidades da subconta."""
    if o not in OPP_LEITURA:
        raise ToolError(f"o inválido: {o}. Aceitos: {', '.join(OPP_LEITURA)}")
    if o == "ver" and not id:
        raise ToolError("o=ver exige id da oportunidade")
    if o == "buscar" and not termo:
        raise ToolError("o=buscar exige termo")
    _, meta = base._load(loc, snapshot)
    args = ["oportunidades", "-l", loc, "-o", o]
    for flag, val in (
        ("-i", id),
        ("--pipeline", pipeline),
        ("--estagio", estagio),
        ("--status", status),
        ("--contato", contato),
        ("--termo", termo),
        ("--limite", str(limite) if limite else None),
        ("--pagina", str(pagina) if pagina else None),
    ):
        if val:
            args += [flag, val]
    return {"resultado": base._run_extractor(*args, "--json"), "_snapshot": meta}


def oportunidade_acao(
    loc: str,
    acao: str,
    id: str | None = None,
    pipeline: str | None = None,
    estagio: str | None = None,
    nome: str | None = None,
    valor: float | None = None,
    status: str | None = None,
    contato: str | None = None,
    dono: str | None = None,
    fechamento: str | None = None,
    probabilidade: float | None = None,
    campos: list | None = None,
    confirmo: bool = False,
    snapshot: str | None = None,
) -> dict:
    """ESCREVE: cria, edita, move, apaga ou restaura uma oportunidade."""
    if acao not in OPP_ACOES:
        raise ToolError(f"acao inválida: {acao}. Aceitas: {', '.join(OPP_ACOES)}")
    if not confirmo:
        raise ToolError("Isto muda dado real da subconta e não tem desfazer. Repita com confirmo=true.")
    if acao == "criar":
        if not (pipeline and nome and contato):
            raise ToolError("criar exige pipeline, nome e contato")
    elif not id:
        raise ToolError(f"{acao} exige o id da oportunidade")
    if acao != "criar" and contato:
        raise ToolError(
            "não dá para trocar o contato de uma oportunidade: o vínculo se define "
            "quando o card nasce. Crie outro card para a pessoa certa."
        )
    _, meta = base._load(loc, snapshot)
    args = ["oportunidade-acao", "-l", loc, "--acao", acao, "--confirmo"]
    for flag, val in (
        ("-i", id),
        ("--pipeline", pipeline),
        ("--estagio", estagio),
        ("--nome", nome),
        ("--valor", str(valor) if valor is not None else None),
        ("--status", status),
        ("--contato", contato),
        ("--dono", dono),
        ("--fechamento", fechamento),
        ("--probabilidade", str(probabilidade) if probabilidade is not None else None),
    ):
        if val:
            args += [flag, val]
    if campos:
        args += ["--campos", json.dumps(campos)]
    return base._run_extractor(*args, "--json") | {"_snapshot": meta}


def pipeline(
    loc: str,
    acao: str,
    id: str | None = None,
    nome: str | None = None,
    estagios: list | None = None,
    confirmo: bool = False,
    apagar_com_cards: bool = False,
    snapshot: str | None = None,
) -> dict:
    """ESCREVE: cria, edita ou apaga um pipeline e seus estágios."""
    if acao not in PIPE_ACOES:
        raise ToolError(f"acao inválida: {acao}. Aceitas: {', '.join(PIPE_ACOES)}")
    if not confirmo:
        raise ToolError("Isto muda a estrutura do funil e não tem desfazer. Repita com confirmo=true.")
    if acao == "criar" and not nome:
        raise ToolError("criar exige nome")
    if acao != "criar" and not id:
        raise ToolError(f"{acao} exige o id do pipeline")
    if acao != "apagar" and not estagios:
        raise ToolError(
            "estagios é obrigatório e precisa trazer a lista COMPLETA dos estágios "
            "que devem existir depois — estágio ausente da lista é removido"
        )
    _, meta = base._load(loc, snapshot)
    args = ["pipeline", "-l", loc, "--acao", acao, "--confirmo"]
    for flag, val in (("-i", id), ("--nome", nome)):
        if val:
            args += [flag, val]
    if estagios:
        args += ["--estagios", json.dumps(estagios)]
    if apagar_com_cards:
        args += ["--apagar-com-cards"]
    return base._run_extractor(*args, "--json") | {"_snapshot": meta}


TOOLS = {
    "oportunidades": (
        oportunidades,
        (
            "Leitura ao vivo de pipelines e oportunidades (abre Chrome, não usa "
            "o dump): `pipelines` (funis e seus estágios), `listar` (cards, com filtro de pipeline, "
            "estágio, status e contato), `buscar` (termo livre), `ver` (um card pelo id)."
        ),
        {
            "loc": _LOC,
            "o": {"type": "string", "enum": list(OPP_LEITURA), "default": "pipelines"},
            "id": {"type": "string", "description": "id da oportunidade (com o=ver)"},
            "pipeline": {"type": "string"},
            "estagio": {"type": "string"},
            "status": {"type": "string", "enum": ["open", "won", "lost", "abandoned", "all"]},
            "contato": {"type": "string", "description": "só as oportunidades deste contato"},
            "termo": {"type": "string", "description": "com o=buscar"},
            "limite": {"type": "integer"},
            "pagina": {"type": "integer", "description": "página da listagem, a partir de 1"},
            "snapshot": _SNAP,
        },
        ["loc"],
    ),
    "oportunidade_acao": (
        oportunidade_acao,
        (
            "ESCREVE EM PRODUÇÃO: cria, edita, move de estágio, muda o "
            "status, apaga ou restaura uma oportunidade. Exige confirmo=true; registro em "
            "<dumps>/_oportunidades/. `apagar` é reversível por `restaurar`. O contato de um "
            "card só se define na criação e não pode ser trocado depois."
        ),
        {
            "loc": _LOC,
            "acao": {"type": "string", "enum": list(OPP_ACOES)},
            "id": {"type": "string", "description": "id da oportunidade (tudo menos criar)"},
            "pipeline": {"type": "string"},
            "estagio": {"type": "string"},
            "nome": {"type": "string"},
            "valor": {"type": "number"},
            "status": {"type": "string", "enum": ["open", "won", "lost", "abandoned"]},
            "contato": {"type": "string", "description": "só na criação"},
            "dono": {"type": "string", "description": "usuário responsável"},
            "fechamento": {"type": "string", "description": "previsão de fechamento, AAAA-MM-DD"},
            "probabilidade": {"type": "number", "description": "0 a 100"},
            "campos": {
                "type": "array",
                "items": {"type": "object"},
                "description": "campos personalizados: [{id, fieldValue}]",
            },
            "confirmo": {"type": "boolean", "default": False},
            "snapshot": _SNAP,
        },
        ["loc", "acao"],
    ),
    "pipeline": (
        pipeline,
        (
            "ESCREVE EM PRODUÇÃO: cria, edita ou apaga um pipeline. `estagios` é "
            "SUBSTITUTIVO — estágio ausente da lista é removido, e os cards dele migram para um "
            "estágio que sobrou, o que acorda toda automação que reage a transição. A tool recusa "
            "remover estágio que tem card dentro, a menos que apagar_com_cards=true. "
            "Apagar pipeline NÃO tem restore; o estado anterior fica em <dumps>/_oportunidades/."
        ),
        {
            "loc": _LOC,
            "acao": {"type": "string", "enum": list(PIPE_ACOES)},
            "id": {"type": "string", "description": "id do pipeline (editar e apagar)"},
            "nome": {"type": "string"},
            "estagios": {
                "type": "array",
                "items": {"type": "object"},
                "description": "lista COMPLETA: [{id?, name, position?}]",
            },
            "confirmo": {"type": "boolean", "default": False},
            "apagar_com_cards": {
                "type": "boolean",
                "default": False,
                "description": "libera remover estágio com card dentro; eles migram, não somem",
            },
            "snapshot": _SNAP,
        },
        ["loc", "acao"],
    ),
}
