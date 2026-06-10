"""Renderiza o inventário como HTML auto-contido, tema Tron/Encom (sem CDN)."""
from __future__ import annotations

import html as _html
import json
from pathlib import Path

from .theme import head_assets, overlays


def _safe_json(obj) -> str:
    return (
        json.dumps(obj, ensure_ascii=False)
        .replace("</", "<\\/")
        .replace("<!--", "<\\!--")
        .replace(chr(0x2028), "\\u2028")
        .replace(chr(0x2029), "\\u2029")
    )


_TEMPLATE = """<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8">
<title>ENCOM OS // {title}</title>
{head_assets}
</head><body>
{overlays}
<header class="framed">
  <div class="hud-top"><span class="dot-online"></span><span class="sub">ENCOM OS // SECTOR {title} // STATUS ONLINE</span></div>
  <h1>Painel de Automações</h1>
  <div class="cards">{cards}</div>
</header>
<nav id="tabs"></nav>
<div class="wrap">
  <input id="q" placeholder="// filtrar na aba atual" autocomplete="off">
  <div id="content"></div>
</div>
<script>
const DATA = {data};
const TABS = [
  {{key:'workflows', label:'Workflows'}},
  {{key:'tags', label:'Tags'}},
  {{key:'fields', label:'Custom fields'}},
  {{key:'pipelines', label:'Pipelines'}},
  {{key:'users', label:'Usuários'}},
  {{key:'custom_values', label:'Custom values'}},
  {{key:'calendars', label:'Calendários'}},
];
let current = 'workflows', sortCol = null, sortDir = 1;
const esc = s => String(s==null?'':s).replace(/[&<>"]/g, c => ({{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}}[c]));
const drill = (arr) => !arr || !arr.length ? '<span class=muted>—</span>'
  : arr.length<=2 ? arr.map(esc).join(', ')
  : `<details><summary>${{arr.length}}</summary><div class=drill>${{arr.map(esc).join('<br>')}}</div></details>`;

function renderTabs(){{
  document.getElementById('tabs').innerHTML = TABS.map(t =>
    `<button data-k="${{t.key}}" class="${{t.key===current?'active':''}}">${{t.label}} (${{DATA[t.key].length}})</button>`).join('');
}}

function columns(key){{
  if(key==='workflows') return [
    {{h:'Nome', f:r=>esc(r.name)}},
    {{h:'Status', f:r=>`<span class="pill ${{r.status}}">${{esc(r.status)}}</span>`, v:r=>r.status}},
    {{h:'Steps', f:r=>r.n_steps, v:r=>r.n_steps}},
    {{h:'Gatilho', f:r=>r.triggers.length?r.triggers.map(esc).join(', '):'<span class=muted>—</span>', v:r=>r.triggers.length}},
    {{h:'Canais', f:r=>Object.entries(r.channels).map(([k,n])=>`<span class="pill chan">${{esc(k)}} ${{n}}</span>`).join('')||'<span class=muted>—</span>', v:r=>Object.keys(r.channels).length}},
    {{h:'Tags', f:r=>r.n_tags, v:r=>r.n_tags}},
    {{h:'Fields', f:r=>r.n_fields, v:r=>r.n_fields}},
    {{h:'Chama', f:r=>drill(r.calls), v:r=>r.calls.length}},
    {{h:'Chamado por', f:r=>drill(r.called_by), v:r=>r.called_by.length}},
    {{h:'Entrada', f:r=>r.has_entry?'<span class="pill published">ok</span>':'<span class="pill orphan">sem entrada</span>', v:r=>r.has_entry?1:0}},
  ];
  if(key==='tags'||key==='fields'||key==='custom_values') return [
    {{h:'Nome', f:r=>esc(r.name)+(r.orphan?' <span class="pill orphan">órfã</span>':''), v:r=>r.name}},
    {{h:'Usada por', f:r=>r.used_by.length, v:r=>r.used_by.length}},
    {{h:'Workflows', f:r=>drill(r.used_by)}},
  ];
  if(key==='users') return [
    {{h:'Nome', f:r=>esc(r.name)+(r.deleted?' <span class="pill orphan">deletado</span>':'')+(r.orphan?' <span class="pill chan">sem workflow</span>':''), v:r=>r.name}},
    {{h:'Email', f:r=>esc(r.email)||'<span class=muted>—</span>', v:r=>r.email}},
    {{h:'Workflows', f:r=>r.used_by.length, v:r=>r.used_by.length}},
    {{h:'Usado em', f:r=>drill(r.used_by)}},
  ];
  if(key==='calendars') return [
    {{h:'Nome', f:r=>esc(r.name), v:r=>r.name}},
    {{h:'Tipo', f:r=>esc(r.type)||'<span class=muted>—</span>', v:r=>r.type}},
    {{h:'Status', f:r=>r.active?'<span class="pill published">ativo</span>':'<span class="pill draft">inativo</span>', v:r=>r.active?1:0}},
  ];
  return [
    {{h:'Nome', f:r=>esc(r.name), v:r=>r.name}},
    {{h:'Usada por', f:r=>r.used_by.length, v:r=>r.used_by.length}},
    {{h:'Workflows', f:r=>drill(r.used_by)}},
  ];
}}

function render(){{
  const cols = columns(current);
  let rows = DATA[current].slice();
  const q = document.getElementById('q').value.trim().toLowerCase();
  if(q) rows = rows.filter(r => JSON.stringify(r).toLowerCase().includes(q));
  if(sortCol!=null && cols[sortCol].v){{
    const vf = cols[sortCol].v;
    rows.sort((a,b)=>{{const x=vf(a),y=vf(b);return (x>y?1:x<y?-1:0)*sortDir}});
  }}
  const head = cols.map((c,i)=>`<th data-i="${{i}}">${{c.h}}${{sortCol===i?(sortDir>0?' ▲':' ▼'):''}}</th>`).join('');
  const body = rows.map(r=>`<tr>${{cols.map(c=>`<td>${{c.f(r)}}</td>`).join('')}}</tr>`).join('');
  document.getElementById('content').innerHTML = `<table><thead><tr>${{head}}</tr></thead><tbody>${{body}}</tbody></table>`;
  document.querySelectorAll('th[data-i]').forEach(th=>th.onclick=()=>{{
    const i=+th.dataset.i; if(!cols[i].v) return;
    if(sortCol===i) sortDir*=-1; else {{sortCol=i;sortDir=1}} render();
  }});
}}

document.getElementById('tabs').addEventListener('click', e=>{{
  if(e.target.dataset.k){{current=e.target.dataset.k;sortCol=null;sortDir=1;
    document.getElementById('q').value='';renderTabs();render();}}
}});
document.getElementById('q').addEventListener('input', render);
renderTabs(); render();
</script>
</body></html>"""


def _cards(summary: dict) -> str:
    items = [
        ("workflows", "Workflows", False),
        ("published", "Publicados", False),
        ("draft", "Rascunhos", False),
        ("tags", "Tags", False),
        ("tags_orphan", "Tags órfãs", True),
        ("fields", "Custom fields", False),
        ("fields_orphan", "Fields órfãos", True),
        ("pipelines", "Pipelines", False),
        ("users", "Usuários", False),
        ("custom_values", "Custom values", False),
        ("cv_orphan", "C. values órfãos", True),
        ("calendars", "Calendários", False),
    ]
    out = []
    for key, label, warn in items:
        n = summary.get(key, 0)
        cls = "card warn" if (warn and n) else "card"
        out.append(f'<div class="{cls}"><div class="n">{n}</div><div class="l">{_html.escape(label)}</div></div>')
    return "".join(out)


def write_dashboard_html(data: dict, out_path: Path, title: str = "") -> Path:
    out_path = Path(out_path)
    html = _TEMPLATE.format(
        title=_html.escape(title or "dump"),
        head_assets=head_assets(),
        overlays=overlays(),
        cards=_cards(data["summary"]),
        data=_safe_json(data),
    )
    out_path.write_text(html, encoding="utf-8")
    return out_path
