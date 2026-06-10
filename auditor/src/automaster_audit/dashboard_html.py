"""Renderiza o inventário como HTML auto-contido (sem CDN; JS/CSS inline)."""
from __future__ import annotations

import html as _html
import json
from pathlib import Path


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
<title>Painel GHL — {title}</title>
<style>
  :root{{--bg:#16161c;--card:#22222b;--line:#33333f;--fg:#e8e8ee;--mut:#9a9aa8;--accent:#4f86f7}}
  *{{box-sizing:border-box}}
  body{{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif}}
  header{{padding:18px 24px;border-bottom:1px solid var(--line)}}
  h1{{margin:0 0 4px;font-size:18px}}
  .sub{{color:var(--mut);font-size:12px}}
  .cards{{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}}
  .card{{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:8px 14px;min-width:90px}}
  .card .n{{font-size:20px;font-weight:600}}
  .card .l{{font-size:11px;color:var(--mut)}}
  .card.warn .n{{color:#ffb84d}}
  nav{{display:flex;gap:4px;padding:0 24px;border-bottom:1px solid var(--line);background:var(--bg);position:sticky;top:0}}
  nav button{{background:none;border:none;color:var(--mut);padding:12px 16px;cursor:pointer;font-size:13px;border-bottom:2px solid transparent}}
  nav button.active{{color:var(--fg);border-bottom-color:var(--accent)}}
  .wrap{{padding:16px 24px}}
  input#q{{width:100%;max-width:360px;padding:8px 10px;border-radius:6px;border:1px solid var(--line);background:var(--card);color:var(--fg);margin-bottom:12px}}
  table{{width:100%;border-collapse:collapse;font-size:13px}}
  th,td{{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:top}}
  th{{color:var(--mut);font-weight:500;cursor:pointer;user-select:none;position:sticky;top:49px;background:var(--bg)}}
  th:hover{{color:var(--fg)}}
  tr:hover td{{background:#1d1d25}}
  .pill{{display:inline-block;padding:1px 7px;border-radius:10px;font-size:11px;margin:1px}}
  .published{{background:#173d22;color:#5fd07f}} .draft{{background:#3d3417;color:#e0c050}}
  .chan{{background:#1b2b3d;color:#7fb0e0}}
  .orphan{{background:#3d1717;color:#ff7b7b}}
  .muted{{color:var(--mut)}}
  .drill{{font-size:12px;color:var(--mut)}}
  details summary{{cursor:pointer;color:var(--accent)}}
  .hidden{{display:none}}
</style></head><body>
<header>
  <h1>Painel de automações GHL</h1>
  <div class="sub">{title} · gerado do dump</div>
  <div class="cards">{cards}</div>
</header>
<nav id="tabs"></nav>
<div class="wrap">
  <input id="q" placeholder="filtrar na aba atual…" autocomplete="off">
  <div id="content"></div>
</div>
<script>
const DATA = {data};
const TABS = [
  {{key:'workflows', label:'Workflows'}},
  {{key:'tags', label:'Tags'}},
  {{key:'fields', label:'Custom fields'}},
  {{key:'pipelines', label:'Pipelines'}},
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
  if(key==='tags'||key==='fields') return [
    {{h:'Nome', f:r=>esc(r.name)+(r.orphan?' <span class="pill orphan">órfã</span>':''), v:r=>r.name}},
    {{h:'Usada por', f:r=>r.used_by.length, v:r=>r.used_by.length}},
    {{h:'Workflows', f:r=>drill(r.used_by)}},
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
        cards=_cards(data["summary"]),
        data=_safe_json(data),
    )
    out_path.write_text(html, encoding="utf-8")
    return out_path
