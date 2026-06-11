import type { AuditLog } from "./api/audit.js";

/** Renderiza a linha do tempo de um contato como HTML efêmero (gravar em /tmp).
 *
 * Visual "Sala de Controle" (IBM Carbon) com fontes de sistema — a página é
 * descartável, não entra em dumps/. Todo dado do CRM passa por esc().
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
    return `<span class="chip wf">workflow: ${esc(name)}</span>`;
  }
  if (src === "WEB_USER") return `<span class="chip user">usuário: ${esc(log.sourceName ?? "app")}</span>`;
  if (src) return `<span class="chip">${esc(src.toLowerCase())}</span>`;
  return "";
}

function summary(log: AuditLog): string {
  const t = String(log.type ?? "");
  const after = (log.after ?? {}) as Record<string, unknown>;
  if (t === "TAG_ADDED") return (after.tagsAdded as string[] | undefined)?.map(esc).join(", ") ?? "";
  if (t === "TAG_REMOVED") return (after.tagsRemoved as string[] | undefined)?.map(esc).join(", ") ?? "";
  const fields = (log.changedFields ?? []).map(esc).join(", ");
  return fields;
}

export function renderTimelineHtml(
  logs: AuditLog[],
  opts: { locationId: string; id: string; days: number; wfNames: Map<string, string> },
): string {
  const name = logs.find((l) => l.documentName)?.documentName ?? opts.id;
  const sorted = [...logs].sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));

  let lastDay = "";
  const rows: string[] = [];
  for (const log of sorted) {
    const dt = new Date(String(log.createdAt ?? ""));
    const day = dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
    if (day !== lastDay) {
      rows.push(`<div class="day">${esc(day)}</div>`);
      lastDay = day;
    }
    const time = dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const t = String(log.type ?? "");
    const cls = t === "TAG_ADDED" ? "add" : t === "TAG_REMOVED" ? "rm" : "upd";
    rows.push(
      `<details class="ev"><summary>` +
        `<span class="time">${esc(time)}</span>` +
        `<span class="badge ${cls}">${esc(TYPE_LABEL[t] ?? t.toLowerCase())}</span>` +
        `<span class="sum">${summary(log)}</span>` +
        sourceChip(log, opts.wfNames) +
        `</summary><pre>${esc(JSON.stringify({ before: log.before, after: log.after }, null, 2))}</pre></details>`,
    );
  }

  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TIMELINE // ${esc(name)}</title>
<style>
:root{--bg:#f4f4f4;--panel:#fff;--border:#e0e0e0;--ink:#161616;--ink2:#525252;--ink3:#8d8d8d;
  --blue:#0f62fe;--red:#da1e28;--amber:#f1c21b;--green:#24a148}
*{margin:0;padding:0;box-sizing:border-box;border-radius:0}
body{background:var(--bg);color:var(--ink);font:14px/1.4 'IBM Plex Sans',system-ui,-apple-system,sans-serif}
header{background:#161616;color:#fff;padding:12px 24px;display:flex;justify-content:space-between;align-items:baseline}
header .brand{font-family:ui-monospace,monospace;font-weight:600}
header .meta{font-family:ui-monospace,monospace;font-size:12px;color:#c6c6c6}
main{max-width:980px;margin:0 auto;padding:32px 24px 64px}
h1{font-size:24px;font-weight:400}
.sub{font-family:ui-monospace,monospace;font-size:12px;color:var(--ink2);margin:2px 0 28px}
.day{font-family:ui-monospace,monospace;font-size:11px;text-transform:uppercase;letter-spacing:.08em;
  color:var(--ink3);margin:24px 0 6px;padding-bottom:6px;border-bottom:1px solid var(--border)}
.ev{background:var(--panel);border:1px solid var(--border);border-top:none;margin:0}
.ev:first-of-type,.day+.ev{border-top:1px solid var(--border)}
.ev summary{display:flex;align-items:baseline;gap:12px;padding:9px 14px;cursor:pointer;list-style:none;flex-wrap:wrap}
.ev summary::-webkit-details-marker{display:none}
.time{font-family:ui-monospace,monospace;font-size:12px;color:var(--ink3);flex:none}
.badge{font-family:ui-monospace,monospace;font-size:10px;text-transform:uppercase;letter-spacing:.08em;
  padding:2px 8px;flex:none;border:1px solid var(--border)}
.badge.add{background:#defbe6;color:#0e6027;border-color:var(--green)}
.badge.rm{background:#fff1f1;color:#a2191f;border-color:var(--red)}
.badge.upd{background:#e8e8e8;color:#393939}
.sum{flex:1 1 auto;min-width:120px}
.chip{font-family:ui-monospace,monospace;font-size:10px;padding:2px 8px;border:1px solid #c6c6c6;
  background:#e8e8e8;color:#393939;flex:none}
.chip.wf{background:#edf5ff;color:var(--blue);border-color:var(--blue)}
.chip.user{background:#fcf4d6;color:#684e00;border-color:var(--amber)}
.ev pre{font:11px/1.5 ui-monospace,monospace;background:#fafafa;border-top:1px solid var(--border);
  padding:12px 14px;overflow-x:auto;white-space:pre-wrap;word-break:break-word}
</style></head><body>
<header><span class="brand">automaster<span style="color:#8d8d8d">/timeline</span></span>
<span class="meta">${esc(opts.locationId)} · efêmero (não gravado em dumps/)</span></header>
<main>
<h1>${esc(name)}</h1>
<div class="sub">${esc(opts.id)} · ${sorted.length} eventos · últimos ${opts.days} dias</div>
${rows.join("\n") || '<div class="sub">nenhum evento no período</div>'}
</main></body></html>`;
}
