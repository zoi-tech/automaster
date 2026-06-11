import type { AuditLog } from "./api/audit.js";

/** Renderiza a linha do tempo de um contato como HTML efêmero (gravar em /tmp).
 *
 * Layout "Sala de Controle" (IBM Carbon):
 *  - faixa de densidade: 1 barra por dia do período (clique = pula no trilho);
 *  - trilho condensado: 1 ponto por evento, espaçamento por classe de intervalo
 *    (mesmo minuto / mesma hora / salto), separadores de dia;
 *  - filtros por tipo e por causador (workflows resolvidos pelo dump local);
 *  - hover = tooltip leve; clique = painel lateral com diff campo a campo
 *    (antes → depois) + JSON cru em <details>; ←/→ navegam, Esc fecha.
 *
 * XSS: tudo que vem do CRM entra no DOM via textContent; JSON embutido com
 * escape anti-</script>/U+2028/U+2029. Página descartável — não entra em dumps/.
 */

const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const safeJson = (obj: unknown): string =>
  JSON.stringify(obj)
    .replace(/<\//g, "<\\/")
    .replace(/<!--/g, "<\\!--")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

const TYPE_LABEL: Record<string, string> = {
  TAG_ADDED: "+ tag",
  TAG_REMOVED: "− tag",
  UPDATED: "atualizado",
  CREATED: "criado",
  DELETED: "deletado",
};

const short = (v: unknown, max = 160): string => {
  if (v === undefined) return "";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
};

export function renderTimelineHtml(
  logs: AuditLog[],
  opts: { locationId: string; id: string; days: number; wfNames: Map<string, string> },
): string {
  const name = logs.find((l) => l.documentName)?.documentName ?? opts.id;
  const sorted = [...logs].sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")));

  const events = sorted.map((log) => {
    const dt = new Date(String(log.createdAt ?? ""));
    const t = String(log.type ?? "");
    const src = String(log.source ?? "");
    let srcKind = "other";
    let srcLabel = src ? src.toLowerCase() : "sistema";
    if (src === "WORKFLOW_NEW" || src === "WORKFLOW") {
      srcKind = "wf";
      srcLabel = opts.wfNames.get(String(log.sourceId ?? "")) ?? String(log.sourceId ?? "workflow");
    } else if (src === "WEB_USER") {
      srcKind = "user";
      srcLabel = String(log.sourceName ?? "usuário");
    }
    const before = (log.before ?? {}) as Record<string, unknown>;
    const after = (log.after ?? {}) as Record<string, unknown>;
    const changed = (log.changedFields ?? [])
      .filter((f) => f !== "lastUpdatedBy")
      .map((f) => ({ f, b: short(before[f]), a: short(after[f]) }));
    const sum =
      t === "TAG_ADDED" ? ((after.tagsAdded as string[]) ?? []).join(", ")
      : t === "TAG_REMOVED" ? ((after.tagsRemoved as string[]) ?? []).join(", ")
      : (log.changedFields ?? []).filter((f) => f !== "lastUpdatedBy").join(", ");
    return {
      ts: dt.getTime(),
      dayKey: dt.toISOString().slice(0, 10),
      time: dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      day: dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" }),
      type: TYPE_LABEL[t] ?? t.toLowerCase(),
      cls: t === "TAG_ADDED" ? "add" : t === "TAG_REMOVED" ? "rm" : t === "CREATED" ? "new" : "upd",
      sum,
      srcKind,
      srcLabel,
      changed,
      raw: JSON.stringify({ before: log.before, after: log.after }, null, 2),
    };
  });

  // ----- trilho: separador de dia + classes de intervalo -----
  const marks: string[] = [];
  let prev: (typeof events)[number] | null = null;
  events.forEach((e, i) => {
    if (!prev || prev.dayKey !== e.dayKey) {
      const dt = new Date(e.ts);
      marks.push(
        `<span class="daylbl" data-day="${esc(e.dayKey)}">${esc(
          dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }),
        )}</span>`,
      );
    } else {
      const gap = e.ts - prev.ts;
      if (gap > 3_600_000) marks.push('<span class="gap"></span>');
      else if (gap > 60_000) marks.push('<span class="midgap"></span>');
    }
    marks.push(`<span class="dot ${esc(e.cls)}" data-i="${i}" data-day="${esc(e.dayKey)}" tabindex="0"></span>`);
    prev = e;
  });

  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TIMELINE // ${esc(name)}</title>
<style>
:root{--bg:#f4f4f4;--panel:#fff;--border:#e0e0e0;--ink:#161616;--ink2:#525252;--ink3:#8d8d8d;
  --blue:#0f62fe;--sel:#edf5ff;--red:#da1e28;--amber:#f1c21b;--green:#24a148;
  --mono:ui-monospace,SFMono-Regular,Menlo,monospace}
*{margin:0;padding:0;box-sizing:border-box;border-radius:0}
html,body{height:100%}
body{background:var(--bg);color:var(--ink);font:14px/1.4 'IBM Plex Sans',system-ui,-apple-system,sans-serif;
  display:flex;flex-direction:column;overflow:hidden}
header.top{background:#161616;color:#fff;padding:12px 24px;display:flex;justify-content:space-between;
  align-items:baseline;flex:none}
.brand{font-family:var(--mono);font-weight:600}
.brand span{color:#8d8d8d;font-weight:400}
.meta{font-family:var(--mono);font-size:12px;color:#c6c6c6}
/* título + filtros */
.titlebar{padding:14px 24px 0;flex:none;display:flex;align-items:baseline;gap:14px;flex-wrap:wrap}
h1{font-size:22px;font-weight:400}
.sub{font-family:var(--mono);font-size:12px;color:var(--ink2)}
.filters{padding:10px 24px 12px;flex:none;display:flex;gap:6px;flex-wrap:wrap;align-items:center;
  border-bottom:1px solid var(--border)}
.flabel{font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:.08em;
  color:var(--ink3);margin-right:2px}
.fchip{font-family:var(--mono);font-size:11px;padding:4px 10px;border:1px solid var(--border);
  background:var(--panel);color:var(--ink2);cursor:pointer;user-select:none}
.fchip:hover{border-color:var(--ink3)}
.fchip.on{background:var(--ink);color:#fff;border-color:var(--ink)}
.fchip .n{color:var(--ink3);margin-left:4px}
.fchip.on .n{color:#a8a8a8}
.fsep{width:1px;height:18px;background:var(--border);margin:0 8px}
/* densidade */
.density{flex:none;padding:14px 24px 6px}
.dens-bars{display:flex;align-items:flex-end;gap:2px;height:56px;border-bottom:1px solid var(--border)}
.dbar{flex:1 1 0;min-width:2px;background:#c6c6c6;cursor:pointer;position:relative}
.dbar:hover,.dbar.cur{background:var(--blue)}
.dbar.zero{background:transparent;border-bottom:2px solid var(--border);cursor:default}
.dens-axis{display:flex;justify-content:space-between;font-family:var(--mono);font-size:10px;
  color:var(--ink3);padding-top:4px}
/* trilho */
.strip{flex:none;height:190px;overflow-x:auto;overflow-y:hidden;display:flex;align-items:center;
  border-bottom:1px solid var(--border);background:var(--panel)}
.track{display:flex;align-items:center;gap:5px;padding:0 48px;position:relative;min-width:100%;height:100%}
.track::before{content:"";position:absolute;left:0;right:0;top:50%;height:1px;background:#c6c6c6}
.daylbl{font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:.08em;
  color:var(--ink2);background:var(--panel);border:1px solid var(--border);padding:2px 6px;
  position:relative;z-index:2;flex:none;margin:0 10px 0 18px}
.gap{flex:none;width:34px;height:1px;position:relative;z-index:2;
  background:repeating-linear-gradient(90deg,var(--ink3) 0 4px,transparent 4px 8px)}
.midgap{flex:none;width:12px}
.dot{width:12px;height:12px;background:var(--panel);border:2px solid var(--ink3);
  position:relative;z-index:2;flex:none;cursor:pointer;transition:transform .07s}
.dot.add{border-color:var(--green)}
.dot.rm{border-color:var(--red)}
.dot.new{border-color:var(--blue);background:var(--blue)}
.dot.upd{border-color:var(--ink2)}
.dot:hover,.dot:focus{transform:scale(1.6);outline:none;z-index:3}
.dot.sel{transform:scale(1.6);background:var(--ink);border-color:var(--ink);z-index:3}
.dot.dim{opacity:.18;pointer-events:none}
/* tooltip leve */
#tip{position:fixed;display:none;background:#161616;color:#fff;padding:6px 10px;z-index:20;
  font-size:12px;max-width:340px;pointer-events:none}
#tip .t-when{font-family:var(--mono);font-size:10px;color:#a8a8a8}
#tip.show{display:block}
/* painel lateral */
#panel{position:fixed;top:48px;right:0;bottom:0;width:420px;background:var(--panel);
  border-left:1px solid var(--ink);transform:translateX(100%);transition:transform .15s;z-index:15;
  display:flex;flex-direction:column}
#panel.open{transform:none}
.p-head{flex:none;display:flex;align-items:baseline;gap:10px;padding:14px 16px;
  border-bottom:1px solid var(--border)}
.p-badge{font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:.08em;
  padding:2px 8px;border:1px solid var(--border)}
.p-badge.add{background:#defbe6;color:#0e6027;border-color:var(--green)}
.p-badge.rm{background:#fff1f1;color:#a2191f;border-color:var(--red)}
.p-badge.new{background:var(--sel);color:var(--blue);border-color:var(--blue)}
.p-badge.upd{background:#e8e8e8;color:#393939}
.p-when{font-family:var(--mono);font-size:11px;color:var(--ink2)}
.p-close{margin-left:auto;cursor:pointer;border:none;background:none;font-size:16px;color:var(--ink3)}
.p-close:hover{color:var(--ink)}
.p-body{flex:1;overflow-y:auto;padding:14px 16px}
.p-sum{font-size:14px;margin-bottom:10px}
.p-src{font-family:var(--mono);font-size:11px;padding:3px 8px;border:1px solid;display:inline-block;
  margin-bottom:14px}
.p-src.wf{color:var(--blue);border-color:var(--blue);background:var(--sel)}
.p-src.user{color:#684e00;border-color:var(--amber);background:#fcf4d6}
.p-src.other{color:#393939;border-color:#c6c6c6;background:#e8e8e8}
.diff{border:1px solid var(--border);margin-bottom:14px}
.drow{display:grid;grid-template-columns:120px 1fr;border-top:1px solid var(--border)}
.drow:first-child{border-top:none}
.dfield{font-family:var(--mono);font-size:11px;color:var(--ink2);padding:8px 10px;
  border-right:1px solid var(--border);word-break:break-word}
.dvals{padding:8px 10px;font-size:12.5px}
.dold{color:var(--ink3);text-decoration:line-through;word-break:break-word}
.dnew{color:var(--ink);word-break:break-word}
.darr{color:var(--ink3);margin:0 6px}
.p-body details summary{font-family:var(--mono);font-size:11px;color:var(--ink2);cursor:pointer}
.p-body pre{font:10.5px/1.5 var(--mono);background:#fafafa;border:1px solid var(--border);
  padding:10px;margin-top:8px;white-space:pre-wrap;word-break:break-word}
.p-nav{flex:none;display:flex;border-top:1px solid var(--border)}
.p-nav button{flex:1;border:none;background:var(--panel);font-family:var(--mono);font-size:11px;
  padding:10px;cursor:pointer;color:var(--ink2)}
.p-nav button:hover{background:var(--bg);color:var(--ink)}
.p-nav button+button{border-left:1px solid var(--border)}
::-webkit-scrollbar{height:10px;width:10px}
::-webkit-scrollbar-track{background:var(--bg)}
::-webkit-scrollbar-thumb{background:#c6c6c6}
::-webkit-scrollbar-thumb:hover{background:#8d8d8d}
</style></head><body>
<header class="top"><span class="brand">automaster<span>/timeline</span></span>
<span class="meta">${esc(opts.locationId)} · efêmero (não gravado em dumps/)</span></header>
<div class="titlebar">
  <h1>${esc(name)}</h1>
  <span class="sub">${esc(opts.id)} · ${events.length} eventos · últimos ${opts.days} dias</span>
  <span class="sub" style="margin-left:auto;color:var(--ink3)">hover = espiar · clique = detalhe · ←/→ = navegar · Esc = fechar</span>
</div>
<div class="filters" id="filters"></div>
<div class="density">
  <div class="dens-bars" id="dens"></div>
  <div class="dens-axis"><span id="d0"></span><span id="d1"></span></div>
</div>
<div class="strip" id="strip"><div class="track" id="track">
${marks.join("\n") || '<span class="daylbl">sem eventos</span>'}
</div></div>
<div id="tip"></div>
<aside id="panel">
  <div class="p-head"><span class="p-badge" id="pb"></span><span class="p-when" id="pw"></span>
    <button class="p-close" id="pc" title="fechar (Esc)">✕</button></div>
  <div class="p-body"><div class="p-sum" id="ps"></div><span class="p-src" id="po"></span>
    <div class="diff" id="pd"></div>
    <details><summary>JSON cru (before/after)</summary><pre id="pj"></pre></details></div>
  <div class="p-nav"><button id="prev">← anterior</button><button id="next">próximo →</button></div>
</aside>
<script>
const EVENTS = ${safeJson(events)};
const DAYS = ${opts.days};
const $ = id => document.getElementById(id);
const dots = Array.from(document.querySelectorAll('.dot'));
let sel = -1;

/* ===== filtros ===== */
const typeCounts = {}, srcCounts = {};
EVENTS.forEach(e => {
  typeCounts[e.type] = (typeCounts[e.type] || 0) + 1;
  const k = e.srcKind + '\\u0000' + e.srcLabel;
  srcCounts[k] = (srcCounts[k] || 0) + 1;
});
const activeTypes = new Set(Object.keys(typeCounts));
const topSrc = Object.entries(srcCounts).sort((a, b) => b[1] - a[1]).slice(0, 7);
const activeSrc = new Set(topSrc.map(([k]) => k));
let srcFilterAll = true;

function chip(label, count, on, cb) {
  const b = document.createElement('button');
  b.className = 'fchip' + (on ? ' on' : '');
  b.textContent = label;
  const n = document.createElement('span'); n.className = 'n'; n.textContent = String(count);
  b.appendChild(n);
  b.onclick = () => { cb(b); applyFilter(); };
  return b;
}
function buildFilters() {
  const f = $('filters');
  const lt = document.createElement('span'); lt.className = 'flabel'; lt.textContent = 'tipo';
  f.appendChild(lt);
  Object.entries(typeCounts).forEach(([t, n]) => {
    f.appendChild(chip(t, n, true, b => {
      if (activeTypes.has(t)) { activeTypes.delete(t); b.classList.remove('on'); }
      else { activeTypes.add(t); b.classList.add('on'); }
    }));
  });
  const sep = document.createElement('span'); sep.className = 'fsep'; f.appendChild(sep);
  const ls = document.createElement('span'); ls.className = 'flabel'; ls.textContent = 'causador';
  f.appendChild(ls);
  topSrc.forEach(([k, n]) => {
    const label = k.split('\\u0000')[1];
    f.appendChild(chip(label.length > 28 ? label.slice(0, 27) + '…' : label, n, true, b => {
      srcFilterAll = false;
      if (activeSrc.has(k)) { activeSrc.delete(k); b.classList.remove('on'); }
      else { activeSrc.add(k); b.classList.add('on'); }
      if (activeSrc.size === topSrc.length) srcFilterAll = true;
    }));
  });
}
function visible(e) {
  if (!activeTypes.has(e.type)) return false;
  const k = e.srcKind + '\\u0000' + e.srcLabel;
  if (srcCounts[k] !== undefined && topSrc.some(([kk]) => kk === k)) return activeSrc.has(k);
  return srcFilterAll || activeSrc.size === topSrc.length;
}
function applyFilter() {
  dots.forEach(d => {
    const e = EVENTS[+d.dataset.i];
    d.classList.toggle('dim', !visible(e));
  });
}

/* ===== densidade ===== */
const end = new Date(); end.setHours(23, 59, 59, 999);
const start = new Date(end.getTime() - (DAYS - 1) * 86400000); start.setHours(0, 0, 0, 0);
const perDay = {};
EVENTS.forEach(e => { perDay[e.dayKey] = (perDay[e.dayKey] || 0) + 1; });
const maxDay = Math.max(1, ...Object.values(perDay));
const dens = $('dens');
for (let d = new Date(start); d <= end; d = new Date(d.getTime() + 86400000)) {
  const key = d.toISOString().slice(0, 10);
  const n = perDay[key] || 0;
  const bar = document.createElement('div');
  bar.className = 'dbar' + (n ? '' : ' zero');
  bar.style.height = n ? Math.max(8, Math.round(n / maxDay * 56)) + 'px' : '0';
  bar.title = key + ' · ' + n + ' evento' + (n === 1 ? '' : 's');
  if (n) bar.onclick = () => {
    const first = document.querySelector('.dot[data-day="' + key + '"], .daylbl[data-day="' + key + '"]');
    if (first) first.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    document.querySelectorAll('.dbar.cur').forEach(x => x.classList.remove('cur'));
    bar.classList.add('cur');
  };
  dens.appendChild(bar);
}
$('d0').textContent = start.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
$('d1').textContent = end.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });

/* ===== tooltip ===== */
const tip = $('tip');
function showTip(d) {
  const e = EVENTS[+d.dataset.i];
  tip.textContent = '';
  const w = document.createElement('div'); w.className = 't-when';
  w.textContent = e.day + ' · ' + e.time + ' · ' + e.type;
  const s = document.createElement('div'); s.textContent = e.sum || e.srcLabel;
  tip.append(w, s);
  const r = d.getBoundingClientRect();
  tip.classList.add('show');
  const tw = tip.offsetWidth;
  tip.style.left = Math.max(8, Math.min(r.left + r.width / 2 - tw / 2, innerWidth - tw - 8)) + 'px';
  tip.style.top = (r.top - tip.offsetHeight - 10) + 'px';
}
function hideTip() { tip.classList.remove('show'); }

/* ===== painel ===== */
const panel = $('panel');
function val(v) { return v === '' ? '∅' : v; }
function openPanel(i) {
  if (i < 0 || i >= EVENTS.length) return;
  sel = i;
  dots.forEach(d => d.classList.toggle('sel', +d.dataset.i === i));
  const e = EVENTS[i];
  $('pb').className = 'p-badge ' + e.cls; $('pb').textContent = e.type;
  $('pw').textContent = e.day + ' · ' + e.time;
  $('ps').textContent = e.sum || '—';
  const po = $('po');
  po.className = 'p-src ' + e.srcKind;
  po.textContent = (e.srcKind === 'wf' ? 'workflow: ' : e.srcKind === 'user' ? 'usuário: ' : '') + e.srcLabel;
  const pd = $('pd'); pd.textContent = ''; pd.style.display = e.changed.length ? '' : 'none';
  e.changed.forEach(c => {
    const row = document.createElement('div'); row.className = 'drow';
    const f = document.createElement('div'); f.className = 'dfield'; f.textContent = c.f;
    const v = document.createElement('div'); v.className = 'dvals';
    if (c.b) { const o = document.createElement('span'); o.className = 'dold'; o.textContent = val(c.b); v.appendChild(o);
      const a = document.createElement('span'); a.className = 'darr'; a.textContent = '→'; v.appendChild(a); }
    const nv = document.createElement('span'); nv.className = 'dnew'; nv.textContent = val(c.a); v.appendChild(nv);
    row.append(f, v); pd.appendChild(row);
  });
  $('pj').textContent = e.raw;
  panel.classList.add('open');
  const dot = dots.find(d => +d.dataset.i === i);
  if (dot) dot.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
}
function closePanel() {
  panel.classList.remove('open'); sel = -1;
  dots.forEach(d => d.classList.remove('sel'));
}
function step(dir) {
  if (sel < 0) return;
  let i = sel + dir;
  while (i >= 0 && i < EVENTS.length && !visible(EVENTS[i])) i += dir;
  if (i >= 0 && i < EVENTS.length) openPanel(i);
}
$('pc').onclick = closePanel;
$('prev').onclick = () => step(-1);
$('next').onclick = () => step(1);

/* ===== eventos ===== */
dots.forEach(d => {
  d.addEventListener('mouseenter', () => showTip(d));
  d.addEventListener('mouseleave', hideTip);
  d.addEventListener('focus', () => showTip(d));
  d.addEventListener('blur', hideTip);
  d.addEventListener('click', () => { hideTip(); openPanel(+d.dataset.i); });
});
const strip = $('strip');
strip.addEventListener('wheel', e => {
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { strip.scrollLeft += e.deltaY; e.preventDefault(); }
}, { passive: false });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closePanel();
  if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
  if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
  if (e.key === 'Home') strip.scrollLeft = 0;
  if (e.key === 'End') strip.scrollLeft = strip.scrollWidth;
});
buildFilters();
applyFilter();
strip.scrollLeft = strip.scrollWidth;
</script>
</body></html>`;
}
