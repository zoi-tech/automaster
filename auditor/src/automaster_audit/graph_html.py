"""Renderiza o grafo de conexões como HTML interativo auto-contido (vis-network)."""
from __future__ import annotations

import json
from pathlib import Path

from .graph import NODE_TYPES

_TEMPLATE = """<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Grafo GHL — {title}</title>
<script src="https://unpkg.com/vis-network@9.1.9/standalone/umd/vis-network.min.js"
  integrity="sha384-yxKDWWf0wwdUj/gPeuL11czrnKFQROnLgY8ll7En9NYoXibgg3C6NK/UDHNtUgWJ"
  crossorigin="anonymous"></script>
<style>
  html,body{{margin:0;height:100%;font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#1a1a1f;color:#eee}}
  #net{{width:100%;height:100vh}}
  #panel{{position:fixed;top:12px;left:12px;background:#26262e;padding:14px 16px;border-radius:10px;
    box-shadow:0 4px 18px rgba(0,0,0,.4);max-width:260px;font-size:13px;z-index:10}}
  #panel h1{{font-size:15px;margin:0 0 8px}}
  #panel .sub{{color:#aaa;font-size:11px;margin-bottom:10px}}
  label{{display:flex;align-items:center;gap:7px;margin:3px 0;cursor:pointer}}
  .dot{{width:11px;height:11px;border-radius:50%;display:inline-block}}
  #search{{width:100%;box-sizing:border-box;margin-top:8px;padding:6px;border-radius:6px;border:1px solid #444;
    background:#1a1a1f;color:#eee}}
  #legend-missing{{margin-top:10px;font-size:11px;color:#ff6b6b}}
  #info{{margin-top:10px;font-size:11px;color:#9ad}}
</style>
</head>
<body>
<div id="panel">
  <h1>Grafo de conexões GHL</h1>
  <div class="sub">{title}<br>{n_nodes} nós · {n_edges} conexões</div>
  <div id="filters"></div>
  <input id="search" placeholder="buscar nó por nome…" autocomplete="off">
  <div id="legend-missing">◆ borda vermelha = referência quebrada (entidade não existe no dump)</div>
  <div id="info">clique num nó para acender vizinhos · clique no vazio para limpar</div>
</div>
<div id="net"></div>
<script>
const DATA = {data};
const COLORS = {colors};
const LABELS = {{workflow:"Workflows",tag:"Tags",pipeline:"Pipelines",stage:"Stages",field:"Custom fields",trigger:"Triggers"}};

const allNodes = DATA.nodes.map(n => ({{
  id:n.id, label:n.label, group:n.type,
  color:{{background:COLORS[n.type], border:n.missing?'#ff3b3b':COLORS[n.type]}},
  borderWidth:n.missing?3:1,
  shape:n.type==='workflow'?'box':'dot',
  size:n.type==='workflow'?16:11,
  font:{{color:'#eee',size:12}}
}}));
const allEdges = DATA.edges.map((e,i) => ({{
  id:i, from:e.from, to:e.to, label:e.rel,
  arrows:'to', width:Math.min(1+e.weight,5),
  color:{{color:'#555',highlight:'#fff'}}, font:{{color:'#888',size:9,strokeWidth:0}},
  smooth:{{type:'continuous'}}
}}));

const nodes = new vis.DataSet(allNodes);
const edges = new vis.DataSet(allEdges);
const container = document.getElementById('net');
const network = new vis.Network(container, {{nodes,edges}}, {{
  physics:{{stabilization:true,barnesHut:{{gravitationalConstant:-8000,springLength:140}}}},
  interaction:{{hover:true,tooltipDelay:120}}
}});

// filtros por tipo
const types = [...new Set(DATA.nodes.map(n=>n.type))];
const filtersDiv = document.getElementById('filters');
const active = new Set(types);
types.forEach(t => {{
  const l = document.createElement('label');
  l.innerHTML = `<input type=checkbox checked data-t="${{t}}"><span class=dot style="background:${{COLORS[t]}}"></span>${{LABELS[t]||t}}`;
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

// destaque de vizinhos ao clicar
network.on('click', params => {{
  if(params.nodes.length===0){{ resetHighlight(); return; }}
  const sel = params.nodes[0];
  const conn = new Set([sel]);
  allEdges.forEach(e=>{{ if(e.from===sel)conn.add(e.to); if(e.to===sel)conn.add(e.from); }});
  nodes.update(allNodes.map(n=>({{
    id:n.id,
    color:conn.has(n.id)?{{background:COLORS[n.group],border:'#fff'}}:{{background:'#33333a',border:'#33333a'}},
    font:{{color:conn.has(n.id)?'#fff':'#555',size:12}}
  }})));
  edges.update(allEdges.map(e=>({{
    id:e.id,
    color:{{color:(e.from===sel||e.to===sel)?'#fff':'#2a2a30'}}
  }})));
}});
function resetHighlight(){{
  nodes.update(allNodes.map(n=>({{id:n.id,color:{{background:COLORS[n.group],border:n.id.startsWith('?')?'#ff3b3b':COLORS[n.group]}},font:{{color:'#eee',size:12}}}})));
  edges.update(allEdges.map(e=>({{id:e.id,color:{{color:'#555'}}}})));
}}

// busca
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
        title=title or "dump",
        n_nodes=len(graph["nodes"]),
        n_edges=len(graph["edges"]),
        data=json.dumps(graph, ensure_ascii=False),
        colors=json.dumps(NODE_TYPES),
    )
    out_path.write_text(html, encoding="utf-8")
    return out_path
