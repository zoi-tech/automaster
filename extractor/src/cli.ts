import { Command } from "commander";
import path from "node:path";
import { openSession } from "./auth/session.js";
import { captureTokens, decodeCompanyId, type Tokens } from "./auth/token.js";
import type { Page } from "playwright";
import { GhlClient } from "./api/client.js";
import { searchConversations, fetchMessages, typeName, isActivity } from "./api/conversations.js";
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
import { getContact, updateContactFields, addContactTags, removeContactTags } from "./api/contacts.js";
import fs from "node:fs";
import os from "node:os";
import { execFile } from "node:child_process";

const DUMPS_DIR = process.env.AUTOMASTER_DUMPS || path.resolve(process.cwd(), "..", "dumps");

/** Snapshot mais recente da subconta: só pastas com manifest.json contam. */
function latestDumpDir(locationId: string): string | undefined {
  try {
    const base = path.join(DUMPS_DIR, locationId);
    const snaps = fs.readdirSync(base).filter((d) => fs.existsSync(path.join(base, d, "manifest.json"))).sort();
    const latest = snaps.at(-1);
    return latest ? path.join(base, latest) : undefined;
  } catch {
    return undefined;
  }
}

/** `raw` de uma entidade do dump mais recente; undefined sem dump ou sem o arquivo. */
function latestDumpEntity(locationId: string, name: string): unknown {
  const dir = latestDumpDir(locationId);
  if (!dir) return undefined;
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), "utf-8"))?.raw;
  } catch {
    return undefined;
  }
}

/** Sessão + tokens + client, com refresh em 401; fecha o Chrome ao sair. */
async function withClient(
  locationId: string,
  log: (msg: string) => void,
  // `tokens` no callback é para o `runExtract`, que tira o companyId do token-id
  fn: (client: GhlClient, page: Page, tokens: Tokens) => Promise<void>,
): Promise<void> {
  const { context, page } = await openSession();
  try {
    log("Capturando tokens (faça login na janela do Chrome, se pedido)...");
    let tokens = await captureTokens(page, locationId);
    const refresh = async (): Promise<Tokens> => {
      log("401 — recapturando tokens...");
      await page.reload({ waitUntil: "domcontentloaded" });
      tokens = await captureTokens(page, locationId);
      return tokens;
    };
    await fn(new GhlClient(context, tokens, refresh), page, tokens);
  } finally {
    await context.close();
  }
}

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
  });
}

async function runDiscover(opts: { location: string; area: string; rota?: string; filtro?: string }): Promise<void> {
  const { context, page } = await openSession();
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
}

/** id → nome dos workflows do dump mais recente da subconta (melhor esforço). */
function workflowNamesFromLatestDump(locationId: string): Map<string, string> {
  const names = new Map<string, string>();
  const dir = latestDumpDir(locationId);
  if (!dir) return names;
  try {
    const wfDir = path.join(dir, "workflows");
    for (const f of fs.readdirSync(wfDir)) {
      const wf = JSON.parse(fs.readFileSync(path.join(wfDir, f), "utf-8"));
      if (wf.id && wf.name) names.set(wf.id, wf.name);
    }
  } catch { /* sem dump local — timeline mostra o id cru */ }
  return names;
}

/** id → nome de pipelines e stages do dump mais recente (melhor esforço). */
function stageNamesFromLatestDump(locationId: string): { pipelines: Map<string, string>; stages: Map<string, string> } {
  const pipelines = new Map<string, string>();
  const stages = new Map<string, string>();
  const raw = latestDumpEntity(locationId, "pipelines") as { pipelines?: any[] } | undefined;
  for (const p of raw?.pipelines ?? []) {
    if (p.id && p.name) pipelines.set(p.id, p.name);
    for (const s of p.stages ?? []) if (s.id && s.name) stages.set(s.id, s.name);
  }
  return { pipelines, stages };
}

/** id → nome dos usuários do dump mais recente da subconta (melhor esforço). */
function userNamesFromLatestDump(locationId: string): Map<string, string> {
  const names = new Map<string, string>();
  const raw = latestDumpEntity(locationId, "users") as { users?: any[] } | undefined;
  for (const u of raw?.users ?? []) {
    const name = u.name || [u.firstName, u.lastName].filter(Boolean).join(" ");
    if (u.id && name) names.set(u.id, name);
  }
  return names;
}

async function runTimeline(opts: { location: string; id: string; days: string; json?: boolean }): Promise<void> {
  const locationId = opts.location;
  const days = Number(opts.days) || 60;
  // em --json o stdout é só o payload; progresso vai para stderr
  const log = opts.json ? console.error : console.log;
  await withClient(locationId, log, async (client, page) => {
    log(`Buscando audit logs de ${opts.id} (últimos ${days} dias)...`);
    const logs = await fetchAuditLogs(client, locationId, opts.id, days);
    log(`${logs.length} eventos do contato.`);

    // oportunidades associadas → audit log de cada uma (criação, stage, status)
    let oppLogs: AuditLog[] = [];
    try {
      const oppIds = await fetchContactOpportunityIds(client, locationId, opts.id);
      for (const oid of oppIds) {
        const ol = await fetchAuditLogs(client, locationId, oid, days);
        oppLogs = oppLogs.concat(ol.map((l) => ({ ...l, documentType: l.documentType || "OPPORTUNITY" })));
      }
      log(`${oppIds.length} oportunidade(s), ${oppLogs.length} eventos.`);
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
      log(`${apptLogs.length} agendamento(s).`);
    } catch (e) {
      console.warn(`aviso: agendamentos indisponíveis (${e instanceof Error ? e.message.slice(0, 80) : e})`);
    }

    const { pipelines, stages } = stageNamesFromLatestDump(locationId);
    const wfNames = workflowNamesFromLatestDump(locationId);
    const events = [...logs, ...oppLogs, ...apptLogs];
    if (opts.json) {
      // sourceId → nome do workflow: o campo que costura a timeline às tools do dump
      const withNames = events.map((l) =>
        l.sourceId && wfNames.has(String(l.sourceId)) ? { ...l, sourceWorkflowName: wfNames.get(String(l.sourceId)) } : l,
      );
      process.stdout.write(JSON.stringify({ locationId, id: opts.id, days, events: withNames }) + "\n");
      return;
    }
    const html = renderTimelineHtml(events, {
      locationId,
      id: opts.id,
      days,
      wfNames,
      userNames: userNamesFromLatestDump(locationId),
      pipelineNames: pipelines,
      stageNames: stages,
    });
    const out = path.join(os.tmpdir(), `timeline-${opts.id}-${Date.now()}.html`);
    fs.writeFileSync(out, html, "utf-8");
    log(`timeline (efêmera): ${out}`);
    if (process.platform === "darwin") execFile("open", [out]);
  });
}

/** nome ou id → id de custom field (a lista do dump mistura padrão e custom). */
export function resolveFieldIds(fields: { id: string; name?: string; fieldKey?: string }[], wanted: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const w of wanted) {
    const key = w.trim().toLowerCase();
    const hits = fields.filter((f) => f.id === w || f.name?.toLowerCase() === key || f.fieldKey?.toLowerCase() === key
      || f.fieldKey?.toLowerCase().replace(/^contact\./, "") === key
      // camelCase do corpo do PUT ("companyName") também resolve para o fieldKey snake_case
      || f.fieldKey?.toLowerCase().replace(/^contact\./, "").replace(/_/g, "") === key.replace(/_/g, ""));
    if (hits.length === 0) throw new Error(`campo ${JSON.stringify(w)} não existe no dump; confira em inventario(fatia=fields) ou passe o id`);
    if (new Set(hits.map((h) => h.id)).size > 1) throw new Error(`campo ${JSON.stringify(w)} é ambíguo: ${hits.map((h) => h.id).join(", ")}; passe o id`);
    out.set(w, hits[0].id);
  }
  return out;
}

/**
 * `contact.*` STANDARD_FIELD → chave camelCase do corpo do PUT (`docs/endpoints.md` §Escrita).
 * Mapa explícito e fechado: fieldKey padrão fora daqui é erro, nunca fallback silencioso
 * (o `.replace(/^contact\./, "")` anterior gerava snake_case, a API ignorava a chave e a
 * escrita se perdia em silêncio com HTTP 200).
 */
const STANDARD_FIELD_BODY_KEY: Record<string, string> = {
  "contact.first_name": "firstName",
  "contact.last_name": "lastName",
  "contact.email": "email",
  "contact.website": "website",
  "contact.phone": "phone",
  "contact.company_name": "companyName",
  "contact.source": "source",
  "contact.date_of_birth": "dateOfBirth",
  "contact.type": "type",
  "contact.address1": "address1",
  "contact.city": "city",
  "contact.country": "country",
  "contact.state": "state",
  "contact.postal_code": "postalCode",
  "contact.timezone": "timezone",
};

/**
 * Valor de custom field: JSON quando o texto começa com `{`/`[`, senão string crua.
 * TEXTBOX_LIST só aceita objeto `{optionId: texto}` — string vira `{}` em silêncio (HTTP 200).
 */
function parseCustomValue(value: string): unknown {
  if (!/^\s*[{[]/.test(value)) return value;
  try { return JSON.parse(value); } catch { return value; }
}

/** Corpo do PUT de campos: padrão vai cru no topo, custom em `customFields: [{id, value}]` (API interna — não `field_value`). */
function buildFieldsBody(sets: readonly (readonly [string, string])[], ids: Map<string, string>, fields: any[]): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const custom: unknown[] = [];
  for (const [name, value] of sets) {
    const f = fields.find((x) => x.id === ids.get(name));
    if (f?.dataType === "STANDARD_FIELD") {
      const bodyKey = STANDARD_FIELD_BODY_KEY[String(f.fieldKey)];
      if (!bodyKey) throw new Error(`campo padrão ${JSON.stringify(f.fieldKey)} sem mapeamento conhecido para o corpo do PUT; adicione em STANDARD_FIELD_BODY_KEY antes de usar`);
      // string vazia no campo padrão é ignorada pela API; `null` é o que a UI manda para limpar
      body[bodyKey] = value === "" ? null : value;
    } else {
      // FILE_UPLOAD: a API aceita qualquer URL e forja o meta do anexo (size 1, mimetype pelo
      // sufixo) sem baixar nada — grava um anexo que não existe. Só a UI sabe subir o arquivo.
      if (f?.dataType === "FILE_UPLOAD") throw new Error(`campo ${JSON.stringify(name)} é FILE_UPLOAD: escrever por aqui grava um anexo falso (a API inventa o metadado a partir da URL). Suba o arquivo pela interface do GHL.`);
      custom.push({ id: ids.get(name), value: parseCustomValue(value) });
    }
  }
  if (custom.length) body.customFields = custom;
  return body;
}

/** `contact` do envelope do GET, com os custom fields achatados em `cf:<id>`. */
function flatContact(r: any): Record<string, unknown> {
  const c = r?.contact ?? r ?? {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(c)) if (k !== "customFields") out[k] = v;
  for (const f of (c.customFields ?? []) as any[]) out[`cf:${f.id}`] = f.value ?? f.field_value ?? f.fieldValue;
  return out;
}

/** Avisos do antes/depois: chave que sumiu (PUT replace destrutivo?) e valor pedido que não mudou (escrita ignorada — o GHL responde 200 para chave desconhecida). */
function diffAvisos(antes: unknown, depois: unknown, esperado: Map<string, string>, ignorar: Set<string>): string[] {
  const a = flatContact(antes), d = flatContact(depois);
  const vazio = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
  const avisos: string[] = [];
  for (const [k, v] of Object.entries(a))
    if (!vazio(v) && vazio(d[k]) && !esperado.has(k) && !ignorar.has(k))
      avisos.push(`possível PUT destrutivo: ${k} tinha valor antes e está vazio/ausente depois`);
  for (const [k, v] of esperado)
    if (String(d[k] ?? "") !== v && JSON.stringify(d[k] ?? "") !== v)
      avisos.push(`escrita possivelmente ignorada: ${k} deveria ser ${JSON.stringify(v)}, veio ${JSON.stringify(d[k])} — compare os valores antes de concluir: o GHL normaliza (telefone em E.164, data em ISO), e valor equivalente com outra grafia significa que a escrita passou`);
  return avisos;
}

async function runContatoEditar(opts: { location: string; id: string; set: string[]; tag: string[]; json?: boolean }): Promise<void> {
  const loc = opts.location, id = opts.id;
  const log = opts.json ? console.error : console.log;
  const fieldsRaw = latestDumpEntity(loc, "custom_fields") as { customFields?: any[] } | undefined;
  const tagsRaw = latestDumpEntity(loc, "tags") as { tags?: any[] } | undefined;
  if (!fieldsRaw || !tagsRaw) throw new Error(`sem dump de ${loc} em ${DUMPS_DIR}; rode extract primeiro`);

  const sets = opts.set.map((s) => { const i = s.indexOf("="); if (i < 1) throw new Error(`--set espera nome=valor, veio ${JSON.stringify(s)}`); return [s.slice(0, i), s.slice(i + 1)] as const; });
  // `customFields` mistura model contact|business|opportunity (homônimos: email, phone, city, state,
  // country, website, postal code); sem esse filtro os campos mais óbvios do contato caem em "ambíguo".
  const contactFields = (fieldsRaw.customFields ?? []).filter((f: any) => f.model === "contact");
  const fieldIds = resolveFieldIds(contactFields, sets.map(([n]) => n));
  const tagNames = new Map((tagsRaw.tags ?? []).map((t: any) => [String(t.name).toLowerCase(), String(t.name)]));
  const resolveTag = (t: string) => { const n = tagNames.get(t.trim().toLowerCase()); if (!n) throw new Error(`tag ${JSON.stringify(t)} não existe; a tool não cria tags`); return n; };
  for (const t of opts.tag) if (!t.startsWith("+") && !t.startsWith("-")) throw new Error(`--tag espera +nome (adicionar) ou -nome (remover), veio ${JSON.stringify(t)}`);
  const tagsAdd = opts.tag.filter((t) => t.startsWith("+")).map((t) => resolveTag(t.slice(1)));
  const tagsDel = opts.tag.filter((t) => t.startsWith("-")).map((t) => resolveTag(t.slice(1)));
  if (sets.length + tagsAdd.length + tagsDel.length === 0) throw new Error("nada a fazer: passe --set e/ou --tag");

  await withClient(loc, log, async (client) => {
    const antes = await getContact(client, loc, id);
    const snapDir = path.join(DUMPS_DIR, "_contatos", loc, id);
    fs.mkdirSync(snapDir, { recursive: true });
    const now = new Date();
    const snapPath = path.join(snapDir, `${stampNow(now)}${now.getSeconds().toString().padStart(2, "0")}.json`);
    const snap: any = { fetchedAt: new Date().toISOString(), pedido: { set: Object.fromEntries(sets), tagsAdd, tagsDel }, raw: antes, escrito: false, aplicado: [] as string[] };
    fs.writeFileSync(snapPath, JSON.stringify(snap, null, 2));
    log(`snapshot: ${snapPath}`);

    const marca = (o: string) => { snap.escrito = true; snap.aplicado.push(o); fs.writeFileSync(snapPath, JSON.stringify(snap, null, 2)); };
    const esperado = new Map<string, string>();
    if (sets.length) {
      const body = buildFieldsBody(sets, fieldIds, contactFields);
      for (const [k, v] of Object.entries(body)) if (k !== "customFields") esperado.set(k, v === null ? "" : String(v));
      for (const f of (body.customFields as any[] ?? [])) esperado.set(`cf:${f.id}`, typeof f.value === "object" && f.value !== null ? JSON.stringify(f.value) : String(f.value));
      await updateContactFields(client, loc, id, body); marca("set");
    }
    if (tagsAdd.length) { await addContactTags(client, loc, id, tagsAdd); marca("tagsAdd"); }
    if (tagsDel.length) { await removeContactTags(client, loc, id, tagsDel); marca("tagsDel"); }

    let depois: unknown;
    try {
      depois = await getContact(client, loc, id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`escrita aplicada (${snap.aplicado.join(", ") || "nada"}), mas o GET final falhou: ${msg}. snapshot em ${snapPath}`);
    }
    const avisos = diffAvisos(antes, depois, esperado, new Set(tagsDel.length ? ["tags"] : []));
    for (const a of avisos) console.error(`AVISO: ${a}`);
    const out = { locationId: loc, id, snapshot: snapPath, antes, depois, avisos,
      mudancas: { set: Object.fromEntries(sets.map(([n, v]) => [fieldIds.get(n), v])), tagsAdicionadas: tagsAdd, tagsRemovidas: tagsDel } };
    if (opts.json) process.stdout.write(JSON.stringify(out) + "\n");
    else log(`ok: ${sets.length} campo(s), +${tagsAdd.length}/-${tagsDel.length} tag(s). snapshot em ${snapPath}`);
  });
}

const program = new Command();
async function runConversas(opts: {
  location: string; id: string; max: string; atividades?: boolean; json?: boolean;
}): Promise<void> {
  const log = opts.json ? console.error : console.log;
  await withClient(opts.location, log, async (client) => {
    const convs = await searchConversations(client, opts.location, opts.id);
    if (!convs.length) {
      const vazio = { contactId: opts.id, conversas: [], mensagens: [], maisPaginas: false, proximo: null };
      if (opts.json) console.log(JSON.stringify(vazio));
      else log("Nenhuma conversa para este contato.");
      return;
    }
    const conv = convs[0];
    log(`Conversa ${conv.id} — lendo mensagens...`);
    const { mensagens, maisPaginas, proximo } = await fetchMessages(client, conv.id, Number(opts.max) || 100);
    const itens = mensagens
      .filter((m) => opts.atividades || !isActivity(m.type))
      .map((m) => ({
        id: m.id,
        data: m.dateAdded,
        tipo: typeName(m.type),
        direcao: m.direction,
        autor: m.userId ?? null,
        // campo da API: app | workflow | campaign | api | bulk_actions. Nem toda mensagem traz.
        origem: (m as { source?: string }).source ?? null,
        corpo: m.body ?? m.activity?.title ?? "",
      }));
    const payload = {
      contactId: opts.id,
      conversationId: conv.id,
      conversas: convs.map((c) => ({ id: c.id, ultimoTipo: c.lastMessageType, naoLidas: c.unreadCount })),
      n: itens.length,
      mensagens: itens,
      maisPaginas,
      proximo,
    };
    if (opts.json) { console.log(JSON.stringify(payload)); return; }
    for (const m of itens.slice().reverse()) {
      const quem = m.direcao === "inbound" ? "contato" : (m.origem ?? "saída");
      console.log(`${m.data}  ${m.tipo.padEnd(10)} ${quem.padEnd(9)} ${m.corpo.replace(/\s+/g, " ").slice(0, 120)}`);
    }
    console.log(`\n${itens.length} mensagens${maisPaginas ? " (há mais páginas)" : ""}`);
  });
}

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
  .option("--json", "imprime os eventos em JSON no stdout em vez de renderizar HTML")
  .action(runTimeline);

program
  .command("discover")
  .description("Observa os requests ao backend enquanto você navega (mapeia endpoints)")
  .requiredOption("-l, --location <id>", "locationId da subconta")
  .option("--area <area>", "workflows | contatos", "workflows")
  .option("--rota <path>", "rota livre depois de /v2/location/<id>/ (ignora --area)")
  .option("--filtro <substr>", "também mostra a resposta dos GET cuja URL contenha esta substring")
  .action(runDiscover);

program
  .command("conversas")
  .description("Mensagens trocadas com um contato (leitura ao vivo pela API interna)")
  .requiredOption("-l, --location <id>", "locationId da subconta")
  .requiredOption("-i, --id <id>", "id do contato")
  .option("--max <n>", "máximo de mensagens", "100")
  .option("--atividades", "inclui eventos de timeline (ACTIVITY_*), que não são mensagem")
  .option("--json", "imprime o resultado em JSON no stdout")
  .action((o) => runConversas(o).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); }));

program
  .command("contato-editar")
  .description("ESCREVE: altera campos/tags de um contato via API interna, com snapshot antes")
  .requiredOption("-l, --location <id>", "locationId da subconta")
  .requiredOption("-i, --id <id>", "id do contato")
  .option("--set <nome=valor>", "campo (nome, fieldKey ou id) = valor; repetível", (v: string, acc: string[]) => [...acc, v], [])
  .option("--tag <+nome|-nome>", "adiciona (+) ou remove (-) tag; repetível", (v: string, acc: string[]) => [...acc, v], [])
  .option("--json", "imprime o resultado em JSON no stdout")
  .action((o) => runContatoEditar(o).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); }));

program.parseAsync(process.argv);
