"""Renderiza o inventário como HTML auto-contido — tema "Sala de Controle" (IBM Carbon).

Shell compartilhado (topbar + sidebar) vem de theme.py; a sidebar é a navegação
de abas (rota por hash: sem hash = visão geral; #workflows/#tags/... = inventário).
Sem CDN: fontes embutidas como data-URI; nomes do CRM escapados no JS (esc) e o
JSON embutido passa por _safe_json.
"""

from __future__ import annotations

import html as _html
import json
import re
from pathlib import Path

from .theme import head_assets, shell_meta, sidebar, topbar


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
    """Data de extração inferida do nome da pasta do dump (YYYY-MM-DD_HHmm)."""
    m = _DUMP_DIR_RE.match(out_path.parent.name)
    return f"{m.group(1)} {m.group(2)}:{m.group(3)}" if m else ""


# ------------------------------------------------------------------- JS -----
# Constante separada injetada como VALOR no template (padrão do projeto p/ CSS):
# chaves simples aqui não passam pelo str.format, então não precisam de {{ }}.
_JS = """
const TABS = {
  workflows:{label:'Workflows'},
  tags:{label:'Tags'},
  fields:{label:'Custom fields'},
  pipelines:{label:'Pipelines'},
  users:{label:'Usuários'},
  custom_values:{label:'Custom values'},
  calendars:{label:'Calendários'},
};
const PRESETS = {
  noentry:{tab:'workflows', label:'sem entrada', f:r=>!r.has_entry},
  draft:{tab:'workflows', label:'rascunhos', f:r=>r.status==='draft'},
  orphan_tags:{tab:'tags', label:'órfãs', f:r=>r.orphan},
  orphan_fields:{tab:'fields', label:'órfãos', f:r=>r.orphan},
  orphan_cv:{tab:'custom_values', label:'órfãos', f:r=>r.orphan},
  deleted:{tab:'users', label:'deletados', f:r=>r.deleted},
};
let view='overview', sortCol=null, sortDir=1, query='', preset=null, selId=null;

const esc = s => String(s==null?'':s).replace(/[&<>"]/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const drill = arr => !arr || !arr.length ? '<span class="muted">—</span>'
  : arr.length<=2 ? arr.map(esc).join(', ')
  : `<details><summary>${arr.length}</summary><div class="drill">${arr.map(esc).join('<br>')}</div></details>`;
const chans = ch => {
  const e = Object.entries(ch||{});
  return e.length ? e.map(([k,n])=>`${esc(k)} ${n}`).join(' · ') : '—';
};
const statusTag = s => s==='published' ? '<span class="tag pub">PUB</span>'
  : s==='draft' ? '<span class="tag draft">DRAFT</span>'
  : `<span class="tag draft">${esc(String(s||'—').toUpperCase())}</span>`;

/* camada 1 embutida (null quando o HTML foi gerado fora de um dump) */
const AUDIT = RAW_AUDIT ? (()=>{
  const by = {};
  RAW_AUDIT.items.forEach(f=>{ if(f.workflow_id){ (by[f.workflow_id]=by[f.workflow_id]||[]).push(f); } });
  return {counts:RAW_AUDIT.counts, by_wf:by};
})() : null;
const FINDS = id => (AUDIT && AUDIT.by_wf[id]) || [];

/* saúde por workflow: ERROR vermelho > WARN âmbar > sem entrada âmbar > ok */
function health(r){
  const fs = FINDS(r.id);
  const errs = fs.filter(f=>f.severity==='ERROR').length;
  const warns = fs.filter(f=>f.severity==='WARN');
  if(errs) return {html:`<span class="tag err">${errs} ERRO${errs>1?'S':''}</span>`, rank:3};
  if(warns.length){
    const onlyUnreach = warns.every(f=>f.rule==='workflow_unreachable');
    const lbl = onlyUnreach ? 'SEM ENTRADA' : `${warns.length} AVISO${warns.length>1?'S':''}`;
    return {html:`<span class="tag warn">${lbl}</span>`, rank:2};
  }
  if(!r.has_entry) return {html:'<span class="tag warn">SEM ENTRADA</span>', rank:2};
  return {html:'<span class="tag ok">ok</span>', rank:0};
}

function columns(key){
  if(key==='workflows') return [
    {h:'Workflow', f:r=>`<span class="cell-name">${esc(r.name)}</span><span class="cell-id">${esc(r.id)}</span>`, v:r=>String(r.name||'').toLowerCase()},
    {h:'Status', w:'90px', f:r=>statusTag(r.status), v:r=>r.status},
    {h:'Gatilho', w:'190px', f:r=>r.triggers.length?`<span class="cell-mono">${r.triggers.map(esc).join(', ')}</span>`:'<span class="muted">—</span>', v:r=>r.triggers.length},
    {h:'Steps', w:'64px', cls:'num', f:r=>r.n_steps, v:r=>r.n_steps},
    {h:'Canais', w:'150px', f:r=>`<span class="cell-mono">${chans(r.channels)}</span>`, v:r=>Object.keys(r.channels||{}).length},
    {h:'Saúde', w:'118px', f:r=>health(r).html, v:r=>health(r).rank},
    {h:'', w:'28px', f:()=>'<span class="chev">›</span>'},
  ];
  if(key==='tags'||key==='fields'||key==='custom_values'){
    const orf = key==='tags' ? 'órfã' : 'órfão';
    return [
      {h:'Nome', f:r=>esc(r.name)+(r.orphan?` <span class="tag warn">${orf}</span>`:''), v:r=>String(r.name||'').toLowerCase()},
      ...(key==='tags'?[{h:'Papel', w:'170px', f:r=>r.papeis.length?`<span class="cell-mono">${r.papeis.map(esc).join(', ')}</span>`:'<span class="muted">—</span>', v:r=>r.papeis.join(',')}]:[]),
      {h:'Usada por', w:'100px', cls:'num', f:r=>r.used_by.length, v:r=>r.used_by.length},
      {h:'Workflows', f:r=>drill(r.used_by)},
    ];
  }
  if(key==='users') return [
    {h:'Nome', f:r=>esc(r.name)+(r.deleted?' <span class="tag warn">deletado</span>':'')+(r.orphan?' <span class="tag draft">sem workflow</span>':''), v:r=>String(r.name||'').toLowerCase()},
    {h:'Email', w:'240px', f:r=>r.email?`<span class="cell-mono">${esc(r.email)}</span>`:'<span class="muted">—</span>', v:r=>r.email},
    {h:'Workflows', w:'100px', cls:'num', f:r=>r.used_by.length, v:r=>r.used_by.length},
    {h:'Usado em', f:r=>drill(r.used_by)},
  ];
  if(key==='calendars') return [
    {h:'Nome', f:r=>esc(r.name), v:r=>String(r.name||'').toLowerCase()},
    {h:'Tipo', w:'200px', f:r=>esc(r.type)||'<span class="muted">—</span>', v:r=>r.type},
    {h:'Status', w:'110px', f:r=>r.active?'<span class="tag pub">ATIVO</span>':'<span class="tag draft">INATIVO</span>', v:r=>r.active?1:0},
  ];
  return [  // pipelines
    {h:'Nome', f:r=>esc(r.name), v:r=>String(r.name||'').toLowerCase()},
    {h:'Usada por', w:'100px', cls:'num', f:r=>r.used_by.length, v:r=>r.used_by.length},
    {h:'Workflows', f:r=>drill(r.used_by)},
  ];
}

/* ===== visão geral ===== */
/* vermelho SÓ para ERROR (refs quebradas); órfãs/sem-entrada = âmbar; zero = verde */
function tilesHTML(){
  const s = DATA.summary;
  let tiles;
  if(AUDIT){
    const c = AUDIT.counts;
    tiles = [
      {n:c.ERROR, lbl:'Referências quebradas', det:'tags, pipelines, fields, users e custom values', href:'validation.html#camada1', sev:c.ERROR?'sev-err':'sev-ok'},
      {n:c.WARN, lbl:'Avisos de auditoria', det:'ciclos de chamadas e workflows sem entrada', href:'validation.html#camada1', sev:c.WARN?'sev-warn':'sev-ok'},
      {n:s.tags_orphan, lbl:'Tags órfãs', det:`de ${s.tags} tags — nenhum workflow usa`, p:'orphan_tags', sev:s.tags_orphan?'sev-warn':'sev-ok'},
      {n:s.fields_orphan, lbl:'Fields órfãos', det:`de ${s.fields} custom fields`, p:'orphan_fields', sev:s.fields_orphan?'sev-warn':'sev-ok'},
      {n:s.cv_orphan, lbl:'Custom values órfãos', det:`de ${s.custom_values} custom values`, p:'orphan_cv', sev:s.cv_orphan?'sev-warn':'sev-ok'},
      {n:c.INFO, lbl:'Infos de convenção', det:'nomenclatura fora do padrão e rascunhos sem saída', href:'validation.html#camada1', sev:''},
    ];
  } else {
    const noentry = DATA.workflows.filter(w=>!w.has_entry).length;
    const deleted = DATA.users.filter(u=>u.deleted).length;
    tiles = [
      {n:noentry, lbl:'Workflows sem entrada', det:'sem trigger e sem add_to_workflow apontando', p:'noentry', sev:noentry?'sev-warn':'sev-ok'},
      {n:s.tags_orphan, lbl:'Tags órfãs', det:`de ${s.tags} tags — nenhum workflow usa`, p:'orphan_tags', sev:s.tags_orphan?'sev-warn':'sev-ok'},
      {n:s.fields_orphan, lbl:'Fields órfãos', det:`de ${s.fields} custom fields`, p:'orphan_fields', sev:s.fields_orphan?'sev-warn':'sev-ok'},
      {n:s.cv_orphan, lbl:'Custom values órfãos', det:`de ${s.custom_values} custom values`, p:'orphan_cv', sev:s.cv_orphan?'sev-warn':'sev-ok'},
      {n:s.draft, lbl:'Rascunhos', det:'workflows em draft (informativo)', p:'draft', sev:''},
      {n:deleted, lbl:'Usuários deletados', det:'ainda presentes no dump', p:'deleted', sev:deleted?'sev-warn':''},
    ];
  }
  return tiles.map(t=>{
    const inner = `<div class="n">${t.n}</div><div class="lbl">${t.lbl}</div>`+
      `<div class="det">${t.det}</div><div class="go">ver →</div>`;
    return t.href
      ? `<a class="ttile ${t.sev}" href="${t.href}">${inner}</a>`
      : `<div class="ttile ${t.sev}" data-preset="${t.p}">${inner}</div>`;
  }).join('');
}

function kpisHTML(){
  const s = DATA.summary;
  const em = (n,w)=> n ? `<em>${n} ${w}</em>` : '';
  const k = [
    {n:s.workflows, l:'Workflows', sub:`${s.published} pub · ${s.draft} draft`},
    {n:s.tags, l:'Tags', sub:em(s.tags_orphan,'órfãs')},
    {n:s.fields, l:'Custom fields', sub:em(s.fields_orphan,'órfãos')},
    {n:s.pipelines, l:s.pipelines===1?'Pipeline':'Pipelines', sub:''},
    {n:s.users, l:'Usuários', sub:''},
    {n:s.calendars, l:'Calendários', sub:''},
    {n:s.custom_values, l:'Custom values', sub:em(s.cv_orphan,'órfãos')},
  ];
  return k.map(x=>`<div class="kpi"><div class="n">${x.n}</div><div class="l">${x.l}</div>`+
    `<div class="s">${x.sub||'&nbsp;'}</div></div>`).join('');
}

function tableShellHTML(tab){
  return `<div class="tbl-card">
    <div class="tbl-bar">
      <div class="tbl-search">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="7" cy="7" r="4.5"/><line x1="10.5" y1="10.5" x2="14" y2="14"/>
        </svg>
        <input id="q" type="text" placeholder="Filtrar ${TABS[tab].label.toLowerCase()} por nome, id…" autocomplete="off">
      </div>
      <div class="ftr" id="chipzone"></div>
      <div class="ftr" id="ftr"></div>
    </div>
    <div id="tblwrap" class="tbl-wrap"></div>
  </div>`;
}

function overviewHTML(){
  const s = DATA.summary;
  const ex = EXTRACTED ? ` · extração ${esc(EXTRACTED)}` : '';
  const sub = AUDIT
    ? `${s.workflows} workflows auditados · ${AUDIT.counts.ERROR} erros · ${AUDIT.counts.WARN} avisos · ${AUDIT.counts.INFO} infos${ex}`
    : `${s.workflows} workflows · ${s.tags} tags · ${s.fields} fields · ${s.custom_values} custom values${ex}`;
  return `<div class="crumb">${esc(LOC)} / <b>Visão geral</b></div>
  <h1>Visão geral</h1>
  <div class="h1-sub">${sub}</div>
  <div class="sec-label">Triagem · o que precisa de atenção</div>
  <div class="triage">${tilesHTML()}</div>
  <div class="sec-label">Inventário da subconta</div>
  <div class="kpis">${kpisHTML()}</div>
  <div class="sec-label">Workflows</div>
  ${tableShellHTML('workflows')}`;
}

/* ===== render ===== */
function renderView(){
  const main = document.getElementById('main');
  if(view==='overview'){
    main.innerHTML = overviewHTML();
    main.querySelectorAll('.ttile[data-preset]').forEach(t=>t.addEventListener('click', ()=>{
      const p = t.dataset.preset;
      preset = p; query=''; sortCol=null; sortDir=1;
      location.hash = '#'+PRESETS[p].tab;
    }));
  } else {
    const t = TABS[view];
    main.innerHTML = `<div class="crumb">${esc(LOC)} / <b>${t.label}</b></div>
      <h1>${t.label}</h1>
      <div class="h1-sub">${DATA[view].length} itens</div>
      ${tableShellHTML(view)}`;
  }
  const q = document.getElementById('q');
  if(q) q.addEventListener('input', ()=>{ query = q.value.trim().toLowerCase(); renderTable(); });
  renderTable();
}

function renderTable(){
  const wrap = document.getElementById('tblwrap');
  if(!wrap) return;
  const tab = view==='overview' ? 'workflows' : view;
  const cols = columns(tab);
  const all = DATA[tab];
  let rows = all.slice();
  if(preset && PRESETS[preset].tab===tab) rows = rows.filter(PRESETS[preset].f);
  if(query) rows = rows.filter(r => JSON.stringify(r).toLowerCase().includes(query));
  if(sortCol!=null && cols[sortCol] && cols[sortCol].v){
    const vf = cols[sortCol].v;
    rows.sort((a,b)=>{ const x=vf(a), y=vf(b); return (x>y?1:x<y?-1:0)*sortDir; });
  }
  const colg = `<colgroup>${cols.map(c=>c.w?`<col style="width:${c.w}">`:'<col>').join('')}</colgroup>`;
  const head = cols.map((c,i)=>`<th data-i="${i}" class="${c.cls||''}">${c.h}${sortCol===i?(sortDir>0?' ▲':' ▼'):''}</th>`).join('');
  const body = rows.map(r=>{
    const isWf = tab==='workflows';
    const attrs = (isWf?` data-wf="${esc(r.id)}"`:'') + (isWf && r.id===selId?' class="sel"':'');
    return `<tr${attrs}>${cols.map(c=>`<td class="${c.cls||''}">${c.f(r)}</td>`).join('')}</tr>`;
  }).join('');
  wrap.innerHTML = rows.length
    ? `<table>${colg}<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
    : '<div class="empty">nenhum item com esse filtro</div>';
  document.getElementById('ftr').innerHTML = `<b>${rows.length}</b> de <b>${all.length}</b>`;
  const cz = document.getElementById('chipzone');
  if(preset && PRESETS[preset].tab===tab){
    cz.innerHTML = `<button class="chip" title="Remover filtro">filtro: ${PRESETS[preset].label} ✕</button>`;
    cz.querySelector('.chip').addEventListener('click', ()=>{ preset=null; renderTable(); });
  } else cz.innerHTML = '';
  wrap.querySelectorAll('th[data-i]').forEach(th=>th.addEventListener('click', ()=>{
    const i = +th.dataset.i;
    if(!cols[i].v) return;
    if(sortCol===i) sortDir*=-1; else { sortCol=i; sortDir=1; }
    renderTable();
  }));
  wrap.querySelectorAll('tr[data-wf]').forEach(tr=>tr.addEventListener('click', e=>{
    if(e.target.closest('details,summary,a,button')) return;
    openDrawer(tr.dataset.wf);
  }));
}

/* ===== drawer de detalhe ===== */
function markSel(){
  document.querySelectorAll('tr[data-wf]').forEach(tr=>
    tr.classList.toggle('sel', tr.dataset.wf===selId));
}
function openDrawer(id){
  const r = DATA.workflows.find(w=>w.id===id);
  if(!r) return;
  selId = id;
  document.getElementById('dr-title').textContent = r.name;
  document.getElementById('dr-id').textContent = r.id;
  const list = arr => arr.length ? arr.map(esc).join('<br>') : '<span class="muted">—</span>';
  const rows = [
    ['Status', statusTag(r.status)],
    ['Steps', `<span class="cell-mono">${r.n_steps}</span>`],
    ['Gatilhos', r.triggers.length ? r.triggers.map(t=>`<span class="dr-chip">${esc(t)}</span>`).join('') : '<span class="muted">—</span>'],
    ['Canais', `<span class="cell-mono">${chans(r.channels)}</span>`],
    ['Tags usadas', `<span class="cell-mono">${r.n_tags}</span>`],
    ['Fields usados', `<span class="cell-mono">${r.n_fields}</span>`],
    [`Chama (${r.calls.length})`, list(r.calls)],
    [`Chamado por (${r.called_by.length})`, list(r.called_by)],
    ['Entrada', r.has_entry ? '<span class="tag ok">ok</span>' : '<span class="tag warn">sem entrada</span>'],
  ];
  const finds = FINDS(id).filter(f=>f.severity!=='INFO');
  const fhtml = finds.map(f=>
    `<div class="dr-find${f.severity==='ERROR'?' err':''}">`+
    `<div class="fr">${esc(f.severity)} · ${esc(f.rule)}</div>`+
    `<p>${esc(f.detail)}</p></div>`).join('');
  document.getElementById('dr-body').innerHTML =
    rows.map(([k,v])=>`<div class="dr-row"><div class="dr-k">${k}</div><div class="dr-v">${v}</div></div>`).join('') + fhtml;
  document.getElementById('dr-graph').href = 'graph.html#' + encodeURIComponent('wf:'+id);
  document.getElementById('drawer').classList.add('open');
  document.body.classList.add('dr-open');
  markSel();
}
function closeDrawer(){
  selId = null;
  document.getElementById('drawer').classList.remove('open');
  document.body.classList.remove('dr-open');
  markSel();
}

/* ===== rota por hash (sidebar = navegação de abas) ===== */
function route(){
  const h = (location.hash||'').replace('#','');
  const v = TABS[h] ? h : 'overview';
  if(v!==view){ sortCol=null; sortDir=1; query=''; }
  view = v;
  if(preset && (view==='overview' || PRESETS[preset].tab!==view)) preset = null;
  document.querySelectorAll('.side a[data-nav]').forEach(a=>
    a.classList.toggle('active', a.dataset.nav===view));
  closeDrawer();
  renderView();
}

window.addEventListener('hashchange', route);
document.getElementById('dr-close').addEventListener('click', closeDrawer);
document.addEventListener('keydown', e=>{ if(e.key==='Escape') closeDrawer(); });
route();
"""


_TEMPLATE = """<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AUTOMASTER // {title}</title>
{head_assets}
</head><body>
{topbar}
{sidebar}
<main class="main" id="main"></main>
<aside class="drawer" id="drawer" aria-label="Detalhe do workflow">
  <div class="dr-head">
    <div class="dr-kicker"><span>Detalhe do workflow</span>
      <button class="dr-close" id="dr-close" title="Fechar (Esc)">✕</button></div>
    <div class="dr-title" id="dr-title"></div>
    <div class="dr-id" id="dr-id"></div>
  </div>
  <div class="dr-body" id="dr-body"></div>
  <div class="dr-links">
    <a id="dr-graph" href="graph.html">Abrir no grafo</a>
    <a href="validation.html#camada2">Caminhos (camada 2)</a>
  </div>
</aside>
<script>
const DATA = {data};
const RAW_AUDIT = {audit};
const LOC = {loc_json};
const EXTRACTED = {extracted_json};
{js}
</script>
</body></html>"""


def _audit_from_dump(dump_dir: Path) -> dict | None:
    """Achados da camada 1 lidos do dump ao lado do HTML (apresentação, só leitura).

    Roda o registry de regras sobre o mesmo dump que gerou o inventário; se a
    pasta não for um dump legível (ex.: HTML escrito em pasta avulsa nos
    testes), devolve None e o painel degrada para inventário puro.
    """
    try:
        from . import rules
        from .loader import load_dump

        findings = rules.run_all(load_dump(dump_dir))
    except Exception:  # noqa: BLE001 - pasta ilegível degrada para inventário puro, nunca quebra o painel
        return None
    return {
        "counts": {s: sum(1 for f in findings if f.severity == s) for s in ("ERROR", "WARN", "INFO")},
        "items": [
            {
                "rule": f.rule,
                "severity": f.severity,
                "workflow_id": f.workflow_id or "",
                "workflow_name": f.workflow_name or "",
                "detail": f.detail,
            }
            for f in findings
        ],
    }


def write_dashboard_html(data: dict, out_path: Path, title: str = "") -> Path:
    out_path = Path(out_path)
    loc = title or "dump"
    extracted = _extracted_from_path(out_path)
    meta = shell_meta(out_path.parent)
    html = _TEMPLATE.format(
        title=_html.escape(loc),
        head_assets=head_assets(),
        topbar=topbar(loc, extracted, schema=meta["schema"]),
        sidebar=sidebar("overview", counts=data.get("summary")),
        data=_safe_json(data),
        audit=_safe_json(_audit_from_dump(out_path.parent)),
        loc_json=_safe_json(loc),
        extracted_json=_safe_json(extracted),
        js=_JS,
    )
    out_path.write_text(html, encoding="utf-8")
    return out_path
