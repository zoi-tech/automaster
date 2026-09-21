"""Servidor MCP (stdio, JSON-RPC) com as tools de consulta ao dump.

Importa o auditor como biblioteca: nunca lê os JSON do dump por conta própria.
Raiz dos dumps vem de AUTOMASTER_DUMPS (default ~/.automaster/dumps).
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from collections import Counter
from datetime import datetime, timezone
from functools import lru_cache
from html.parser import HTMLParser
from pathlib import Path
from urllib.request import Request, urlopen

from . import rules
from .dashboard import build_dashboard
from .diff import build_diff
from .journey import TriggerIndex, build_journey
from .loader import DumpContext, DumpError, load_dump
from .path_report import workflow_paths_lines
from .rules._helpers import email_template_id, steps_of_type
from .validacao_escrita import validar_edicao

PROTOCOL = "2025-06-18"
PATHS_MAX_CHARS = 6000  # ~1.500 tokens; a mediana do paths.md é 173 tok, o maior 18.665
CONVERSAS_MAX_CHARS = 30000  # ~7,5k tokens
CONVERSAS_CORPO = 400     # corpo de e-mail passa de 4 KB; o começo basta para reconhecer a mensagem
CONTATO_MAX_CHARS = 40000  # ~10k tokens; medido: ~180 tok/evento depois de tirar o ruído → ~55 eventos
CONTATO_NOISE = ("traceId", "commonPrimaryId", "_id", "shardId", "secondaryId", "apiVersion",
                 "chPublished", "externalChange")  # 40% do payload bruto, nada que o agente use
EXTRACTOR_DIR = Path(os.environ.get("CLAUDE_PLUGIN_ROOT") or Path(__file__).resolve().parents[3]) / "extractor"
FATIAS = ("workflows", "tags", "fields", "pipelines", "users", "calendars", "custom_values")


class ToolError(Exception):
    """Erro devolvido ao agente como isError, com texto que ensina o próximo passo."""


def _root() -> Path:
    return Path(os.environ.get("AUTOMASTER_DUMPS") or Path.home() / ".automaster" / "dumps")


def _manifest(p: Path) -> dict:
    try:
        return json.loads((p / "manifest.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def _snapshots(loc_dir: Path) -> list[str]:
    return sorted((d.name for d in loc_dir.iterdir() if (d / "manifest.json").is_file()), reverse=True)


def _snapshot(loc: str, snapshot: str | None = None) -> tuple[Path, dict]:
    loc_dir = _root() / loc
    if not loc_dir.is_dir():
        raise ToolError(f"subconta {loc!r} não tem dump em {_root()}; chame dumps() para ver as disponíveis "
                        "ou /automaster-extract para extrair")
    snaps = _snapshots(loc_dir)
    if not snaps:
        raise ToolError(f"subconta {loc!r} não tem snapshot com manifest.json")
    if snapshot and snapshot not in snaps:
        raise ToolError(f"snapshot {snapshot!r} não existe; disponíveis: {snaps}")
    path = loc_dir / (snapshot or snaps[0])
    extracted = _manifest(path).get("extractedAt", "")
    try:
        age = (datetime.now(timezone.utc) - datetime.fromisoformat(extracted.replace("Z", "+00:00"))).days
    except ValueError:
        age = -1
    return path, {"snapshot": path.name, "extractedAt": extracted, "idade_dias": age}


@lru_cache(maxsize=8)
def _ctx(path: str) -> DumpContext:
    try:
        return load_dump(Path(path))
    except DumpError as e:
        raise ToolError(str(e)) from e


def _load(loc: str, snapshot: str | None) -> tuple[DumpContext, dict]:
    path, meta = _snapshot(loc, snapshot)
    return _ctx(str(path)), meta


@lru_cache(maxsize=8)
def _dash(path: str) -> dict:
    return build_dashboard(_ctx(path))


@lru_cache(maxsize=8)
def _findings(path: str):
    return rules.run_all(_ctx(path))


@lru_cache(maxsize=8)
def _journey(path: str) -> dict:
    return build_journey(_ctx(path))


# ---------------------------------------------------------------- tools

def dumps() -> list[dict]:
    root = _root()
    if not root.is_dir():
        raise ToolError(f"raiz de dumps não existe: {root}; rode /automaster-extract")
    seen: dict[Path, dict] = {}
    for d in sorted(root.iterdir()):
        if not d.is_dir():
            continue
        snaps = _snapshots(d)
        if not snaps:
            continue
        real = d.resolve()
        m = _manifest(d / snaps[0])
        loc = m.get("locationId") or d.name
        entry = seen.setdefault(real, {"loc": loc, "nome": "", "snapshots": snaps,
                                       "extractedAt": m.get("extractedAt", "")})
        if d.name != loc:
            entry["nome"] = d.name
    return list(seen.values())


def inventario(loc: str, fatia: str | None = None, snapshot: str | None = None) -> dict:
    ctx, meta = _load(loc, snapshot)
    dash = _dash(str(ctx.path))
    if fatia is None:
        return {"summary": dash["summary"], "_snapshot": meta}
    if fatia not in FATIAS:
        raise ToolError(f"fatia {fatia!r} inválida; use uma de {FATIAS}")
    return {fatia: dash[fatia], "_snapshot": meta}


def workflow(loc: str, id: str, snapshot: str | None = None) -> dict:
    ctx, meta = _load(loc, snapshot)
    w = next((x for x in ctx.workflows if x.id == id), None)
    if w is None:
        hint = [x.id for x in ctx.workflows if id.lower() in (x.name or "").lower()]
        raise ToolError(f"workflow {id!r} não existe" + (f"; por nome, candidatos: {hint[:5]}" if hint else
                        "; use buscar(termo) ou inventario(fatia='workflows')"))
    dash = _dash(str(ctx.path))
    entry = next(e for e in dash["workflows"] if e["id"] == id)
    meta_wf = {k: entry[k] for k in ("id", "name", "status", "n_steps", "triggers", "channels",
                                     "n_tags", "n_fields", "calls", "called_by", "has_entry")}
    meta_wf["updatedAt"] = w.updated_at
    text = "\n".join(workflow_paths_lines(w, ctx))
    truncated = len(text) > PATHS_MAX_CHARS
    if truncated:
        text = text[:PATHS_MAX_CHARS].rsplit("\n", 1)[0] + "\n… (árvore truncada; abra paths.md para o resto)"
    achados = [_finding_dict(f) for f in _findings(str(ctx.path)) if f.workflow_id == id]
    return {"meta": meta_wf, "caminhos": text, "caminhos_truncado": truncated,
            "achados": achados, "_snapshot": meta}


def _finding_dict(f) -> dict:
    return {"rule": f.rule, "severity": f.severity, "workflow_id": f.workflow_id,
            "workflow": f.workflow_name, "detail": f.detail}


def achados(loc: str, severidade: str | None = None, snapshot: str | None = None) -> dict:
    ctx, meta = _load(loc, snapshot)
    all_f = _findings(str(ctx.path))
    counts = Counter({"ERROR": 0, "WARN": 0, "INFO": 0})
    counts.update(f.severity for f in all_f)
    if severidade and severidade not in counts:
        raise ToolError("severidade deve ser ERROR, WARN ou INFO")
    groups: dict[tuple, dict] = {}
    for f in all_f:
        if severidade and f.severity != severidade:
            continue
        g = groups.setdefault((f.rule, f.workflow_id, f.detail), {**_finding_dict(f), "n": 0})
        g["n"] += 1
    order = {"ERROR": 0, "WARN": 1, "INFO": 2}
    out = sorted(groups.values(), key=lambda g: (order[g["severity"]], g["rule"], g["workflow"] or ""))
    return {"counts": dict(counts), "achados": out, "_snapshot": meta}


def buscar(loc: str, termo: str, snapshot: str | None = None) -> dict:
    ctx, meta = _load(loc, snapshot)
    dash = _dash(str(ctx.path))
    q = termo.strip().lower()
    hit = lambda e: q in str(e.get("name", "")).lower() or q in str(e.get("token", "")).lower()
    out = {k: [e for e in dash[k] if hit(e)] for k in ("tags", "fields", "pipelines", "users", "custom_values")}
    out["workflows"] = [{"id": e["id"], "name": e["name"], "status": e["status"]}
                        for e in dash["workflows"] if hit(e)]
    out["_snapshot"] = meta
    return out


def _slim(n: dict, profundidade: int) -> dict:
    out = {k: n.get(k) for k in ("kind", "label", "detail", "flags", "conds")}
    if "ttype" in n:
        out["ttype"] = n["ttype"]
    out["n_filhos"] = len(n.get("children") or [])
    if profundidade > 1 and out["n_filhos"]:
        out["filhos"] = [_slim(c, profundidade - 1) for c in n["children"]]
    return out


def jornada(loc: str, caminho: list[int] | None = None, profundidade: int = 1,
            snapshot: str | None = None) -> dict:
    ctx, meta = _load(loc, snapshot)
    j = _journey(str(ctx.path))
    if not caminho:
        return {"criacao": [_slim(n, profundidade) for n in j["criacao"]],
                "anytime": [_slim(n, profundidade) for n in j["anytime"]], "_snapshot": meta}
    roots = j["criacao"] + j["anytime"]
    node, trail = None, []
    for i in caminho:
        kids = roots if node is None else node.get("children") or []
        if not isinstance(i, int) or not 0 <= i < len(kids):
            raise ToolError(f"caminho {caminho} inválido em {trail}: só há {len(kids)} filho(s)")
        node = kids[i]
        trail.append(i)
    return {"caminho": caminho, "no": _slim(node, 1) | {"n_filhos": len(node.get("children") or [])},
            "filhos": [_slim(c, profundidade) for c in node.get("children") or []], "_snapshot": meta}


def _head_tail(err: str | None, head: int = 2, tail: int = 600) -> str:
    """Linhas do `snapshot:` + começo + cauda do stderr.

    O `snapshot: <caminho>` é impresso ANTES das escritas e não pode sumir no
    truncamento de um stack trace longo. Contar linhas não basta: antes dele vêm
    "Capturando tokens..." e uma linha por refresh de token (cli.ts), então a
    posição varia — as linhas com `snapshot:` são preservadas por conteúdo."""
    lines = (err or "").strip().splitlines()
    if not lines:
        return "(stderr vazio)"
    guardadas = [l for l in lines[:head] if "snapshot:" not in l]
    guardadas += [l for l in lines if "snapshot:" in l]
    resto = "\n".join(l for l in lines if l not in guardadas)
    inicio = "\n".join(guardadas)
    return inicio if not resto else f"{inicio}\n[...]\n{resto[-tail:]}"


def _run_extractor(*args: str) -> dict:
    """Roda `tsx src/cli.ts <args>` no extractor (abre Chrome; espera segundos). Só a última linha do stdout é JSON."""
    if not args:
        raise ToolError("uso interno: _run_extractor exige ao menos o nome do subcomando")
    tsx = EXTRACTOR_DIR / "node_modules" / ".bin" / "tsx"
    if not tsx.is_file():
        raise ToolError("extractor não provisionado: rode /automaster-extract uma vez "
                        f"(npm ci + npx playwright install chromium em {EXTRACTOR_DIR})")
    # o processo MCP pode vir com PATH magro (app GUI): node do Homebrew e do nvm entram aqui
    extra = [str(p) for p in ("/opt/homebrew/bin", "/usr/local/bin", *Path.home().glob(".nvm/versions/node/*/bin"))]
    env = {**os.environ, "AUTOMASTER_DUMPS": str(_root()),
           "PATH": os.pathsep.join([os.environ.get("PATH", ""), *extra])}
    cmd = [str(tsx), "src/cli.ts", *args]
    try:
        r = subprocess.run(cmd, cwd=EXTRACTOR_DIR, capture_output=True, text=True, timeout=600, env=env)
    except subprocess.TimeoutExpired as e:
        dica_estado = ("confira o estado atual com a tool `formularios`, o=detalhe."
                       if args[0].startswith("formulario-") else
                       "confira o estado atual com a tool `workflows_ao_vivo` (ou `workflow_editar` "
                       "com acao='historico', que lista as versões gravadas)."
                       if args[0].startswith("workflow") else
                       "confira o estado atual com a tool `contato`.")
        raise ToolError(
            f"{args[0]} estourou 600 s e foi morto — provável login manual pendente na janela do Chrome. "
            "A escrita PODE ter sido aplicada (o processo pode ter morrido entre o PUT e a marcação do "
            f"snapshot): {dica_estado} "
            + _head_tail(e.stderr if isinstance(e.stderr, str) else (e.stderr or b"").decode("utf-8", "replace"))
        ) from e
    if r.returncode != 0 or not r.stdout.strip():
        # A dica de rastro só faz sentido quando havia escrita para ser aplicada. Numa prévia
        # recusada ela dizia que produção podia ter mudado, e não podia. `contato-editar` é a
        # exceção: grava direto, não tem prévia.
        gravava = "--confirmo" in args or args[0] == "contato-editar"
        dica = "" if not gravava else (
               " A escrita pode ter sido parcialmente aplicada: confira o estado atual com a tool `formularios`, o=detalhe."
                if args[0].startswith("formulario-") else
                " A escrita pode ter sido parcialmente aplicada: confira o estado atual com a tool "
                "`workflows_ao_vivo`, ou `workflow_editar` com acao='historico'."
                if args[0].startswith("workflow") else
                " A escrita pode ter sido parcialmente aplicada: confira o estado atual com a tool `contato`."
                if args[0] == "contato-editar" else "")
        raise ToolError(f"{args[0]} falhou (código {r.returncode}): {_head_tail(r.stderr)}{dica}")
    return json.loads(r.stdout.strip().splitlines()[-1])


def _run_timeline(loc: str, id: str, days: int) -> dict:
    return _run_extractor("timeline", "-l", loc, "-i", id, "-d", str(days), "--json")


def contato(loc: str, id: str, days: int = 60, ate: str | None = None, snapshot: str | None = None) -> dict:
    _, meta = _load(loc, snapshot)
    events = [{k: v for k, v in e.items() if k not in CONTATO_NOISE}
              for e in _run_timeline(loc, id, int(days))["events"]]
    events.sort(key=lambda e: str(e.get("createdAt", "")), reverse=True)
    if ate:
        events = [e for e in events if str(e.get("createdAt", "")) < ate]
    kept, size = [], 0
    for e in events:
        size += len(json.dumps(e, ensure_ascii=False))
        if kept and size > CONTATO_MAX_CHARS:
            break
        kept.append(e)
    truncated = len(kept) < len(events)
    return {"id": id, "days": days, "n_total": len(events), "eventos": kept, "truncado": truncated,
            "proximo_ate": kept[-1].get("createdAt") if truncated else None, "_snapshot": meta}


def conversas(loc: str, id: str, max: int = 100, atividades: bool = False,
              tipo: str | None = None, busca: str | None = None, email: str | None = None,
              snapshot: str | None = None) -> dict:
    _, meta = _load(loc, snapshot)
    args = ["conversas", "-l", loc, "-i", id, "--max", str(int(max))]
    if atividades:
        args.append("--atividades")
    if tipo:
        args += ["--tipo", tipo]
    if busca:
        args += ["--busca", busca]
    if email:
        args += ["--email", email]
    out = _run_extractor(*args, "--json")

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


def editar(loc: str, id: str, set: dict | None = None, tags_adicionar: list | None = None,
           tags_remover: list | None = None, snapshot: str | None = None) -> dict:
    set, tags_adicionar, tags_remover = set or {}, tags_adicionar or [], tags_remover or []
    if not (set or tags_adicionar or tags_remover):
        raise ToolError("nada a fazer: passe set={campo: valor} e/ou tags_adicionar/tags_remover")
    ctx, meta = _load(loc, snapshot)
    args = ["contato-editar", "-l", loc, "-i", id]
    for k, v in set.items():
        args += ["--set", f"{k}={v}"]
    args += [x for t in tags_adicionar for x in ("--tag", f"+{t}")]
    args += [x for t in tags_remover for x in ("--tag", f"-{t}")]
    out = _run_extractor(*args, "--json")

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


def conversas_buscar(loc: str, termo: str, max: int = 20, snapshot: str | None = None) -> dict:
    _, meta = _load(loc, snapshot)
    out = _run_extractor("conversas-buscar", "-l", loc, "--termo", termo, "--max", str(int(max)), "--json")
    return out | {"_snapshot": meta}


CONVERSA_ACOES = ("lida", "nao-lida", "estrela", "sem-estrela", "apagar",
                  "cancelar-agendada", "reenviar")


def conversa_acao(loc: str, acao: str, id: str | None = None, mensagem: str | None = None,
                  email: bool = False, confirmo: bool = False, snapshot: str | None = None) -> dict:
    if acao not in CONVERSA_ACOES:
        raise ToolError(f"acao inválida: {acao}. Aceitas: {', '.join(CONVERSA_ACOES)}")
    _, meta = _load(loc, snapshot)
    if acao in ("cancelar-agendada", "reenviar"):
        if not mensagem:
            raise ToolError(f"{acao} exige mensagem=<messageId>")
        args = ["conversas-mensagem", "-l", loc, "--acao",
                "cancelar" if acao == "cancelar-agendada" else "reenviar", "--id", mensagem]
        if email:
            args.append("--email")
        return _run_extractor(*args, "--json") | {"_snapshot": meta}

    if not id:
        raise ToolError(f"{acao} exige id=<contactId>")
    # apagar leva a conversa inteira junto: o GHL não apaga mensagem avulsa
    if acao == "apagar" and not confirmo:
        raise ToolError("apagar remove a conversa INTEIRA (todo o histórico com o contato) e não "
                        "tem desfazer. Repita com confirmo=true se é isso mesmo.")
    args = ["conversas-marcar", "-l", loc, "-i", id, "--acao", acao]
    if confirmo:
        args.append("--confirmo")
    return _run_extractor(*args, "--json") | {"_snapshot": meta}


def rascunho(loc: str, id: str, acao: str = "listar", texto: str | None = None,
             canal: str = "sms", rascunho_id: str | None = None,
             snapshot: str | None = None) -> dict:
    if acao not in ("criar", "listar", "apagar"):
        raise ToolError(f"acao inválida: {acao}. Aceitas: criar, listar, apagar")
    if acao == "criar" and not texto:
        raise ToolError("criar exige texto")
    if acao == "apagar" and not rascunho_id:
        raise ToolError("apagar exige rascunho_id (vem do listar, campo _id)")
    _, meta = _load(loc, snapshot)
    args = ["conversas-rascunho", "-l", loc, "-i", id, "--acao", acao, "--canal", canal]
    if texto:
        args += ["--texto", texto]
    if rascunho_id:
        args += ["--rascunho", rascunho_id]
    return _run_extractor(*args, "--json") | {"_snapshot": meta}


WA_LEITURA = ("configurado", "numeros", "templates", "aprovados", "flows")


def whatsapp(loc: str, o: str = "templates", template: str | None = None,
             snapshot: str | None = None) -> dict:
    """Leitura do WhatsApp da subconta: templates, flows, números, estado."""
    if o not in WA_LEITURA:
        raise ToolError(f"o inválido: {o}. Aceitos: {', '.join(WA_LEITURA)}")
    _, meta = _load(loc, snapshot)
    args = ["whatsapp", "-l", loc, "-o", o]
    if template:
        args += ["--template", template]
    return {"resultado": _run_extractor(*args, "--json"), "_snapshot": meta}


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
    _, meta = _load(loc, snapshot)
    args = ["whatsapp-enviar", "-l", loc, "-i", id, "--confirmo"]
    for flag, val in (("--template", template), ("--flow", flow), ("--corpo", corpo), ("--cta", cta),
                      ("--cabecalho", cabecalho), ("--rodape", rodape), ("--de", de), ("--para", para),
                      ("--conversa", conversa), ("--quando", quando)):
        if val:
            args += [flag, val]
    return _run_extractor(*args, "--json") | {"_snapshot": meta}


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
    _, meta = _load(loc, snapshot)
    args = ["config", "-l", loc, "-o", o]
    if corpo is not None:
        args += ["--corpo", json.dumps(corpo)]
    if conversa:
        args += ["--conversa", conversa]
    if o in CONFIG_ESCRITA:
        args.append("--confirmo")
    return {"resultado": _run_extractor(*args, "--json"), "_snapshot": meta}


GRUPO_OPS = ("criar", "mensagem", "interno-checar", "interno-participantes")


def grupo(loc: str, o: str, corpo: dict | None = None, conversa: str | None = None,
          usuarios: list | None = None, desde: str | None = None,
          confirmo: bool = False, snapshot: str | None = None) -> dict:
    """Group chat e chat interno. `criar` e `mensagem` falam com pessoas de verdade."""
    if o not in GRUPO_OPS:
        raise ToolError(f"o inválido: {o}. Aceitos: {', '.join(GRUPO_OPS)}")
    if o in ("criar", "mensagem") and not confirmo:
        raise ToolError(f"{o} fala com pessoas de verdade e não tem desfazer. Repita com confirmo=true.")
    _, meta = _load(loc, snapshot)
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
    return {"resultado": _run_extractor(*args, "--json"), "_snapshot": meta}


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
    _, meta = _load(loc, snapshot)
    args = ["conversas-anexar", "-l", loc, "-i", id]
    for a in arquivos:
        args += ["--arquivo", str(Path(a).expanduser())]
    if conversa:
        args += ["--conversa", conversa]
    if grupo:
        args.append("--grupo")
    return _run_extractor(*args, "--json") | {"_snapshot": meta}


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
    _, meta = _load(loc, snapshot)
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
    return _run_extractor(*args, "--json") | {"_snapshot": meta}


# ---------------------------------------------------------------- protocolo

_LOC = {"type": "string", "description": "locationId da subconta"}
_SNAP = {"type": "string", "description": "snapshot YYYY-MM-DD_HHmm (default: mais recente)"}
WF_LEITURA = ("lista", "dentro", "contato")
WF_ACOES = ("publicar", "inscrever", "remover", "retomar")
WF_STATUS = ("published", "draft", "locked", "paused")
OPP_LEITURA = ("pipelines", "listar", "buscar", "ver")
OPP_ACOES = ("criar", "editar", "mover", "status", "apagar", "restaurar")
PIPE_ACOES = ("criar", "editar", "apagar")
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
    _, meta = _load(loc, snapshot)
    args = ["formularios", "-l", loc, "-o", o, "--tipo", tipo]
    for flag, val in (("-i", id), ("--formulario", formulario), ("--termo", termo),
                      ("--inicio", inicio), ("--fim", fim),
                      ("--limite", str(limite) if limite else None),
                      ("--pagina", str(pagina) if pagina else None)):
        if val:
            args += [flag, val]
    return {"resultado": _run_extractor(*args, "--json"), "_snapshot": meta}


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
    _, meta = _load(loc, snapshot)
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
    return _run_extractor(*args, "--json") | {"_snapshot": meta}


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
    _, meta = _load(loc, snapshot)
    args = ["formulario-estilo", "-l", loc,
            "--acao", "aplicar" if acao == "previa" else acao, "--tipo", tipo]
    if escreve:
        args.append("--confirmo")
    for flag, val in (("-i", id), ("--versao", versao), ("--saida", saida)):
        if val:
            args += [flag, val]
    if tokens:
        args += ["--tokens", json.dumps(tokens)]
    return _run_extractor(*args, "--json") | {"_snapshot": meta}


ANOTACAO_LEITURA = ("lista", "detalhe", "buscar")
ANOTACAO_ACOES = ("criar", "editar", "apagar", "concluir", "reabrir")
ANOTACAO_TIPOS = ("nota", "tarefa")


def anotacoes(loc: str, o: str = "lista", tipo: str = "nota", contato: str | None = None,
              id: str | None = None, dono: str | None = None, concluidas: bool | None = None,
              termo: str | None = None, limite: int | None = None) -> dict:
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
    for flag, val in (("--contato", contato), ("-i", id), ("--dono", dono),
                      ("--termo", termo),
                      ("--concluidas", None if concluidas is None else str(concluidas).lower()),
                      ("--limite", str(limite) if limite else None)):
        if val:
            args += [flag, val]
    return {"resultado": _run_extractor(*args, "--json")}


def anotacao_acao(loc: str, acao: str, contato: str, tipo: str = "nota", id: str | None = None,
                  texto: str | None = None, titulo: str | None = None, prazo: str | None = None,
                  dono: str | None = None, confirmo: bool = False) -> dict:
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
    for flag, val in (("-i", id), ("--texto", texto), ("--titulo", titulo),
                      ("--prazo", prazo), ("--dono", dono)):
        if val:
            args += [flag, val]
    if confirmo:
        args.append("--confirmo")
    return {"resultado": _run_extractor(*args, "--json")}


def oportunidades(loc: str, o: str = "pipelines", id: str | None = None,
                  pipeline: str | None = None, estagio: str | None = None,
                  status: str | None = None, contato: str | None = None,
                  termo: str | None = None, limite: int | None = None,
                  pagina: int | None = None, snapshot: str | None = None) -> dict:
    """Leitura ao vivo de pipelines e oportunidades da subconta."""
    if o not in OPP_LEITURA:
        raise ToolError(f"o inválido: {o}. Aceitos: {', '.join(OPP_LEITURA)}")
    if o == "ver" and not id:
        raise ToolError("o=ver exige id da oportunidade")
    if o == "buscar" and not termo:
        raise ToolError("o=buscar exige termo")
    _, meta = _load(loc, snapshot)
    args = ["oportunidades", "-l", loc, "-o", o]
    for flag, val in (("-i", id), ("--pipeline", pipeline), ("--estagio", estagio),
                      ("--status", status), ("--contato", contato), ("--termo", termo),
                      ("--limite", str(limite) if limite else None),
                      ("--pagina", str(pagina) if pagina else None)):
        if val:
            args += [flag, val]
    return {"resultado": _run_extractor(*args, "--json"), "_snapshot": meta}


def oportunidade_acao(loc: str, acao: str, id: str | None = None, pipeline: str | None = None,
                      estagio: str | None = None, nome: str | None = None,
                      valor: float | None = None, status: str | None = None,
                      contato: str | None = None, dono: str | None = None,
                      fechamento: str | None = None, probabilidade: float | None = None,
                      campos: list | None = None,
                      confirmo: bool = False, snapshot: str | None = None) -> dict:
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
        raise ToolError("não dá para trocar o contato de uma oportunidade: o vínculo se define "
                        "quando o card nasce. Crie outro card para a pessoa certa.")
    _, meta = _load(loc, snapshot)
    args = ["oportunidade-acao", "-l", loc, "--acao", acao, "--confirmo"]
    for flag, val in (("-i", id), ("--pipeline", pipeline), ("--estagio", estagio),
                      ("--nome", nome), ("--valor", str(valor) if valor is not None else None),
                      ("--status", status), ("--contato", contato), ("--dono", dono),
                      ("--fechamento", fechamento),
                      ("--probabilidade", str(probabilidade) if probabilidade is not None else None)):
        if val:
            args += [flag, val]
    if campos:
        args += ["--campos", json.dumps(campos)]
    return _run_extractor(*args, "--json") | {"_snapshot": meta}


def pipeline(loc: str, acao: str, id: str | None = None, nome: str | None = None,
             estagios: list | None = None, confirmo: bool = False,
             apagar_com_cards: bool = False, snapshot: str | None = None) -> dict:
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
        raise ToolError("estagios é obrigatório e precisa trazer a lista COMPLETA dos estágios "
                        "que devem existir depois — estágio ausente da lista é removido")
    _, meta = _load(loc, snapshot)
    args = ["pipeline", "-l", loc, "--acao", acao, "--confirmo"]
    for flag, val in (("-i", id), ("--nome", nome)):
        if val:
            args += [flag, val]
    if estagios:
        args += ["--estagios", json.dumps(estagios)]
    if apagar_com_cards:
        args += ["--apagar-com-cards"]
    return _run_extractor(*args, "--json") | {"_snapshot": meta}


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
    _, meta = _load(loc, snapshot)
    args = ["agenda", "-l", loc, "-o", o]
    for flag, val in (("-i", id), ("--calendario", calendario), ("--usuario", usuario),
                      ("--grupo", grupo), ("--contato", contato), ("--inicio", inicio),
                      ("--fim", fim), ("--timezone", timezone),
                      ("--limite", str(limite) if limite else None),
                      ("--pagina", str(pagina) if pagina else None)):
        if val:
            args += [flag, val]
    return {"resultado": _run_extractor(*args, "--json"), "_snapshot": meta}


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
    _, meta = _load(loc, snapshot)
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
    return _run_extractor(*args, "--json") | {"_snapshot": meta}


def workflows_ao_vivo(loc: str, o: str = "lista", id: str | None = None,
                      contato: str | None = None, limite: int | None = None,
                      nomes: bool = False) -> dict:
    """Leitura ao vivo de workflows e inscrições. Não usa o dump."""
    if o not in WF_LEITURA:
        raise ToolError(f"o inválido: {o}. Aceitos: {', '.join(WF_LEITURA)}")
    if o == "dentro" and not id:
        raise ToolError("o=dentro exige o id do workflow")
    if o == "contato" and not contato:
        raise ToolError("o=contato exige o contato")
    args = ["workflows-ao-vivo", "-l", loc, "-o", o]
    for flag, val in (("-i", id), ("--contato", contato),
                      ("--limite", str(limite) if limite else None)):
        if val:
            args += [flag, val]
    if nomes:
        args += ["--nomes"]
    return _run_extractor(*args, "--json")


def workflow_acao(loc: str, acao: str, id: str, contato: str | None = None,
                  inscricao: str | None = None, status: str | None = None,
                  usuario: str | None = None, inicio: str | None = None,
                  confirmo: bool = False) -> dict:
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
    for flag, val in (("--contato", contato), ("--inscricao", inscricao),
                      ("--status", status), ("--usuario", usuario), ("--inicio", inicio)):
        if val:
            args += [flag, val]
    return _run_extractor(*args, "--json")


def comparar(loc: str, antes: str | None = None, depois: str | None = None) -> dict:
    path_ultimo, _ = _snapshot(loc)  # valida a subconta e a raiz
    snaps = _snapshots(path_ultimo.parent)
    if len(snaps) < 2 and not (antes and depois):
        raise ToolError(f"subconta {loc!r} só tem {len(snaps)} snapshot; o diff precisa de dois")
    # _snapshots vem do mais recente para o mais antigo
    ctx_depois, meta_depois = _load(loc, depois or snaps[0])
    ctx_antes, meta_antes = _load(loc, antes or snaps[1])
    diff = build_diff(ctx_antes, ctx_depois)
    diff["_snapshot"] = {"antes": meta_antes, "depois": meta_depois}
    return diff


MODELOS_OP = ("lista", "usos", "conteudo")

# O `token` do previewUrl é dispensável (medido ao vivo) e troca a cada vez que o arquivo é
# sobrescrito, então a URL é remontada a partir do id do snapshot corrente.
_EMAIL_URL = ("https://firebasestorage.googleapis.com/v0/b/highlevel-backend.appspot.com/o/"
              "location%2F{loc}%2Femails%2F{tid}%2Findex.html?alt=media")

_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36")


def _ler_url(url: str) -> bytes:
    """Isolada para o teste trocar. Única ida à rede do servidor: URL pública, sem credencial."""
    with urlopen(Request(url, headers={"user-agent": _UA}), timeout=20) as r:  # noqa: S310
        return r.read()


class _Texto(HTMLParser):
    """Texto visível e hrefs de um HTML de e-mail; o markup inteiro é grande demais."""

    def __init__(self) -> None:
        super().__init__()
        self.partes: list[str] = []
        self.links: list[str] = []
        self._pular = False

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self._pular = True
        if tag == "a":
            href = dict(attrs).get("href")
            if href:
                self.links.append(href)

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self._pular = False

    def handle_data(self, data):
        if not self._pular and data.strip():
            self.partes.append(data.strip())


def modelos_email(loc: str, o: str = "lista", id: str | None = None,
                  snapshot: str | None = None) -> dict:
    if o not in MODELOS_OP:
        raise ToolError(f"operação {o!r} inválida; use uma de {MODELOS_OP}")
    ctx, meta = _load(loc, snapshot)

    if o == "lista":
        modelos = [
            {"id": str(b.get("id")), "nome": b.get("name"), "pasta": b.get("parentId"),
             "criado": b.get("dateAdded"), "alterado": b.get("lastUpdated"),
             "texto_puro": b.get("isPlainText")}
            for b in ctx.email_templates
        ]
        return {"modelos": modelos, "_snapshot": meta}

    if o == "usos":
        usos: dict[str, list[dict]] = {}
        for wf, step in steps_of_type(ctx, "email"):
            tid = email_template_id(step)
            if not tid:
                continue
            usos.setdefault(tid, []).append({
                "workflow": wf.name, "step": step.get("name", step.get("type")),
                "assunto": (step.get("attributes") or {}).get("subject", ""),
            })
        conhecidos = {str(b.get("id")) for b in ctx.email_templates}
        return {"usos": usos, "sem_uso": sorted(conhecidos - set(usos)),
                "fora_do_builder": sorted(set(usos) - conhecidos), "_snapshot": meta}

    if not id:
        raise ToolError("conteudo exige `id`; pegue um com a operação `lista` ou `usos`")
    location_id = ctx.manifest.get("locationId", loc)
    p = _Texto()
    p.feed(_ler_url(_EMAIL_URL.format(loc=location_id, tid=id)).decode("utf-8", "replace"))
    return {"id": id, "texto": "\n".join(p.partes), "links": p.links, "_snapshot": meta}


WF_EDITAR_ACOES = (
    "criar", "renomear", "mover", "duplicar", "apagar",
    "trocar-ref", "trocar-tag", "limpar-orfaos", "atributo", "trigger", "historico",
    "step-criar", "step-remover", "step-mover",
)

# ações que mexem no corpo do workflow e por isso passam pela validação das 18 regras
_WF_EDITAR_COM_CORPO = {
    "trocar-ref", "trocar-tag", "limpar-orfaos", "atributo", "trigger",
    "step-criar", "step-remover", "step-mover",
}


def workflow_editar(loc: str, acao: str, id: str | None = None, nome: str | None = None,
                    pasta: str | None = None, de: str | None = None, para: str | None = None,
                    step: str | None = None, caminho: str | None = None, valor: str | None = None,
                    trigger_acao: str | None = None,
                    trigger_id: str | None = None, trigger_corpo: dict | str | None = None,
                    corpo: dict | str | None = None, depois_de: str | None = None,
                    ramos: list | str | None = None,
                    com_subarvore: bool = False, confirmo: bool = False,
                    publicado: bool = False, snapshot: str | None = None) -> dict:
    """ESCREVE workflow ao vivo. Sem `confirmo`, devolve a prévia com o diff.

    Para ação que mexe no corpo, roda SEMPRE a prévia primeiro e valida o documento
    editado contra as 18 regras (`validar_edicao`) antes de decidir se grava. Sem dump em
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
    # e o editor abre em branco. O erro sai aqui, antes de abrir o Chrome à toa.
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
        # Esta porta É a guarda das 18 regras: a camada crua recusa gravar sem esta flag,
        # justamente para que ninguém passe por fora dela sem querer.
        if com_confirmo:
            a.append("--sem-regras")
        # Apagar trigger não mexe no `version`, então a guarda de concorrência do caminho de
        # trigger é a lista de ids que a prévia viu, não a versão.
        if triggers:
            a += ["--triggers-esperados", ",".join(str(t) for t in triggers)]
        # I1: a prévia e a gravação são dois processos, com um Chrome subindo no meio. Sem
        # carregar a `version` que a prévia viu, a guarda de concorrência só enxerga o que
        # acontece DENTRO da segunda invocação, e a janela entre as duas fica descoberta.
        if versao is not None:
            a += ["--versao-esperada", str(versao)]
        for flag, valor_opcional in (
            ("-i", id), ("--nome", nome), ("--pasta", pasta), ("--de", de), ("--para", para),
            ("--step", step), ("--caminho", caminho), ("--valor", valor),
            ("--trigger-acao", trigger_acao), ("--trigger-id", trigger_id),
            ("--trigger-corpo", trigger_corpo),
            ("--corpo", corpo), ("--depois-de", depois_de), ("--ramos", ramos),
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
        return _run_extractor(*_args(confirmo))

    # O dump é checado ANTES da prévia: a prévia abre o Chrome inteiro, e workflow
    # recém-criado ou duplicado não está em dump nenhum — não pode virar exceção crua
    # depois de todo esse trabalho.
    ctx = meta = None
    sem_validacao = None
    try:
        ctx, meta = _load(loc, snapshot)
    except ToolError:
        sem_validacao = "sem dump desta subconta em disco: as 18 regras não foram rodadas"
    if ctx is not None and not any(
        getattr(w, "id", None) == id for w in getattr(ctx, "workflows", [])
    ):
        sem_validacao = (
            f"workflow {id} não está no dump {meta['snapshot']} (criado ou duplicado depois da "
            "última extração): as 18 regras não foram rodadas. Extraia a subconta de novo para validar."
        )
        ctx = None

    previa = _run_extractor(*_args(False))
    # M3: o documento inteiro do workflow não volta para o contexto do modelo. Ele existe
    # para a validação local, e só.
    documento = previa.pop("documento", None)
    versao = previa.get("versao")
    triggers_antes = previa.get("triggersAntes")

    if ctx is None:
        previa["validacao"] = {"rodou": False, "motivo": sem_validacao}
        if not confirmo:
            return previa
        # a falta de dump não pode travar a escrita
        resultado = _run_extractor(*_args(True, versao, triggers_antes))
        resultado["validacao"] = previa["validacao"]
        return resultado

    if documento is None:
        # nada a validar (ex: "nada a mudar: a operação não encontrou alvo"). Mesmo aqui a
        # resposta diz que as regras não rodaram: ausência silenciosa da chave `validacao`
        # se lê como "validou e passou".
        previa["validacao"] = {
            "rodou": False,
            "motivo": "a prévia não devolveu documento para validar (nada a mudar): as 18 regras não foram rodadas",
        }
        if not confirmo:
            return previa
        resultado = _run_extractor(*_args(True, versao, triggers_antes))
        resultado["validacao"] = previa["validacao"]
        return resultado

    try:
        resultado_validacao = validar_edicao(ctx, id, documento, previa.get("triggers"))
    except ValueError as e:
        previa["validacao"] = {"rodou": False, "motivo": str(e)}
        if not confirmo:
            return previa
        resultado = _run_extractor(*_args(True, versao, triggers_antes))
        resultado["validacao"] = previa["validacao"]
        return resultado

    validacao = {
        "rodou": True,
        "snapshot": meta["snapshot"],
        "pode_gravar": resultado_validacao.pode_gravar,
        "erros_novos": resultado_validacao.erros_novos,
        "erros_resolvidos": resultado_validacao.erros_resolvidos,
        "aviso": f"as regras rodaram contra o dump {meta['snapshot']}; ele pode estar velho",
    }
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
        previa["motivo"] = (
            "gravação recusada: a validação contra as 18 regras encontrou erro novo — "
            + "; ".join(resultado_validacao.erros_novos)
        )
        return previa

    resultado = _run_extractor(*_args(True, versao, triggers_antes))
    resultado["validacao"] = validacao
    return resultado


TOOLS = {
    "comparar": (comparar, "Diff entre dois snapshots da mesma subconta: workflows adicionados/removidos/"
                 "alterados (nome, status, steps, triggers) e entidades que entraram ou sumiram. Sem antes/depois, "
                 "compara os dois mais recentes. Só lê o disco.",
                 {"loc": _LOC, "antes": {"type": "string", "description": "snapshot mais antigo (default: o penúltimo)"},
                  "depois": {"type": "string", "description": "snapshot mais recente (default: o último)"}}, ["loc"]),
    "modelos_email": (modelos_email,
                      "DO DUMP: templates do email builder. `lista` (id, nome, pasta, datas), "
                      "`usos` (qual workflow e step cita cada um, quais ninguém usa, quais o "
                      "builder não tem) e `conteudo` (texto e links de um template, baixado na "
                      "hora). Não é o corpo de e-mail de uma conversa — para isso use `conversas`.",
                      {"loc": _LOC, "o": {"type": "string", "enum": list(MODELOS_OP)},
                       "id": {"type": "string", "description": "template, obrigatório em `conteudo`"},
                       "snapshot": _SNAP}, ["loc"]),
    "dumps": (dumps, "Lista subcontas com dump, snapshots e data. ~200 tokens.", {}, []),
    "inventario": (inventario, "summary (~80 tokens) ou uma fatia: workflows, tags, fields, pipelines, "
                   "users, calendars, custom_values (até ~20k tokens).",
                   {"loc": _LOC, "fatia": {"type": "string", "enum": list(FATIAS)}, "snapshot": _SNAP}, ["loc"]),
    "workflow": (workflow, "DO DUMP (pode estar velho; para o estado corrente use `workflows_ao_vivo`): "
                 "meta, árvore de caminhos (teto ~1.5k tokens, flag caminhos_truncado) e achados de um workflow.",
                 {"loc": _LOC, "id": {"type": "string"}, "snapshot": _SNAP}, ["loc", "id"]),
    "achados": (achados, "Achados agrupados por (rule, workflow, detail) com n; counts por severidade sempre.",
                {"loc": _LOC, "severidade": {"type": "string", "enum": ["ERROR", "WARN", "INFO"]}, "snapshot": _SNAP}, ["loc"]),
    "buscar": (buscar, "Termo em tags (com papeis: dispara/adiciona/remove/condicao), fields, pipelines, users, "
               "custom values e nomes de workflow.",
               {"loc": _LOC, "termo": {"type": "string"}, "snapshot": _SNAP}, ["loc", "termo"]),
    "jornada": (jornada, "Um nível da árvore de jornada por chamada (~60 tokens/nó). caminho é posicional, "
                "ex. [0,3,1], sobre criacao+anytime; profundidade expande filhos.",
                {"loc": _LOC, "caminho": {"type": "array", "items": {"type": "integer"}},
                 "profundidade": {"type": "integer", "default": 1}, "snapshot": _SNAP}, ["loc"]),
    "contato": (contato, "AO VIVO: abre Chrome e pagina o audit log do contato (~10 s logado, exige setup do "
                "extractor). Eventos mais recentes primeiro (~155 tokens cada), sourceWorkflowName resolvido; teto ~10k tokens, "
                "pagine com ate=proximo_ate.",
                {"loc": _LOC, "id": {"type": "string", "description": "id do contato"},
                 "days": {"type": "integer", "default": 60},
                 "ate": {"type": "string", "description": "só eventos antes deste ISO (paginação)"}, "snapshot": _SNAP},
                ["loc", "id"]),
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
    "anotacoes": (anotacoes, "Leitura ao vivo de notas e tarefas do contato (abre Chrome, não usa o "
                  "dump): `lista` e `detalhe` precisam de contato; `buscar` varre as tarefas de TODA "
                  "a subconta e só existe para tarefa — é a forma de responder o que está atrasado. "
                  "Nota de compromisso é outra coisa, e sai pela tool `agenda`.",
                  {"loc": _LOC,
                   "o": {"type": "string", "enum": list(ANOTACAO_LEITURA), "default": "lista"},
                   "tipo": {"type": "string", "enum": list(ANOTACAO_TIPOS), "default": "nota"},
                   "contato": {"type": "string", "description": "contactId; obrigatório fora de o=buscar"},
                   "id": {"type": "string", "description": "id da nota ou tarefa (com o=detalhe)"},
                   "dono": {"type": "string", "description": "filtra tarefas por responsável (o=buscar)"},
                   "concluidas": {"type": "boolean", "description": "filtra tarefas concluídas (o=buscar)"},
                   "termo": {"type": "string", "description": "busca no texto das tarefas (o=buscar)"},
                   "limite": {"type": "integer", "description": "quantas tarefas; o servidor usa 25"}},
                  ["loc"]),
    "anotacao_acao": (anotacao_acao,
                      "ESCREVE EM PRODUÇÃO: cria, edita ou apaga nota e tarefa do contato, e conclui "
                      "ou reabre tarefa. Sem confirmo=true devolve a prévia com o corpo que iria para "
                      "o servidor, sem gravar. Criar tarefa exige titulo e prazo (ISO); a tarefa nasce "
                      "não concluída. Apagar não tem desfazer.",
                      {"loc": _LOC,
                       "acao": {"type": "string", "enum": list(ANOTACAO_ACOES)},
                       "contato": {"type": "string", "description": "contactId"},
                       "tipo": {"type": "string", "enum": list(ANOTACAO_TIPOS), "default": "nota"},
                       "id": {"type": "string", "description": "id da nota ou tarefa; tudo menos criar"},
                       "texto": {"type": "string", "description": "corpo da nota, ou descrição da tarefa"},
                       "titulo": {"type": "string", "description": "título da tarefa"},
                       "prazo": {"type": "string", "description": "vencimento em ISO, ex. 2026-10-01T10:00:00Z"},
                       "dono": {"type": "string", "description": "responsável pela tarefa"},
                       "confirmo": {"type": "boolean", "description": "true grava de verdade", "default": False}},
                      ["loc", "acao", "contato"]),
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
    "oportunidades": (oportunidades, "Leitura ao vivo de pipelines e oportunidades (abre Chrome, não usa "
                      "o dump): `pipelines` (funis e seus estágios), `listar` (cards, com filtro de pipeline, "
                      "estágio, status e contato), `buscar` (termo livre), `ver` (um card pelo id).",
                      {"loc": _LOC, "o": {"type": "string", "enum": list(OPP_LEITURA), "default": "pipelines"},
                       "id": {"type": "string", "description": "id da oportunidade (com o=ver)"},
                       "pipeline": {"type": "string"}, "estagio": {"type": "string"},
                       "status": {"type": "string", "enum": ["open", "won", "lost", "abandoned", "all"]},
                       "contato": {"type": "string", "description": "só as oportunidades deste contato"},
                       "termo": {"type": "string", "description": "com o=buscar"},
                       "limite": {"type": "integer"},
                       "pagina": {"type": "integer", "description": "página da listagem, a partir de 1"},
                       "snapshot": _SNAP},
                      ["loc"]),
    "oportunidade_acao": (oportunidade_acao, "ESCREVE EM PRODUÇÃO: cria, edita, move de estágio, muda o "
                          "status, apaga ou restaura uma oportunidade. Exige confirmo=true; registro em "
                          "<dumps>/_oportunidades/. `apagar` é reversível por `restaurar`. O contato de um "
                          "card só se define na criação e não pode ser trocado depois.",
                          {"loc": _LOC, "acao": {"type": "string", "enum": list(OPP_ACOES)},
                           "id": {"type": "string", "description": "id da oportunidade (tudo menos criar)"},
                           "pipeline": {"type": "string"}, "estagio": {"type": "string"},
                           "nome": {"type": "string"}, "valor": {"type": "number"},
                           "status": {"type": "string", "enum": ["open", "won", "lost", "abandoned"]},
                           "contato": {"type": "string", "description": "só na criação"},
                           "dono": {"type": "string", "description": "usuário responsável"},
                           "fechamento": {"type": "string", "description": "previsão de fechamento, AAAA-MM-DD"},
                           "probabilidade": {"type": "number", "description": "0 a 100"},
                           "campos": {"type": "array", "items": {"type": "object"},
                                      "description": "campos personalizados: [{id, fieldValue}]"},
                           "confirmo": {"type": "boolean", "default": False},
                           "snapshot": _SNAP},
                          ["loc", "acao"]),
    "pipeline": (pipeline, "ESCREVE EM PRODUÇÃO: cria, edita ou apaga um pipeline. `estagios` é "
                 "SUBSTITUTIVO — estágio ausente da lista é removido, e os cards dele migram para um "
                 "estágio que sobrou, o que acorda toda automação que reage a transição. A tool recusa "
                 "remover estágio que tem card dentro, a menos que apagar_com_cards=true. "
                 "Apagar pipeline NÃO tem restore; o estado anterior fica em <dumps>/_oportunidades/.",
                 {"loc": _LOC, "acao": {"type": "string", "enum": list(PIPE_ACOES)},
                  "id": {"type": "string", "description": "id do pipeline (editar e apagar)"},
                  "nome": {"type": "string"},
                  "estagios": {"type": "array", "items": {"type": "object"},
                               "description": "lista COMPLETA: [{id?, name, position?}]"},
                  "confirmo": {"type": "boolean", "default": False},
                  "apagar_com_cards": {"type": "boolean", "default": False,
                                       "description": "libera remover estágio com card dentro; eles migram, não somem"},
                  "snapshot": _SNAP},
                 ["loc", "acao"]),
    "agenda": (agenda, "Leitura ao vivo da agenda (abre Chrome, não usa o dump): "
               "`calendarios` (os calendários da subconta), `calendario` (um pelo id), "
               "`livres` (horários livres de um calendário num período, teto de 31 dias), "
               "`eventos` (só compromissos do período — bloqueio NUNCA aparece aqui, use "
               "`bloqueios` para isso), `bloqueios` (só os bloqueios do período), `ver` (um compromisso pelo id), `notas` (as notas de um "
               "compromisso). Datas em ISO com fuso: 2026-10-02T14:00:00-03:00.",
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
    "agenda_acao": (agenda_acao, "ESCREVE EM PRODUÇÃO E FALA COM O CLIENTE: marca, remarca, "
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
                    "não impedir o e-mail que o próprio calendário manda.",
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
    "workflows_ao_vivo": (workflows_ao_vivo, "Leitura AO VIVO de workflows (abre Chrome, não usa o "
                          "dump e não exige extração prévia): `lista` (todos os workflows com o status "
                          "corrente), `dentro` (quem está dentro de um workflow agora, com o passo em "
                          "que cada um parou, desde quando e por que entrou), `contato` (em que "
                          "workflows um contato está agora). Teto de 500 inscritos, ajustável por "
                          "`limite`; a resposta declara se cortou. `nomes=true` resolve o nome de cada "
                          "contato, uma chamada por contato — lento em lista grande.",
                          {"loc": _LOC, "o": {"type": "string", "enum": list(WF_LEITURA), "default": "lista"},
                           "id": {"type": "string", "description": "id do workflow (com o=dentro)"},
                           "contato": {"type": "string", "description": "id do contato (com o=contato)"},
                           "limite": {"type": "integer", "description": "teto de inscritos (padrão 500)"},
                           "nomes": {"type": "boolean", "default": False}},
                          ["loc"]),
    "workflow_acao": (workflow_acao, "ESCREVE EM PRODUÇÃO: publica ou despublica um workflow "
                      "(`publicar` com o status desejado), inscreve um contato, remove um contato ou "
                      "retoma uma inscrição parada. Exige confirmo=true; registro em "
                      "<dumps>/_workflows/<locationId>/<workflowId>/. Despublicar NÃO remove ninguém: quem está "
                      "dentro congela no passo em que está e volta a andar, todo mundo de uma vez, "
                      "quando o workflow for republicado. Inscrever é enfileirado pelo servidor — ler "
                      "logo depois pode não mostrar o contato ainda. A ação é carimbada com o usuário "
                      "logado no histórico do GHL; `usuario` sobrescreve.",
                      {"loc": _LOC, "acao": {"type": "string", "enum": list(WF_ACOES)},
                       "id": {"type": "string", "description": "id do workflow"},
                       "contato": {"type": "string", "description": "inscrever, remover, retomar"},
                       "inscricao": {"type": "string", "description": "id da inscrição (retomar)"},
                       "status": {"type": "string", "enum": list(WF_STATUS),
                                  "description": "com acao=publicar"},
                       "usuario": {"type": "string", "description": "autor; sem ele, sai do token"},
                       "inicio": {"type": "string", "description": "início programado (inscrever), ISO com fuso"},
                       "confirmo": {"type": "boolean", "default": False}},
                      ["loc", "acao", "id"]),
    "workflow_editar": (workflow_editar,
                        "ESCREVE AO VIVO: cria, renomeia, move, duplica e apaga workflow; e edita o "
                        "corpo de um existente — troca uma referência (`trocar-ref`), troca uma tag pelo "
                        "nome (`trocar-tag`), remove steps que nunca executam (`limpar-orfaos`), altera um "
                        "atributo de step (`atributo`) e adiciona, remove ou substitui um trigger "
                        "(`trigger`). Monta o canvas: insere um step (`step-criar`), remove um step vivo "
                        "recosturando os ponteiros (`step-remover`) e muda um step de lugar (`step-mover`). "
                        "Sem `confirmo` devolve a PRÉVIA com o diff e não grava nada. "
                        "Workflow publicado exige `publicado=true` junto. `criar` e `duplicar` exigem "
                        "`pasta` — workflow fora de pasta não aparece na lista do app. A resposta traz "
                        "`url`, o link do editor. Não move container nem remove ramo de container isolado.",
                        {"loc": _LOC,
                         "acao": {"type": "string", "enum": list(WF_EDITAR_ACOES)},
                         "id": {"type": "string", "description": "id do workflow (tudo menos criar)"},
                         "nome": {"type": "string", "description": "criar, renomear, duplicar"},
                         "pasta": {"type": "string",
                                   "description": "id da pasta; OBRIGATÓRIO em criar e duplicar "
                                                  "(fora de pasta o app não mostra o workflow)"},
                         "de": {"type": "string", "description": "id (trocar-ref) ou nome de tag (trocar-tag) a substituir"},
                         "para": {"type": "string", "description": "id ou nome de tag novo"},
                         "step": {"type": "string", "description": "id do step (atributo, step-remover, step-mover)"},
                         "caminho": {"type": "string", "description": "campo dentro de attributes, aninhado com ponto"},
                         "valor": {"type": "string", "description": "valor novo; JSON válido vira JSON"},
                         "trigger_acao": {"type": "string", "enum": ["adicionar", "remover", "substituir"]},
                         "trigger_id": {"type": "string", "description": "id do trigger que SAI (remover, substituir)"},
                         "trigger_corpo": {"type": "object",
                                           "description": "trigger que ENTRA (adicionar, substituir): "
                                                          "`type` obrigatório (appointment, contact_tag, "
                                                          "form_submission…), mais `name`, `conditions` e "
                                                          "`masterType: \"highlevel\"`. O `workflowId` é "
                                                          "preenchido pela tool"},
                         "corpo": {"type": "object",
                                   "description": "step que ENTRA (step-criar): `type` obrigatório, mais "
                                                  "`name` e `attributes` no formato do tipo. Copie um step "
                                                  "existente do mesmo tipo como molde — os attributes não "
                                                  "são modelados. `id`, `parentKey` e `next` são ignorados"},
                         "depois_de": {"type": "string",
                                       "description": "id do step que fica logo ANTES (step-criar, step-mover); "
                                                      "pode ser um nó de ramo, não pode ser um container. Em "
                                                      "step-criar, sem ele o step entra no INÍCIO do fluxo — é "
                                                      "assim que nasce o primeiro step de um workflow do zero"},
                         "ramos": {"type": "array",
                                   "description": "step-criar: lista de ramos, e o step nasce container de N "
                                                  "saídas. Cada ramo é {name, branch?, else?}; `branch` é a "
                                                  "condição do if_else (segments/operator) e `else` marca o "
                                                  "ramo None. Sem if_else os ramos viram `transition`",
                                   "items": {"type": "object"}},
                         "com_subarvore": {"type": "boolean",
                                           "description": "step-remover: o container sai levando os ramos e "
                                                          "tudo que pende deles"},
                         "confirmo": {"type": "boolean", "description": "obrigatório para gravar"},
                         "publicado": {"type": "boolean", "description": "obrigatório junto de confirmo se o workflow está publicado"},
                         "snapshot": _SNAP},
                        ["loc", "acao"]),
    "editar": (editar, "ESCREVE EM PRODUÇÃO: altera campos e/ou tags de um contato pela API interna (abre Chrome). "
               "Grava snapshot do contato antes; devolve antes/depois, caminho do snapshot e `dispara` = workflows "
               "cujo trigger reage à mudança. Nomes de campo/tag resolvidos pelo dump; não cria tags.",
               {"loc": _LOC, "id": {"type": "string", "description": "id do contato"},
                "set": {"type": "object", "description": "campo (nome, fieldKey ou id) → valor"},
                "tags_adicionar": {"type": "array", "items": {"type": "string"}},
                "tags_remover": {"type": "array", "items": {"type": "string"}}, "snapshot": _SNAP},
               ["loc", "id"]),
}


def _tool_list() -> list[dict]:
    return [{"name": n, "description": d,
             "inputSchema": {"type": "object", "properties": p, "required": r}}
            for n, (_, d, p, r) in TOOLS.items()]


def _version() -> str:
    """Versão do plugin.json (a raiz vem do shim); "0" quando o servidor roda fora do plugin."""
    root = os.environ.get("CLAUDE_PLUGIN_ROOT")
    if not root:
        return "0"
    try:
        return json.loads((Path(root) / ".claude-plugin" / "plugin.json").read_text())["version"]
    except Exception:
        return "0"


def handle(req: dict) -> dict | None:
    rid, method, params = req.get("id"), req.get("method"), req.get("params") or {}
    if method == "initialize":
        result = {"protocolVersion": PROTOCOL, "capabilities": {"tools": {}},
                  "serverInfo": {"name": "automaster", "version": _version()}}
    elif method == "tools/list":
        result = {"tools": _tool_list()}
    elif method == "tools/call":
        name = params.get("name")
        if name not in TOOLS:
            return {"jsonrpc": "2.0", "id": rid, "error": {"code": -32602, "message": f"tool desconhecida: {name}"}}
        try:
            body = TOOLS[name][0](**(params.get("arguments") or {}))
            result = {"content": [{"type": "text", "text": json.dumps(body, ensure_ascii=False)}]}
        except (ToolError, TypeError) as e:
            result = {"content": [{"type": "text", "text": str(e)}], "isError": True}
    elif method == "ping":
        result = {}
    elif rid is None:
        return None  # notificação (initialized, cancelled…)
    else:
        return {"jsonrpc": "2.0", "id": rid, "error": {"code": -32601, "message": f"método desconhecido: {method}"}}
    return {"jsonrpc": "2.0", "id": rid, "result": result}


def main() -> int:
    root = _root()
    if not root.is_dir():
        print(f"automaster mcp: raiz de dumps não existe: {root} (AUTOMASTER_DUMPS)", file=sys.stderr)
        return 1
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            resp = handle(json.loads(line))
        except json.JSONDecodeError:
            resp = {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "JSON inválido"}}
        if resp is not None:
            sys.stdout.write(json.dumps(resp, ensure_ascii=False) + "\n")
            sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
