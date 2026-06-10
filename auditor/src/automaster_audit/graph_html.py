"""Renderiza o grafo de conexões como HTML interativo, tema Tron/Encom (vis-network)."""
from __future__ import annotations

import html as _html
import json
from pathlib import Path

from .theme import GRAPH_COLORS, head_assets, overlays


def _safe_json(obj) -> str:
    """JSON seguro para embutir em <script>: neutraliza fechamento de tag e separadores JS."""
    return (
        json.dumps(obj, ensure_ascii=False)
        .replace("</", "<\\/")
        .replace("<!--", "<\\!--")
        .replace(chr(0x2028), "\\u2028")
        .replace(chr(0x2029), "\\u2029")
    )


_TEMPLATE = """<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>ENCOM OS // GRAFO {title}</title>
<script src="https://unpkg.com/vis-network@9.1.9/standalone/umd/vis-network.min.js"
  integrity="sha384-yxKDWWf0wwdUj/gPeuL11czrnKFQROnLgY8ll7En9NYoXibgg3C6NK/UDHNtUgWJ"
  crossorigin="anonymous"></script>
{head_assets}
</head>
<body>
{overlays}
<div id="panel" class="panel framed">
  <div class="hud-top"><span class="dot-online"></span><span class="sub">ENCOM OS // GRAFO</span></div>
  <h1>Conexões GHL</h1>
  <div class="sub">{title} · {n_nodes} nós / {n_edges} links</div>
  <div id="filters"></div>
  <input id="search" placeholder="// buscar nó" autocomplete="off">
  <div id="legend-missing">◆ borda vermelha = referência quebrada</div>
  <div id="info">clique num nó: acende vizinhos</div>
</div>
<div id="net"></div>
<script>
const DATA = {data};
const COLORS = {colors};
const MISSING = '#ff4d6d';
const LABELS = {{workflow:"Workflows",tag:"Tags",pipeline:"Pipelines",stage:"Stages",field:"Custom fields",trigger:"Triggers"}};
const missingSet = new Set(DATA.nodes.filter(n=>n.missing).map(n=>n.id));

const allNodes = DATA.nodes.map(n => ({{
  id:n.id, label:n.label, group:n.type,
  color:{{background:'#06121a', border:n.missing?MISSING:COLORS[n.type],
    highlight:{{background:'#0a2230', border:'#ffffff'}}}},
  borderWidth:n.missing?3:1.5,
  shape:n.type==='workflow'?'box':'dot',
  size:n.type==='workflow'?16:11,
  shadow:{{enabled:true, color:(n.missing?MISSING:COLORS[n.type]), size:16, x:0, y:0}},
  font:{{color:n.missing?MISSING:COLORS[n.type], size:12, face:'Share Tech Mono'}}
}}));
const allEdges = DATA.edges.map((e,i) => ({{
  id:i, from:e.from, to:e.to, label:e.rel,
  arrows:'to', width:Math.min(1+e.weight,5),
  color:{{color:'#0a6e7a',highlight:'#2ee6ff',opacity:.7}},
  font:{{color:'#5b8c97',size:9,strokeWidth:0,face:'Share Tech Mono'}},
  smooth:{{type:'continuous'}}
}}));

const nodes = new vis.DataSet(allNodes);
const edges = new vis.DataSet(allEdges);
const container = document.getElementById('net');
const network = new vis.Network(container, {{nodes,edges}}, {{
  physics:{{stabilization:true,barnesHut:{{gravitationalConstant:-8000,springLength:140}}}},
  interaction:{{hover:true,tooltipDelay:120}},
  nodes:{{font:{{face:'Share Tech Mono'}}}}
}});

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
    color:conn.has(n.id)?{{background:'#06121a',border:(n.id===sel?'#ffffff':COLORS[n.group])}}:{{background:'#0a0f14',border:'#1d2b33'}},
    font:{{color:conn.has(n.id)?(missingSet.has(n.id)?MISSING:COLORS[n.group]):'#33444c', size:12, face:'Share Tech Mono'}}
  }})));
  edges.update(allEdges.map(e=>({{
    id:e.id,
    color:{{color:(e.from===sel||e.to===sel)?'#2ee6ff':'#13242b'}}
  }})));
}});
function resetHighlight(){{
  nodes.update(allNodes.map(n=>({{id:n.id,
    color:{{background:'#06121a',border:missingSet.has(n.id)?MISSING:COLORS[n.group]}},
    font:{{color:missingSet.has(n.id)?MISSING:COLORS[n.group],size:12,face:'Share Tech Mono'}}}})));
  edges.update(allEdges.map(e=>({{id:e.id,color:{{color:'#0a6e7a'}}}})));
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
    html = _TEMPLATE.format(
        title=_html.escape(title or "dump"),
        head_assets=head_assets(),
        overlays=overlays(),
        n_nodes=len(graph["nodes"]),
        n_edges=len(graph["edges"]),
        data=_safe_json(graph),
        colors=_safe_json(GRAPH_COLORS),
    )
    out_path.write_text(html, encoding="utf-8")
    return out_path
