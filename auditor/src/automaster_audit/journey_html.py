"""Renderiza a árvore de jornada do contato — shell "Sala de Controle" (IBM Carbon).

Três modos de vista (alternador no topo, persiste em localStorage):
- Lista (default): árvore com <details> nativo, server-rendered (como sempre);
- Fluxograma: tidy tree colapsável (SVG, pan/zoom, badges +N desc.);
- Metrô: linhas raiz→terminal com seletor, trilhos compartilhados e baldeações.

Fluxograma e metrô renderizam client-side a partir de `const JOURNEY` (JSON
embutido via _safe_json), lazy: só na primeira ativação da vista. JS portado dos
demos em constantes separadas (_JS_FLUX/_JS_METRO) injetadas como VALOR no
template (chaves de JS nunca passam pelo str.format). XSS: server-side tudo via
html.escape; client-side todo dado de CRM entra via textContent/setAttribute.
"""

from __future__ import annotations

import html as _html
import json
import re
from pathlib import Path

from .theme import head_assets, shell_meta, sidebar, topbar


def _esc(s) -> str:
    return _html.escape("" if s is None else str(s), quote=True)


def _safe_json(obj) -> str:
    return (
        json.dumps(obj, ensure_ascii=False)
        .replace("</", "<\\/")
        .replace("<!--", "<\\!--")
        .replace(chr(0x2028), "\\u2028")
        .replace(chr(0x2029), "\\u2029")
    )


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
    return (
        f'<details class="jnode jk-{n["kind"]}"{op}><summary>{head}</summary><div class="jkids">{kids}</div></details>'
    )


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
/* ===== alternador de vista (tabs Carbon) ===== */
.jviews{display:flex;gap:0;border-bottom:1px solid var(--border);margin:0 0 16px}
.jviews button{background:none;border:none;border-bottom:2px solid transparent;
  padding:9px 16px;font-size:13px;color:var(--ink-2);cursor:pointer}
.jviews button:hover{color:var(--ink);background:var(--bg)}
.jviews button.jview-active{border-bottom-color:var(--blue);color:var(--ink);font-weight:600}
/* ===== vista fluxograma (classes fx-) ===== */
#view-flux{display:none;flex-direction:column;height:calc(100vh - 220px);
  background:var(--panel);border:1px solid var(--border);overflow:hidden}
.fx-toolbar{display:flex;align-items:center;gap:8px;padding:8px 12px;
  border-bottom:1px solid var(--border);flex:none;flex-wrap:wrap}
.fx-stats{font-family:var(--mono);font-size:11px;color:var(--ink-2)}
.fx-spacer{flex:1}
.fx-toolbar button{font-family:var(--sans);font-size:12px;background:var(--panel);
  color:var(--ink);border:1px solid var(--ink);padding:6px 12px;cursor:pointer}
.fx-toolbar button:hover{background:var(--gray-tint)}
.fx-toolbar button.fx-ghost{border-color:var(--border);color:var(--ink-2)}
#fx-stage{flex:1;position:relative;overflow:hidden;min-height:0}
#fx-stage svg{width:100%;height:100%;display:block;cursor:grab}
#fx-stage svg.fx-dragging{cursor:grabbing}
.fx-node .fx-box{fill:var(--panel);stroke:var(--border);stroke-width:1}
.fx-node .fx-bar{stroke:none}
.fx-node .fx-chip{font-family:var(--mono);font-size:9px;letter-spacing:.08em;fill:var(--ink-2)}
.fx-node .fx-lbl{font-family:var(--sans);font-size:12px;fill:var(--ink)}
.fx-node .fx-badge{font-family:var(--mono);font-size:10px;fill:var(--ink-2)}
.fx-node .fx-flagdot{stroke:none}
.fx-node .fx-hit{fill:transparent;stroke:none}
.fx-node.fx-has-kids{cursor:pointer}
.fx-node:hover .fx-box{stroke:var(--blue)}
.fx-node.fx-selected .fx-box{stroke:var(--blue);stroke-width:1.5}
.fx-node.fx-k-terminal .fx-box{fill:var(--bg)}
.fx-node.fx-k-neutral_group .fx-box{stroke-dasharray:3 2}
.fx-node.fx-k-loop .fx-lbl,.fx-node.fx-k-loop .fx-chip{fill:#6c5a00}
.fx-node.fx-k-loop .fx-box{fill:#fdf6dd}
.fx-node.fx-k-truncated .fx-box{fill:var(--red-tint)}
.fx-edge{fill:none;stroke:var(--border-strong);stroke-width:1}
.fx-edge.fx-to-loop{stroke:#d2a106;stroke-dasharray:4 3}
.fx-edge.fx-to-truncated{stroke:var(--red);stroke-dasharray:4 3}
.fx-seclabel{font-family:var(--mono);font-size:11px;letter-spacing:.14em;fill:var(--ink-2)}
#fx-tip{position:fixed;z-index:80;max-width:380px;display:none;background:#393939;color:#fff;
  padding:10px 12px;pointer-events:none;font-size:12px;line-height:1.45}
#fx-tip .fx-tk{font-family:var(--mono);font-size:10px;letter-spacing:.08em;color:#c6c6c6}
#fx-tip .fx-tk .fx-warn{color:var(--amber)}
#fx-tip .fx-tl{font-weight:600;font-size:13px;margin-top:2px}
#fx-tip .fx-td{color:#c6c6c6;margin-top:1px}
#fx-tip .fx-tch{font-family:var(--mono);font-size:10px;letter-spacing:.08em;color:#a8a8a8;margin-top:8px}
#fx-tip .fx-tc{font-family:var(--mono);font-size:11px;color:#e0e0e0}
#fx-tip .fx-th{margin-top:8px;color:#78a9ff;font-size:11px}
.fx-legend{flex:none;border-top:1px solid var(--border);padding:8px 16px;display:flex;
  align-items:center;gap:18px;font-size:11px;color:var(--ink-2);flex-wrap:wrap}
.fx-lg{display:flex;align-items:center;gap:6px}
.fx-sw{width:10px;height:10px;flex:none}
.fx-sep{width:1px;height:16px;background:var(--border)}
.fx-hint{margin-left:auto;font-family:var(--mono);font-size:10px}
.fx-dash{width:18px;height:0;border-top:1px dashed #d2a106}
/* ===== vista metrô (classes mt-) ===== */
#view-metro{display:none;height:calc(100vh - 220px);background:var(--panel);
  border:1px solid var(--border);overflow:hidden}
.mt-side{width:340px;flex:none;background:var(--panel);border-right:1px solid var(--border);
  display:flex;flex-direction:column;min-height:0}
.mt-side-head{padding:12px 16px 10px;border-bottom:1px solid var(--border)}
.mt-t{font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase}
.mt-c{font-size:11px;color:var(--ink-2);margin-top:2px}
.mt-search{padding:8px 16px;border-bottom:1px solid var(--border)}
.mt-search input{width:100%;border:none;border-bottom:1px solid var(--ink-3);background:var(--bg);
  padding:8px 10px;font:inherit;font-size:13px;color:var(--ink);outline:none}
.mt-search input:focus{border-bottom:2px solid var(--blue);padding-bottom:7px}
#mt-groups{flex:1;overflow-y:auto;min-height:0}
.mt-grp{border-bottom:1px solid var(--border)}
.mt-grph{display:flex;align-items:center;gap:8px;padding:8px 16px;cursor:pointer;
  background:var(--panel);position:sticky;top:0;z-index:2;border-bottom:1px solid var(--border)}
.mt-grph:hover{background:var(--bg)}
.mt-arrow{font-family:var(--mono);font-size:10px;color:var(--ink-2);width:10px}
.mt-name{font-size:13px;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mt-origin{font-size:9px;font-family:var(--mono);color:var(--ink-2);
  border:1px solid var(--border);padding:1px 5px;white-space:nowrap}
.mt-n{font-family:var(--mono);font-size:11px;color:var(--ink-2)}
.mt-linerow{display:flex;align-items:center;gap:8px;padding:6px 10px 6px 14px;cursor:pointer;
  border-left:3px solid transparent}
.mt-linerow:hover{background:var(--bg)}
.mt-linerow.mt-sel{border-left-color:var(--blue);background:var(--bg)}
.mt-sw{width:10px;height:10px;flex:none;border:1px solid var(--border);background:transparent}
.mt-linerow.mt-sel .mt-sw{border:none}
.mt-lrmain{flex:1;min-width:0}
.mt-lrdesc{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mt-lrsub{font-family:var(--mono);font-size:10px;color:var(--ink-2);margin-top:1px}
.mt-badges{display:flex;gap:4px;flex:none}
.mt-bdg{font-family:var(--mono);font-size:9px;padding:1px 4px;border:1px solid var(--border);
  color:var(--ink-2);white-space:nowrap}
.mt-bdg.mt-loop{border-color:var(--amber);color:var(--amber-ink);background:var(--amber-tint)}
.mt-bdg.mt-inactive,.mt-bdg.mt-draft{border-color:var(--amber);color:var(--amber-ink)}
.mt-bdg.mt-trunc{border-color:var(--red);color:var(--red-ink)}
.mt-mapwrap{flex:1;display:flex;flex-direction:column;min-width:0}
.mt-maphead{background:var(--panel);border-bottom:1px solid var(--border);padding:8px 16px;
  display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-height:44px}
.mt-maphead .mt-t{margin-right:6px}
#mt-chips{display:flex;gap:8px;flex-wrap:wrap}
.mt-chip{display:flex;align-items:center;gap:6px;border:1px solid var(--border);
  padding:3px 8px;font-size:11px;cursor:pointer;background:var(--panel)}
.mt-chip:hover{background:var(--bg)}
.mt-dot{width:9px;height:9px}
.mt-x{font-family:var(--mono);color:var(--ink-2);font-size:10px;margin-left:2px}
.mt-lid{font-family:var(--mono);color:var(--ink-2);font-size:10px}
#mt-scroller{flex:1;overflow:auto;background:var(--panel);min-height:0}
#mt-empty{padding:48px;color:var(--ink-2);font-size:13px;max-width:520px;line-height:1.6}
.mt-legend{border-top:1px solid var(--border);background:var(--panel);padding:6px 16px;
  display:flex;gap:18px;flex-wrap:wrap;align-items:center;flex:none}
.mt-leg{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--ink-2)}
.mt-leg svg{display:block}
#view-metro svg text{font-family:var(--sans);font-size:12.5px;fill:var(--ink)}
#view-metro text.mt-ev{font-style:italic;fill:#4d5358}
#view-metro text.mt-wf{font-weight:600}
#view-metro text.mt-dim2{fill:var(--ink-2)}
#view-metro tspan.mt-det{fill:var(--ink-2);font-size:11px;font-style:normal;font-weight:400}
#view-metro tspan.mt-flag{font-family:var(--mono);font-size:9.5px;font-weight:500}
#view-metro tspan.mt-cnd{font-family:var(--mono);font-size:10px;fill:var(--ink-2);
  font-style:normal;font-weight:400}
.mt-seg{fill:none;stroke-linecap:round;stroke-linejoin:round}
g.mt-lineg{transition:opacity .12s linear}
g.mt-lineg.mt-dimmed{opacity:.18}
.mt-hitrow{fill:transparent;cursor:pointer}
.mt-hitrow:hover{fill:rgba(15,98,254,.06)}
.mt-hitrow.mt-pinned{fill:rgba(15,98,254,.10)}
#mt-tip{position:fixed;z-index:80;background:var(--panel);border:1px solid var(--ink);
  padding:10px 12px;max-width:420px;display:none;pointer-events:none}
#mt-tip.mt-pin{pointer-events:auto;border-color:var(--blue)}
#mt-tip .mt-k{font-family:var(--mono);font-size:10px;color:var(--ink-2);
  letter-spacing:.05em;text-transform:uppercase}
#mt-tip .mt-l{font-size:13px;font-weight:600;margin-top:3px}
#mt-tip .mt-d{font-size:12px;color:var(--ink-2);margin-top:2px}
#mt-tip .mt-cnds{margin-top:6px;border-top:1px solid var(--border);padding-top:6px}
#mt-tip .mt-cnd{font-family:var(--mono);font-size:10.5px;color:var(--ink);padding:1px 0}
#mt-tip .mt-fl{display:inline-block;font-family:var(--mono);font-size:9.5px;padding:1px 5px;
  border:1px solid var(--amber);color:var(--amber-ink);margin-top:6px;margin-right:4px}
#mt-tip .mt-fl.mt-red{border-color:var(--red);color:var(--red-ink)}
#mt-tip .mt-ln{font-family:var(--mono);font-size:10px;color:var(--ink-2);margin-top:6px}
"""

# JS da lista + alternador de vistas (valor injetado; sem chaves de .format)
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

/* ===== alternador de vistas (lazy init; persiste em localStorage) ===== */
(function () {
  const KEY = 'automaster.journey.view';
  const views = {
    lista: [document.getElementById('view-lista'), 'block'],
    flux:  [document.getElementById('view-flux'), 'flex'],
    metro: [document.getElementById('view-metro'), 'flex'],
  };
  const btns = Array.from(document.querySelectorAll('[data-jview]'));
  const inited = {};
  function show(name) {
    if (!views[name]) name = 'lista';
    for (const k in views)
      views[k][0].style.display = (k === name) ? views[k][1] : 'none';
    btns.forEach(b =>
      b.classList.toggle('jview-active', b.getAttribute('data-jview') === name));
    ['fx-tip', 'mt-tip'].forEach(id => {
      const t = document.getElementById(id);
      if (t) t.style.display = 'none';
    });
    if (name === 'flux' && !inited.flux) { inited.flux = true; window.__amInitFlux(); }
    if (name === 'metro' && !inited.metro) { inited.metro = true; window.__amInitMetro(); }
    try { localStorage.setItem(KEY, name); } catch (e) {}
  }
  btns.forEach(b => b.addEventListener('click', () => show(b.getAttribute('data-jview'))));
  let saved = 'lista';
  try { saved = localStorage.getItem(KEY) || 'lista'; } catch (e) {}
  show(saved);
})();
"""

# Vista fluxograma — tidy tree colapsável (portada do demo viz-fluxograma.html).
# Lazy: só roda na 1ª ativação. XSS-safe: dado de CRM só via textContent/setAttribute;
# o único innerHTML é o scaffold estático (sem interpolação de dado).
_JS_FLUX = """
window.__amInitFlux = function () {
  "use strict";
  var DATA = JOURNEY;
  var rootEl = document.getElementById("view-flux");
  rootEl.innerHTML =
    '<div class="fx-toolbar">' +
    '<div class="fx-stats" id="fx-stats"></div>' +
    '<div class="fx-spacer"></div>' +
    '<button type="button" id="fx-b-fit" class="fx-ghost">Ajustar vista</button>' +
    '<button type="button" id="fx-b-l2" class="fx-ghost">Recolher (nível 2)</button>' +
    '<button type="button" id="fx-b-l4">Expandir tudo até nível 4</button>' +
    '</div>' +
    '<div id="fx-stage">' +
    '<svg id="fx-svg"><g id="fx-viewport"><g id="fx-labels"></g><g id="fx-edges"></g>' +
    '<g id="fx-nodesg"></g></g></svg>' +
    '</div>' +
    '<div class="fx-legend" id="fx-legend"></div>';
  var tip = document.getElementById("fx-tip");
  if (!tip) {
    tip = document.createElement("div");
    tip.id = "fx-tip";
    document.body.appendChild(tip);
  }

  // ---------- constants ----------
  var BOXW = 208, BOXH = 38, COLW = 252, ROWH = 46;
  var KIND_COLOR = {
    event: "#878d96",
    workflow: "#161616",
    branch: "#c6c6c6",
    effect: "#a8a8a8",
    neutral_group: "#e0e0e0",
    loop: "#f1c21b",
    terminal: "#525252",
    truncated: "#da1e28"
  };
  var KIND_CHIP = {
    event: "EVENTO", workflow: "WORKFLOW", branch: "RAMO", effect: "ACAO",
    neutral_group: "NEUTRO", loop: "LOOP", terminal: "FIM", truncated: "CORTE"
  };
  var KIND_NAME = {
    event: "Evento externo", workflow: "Workflow", branch: "Ramo de decisão",
    effect: "Ação no contato", neutral_group: "Steps neutros",
    loop: "Loop / já expandido", terminal: "Fim da jornada", truncated: "Cortado (limite)"
  };
  // flags que merecem destaque visual (a flag estrutural "ref" não é warning)
  function warnFlags(n) {
    return n.flags.filter(function (f) { return f !== "ref"; });
  }

  // ---------- prep tree ----------
  var idSeq = 0, allNodes = [];
  function prep(n, depth, parent) {
    n.id = idSeq++;
    n.depth = depth;
    n.parent = parent;
    n.children = n.children || [];
    n.flags = n.flags || [];
    n.conds = n.conds || [];
    n.desc = 0;
    allNodes.push(n); // pre-order: allNodes[n.id] === n
    for (var i = 0; i < n.children.length; i++) {
      prep(n.children[i], depth + 1, n);
      n.desc += 1 + n.children[i].desc;
    }
  }
  var sections = [
    { label: "NA CRIAÇÃO DO CONTATO", roots: DATA.criacao || [] },
    { label: "A QUALQUER MOMENTO", roots: DATA.anytime || [] }
  ];
  sections.forEach(function (s) {
    s.roots.forEach(function (r) { prep(r, 0, null); });
  });

  var initialDepth = 2;
  function setDepth(d) {
    allNodes.forEach(function (n) { n.expanded = n.children.length > 0 && n.depth < d; });
  }
  setDepth(initialDepth);

  // ---------- stats (toolbar) ----------
  var st = DATA.stats || {};
  function fmt(x) { return (x || 0).toLocaleString("pt-BR"); }
  document.getElementById("fx-stats").textContent =
    fmt(st.workflows_alcancaveis) + " workflows alcançáveis · " +
    fmt(st.terminais) + " terminais · " + fmt(st.loops) + " loops · " +
    fmt(allNodes.length) + " nós · " + fmt(st.eventos_externos) + " eventos externos";

  // ---------- legend ----------
  var legend = document.getElementById("fx-legend");
  var present = {};
  allNodes.forEach(function (n) { present[n.kind] = true; });
  ["event","workflow","branch","effect","neutral_group","loop","terminal","truncated"]
    .forEach(function (k) {
      if (!present[k]) return;
      var item = document.createElement("span"); item.className = "fx-lg";
      var sw = document.createElement("span"); sw.className = "fx-sw";
      sw.style.background = KIND_COLOR[k];
      if (k === "branch" || k === "neutral_group") sw.style.border = "1px solid #a8a8a8";
      var t = document.createElement("span"); t.textContent = KIND_NAME[k];
      item.appendChild(sw); item.appendChild(t); legend.appendChild(item);
    });
  var sep = document.createElement("span"); sep.className = "fx-sep"; legend.appendChild(sep);
  var fa = document.createElement("span"); fa.className = "fx-lg";
  var fasw = document.createElement("span"); fasw.className = "fx-sw";
  fasw.style.background = "#f1c21b";
  fasw.style.width = "8px"; fasw.style.height = "8px";
  var fat = document.createElement("span"); fat.textContent = "inativo / draft";
  fa.appendChild(fasw); fa.appendChild(fat); legend.appendChild(fa);
  var ld = document.createElement("span"); ld.className = "fx-lg";
  var ldd = document.createElement("span"); ldd.className = "fx-dash";
  var ldt = document.createElement("span"); ldt.textContent = "volta de loop";
  ld.appendChild(ldd); ld.appendChild(ldt); legend.appendChild(ld);
  var hint = document.createElement("span"); hint.className = "fx-hint";
  hint.textContent = "arrastar: mover · scroll: zoom · clique no nó: expandir/recolher";
  legend.appendChild(hint);

  // ---------- text measurement ----------
  var mctx = document.createElement("canvas").getContext("2d");
  var truncCache = {};
  function truncate(text, maxw, font) {
    var key = font + "|" + maxw + "|" + text;
    if (truncCache[key]) return truncCache[key];
    mctx.font = font;
    var out = text;
    if (mctx.measureText(text).width > maxw) {
      var lo = 0, hi = text.length;
      while (lo < hi) {
        var mid = (lo + hi + 1) >> 1;
        if (mctx.measureText(text.slice(0, mid) + "…").width <= maxw) lo = mid; else hi = mid - 1;
      }
      out = text.slice(0, lo) + "…";
    }
    truncCache[key] = out;
    return out;
  }
  var LBL_FONT = '12px "IBM Plex Sans", system-ui, sans-serif';

  // ---------- layout (tidy tree, forest) ----------
  function computeLayout() {
    var visible = [], edges = [], cursor = 0;
    function layoutNode(n) {
      visible.push(n);
      n.tx = n.depth * COLW;
      var kids = n.expanded ? n.children : [];
      if (!kids.length) {
        n.ty = cursor * ROWH; cursor += 1;
      } else {
        for (var i = 0; i < kids.length; i++) {
          layoutNode(kids[i]);
          edges.push([n, kids[i]]);
        }
        n.ty = (kids[0].ty + kids[kids.length - 1].ty) / 2;
      }
    }
    sections.forEach(function (s) {
      s.lty = cursor * ROWH + 14;
      cursor += 0.9;
      s.roots.forEach(function (r, i) {
        layoutNode(r);
        if (i < s.roots.length - 1) cursor += 0.4;
      });
      cursor += 1.0;
    });
    return { visible: visible, edges: edges };
  }

  // ---------- svg helpers ----------
  var SVGNS = "http://www.w3.org/2000/svg";
  function svgEl(tag, cls) {
    var el = document.createElementNS(SVGNS, tag);
    if (cls) el.setAttribute("class", cls);
    return el;
  }

  var svg = document.getElementById("fx-svg");
  var viewport = document.getElementById("fx-viewport");
  var edgeLayer = document.getElementById("fx-edges");
  var nodeLayer = document.getElementById("fx-nodesg");
  var labelLayer = document.getElementById("fx-labels");

  // section labels (created once)
  sections.forEach(function (s) {
    var t = svgEl("text", "fx-seclabel");
    t.textContent = s.label + " (" + s.roots.length + " gatilhos)";
    t.setAttribute("x", 0);
    labelLayer.appendChild(t);
    s.el = t;
  });

  // ---------- node DOM ----------
  var nodeEls = {}, edgeEls = {};
  function makeNodeEl(n) {
    var g = svgEl("g", "fx-node fx-k-" + n.kind + (n.children.length ? " fx-has-kids" : ""));
    g.setAttribute("data-id", n.id);

    var box = svgEl("rect", "fx-box");
    box.setAttribute("width", BOXW); box.setAttribute("height", BOXH);
    g.appendChild(box);

    var bar = svgEl("rect", "fx-bar");
    bar.setAttribute("width", 4); bar.setAttribute("height", BOXH);
    bar.setAttribute("fill", KIND_COLOR[n.kind] || "#a8a8a8");
    g.appendChild(bar);

    var chip = svgEl("text", "fx-chip");
    chip.setAttribute("x", 14); chip.setAttribute("y", 15);
    chip.textContent = KIND_CHIP[n.kind] || n.kind.toUpperCase();
    g.appendChild(chip);

    var badge = svgEl("text", "fx-badge");
    badge.setAttribute("text-anchor", "end");
    badge.setAttribute("y", 15);
    g.appendChild(badge);
    n._badge = badge;

    // flag "ref" é estrutural (referência "já expandido"), não warning
    if (warnFlags(n).length) {
      var dot = svgEl("rect", "fx-flagdot");
      dot.setAttribute("width", 8); dot.setAttribute("height", 8);
      dot.setAttribute("y", 6);
      dot.setAttribute("fill", "#f1c21b");
      g.appendChild(dot);
      n._dot = dot;
    }

    var lbl = svgEl("text", "fx-lbl");
    lbl.setAttribute("x", 14); lbl.setAttribute("y", 30);
    lbl.textContent = truncate(n.label || "", BOXW - 24, LBL_FONT);
    g.appendChild(lbl);
    n._lbl = lbl;

    var hit = svgEl("rect", "fx-hit");
    hit.setAttribute("width", BOXW); hit.setAttribute("height", BOXH);
    g.appendChild(hit);
    return g;
  }

  var selectedId = null;
  function updateNodeEl(n) {
    var g = nodeEls[n.id];
    var collapsed = n.children.length > 0 && !n.expanded;
    var badgeW = 0;
    if (collapsed) {
      var btxt = "+" + n.desc + " desc.";
      n._badge.textContent = btxt;
      n._badge.setAttribute("x", BOXW - 8);
      badgeW = btxt.length * 6.2 + 6;
    } else {
      n._badge.textContent = "";
    }
    if (n._dot) n._dot.setAttribute("x", BOXW - 8 - badgeW - 8);
    g.classList.toggle("fx-selected", n.id === selectedId);
    n._lbl.textContent = truncate(n.label || "", BOXW - 24, LBL_FONT);
  }

  function edgePath(p, c) {
    var x1 = p.px + BOXW, y1 = p.py + BOXH / 2;
    var x2 = c.px, y2 = c.py + BOXH / 2;
    var mx = x1 + (COLW - BOXW) / 2;
    return "M" + x1 + " " + y1 + " H" + mx + " V" + y2 + " H" + x2;
  }

  // ---------- render + tween ----------
  var animId = null, lastVisible = [];
  function render(animate) {
    var L = computeLayout();
    lastVisible = L.visible;
    var visSet = {};
    L.visible.forEach(function (n) { visSet[n.id] = true; });

    Object.keys(nodeEls).forEach(function (id) {
      if (!visSet[id]) { nodeEls[id].remove(); delete nodeEls[id]; }
    });
    Object.keys(edgeEls).forEach(function (cid) {
      if (!visSet[cid]) { edgeEls[cid].remove(); delete edgeEls[cid]; }
    });

    // enter / update (parents come before children in L.visible)
    L.visible.forEach(function (n) {
      if (!nodeEls[n.id]) {
        var g = makeNodeEl(n);
        nodeLayer.appendChild(g);
        nodeEls[n.id] = g;
        var src = n.parent && n.parent.px != null ? n.parent : null;
        n.px = src ? src.px : n.tx;
        n.py = src ? src.py : n.ty;
      }
      updateNodeEl(n);
    });
    L.edges.forEach(function (e) {
      var c = e[1];
      if (!edgeEls[c.id]) {
        var cls = "fx-edge";
        if (c.kind === "loop") cls += " fx-to-loop";
        if (c.kind === "truncated") cls += " fx-to-truncated";
        var p = svgEl("path", cls);
        edgeLayer.appendChild(p);
        edgeEls[c.id] = p;
      }
    });

    // tween px,py -> tx,ty
    if (animId) cancelAnimationFrame(animId);
    var starts = L.visible.map(function (n) {
      return [n, n.px != null ? n.px : n.tx, n.py != null ? n.py : n.ty];
    });
    var t0 = performance.now(), dur = animate ? 240 : 0;
    function frame(now) {
      var t = dur ? Math.min(1, (now - t0) / dur) : 1;
      var e = 1 - Math.pow(1 - t, 3);
      starts.forEach(function (s) {
        var n = s[0];
        n.px = s[1] + (n.tx - s[1]) * e;
        n.py = s[2] + (n.ty - s[2]) * e;
        nodeEls[n.id].setAttribute("transform", "translate(" + n.px + "," + n.py + ")");
      });
      L.edges.forEach(function (eg) {
        edgeEls[eg[1].id].setAttribute("d", edgePath(eg[0], eg[1]));
      });
      sections.forEach(function (s) { s.el.setAttribute("y", s.lty); });
      if (t < 1) animId = requestAnimationFrame(frame); else animId = null;
    }
    animId = requestAnimationFrame(frame);
  }

  // ---------- pan & zoom ----------
  var view = { x: 0, y: 0, k: 1 };
  function applyView() {
    viewport.setAttribute("transform",
      "translate(" + view.x + "," + view.y + ") scale(" + view.k + ")");
  }
  svg.addEventListener("wheel", function (e) {
    e.preventDefault();
    var f = Math.exp(-e.deltaY * 0.0012);
    var k2 = Math.min(2.5, Math.max(0.12, view.k * f));
    var r = svg.getBoundingClientRect();
    var mx = e.clientX - r.left, my = e.clientY - r.top;
    view.x = mx - (mx - view.x) * (k2 / view.k);
    view.y = my - (my - view.y) * (k2 / view.k);
    view.k = k2;
    applyView();
  }, { passive: false });

  var dragging = false, dragMoved = 0, lx = 0, ly = 0, downNode = null;
  svg.addEventListener("pointerdown", function (e) {
    dragging = true; dragMoved = 0; lx = e.clientX; ly = e.clientY;
    downNode = e.target.closest ? e.target.closest("g.fx-node") : null;
    svg.classList.add("fx-dragging");
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener("pointermove", function (e) {
    if (!dragging) return;
    var dx = e.clientX - lx, dy = e.clientY - ly;
    dragMoved += Math.abs(dx) + Math.abs(dy);
    view.x += dx; view.y += dy;
    lx = e.clientX; ly = e.clientY;
    applyView();
  });
  svg.addEventListener("pointerup", function (e) {
    dragging = false;
    svg.classList.remove("fx-dragging");
    // click = pointerup sem arrasto (pointer capture desvia o evento click p/ o svg)
    if (downNode && dragMoved <= 5) {
      var n = allNodes[+downNode.getAttribute("data-id")];
      selectedId = n.id;
      if (n.children.length) n.expanded = !n.expanded;
      hideTip();
      render(true);
    }
    downNode = null;
  });

  // ---------- tooltip (XSS-safe: só textContent) ----------
  function div(cls, text) {
    var d = document.createElement("div");
    d.className = cls; d.textContent = text;
    return d;
  }
  function showTip(n, cx, cy) {
    tip.replaceChildren();
    var kindLine = div("fx-tk", "");
    var kspan = document.createElement("span");
    kspan.textContent = (KIND_NAME[n.kind] || n.kind).toUpperCase();
    kindLine.appendChild(kspan);
    var wf = warnFlags(n);
    if (wf.length) {
      var w = document.createElement("span");
      w.className = "fx-warn";
      w.textContent = "  ·  " + wf.join(", ").toUpperCase();
      kindLine.appendChild(w);
    }
    tip.appendChild(kindLine);
    tip.appendChild(div("fx-tl", n.label || ""));
    if (n.detail) tip.appendChild(div("fx-td", n.detail));
    if (n.conds.length) {
      tip.appendChild(div("fx-tch", "CONDIÇÕES"));
      n.conds.forEach(function (c) { tip.appendChild(div("fx-tc", "· " + c)); });
    }
    if (n.children.length && !n.expanded) {
      tip.appendChild(div("fx-th", "+" + n.desc + " descendentes ocultos — clique para expandir"));
    } else if (n.children.length) {
      tip.appendChild(div("fx-th", n.children.length + " filhos diretos · clique para recolher"));
    }
    tip.style.display = "block";
    var tw = tip.offsetWidth, thh = tip.offsetHeight;
    var x = cx + 14, y = cy + 12;
    if (x + tw > window.innerWidth - 8) x = cx - tw - 14;
    if (y + thh > window.innerHeight - 8) y = window.innerHeight - thh - 8;
    tip.style.left = x + "px";
    tip.style.top = y + "px";
  }
  function hideTip() { tip.style.display = "none"; }
  nodeLayer.addEventListener("pointerover", function (e) {
    var g = e.target.closest("g.fx-node");
    if (!g) return;
    showTip(allNodes[+g.getAttribute("data-id")], e.clientX, e.clientY);
  });
  nodeLayer.addEventListener("pointermove", function (e) {
    var g = e.target.closest("g.fx-node");
    if (g && tip.style.display === "block" && !dragging)
      showTip(allNodes[+g.getAttribute("data-id")], e.clientX, e.clientY);
  });
  nodeLayer.addEventListener("pointerout", function (e) {
    var g = e.target.closest("g.fx-node");
    if (g) hideTip();
  });

  // ---------- fit view ----------
  function fitView(minK) {
    if (!lastVisible.length) return;
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    lastVisible.forEach(function (n) {
      if (n.tx < minX) minX = n.tx;
      if (n.tx + BOXW > maxX) maxX = n.tx + BOXW;
      if (n.ty < minY) minY = n.ty;
      if (n.ty + BOXH > maxY) maxY = n.ty + BOXH;
    });
    minY -= 36; // section label space
    var r = svg.getBoundingClientRect();
    var bw = maxX - minX, bh = maxY - minY;
    var k = Math.min((r.width - 120) / bw, (r.height - 60) / bh);
    k = Math.max(minK, Math.min(1, k));
    view.k = k;
    view.x = bw * k < r.width ? (r.width - bw * k) / 2 - minX * k : 60 - minX * k;
    view.y = bh * k < r.height ? (r.height - bh * k) / 2 - minY * k : 24 - minY * k;
    applyView();
  }

  // ---------- buttons ----------
  document.getElementById("fx-b-l2").addEventListener("click", function () {
    setDepth(2); render(true);
  });
  document.getElementById("fx-b-l4").addEventListener("click", function () {
    setDepth(4); render(true);
    setTimeout(function () { fitView(0.18); }, 260);
  });
  document.getElementById("fx-b-fit").addEventListener("click", function () {
    fitView(0.12);
  });

  // ---------- boot ----------
  render(false);
  fitView(0.62);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () {
      truncCache = {};
      lastVisible.forEach(updateNodeEl);
    });
  }
};
"""

# Vista metrô — linhas raiz→terminal (portada do demo viz-metro.html).
# Lazy: só roda na 1ª ativação. XSS-safe: dado de CRM só via textContent/setAttribute;
# o único innerHTML é o scaffold estático (sem interpolação de dado).
_JS_METRO = """
window.__amInitMetro = function () {
  "use strict";
  const DATA = JOURNEY;
  const rootEl = document.getElementById("view-metro");
  rootEl.innerHTML =
    '<aside class="mt-side">' +
    '<div class="mt-side-head"><div class="mt-t">Seletor de linha</div>' +
    '<div class="mt-c" id="mt-selcount">—</div></div>' +
    '<div class="mt-search"><input id="mt-q" type="text" ' +
    'placeholder="Buscar estação, evento, workflow…" autocomplete="off"></div>' +
    '<div id="mt-groups"></div>' +
    '</aside>' +
    '<div class="mt-mapwrap">' +
    '<div class="mt-maphead"><span class="mt-t">Linhas no mapa</span>' +
    '<span id="mt-chips"></span></div>' +
    '<div id="mt-scroller"></div>' +
    '<div class="mt-legend" id="mt-legend"></div>' +
    '</div>';
  let tipEl = document.getElementById("mt-tip");
  if (!tipEl) {
    tipEl = document.createElement("div");
    tipEl.id = "mt-tip";
    document.body.appendChild(tipEl);
  }

  /* ================= 1. journey tree -> station graph =================
     Semântica do JSON (journey.py): children de workflow/branch é uma SEQUÊNCIA
     de steps (com grupos de branches = alternativas no fim de cada walk; walks
     múltiplos concatenados = múltiplas raízes do workflow). children de effect
     são divergências assíncronas (eventos externos / envio p/ outro workflow).
     Convertendo para árvore de estações: nexts = continuações alternativas.  */
  let SID = 0;
  const END = new Set(['terminal','loop','truncated']);
  function mk(n){
    return {id:SID++, kind:n.kind, label:n.label||'', detail:n.detail||'',
            ttype:n.ttype||'', flags:n.flags||[], conds:n.conds||[], nexts:[], spawns:[]};
  }
  function makeStation(n){
    const st = mk(n);
    if(n.kind==='effect'){
      for(const c of (n.children||[])) st.spawns.push(makeStation(c)); // eventos / workflow alvo
    } else if(n.kind==='event'){
      st.nexts = (n.children||[]).map(makeStation);
    } else if(n.kind==='workflow' || n.kind==='branch'){
      st.nexts = convertSeq(n.children||[]);
    } else if(n.kind==='neutral_group'){
      st.detail = (n.children||[]).map(c=>c.label).join(' · ');
    }
    return st;
  }
  function convertSeq(items){
    const alts=[]; let i=0;
    while(i<items.length){ const r=buildWalk(items,i); alts.push(...r.alts); i=r.next; }
    return alts;
  }
  function buildWalk(items,i){
    const chain=[];
    while(i<items.length){
      const n=items[i];
      if(n.kind==='branch'){
        const forks=[];
        while(i<items.length && items[i].kind==='branch'){ forks.push(makeStation(items[i])); i++; }
        return {alts:linkChain(chain,forks), next:i};
      }
      const st=makeStation(n); chain.push(st); i++;
      if(END.has(n.kind)) return {alts:linkChain(chain,[]), next:i};
    }
    return {alts:linkChain(chain,[]), next:i};
  }
  function linkChain(chain,tail){
    if(!chain.length) return tail;
    for(let k=0;k<chain.length;k++){
      const cont = k<chain.length-1 ? [chain[k+1]] : tail;
      chain[k].nexts = cont.concat(chain[k].spawns);
    }
    return [chain[0]];
  }

  const ROOTS=[];
  for(const r of (DATA.criacao||[])) ROOTS.push({origin:'criação', st:makeStation(r)});
  for(const r of (DATA.anytime||[])) ROOTS.push({origin:'a qualquer momento', st:makeStation(r)});

  /* ================= 2. enumerar linhas (raiz -> folha) ================= */
  const LINES=[];
  /* loop real vs referência "já expandido acima": discriminado pela flag
     estrutural "ref" emitida em journey.py — nunca pelo texto do label */
  function isRealLoop(s){ return s.kind==='loop' && s.flags.indexOf('ref')<0; }
  function enumerate(st, path, origin){
    path.push(st);
    if(!st.nexts.length){
      const stations = path.slice();
      const leaf = stations[stations.length-1];
      const wf = stations.find(s=>s.kind==='workflow');
      let desc;
      if(leaf.kind==='terminal'){
        const prev=[...stations].reverse().find(
          s=>s.kind==='effect'||s.kind==='branch'||s.kind==='workflow');
        desc='fim · após '+(prev?prev.label:'início');
      } else desc=leaf.label;
      LINES.push({
        idx:LINES.length, stations, origin,
        group:(wf?wf.label:stations[0].label),
        desc,
        hasLoop:stations.some(isRealLoop),
        hasRef:leaf.kind==='loop'&&!isRealLoop(leaf),
        hasDecay:stations.some(s=>s.kind==='event'&&s.ttype==='opportunity_decay'),
        hasInactive:stations.some(s=>s.flags.indexOf('inactive')>=0),
        hasDraft:stations.some(s=>s.flags.indexOf('draft')>=0),
        hasTrunc:leaf.kind==='truncated',
        nEvents:stations.filter(s=>s.kind==='event').length,
      });
    } else for(const nx of st.nexts) enumerate(nx, path, origin);
    path.pop();
  }
  for(const r of ROOTS) enumerate(r.st, [], r.origin);

  /* grupos */
  const GROUPS=[];
  {
    const m=new Map();
    for(const L of LINES){
      const key=L.origin+' '+L.group;
      if(!m.has(key)){ m.set(key,{name:L.group, origin:L.origin, lines:[]}); GROUPS.push(m.get(key)); }
      m.get(key).lines.push(L.idx);
    }
    GROUPS.sort((a,b)=>b.lines.length-a.lines.length);
  }

  /* ================= 3. seleção ================= */
  const PALETTE=['#0043ce','#1192e8','#007d79','#6f6f6f','#003a6d']; // azuis/teals/cinzas (Carbon)
  let selected=[];               // [{idx,color}] FIFO máx 5
  const openGroups=new Set();

  function colorOf(idx){ const s=selected.find(x=>x.idx===idx); return s?s.color:null; }
  function toggleLine(idx){
    const i=selected.findIndex(x=>x.idx===idx);
    if(i>=0){ selected.splice(i,1); }
    else{
      if(selected.length>=5) selected.shift();           // FIFO
      const used=new Set(selected.map(s=>s.color));
      const color=PALETTE.find(c=>!used.has(c))||PALETTE[0];
      selected.push({idx,color});
    }
    renderAll();
  }

  /* pré-seleção: 1 com loop real, 1 com decay, 1 curta que compartilhe prefixo
     com uma das anteriores (mostra o trilho compartilhado + bifurcação em Y) */
  function sharedPrefixLen(A,B){
    let n=0;
    while(n<A.stations.length&&n<B.stations.length&&A.stations[n].id===B.stations[n].id) n++;
    return n;
  }
  (function preselect(){
    const order=[...LINES.keys()].sort((a,b)=>LINES[a].stations.length-LINES[b].stations.length);
    const picks=[];
    const used=new Set(), usedGroups=new Set();
    function pick(pred,sameGroupOk){
      let f=order.find(i=>!used.has(i)&&pred(LINES[i])&&(sameGroupOk||!usedGroups.has(LINES[i].group)));
      if(f===undefined) f=order.find(i=>!used.has(i)&&pred(LINES[i]));
      if(f!==undefined){ used.add(f); usedGroups.add(LINES[f].group); picks.push(f); }
    }
    pick(L=>L.hasLoop,false);
    pick(L=>L.hasDecay,false);
    // 3a: a mais curta que divide >=4 estacoes de prefixo com alguma ja escolhida
    pick(L=>!L.hasLoop&&!L.hasDecay&&picks.some(p=>sharedPrefixLen(L,LINES[p])>=4),true);
    if(picks.length<3) pick(L=>!L.hasRef&&L.stations.some(s=>s.kind==='effect'),false);
    picks.forEach((idx,i)=>selected.push({idx,color:PALETTE[i]}));
    selected.forEach(s=>openGroups.add(LINES[s.idx].origin+' '+LINES[s.idx].group));
  })();

  /* ================= 4. sidebar ================= */
  function lineId(i){ return 'L'+String(i+1).padStart(3,'0'); }
  function lineMatches(L,q){
    if(!q) return true;
    if(L.group.toLowerCase().includes(q)||L.desc.toLowerCase().includes(q)) return true;
    return L.stations.some(s=>s.label.toLowerCase().includes(q)||s.detail.toLowerCase().includes(q));
  }
  function renderSidebar(){
    const q=document.getElementById('mt-q').value.trim().toLowerCase();
    const root=document.getElementById('mt-groups');
    root.textContent='';
    let visible=0;
    for(const g of GROUPS){
      const ids=g.lines.filter(i=>lineMatches(LINES[i],q));
      if(!ids.length) continue;
      visible+=ids.length;
      const key=g.origin+' '+g.name;
      const open=q?true:openGroups.has(key);
      const grp=document.createElement('div'); grp.className='mt-grp';
      const h=document.createElement('div'); h.className='mt-grph';
      const ar=document.createElement('span'); ar.className='mt-arrow'; ar.textContent=open?'▾':'▸';
      const nm=document.createElement('span'); nm.className='mt-name'; nm.textContent=g.name;
      nm.title=g.name;
      const og=document.createElement('span'); og.className='mt-origin'; og.textContent=g.origin;
      const n=document.createElement('span'); n.className='mt-n'; n.textContent=String(ids.length);
      h.appendChild(ar); h.appendChild(nm); h.appendChild(og); h.appendChild(n);
      h.addEventListener('click',()=>{ open?openGroups.delete(key):openGroups.add(key); renderSidebar(); });
      grp.appendChild(h);
      if(open){
        for(const i of ids){
          const L=LINES[i];
          const row=document.createElement('div');
          row.className='mt-linerow'+(colorOf(i)?' mt-sel':'');
          const sw=document.createElement('span'); sw.className='mt-sw';
          if(colorOf(i)) sw.style.background=colorOf(i);
          const main=document.createElement('div'); main.className='mt-lrmain';
          const d1=document.createElement('div'); d1.className='mt-lrdesc';
          d1.textContent=L.desc; d1.title=L.desc;
          const d2=document.createElement('div'); d2.className='mt-lrsub';
          d2.textContent=lineId(i)+' · '+L.stations.length+' estações · '
            +L.nEvents+' evento'+(L.nEvents===1?'':'s');
          main.appendChild(d1); main.appendChild(d2);
          const bs=document.createElement('div'); bs.className='mt-badges';
          const bdg=(t,cls)=>{const b=document.createElement('span');
            b.className='mt-bdg'+(cls?' '+cls:'');b.textContent=t;bs.appendChild(b);};
          if(L.hasLoop) bdg('LOOP','mt-loop');
          if(L.hasDecay) bdg('DECAY','');
          if(L.hasInactive) bdg('INATIVO','mt-inactive');
          if(L.hasDraft) bdg('DRAFT','mt-draft');
          if(L.hasRef) bdg('REF','');
          if(L.hasTrunc) bdg('TRUNC','mt-trunc');
          row.appendChild(sw); row.appendChild(main); row.appendChild(bs);
          row.addEventListener('click',()=>toggleLine(i));
          grp.appendChild(row);
        }
      }
      root.appendChild(grp);
    }
    document.getElementById('mt-selcount').textContent =
      visible+' de '+LINES.length+' linhas · '+selected.length+' no mapa (máx 5, FIFO)';
  }
  document.getElementById('mt-q').addEventListener('input',renderSidebar);

  /* ================= 5. mapa (SVG, layout estilo git-graph / metrô vertical) ================= */
  const KIND_STYLE={
    event:   {stroke:'#697077'},
    workflow:{stroke:'#161616'},
    branch:  {stroke:'#a8a8a8'},
    effect:  {stroke:'#8d8d8d'},
    neutral_group:{stroke:'#a8a8a8'},
    terminal:{stroke:'#525252'},
    loop:    {stroke:'#b28600'},
    truncated:{stroke:'#da1e28'},
  };
  const ROW_H=27, LANE_W=26, PAD_L=34, PAD_T=26, SPREAD=3.2;
  const SVGNS='http://www.w3.org/2000/svg';
  function svgel(t,attrs){ const e=document.createElementNS(SVGNS,t);
    for(const k in attrs) e.setAttribute(k,attrs[k]); return e; }

  let pinnedRow=null;

  function renderMap(){
    const scroller=document.getElementById('mt-scroller');
    scroller.textContent='';
    pinnedRow=null;
    const chips=document.getElementById('mt-chips');
    chips.textContent='';
    for(const s of selected){
      const L=LINES[s.idx];
      const ch=document.createElement('span'); ch.className='mt-chip';
      const dot=document.createElement('span'); dot.className='mt-dot'; dot.style.background=s.color;
      const id=document.createElement('span'); id.className='mt-lid'; id.textContent=lineId(s.idx);
      const tx=document.createElement('span');
      tx.textContent=(L.group.length>26?L.group.slice(0,25)+'…':L.group)
        +' · '+(L.desc.length>34?L.desc.slice(0,33)+'…':L.desc);
      const x=document.createElement('span'); x.className='mt-x'; x.textContent='✕';
      ch.appendChild(dot); ch.appendChild(id); ch.appendChild(tx); ch.appendChild(x);
      ch.addEventListener('click',()=>toggleLine(s.idx));
      chips.appendChild(ch);
    }
    if(!selected.length){
      const d=document.createElement('div'); d.id='mt-empty';
      d.textContent='Nenhuma linha selecionada. Escolha até 5 linhas no seletor à esquerda — '
        +'cada caminho raiz → terminal vira uma linha de metrô vertical; trechos de trilho '
        +'compartilhados indicam prefixo de jornada em comum.';
      scroller.appendChild(d);
      return;
    }

    /* união das linhas selecionadas -> subárvore renderizada */
    const inUnion=new Set();
    const lineSet=selected.map(s=>LINES[s.idx]);
    for(const L of lineSet) for(const s of L.stations) inUnion.add(s.id);
    const through=new Map(); // station id -> [slot,...] (ordem de seleção)
    lineSet.forEach((L,si)=>{ for(const s of L.stations){
      if(!through.has(s.id)) through.set(s.id,[]);
      through.get(s.id).push(si);
    }});

    /* layout: linhas (rows) em pré-ordem; lanes: 1º filho herda, demais ganham
       lane nova. Lanes resetam por árvore-raiz (ranges de rows são disjuntos). */
    const rows=[]; let lanes=1;
    function layout(st,lane,alloc){
      st._row=rows.length; rows.push(st); st._lane=lane;
      const kids=st.nexts.filter(n=>inUnion.has(n.id));
      kids.forEach((k,i)=>{ layout(k, i===0?lane:++alloc.max, alloc); });
    }
    for(const r of ROOTS) if(inUnion.has(r.st.id)){
      const alloc={max:0};
      layout(r.st, 0, alloc);
      lanes=Math.max(lanes, alloc.max+1);
    }
    const laneX=l=>PAD_L+l*LANE_W;
    const rowY=r=>PAD_T+r*ROW_H;
    const labelX=PAD_L+lanes*LANE_W+16;
    const W=Math.max(900,labelX+760), H=rowY(rows.length-1)+34;
    const svg=svgel('svg',{width:W,height:H,viewBox:'0 0 '+W+' '+H});

    function off(st,si){
      const arr=through.get(st.id);
      return (arr.indexOf(si)-(arr.length-1)/2)*SPREAD;
    }
    /* trilhos: um <g> por linha; segmento a segmento (tracejado ao entrar em evento) */
    const lineGroups=[];
    lineSet.forEach((L,si)=>{
      const g=svgel('g',{class:'mt-lineg','data-si':si});
      for(let k=0;k<L.stations.length-1;k++){
        const a=L.stations[k], b=L.stations[k+1];
        const x1=laneX(a._lane)+off(a,si), y1=rowY(a._row);
        const x2=laneX(b._lane)+off(b,si), y2=rowY(b._row);
        let d;
        if(Math.abs(x2-x1)<0.5) d='M'+x1+' '+y1+' L'+x2+' '+y2;
        else{
          const dx=Math.abs(x2-x1);
          if(y2-y1>=dx+8) d='M'+x1+' '+y1+' L'+x1+' '+(y1+4)+' L'+x2+' '+(y1+4+dx)+' L'+x2+' '+y2;
          else d='M'+x1+' '+y1+' L'+x2+' '+y2;
        }
        const p=svgel('path',{class:'mt-seg',d,stroke:selected[si].color,'stroke-width':3});
        if(b.kind==='event') p.setAttribute('stroke-dasharray','2.5 4'); // baldeação: depende de evento externo
        g.appendChild(p);
      }
      g.addEventListener('mouseenter',()=>{
        lineGroups.forEach(o=>{ if(o!==g) o.classList.add('mt-dimmed'); }); });
      g.addEventListener('mouseleave',()=>{
        lineGroups.forEach(o=>o.classList.remove('mt-dimmed')); });
      lineGroups.push(g); svg.appendChild(g);
    });

    /* estações */
    const stG=svgel('g',{});
    for(const st of rows){
      const cx=laneX(st._lane), cy=rowY(st._row);
      const ks=KIND_STYLE[st.kind]||KIND_STYLE.effect;
      if(st.kind==='event'){
        stG.appendChild(svgel('circle',{cx,cy,r:7,fill:'#fff',stroke:ks.stroke,'stroke-width':2}));
        stG.appendChild(svgel('circle',{cx,cy,r:2.8,fill:ks.stroke}));
      } else if(st.kind==='workflow'){
        stG.appendChild(svgel('circle',{cx,cy,r:7,fill:'#161616'}));
        stG.appendChild(svgel('circle',{cx,cy,r:2.4,fill:'#fff'}));
      } else if(st.kind==='terminal'){
        stG.appendChild(svgel('rect',{x:cx-7,y:cy-2.5,width:14,height:5,fill:'#525252'}));
      } else if(st.kind==='loop'){
        if(isRealLoop(st)){
          stG.appendChild(svgel('circle',{cx,cy,r:6.5,fill:'#f1c21b',stroke:'#8e6a00','stroke-width':1.5}));
        } else {
          stG.appendChild(svgel('circle',{cx,cy,r:5,fill:'#fff',stroke:'#a8a8a8','stroke-width':1.5,
            'stroke-dasharray':'2 2'}));
        }
      } else if(st.kind==='truncated'){
        stG.appendChild(svgel('circle',{cx,cy,r:6,fill:'#da1e28'}));
      } else if(st.kind==='branch'){
        stG.appendChild(svgel('circle',{cx,cy,r:4,fill:'#fff',stroke:ks.stroke,'stroke-width':1.6}));
      } else if(st.kind==='neutral_group'){
        stG.appendChild(svgel('circle',{cx,cy,r:4,fill:'#e0e0e0',stroke:'#a8a8a8','stroke-width':1.2}));
      } else { // effect
        stG.appendChild(svgel('circle',{cx,cy,r:5.5,fill:'#fff',stroke:ks.stroke,'stroke-width':2}));
      }

      /* rótulo (XSS-safe: tspans só com textContent) */
      const t=svgel('text',{x:labelX,y:cy+4});
      if(st.kind==='event') t.setAttribute('class','mt-ev');
      else if(st.kind==='workflow') t.setAttribute('class','mt-wf');
      else if(st.kind==='branch'||st.kind==='neutral_group'||st.kind==='terminal')
        t.setAttribute('class','mt-dim2');
      let lab=st.label;
      if(st.kind==='branch') lab='ramo: '+(lab.trim()||'—');
      if(lab.length>64) lab=lab.slice(0,63)+'…';
      const tl=document.createElementNS(SVGNS,'tspan'); tl.textContent=lab; t.appendChild(tl);
      if(st.detail){
        const td=document.createElementNS(SVGNS,'tspan');
        td.setAttribute('class','mt-det'); td.setAttribute('dx','8');
        let det=st.detail; if(det.length>52) det=det.slice(0,51)+'…';
        td.textContent=det; t.appendChild(td);
      }
      if(st.conds.length){
        const tc=document.createElementNS(SVGNS,'tspan');
        tc.setAttribute('class','mt-cnd'); tc.setAttribute('dx','8');
        tc.textContent='['+st.conds.length+' cond]'; t.appendChild(tc);
      }
      for(const f of st.flags){
        if(f==='ref') continue; // estrutural (glifo tracejado já comunica)
        const tf=document.createElementNS(SVGNS,'tspan');
        tf.setAttribute('class','mt-flag'); tf.setAttribute('dx','8');
        tf.textContent=f==='inactive'?'INATIVO':f.toUpperCase();
        tf.setAttribute('fill', f==='missing'?'#da1e28':'#8e6a00');
        t.appendChild(tf);
      }
      stG.appendChild(t);
    }
    svg.appendChild(stG);

    /* hit rows: tooltip + clique fixa */
    const hitG=svgel('g',{});
    for(const st of rows){
      const r=svgel('rect',{class:'mt-hitrow',x:0,y:rowY(st._row)-ROW_H/2,width:W,height:ROW_H});
      r.addEventListener('mousemove',e=>{ if(!pinned) showTip(st,e.clientX,e.clientY,false); });
      r.addEventListener('mouseleave',()=>{ if(!pinned) hideTip(); });
      r.addEventListener('click',e=>{
        e.stopPropagation();
        if(pinnedRow===r){ unpin(); return; }
        if(pinnedRow) pinnedRow.classList.remove('mt-pinned');
        pinnedRow=r; r.classList.add('mt-pinned');
        showTip(st,e.clientX,e.clientY,true);
      });
      hitG.appendChild(r);
    }
    svg.appendChild(hitG);
    scroller.appendChild(svg);
  }

  /* ================= 6. tooltip (XSS-safe: só textContent) ================= */
  const tip=tipEl;
  let pinned=false;
  const KIND_PT={event:'evento externo · baldeação',workflow:'workflow',branch:'ramo',
    effect:'efeito',neutral_group:'steps neutros (condensados)',terminal:'terminal',
    loop:'loop / referência',truncated:'truncado'};
  function showTip(st,mx,my,pin){
    tip.textContent='';
    const k=document.createElement('div'); k.className='mt-k';
    k.textContent=KIND_PT[st.kind]||st.kind;
    tip.appendChild(k);
    const l=document.createElement('div'); l.className='mt-l'; l.textContent=st.label;
    tip.appendChild(l);
    if(st.detail){ const d=document.createElement('div'); d.className='mt-d';
      d.textContent=st.detail; tip.appendChild(d); }
    for(const f of st.flags){
      if(f==='ref') continue; // estrutural ("loop / referência" já diz)
      const fl=document.createElement('span'); fl.className='mt-fl'+(f==='missing'?' mt-red':'');
      fl.textContent=f==='inactive'?'INATIVO':f.toUpperCase(); tip.appendChild(fl);
    }
    if(st.conds.length){
      const c=document.createElement('div'); c.className='mt-cnds';
      for(const cond of st.conds){
        const ci=document.createElement('div'); ci.className='mt-cnd';
        ci.textContent='• '+cond; c.appendChild(ci);
      }
      tip.appendChild(c);
    }
    const arr=[]; selected.forEach((s,si)=>{
      if(LINES[s.idx].stations.some(x=>x.id===st.id)) arr.push(lineId(s.idx)); });
    if(arr.length){ const ln=document.createElement('div'); ln.className='mt-ln';
      ln.textContent='passa por aqui: '+arr.join(' · '); tip.appendChild(ln); }
    tip.style.display='block';
    tip.classList.toggle('mt-pin',pin);
    pinned=pin;
    const r=tip.getBoundingClientRect();
    let x=mx+16, y=my+14;
    if(x+r.width>window.innerWidth-10) x=mx-r.width-12;
    if(y+r.height>window.innerHeight-10) y=my-r.height-12;
    tip.style.left=Math.max(6,x)+'px'; tip.style.top=Math.max(6,y)+'px';
  }
  function hideTip(){ tip.style.display='none'; }
  function unpin(){ pinned=false;
    if(pinnedRow){pinnedRow.classList.remove('mt-pinned'); pinnedRow=null;} hideTip(); }
  document.addEventListener('click',e=>{ if(pinned && !tip.contains(e.target)) unpin(); });
  document.addEventListener('keydown',e=>{ if(e.key==='Escape') unpin(); });

  /* ================= 7. legenda ================= */
  (function legend(){
    const wrap=document.getElementById('mt-legend');
    function item(label,draw){
      const d=document.createElement('span'); d.className='mt-leg';
      const s=svgel('svg',{width:18,height:16,viewBox:'0 0 18 16'}); draw(s);
      const t=document.createElement('span'); t.textContent=label;
      d.appendChild(s); d.appendChild(t); wrap.appendChild(d);
    }
    item('workflow',s=>{ s.appendChild(svgel('circle',{cx:9,cy:8,r:6,fill:'#161616'}));
                         s.appendChild(svgel('circle',{cx:9,cy:8,r:2,fill:'#fff'})); });
    item('efeito',s=>s.appendChild(svgel('circle',{cx:9,cy:8,r:5,fill:'#fff',
      stroke:'#8d8d8d','stroke-width':2})));
    item('evento externo (baldeação · trecho tracejado)',s=>{
      s.appendChild(svgel('circle',{cx:9,cy:8,r:6,fill:'#fff',stroke:'#697077','stroke-width':2}));
      s.appendChild(svgel('circle',{cx:9,cy:8,r:2.4,fill:'#697077'})); });
    item('ramo',s=>s.appendChild(svgel('circle',{cx:9,cy:8,r:3.5,fill:'#fff',
      stroke:'#a8a8a8','stroke-width':1.6})));
    item('terminal',s=>s.appendChild(svgel('rect',{x:3,y:6,width:12,height:4,fill:'#525252'})));
    item('loop',s=>s.appendChild(svgel('circle',{cx:9,cy:8,r:5.5,fill:'#f1c21b',
      stroke:'#8e6a00','stroke-width':1.5})));
    item('já expandido (ref)',s=>s.appendChild(svgel('circle',{cx:9,cy:8,r:4.5,fill:'#fff',
      stroke:'#a8a8a8','stroke-width':1.5,'stroke-dasharray':'2 2'})));
  })();

  /* ================= go ================= */
  function renderAll(){ renderSidebar(); renderMap(); }
  renderAll();
};
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
<div class="jviews" role="tablist">
  <button type="button" data-jview="lista" class="jview-active">Lista</button>
  <button type="button" data-jview="flux">Fluxograma</button>
  <button type="button" data-jview="metro">Metrô</button>
</div>
<div id="view-lista">
<div class="jbar">
  <input data-jfilter placeholder="filtrar na árvore..." autocomplete="off">
  <button data-jexpand>expandir tudo</button>
  <button data-jcollapse>recolher tudo</button>
</div>
{trees}
</div>
<div id="view-flux"></div>
<div id="view-metro"></div>
</main>
<script>
const JOURNEY = {journey_json};
{js_flux}
{js_metro}
{js}
</script>
</body></html>"""


def _tree_section(title: str, nodes: list[dict], empty: str) -> str:
    body = (
        "".join(_node_html(n) for n in nodes)
        if nodes
        else f'<div class="jleaf"><span class="jdet">{_esc(empty)}</span></div>'
    )
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
    trees = _tree_section(
        "Contato criado", data["criacao"], "nenhum trigger de criação de contato no dump"
    ) + _tree_section("A qualquer momento", data["anytime"], "nenhum evento sem âncora interna")
    html = _TEMPLATE.format(
        title=_esc(title or meta.get("locationId") or "dump"),
        head_assets=head_assets(),
        page_css=_PAGE_CSS,
        topbar=topbar(
            meta.get("locationId", ""),
            _extracted_from_path(out) or str(meta.get("extractedAt") or ""),
            schema=sm.get("schema"),
        ),
        sidebar=sidebar("journey", sm.get("counts")),
        loc=_esc(meta.get("locationId", "")),
        sub=_esc(" · ".join(sub_parts)),
        trees=trees,
        journey_json=_safe_json(data),
        js_flux=_JS_FLUX,
        js_metro=_JS_METRO,
        js=_JS,
    )
    out.write_text(html, encoding="utf-8")
    return out
