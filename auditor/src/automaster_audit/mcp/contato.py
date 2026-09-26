"""Contato: linha do tempo, edição, notas e tarefas."""

from __future__ import annotations

import json

from ..journey import TriggerIndex
from . import base
from .base import _LOC, _SNAP, CONTATO_NOISE, ToolError


def contato(loc: str, id: str, days: int = 60, ate: str | None = None, snapshot: str | None = None) -> dict:
    _, meta = base._load(loc, snapshot)
    events = [
        {k: v for k, v in e.items() if k not in CONTATO_NOISE} for e in base._run_timeline(loc, id, int(days))["events"]
    ]
    events.sort(key=lambda e: str(e.get("createdAt", "")), reverse=True)
    if ate:
        events = [e for e in events if str(e.get("createdAt", "")) < ate]
    kept, size = [], 0
    for e in events:
        size += len(json.dumps(e, ensure_ascii=False))
        if kept and size > base.CONTATO_MAX_CHARS:
            break
        kept.append(e)
    truncated = len(kept) < len(events)
    return {
        "id": id,
        "days": days,
        "n_total": len(events),
        "eventos": kept,
        "truncado": truncated,
        "proximo_ate": kept[-1].get("createdAt") if truncated else None,
        "_snapshot": meta,
    }


def editar(
    loc: str,
    id: str,
    set: dict | None = None,
    tags_adicionar: list | None = None,
    tags_remover: list | None = None,
    snapshot: str | None = None,
) -> dict:
    set, tags_adicionar, tags_remover = set or {}, tags_adicionar or [], tags_remover or []
    if not (set or tags_adicionar or tags_remover):
        raise ToolError("nada a fazer: passe set={campo: valor} e/ou tags_adicionar/tags_remover")
    ctx, meta = base._load(loc, snapshot)
    args = ["contato-editar", "-l", loc, "-i", id]
    for k, v in set.items():
        args += ["--set", f"{k}={v}"]
    args += [x for t in tags_adicionar for x in ("--tag", f"+{t}")]
    args += [x for t in tags_remover for x in ("--tag", f"-{t}")]
    out = base._run_extractor(*args, "--json")

    idx = TriggerIndex(ctx)
    hits = [t for tag in tags_adicionar for t in idx.for_tag(tag)]
    hits += [t for tag in tags_remover for t in idx.for_tag(tag, "tagsRemoved")]
    if set:
        hits += idx.for_field_change()
    # só publicado: rascunho não roda, avisar sobre ele é ruído
    names = {w.id: w.name for w in ctx.workflows if w.status == "published"}
    dispara = sorted({(t["target"], names[t["target"]], t["name"]) for t in hits if t["target"] in names})
    out["dispara"] = [{"workflow": w, "nome": n, "trigger": tr} for w, n, tr in dispara]
    return out | {"_snapshot": meta}


ANOTACAO_LEITURA = ("lista", "detalhe", "buscar")

ANOTACAO_ACOES = ("criar", "editar", "apagar", "concluir", "reabrir")

ANOTACAO_TIPOS = ("nota", "tarefa")


def anotacoes(
    loc: str,
    o: str = "lista",
    tipo: str = "nota",
    contato: str | None = None,
    id: str | None = None,
    dono: str | None = None,
    concluidas: bool | None = None,
    termo: str | None = None,
    limite: int | None = None,
) -> dict:
    """Leitura ao vivo de notas e tarefas do contato. Não usa o dump."""
    if o not in ANOTACAO_LEITURA:
        raise ToolError(f"o inválido: {o}. Aceitos: {', '.join(ANOTACAO_LEITURA)}")
    if tipo not in ANOTACAO_TIPOS:
        raise ToolError(f"tipo inválido: {tipo}. Aceitos: {', '.join(ANOTACAO_TIPOS)}")
    if o == "buscar" and tipo != "tarefa":
        raise ToolError("o=buscar só existe para tarefa: não há busca de nota por subconta")
    if o != "buscar" and not contato:
        raise ToolError(f"o={o} exige contato")
    if o == "detalhe" and not id:
        raise ToolError("o=detalhe exige id da nota ou tarefa")
    args = ["anotacoes", "-l", loc, "-o", o, "--tipo", tipo]
    for flag, val in (
        ("--contato", contato),
        ("-i", id),
        ("--dono", dono),
        ("--termo", termo),
        ("--concluidas", None if concluidas is None else str(concluidas).lower()),
        ("--limite", str(limite) if limite else None),
    ):
        if val:
            args += [flag, val]
    return {"resultado": base._run_extractor(*args, "--json")}


def anotacao_acao(
    loc: str,
    acao: str,
    contato: str,
    tipo: str = "nota",
    id: str | None = None,
    texto: str | None = None,
    titulo: str | None = None,
    prazo: str | None = None,
    dono: str | None = None,
    confirmo: bool = False,
) -> dict:
    """ESCREVE: nota e tarefa do contato. Sem confirmo, devolve a prévia."""
    if acao not in ANOTACAO_ACOES:
        raise ToolError(f"acao inválida: {acao}. Aceitas: {', '.join(ANOTACAO_ACOES)}")
    if tipo not in ANOTACAO_TIPOS:
        raise ToolError(f"tipo inválido: {tipo}. Aceitos: {', '.join(ANOTACAO_TIPOS)}")
    if acao != "criar" and not id:
        raise ToolError(f"acao={acao} exige id da nota ou tarefa")
    if acao in ("concluir", "reabrir") and tipo != "tarefa":
        raise ToolError("concluir e reabrir só existem para tarefa")
    if acao == "criar" and tipo == "nota" and not texto:
        raise ToolError("criar nota exige texto")
    if acao == "criar" and tipo == "tarefa" and not (titulo and prazo):
        raise ToolError("criar tarefa exige titulo e prazo (ISO, ex. 2026-10-01T10:00:00Z)")
    args = ["anotacao-acao", "-l", loc, "--acao", acao, "--tipo", tipo, "--contato", contato]
    for flag, val in (("-i", id), ("--texto", texto), ("--titulo", titulo), ("--prazo", prazo), ("--dono", dono)):
        if val:
            args += [flag, val]
    if confirmo:
        args.append("--confirmo")
    return {"resultado": base._run_extractor(*args, "--json")}


TOOLS = {
    "contato": (
        contato,
        (
            "AO VIVO: abre Chrome e pagina o audit log do contato (~10 s logado, exige setup do "
            "extractor). Eventos mais recentes primeiro (~155 tokens cada), sourceWorkflowName resolvido; teto ~10k tokens, "
            "pagine com ate=proximo_ate."
        ),
        {
            "loc": _LOC,
            "id": {"type": "string", "description": "id do contato"},
            "days": {"type": "integer", "default": 60},
            "ate": {"type": "string", "description": "só eventos antes deste ISO (paginação)"},
            "snapshot": _SNAP,
        },
        ["loc", "id"],
    ),
    "anotacoes": (
        anotacoes,
        (
            "Leitura ao vivo de notas e tarefas do contato (abre Chrome, não usa o "
            "dump): `lista` e `detalhe` precisam de contato; `buscar` varre as tarefas de TODA "
            "a subconta e só existe para tarefa — é a forma de responder o que está atrasado. "
            "Nota de compromisso é outra coisa, e sai pela tool `agenda`."
        ),
        {
            "loc": _LOC,
            "o": {"type": "string", "enum": list(ANOTACAO_LEITURA), "default": "lista"},
            "tipo": {"type": "string", "enum": list(ANOTACAO_TIPOS), "default": "nota"},
            "contato": {"type": "string", "description": "contactId; obrigatório fora de o=buscar"},
            "id": {"type": "string", "description": "id da nota ou tarefa (com o=detalhe)"},
            "dono": {"type": "string", "description": "filtra tarefas por responsável (o=buscar)"},
            "concluidas": {"type": "boolean", "description": "filtra tarefas concluídas (o=buscar)"},
            "termo": {"type": "string", "description": "busca no texto das tarefas (o=buscar)"},
            "limite": {"type": "integer", "description": "quantas tarefas; o servidor usa 25"},
        },
        ["loc"],
    ),
    "anotacao_acao": (
        anotacao_acao,
        (
            "ESCREVE EM PRODUÇÃO: cria, edita ou apaga nota e tarefa do contato, e conclui "
            "ou reabre tarefa. Sem confirmo=true devolve a prévia com o corpo que iria para "
            "o servidor, sem gravar. Criar tarefa exige titulo e prazo (ISO); a tarefa nasce "
            "não concluída. Apagar não tem desfazer."
        ),
        {
            "loc": _LOC,
            "acao": {"type": "string", "enum": list(ANOTACAO_ACOES)},
            "contato": {"type": "string", "description": "contactId"},
            "tipo": {"type": "string", "enum": list(ANOTACAO_TIPOS), "default": "nota"},
            "id": {"type": "string", "description": "id da nota ou tarefa; tudo menos criar"},
            "texto": {"type": "string", "description": "corpo da nota, ou descrição da tarefa"},
            "titulo": {"type": "string", "description": "título da tarefa"},
            "prazo": {"type": "string", "description": "vencimento em ISO, ex. 2026-10-01T10:00:00Z"},
            "dono": {"type": "string", "description": "responsável pela tarefa"},
            "confirmo": {"type": "boolean", "description": "true grava de verdade", "default": False},
        },
        ["loc", "acao", "contato"],
    ),
    "editar": (
        editar,
        (
            "ESCREVE EM PRODUÇÃO: altera campos e/ou tags de um contato pela API interna (abre Chrome). "
            "Grava snapshot do contato antes; devolve antes/depois, caminho do snapshot e `dispara` = workflows "
            "cujo trigger reage à mudança. Nomes de campo/tag resolvidos pelo dump; não cria tags."
        ),
        {
            "loc": _LOC,
            "id": {"type": "string", "description": "id do contato"},
            "set": {"type": "object", "description": "campo (nome, fieldKey ou id) → valor"},
            "tags_adicionar": {"type": "array", "items": {"type": "string"}},
            "tags_remover": {"type": "array", "items": {"type": "string"}},
            "snapshot": _SNAP,
        },
        ["loc", "id"],
    ),
}
