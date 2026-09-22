"""Tags da subconta, com o cruzamento de impacto contra o dump."""
from __future__ import annotations

from . import base
from .base import _LOC, _SNAP, ToolError

TAG_ACOES = ("criar", "renomear", "apagar")

def _tem_tag_por_merge_field(ctx) -> bool:
    """
    Step `add_contact_tag` pode escolher a tag em tempo de execução, por
    `attributes.customTags` com um merge field. Nenhuma contagem de citação vê essa ligação,
    então a resposta declara o furo em vez de fingir que ele não existe.
    """
    for wf in getattr(ctx, "workflows", []) or []:
        for step in (((wf.raw or {}).get("steps") or {}).get("templates") or []):
            if (step.get("attributes") or {}).get("customTags"):
                return True
    return False

def _impacto_tags(loc: str, snapshot: str | None = None) -> tuple[dict | None, dict | None]:
    """
    Índice reverso de tag do dump: nome em MINÚSCULAS → workflows e papéis.

    Devolve `(None, meta_do_aviso)` quando a subconta não tem dump — a tag é ao vivo, e
    exigir dump para listá-la seria arbitrário.
    """
    try:
        ctx, meta = base._load(loc, snapshot)
    except Exception as e:  # noqa: BLE001 - a tag é ao vivo: qualquer falha de dump vira aviso, não erro
        return None, {"motivo": str(e)}
    dash = base._dash(str(ctx.path))
    idx = {
        t["name"].strip().lower(): {"workflows": sorted(t.get("used_by") or []),
                                    "papeis": sorted(t.get("papeis") or [])}
        for t in dash.get("tags", [])
    }
    meta = dict(meta)
    meta["merge_field_em_tag"] = _tem_tag_por_merge_field(ctx)
    return idx, meta

def tags(loc: str, termo: str | None = None, snapshot: str | None = None) -> dict:
    """Tags da subconta, ao vivo, cruzadas com os workflows que as citam."""
    args = ["tags", "-l", loc]
    if termo:
        args += ["--termo", termo]
    vivo = base._run_extractor(*args, "--json") or {}
    idx, meta = _impacto_tags(loc, snapshot)
    saida = []
    for t in vivo.get("tags", []):
        chave = (t.get("name") or "").strip().lower()
        achado = (idx or {}).get(chave, {"workflows": [], "papeis": []})
        saida.append({**t,
                      "workflows": None if idx is None else achado["workflows"],
                      "papeis": None if idx is None else achado["papeis"]})
    r: dict = {"total": len(saida), "tags": saida}
    if idx is None:
        r["aviso"] = ("sem dump desta subconta: a lista saiu sem a coluna de impacto. "
                      f"Rode uma extração para saber quais workflows citam cada tag "
                      f"({(meta or {}).get('motivo', '')})")
    else:
        r["_snapshot"] = meta
        if (meta or {}).get("merge_field_em_tag"):
            r["aviso"] = ("esta subconta tem step que escolhe a tag em tempo de execução, por "
                          "merge field (`customTags`): a contagem de workflows por tag é "
                          "incompleta por natureza, e nenhuma ferramenta consegue fechá-la")
    return r

def tag_acao(loc: str, acao: str, tag: str | None = None, nome: str | None = None,
             confirmo: bool = False, apagar_citada: bool = False,
             snapshot: str | None = None) -> dict:
    """ESCREVE: cria, renomeia ou apaga tag da subconta, com prévia e guarda."""
    if acao not in TAG_ACOES:
        raise ToolError(f"acao inválida: {acao}. Aceitas: {', '.join(TAG_ACOES)}")
    if acao == "criar" and not nome:
        raise ToolError("criar exige nome")
    if acao == "renomear" and not (tag and nome):
        raise ToolError("renomear exige tag e nome")
    if acao == "apagar" and not tag:
        raise ToolError("apagar exige tag")

    idx, _meta = _impacto_tags(loc, snapshot)
    citacao = (idx or {}).get((tag or "").strip().lower())
    # Renomear não precisa de guarda: o servidor reescreve a referência nos workflows,
    # inclusive no trigger (provado ao vivo em 2026-09-21). Apagar precisa: a tag sai de todos
    # os contatos, e se isso acorda automação de "tag removida" ninguém sabe.
    if acao == "apagar" and confirmo and citacao and citacao["workflows"] and not apagar_citada:
        raise ToolError(
            f"a tag \"{tag}\" é citada por {len(citacao['workflows'])} workflow(s) "
            f"({', '.join(citacao['workflows'][:5])}) nos papéis "
            f"{', '.join(citacao['papeis'])}. Apagar a tira de todos os contatos que a têm e "
            "pode disparar automação de tag removida. Repita com apagar_citada=true se é isso "
            "que você quer.")

    args = ["tag-acao", "-l", loc, "--acao", acao]
    for flag, val in (("--tag", tag), ("--nome", nome)):
        if val:
            args += [flag, val]
    if confirmo:
        args.append("--confirmo")
    return {"resultado": base._run_extractor(*args, "--json"),
            "citado_por": citacao["workflows"] if citacao else []}


TOOLS = {
    "tags": (tags, ("Tags da subconta, lidas AO VIVO e cruzadas com os workflows que citam cada uma "
             "(campo `workflows`) e em que papel (`papeis`: dispara, adiciona, remove, condicao). O "
             "cruzamento vem do dump, então `_snapshot` diz de quando ele é; sem dump a lista sai "
             "com `workflows: null` e um aviso. Workflow guarda o NOME da tag, nunca o id."),
             {"loc": _LOC,
              "termo": {"type": "string", "description": "filtra as tags por parte do nome"},
              "snapshot": _SNAP},
             ["loc"]),
    "tag_acao": (tag_acao,
                 ("ESCREVE EM PRODUÇÃO: cria, renomeia ou apaga uma tag da subconta. Sem confirmo=true "
                 "devolve a prévia. RENOMEAR é seguro: o servidor troca o nome dentro dos workflows "
                 "que citam a tag, inclusive no trigger. APAGAR é perigoso: arranca a tag de todos os "
                 "contatos que a têm, pode disparar automação de tag removida, e não há como saber "
                 "quantos contatos são — o GHL não expõe essa contagem. Apagar tag citada por "
                 "workflow exige apagar_citada=true."),
                 {"loc": _LOC,
                  "acao": {"type": "string", "enum": list(TAG_ACOES)},
                  "tag": {"type": "string", "description": "nome ou id da tag (renomear, apagar)"},
                  "nome": {"type": "string", "description": "nome novo (criar, renomear)"},
                  "confirmo": {"type": "boolean", "description": "true grava de verdade", "default": False},
                  "apagar_citada": {"type": "boolean",
                                    "description": "libera apagar tag citada por workflow", "default": False},
                  "snapshot": _SNAP},
                 ["loc", "acao"]),
}
