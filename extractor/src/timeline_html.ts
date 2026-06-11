import type { AuditLog } from "./api/audit.js";

/** Renderiza a linha do tempo de um contato como HTML efêmero (gravar em /tmp).
 *
 * Layout: timeline horizontal CONDENSADA — todos os eventos são pontos no
 * trilho; hover num ponto expande popover com o detalhe (clique fixa/solta).
 * Visual "Sala de Controle" (IBM Carbon), fontes de sistema (página descartável,
 * não entra em dumps/). Dados viram JSON embutido (escape anti-</script>) e o
 * popover é montado só com textContent — XSS-safe.
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

function sourceText(log: AuditLog, wfNames: Map<string, string>): string {
  const src = String(log.source ?? "");
  if (src === "WORKFLOW_NEW" || src === "WORKFLOW") {
    return "workflow: " + (wfNames.get(String(log.sourceId ?? "")) ?? String(log.sourceId ?? ""));
  }
  if (src === "WEB_USER") return "usuário: " + String(log.sourceName ?? "app");
  return src.toLowerCase();
}

function summaryText(log: AuditLog): string {
  const t = String(log.type ?? "");
  const after = (log.after ?? {}) as Record<string, unknown>;
  if (t === "TAG_ADDED") return ((after.tagsAdded as string[]) ?? []).join(", ");
  if (t === "TAG_REMOVED") return ((after.tagsRemoved as string[]) ?? []).join(", ");
  return (log.changedFields ?? []).join(", ");
}

export function renderTimelineHtml(
  logs: AuditLog[],
  opts: { locationId: string; id: string; days: number; wfNames: Map<string, string> },
): string {
  const name = logs.find((l) => l.documentName)?.documentName ?? opts.id;
  const sorted = [...logs].sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")));

  // dados do popover (montado client-side com textContent)
  const events = sorted.map((log) => {
    const dt = new Date(String(log.createdAt ?? ""));
    const t = String(log.type ?? "");
    return {
      time: dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      day: dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" }),
      type: TYPE_LABEL[t] ?? t.toLowerCase(),
      cls: t === "TAG_ADDED" ? "add" : t === "TAG_REMOVED" ? "rm" : "upd",
      sum: summaryText(log),
      src: sourceText(log, opts.wfNames),
      detail: JSON.stringify({ before: log.before, after: log.after }, null, 2),
    };
  });

  // trilho: marcador de dia + pontos
  let lastDay = "";
  const marks: string[] = [];
  sorted.forEach((log, i) => {
    const dt = new Date(String(log.createdAt ?? ""));
    const day = dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
    if (day !== lastDay) {
      marks.push(`<span class="daylbl">${esc(day)}</span>`);
      lastDay = day;
    }
    marks.push(`<span class="dot ${esc(events[i].cls)}" data-i="${i}" tabindex="0"></span>`);
  });

  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TIMELINE // ${esc(name)}</title>
<style>
:root{--bg:#f4f4f4;--panel:#fff;--border:#e0e0e0;--ink:#161616;--ink2:#525252;--ink3:#8d8d8d;
  --blue:#0f62fe;--red:#da1e28;--amber:#f1c21b;--green:#24a148}
*{margin:0;padding:0;box-sizing:border-box;border-radius:0}
html,body{height:100%}
body{background:var(--bg);color:var(--ink);font:14px/1.4 'IBM Plex Sans',system-ui,-apple-system,sans-serif;
  display:flex;flex-direction:column;overflow:hidden}
header{background:#161616;color:#fff;padding:12px 24px;display:flex;justify-content:space-between;
  align-items:baseline;flex:none}
header .brand{font-family:ui-monospace,monospace;font-weight:600}
header .meta{font-family:ui-monospace,monospace;font-size:12px;color:#c6c6c6}
.titlebar{padding:16px 24px;flex:none;display:flex;align-items:baseline;gap:16px}
h1{font-size:22px;font-weight:400}
.sub{font-family:ui-monospace,monospace;font-size:12px;color:var(--ink2)}
.hint{font-family:ui-monospace,monospace;font-size:11px;color:var(--ink3);margin-left:auto}
/* ===== trilho condensado ===== */
.strip{flex:1;overflow-x:auto;overflow-y:hidden;display:flex;align-items:center;position:relative}
.track{display:flex;align-items:center;gap:6px;padding:0 48px;position:relative;min-width:100%;height:120px}
.track::before{content:"";position:absolute;left:0;right:0;top:50%;height:1px;background:#c6c6c6}
.daylbl{font-family:ui-monospace,monospace;font-size:10px;text-transform:uppercase;letter-spacing:.08em;
  color:var(--ink2);background:var(--bg);border:1px solid var(--border);padding:2px 6px;
  position:relative;z-index:2;flex:none;margin:0 6px}
.dot{width:11px;height:11px;background:var(--panel);border:2px solid var(--ink3);
  position:relative;z-index:2;flex:none;cursor:pointer;transition:transform .08s}
.dot.add{border-color:var(--green)}
.dot.rm{border-color:var(--red)}
.dot.upd{border-color:var(--ink2)}
.dot:hover,.dot:focus,.dot.pin{transform:scale(1.7);background:var(--ink);outline:none;z-index:3}
/* ===== popover ===== */
#pop{position:fixed;display:none;width:360px;max-height:55vh;overflow:auto;background:var(--panel);
  border:1px solid var(--ink);z-index:10;box-shadow:none}
#pop.show{display:block}
#pop .p-head{display:flex;align-items:baseline;gap:10px;padding:9px 12px;border-bottom:1px solid var(--border)}
#pop .p-badge{font-family:ui-monospace,monospace;font-size:10px;text-transform:uppercase;
  letter-spacing:.08em;padding:1px 7px;border:1px solid var(--border)}
#pop .p-badge.add{background:#defbe6;color:#0e6027;border-color:var(--green)}
#pop .p-badge.rm{background:#fff1f1;color:#a2191f;border-color:var(--red)}
#pop .p-badge.upd{background:#e8e8e8;color:#393939}
#pop .p-when{font-family:ui-monospace,monospace;font-size:11px;color:var(--ink3)}
#pop .p-sum{padding:8px 12px;font-size:13px}
#pop .p-src{padding:0 12px 8px;font-family:ui-monospace,monospace;font-size:11px;color:var(--blue)}
#pop pre{font:10.5px/1.5 ui-monospace,monospace;background:#fafafa;border-top:1px solid var(--border);
  padding:10px 12px;white-space:pre-wrap;word-break:break-word}
::-webkit-scrollbar{height:10px;width:10px}
::-webkit-scrollbar-track{background:var(--bg)}
::-webkit-scrollbar-thumb{background:#c6c6c6}
::-webkit-scrollbar-thumb:hover{background:#8d8d8d}
</style></head><body>
<header><span class="brand">automaster<span style="color:#8d8d8d">/timeline</span></span>
<span class="meta">${esc(opts.locationId)} · efêmero (não gravado em dumps/)</span></header>
<div class="titlebar">
  <h1>${esc(name)}</h1>
  <span class="sub">${esc(opts.id)} · ${sorted.length} eventos · últimos ${opts.days} dias</span>
  <span class="hint">hover no ponto = expande · clique = fixa · roda = navegar</span>
</div>
<div class="strip" id="strip"><div class="track">
${marks.join("\n") || '<span class="daylbl">sem eventos</span>'}
</div></div>
<div id="pop"></div>
<script>
const EVENTS = ${safeJson(events)};
const strip = document.getElementById('strip');
const pop = document.getElementById('pop');
let pinned = null;

function fill(i) {
  const e = EVENTS[i];
  pop.textContent = '';
  const head = document.createElement('div'); head.className = 'p-head';
  const badge = document.createElement('span'); badge.className = 'p-badge ' + e.cls; badge.textContent = e.type;
  const when = document.createElement('span'); when.className = 'p-when'; when.textContent = e.day + ' · ' + e.time;
  head.append(badge, when);
  const sum = document.createElement('div'); sum.className = 'p-sum'; sum.textContent = e.sum || '—';
  const src = document.createElement('div'); src.className = 'p-src'; src.textContent = e.src;
  const pre = document.createElement('pre'); pre.textContent = e.detail;
  pop.append(head, sum, src, pre);
}
function place(dot) {
  const r = dot.getBoundingClientRect();
  const w = 360, margin = 12;
  let x = r.left + r.width / 2 - w / 2;
  x = Math.max(margin, Math.min(x, window.innerWidth - w - margin));
  pop.style.left = x + 'px';
  pop.style.top = '';
  pop.style.bottom = '';
  if (r.top > window.innerHeight / 2) { pop.style.bottom = (window.innerHeight - r.top + 10) + 'px'; }
  else { pop.style.top = (r.bottom + 10) + 'px'; }
}
function show(dot) { fill(+dot.dataset.i); place(dot); pop.classList.add('show'); }
function hide() { if (!pinned) pop.classList.remove('show'); }

document.querySelectorAll('.dot').forEach(d => {
  d.addEventListener('mouseenter', () => { if (!pinned) show(d); });
  d.addEventListener('focus', () => { if (!pinned) show(d); });
  d.addEventListener('mouseleave', hide);
  d.addEventListener('blur', hide);
  d.addEventListener('click', () => {
    if (pinned === d) { pinned = null; d.classList.remove('pin'); pop.classList.remove('show'); return; }
    if (pinned) pinned.classList.remove('pin');
    pinned = d; d.classList.add('pin'); show(d);
  });
});
strip.addEventListener('wheel', e => {
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { strip.scrollLeft += e.deltaY; e.preventDefault(); }
}, { passive: false });
document.addEventListener('keydown', e => {
  if (e.key === 'Home') strip.scrollLeft = 0;
  if (e.key === 'End') strip.scrollLeft = strip.scrollWidth;
  if (e.key === 'Escape' && pinned) { pinned.classList.remove('pin'); pinned = null; pop.classList.remove('show'); }
});
</script>
</body></html>`;
}
