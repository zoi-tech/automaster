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
from pathlib import Path

from . import rules
from .dashboard import build_dashboard
from .journey import TriggerIndex, build_journey
from .loader import DumpContext, DumpError, load_dump
from .path_report import workflow_paths_lines

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
        raise ToolError(
            f"{args[0]} estourou 600 s e foi morto — provável login manual pendente na janela do Chrome. "
            "A escrita PODE ter sido aplicada (o processo pode ter morrido entre o PUT e a marcação do "
            "snapshot): confira o estado atual com a tool `contato`. "
            + _head_tail(e.stderr if isinstance(e.stderr, str) else (e.stderr or b"").decode("utf-8", "replace"))
        ) from e
    if r.returncode != 0 or not r.stdout.strip():
        dica = (" A escrita pode ter sido parcialmente aplicada: confira o estado atual com a tool `contato`."
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
OPP_LEITURA = ("pipelines", "listar", "buscar", "ver")
OPP_ACOES = ("criar", "editar", "mover", "status", "apagar", "restaurar")
PIPE_ACOES = ("criar", "editar", "apagar")


def oportunidades(loc: str, o: str = "pipelines", id: str | None = None,
                  pipeline: str | None = None, estagio: str | None = None,
                  status: str | None = None, contato: str | None = None,
                  termo: str | None = None, limite: int | None = None,
                  snapshot: str | None = None) -> dict:
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
                      ("--limite", str(limite) if limite else None)):
        if val:
            args += [flag, val]
    return {"resultado": _run_extractor(*args, "--json"), "_snapshot": meta}


def oportunidade_acao(loc: str, acao: str, id: str | None = None, pipeline: str | None = None,
                      estagio: str | None = None, nome: str | None = None,
                      valor: float | None = None, status: str | None = None,
                      contato: str | None = None, dono: str | None = None,
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
                      ("--status", status), ("--contato", contato), ("--dono", dono)):
        if val:
            args += [flag, val]
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


TOOLS = {
    "dumps": (dumps, "Lista subcontas com dump, snapshots e data. ~200 tokens.", {}, []),
    "inventario": (inventario, "summary (~80 tokens) ou uma fatia: workflows, tags, fields, pipelines, "
                   "users, calendars, custom_values (até ~20k tokens).",
                   {"loc": _LOC, "fatia": {"type": "string", "enum": list(FATIAS)}, "snapshot": _SNAP}, ["loc"]),
    "workflow": (workflow, "Meta, árvore de caminhos (teto ~1.5k tokens, flag caminhos_truncado) e achados de um workflow.",
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
    "oportunidades": (oportunidades, "Leitura ao vivo de pipelines e oportunidades (abre Chrome, não usa "
                      "o dump): `pipelines` (funis e seus estágios), `listar` (cards, com filtro de pipeline, "
                      "estágio, status e contato), `buscar` (termo livre), `ver` (um card pelo id).",
                      {"loc": _LOC, "o": {"type": "string", "enum": list(OPP_LEITURA), "default": "pipelines"},
                       "id": {"type": "string", "description": "id da oportunidade (com o=ver)"},
                       "pipeline": {"type": "string"}, "estagio": {"type": "string"},
                       "status": {"type": "string", "enum": ["open", "won", "lost", "abandoned", "all"]},
                       "contato": {"type": "string", "description": "só as oportunidades deste contato"},
                       "termo": {"type": "string", "description": "com o=buscar"},
                       "limite": {"type": "integer"}, "snapshot": _SNAP},
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
                           "confirmo": {"type": "boolean", "default": False},
                           "snapshot": _SNAP},
                          ["loc", "acao"]),
    "pipeline": (pipeline, "ESCREVE EM PRODUÇÃO: cria, edita ou apaga um pipeline. `estagios` é "
                 "SUBSTITUTIVO — estágio ausente da lista é removido, e some junto com os cards dele. "
                 "A tool recusa remover estágio que tem card dentro, a menos que apagar_com_cards=true. "
                 "Apagar pipeline NÃO tem restore; o estado anterior fica em <dumps>/_oportunidades/.",
                 {"loc": _LOC, "acao": {"type": "string", "enum": list(PIPE_ACOES)},
                  "id": {"type": "string", "description": "id do pipeline (editar e apagar)"},
                  "nome": {"type": "string"},
                  "estagios": {"type": "array", "items": {"type": "object"},
                               "description": "lista COMPLETA: [{id?, name, position?}]"},
                  "confirmo": {"type": "boolean", "default": False},
                  "apagar_com_cards": {"type": "boolean", "default": False,
                                       "description": "libera remover estágio com card dentro"},
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
