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


def _head_tail(err: str | None, head: int = 3, tail: int = 600) -> str:
    """Começo + cauda do stderr: o `snapshot: <caminho>` é impresso ANTES das escritas
    e não pode sumir no truncamento de um stack trace longo."""
    lines = (err or "").strip().splitlines()
    if not lines:
        return "(stderr vazio)"
    inicio = "\n".join(lines[:head])
    resto = "\n".join(lines[head:])
    return inicio if not resto else f"{inicio}\n[...]\n{resto[-tail:]}"


def _run_extractor(*args: str) -> dict:
    """Roda `tsx src/cli.ts <args>` no extractor (abre Chrome; espera segundos). Só a última linha do stdout é JSON."""
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


# ---------------------------------------------------------------- protocolo

_LOC = {"type": "string", "description": "locationId da subconta"}
_SNAP = {"type": "string", "description": "snapshot YYYY-MM-DD_HHmm (default: mais recente)"}
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


def handle(req: dict) -> dict | None:
    rid, method, params = req.get("id"), req.get("method"), req.get("params") or {}
    if method == "initialize":
        result = {"protocolVersion": PROTOCOL, "capabilities": {"tools": {}},
                  "serverInfo": {"name": "automaster", "version": "0.1.0"}}
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
