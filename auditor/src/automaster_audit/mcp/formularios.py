"""Formulários e surveys: leitura, escrita e identidade visual."""
from __future__ import annotations

import json
from . import base
from .base import ToolError, _LOC, _SNAP

FORM_LEITURA = ("lista", "detalhe", "submissoes", "buscar")

FORM_TIPOS = ("formulario", "survey")

def formularios(loc: str, o: str = "lista", tipo: str = "formulario", id: str | None = None,
                formulario: str | None = None, termo: str | None = None,
                inicio: str | None = None, fim: str | None = None,
                limite: int | None = None, pagina: int | None = None,
                snapshot: str | None = None) -> dict:
    """Leitura ao vivo de formulários, surveys e suas submissões."""
    if o not in FORM_LEITURA:
        raise ToolError(f"o inválido: {o}. Aceitos: {', '.join(FORM_LEITURA)}")
    if tipo not in FORM_TIPOS:
        raise ToolError(f"tipo inválido: {tipo}. Aceitos: {', '.join(FORM_TIPOS)}")
    if o == "detalhe" and not id:
        raise ToolError("o=detalhe exige id do formulário ou survey")
    if o == "buscar" and not termo:
        raise ToolError("o=buscar exige termo")
    _, meta = base._load(loc, snapshot)
    args = ["formularios", "-l", loc, "-o", o, "--tipo", tipo]
    for flag, val in (("-i", id), ("--formulario", formulario), ("--termo", termo),
                      ("--inicio", inicio), ("--fim", fim),
                      ("--limite", str(limite) if limite else None),
                      ("--pagina", str(pagina) if pagina else None)):
        if val:
            args += [flag, val]
    return {"resultado": base._run_extractor(*args, "--json"), "_snapshot": meta}

FORM_ACOES = ("criar", "apagar", "duplicar", "editar", "previa", "versoes", "restaurar")

ESTILO_ACOES = ("aplicar", "previa", "previa-visual", "paleta-ver", "paleta-gravar", "temas")

def formulario_acao(loc: str, acao: str, tipo: str = "formulario", id: str | None = None,
                    nome: str | None = None, ops: list | None = None,
                    versao: str | None = None, pasta: str | None = None,
                    permitir_sem_botao: bool = False, permitir_vazio: bool = False,
                    confirmo: bool = False, snapshot: str | None = None) -> dict:
    """ESCREVE: cria, edita, duplica, apaga ou restaura formulário e survey."""
    if acao not in FORM_ACOES:
        raise ToolError(f"acao inválida: {acao}. Aceitas: {', '.join(FORM_ACOES)}")
    if tipo not in FORM_TIPOS:
        raise ToolError(f"tipo inválido: {tipo}. Aceitos: {', '.join(FORM_TIPOS)}")
    if acao != "criar" and not id:
        raise ToolError(f"{acao} exige o id do formulário ou survey")
    if acao == "criar" and not nome:
        raise ToolError("criar exige nome")
    if acao == "restaurar" and not versao:
        raise ToolError("restaurar exige versao")
    if acao in ("editar", "previa") and not ops:
        raise ToolError("editar e previa exigem ops: [{'op': ..., ...}]")
    # `previa` e `versoes` não escrevem nada
    escreve = acao not in ("previa", "versoes")
    if escreve and not confirmo:
        raise ToolError("Isto muda dado real da subconta e não tem desfazer. "
                        "Repita com confirmo=true, ou use acao='previa' para ver o que mudaria.")
    _, meta = base._load(loc, snapshot)
    args = ["formulario-acao", "-l", loc,
            "--acao", "editar" if acao == "previa" else acao, "--tipo", tipo]
    if escreve:
        args.append("--confirmo")
    for flag, val in (("-i", id), ("--nome", nome), ("--versao", versao), ("--pasta", pasta)):
        if val:
            args += [flag, val]
    if ops:
        args += ["--ops", json.dumps(ops)]
    if permitir_sem_botao:
        args.append("--permitir-sem-botao")
    if permitir_vazio:
        args.append("--permitir-vazio")
    return base._run_extractor(*args, "--json") | {"_snapshot": meta}

def formulario_estilo(loc: str, acao: str, tipo: str = "formulario", id: str | None = None,
                      tokens: dict | None = None, versao: str | None = None,
                      saida: str | None = None, confirmo: bool = False,
                      snapshot: str | None = None) -> dict:
    """ESCREVE: aplica tokens visuais a um formulário, ou grava a paleta da subconta."""
    if acao not in ESTILO_ACOES:
        raise ToolError(f"acao inválida: {acao}. Aceitas: {', '.join(ESTILO_ACOES)}")
    if tipo not in FORM_TIPOS:
        raise ToolError(f"tipo inválido: {tipo}. Aceitos: {', '.join(FORM_TIPOS)}")
    if acao in ("aplicar", "previa", "previa-visual") and not id:
        raise ToolError(f"{acao} exige o id do formulário ou survey")
    if acao in ("aplicar", "previa", "paleta-gravar") and not tokens:
        raise ToolError(f"{acao} exige tokens")
    escreve = acao in ("aplicar", "paleta-gravar")
    if escreve and not confirmo:
        raise ToolError(
            "Isto muda dado real da subconta e não tem desfazer. Repita com confirmo=true, "
            "ou use acao='previa' para ver o que mudaria."
            if acao == "aplicar" else
            "Gravar a paleta muda a cor padrão de todo formulário novo desta subconta, "
            "inclusive os que o cliente criar na interface. Repita com confirmo=true.")
    _, meta = base._load(loc, snapshot)
    args = ["formulario-estilo", "-l", loc,
            "--acao", "aplicar" if acao == "previa" else acao, "--tipo", tipo]
    if escreve:
        args.append("--confirmo")
    for flag, val in (("-i", id), ("--versao", versao), ("--saida", saida)):
        if val:
            args += [flag, val]
    if tokens:
        args += ["--tokens", json.dumps(tokens)]
    return base._run_extractor(*args, "--json") | {"_snapshot": meta}


TOOLS = {
    "formularios": (formularios, "Leitura ao vivo de formulários e surveys (abre Chrome, não usa o dump): "
                    "`lista` (todos, já paginados), `detalhe` (um, com os campos), `submissoes` (respostas, "
                    "com filtro de formulário, contato e período), `buscar` (por nome). O parâmetro `tipo` "
                    "escolhe entre formulário e survey. O id `fb-<locationId>` nas submissões é o formulário "
                    "de lead do Facebook, não um formulário da subconta.",
                    {"loc": _LOC, "o": {"type": "string", "enum": list(FORM_LEITURA), "default": "lista"},
                     "tipo": {"type": "string", "enum": list(FORM_TIPOS), "default": "formulario"},
                     "id": {"type": "string", "description": "id do formulário ou survey (com o=detalhe)"},
                     "formulario": {"type": "string", "description": "filtra as submissões por formulário ou survey"},
                     "termo": {"type": "string", "description": "nome (o=buscar) ou contato/e-mail/telefone (o=submissoes)"},
                     "inicio": {"type": "string", "description": "primeira data das submissões, YYYY-MM-DD"},
                     "fim": {"type": "string", "description": "última data das submissões, YYYY-MM-DD"},
                     "limite": {"type": "integer", "description": "quantas submissões, até 100"},
                     "pagina": {"type": "integer", "description": "página das submissões, a partir de 1"},
                     "snapshot": _SNAP},
                    ["loc"]),
    "formulario_acao": (formulario_acao,
                        "ESCREVE EM PRODUÇÃO: cria, edita, duplica, apaga ou restaura um "
                        "formulário ou survey. A edição REPUBLICA O DOCUMENTO INTEIRO a partir "
                        "do que está no servidor, aplicando as `ops` declaradas — nunca peça "
                        "JSON cru do formulário. Use acao='previa' primeiro: ela mostra campo "
                        "que entra, campo que sai e estilo alterado sem gravar nada. "
                        "acao='versoes' lista o histórico e 'restaurar' volta a uma versão. "
                        "Remover exige nomear o campo; deixar o documento sem botão de envio ou "
                        "sem campo nenhum é recusado (permitir_sem_botao / permitir_vazio) — "
                        "exceto em acao='criar' com ops: o documento nasce vazio, então as duas "
                        "guardas saem sempre liberadas, e o formulário pode publicar sem botão "
                        "de envio. Slide só existe em survey. Exige confirmo=true; registro em "
                        "<dumps>/_formularios/.",
                        {"loc": _LOC, "acao": {"type": "string", "enum": list(FORM_ACOES)},
                         "tipo": {"type": "string", "enum": list(FORM_TIPOS), "default": "formulario"},
                         "id": {"type": "string"}, "nome": {"type": "string"},
                         "ops": {"type": "array", "items": {"type": "object"},
                                 "description": "operações: adicionar-campo, remover-campo, "
                                                "renomear-campo, reordenar-campos, mover-campo, "
                                                "criar-slide, remover-slide, renomear-slide, "
                                                "reordenar-slides, definir-logica, definir"},
                         "versao": {"type": "string", "description": "versionId (restaurar)"},
                         "pasta": {"type": "string"},
                         "permitir_sem_botao": {"type": "boolean", "default": False},
                         "permitir_vazio": {"type": "boolean", "default": False},
                         "confirmo": {"type": "boolean", "default": False},
                         "snapshot": _SNAP},
                        ["loc", "acao"]),
    "formulario_estilo": (formulario_estilo,
                          "ESCREVE EM PRODUÇÃO: aplica a identidade visual a um formulário ou "
                          "survey (acao='aplicar'), mostra a prévia ('previa'), tira screenshot "
                          "da página pública real ('previa-visual'), lê os temas e a paleta da "
                          "subconta ('temas', 'paleta-ver') ou grava a paleta padrão "
                          "('paleta-gravar' — muda a cor de TODO formulário novo da subconta). "
                          "Os tokens saem da skill automaster-formulario-visual. O estilo vai "
                          "para fieldStyle e customStyle; fieldCSS NUNCA é escrito, porque o "
                          "builder o regenera e apagaria o trabalho. Em 'paleta-gravar' a "
                          "resposta pode trazer um campo 'aviso': presente quando não deu para "
                          "ler a paleta atual da subconta antes de gravar, OU quando a leitura "
                          "respondeu num formato inesperado, e por isso a gravação SUBSTITUIU "
                          "a paleta em vez de mesclar nela — leia esse "
                          "campo antes de assumir que nada se perdeu. Exige confirmo=true para "
                          "gravar; registro em <dumps>/_formularios/.",
                          {"loc": _LOC, "acao": {"type": "string", "enum": list(ESTILO_ACOES)},
                           "tipo": {"type": "string", "enum": list(FORM_TIPOS), "default": "formulario"},
                           "id": {"type": "string"},
                           "tokens": {"type": "object",
                                      "description": "corPrimaria, corTexto, corFundo, corBorda, "
                                                     "corErro, fonte, tamanhoRotulo, pesoRotulo, "
                                                     "radius, espacamento, cssLivre"},
                           "versao": {"type": "string"}, "saida": {"type": "string"},
                           "confirmo": {"type": "boolean", "default": False},
                           "snapshot": _SNAP},
                          ["loc", "acao"]),
}
