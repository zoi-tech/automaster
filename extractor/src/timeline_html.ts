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
/* FUI industrial — cinza claro, hairlines técnicas, mono, acento verde único */
:root{--bg:#f1f1ef;--panel:#fafaf9;--line:#d6d6d1;--line2:#9c9c95;--ink:#17170f;--ink2:#56564e;
  --ink3:#8e8e85;--grn:#00A859;--grn-ink:#00743d;--grn-tint:#e1f4e9;
  --mono:'IBM Plex Mono',ui-monospace,SFMono-Regular,Menlo,monospace}
*{margin:0;padding:0;box-sizing:border-box;border-radius:0}
html,body{height:100%}
body{background:var(--bg);color:var(--ink);font:13px/1.45 var(--mono);
  display:flex;flex-direction:column;overflow:hidden}
/* moldura externa com cantos pretos + ticks (assinatura FUI) */
#frame{position:fixed;inset:6px;pointer-events:none;z-index:30;border:1px solid var(--line2);
  background-image:
    linear-gradient(var(--ink),var(--ink)),linear-gradient(var(--ink),var(--ink)),
    linear-gradient(var(--ink),var(--ink)),linear-gradient(var(--ink),var(--ink)),
    linear-gradient(var(--grn),var(--grn));
  background-repeat:no-repeat;
  background-size:22px 3px,3px 22px,22px 3px,3px 22px,38px 3px;
  background-position:left top,left top,right bottom,right bottom,right top}
header.top{padding:18px 32px 0;display:flex;justify-content:space-between;align-items:baseline;flex:none}
.brand{font-size:12px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;
  display:flex;align-items:center;gap:8px}
.gdot{width:9px;height:9px;background:var(--grn);display:inline-block}
.meta{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink3)}
/* título */
.titlebar{padding:14px 32px 0;flex:none;display:flex;align-items:baseline;gap:14px;flex-wrap:wrap}
h1{font-family:var(--mono);font-size:19px;font-weight:600;letter-spacing:.06em;text-transform:uppercase}
.idbox{font-size:11px;border:1px solid var(--ink);padding:2px 9px;letter-spacing:.08em}
.sub{font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink2)}
/* filtros */
.filters{padding:12px 32px 14px;flex:none;display:flex;gap:6px;flex-wrap:wrap;align-items:center;
  border-bottom:1px solid var(--line)}
.flabel{font-size:9px;text-transform:uppercase;letter-spacing:.16em;color:var(--ink3);margin-right:4px}
.fchip{font-family:var(--mono);font-size:10.5px;letter-spacing:.04em;padding:4px 10px;
  border:1px solid var(--line2);background:var(--panel);color:var(--ink2);cursor:pointer;user-select:none}
.fchip:hover{border-color:var(--ink)}
.fchip::before{content:"";display:inline-block;width:7px;height:7px;border:1px solid var(--line2);
  margin-right:7px;vertical-align:0;background:transparent}
.fchip.on{border-color:var(--ink);color:var(--ink)}
.fchip.on::before{background:var(--grn);border-color:var(--grn)}
.fchip .n{color:var(--ink3);margin-left:5px}
.fsep{width:1px;height:18px;background:var(--line2);margin:0 10px}
/* densidade — sismógrafo */
.density{flex:none;padding:16px 32px 8px;position:relative}
.density::before{content:"REGISTRO / 24H";position:absolute;top:2px;left:32px;font-size:9px;
  letter-spacing:.16em;color:var(--ink3)}
.dens-bars{display:flex;align-items:flex-end;gap:2px;height:52px;
  border-bottom:1px dashed var(--line2);padding-top:12px}
.dbar{flex:1 1 0;min-width:2px;background:var(--ink2);cursor:pointer}
.dbar:hover,.dbar.cur{background:var(--grn)}
.dbar.zero{background:transparent;border-bottom:2px solid var(--line);cursor:default}
.dens-axis{display:flex;justify-content:space-between;font-size:9px;letter-spacing:.1em;
  text-transform:uppercase;color:var(--ink3);padding-top:5px}
/* trilho */
.strip{flex:none;height:190px;overflow-x:auto;overflow-y:hidden;display:flex;align-items:center;
  border-bottom:1px solid var(--line);background:var(--panel);position:relative}
.track{display:flex;align-items:center;gap:5px;padding:0 56px;position:relative;min-width:100%;height:100%}
.track::before{content:"";position:absolute;left:0;right:0;top:50%;height:1px;
  background:repeating-linear-gradient(90deg,var(--line2) 0 5px,transparent 5px 9px)}
.track::after{content:"+";position:absolute;top:12px;right:18px;color:var(--line2);font-size:14px}
.daylbl{font-size:9.5px;text-transform:uppercase;letter-spacing:.12em;color:var(--ink);
  background:var(--panel);border:1px solid var(--ink);border-left:3px solid var(--grn);
  padding:3px 8px;position:relative;z-index:2;flex:none;margin:0 12px 0 20px}
.gap{flex:none;width:34px;height:1px;position:relative;z-index:2;
  background:repeating-linear-gradient(90deg,var(--ink) 0 3px,transparent 3px 9px)}
.midgap{flex:none;width:12px}
.dot{width:11px;height:11px;background:var(--panel);border:2px solid var(--ink3);
  position:relative;z-index:2;flex:none;cursor:pointer;transition:transform .07s}
.dot.add{border-color:var(--grn)}
.dot.rm{border-color:var(--ink);background:var(--ink)}
.dot.new{border-color:var(--grn);background:var(--grn)}
.dot.upd{border-color:var(--line2)}
.dot:hover,.dot:focus{transform:scale(1.65);outline:none;z-index:3}
.dot.sel{transform:scale(1.65);background:var(--ink);border-color:var(--grn);z-index:3}
.dot.dim{opacity:.15;pointer-events:none}
/* tooltip leve */
#tip{position:fixed;display:none;background:var(--panel);color:var(--ink);padding:7px 11px;z-index:20;
  font-size:11px;max-width:340px;pointer-events:none;border:1px solid var(--ink);
  box-shadow:3px 3px 0 var(--line)}
#tip .t-when{font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:var(--grn-ink)}
#tip.show{display:block}
/* painel lateral */
#panel{position:fixed;top:0;right:0;bottom:0;width:430px;background:var(--panel);
  border-left:1px solid var(--ink);transform:translateX(100%);transition:transform .15s;z-index:25;
  display:flex;flex-direction:column;
  background-image:linear-gradient(var(--grn),var(--grn));background-repeat:no-repeat;
  background-size:3px 38px;background-position:left top}
#panel.open{transform:none}
.p-head{flex:none;display:flex;align-items:baseline;gap:10px;padding:16px;
  border-bottom:1px solid var(--line)}
.p-badge{font-size:9.5px;text-transform:uppercase;letter-spacing:.12em;padding:3px 9px;
  border:1px solid var(--line2)}
.p-badge.add{background:var(--grn-tint);color:var(--grn-ink);border-color:var(--grn)}
.p-badge.rm{background:var(--ink);color:#fff;border-color:var(--ink)}
.p-badge.new{background:var(--grn);color:#fff;border-color:var(--grn)}
.p-badge.upd{background:#e9e9e5;color:var(--ink2)}
.p-when{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink2)}
.p-close{margin-left:auto;cursor:pointer;border:none;background:none;font-size:15px;
  color:var(--ink3);font-family:var(--mono)}
.p-close:hover{color:var(--ink)}
.p-body{flex:1;overflow-y:auto;padding:16px}
.p-sum{font-size:13.5px;margin-bottom:10px}
.p-src{font-size:10px;letter-spacing:.06em;padding:3px 9px;border:1px solid;display:inline-block;
  margin-bottom:16px}
.p-src.wf{color:var(--grn-ink);border-color:var(--grn);background:var(--grn-tint)}
.p-src.user{color:var(--ink);border-color:var(--ink);background:transparent}
.p-src.other{color:var(--ink2);border-color:var(--line2);background:#e9e9e5}
.diff{border:1px solid var(--ink);margin-bottom:16px}
.drow{display:grid;grid-template-columns:120px 1fr;border-top:1px solid var(--line)}
.drow:first-child{border-top:none}
.dfield{font-size:10px;letter-spacing:.04em;color:var(--ink2);padding:8px 10px;
  border-right:1px solid var(--line);word-break:break-word}
.dvals{padding:8px 10px;font-size:11.5px}
.dold{color:var(--ink3);text-decoration:line-through;word-break:break-word}
.dnew{color:var(--ink);word-break:break-word}
.dnew::before{content:"";display:inline-block;width:6px;height:6px;background:var(--grn);
  margin-right:6px;vertical-align:1px}
.darr{color:var(--ink3);margin:0 6px}
.p-body details summary{font-size:10px;letter-spacing:.1em;text-transform:uppercase;
  color:var(--ink2);cursor:pointer}
.p-body pre{font:10px/1.55 var(--mono);background:#f4f4f1;border:1px solid var(--line);
  padding:10px;margin-top:8px;white-space:pre-wrap;word-break:break-word}
.p-nav{flex:none;display:flex;border-top:1px solid var(--ink)}
.p-nav button{flex:1;border:none;background:var(--panel);font-family:var(--mono);font-size:10px;
  letter-spacing:.1em;text-transform:uppercase;padding:12px;cursor:pointer;color:var(--ink2)}
.p-nav button:hover{background:var(--grn);color:#fff}
.p-nav button+button{border-left:1px solid var(--line)}
::-webkit-scrollbar{height:10px;width:10px}
::-webkit-scrollbar-track{background:var(--bg)}
::-webkit-scrollbar-thumb{background:var(--line2)}
::-webkit-scrollbar-thumb:hover{background:var(--ink2)}
</style></head><body>
<div id="frame"></div>
<header class="top"><span class="brand"><span class="gdot"></span>automaster // timeline</span>
<span class="meta">${esc(opts.locationId)} \\\\ efêmero \\\\ não gravado em dumps/</span></header>
<div class="titlebar">
  <h1>${esc(name)}</h1>
  <span class="idbox">${esc(opts.id)}</span>
  <span class="sub">${events.length} eventos \\\\ últimos ${opts.days} dias</span>
  <span class="sub" style="margin-left:auto;color:var(--ink3)">hover=espiar · clique=detalhe · ←/→ · esc</span>
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
