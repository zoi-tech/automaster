import { Command } from "commander";
import path from "node:path";
import { openSession } from "./auth/session.js";
import { captureTokens, decodeCompanyId, type Tokens } from "./auth/token.js";
import { GhlClient } from "./api/client.js";
import { listWorkflows, fetchWorkflow } from "./api/workflows.js";
import {
  fetchPipelines,
  fetchCustomFields,
  fetchTags,
  fetchUsers,
  fetchCalendars,
  fetchCustomValues,
} from "./api/entities.js";
import { DumpWriter, stampNow } from "./dump/writer.js";
import {
  fetchAuditLogs,
  fetchContactAppointments,
  fetchContactOpportunityIds,
  type AuditLog,
} from "./api/audit.js";
import { renderTimelineHtml } from "./timeline_html.js";
import fs from "node:fs";
import os from "node:os";
import { execFile } from "node:child_process";

const DUMPS_DIR = path.resolve(process.cwd(), "..", "dumps");

async function runExtract(opts: { location: string }): Promise<void> {
  const locationId = opts.location;
  const { context, page } = await openSession();
  try {
    console.log("Capturando tokens (faça login na janela do Chrome, se pedido)...");
    let tokens = await captureTokens(page, locationId);
    console.log(`tokens ok (bearer ${tokens.bearer.slice(0, 12)}…, token-id ${tokens.tokenId.slice(0, 12)}…)`);

    const refresh = async (): Promise<Tokens> => {
      console.log("401 — recapturando tokens...");
      await page.reload({ waitUntil: "domcontentloaded" });
      tokens = await captureTokens(page, locationId);
      return tokens;
    };

    const client = new GhlClient(context, tokens, refresh);
    const writer = new DumpWriter(DUMPS_DIR, locationId, stampNow());

    const entries = await listWorkflows(client, locationId);
    console.log(`${entries.length} workflows. Baixando...`);
    let ok = 0;
    for (const [i, entry] of entries.entries()) {
      try {
        const full = await fetchWorkflow(client, locationId, entry);
        await writer.writeWorkflow(full);
        ok++;
        console.log(`  [${i + 1}/${entries.length}] ${entry.name}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        writer.warn(`workflow ${entry.id} (${entry.name}): ${msg}`);
        console.warn(`  [${i + 1}/${entries.length}] FALHOU: ${entry.name} — ${msg}`);
      }
    }

    console.log("Baixando entidades (pipelines, tags, custom fields, users, calendars, custom values)...");
    await writer.writeEntity("pipelines", await fetchPipelines(client, locationId));
    await writer.writeEntity("tags", await fetchTags(client, locationId));
    await writer.writeEntity("custom_fields", await fetchCustomFields(client, locationId));
    const companyId = decodeCompanyId(tokens.tokenId);
    await writer.writeEntity("users", await fetchUsers(client, locationId, companyId));
    await writer.writeEntity("calendars", await fetchCalendars(client, locationId));
    await writer.writeEntity("custom_values", await fetchCustomValues(client, locationId));

    await writer.writeManifest({ workflows: ok });
    console.log(`\nDump salvo em: ${writer.dir}`);
  } finally {
    await context.close();
  }
}

async function runDiscover(opts: { location: string }): Promise<void> {
  const { context, page } = await openSession();
  console.log(
    `Modo discover: navegue manualmente pela aba Automations da subconta ${opts.location}.\n` +
      "Os requests ao backend serão observados. (Mapeamento de endpoints — ver docs/endpoints.md.)\n" +
      "Feche a janela do Chrome para encerrar.",
  );
  page.on("request", async (req) => {
    const url = req.url();
    if (url.includes("leadconnectorhq.com") && !url.includes("google-analytics")) {
      console.log(`${req.method()} ${url}`);
    }
  });
  await page.goto(`https://app.gohighlevel.com/v2/location/${opts.location}/automation/workflows`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForEvent("close", { timeout: 0 }).catch(() => {});
  await context.close();
}

/** id → nome dos workflows do dump mais recente da subconta (melhor esforço). */
function workflowNamesFromLatestDump(locationId: string): Map<string, string> {
  const names = new Map<string, string>();
  try {
    const base = path.join(DUMPS_DIR, locationId);
    const latest = fs.readdirSync(base).sort().at(-1);
    if (!latest) return names;
    const wfDir = path.join(base, latest, "workflows");
    for (const f of fs.readdirSync(wfDir)) {
      const wf = JSON.parse(fs.readFileSync(path.join(wfDir, f), "utf-8"));
      if (wf.id && wf.name) names.set(wf.id, wf.name);
    }
  } catch {
    /* sem dump local — timeline mostra o id cru */
  }
  return names;
}

/** id → nome de pipelines e stages do dump mais recente (melhor esforço). */
function stageNamesFromLatestDump(locationId: string): {
  pipelines: Map<string, string>;
  stages: Map<string, string>;
} {
  const pipelines = new Map<string, string>();
  const stages = new Map<string, string>();
  try {
    const base = path.join(DUMPS_DIR, locationId);
    const latest = fs.readdirSync(base).sort().at(-1);
    if (!latest) return { pipelines, stages };
    const obj = JSON.parse(fs.readFileSync(path.join(base, latest, "pipelines.json"), "utf-8"));
    for (const p of obj?.raw?.pipelines ?? []) {
      if (p.id && p.name) pipelines.set(p.id, p.name);
      for (const s of p.stages ?? []) if (s.id && s.name) stages.set(s.id, s.name);
    }
  } catch {
    /* sem pipelines no dump — mostra id cru */
  }
  return { pipelines, stages };
}

/** id → nome dos usuários do dump mais recente da subconta (melhor esforço). */
function userNamesFromLatestDump(locationId: string): Map<string, string> {
  const names = new Map<string, string>();
  try {
    const base = path.join(DUMPS_DIR, locationId);
    const latest = fs.readdirSync(base).sort().at(-1);
    if (!latest) return names;
    const obj = JSON.parse(fs.readFileSync(path.join(base, latest, "users.json"), "utf-8"));
    for (const u of obj?.raw?.users ?? []) {
      const name = u.name || [u.firstName, u.lastName].filter(Boolean).join(" ");
      if (u.id && name) names.set(u.id, name);
    }
  } catch {
    /* sem users no dump — mostra id cru */
  }
  return names;
}

async function runTimeline(opts: { location: string; id: string; days: string }): Promise<void> {
  const locationId = opts.location;
  const days = Number(opts.days) || 60;
  const { context, page } = await openSession();
  try {
    console.log("Capturando tokens (faça login na janela do Chrome, se pedido)...");
    let tokens = await captureTokens(page, locationId);
    const refresh = async (): Promise<Tokens> => {
      await page.reload({ waitUntil: "domcontentloaded" });
      tokens = await captureTokens(page, locationId);
      return tokens;
    };
    const client = new GhlClient(context, tokens, refresh);

    console.log(`Buscando audit logs de ${opts.id} (últimos ${days} dias)...`);
    const logs = await fetchAuditLogs(client, locationId, opts.id, days);
    console.log(`${logs.length} eventos do contato.`);

    // oportunidades associadas → audit log de cada uma (criação, stage, status)
    let oppLogs: AuditLog[] = [];
    try {
      const oppIds = await fetchContactOpportunityIds(client, locationId, opts.id);
      for (const oid of oppIds) {
        const ol = await fetchAuditLogs(client, locationId, oid, days);
        oppLogs = oppLogs.concat(ol.map((l) => ({ ...l, documentType: l.documentType || "OPPORTUNITY" })));
      }
      console.log(`${oppIds.length} oportunidade(s), ${oppLogs.length} eventos.`);
    } catch (e) {
      console.warn(`aviso: oportunidades indisponíveis (${e instanceof Error ? e.message.slice(0, 80) : e})`);
    }

    // agendamentos → eventos sintéticos (marcos por natureza)
    let apptLogs: AuditLog[] = [];
    try {
      const appts = await fetchContactAppointments(client, locationId, opts.id, days);
      apptLogs = appts.map((a) => ({
        documentType: "APPOINTMENT",
        type: "APPOINTMENT",
        id: String(a.id ?? ""),
        documentName: String(a.title ?? "Agendamento"),
        createdAt: String(a.startTime ?? a.dateAdded ?? ""),
        after: a,
        changedFields: [],
        source: String((a as { createdBy?: { source?: string } }).createdBy?.source ?? ""),
      }));
      console.log(`${apptLogs.length} agendamento(s).`);
    } catch (e) {
      console.warn(`aviso: agendamentos indisponíveis (${e instanceof Error ? e.message.slice(0, 80) : e})`);
    }

    const { pipelines, stages } = stageNamesFromLatestDump(locationId);
    const html = renderTimelineHtml([...logs, ...oppLogs, ...apptLogs], {
      locationId,
      id: opts.id,
      days,
      wfNames: workflowNamesFromLatestDump(locationId),
      userNames: userNamesFromLatestDump(locationId),
      pipelineNames: pipelines,
      stageNames: stages,
    });
    const out = path.join(os.tmpdir(), `timeline-${opts.id}-${Date.now()}.html`);
    fs.writeFileSync(out, html, "utf-8");
    console.log(`timeline (efêmera): ${out}`);
    if (process.platform === "darwin") execFile("open", [out]);
  } finally {
    await context.close();
  }
}

const program = new Command();
program.name("automaster-extract").description("Extrai workflows GHL via API interna");

program
  .command("extract")
  .description("Extrai todos os workflows + entidades de uma subconta")
  .requiredOption("-l, --location <id>", "locationId da subconta")
  .action(runExtract);

program
  .command("timeline")
  .description("Linha do tempo (audit log) de um contato — sob demanda, sem gravar em dumps/")
  .requiredOption("-l, --location <id>", "locationId da subconta")
  .requiredOption("-i, --id <id>", "id do contato/registro")
  .option("-d, --days <n>", "janela em dias", "60")
  .action(runTimeline);

program
  .command("discover")
  .description("Observa os requests ao backend enquanto você navega (mapeia endpoints)")
  .requiredOption("-l, --location <id>", "locationId da subconta")
  .action(runDiscover);

program.parseAsync(process.argv);
