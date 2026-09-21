"""O que todas as tools usam: raiz dos dumps, snapshot, caches e a ponte com o extractor."""
from __future__ import annotations

import json
import os
import subprocess
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from .. import rules
from ..dashboard import build_dashboard
from ..journey import build_journey
from ..loader import DumpContext, DumpError, load_dump

PATHS_MAX_CHARS = 6000  # ~1.500 tokens; a mediana do paths.md é 173 tok, o maior 18.665
CONVERSAS_MAX_CHARS = 30000  # ~7,5k tokens
CONVERSAS_CORPO = 400     # corpo de e-mail passa de 4 KB; o começo basta para reconhecer a mensagem
CONTATO_MAX_CHARS = 40000  # ~10k tokens; medido: ~180 tok/evento depois de tirar o ruído → ~55 eventos
CONTATO_NOISE = ("traceId", "commonPrimaryId", "_id", "shardId", "secondaryId", "apiVersion",
                 "chPublished", "externalChange")  # 40% do payload bruto, nada que o agente use
EXTRACTOR_DIR = Path(os.environ.get("CLAUDE_PLUGIN_ROOT") or Path(__file__).resolve().parents[4]) / "extractor"
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

_LOC = {"type": "string", "description": "locationId da subconta"}

_SNAP = {"type": "string", "description": "snapshot YYYY-MM-DD_HHmm (default: mais recente)"}
