"""Workflows ao vivo e edição de workflow."""

from __future__ import annotations

import json

from ..loader import sobrepor_entidades
from ..validacao_escrita import validar_edicao
from . import base
from .base import _LOC, _SNAP, ToolError

WF_LEITURA = ("lista", "dentro", "contato")

WF_ACOES = ("publicar", "inscrever", "remover", "retomar")

WF_STATUS = ("published", "draft", "locked", "paused")


def workflows_ao_vivo(
    loc: str,
    o: str = "lista",
    id: str | None = None,
    contato: str | None = None,
    limite: int | None = None,
    nomes: bool = False,
) -> dict:
    """Leitura ao vivo de workflows e inscrições. Não usa o dump."""
    if o not in WF_LEITURA:
        raise ToolError(f"o inválido: {o}. Aceitos: {', '.join(WF_LEITURA)}")
    if o == "dentro" and not id:
        raise ToolError("o=dentro exige o id do workflow")
    if o == "contato" and not contato:
        raise ToolError("o=contato exige o contato")
    args = ["workflows-ao-vivo", "-l", loc, "-o", o]
    for flag, val in (("-i", id), ("--contato", contato), ("--limite", str(limite) if limite else None)):
        if val:
            args += [flag, val]
    if nomes:
        args += ["--nomes"]
    return base._run_extractor(*args, "--json")


def workflow_acao(
    loc: str,
    acao: str,
    id: str,
    contato: str | None = None,
    inscricao: str | None = None,
    status: str | None = None,
    usuario: str | None = None,
    inicio: str | None = None,
    confirmo: bool = False,
) -> dict:
    """ESCREVE: publica/despublica um workflow, inscreve, remove ou retoma um contato."""
    if acao not in WF_ACOES:
        raise ToolError(f"acao inválida: {acao}. Aceitas: {', '.join(WF_ACOES)}")
    if not confirmo:
        raise ToolError("Isto muda dado real da subconta e não tem desfazer. Repita com confirmo=true.")
    if acao == "publicar":
        if not status:
            raise ToolError(f"publicar exige status: {', '.join(WF_STATUS)}")
        if status not in WF_STATUS:
            raise ToolError(f"status inválido: {status}. Aceitos: {', '.join(WF_STATUS)}")
    elif acao in ("inscrever", "remover") and not contato:
        raise ToolError(f"{acao} exige o contato")
    elif acao == "retomar" and not (contato or inscricao):
        raise ToolError("retomar exige inscricao ou contato")
    args = ["workflow-acao", "-l", loc, "--acao", acao, "--confirmo", "-i", id]
    for flag, val in (
        ("--contato", contato),
        ("--inscricao", inscricao),
        ("--status", status),
        ("--usuario", usuario),
        ("--inicio", inicio),
    ):
        if val:
            args += [flag, val]
    return base._run_extractor(*args, "--json")


WF_EDITAR_ACOES = (
    "criar",
    "renomear",
    "mover",
    "duplicar",
    "apagar",
    "trocar-ref",
    "trocar-tag",
    "limpar-orfaos",
    "atributo",
    "trigger",
    "historico",
    "step-criar",
    "step-remover",
    "step-mover",
    "configuracao",
)

# ações que mexem no corpo do workflow e por isso passam pela validação das 29 regras
_WF_EDITAR_COM_CORPO = {
    "trocar-ref",
    "trocar-tag",
    "limpar-orfaos",
    "atributo",
    "trigger",
    "step-criar",
    "step-remover",
    "step-mover",
}


_SO_PARA_VALIDAR = ("documento", "documentoAntes", "entidades", "entidadesFalhas", "triggersAntesLista")


def _sem_documento(r: dict) -> dict:
    """O documento e as entidades servem à validação local e nunca voltam ao modelo."""
    for chave in _SO_PARA_VALIDAR:
        r.pop(chave, None)
    return r


def workflow_editar(
    loc: str,
    acao: str,
    id: str | None = None,
    nome: str | None = None,
    pasta: str | None = None,
    de: str | None = None,
    para: str | None = None,
    step: str | None = None,
    caminho: str | None = None,
    valor: str | None = None,
    campo: str | None = None,
    trigger_acao: str | None = None,
    trigger_id: str | None = None,
    trigger_corpo: dict | str | None = None,
    corpo: dict | str | None = None,
    depois_de: str | None = None,
    ramos: list | str | None = None,
    com_subarvore: bool = False,
    confirmo: bool = False,
    publicado: bool = False,
    snapshot: str | None = None,
) -> dict:
    """ESCREVE workflow ao vivo. Sem `confirmo`, devolve a prévia com o diff.

    Para ação que mexe no corpo, roda SEMPRE a prévia primeiro e valida o documento
    editado contra as 29 regras (`validar_edicao`) antes de decidir se grava. Sem dump em
    disco a validação não roda, mas isso não trava a gravação.

    O documento editado NÃO volta na resposta: serve à validação local e só. A `version`
    que a prévia leu é carregada para a gravação (`--versao-esperada`), que aborta se o
    workflow mudou entre os dois processos.
    """
    if acao not in WF_EDITAR_ACOES:
        raise ToolError(f"acao inválida: {acao!r}. Use uma de: {', '.join(WF_EDITAR_ACOES)}")
    if acao != "criar" and not id:
        raise ToolError(f"acao {acao!r} exige `id` (id do workflow)")
    # Workflow fora de pasta some da lista da interface (a raiz mostra PASTA, não workflow)
    # e o editor abre em branco. O erro sai aqui, antes de chamar o extractor à toa.
    if acao in ("criar", "duplicar") and not pasta:
        raise ToolError(
            f"acao {acao!r} exige `pasta`: workflow fora de pasta não aparece na lista do app e o "
            "editor abre em branco. Os ids de pasta saem da tool `inventario` ou do dump."
        )
    if trigger_corpo is not None and not isinstance(trigger_corpo, str):
        trigger_corpo = json.dumps(trigger_corpo, ensure_ascii=False)
    if corpo is not None and not isinstance(corpo, str):
        corpo = json.dumps(corpo, ensure_ascii=False)
    if ramos is not None and not isinstance(ramos, str):
        ramos = json.dumps(ramos, ensure_ascii=False)

    def _args(com_confirmo: bool, versao: object = None, triggers: object = None) -> list[str]:
        a = ["workflow-editar", "-l", loc, "--acao", acao]
        # Esta porta É a guarda das 29 regras: a camada crua recusa gravar sem esta flag,
        # justamente para que ninguém passe por fora dela sem querer.
        if com_confirmo:
            a.append("--sem-regras")
        # Apagar trigger não mexe no `version`, então a guarda de concorrência do caminho de
        # trigger é a lista de ids que a prévia viu, não a versão.
        if triggers:
            a += ["--triggers-esperados", ",".join(str(t) for t in triggers)]
        # I1: a prévia e a gravação são dois processos, com o tempo entre as duas invocações. Sem
        # carregar a `version` que a prévia viu, a guarda de concorrência só enxerga o que
        # acontece DENTRO da segunda invocação, e a janela entre as duas fica descoberta.
        if versao is not None:
            a += ["--versao-esperada", str(versao)]
        for flag, valor_opcional in (
            ("-i", id),
            ("--nome", nome),
            ("--pasta", pasta),
            ("--de", de),
            ("--para", para),
            ("--step", step),
            ("--caminho", caminho),
            ("--valor", valor),
            ("--campo", campo),
            ("--trigger-acao", trigger_acao),
            ("--trigger-id", trigger_id),
            ("--trigger-corpo", trigger_corpo),
            ("--corpo", corpo),
            ("--depois-de", depois_de),
            ("--ramos", ramos),
        ):
            if valor_opcional is not None:
                a += [flag, str(valor_opcional)]
        if com_subarvore:
            a.append("--com-subarvore")
        if com_confirmo:
            a.append("--confirmo")
        if publicado:
            a.append("--publicado")
        a.append("--json")
        return a

    if acao not in _WF_EDITAR_COM_CORPO:
        resultado = base._run_extractor(*_args(confirmo))
        return _sem_documento(resultado)

    # O dump é checado ANTES da prévia: a prévia chama o extractor ao vivo, e workflow
    # recém-criado ou duplicado não está em dump nenhum — não pode virar exceção crua
    # depois de todo esse trabalho. A ausência aqui não zera mais o ctx: se a prévia
    # trouxer o documento de antes, o workflow entra no contexto montado ao vivo.
    ctx = meta = None
    sem_validacao = None
    try:
        ctx, meta = base._load(loc, snapshot)
    except ToolError:
        sem_validacao = "sem dump desta subconta em disco: as 29 regras não foram rodadas"

    previa = base._run_extractor(*_args(False))
    # M3: o documento inteiro do workflow e as entidades ao vivo não voltam para o
    # contexto do modelo. Eles existem para a validação local, e só.
    documento = previa.get("documento")
    documento_antes = previa.get("documentoAntes")
    entidades = previa.get("entidades") or {}
    falhas = previa.get("entidadesFalhas") or []
    triggers_antes_lista = previa.get("triggersAntesLista")
    _sem_documento(previa)
    versao = previa.get("versao")
    triggers_antes = previa.get("triggersAntes")

    fora_do_dump = ctx is not None and not any(getattr(w, "id", None) == id for w in getattr(ctx, "workflows", []))
    if fora_do_dump and documento_antes is None:
        sem_validacao = (
            f"workflow {id} não está no dump {meta['snapshot']} (criado ou duplicado depois da "
            "última extração) e a prévia não trouxe o documento de antes: as 29 regras não foram rodadas."
        )
        ctx = None
    if ctx is not None and entidades:
        ctx = sobrepor_entidades(ctx, entidades)

    if ctx is None:
        previa["validacao"] = {"rodou": False, "motivo": sem_validacao}
        if not confirmo:
            return previa
        # a falta de dump não pode travar a escrita
        resultado = base._run_extractor(*_args(True, versao, triggers_antes))
        resultado["validacao"] = previa["validacao"]
        return _sem_documento(resultado)

    if documento is None:
        # nada a validar (ex: "nada a mudar: a operação não encontrou alvo"). Mesmo aqui a
        # resposta diz que as regras não rodaram: ausência silenciosa da chave `validacao`
        # se lê como "validou e passou".
        previa["validacao"] = {
            "rodou": False,
            "motivo": "a prévia não devolveu documento para validar (nada a mudar): as 29 regras não foram rodadas",
        }
        if not confirmo:
            return previa
        resultado = base._run_extractor(*_args(True, versao, triggers_antes))
        resultado["validacao"] = previa["validacao"]
        return _sem_documento(resultado)

    try:
        resultado_validacao = validar_edicao(
            ctx,
            id,
            documento,
            previa.get("triggers"),
            doc_antes=documento_antes,
            triggers_antes=triggers_antes_lista,
        )
    except ValueError as e:
        previa["validacao"] = {"rodou": False, "motivo": str(e)}
        if not confirmo:
            return previa
        resultado = base._run_extractor(*_args(True, versao, triggers_antes))
        resultado["validacao"] = previa["validacao"]
        return _sem_documento(resultado)

    origem = "entidades lidas ao vivo" if entidades else f"entidades do dump {meta['snapshot']}"
    if falhas:
        origem += f" (do dump, por falha de leitura: {', '.join(falhas)})"
    validacao = {
        "rodou": True,
        "snapshot": meta["snapshot"],
        "pode_gravar": resultado_validacao.pode_gravar,
        "erros_novos": resultado_validacao.erros_novos,
        "erros_resolvidos": resultado_validacao.erros_resolvidos,
        "aviso": f"as regras rodaram com {origem}; templates e formulários vêm do dump {meta['snapshot']}",
    }
    if fora_do_dump:
        validacao["aviso"] += "; workflow mais novo que o dump, validado a partir do documento ao vivo"
    if getattr(resultado_validacao, "triggers_do_dump", False):
        validacao["aviso"] += (
            "; a lista de triggers veio do dump (o comando não a devolveu), então achado de "
            "trigger vale para o snapshot, não para agora"
        )
    previa["validacao"] = validacao

    if not confirmo:
        return previa

    if not resultado_validacao.pode_gravar:
        previa["aplicado"] = False
        previa["motivo"] = "gravação recusada: a validação contra as 29 regras encontrou erro novo — " + "; ".join(
            resultado_validacao.erros_novos
        )
        return previa

    resultado = base._run_extractor(*_args(True, versao, triggers_antes))
    resultado["validacao"] = validacao
    return _sem_documento(resultado)


TOOLS = {
    "workflows_ao_vivo": (
        workflows_ao_vivo,
        (
            "Leitura AO VIVO de workflows (pelo processo de fundo do extractor, não usa o "
            "dump e não exige extração prévia): `lista` (todos os workflows com o status "
            "corrente), `dentro` (quem está dentro de um workflow agora, com o passo em "
            "que cada um parou, desde quando e por que entrou), `contato` (em que "
            "workflows um contato está agora). Teto de 500 inscritos, ajustável por "
            "`limite`; a resposta declara se cortou. `nomes=true` resolve o nome de cada "
            "contato, uma chamada por contato — lento em lista grande."
        ),
        {
            "loc": _LOC,
            "o": {"type": "string", "enum": list(WF_LEITURA), "default": "lista"},
            "id": {"type": "string", "description": "id do workflow (com o=dentro)"},
            "contato": {"type": "string", "description": "id do contato (com o=contato)"},
            "limite": {"type": "integer", "description": "teto de inscritos (padrão 500)"},
            "nomes": {"type": "boolean", "default": False},
        },
        ["loc"],
    ),
    "workflow_acao": (
        workflow_acao,
        (
            "ESCREVE EM PRODUÇÃO: publica ou despublica um workflow "
            "(`publicar` com o status desejado), inscreve um contato, remove um contato ou "
            "retoma uma inscrição parada. Exige confirmo=true; registro em "
            "<dumps>/_workflows/<locationId>/<workflowId>/. Despublicar NÃO remove ninguém: quem está "
            "dentro congela no passo em que está e volta a andar, todo mundo de uma vez, "
            "quando o workflow for republicado. Inscrever é enfileirado pelo servidor — ler "
            "logo depois pode não mostrar o contato ainda. A ação é carimbada com o usuário "
            "logado no histórico do GHL; `usuario` sobrescreve."
        ),
        {
            "loc": _LOC,
            "acao": {"type": "string", "enum": list(WF_ACOES)},
            "id": {"type": "string", "description": "id do workflow"},
            "contato": {"type": "string", "description": "inscrever, remover, retomar"},
            "inscricao": {"type": "string", "description": "id da inscrição (retomar)"},
            "status": {"type": "string", "enum": list(WF_STATUS), "description": "com acao=publicar"},
            "usuario": {"type": "string", "description": "autor; sem ele, sai do token"},
            "inicio": {"type": "string", "description": "início programado (inscrever), ISO com fuso"},
            "confirmo": {"type": "boolean", "default": False},
        },
        ["loc", "acao", "id"],
    ),
    "workflow_editar": (
        workflow_editar,
        (
            "ESCREVE AO VIVO: cria, renomeia, move, duplica e apaga workflow; e edita o "
            "corpo de um existente — troca uma referência (`trocar-ref`), troca uma tag pelo "
            "nome (`trocar-tag`), remove steps que nunca executam (`limpar-orfaos`), altera um "
            "atributo de step (`atributo`) e adiciona, remove ou substitui um trigger "
            "(`trigger`). Monta o canvas: insere um step (`step-criar`), remove um step vivo "
            "recosturando os ponteiros (`step-remover`) e muda um step de lugar (`step-mover`). "
            "Altera configuração geral do workflow (`configuracao`: por ora só `allowMultiple`, a "
            "reentrada). "
            "Sem `confirmo` devolve a PRÉVIA com o diff e não grava nada. "
            "Workflow publicado exige `publicado=true` junto. `criar` e `duplicar` exigem "
            "`pasta` — workflow fora de pasta não aparece na lista do app. A resposta traz "
            "`url`, o link do editor. Não move container nem remove ramo de container isolado."
        ),
        {
            "loc": _LOC,
            "acao": {"type": "string", "enum": list(WF_EDITAR_ACOES)},
            "id": {"type": "string", "description": "id do workflow (tudo menos criar)"},
            "nome": {"type": "string", "description": "criar, renomear, duplicar"},
            "pasta": {
                "type": "string",
                "description": "id da pasta; OBRIGATÓRIO em criar e duplicar "
                "(fora de pasta o app não mostra o workflow)",
            },
            "de": {"type": "string", "description": "id (trocar-ref) ou nome de tag (trocar-tag) a substituir"},
            "para": {"type": "string", "description": "id ou nome de tag novo"},
            "step": {"type": "string", "description": "id do step (atributo, step-remover, step-mover)"},
            "caminho": {"type": "string", "description": "campo dentro de attributes, aninhado com ponto"},
            "valor": {"type": "string", "description": "valor novo; JSON válido vira JSON"},
            "campo": {
                "type": "string",
                "enum": ["allowMultiple"],
                "description": "configuracao: chave geral do workflow; allowMultiple = reentrada",
            },
            "trigger_acao": {"type": "string", "enum": ["adicionar", "remover", "substituir"]},
            "trigger_id": {"type": "string", "description": "id do trigger que SAI (remover, substituir)"},
            "trigger_corpo": {
                "type": "object",
                "description": "trigger que ENTRA (adicionar, substituir): "
                "`type` obrigatório (appointment, contact_tag, "
                "form_submission…), mais `name`, `conditions` e "
                '`masterType: "highlevel"`. O `workflowId` é '
                "preenchido pela tool",
            },
            "corpo": {
                "type": "object",
                "description": "step que ENTRA (step-criar): `type` obrigatório, mais "
                "`name` e `attributes` no formato do tipo. Copie um step "
                "existente do mesmo tipo como molde — os attributes não "
                "são modelados. `id`, `parentKey` e `next` são ignorados",
            },
            "depois_de": {
                "type": "string",
                "description": "id do step que fica logo ANTES (step-criar, step-mover); "
                "pode ser um nó de ramo, não pode ser um container. Em "
                "step-criar, sem ele o step entra no INÍCIO do fluxo — é "
                "assim que nasce o primeiro step de um workflow do zero",
            },
            "ramos": {
                "type": "array",
                "description": "step-criar: lista de ramos, e o step nasce container de N "
                "saídas. Cada ramo é {name, branch?, else?}; `branch` é a "
                "condição do if_else (segments/operator) e `else` marca o "
                "ramo None. Sem if_else os ramos viram `transition`",
                "items": {"type": "object"},
            },
            "com_subarvore": {
                "type": "boolean",
                "description": "step-remover: o container sai levando os ramos e tudo que pende deles",
            },
            "confirmo": {"type": "boolean", "description": "obrigatório para gravar"},
            "publicado": {
                "type": "boolean",
                "description": "obrigatório junto de confirmo se o workflow está publicado",
            },
            "snapshot": _SNAP,
        },
        ["loc", "acao"],
    ),
}
