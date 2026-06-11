"""Renderiza a árvore de jornada do contato — shell "Sala de Controle" (IBM Carbon).

Árvore com <details> nativo; prefixos mono por tipo de nó; chips para condições
não avaliadas, DRAFT/INATIVO e referência quebrada. JS mínimo (expandir/recolher
tudo + filtro de texto) em constante separada (padrão str.format do projeto).
"""
from __future__ import annotations

import html as _html
import re
from pathlib import Path

from .theme import head_assets, shell_meta, sidebar, topbar


def _esc(s) -> str:
    return _html.escape("" if s is None else str(s), quote=True)


_DUMP_DIR_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})$")


def _extracted_from_path(out_path: Path) -> str:
    m = _DUMP_DIR_RE.match(out_path.parent.name)
    return f"{m.group(1)} {m.group(2)}:{m.group(3)}" if m else ""


# prefixo mono por (kind, label-base)
def _prefix(n: dict) -> str:
    k = n["kind"]
    if k == "event":
        return "EVT"
    if k == "workflow":
        return "WF"
    if k == "branch":
        return "RAMO"
    if k == "loop":
        return "LOOP"
    if k == "truncated":
        return "CAP"
    if k == "terminal":
        return "FIM"
    if k == "neutral_group":
        return "···"
    lbl = n["label"]
    if lbl.startswith("adiciona tag"):
        return "TAG+"
    if lbl.startswith("remove tag"):
        return "TAG−"
    if lbl.startswith("mensagem"):
        return "MSG"
    if "oportunidade" in lbl:
        return "OPP"
    if lbl.startswith("envia para workflow"):
        return "→WF"
    if lbl.startswith("atualiza campo"):
        return "FLD"
    if lbl.startswith("atribui"):
        return "USR"
    if lbl.startswith("webhook"):
        return "HOOK"
    if lbl.startswith("notificação"):
        return "NOTIF"
    if lbl.startswith("ligação"):
        return "CALL"
    return "·"


_FLAG_CHIP = {
    "draft": '<span class="chip warn">DRAFT</span>',
    "inactive": '<span class="chip warn">INATIVO</span>',
    "missing": '<span class="chip err">REF QUEBRADA</span>',
}


def _node_html(n: dict) -> str:
    pre = f'<span class="jpre jpre-{n["kind"]}">{_esc(_prefix(n))}</span>'
    label = f'<span class="jlbl">{_esc(n["label"])}</span>'
    detail = f'<span class="jdet">{_esc(n["detail"])}</span>' if n["detail"] else ""
    chips = "".join(_FLAG_CHIP.get(f, "") for f in n["flags"])
    chips += "".join(f'<span class="chip cond">se: {_esc(c)}</span>' for c in n["conds"])
    head = f"{pre}{label}{detail}{chips}"
    if not n["children"]:
        return f'<div class="jleaf jk-{n["kind"]}">{head}</div>'
    kids = "".join(_node_html(c) for c in n["children"])
    op = "" if n["kind"] == "neutral_group" else " open"
    return (f'<details class="jnode jk-{n["kind"]}"{op}><summary>{head}</summary>'
            f'<div class="jkids">{kids}</div></details>')


# CSS da página (chaves NÃO passam pelo str.format — injetado como valor)
_PAGE_CSS = """
.jtree{background:var(--panel);border:1px solid var(--border);padding:8px 16px 16px}
.jtree+.jtree{margin-top:24px}
.jroot{font-size:14px;font-weight:600;padding:12px 0 4px}
.jnode,.jleaf{margin:0;padding:0}
.jkids{margin-left:14px;padding-left:14px;border-left:1px solid var(--border)}
.jnode>summary{cursor:pointer;list-style:none;display:flex;align-items:baseline;gap:8px;
  padding:5px 0;flex-wrap:wrap}
.jnode>summary::-webkit-details-marker{display:none}
.jnode>summary::before{content:"+";font-family:var(--mono);color:var(--ink-3);width:12px}
.jnode[open]>summary::before{content:"−"}
.jleaf{display:flex;align-items:baseline;gap:8px;padding:5px 0 5px 12px;flex-wrap:wrap}
.jpre{font-family:var(--mono);font-size:10px;letter-spacing:.06em;color:var(--ink-2);
  border:1px solid var(--border);padding:1px 6px;flex:none}
.jpre-event{background:var(--gray-tint);border-color:var(--border-strong)}
.jpre-workflow{background:#161616;color:#fff;border-color:#161616}
.jpre-terminal,.jpre-loop{border-style:dashed}
.jk-loop .jlbl,.jk-loop .jpre{color:var(--amber-ink)}
.jk-truncated .jlbl,.jk-truncated .jpre{color:var(--red-ink)}
.jlbl{font-size:13.5px}
.jk-workflow>summary .jlbl{font-weight:600}
.jdet{font-family:var(--mono);font-size:11px;color:var(--ink-3)}
.chip{font-family:var(--mono);font-size:10px;padding:1px 6px;border:1px solid var(--border-strong);
  background:var(--gray-tint);color:var(--gray-ink)}
.chip.warn{background:var(--amber-tint);color:var(--amber-ink);border-color:var(--amber)}
.chip.err{background:var(--red-tint);color:var(--red-ink);border-color:var(--red)}
.chip.cond{background:var(--selected);color:var(--blue);border-color:var(--blue)}
.jbar{display:flex;gap:8px;align-items:center;margin:0 0 16px}
.jbar input{flex:0 1 380px;height:36px;border:1px solid var(--border);padding:0 12px;
  font-size:13px;background:var(--panel);color:var(--ink)}
.jbar button{height:36px;border:1px solid var(--border);background:var(--panel);
  font-size:12px;padding:0 12px;cursor:pointer;color:var(--ink-2)}
.jbar button:hover{background:var(--bg)}
.jhidden{display:none!important}
"""

_JS = """
const q = document.querySelector('[data-jfilter]');
const all = () => Array.from(document.querySelectorAll('.jnode,.jleaf'));
document.querySelector('[data-jexpand]').onclick = () =>
  document.querySelectorAll('details.jnode').forEach(d => d.open = true);
document.querySelector('[data-jcollapse]').onclick = () =>
  document.querySelectorAll('details.jnode').forEach(d => d.open = false);
q.addEventListener('input', () => {
  const v = q.value.trim().toLowerCase();
  all().forEach(el => el.classList.remove('jhidden'));
  if (!v) return;
  const match = el => el.textContent.toLowerCase().includes(v);
  document.querySelectorAll('.jtree > details.jnode').forEach(root => {
    if (!match(root)) { root.classList.add('jhidden'); return; }
    root.querySelectorAll('.jnode,.jleaf').forEach(el => {
      if (!match(el)) el.classList.add('jhidden');
    });
  });
});
"""

_TEMPLATE = """<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AUTOMASTER // JORNADA {title}</title>
{head_assets}
<style>{page_css}</style>
</head><body>
{topbar}
{sidebar}
<main class="main">
<div class="crumb">{loc} / <b>Jornada do contato</b></div>
<h1>Jornada do contato</h1>
<div class="h1-sub">{sub}</div>
<div class="jbar">
  <input data-jfilter placeholder="filtrar na árvore..." autocomplete="off">
  <button data-jexpand>expandir tudo</button>
  <button data-jcollapse>recolher tudo</button>
</div>
{trees}
</main>
<script>{js}</script>
</body></html>"""


def _tree_section(title: str, nodes: list[dict], empty: str) -> str:
    body = "".join(_node_html(n) for n in nodes) if nodes else \
        f'<div class="jleaf"><span class="jdet">{_esc(empty)}</span></div>'
    return f'<section class="jtree"><div class="jroot">{_esc(title)}</div>{body}</section>'


def write_journey_html(data: dict, out: Path, title: str = "") -> Path:
    out = Path(out)
    meta = data["meta"]
    s = data["stats"]
    sub_parts = [
        f"{s['workflows_alcancaveis']} workflows alcançáveis",
        f"{s['terminais']} terminais",
        f"{s['loops']} loops",
        f"{s['eventos_externos']} eventos externos",
    ]
    if data.get("truncated"):
        sub_parts.append("⚠ árvore truncada (caps)")
    ign = s.get("triggers_ignorados") or {}
    if ign:
        sub_parts.append("ignorados: " + ", ".join(f"{k}×{v}" for k, v in sorted(ign.items())))
    sm = shell_meta(out.parent)
    trees = (
        _tree_section("Contato criado", data["criacao"],
                      "nenhum trigger de criação de contato no dump")
        + _tree_section("A qualquer momento", data["anytime"],
                        "nenhum evento sem âncora interna")
    )
    html = _TEMPLATE.format(
        title=_esc(title or meta.get("locationId") or "dump"),
        head_assets=head_assets(),
        page_css=_PAGE_CSS,
        topbar=topbar(meta.get("locationId", ""),
                      _extracted_from_path(out) or str(meta.get("extractedAt") or ""),
                      schema=sm.get("schema")),
        sidebar=sidebar("journey", sm.get("counts")),
        loc=_esc(meta.get("locationId", "")),
        sub=_esc(" · ".join(sub_parts)),
        trees=trees,
        js=_JS,
    )
    out.write_text(html, encoding="utf-8")
    return out
