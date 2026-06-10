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

const program = new Command();
program.name("automaster-extract").description("Extrai workflows GHL via API interna");

program
  .command("extract")
  .description("Extrai todos os workflows + entidades de uma subconta")
  .requiredOption("-l, --location <id>", "locationId da subconta")
  .action(runExtract);

program
  .command("discover")
  .description("Observa os requests ao backend enquanto você navega (mapeia endpoints)")
  .requiredOption("-l, --location <id>", "locationId da subconta")
  .action(runDiscover);

program.parseAsync(process.argv);
