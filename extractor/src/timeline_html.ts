import type { AuditLog } from "./api/audit.js";

/** Renderiza a linha do tempo de um contato como HTML efêmero (gravar em /tmp).
 *
 * Layout: timeline HORIZONTAL — trilho central, cronológica esquerda→direita,
 * cards alternando acima/abaixo do trilho, scroll horizontal (roda do mouse).
 * Visual "Sala de Controle" (IBM Carbon), fontes de sistema (página descartável,
 * não entra em dumps/). Todo dado do CRM passa por esc().
 */

const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const TYPE_LABEL: Record<string, string> = {
  TAG_ADDED: "+ tag",
  TAG_REMOVED: "− tag",
  UPDATED: "atualizado",
  CREATED: "criado",
  DELETED: "deletado",
};

function sourceChip(log: AuditLog, wfNames: Map<string, string>): string {
  const src = String(log.source ?? "");
  if (src === "WORKFLOW_NEW" || src === "WORKFLOW") {
    const name = wfNames.get(String(log.sourceId ?? "")) ?? String(log.sourceId ?? "workflow");
    return `<span class="chip wf">wf: ${esc(name)}</span>`;
  }
  if (src === "WEB_USER") return `<span class="chip user">${esc(log.sourceName ?? "usuário")}</span>`;
  if (src) return `<span class="chip">${esc(src.toLowerCase())}</span>`;
  return "";
}

function summary(log: AuditLog): string {
  const t = String(log.type ?? "");
  const after = (log.after ?? {}) as Record<string, unknown>;
  if (t === "TAG_ADDED") return (after.tagsAdded as string[] | undefined)?.map(esc).join(", ") ?? "";
  if (t === "TAG_REMOVED") return (after.tagsRemoved as string[] | undefined)?.map(esc).join(", ") ?? "";
  return (log.changedFields ?? []).map(esc).join(", ");
}

export function renderTimelineHtml(
  logs: AuditLog[],
  opts: { locationId: string; id: string; days: number; wfNames: Map<string, string> },
): string {
  const name = logs.find((l) => l.documentName)?.documentName ?? opts.id;
  // cronológico: mais antigo à esquerda
  const sorted = [...logs].sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")));

  let lastDay = "";
  const cols: string[] = [];
  sorted.forEach((log, i) => {
    const dt = new Date(String(log.createdAt ?? ""));
    const day = dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
    if (day !== lastDay) {
      cols.push(`<div class="daycol"><span class="daylbl">${esc(day)}</span></div>`);
      lastDay = day;
    }
    const time = dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const t = String(log.type ?? "");
    const cls = t === "TAG_ADDED" ? "add" : t === "TAG_REMOVED" ? "rm" : "upd";
    const side = i % 2 === 0 ? "top" : "bot";
    const detail = esc(JSON.stringify({ before: log.before, after: log.after }, null, 2));
    cols.push(
      `<div class="evcol ${side}">` +
        `<div class="card" tabindex="0">` +
        `<div class="row1"><span class="badge ${cls}">${esc(TYPE_LABEL[t] ?? t.toLowerCase())}</span>` +
        `<span class="time">${esc(time)}</span></div>` +
        `<div class="sum">${summary(log) || "—"}</div>` +
        `<div class="row3">${sourceChip(log, opts.wfNames)}</div>` +
        `<pre class="detail">${detail}</pre>` +
        `</div><span class="dot ${cls}"></span><span class="stem"></span></div>`,
    );
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
.titlebar{padding:16px 24px 8px;flex:none;display:flex;align-items:baseline;gap:16px}
h1{font-size:22px;font-weight:400}
.sub{font-family:ui-monospace,monospace;font-size:12px;color:var(--ink2)}
.hint{font-family:ui-monospace,monospace;font-size:11px;color:var(--ink3);margin-left:auto}
/* ===== faixa horizontal ===== */
.strip{flex:1;overflow-x:auto;overflow-y:hidden;position:relative;display:flex;align-items:stretch}
.track{display:flex;align-items:stretch;padding:0 48px;position:relative;min-width:100%}
.track::before{content:"";position:absolute;left:0;right:0;top:50%;height:1px;background:#c6c6c6}
/* coluna de dia */
.daycol{flex:none;width:84px;position:relative;display:flex;align-items:center;justify-content:center}
.daycol::before{content:"";position:absolute;top:18%;bottom:18%;left:50%;width:1px;
  background:var(--border)}
.daylbl{font-family:ui-monospace,monospace;font-size:11px;text-transform:uppercase;letter-spacing:.08em;
  color:var(--ink2);background:var(--bg);padding:4px 6px;position:relative;z-index:2}
/* coluna de evento */
.evcol{flex:none;width:240px;position:relative;display:flex;justify-content:center}
.evcol .dot{position:absolute;top:50%;left:50%;width:10px;height:10px;transform:translate(-50%,-50%);
  background:var(--panel);border:2px solid var(--ink3);z-index:2}
.evcol .dot.add{border-color:var(--green)}
.evcol .dot.rm{border-color:var(--red)}
.evcol .dot.upd{border-color:var(--ink2)}
.evcol .stem{position:absolute;left:50%;width:1px;background:#c6c6c6;z-index:1}
.evcol.top .stem{top:calc(50% - 38px);height:38px}
.evcol.bot .stem{top:50%;height:38px}
.card{position:absolute;width:216px;background:var(--panel);border:1px solid var(--border);
  padding:8px 10px;cursor:pointer;z-index:3}
.evcol.top .card{bottom:calc(50% + 38px)}
.evcol.bot .card{top:calc(50% + 38px)}
.card:hover,.card:focus{border-color:var(--blue);outline:none}
.row1{display:flex;align-items:baseline;gap:8px}
.badge{font-family:ui-monospace,monospace;font-size:10px;text-transform:uppercase;letter-spacing:.08em;
  padding:1px 7px;border:1px solid var(--border);flex:none}
.badge.add{background:#defbe6;color:#0e6027;border-color:var(--green)}
.badge.rm{background:#fff1f1;color:#a2191f;border-color:var(--red)}
.badge.upd{background:#e8e8e8;color:#393939}
.time{font-family:ui-monospace,monospace;font-size:11px;color:var(--ink3)}
.sum{font-size:12.5px;margin-top:5px;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;
  -webkit-line-clamp:2;-webkit-box-orient:vertical}
.row3{margin-top:6px;display:flex;gap:4px;flex-wrap:wrap}
.chip{font-family:ui-monospace,monospace;font-size:10px;padding:1px 7px;border:1px solid #c6c6c6;
  background:#e8e8e8;color:#393939;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chip.wf{background:#edf5ff;color:var(--blue);border-color:var(--blue)}
.chip.user{background:#fcf4d6;color:#684e00;border-color:var(--amber)}
/* detalhe expandido (clique) */
.detail{display:none;font:10.5px/1.5 ui-monospace,monospace;background:#fafafa;
  border-top:1px solid var(--border);margin-top:8px;padding:8px;max-height:240px;overflow:auto;
  white-space:pre-wrap;word-break:break-word}
.card.open{width:380px;z-index:5}
.card.open .detail{display:block}
.card.open .sum{-webkit-line-clamp:unset}
::-webkit-scrollbar{height:10px}
::-webkit-scrollbar-track{background:var(--bg)}
::-webkit-scrollbar-thumb{background:#c6c6c6}
::-webkit-scrollbar-thumb:hover{background:#8d8d8d}
</style></head><body>
<header><span class="brand">automaster<span style="color:#8d8d8d">/timeline</span></span>
<span class="meta">${esc(opts.locationId)} · efêmero (não gravado em dumps/)</span></header>
<div class="titlebar">
  <h1>${esc(name)}</h1>
  <span class="sub">${esc(opts.id)} · ${sorted.length} eventos · últimos ${opts.days} dias</span>
  <span class="hint">scroll/roda = navegar · clique no card = before/after · Home/End = extremos</span>
</div>
<div class="strip" id="strip"><div class="track">
${cols.join("\n") || '<div class="daycol"><span class="daylbl">sem eventos</span></div>'}
</div></div>
<script>
const strip = document.getElementById('strip');
strip.addEventListener('wheel', e => {
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { strip.scrollLeft += e.deltaY; e.preventDefault(); }
}, { passive: false });
document.addEventListener('keydown', e => {
  if (e.key === 'Home') strip.scrollLeft = 0;
  if (e.key === 'End') strip.scrollLeft = strip.scrollWidth;
});
document.querySelectorAll('.card').forEach(c => {
  c.addEventListener('click', () => {
    document.querySelectorAll('.card.open').forEach(o => { if (o !== c) o.classList.remove('open'); });
    c.classList.toggle('open');
  });
});
strip.scrollLeft = strip.scrollWidth; // começa no mais recente (direita)
</script>
</body></html>`;
}
