import { Command } from "commander";
import { openSession } from "../auth/session.js";
import { decodeCompanyId } from "../auth/token.js";
import { fetchTemplates as waTemplates } from "../api/whatsapp.js";
import { listWorkflows, fetchWorkflow } from "../api/workflows.js";
import { fetchEmailTemplates } from "../api/emails.js";
import { listForms, listSurveys } from "../api/forms.js";
import {
  fetchPipelines, fetchCustomFields, fetchTags, fetchUsers, fetchCalendars, fetchCustomValues,
  fetchMessageTemplates
} from "../api/entities.js";
import { DumpWriter, stampNow } from "../dump/writer.js";
import { DUMPS_DIR, withClient } from "./shared.js";
import { conferirDump } from "../dump/schema.js";

async function runExtract(opts: { location: string }): Promise<void> {
  const locationId = opts.location;
  await withClient(locationId, console.log, async (client, page, tokens) => {
    console.log(`tokens ok (bearer ${tokens.bearer.slice(0, 12)}…, token-id ${tokens.tokenId.slice(0, 12)}…)`);
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

    console.log("Baixando entidades (pipelines, tags, custom fields, users, calendars, custom values, templates)...");
    await writer.writeEntity("pipelines", await fetchPipelines(client, locationId));
    await writer.writeEntity("tags", await fetchTags(client, locationId));
    await writer.writeEntity("custom_fields", await fetchCustomFields(client, locationId));
    const companyId = decodeCompanyId(tokens.tokenId);
    await writer.writeEntity("users", await fetchUsers(client, locationId, companyId));
    await writer.writeEntity("calendars", await fetchCalendars(client, locationId));
    await writer.writeEntity("custom_values", await fetchCustomValues(client, locationId));

    // Templates, formulários e surveys: cada lista é opcional. Canal desligado na
    // subconta (WhatsApp, p.ex.) ou busca que falha vira warning no manifest, e a regra
    // que depende da lista fica no-op.
    for (const [nome, buscar] of [
      ["message_templates", () => fetchMessageTemplates(client, locationId)],
      ["whatsapp_templates", () => waTemplates(client, locationId)],
      ["email_templates", () => fetchEmailTemplates(client, locationId)],
      ["forms", () => listForms(client, locationId)],
      ["surveys", () => listSurveys(client, locationId)],
    ] as const) {
      try {
        await writer.writeEntity(nome, await buscar());
      } catch (e) {
        writer.warn(`${nome}: ${e instanceof Error ? e.message : String(e)}`);
        console.warn(`  aviso: ${nome} não veio (${e instanceof Error ? e.message : e})`);
      }
    }

    await writer.writeManifest({ workflows: ok });
    console.log(`\nDump salvo em: ${writer.dir}`);
    // Rede de formato: o auditor carrega o dump pelo MESMO dump_schema.json. Avisar aqui
    // aponta a causa; descoberto lá adiante, aparece como regra quebrada sem explicação.
    const fora = conferirDump(writer.dir);
    if (fora.length) {
      console.warn(`\naviso: o dump saiu fora do contrato de formato (dump_schema.json):`);
      for (const f of fora.slice(0, 10)) console.warn(`  ${f}`);
      if (fora.length > 10) console.warn(`  (+${fora.length - 10} outro(s))`);
    }
  });
}

async function runDiscover(opts: { location: string; area: string; rota?: string; filtro?: string }): Promise<void> {
  const { context, page, soltar } = await openSession();
  const rota = opts.rota ?? (opts.area === "contatos" ? "contacts/smart_list/All" : "automation/workflows");
  console.log(
    `Modo discover: navegue manualmente pela aba ${opts.area} da subconta ${opts.location}.\n` +
      "Os requests ao backend serão observados; escritas (não-GET) mostram o corpo. (Ver docs/endpoints.md.)\n" +
      "Feche a janela do Chrome para encerrar.",
  );
  page.on("request", (req) => {
    const url = req.url();
    // OPTIONS é preflight de CORS: mesma URL do request real, nenhuma informação nova
    if (!url.includes("leadconnectorhq.com") || url.includes("google-analytics") || req.method() === "OPTIONS") return;
    console.log(`${req.method()} ${url}`);
    if (req.method() !== "GET") {
      const h = req.headers();
      console.log(`  headers: token-id=${h["token-id"] ? "sim" : "não"} authorization=${h["authorization"] ? "sim" : "não"} version=${h["version"] ?? "-"} channel=${h["channel"] ?? "-"} source=${h["source"] ?? "-"}`);
      console.log(`  body: ${(req.postData() ?? "").slice(0, 2000)}`);
    }
  });
  page.on("response", async (res) => {
    const req = res.request();
    if (!res.url().includes("leadconnectorhq.com")) return;
    // GET só com --filtro: sem ele a aba inteira vira ruído
    if (req.method() === "GET" && !(opts.filtro && res.url().includes(opts.filtro))) return;
    const limite = req.method() === "GET" ? 4000 : 500;
    console.log(`  \u2190 ${res.status()} ${res.url()}\n  ${(await res.text().catch(() => "")).slice(0, limite)}`);
  });
  await page.goto(`https://app.gohighlevel.com/v2/location/${opts.location}/${rota}`, { waitUntil: "domcontentloaded" });
  await page.waitForEvent("close", { timeout: 0 }).catch(() => {});
  await context.close();
  soltar();
}

export function registrarExtract(program: Command): void {
  program
    .command("extract")
    .description("Extrai todos os workflows + entidades de uma subconta")
    .requiredOption("-l, --location <id>", "locationId da subconta")
    .action(runExtract);

  program
    .command("discover")
    .description("Observa os requests ao backend enquanto você navega (mapeia endpoints)")
    .requiredOption("-l, --location <id>", "locationId da subconta")
    .option("--area <area>", "workflows | contatos", "workflows")
    .option("--rota <path>", "rota livre depois de /v2/location/<id>/ (ignora --area)")
    .option("--filtro <substr>", "também mostra a resposta dos GET cuja URL contenha esta substring")
    .action(runDiscover);
}
