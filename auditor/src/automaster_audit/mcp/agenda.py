"""Agenda: calendários, eventos, bloqueios e notas."""
from __future__ import annotations

from . import base
from .base import _LOC, _SNAP, ToolError

AGENDA_LEITURA = ("calendarios", "calendario", "livres", "eventos", "bloqueios", "ver", "notas")

AGENDA_ACOES = ("marcar", "remarcar", "situacao", "cancelar", "bloquear", "bloqueio-editar",
                "nota-criar", "nota-editar", "nota-apagar")

AGENDA_ACOES_BLOQUEIO = ("bloquear", "bloqueio-editar")

AGENDA_SITUACOES = ("new", "confirmed", "cancelled", "showed",
                    "noshow", "invalid", "completed", "active")

def agenda(loc: str, o: str = "calendarios", id: str | None = None,
           calendario: str | None = None, usuario: str | None = None,
           grupo: str | None = None, contato: str | None = None,
           inicio: str | None = None, fim: str | None = None,
           timezone: str | None = None, limite: int | None = None,
           pagina: int | None = None, snapshot: str | None = None) -> dict:
    """Leitura ao vivo de calendários, horários livres e compromissos da subconta."""
    if o not in AGENDA_LEITURA:
        raise ToolError(f"o inválido: {o}. Aceitos: {', '.join(AGENDA_LEITURA)}")
    if o in ("livres", "eventos", "bloqueios") and not (inicio and fim):
        raise ToolError(f"o={o} exige inicio e fim em ISO com fuso, ex.: 2026-10-02T00:00:00-03:00")
    if o == "livres" and not calendario:
        raise ToolError("o=livres exige calendario")
    if o in ("calendario", "ver", "notas") and not id:
        raise ToolError(f"o={o} exige id")
    if o == "bloqueios" and contato:
        raise ToolError("o=bloqueios não filtra por contato: bloqueio não tem contato")
    _, meta = base._load(loc, snapshot)
    args = ["agenda", "-l", loc, "-o", o]
    for flag, val in (("-i", id), ("--calendario", calendario), ("--usuario", usuario),
                      ("--grupo", grupo), ("--contato", contato), ("--inicio", inicio),
                      ("--fim", fim), ("--timezone", timezone),
                      ("--limite", str(limite) if limite else None),
                      ("--pagina", str(pagina) if pagina else None)):
        if val:
            args += [flag, val]
    return {"resultado": base._run_extractor(*args, "--json"), "_snapshot": meta}

def agenda_acao(loc: str, acao: str, id: str | None = None, calendario: str | None = None,
                contato: str | None = None, inicio: str | None = None, fim: str | None = None,
                titulo: str | None = None, descricao: str | None = None,
                endereco: str | None = None, situacao: str | None = None,
                dono: str | None = None, repeticao: str | None = None,
                alvo: str | None = None, nota: str | None = None, texto: str | None = None,
                silenciar: bool = False, forcar: bool = False,
                confirmo: bool = False, snapshot: str | None = None) -> dict:
    """ESCREVE: marca, remarca, muda a situação ou cancela compromisso; cria e edita notas."""
    if acao not in AGENDA_ACOES:
        raise ToolError(f"acao inválida: {acao}. Aceitas: {', '.join(AGENDA_ACOES)}")
    if not confirmo:
        raise ToolError(
            "Isto muda a agenda de verdade: fala com o cliente por e-mail ou SMS, acorda as "
            "automações ligadas ao compromisso e não tem desfazer. Repita com confirmo=true.")
    if acao == "marcar":
        if not (calendario and contato and inicio and situacao):
            raise ToolError("marcar exige calendario, contato, inicio e situacao")
    elif acao == "bloquear":
        if not (inicio and fim):
            raise ToolError("bloquear exige inicio e fim")
        if not dono:
            raise ToolError("bloquear exige dono: o bloqueio é da agenda de um usuário")
    elif acao == "bloqueio-editar":
        if not id:
            raise ToolError("bloqueio-editar exige id")
        # bloqueio-editar monta o mesmo corpo de bloquear, e o PUT substitui o bloqueio
        # inteiro: campo ausente é perdido (dono e horário inclusive).
        if not (inicio and fim and dono):
            raise ToolError("bloqueio-editar exige inicio, fim e dono além de id: o PUT "
                            "substitui o bloqueio inteiro, campo ausente é perdido")
    elif not id:
        raise ToolError(f"{acao} exige o id do compromisso")
    if acao in AGENDA_ACOES_BLOQUEIO and (contato or situacao):
        raise ToolError("bloqueio não tem contato nem situação: a rota não aceita esses campos")
    if acao in AGENDA_ACOES_BLOQUEIO and calendario:
        raise ToolError("bloqueio não aceita calendario: a rota recusa com 400 The calendar "
                        "is not an event calendar")
    if acao == "remarcar" and not inicio:
        raise ToolError("remarcar exige inicio")
    if acao == "situacao" and not situacao:
        raise ToolError("situacao exige situacao")
    if situacao and situacao not in AGENDA_SITUACOES:
        raise ToolError(
            f"situacao inválida: {situacao}. Aceitas: {', '.join(AGENDA_SITUACOES)}. "
            '"remarcado" não existe: remarcar é mudar o horário, com acao=remarcar.')
    if acao in ("nota-criar", "nota-editar") and not texto:
        raise ToolError(f"{acao} exige texto")
    if acao in ("nota-editar", "nota-apagar") and not nota:
        raise ToolError(f"{acao} exige nota com o id da nota")
    if alvo and alvo not in ("instancia", "serie"):
        raise ToolError("alvo aceita instancia ou serie")
    if repeticao and not dono:
        raise ToolError("repeticao exige dono: o servidor recusa série sem responsável")
    if forcar and acao in ("marcar", "remarcar") and not dono:
        raise ToolError(f"forcar exige dono: sem a checagem de horário o servidor recusa "
                        f"{acao} sem responsável")
    _, meta = base._load(loc, snapshot)
    args = ["agenda-acao", "-l", loc, "--acao", acao, "--confirmo"]
    for flag, val in (("-i", id), ("--calendario", calendario), ("--contato", contato),
                      ("--inicio", inicio), ("--fim", fim), ("--titulo", titulo),
                      ("--descricao", descricao), ("--endereco", endereco),
                      ("--situacao", situacao), ("--dono", dono),
                      ("--repeticao", repeticao), ("--alvo", alvo),
                      ("--nota", nota), ("--texto", texto)):
        if val:
            args += [flag, val]
    if silenciar:
        args += ["--silenciar"]
    if forcar:
        args += ["--forcar"]
    return base._run_extractor(*args, "--json") | {"_snapshot": meta}


TOOLS = {
    "agenda": (agenda, ("Leitura ao vivo da agenda (abre Chrome, não usa o dump): "
               "`calendarios` (os calendários da subconta), `calendario` (um pelo id), "
               "`livres` (horários livres de um calendário num período, teto de 31 dias), "
               "`eventos` (só compromissos do período — bloqueio NUNCA aparece aqui, use "
               "`bloqueios` para isso), `bloqueios` (só os bloqueios do período), `ver` (um compromisso pelo id), `notas` (as notas de um "
               "compromisso). Datas em ISO com fuso: 2026-10-02T14:00:00-03:00."),
               {"loc": _LOC, "o": {"type": "string", "enum": list(AGENDA_LEITURA),
                                   "default": "calendarios"},
                "id": {"type": "string", "description": "id do calendário ou do compromisso"},
                "calendario": {"type": "string"}, "usuario": {"type": "string"},
                "grupo": {"type": "string"},
                "contato": {"type": "string", "description": "só os compromissos deste contato"},
                "inicio": {"type": "string", "description": "ISO com fuso"},
                "fim": {"type": "string", "description": "ISO com fuso"},
                "timezone": {"type": "string", "description": "IANA, ex.: America/Sao_Paulo"},
                "limite": {"type": "integer"}, "pagina": {"type": "integer"},
                "snapshot": _SNAP},
               ["loc"]),
    "agenda_acao": (agenda_acao, ("ESCREVE EM PRODUÇÃO E FALA COM O CLIENTE: marca, remarca, "
                    "muda a situação ou cancela um compromisso, bloqueia um horário (`bloquear`, "
                    "`bloqueio-editar` — bloqueio não tem contato nem situação e exige `dono`, "
                    "`inicio` e `fim`), e cria, "
                    "edita ou apaga notas. "
                    "Marcar, remarcar e cancelar disparam e-mail ou SMS para o contato e "
                    "acordam as automações do compromisso; não há desfazer. Exige "
                    "confirmo=true; registro em <dumps>/_agenda/. Em compromisso que se "
                    "repete, `alvo` é obrigatório: instancia (DESTACA aquele dia — o servidor "
                    "devolve um id novo avulso e a série perde aquele dia para sempre, não é "
                    "uma edição no lugar) ou serie (todos). "
                    "`silenciar` evita a notificação mas também desliga os workflows, e pode "
                    "não impedir o e-mail que o próprio calendário manda."),
                    {"loc": _LOC, "acao": {"type": "string", "enum": list(AGENDA_ACOES)},
                     "id": {"type": "string",
                            "description": "id do compromisso ou do bloqueio (tudo menos marcar e bloquear)"},
                     "calendario": {"type": "string"}, "contato": {"type": "string",
                                                                   "description": "só em marcar"},
                     "inicio": {"type": "string", "description": "ISO com fuso"},
                     "fim": {"type": "string", "description": "ISO com fuso"},
                     "titulo": {"type": "string"}, "descricao": {"type": "string"},
                     "endereco": {"type": "string"},
                     "situacao": {"type": "string", "enum": list(AGENDA_SITUACOES)},
                     "dono": {"type": "string", "description": "usuário responsável"},
                     "repeticao": {"type": "string",
                                   "description": "regra RFC 5545; desliga a checagem de horário"},
                     "alvo": {"type": "string", "enum": ["instancia", "serie"]},
                     "nota": {"type": "string"}, "texto": {"type": "string"},
                     "silenciar": {"type": "boolean", "default": False},
                     "forcar": {"type": "boolean", "default": False},
                     "confirmo": {"type": "boolean", "default": False},
                     "snapshot": _SNAP},
                    ["loc", "acao"]),
}
