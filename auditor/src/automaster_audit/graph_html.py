"""Renderiza o grafo de conexões como HTML interativo — tema "Sala de Controle" (vis-network).

Shell compartilhado (topbar + sidebar) vem de theme.py. Canvas claro (#f4f4f4)
ocupando o main inteiro; card de controles flutua no canto superior esquerdo.
Única exceção ao "zero requests externos": vis-network via CDN com SRI.
"""
from __future__ import annotations

import html as _html
import json
import re
from pathlib import Path

from .theme import GRAPH_COLORS, head_assets, shell_meta, sidebar, topbar


def _safe_json(obj) -> str:
    """JSON seguro para embutir em <script>: neutraliza fechamento de tag e separadores JS."""
    return (
        json.dumps(obj, ensure_ascii=False)
        .replace("</", "<\\/")
        .replace("<!--", "<\\!--")
        .replace(chr(0x2028), "\\u2028")
        .replace(chr(0x2029), "\\u2029")
    )


_DUMP_DIR_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})$")


def _extracted_from_path(out_path: Path) -> str:
    """Data de extração inferida do nome da pasta do dump (YYYY-MM-DD_HHmm)."""
    m = _DUMP_DIR_RE.match(out_path.parent.name)
    return f"{m.group(1)} {m.group(2)}:{m.group(3)}" if m else ""


# CSS específico da página (chaves não passam pelo str.format: injetado como VALOR).
_PAGE_CSS = """
.graph-main{position:relative;margin:48px 0 0 256px;height:calc(100vh - 48px);overflow:hidden}
.graph-main #net{width:100%;height:100%;background:var(--bg)}
#panel{position:absolute;width:240px}
@media(max-width:900px){.graph-main{margin-left:0}}
"""


_TEMPLATE = """<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AUTOMASTER // GRAFO {title}</title>
<script src="https://unpkg.com/vis-network@9.1.9/standalone/umd/vis-network.min.js"
  integrity="sha384-yxKDWWf0wwdUj/gPeuL11czrnKFQROnLgY8ll7En9NYoXibgg3C6NK/UDHNtUgWJ"
  crossorigin="anonymous"></script>
{head_assets}
<style>{page_css}</style>
</head>
<body>
{topbar}
{sidebar}
<main class="graph-main">
<div id="net"></div>
<div id="panel">
  <div class="sub">{n_nodes} nós / {n_edges} links</div>
  <div id="filters"></div>
  <input id="search" placeholder="buscar nó" autocomplete="off">
  <div id="legend-missing">▦ vermelho = referência quebrada</div>
  <div id="legend-cycle">▦ âmbar = aresta em ciclo</div>
  <div id="info">clique num nó: acende vizinhos</div>
</div>
</main>
<script>
const DATA = {data};
const COLORS = {colors};
const MISSING = '#da1e28';
const CYCLE = '#f1c21b';
const CYCLE_INK = '#684e00';
const INK = '#161616';
const FADE_BORDER = '#e0e0e0';
const FADE_LABEL = '#c6c6c6';
const EDGE = '#c6c6c6';
const EDGE_HI = '#0f62fe';
const LABELS = {{workflow:"Workflows",tag:"Tags",pipeline:"Pipelines",stage:"Stages",field:"Custom fields",trigger:"Triggers",user:"Usuários"}};
const SHAPES = {{workflow:'box',trigger:'triangle',tag:'dot',pipeline:'diamond',stage:'square',field:'hexagon',user:'star'}};
const missingSet = new Set(DATA.nodes.filter(n=>n.missing).map(n=>n.id));

/* aresta em ciclo: add_to_workflow cujo destino alcança a origem
   (mesma semântica do achado workflow_call_cycle da camada 1) */
const wfAdj = {{}};
DATA.edges.forEach(e => {{ if(e.rel==='add_to_workflow'){{ (wfAdj[e.from] = wfAdj[e.from]||[]).push(e.to); }} }});
function reaches(src, dst) {{
  const seen = new Set([src]); const stack = [src];
  while(stack.length) {{
    const n = stack.pop();
    if(n===dst) return true;
    (wfAdj[n]||[]).forEach(m => {{ if(!seen.has(m)){{ seen.add(m); stack.push(m); }} }});
  }}
  return false;
}}
const cycleEdges = new Set();
DATA.edges.forEach((e,i) => {{ if(e.rel==='add_to_workflow' && reaches(e.to, e.from)) cycleEdges.add(i); }});
if(!cycleEdges.size) document.getElementById('legend-cycle').style.display='none';

/* labels longos truncados; título completo no tooltip (elemento DOM = XSS-safe) */
const tlabel = s => {{ s = String(s||''); return s.length>32 ? s.slice(0,31)+'…' : s; }};
const tipEl = s => {{ const el = document.createElement('div'); el.textContent = s; return el; }};

const allNodes = DATA.nodes.map(n => ({{
  id:n.id, label:tlabel(n.label), group:n.type,
  title:(String(n.label||'').length>32 ? tipEl(n.label) : undefined),
  color:{{background:'#ffffff', border:n.missing?MISSING:COLORS[n.type],
    highlight:{{background:'#ffffff', border:EDGE_HI}}}},
  borderWidth:n.missing?2.5:1.5,
  shape:SHAPES[n.type]||'dot',
  size:n.type==='workflow'?16:9,
  shapeProperties:{{borderDashes:n.missing?[4,3]:false}},
  font:{{color:n.missing?MISSING:INK, size:12, face:'IBM Plex Sans'}}
}}));
const allEdges = DATA.edges.map((e,i) => {{
  const cyc = cycleEdges.has(i);
  return {{
    id:i, from:e.from, to:e.to, label:cyc?'ciclo ⇄':e.rel, cycle:cyc,
    arrows:'to', width:cyc?2.5:Math.min(1+e.weight,5),
    color:{{color:cyc?CYCLE:EDGE,highlight:EDGE_HI,opacity:1}},
    font:{{color:cyc?CYCLE_INK:'#8d8d8d',size:cyc?10:9,strokeWidth:2,strokeColor:'#f4f4f4',face:'IBM Plex Mono'}},
    smooth:{{type:'continuous'}}
  }};
}});

const nodes = new vis.DataSet(allNodes);
const edges = new vis.DataSet(allEdges);
const container = document.getElementById('net');
const network = new vis.Network(container, {{nodes,edges}}, {{
  physics:{{stabilization:true,barnesHut:{{gravitationalConstant:-3000,springLength:200,centralGravity:0.4,avoidOverlap:0.5}}}},
  interaction:{{hover:true,tooltipDelay:120}},
  nodes:{{font:{{face:'IBM Plex Sans'}}}}
}});
if(document.fonts && document.fonts.ready) document.fonts.ready.then(()=>network.redraw());

/* deep-link do dashboard: graph.html#wf:<id> seleciona e centra o nó */
const wanted = decodeURIComponent((location.hash||'').slice(1));
if(wanted) {{
  const target = allNodes.find(n => n.id===wanted || n.id==='wf:'+wanted);
  if(target) network.once('stabilizationIterationsDone', () => {{
    network.selectNodes([target.id]);
    network.focus(target.id, {{scale:1.1, animation:true}});
    network.emit('click', {{nodes:[target.id]}});
  }});
}}

const types = [...new Set(DATA.nodes.map(n=>n.type))];
const filtersDiv = document.getElementById('filters');
const active = new Set(types);
types.forEach(t => {{
  const l = document.createElement('label');
  l.innerHTML = `<input type=checkbox checked data-t="${{t}}"><span class=dot style="background:${{COLORS[t]}};color:${{COLORS[t]}}"></span>${{LABELS[t]||t}}`;
  filtersDiv.appendChild(l);
}});
filtersDiv.addEventListener('change', e => {{
  const t = e.target.dataset.t;
  if(e.target.checked) active.add(t); else active.delete(t);
  applyFilter();
}});
function applyFilter() {{
  const visibleIds = new Set(allNodes.filter(n=>active.has(n.group)).map(n=>n.id));
  nodes.update(allNodes.map(n=>({{id:n.id, hidden:!active.has(n.group)}})));
  edges.update(allEdges.map(e=>({{id:e.id, hidden:!(visibleIds.has(e.from)&&visibleIds.has(e.to))}})));
}}

network.on('click', params => {{
  if(params.nodes.length===0){{ resetHighlight(); return; }}
  const sel = params.nodes[0];
  const conn = new Set([sel]);
  allEdges.forEach(e=>{{ if(e.from===sel)conn.add(e.to); if(e.to===sel)conn.add(e.from); }});
  nodes.update(allNodes.map(n=>({{
    id:n.id,
    color:conn.has(n.id)
      ?{{background:'#ffffff',border:(n.id===sel?EDGE_HI:(missingSet.has(n.id)?MISSING:COLORS[n.group]))}}
      :{{background:'#ffffff',border:FADE_BORDER}},
    font:{{color:conn.has(n.id)?(missingSet.has(n.id)?MISSING:INK):FADE_LABEL, size:12, face:'IBM Plex Sans'}}
  }})));
  edges.update(allEdges.map(e=>({{
    id:e.id,
    color:{{color:(e.from===sel||e.to===sel)?EDGE_HI:(e.cycle?CYCLE:FADE_BORDER)}},
    font:{{color:(e.from===sel||e.to===sel)?EDGE_HI:(e.cycle?CYCLE_INK:FADE_LABEL),size:e.cycle?10:9,strokeWidth:2,strokeColor:'#f4f4f4',face:'IBM Plex Mono'}}
  }})));
}});
function resetHighlight(){{
  nodes.update(allNodes.map(n=>({{id:n.id,
    color:{{background:'#ffffff',border:missingSet.has(n.id)?MISSING:COLORS[n.group]}},
    font:{{color:missingSet.has(n.id)?MISSING:INK,size:12,face:'IBM Plex Sans'}}}})));
  edges.update(allEdges.map(e=>({{id:e.id,color:{{color:e.cycle?CYCLE:EDGE}},
    font:{{color:e.cycle?CYCLE_INK:'#8d8d8d',size:e.cycle?10:9,strokeWidth:2,strokeColor:'#f4f4f4',face:'IBM Plex Mono'}}}})));
}}

document.getElementById('search').addEventListener('input', e => {{
  const q = e.target.value.trim().toLowerCase();
  if(!q) return;
  const hit = allNodes.find(n => (n.label||'').toLowerCase().includes(q));
  if(hit){{ network.selectNodes([hit.id]); network.focus(hit.id,{{scale:1.2,animation:true}});
    network.emit('click',{{nodes:[hit.id]}}); }}
}});
</script>
</body>
</html>"""


def write_graph_html(graph: dict, out_path: Path, title: str = "") -> Path:
    out_path = Path(out_path)
    loc = title or "dump"
    meta = shell_meta(out_path.parent)  # mesmos contadores da sidebar do dashboard
    html = _TEMPLATE.format(
        title=_html.escape(loc),
        head_assets=head_assets(),
        page_css=_PAGE_CSS,
        topbar=topbar(loc, _extracted_from_path(out_path), schema=meta["schema"]),
        sidebar=sidebar("graph", counts=meta["counts"]),
        n_nodes=len(graph["nodes"]),
        n_edges=len(graph["edges"]),
        data=_safe_json(graph),
        colors=_safe_json(GRAPH_COLORS),
    )
    out_path.write_text(html, encoding="utf-8")
    return out_path
