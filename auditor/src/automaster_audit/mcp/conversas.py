"""Conversas: leitura, busca, envio, anexo, rascunho, WhatsApp, IA/SLA e grupo."""
from __future__ import annotations

import json
from pathlib import Path
from . import base
from .base import CONVERSAS_CORPO, CONVERSAS_MAX_CHARS, ToolError, _LOC, _SNAP

def conversas(loc: str, id: str, max: int = 100, atividades: bool = False,
              tipo: str | None = None, busca: str | None = None, email: str | None = None,
              snapshot: str | None = None) -> dict:
    _, meta = base._load(loc, snapshot)
    args = ["conversas", "-l", loc, "-i", id, "--max", str(int(max))]
    if atividades:
        args.append("--atividades")
    if tipo:
        args += ["--tipo", tipo]
    if busca:
        args += ["--busca", busca]
    if email:
        args += ["--email", email]
    out = base._run_extractor(*args, "--json")

    todas = out.get("mensagens", [])
    kept, size = [], 0
    for m in todas:
        corpo = (m.get("corpo") or "").strip()
        m = m | {"corpo": corpo[:CONVERSAS_CORPO], "corpo_truncado": len(corpo) > CONVERSAS_CORPO}
        size += len(json.dumps(m, ensure_ascii=False))
        if kept and size > CONVERSAS_MAX_CHARS:
            break
        kept.append(m)
    out["mensagens"] = kept
    out["truncado"] = len(kept) < len(todas) or bool(out.get("maisPaginas"))
    return out | {"_snapshot": meta}

def conversas_buscar(loc: str, termo: str, max: int = 20, snapshot: str | None = None) -> dict:
    _, meta = base._load(loc, snapshot)
    out = base._run_extractor("conversas-buscar", "-l", loc, "--termo", termo, "--max", str(int(max)), "--json")
    return out | {"_snapshot": meta}

CONVERSA_ACOES = ("lida", "nao-lida", "estrela", "sem-estrela", "apagar",
                  "cancelar-agendada", "reenviar")

def conversa_acao(loc: str, acao: str, id: str | None = None, mensagem: str | None = None,
                  email: bool = False, confirmo: bool = False, snapshot: str | None = None) -> dict:
    if acao not in CONVERSA_ACOES:
        raise ToolError(f"acao inválida: {acao}. Aceitas: {', '.join(CONVERSA_ACOES)}")
    _, meta = base._load(loc, snapshot)
    if acao in ("cancelar-agendada", "reenviar"):
        if not mensagem:
            raise ToolError(f"{acao} exige mensagem=<messageId>")
        args = ["conversas-mensagem", "-l", loc, "--acao",
                "cancelar" if acao == "cancelar-agendada" else "reenviar", "--id", mensagem]
        if email:
            args.append("--email")
        return base._run_extractor(*args, "--json") | {"_snapshot": meta}

    if not id:
        raise ToolError(f"{acao} exige id=<contactId>")
    # apagar leva a conversa inteira junto: o GHL não apaga mensagem avulsa
    if acao == "apagar" and not confirmo:
        raise ToolError("apagar remove a conversa INTEIRA (todo o histórico com o contato) e não "
                        "tem desfazer. Repita com confirmo=true se é isso mesmo.")
    args = ["conversas-marcar", "-l", loc, "-i", id, "--acao", acao]
    if confirmo:
        args.append("--confirmo")
    return base._run_extractor(*args, "--json") | {"_snapshot": meta}

def rascunho(loc: str, id: str, acao: str = "listar", texto: str | None = None,
             canal: str = "sms", rascunho_id: str | None = None,
             snapshot: str | None = None) -> dict:
    if acao not in ("criar", "listar", "apagar"):
        raise ToolError(f"acao inválida: {acao}. Aceitas: criar, listar, apagar")
    if acao == "criar" and not texto:
        raise ToolError("criar exige texto")
    if acao == "apagar" and not rascunho_id:
        raise ToolError("apagar exige rascunho_id (vem do listar, campo _id)")
    _, meta = base._load(loc, snapshot)
    args = ["conversas-rascunho", "-l", loc, "-i", id, "--acao", acao, "--canal", canal]
    if texto:
        args += ["--texto", texto]
    if rascunho_id:
        args += ["--rascunho", rascunho_id]
    return base._run_extractor(*args, "--json") | {"_snapshot": meta}

WA_LEITURA = ("configurado", "numeros", "templates", "aprovados", "flows")

def whatsapp(loc: str, o: str = "templates", template: str | None = None,
             snapshot: str | None = None) -> dict:
    """Leitura do WhatsApp da subconta: templates, flows, números, estado."""
    if o not in WA_LEITURA:
        raise ToolError(f"o inválido: {o}. Aceitos: {', '.join(WA_LEITURA)}")
    _, meta = base._load(loc, snapshot)
    args = ["whatsapp", "-l", loc, "-o", o]
    if template:
        args += ["--template", template]
    return {"resultado": base._run_extractor(*args, "--json"), "_snapshot": meta}

def whatsapp_enviar(loc: str, id: str, template: str | None = None, flow: str | None = None,
                    corpo: str | None = None, cta: str | None = None, cabecalho: str | None = None,
                    rodape: str | None = None, de: str | None = None, para: str | None = None,
                    conversa: str | None = None, quando: str | None = None,
                    confirmo: bool = False, snapshot: str | None = None) -> dict:
    """ESCREVE: manda template aprovado ou flow por WhatsApp. Sai para o contato."""
    if not confirmo:
        raise ToolError("WhatsApp sai para uma pessoa de verdade e não tem desfazer. Repita com confirmo=true.")
    if bool(template) == bool(flow):
        raise ToolError("informe template OU flow, não os dois")
    if flow and not (corpo and cta):
        raise ToolError("flow exige corpo e cta")
    _, meta = base._load(loc, snapshot)
    args = ["whatsapp-enviar", "-l", loc, "-i", id, "--confirmo"]
    for flag, val in (("--template", template), ("--flow", flow), ("--corpo", corpo), ("--cta", cta),
                      ("--cabecalho", cabecalho), ("--rodape", rodape), ("--de", de), ("--para", para),
                      ("--conversa", conversa), ("--quando", quando)):
        if val:
            args += [flag, val]
    return base._run_extractor(*args, "--json") | {"_snapshot": meta}

CONFIG_LEITURA = ("ia", "sla", "sla-status", "sla-permissao")

CONFIG_ESCRITA = ("ia-gravar", "sla-gravar", "sla-zerar")

def config(loc: str, o: str = "sla", corpo: dict | None = None, conversa: str | None = None,
           confirmo: bool = False, snapshot: str | None = None) -> dict:
    """Configuração de IA e SLA das conversas. As escritas valem para a subconta inteira."""
    if o not in CONFIG_LEITURA + CONFIG_ESCRITA:
        raise ToolError(f"o inválido: {o}. Aceitos: {', '.join(CONFIG_LEITURA + CONFIG_ESCRITA)}")
    if o in CONFIG_ESCRITA and not confirmo:
        raise ToolError(f"{o} muda a configuração da subconta inteira e não tem desfazer. "
                        "Repita com confirmo=true.")
    _, meta = base._load(loc, snapshot)
    args = ["config", "-l", loc, "-o", o]
    if corpo is not None:
        args += ["--corpo", json.dumps(corpo)]
    if conversa:
        args += ["--conversa", conversa]
    if o in CONFIG_ESCRITA:
        args.append("--confirmo")
    return {"resultado": base._run_extractor(*args, "--json"), "_snapshot": meta}

GRUPO_OPS = ("criar", "mensagem", "interno-checar", "interno-participantes")

def grupo(loc: str, o: str, corpo: dict | None = None, conversa: str | None = None,
          usuarios: list | None = None, desde: str | None = None,
          confirmo: bool = False, snapshot: str | None = None) -> dict:
    """Group chat e chat interno. `criar` e `mensagem` falam com pessoas de verdade."""
    if o not in GRUPO_OPS:
        raise ToolError(f"o inválido: {o}. Aceitos: {', '.join(GRUPO_OPS)}")
    if o in ("criar", "mensagem") and not confirmo:
        raise ToolError(f"{o} fala com pessoas de verdade e não tem desfazer. Repita com confirmo=true.")
    _, meta = base._load(loc, snapshot)
    args = ["grupo", "-l", loc, "-o", o]
    if corpo is not None:
        args += ["--corpo", json.dumps(corpo)]
    if conversa:
        args += ["--conversa", conversa]
    for u in usuarios or []:
        args += ["--usuario", u]
    if desde:
        args += ["--desde", desde]
    if o in ("criar", "mensagem"):
        args.append("--confirmo")
    return {"resultado": base._run_extractor(*args, "--json"), "_snapshot": meta}

MAX_ANEXO_BYTES = 25 * 1024 * 1024

def anexar(loc: str, id: str, arquivos: list, conversa: str | None = None,
           grupo: bool = False, snapshot: str | None = None) -> dict:
    """Sobe arquivos locais como anexo da conversa. Não envia nada ao contato."""
    if not arquivos:
        raise ToolError("arquivos é obrigatório")
    for a in arquivos:
        f = Path(a).expanduser()
        if not f.exists():
            raise ToolError(f"arquivo não existe: {a}")
        if not f.is_file():
            raise ToolError(f"não é arquivo comum: {a}")
        size = f.stat().st_size
        if size > MAX_ANEXO_BYTES:
            raise ToolError(f"{a}: {size} bytes passa do teto de {MAX_ANEXO_BYTES}")
    _, meta = base._load(loc, snapshot)
    args = ["conversas-anexar", "-l", loc, "-i", id]
    for a in arquivos:
        args += ["--arquivo", str(Path(a).expanduser())]
    if conversa:
        args += ["--conversa", conversa]
    if grupo:
        args.append("--grupo")
    return base._run_extractor(*args, "--json") | {"_snapshot": meta}

SEND_TYPES = ("SMS", "Email", "WhatsApp", "IG", "FB", "Live_Chat", "Custom", "InternalComment")

def enviar(loc: str, id: str, tipo: str, texto: str, assunto: str | None = None,
           de: str | None = None, anexos: list | None = None, quando: str | None = None,
           confirmo: bool = False, snapshot: str | None = None) -> dict:
    escolhido = next((t for t in SEND_TYPES if t.lower() == str(tipo).lower()), None)
    if not escolhido:
        raise ToolError(f"tipo inválido: {tipo}. Aceitos: {', '.join(SEND_TYPES)}")
    # InternalComment fica na conversa e não sai; os outros vão para uma pessoa real
    if escolhido != "InternalComment" and not confirmo:
        raise ToolError(f"{escolhido} envia mensagem de verdade ao contato e não tem desfazer. "
                        "Repita com confirmo=true, ou use tipo='InternalComment' para uma nota interna.")
    if escolhido == "Email" and not assunto:
        raise ToolError("Email exige assunto")
    _, meta = base._load(loc, snapshot)
    args = ["conversas-enviar", "-l", loc, "-i", id, "--tipo", escolhido, "--texto", texto]
    if assunto:
        args += ["--assunto", assunto]
    if de:
        args += ["--de", de]
    for a in anexos or []:
        args += ["--anexo", a]
    if quando:
        if escolhido == "InternalComment":
            raise ToolError("InternalComment ignora agendamento: a nota sai na hora")
        args += ["--quando", quando]
    return base._run_extractor(*args, "--json") | {"_snapshot": meta}


# ---------------------------------------------------------------- protocolo


TOOLS = {
    "conversas": (conversas, "AO VIVO: abre Chrome e lê as mensagens trocadas com um contato (SMS, e-mail, "
                  "WhatsApp...). Cada mensagem traz tipo, direcao, autor e `origem` (app/workflow/campaign/api) — "
                  "é `origem` que diz se veio de automação. Corpo cortado em 400 chars; eventos de timeline "
                  "(ACTIVITY_*) ficam de fora salvo atividades=true.",
                  {"loc": _LOC, "id": {"type": "string", "description": "id do contato"},
                   "max": {"type": "integer", "default": 100},
                   "atividades": {"type": "boolean", "default": False},
                   "tipo": {"type": "string", "description": "filtra por tipo, string da API pública (TYPE_EMAIL, TYPE_SMS...)"},
                   "busca": {"type": "string", "description": "só as mensagens que casam com o termo"},
                   "email": {"type": "string", "description": "emailMessageId: devolve o e-mail completo em vez da lista"},
                   "snapshot": _SNAP},
                  ["loc", "id"]),
    "conversas_buscar": (conversas_buscar, "Procura um texto nas mensagens de TODA a subconta e devolve as "
                         "conversas que casaram, com contato e trecho. Serve para achar quem recebeu uma "
                         "mensagem específica.",
                         {"loc": _LOC, "termo": {"type": "string"}, "max": {"type": "integer", "default": 20},
                          "snapshot": _SNAP}, ["loc", "termo"]),
    "conversa_acao": (conversa_acao, "ESCREVE: age sobre a conversa de um contato (lida, nao-lida, estrela, "
                      "sem-estrela, apagar) ou sobre uma mensagem (cancelar-agendada, reenviar). `apagar` remove "
                      "a conversa INTEIRA — o GHL não apaga mensagem avulsa — e exige confirmo=true. As duas "
                      "ações de mensagem pedem mensagem=<messageId>.",
                      {"loc": _LOC, "acao": {"type": "string", "enum": list(CONVERSA_ACOES)},
                       "id": {"type": "string", "description": "id do contato (ações de conversa)"},
                       "mensagem": {"type": "string", "description": "messageId (cancelar-agendada, reenviar)"},
                       "email": {"type": "boolean", "default": False, "description": "o id é de e-mail"},
                       "confirmo": {"type": "boolean", "default": False}, "snapshot": _SNAP},
                      ["loc", "acao"]),
    "rascunho": (rascunho, "Rascunho de mensagem do contato: listar (default), criar, apagar. Rascunho fica "
                 "salvo na caixa do usuário e não sai para o contato.",
                 {"loc": _LOC, "id": {"type": "string", "description": "id do contato"},
                  "acao": {"type": "string", "enum": ["criar", "listar", "apagar"], "default": "listar"},
                  "texto": {"type": "string"}, "canal": {"type": "string", "default": "sms"},
                  "rascunho_id": {"type": "string", "description": "_id vindo do listar"}, "snapshot": _SNAP},
                 ["loc", "id"]),
    "enviar": (enviar, "ESCREVE EM PRODUÇÃO: envia mensagem ao contato pela conversa (SMS, Email, "
               "WhatsApp, InternalComment...). `InternalComment` é nota interna e NÃO sai para o contato — "
               "use para testar. Qualquer outro tipo exige confirmo=true, manda mensagem de verdade e não tem "
               "desfazer; fica um registro em <dumps>/_mensagens/. Email exige assunto.",
               {"loc": _LOC, "id": {"type": "string", "description": "id do contato"},
                "tipo": {"type": "string", "enum": list(SEND_TYPES)},
                "texto": {"type": "string", "description": "corpo da mensagem"},
                "assunto": {"type": "string"}, "de": {"type": "string", "description": "remetente (Email)"},
                "anexos": {"type": "array", "items": {"type": "string"}},
                "quando": {"type": "string", "description": "ISO para agendar o envio; InternalComment não aceita"},
                "confirmo": {"type": "boolean", "default": False,
                             "description": "obrigatório em tudo que não seja InternalComment"},
                "snapshot": _SNAP},
               ["loc", "id", "tipo", "texto"]),
    "anexar": (anexar, "Sobe arquivos locais como anexo da conversa e devolve as URLs para usar em "
               "`enviar(anexos=[...])`. NÃO fala com o contato — só cria os arquivos no CRM. Teto de 25 MB por "
               "arquivo; fica um registro em <dumps>/_anexos/.",
               {"loc": _LOC, "id": {"type": "string", "description": "id do contato"},
                "arquivos": {"type": "array", "items": {"type": "string"},
                             "description": "caminhos locais dos arquivos"},
                "conversa": {"type": "string", "description": "conversationId (default: a primeira do contato)"},
                "grupo": {"type": "boolean", "default": False, "description": "anexo de group chat"},
                "snapshot": _SNAP},
               ["loc", "id", "arquivos"]),
    "whatsapp": (whatsapp, "Leitura do WhatsApp da subconta (abre Chrome): `templates` (os componentes "
                 "inteiros), `aprovados` (só os liberados, formato de opção), `flows` (formulários "
                 "interativos), `numeros` (o id alimenta `de` no envio), `configurado`.",
                 {"loc": _LOC, "o": {"type": "string", "enum": list(WA_LEITURA), "default": "templates"},
                  "template": {"type": "string", "description": "um template só (com o=templates)"},
                  "snapshot": _SNAP}, ["loc"]),
    "whatsapp_enviar": (whatsapp_enviar, "ESCREVE EM PRODUÇÃO: manda um template aprovado ou um flow "
                        "interativo por WhatsApp. SAI para o contato, exige confirmo=true e não tem "
                        "desfazer; registro em <dumps>/_mensagens/. Use `template` OU `flow`; flow exige "
                        "corpo e cta.",
                        {"loc": _LOC, "id": {"type": "string", "description": "id do contato"},
                         "template": {"type": "string"}, "flow": {"type": "string"},
                         "corpo": {"type": "string"}, "cta": {"type": "string"},
                         "cabecalho": {"type": "string"}, "rodape": {"type": "string"},
                         "de": {"type": "string", "description": "fromNumberId"},
                         "para": {"type": "string"}, "conversa": {"type": "string"},
                         "quando": {"type": "string", "description": "ISO para agendar"},
                         "confirmo": {"type": "boolean", "default": False}, "snapshot": _SNAP},
                        ["loc", "id"]),
    "config": (config, "Configuração de IA e SLA das conversas: `ia`, `sla`, `sla-status` (o que está "
               "estourando agora), `sla-permissao`. As escritas (`ia-gravar`, `sla-gravar`, `sla-zerar`) "
               "valem para a subconta inteira, exigem confirmo=true e gravam o estado anterior em "
               "<dumps>/_config/.",
               {"loc": _LOC, "o": {"type": "string", "enum": list(CONFIG_LEITURA + CONFIG_ESCRITA), "default": "sla"},
                "corpo": {"type": "object", "description": "corpo da escrita"},
                "conversa": {"type": "string", "description": "conversationId (sla-zerar)"},
                "confirmo": {"type": "boolean", "default": False}, "snapshot": _SNAP}, ["loc"]),
    "grupo": (grupo, "Group chat e chat interno entre usuários. `criar` e `mensagem` falam com pessoas de "
              "verdade (confirmo=true, sem desfazer); `interno-checar` e `interno-participantes` ficam "
              "entre usuários. O corpo de `criar` NÃO foi confirmado ao vivo — passe o payload cru.",
              {"loc": _LOC, "o": {"type": "string", "enum": list(GRUPO_OPS)},
               "corpo": {"type": "object", "description": "payload cru"},
               "conversa": {"type": "string"},
               "usuarios": {"type": "array", "items": {"type": "string"}},
               "desde": {"type": "string", "description": "-1 tudo, 0 nada, YYYY-MM-DD a partir de"},
               "confirmo": {"type": "boolean", "default": False}, "snapshot": _SNAP}, ["loc", "o"]),
}
