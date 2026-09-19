import { Command } from "commander";
import path from "node:path";
import { openSession } from "./auth/session.js";
import { captureTokens, decodeCompanyId, type Tokens } from "./auth/token.js";
import type { Page } from "playwright";
import { GhlClient } from "./api/client.js";
import {
  searchConversations, fetchMessages, sendMessage, typeName, isActivity, SEND_TYPES, type SendType,
  searchInConversation, searchMessages, fetchEmail, fetchTranscription, recordingUrl,
  updateConversation, deleteConversation, saveDraft, fetchDrafts, deleteDraft, cancelScheduled, resend,
  uploadAttachments,
} from "./api/conversations.js";
import {
  isConfigured as waIsConfigured, fetchPhoneNumbers as waPhoneNumbers, fetchTemplates as waTemplates,
  fetchApprovedTemplateOptions as waApproved, fetchFlows as waFlows, sendTemplate as waSendTemplate,
  sendFlow as waSendFlow,
} from "./api/whatsapp.js";
import {
  fetchAiSettings, updateAiSettings, fetchSlaSettings, fetchSlaInboxStatus,
  fetchSlaClearPermission, updateSlaSettings, clearSla,
} from "./api/settings.js";
import { createGroup, sendGroupMessage, checkInternalChat, updateInternalChatParticipants } from "./api/group.js";
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
import {
  listPipelines, listOpportunities, searchOpportunities, getOpportunity,
  createOpportunity, updateOpportunity, deleteOpportunity, restoreOpportunity,
  createPipeline, updatePipeline, deletePipeline,
} from "./api/opportunities.js";
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
  location: string; id: string; max: string; atividades?: boolean; tipo?: string;
  busca?: string; email?: string; transcricao?: string; json?: boolean;
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

    // atalhos que não precisam listar a conversa inteira
    if (opts.email) {
      const em = await fetchEmail(client, opts.email);
      console.log(opts.json ? JSON.stringify(em) : JSON.stringify(em, null, 2));
      return;
    }
    if (opts.transcricao) {
      const tr = await fetchTranscription(client, opts.location, opts.transcricao);
      console.log(opts.json ? JSON.stringify(tr) : JSON.stringify(tr, null, 2));
      return;
    }

    let filtroIds: Set<string> | null = null;
    if (opts.busca) {
      const hits = await searchInConversation(client, opts.location, conv.id, opts.busca);
      filtroIds = new Set(hits.map((h) => h.messageId));
      log(`Busca "${opts.busca}": ${filtroIds.size} mensagens.`);
    }

    log(`Conversa ${conv.id} — lendo mensagens...`);
    const { mensagens, maisPaginas, proximo } = await fetchMessages(
      client, conv.id, Number(opts.max) || 100, 50, opts.tipo);
    const itens = mensagens
      .filter((m) => (filtroIds ? filtroIds.has(m.id) : true))
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
        // o e-mail completo se pede com este id, não com o da mensagem
        emailMessageId: (m as { altId?: string }).altId ?? null,
        temGravacao: Boolean((m as { meta?: unknown }).meta),
      }));
    const payload = {
      contactId: opts.id,
      conversationId: conv.id,
      conversas: convs.map((c) => ({ id: c.id, ultimoTipo: c.lastMessageType, naoLidas: c.unreadCount })),
      gravacaoUrlBase: recordingUrl(opts.location, "<messageId>"),
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

const MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".pdf": "application/pdf", ".mp4": "video/mp4", ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg", ".txt": "text/plain", ".csv": "text/csv",
};

/** Grava o rastro de uma escrita que não tem desfazer. */
function registroEscrita(loc: string, pasta: string, chave: string, dados: unknown): string {
  const dir = path.join(DUMPS_DIR, pasta, loc, chave);
  fs.mkdirSync(dir, { recursive: true });
  const now = new Date();
  const registro = path.join(dir, `${stampNow(now)}${now.getSeconds().toString().padStart(2, "0")}.json`);
  fs.writeFileSync(registro, JSON.stringify({ em: now.toISOString(), ...(dados as object) }, null, 2));
  return registro;
}

const OPP_ACOES = ["criar", "editar", "mover", "status", "apagar", "restaurar"];
const PIPE_ACOES = ["criar", "editar", "apagar"];

async function runOportunidades(opts: {
  location: string; o: string; id?: string; pipeline?: string; estagio?: string;
  status?: string; contato?: string; termo?: string; limite?: string; json?: boolean;
}): Promise<void> {
  const log = opts.json ? console.error : console.log;
  await withClient(opts.location, log, async (client) => {
    const filtro = {
      pipeline_id: opts.pipeline,
      pipeline_stage_id: opts.estagio,
      status: opts.status,
      contact_id: opts.contato,
      limit: opts.limite ? Number(opts.limite) : undefined,
    };
    let out: unknown;
    switch (opts.o) {
      case "pipelines": out = await listPipelines(client, opts.location); break;
      case "listar": out = await listOpportunities(client, opts.location, filtro); break;
      case "buscar":
        if (!opts.termo) throw new Error("-o buscar exige --termo");
        out = await searchOpportunities(client, opts.location, opts.termo, filtro);
        break;
      case "ver":
        if (!opts.id) throw new Error("-o ver exige --id");
        out = await getOpportunity(client, opts.id);
        break;
      default:
        throw new Error(`-o inválido: ${opts.o}. Aceitos: pipelines, listar, buscar, ver`);
    }
    if (opts.json) console.log(JSON.stringify(out));
    else console.log(JSON.stringify(out, null, 2));
  });
}

async function runOportunidadeAcao(opts: {
  location: string; acao: string; id?: string; pipeline?: string; estagio?: string;
  nome?: string; valor?: string; status?: string; contato?: string; dono?: string;
  confirmo?: boolean; json?: boolean;
}): Promise<void> {
  const log = opts.json ? console.error : console.log;
  if (!OPP_ACOES.includes(opts.acao)) {
    throw new Error(`--acao inválida: ${opts.acao}. Aceitas: ${OPP_ACOES.join(", ")}`);
  }
  if (!opts.confirmo) {
    throw new Error("Isto muda dado real da subconta e não tem desfazer. Repita com --confirmo.");
  }
  if (opts.acao === "criar") {
    if (!opts.pipeline || !opts.nome || !opts.contato) {
      throw new Error("criar exige --pipeline, --nome e --contato");
    }
  } else if (!opts.id) {
    throw new Error(`${opts.acao} exige --id da oportunidade`);
  }
  if (opts.acao !== "criar" && opts.contato) {
    throw new Error(
      "não dá para trocar o contato de uma oportunidade: o vínculo se define quando o card " +
      "nasce. Crie outro card para a pessoa certa.",
    );
  }

  await withClient(opts.location, log, async (client) => {
    const corpo = {
      ...(opts.nome ? { name: opts.nome } : {}),
      // o servidor exige `status` na criação; `open` é o estado natural de um card novo
      ...(opts.status ? { status: opts.status } : opts.acao === "criar" ? { status: "open" } : {}),
      ...(opts.pipeline ? { pipelineId: opts.pipeline } : {}),
      ...(opts.estagio ? { pipelineStageId: opts.estagio } : {}),
      ...(opts.contato ? { contactId: opts.contato } : {}),
      ...(opts.valor ? { monetaryValue: Number(opts.valor) } : {}),
      ...(opts.dono ? { assignedTo: opts.dono } : {}),
    };
    const antes = opts.id ? await getOpportunity(client, opts.id).catch(() => null) : null;
    const registro = registroEscrita(opts.location, "_oportunidades", opts.id ?? "novo", {
      acao: opts.acao, corpo, antes, aplicado: false,
    });

    let r: unknown;
    switch (opts.acao) {
      case "criar": r = await createOpportunity(client, opts.location, corpo); break;
      case "editar":
      case "mover":
      case "status": r = await updateOpportunity(client, opts.id!, corpo); break;
      case "apagar": r = await deleteOpportunity(client, opts.id!); break;
      case "restaurar": r = await restoreOpportunity(client, opts.id!); break;
    }
    fs.writeFileSync(registro, JSON.stringify({
      em: new Date().toISOString(), acao: opts.acao, corpo, antes, aplicado: true, resposta: r,
    }, null, 2));
    const out = { aplicado: true, acao: opts.acao, resposta: r, registro };
    if (opts.json) console.log(JSON.stringify(out));
    else log(`ok — ${opts.acao}; registro em ${registro}`);
  });
}

/** Estágios que sumiriam com a nova lista, e quantos cards vivem em cada um. */
async function estagiosQueSomem(
  client: GhlClient, locationId: string, pipelineId: string, novos: { id?: string; name: string }[],
): Promise<{ id: string; name: string; cards: number }[]> {
  const atual = await listPipelines(client, locationId);
  const p = (atual.pipelines ?? []).find((x) => x.id === pipelineId);
  if (!p) throw new Error(`pipeline ${pipelineId} não existe na subconta`);
  const mantidos = new Set(novos.map((s) => s.id).filter(Boolean));
  const somem = (p.stages ?? []).filter((s) => !mantidos.has(s.id));
  const out: { id: string; name: string; cards: number }[] = [];
  for (const s of somem) {
    const r = await listOpportunities(client, locationId, {
      pipeline_id: pipelineId, pipeline_stage_id: s.id, status: "all", limit: 1,
    }) as { total?: number; opportunities?: unknown[] };
    out.push({ id: s.id, name: s.name, cards: r.total ?? (r.opportunities?.length ?? 0) });
  }
  return out.filter((s) => s.cards > 0);
}

async function runPipeline(opts: {
  location: string; acao: string; id?: string; nome?: string; estagios?: string;
  confirmo?: boolean; apagarComCards?: boolean; json?: boolean;
}): Promise<void> {
  const log = opts.json ? console.error : console.log;
  if (!PIPE_ACOES.includes(opts.acao)) {
    throw new Error(`--acao inválida: ${opts.acao}. Aceitas: ${PIPE_ACOES.join(", ")}`);
  }
  if (!opts.confirmo) {
    throw new Error("Isto muda a estrutura do funil e não tem desfazer. Repita com --confirmo.");
  }
  if (opts.acao !== "criar" && !opts.id) throw new Error(`${opts.acao} exige --id do pipeline`);
  if (opts.acao === "criar" && !opts.nome) throw new Error("criar exige --nome");

  let estagios: { id?: string; name: string; position?: number }[] = [];
  if (opts.estagios) {
    try {
      estagios = JSON.parse(opts.estagios);
    } catch {
      throw new Error('--estagios precisa ser JSON: [{"id":"...","name":"..."}]');
    }
    if (!Array.isArray(estagios)) throw new Error("--estagios precisa ser uma lista JSON");
  }
  if (opts.acao !== "apagar" && estagios.length === 0) {
    throw new Error(`${opts.acao} exige --estagios com a lista completa dos estágios que devem existir`);
  }

  await withClient(opts.location, log, async (client) => {
    if (opts.acao === "editar") {
      const somem = await estagiosQueSomem(client, opts.location, opts.id!, estagios);
      if (somem.length > 0 && !opts.apagarComCards) {
        const linhas = somem.map((s) => `  ${s.name} (${s.cards} card${s.cards > 1 ? "s" : ""})`).join("\n");
        throw new Error(
          `esta edição remove estágio que tem card dentro:\n${linhas}\n` +
          "Os cards somem junto e não voltam. Esvazie os estágios antes, ou repita com --apagar-com-cards.",
        );
      }
    }
    const registro = registroEscrita(opts.location, "_oportunidades", `pipeline-${opts.id ?? "novo"}`, {
      acao: opts.acao, nome: opts.nome, estagios,
      antes: await listPipelines(client, opts.location).catch(() => null),
      aplicado: false,
    });
    let r: unknown;
    switch (opts.acao) {
      case "criar": r = await createPipeline(client, opts.location, opts.nome!, estagios); break;
      case "editar": r = await updatePipeline(client, opts.location, opts.id!, opts.nome ?? "", estagios); break;
      case "apagar": r = await deletePipeline(client, opts.location, opts.id!); break;
    }
    fs.writeFileSync(registro, JSON.stringify({
      em: new Date().toISOString(), acao: opts.acao, aplicado: true, resposta: r,
    }, null, 2));
    const out = { aplicado: true, acao: opts.acao, resposta: r, registro };
    if (opts.json) console.log(JSON.stringify(out));
    else log(`ok — ${opts.acao}; registro em ${registro}`);
  });
}

async function runWhatsapp(opts: {
  location: string; o: string; template?: string; json?: boolean;
}): Promise<void> {
  const log = opts.json ? console.error : console.log;
  await withClient(opts.location, log, async (client) => {
    let out: unknown;
    switch (opts.o) {
      case "configurado": out = await waIsConfigured(client, opts.location); break;
      case "numeros": out = await waPhoneNumbers(client, opts.location); break;
      case "templates": out = await waTemplates(client, opts.location, opts.template); break;
      case "aprovados": out = await waApproved(client, opts.location); break;
      case "flows": out = await waFlows(client, opts.location); break;
      default: throw new Error(`-o inválido: ${opts.o}. Aceitos: configurado, numeros, templates, aprovados, flows`);
    }
    if (opts.json) console.log(JSON.stringify(out));
    else console.log(JSON.stringify(out, null, 2));
  });
}

async function runWhatsappEnviar(opts: {
  location: string; id: string; template?: string; flow?: string; corpo?: string; cta?: string;
  cabecalho?: string; rodape?: string; de?: string; para?: string; conversa?: string;
  quando?: string; confirmo?: boolean; json?: boolean;
}): Promise<void> {
  const log = opts.json ? console.error : console.log;
  if (!opts.confirmo) throw new Error("WhatsApp sai para uma pessoa de verdade e não tem desfazer. Repita com --confirmo.");
  if (!opts.template && !opts.flow) throw new Error("use --template <id> ou --flow <id>");
  if (opts.template && opts.flow) throw new Error("--template e --flow são exclusivos");
  const quando = opts.quando ? Math.floor(new Date(opts.quando).getTime() / 1000) : undefined;
  if (opts.quando && Number.isNaN(quando)) throw new Error(`--quando inválido: ${opts.quando}`);

  await withClient(opts.location, log, async (client) => {
    const comum = {
      contactId: opts.id,
      ...(opts.conversa ? { conversationId: opts.conversa } : {}),
      ...(opts.de ? { fromNumberId: opts.de } : {}),
      ...(opts.para ? { toNumber: opts.para } : {}),
      ...(quando ? { scheduledTimestamp: quando } : {}),
    };
    let r: { conversationId?: string; messageId?: string };
    let registro: string;
    if (opts.template) {
      const achados = await waTemplates(client, opts.location, opts.template);
      const t = achados[0];
      if (!t) throw new Error(`template ${opts.template} não encontrado na subconta`);
      registro = registroEscrita(opts.location, "_mensagens", opts.id, { canal: "whatsapp-template", template: t.name, comum, enviado: false });
      r = await waSendTemplate(client, t, comum);
    } else {
      if (!opts.corpo || !opts.cta) throw new Error("--flow exige --corpo e --cta");
      const flow = { id: opts.flow!, header: opts.cabecalho, body: opts.corpo, footer: opts.rodape, cta: opts.cta };
      registro = registroEscrita(opts.location, "_mensagens", opts.id, { canal: "whatsapp-flow", flow, comum, enviado: false });
      r = await waSendFlow(client, flow, comum);
    }
    fs.writeFileSync(registro, JSON.stringify({ em: new Date().toISOString(), enviado: true, resposta: r }, null, 2));
    const out = { enviado: true, contactId: opts.id, conversationId: r.conversationId ?? null, messageId: r.messageId ?? null, registro };
    if (opts.json) console.log(JSON.stringify(out));
    else log(`ok — messageId ${out.messageId}; registro em ${registro}`);
  });
}

async function runConfig(opts: {
  location: string; o: string; conversa?: string; corpo?: string; confirmo?: boolean; json?: boolean;
}): Promise<void> {
  const log = opts.json ? console.error : console.log;
  const escritas = ["ia-gravar", "sla-gravar", "sla-zerar"];
  if (escritas.includes(opts.o) && !opts.confirmo) {
    throw new Error(`${opts.o} muda a configuração da subconta inteira e não tem desfazer. Repita com --confirmo.`);
  }
  const corpo = opts.corpo ? JSON.parse(opts.corpo) : undefined;
  await withClient(opts.location, log, async (client) => {
    let out: unknown;
    switch (opts.o) {
      case "ia": out = await fetchAiSettings(client, opts.location); break;
      case "sla": out = await fetchSlaSettings(client, opts.location); break;
      case "sla-status": out = await fetchSlaInboxStatus(client, opts.location); break;
      case "sla-permissao": out = await fetchSlaClearPermission(client, opts.location); break;
      case "ia-gravar":
        if (!corpo) throw new Error("ia-gravar exige --corpo <json>");
        registroEscrita(opts.location, "_config", "ia", { antes: await fetchAiSettings(client, opts.location), pedido: corpo });
        out = await updateAiSettings(client, opts.location, corpo);
        break;
      case "sla-gravar":
        if (!corpo) throw new Error("sla-gravar exige --corpo <json>");
        registroEscrita(opts.location, "_config", "sla", { antes: await fetchSlaSettings(client, opts.location), pedido: corpo });
        out = await updateSlaSettings(client, opts.location, corpo);
        break;
      case "sla-zerar":
        if (!opts.conversa) throw new Error("sla-zerar exige --conversa <id>");
        out = await clearSla(client, opts.conversa, corpo ?? {});
        break;
      default: throw new Error(`-o inválido: ${opts.o}`);
    }
    if (opts.json) console.log(JSON.stringify(out));
    else console.log(JSON.stringify(out, null, 2));
  });
}

async function runGrupo(opts: {
  location: string; o: string; corpo?: string; conversa?: string; usuario: string[];
  desde?: string; confirmo?: boolean; json?: boolean;
}): Promise<void> {
  const log = opts.json ? console.error : console.log;
  const saiParaFora = ["criar", "mensagem"];
  if (saiParaFora.includes(opts.o) && !opts.confirmo) {
    throw new Error(`${opts.o} fala com pessoas de verdade e não tem desfazer. Repita com --confirmo.`);
  }
  const corpo = opts.corpo ? JSON.parse(opts.corpo) : undefined;
  await withClient(opts.location, log, async (client) => {
    let out: unknown;
    switch (opts.o) {
      case "criar":
        if (!corpo) throw new Error("criar exige --corpo <json> (contrato não confirmado ao vivo)");
        registroEscrita(opts.location, "_grupos", "criar", { pedido: corpo });
        out = await createGroup(client, corpo);
        break;
      case "mensagem":
        if (!corpo) throw new Error("mensagem exige --corpo <json> com o payload de envio");
        registroEscrita(opts.location, "_grupos", "mensagem", { pedido: corpo });
        out = await sendGroupMessage(client, corpo);
        break;
      case "interno-checar":
        if (!corpo) throw new Error("interno-checar exige --corpo <json>");
        out = await checkInternalChat(client, corpo);
        break;
      case "interno-participantes":
        if (!opts.conversa) throw new Error("interno-participantes exige --conversa <id>");
        out = await updateInternalChatParticipants(client, {
          conversationId: opts.conversa, userIds: opts.usuario, locationId: opts.location,
          ...(opts.desde ? { startAfter: opts.desde } : {}),
        });
        break;
      default: throw new Error(`-o inválido: ${opts.o}`);
    }
    if (opts.json) console.log(JSON.stringify(out));
    else console.log(JSON.stringify(out, null, 2));
  });
}

async function runConversasAnexar(opts: {
  location: string; id: string; arquivo: string[]; conversa?: string; grupo?: boolean; v4?: boolean; json?: boolean;
}): Promise<void> {
  const log = opts.json ? console.error : console.log;
  if (!opts.arquivo.length) throw new Error("--arquivo é obrigatório (repetível)");
  const files = opts.arquivo.map((p) => {
    const abs = path.resolve(p);
    const st = fs.statSync(abs);
    if (!st.isFile()) throw new Error(`não é arquivo: ${abs}`);
    return {
      name: path.basename(abs),
      mimeType: MIME[path.extname(abs).toLowerCase()] ?? "application/octet-stream",
      buffer: fs.readFileSync(abs),
      caminho: abs,
      bytes: st.size,
    };
  });

  await withClient(opts.location, log, async (client) => {
    let conversationId = opts.conversa;
    if (!conversationId) {
      const convs = await searchConversations(client, opts.location, opts.id, 20);
      if (!convs.length) throw new Error(`contato ${opts.id} não tem conversa; use --conversa`);
      conversationId = convs[0].id;
    }

    const dir = path.join(DUMPS_DIR, "_anexos", opts.location, opts.id);
    fs.mkdirSync(dir, { recursive: true });
    const now = new Date();
    const registro = path.join(dir, `${stampNow(now)}${now.getSeconds().toString().padStart(2, "0")}.json`);
    const arquivos = files.map((f) => ({ caminho: f.caminho, nome: f.name, bytes: f.bytes, mimeType: f.mimeType }));
    fs.writeFileSync(registro, JSON.stringify({ subidoEm: now.toISOString(), conversationId, arquivos, subido: false }, null, 2));

    log(`Subindo ${files.length} arquivo(s) na conversa ${conversationId}...`);
    const r = await uploadAttachments(client, {
      conversationId,
      files: files.map((f) => ({ name: f.name, mimeType: f.mimeType, buffer: f.buffer })),
      isGroupSms: opts.grupo,
      v4: opts.v4,
    });
    fs.writeFileSync(registro, JSON.stringify({ subidoEm: now.toISOString(), conversationId, arquivos, subido: true, resposta: r }, null, 2));

    const out = { subido: true, conversationId, contactId: opts.id, urls: r.urls, uploadedFiles: r.uploadedFiles, mediaSids: r.mediaSids, registro };
    if (opts.json) console.log(JSON.stringify(out));
    else { log(`ok — ${r.urls.length} URL(s); registro em ${registro}`); r.urls.forEach((u) => log(u)); }
  });
}

async function runConversasEnviar(opts: {
  location: string; id: string; tipo: string; texto?: string; assunto?: string;
  de?: string; anexo: string[]; quando?: string; json?: boolean;
}): Promise<void> {
  const log = opts.json ? console.error : console.log;
  const tipo = SEND_TYPES.find((t) => t.toLowerCase() === opts.tipo.toLowerCase());
  if (!tipo) throw new Error(`--tipo inválido: ${opts.tipo}. Aceitos: ${SEND_TYPES.join(", ")}`);
  if (!opts.texto) throw new Error("--texto é obrigatório");
  if (tipo === "Email" && !opts.assunto) throw new Error("Email exige --assunto");

  const payload = {
    type: tipo as SendType,
    contactId: opts.id,
    message: opts.texto,
    ...(opts.assunto ? { subject: opts.assunto } : {}),
    ...(opts.de ? { emailFrom: opts.de } : {}),
    ...(opts.anexo.length ? { attachments: opts.anexo } : {}),
    ...(opts.quando ? { scheduledTimestamp: Math.floor(new Date(opts.quando).getTime() / 1000) } : {}),
  };
  if (opts.quando && Number.isNaN(new Date(opts.quando).getTime())) throw new Error(`--quando inválido: ${opts.quando}`);
  if (opts.quando && tipo === "InternalComment") throw new Error("InternalComment ignora agendamento: a nota sai na hora");

  await withClient(opts.location, log, async (client) => {
    // registro da ação: envio não tem desfazer, mas tem que ficar rastro
    const dir = path.join(DUMPS_DIR, "_mensagens", opts.location, opts.id);
    fs.mkdirSync(dir, { recursive: true });
    const now = new Date();
    const registro = path.join(dir, `${stampNow(now)}${now.getSeconds().toString().padStart(2, "0")}.json`);
    fs.writeFileSync(registro, JSON.stringify({ enviadoEm: now.toISOString(), payload, enviado: false }, null, 2));

    log(`Enviando ${tipo} para ${opts.id}...`);
    const r = await sendMessage(client, payload);
    fs.writeFileSync(registro, JSON.stringify({ enviadoEm: now.toISOString(), payload, enviado: true, resposta: r }, null, 2));

    const out = {
      enviado: true, tipo, contactId: opts.id,
      conversationId: r.conversationId ?? null, messageId: r.messageId ?? null,
      registro,
      interno: tipo === "InternalComment",
    };
    if (opts.json) console.log(JSON.stringify(out));
    else log(`ok — messageId ${out.messageId}; registro em ${registro}`);
  });
}

async function runConversasMarcar(opts: {
  location: string; id: string; acao: string; confirmo?: boolean; json?: boolean;
}): Promise<void> {
  const log = opts.json ? console.error : console.log;
  const acoes = ["lida", "nao-lida", "estrela", "sem-estrela", "apagar"];
  if (!acoes.includes(opts.acao)) throw new Error(`--acao inválida: ${opts.acao}. Aceitas: ${acoes.join(", ")}`);
  if (opts.acao === "apagar" && !opts.confirmo) {
    throw new Error("apagar remove a conversa INTEIRA e não tem desfazer; repita com --confirmo");
  }
  await withClient(opts.location, log, async (client) => {
    const convs = await searchConversations(client, opts.location, opts.id);
    if (!convs.length) throw new Error("contato sem conversa");
    const conv = convs[0];
    let r: unknown;
    if (opts.acao === "apagar") r = await deleteConversation(client, conv.id);
    else if (opts.acao === "lida") r = await updateConversation(client, opts.location, conv.id, { unreadCount: 0 });
    else if (opts.acao === "nao-lida") r = await updateConversation(client, opts.location, conv.id, { unreadCount: 1 });
    else r = await updateConversation(client, opts.location, conv.id, { starred: opts.acao === "estrela" });
    const out = { acao: opts.acao, conversationId: conv.id, ok: true, resposta: r };
    console.log(opts.json ? JSON.stringify(out) : `ok — ${opts.acao} em ${conv.id}`);
  });
}

async function runConversasRascunho(opts: {
  location: string; id: string; acao: string; texto?: string; canal: string;
  rascunho?: string; json?: boolean;
}): Promise<void> {
  const log = opts.json ? console.error : console.log;
  await withClient(opts.location, log, async (client) => {
    let out: unknown;
    if (opts.acao === "criar") {
      if (!opts.texto) throw new Error("criar exige --texto");
      out = { criado: await saveDraft(client, opts.location, opts.id, opts.texto, opts.canal) };
    } else if (opts.acao === "listar") {
      out = { rascunhos: await fetchDrafts(client, opts.location, opts.id) };
    } else if (opts.acao === "apagar") {
      if (!opts.rascunho) throw new Error("apagar exige --rascunho <id>");
      out = { apagado: await deleteDraft(client, opts.rascunho) };
    } else throw new Error(`--acao inválida: ${opts.acao}. Aceitas: criar, listar, apagar`);
    console.log(JSON.stringify(out, opts.json ? undefined : null, opts.json ? undefined : 2));
  });
}

async function runConversasMensagem(opts: {
  location: string; acao: string; id: string; email?: boolean; json?: boolean;
}): Promise<void> {
  const log = opts.json ? console.error : console.log;
  await withClient(opts.location, log, async (client) => {
    const r = opts.acao === "cancelar"
      ? await cancelScheduled(client, opts.id, opts.email)
      : opts.acao === "reenviar"
        ? await resend(client, opts.location, opts.id, opts.email)
        : (() => { throw new Error(`--acao inválida: ${opts.acao}. Aceitas: cancelar, reenviar`); })();
    console.log(JSON.stringify({ acao: opts.acao, id: opts.id, resposta: r }));
  });
}

async function runConversasBuscar(opts: {
  location: string; termo: string; max: string; json?: boolean;
}): Promise<void> {
  const log = opts.json ? console.error : console.log;
  await withClient(opts.location, log, async (client) => {
    const convs = await searchMessages(client, opts.location, opts.termo, Number(opts.max) || 20);
    const itens = convs.map((c: any) => ({
      conversationId: c.conversationId,
      contato: c.fullName ?? c.contactName ?? null,
      contactId: c.contactId ?? null,
      messageId: c.firstMatchedMessageId ?? c.matchedMessage?.id ?? null,
      tipo: c.matchedMessage?.type != null ? typeName(c.matchedMessage.type) : null,
      trecho: (c.matchedMessage?.body ?? "").slice(0, 200),
    }));
    if (opts.json) console.log(JSON.stringify({ termo: opts.termo, n: itens.length, resultados: itens }));
    else for (const i of itens) console.log(`${i.contato ?? i.contactId}  ${i.tipo ?? "?"}  ${i.trecho.replace(/\s+/g, " ")}`);
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
  .option("--tipo <TYPE_X>", "filtra por tipo (string da API pública, ex. TYPE_EMAIL)")
  .option("--busca <termo>", "só as mensagens desta conversa que casam com o termo")
  .option("--email <emailMessageId>", "e-mail completo (id vem de emailMessageId, não do id da mensagem)")
  .option("--transcricao <messageId>", "transcrição de uma chamada")
  .option("--json", "imprime o resultado em JSON no stdout")
  .action((o) => runConversas(o).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); }));

program
  .command("conversas-enviar")
  .description("ESCREVE: envia mensagem ao contato (InternalComment é nota interna, não sai)")
  .requiredOption("-l, --location <id>", "locationId da subconta")
  .requiredOption("-i, --id <id>", "id do contato")
  .requiredOption("--tipo <tipo>", `canal: ${SEND_TYPES.join(" | ")}`)
  .requiredOption("--texto <txt>", "corpo da mensagem")
  .option("--assunto <s>", "assunto (obrigatório em Email)")
  .option("--de <email>", "remetente (Email)")
  .option("--anexo <url>", "URL de anexo; repetível", (v: string, acc: string[]) => [...acc, v], [])
  .option("--quando <iso>", "agenda o envio (ISO); InternalComment não aceita")
  .option("--json", "imprime o resultado em JSON no stdout")
  .action((o) => runConversasEnviar(o).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); }));

program
  .command("whatsapp")
  .description("Leitura do WhatsApp da subconta: templates, flows, números, estado")
  .requiredOption("-l, --location <id>", "locationId da subconta")
  .requiredOption("-o <op>", "configurado | numeros | templates | aprovados | flows")
  .option("--template <id>", "um template só (com -o templates)")
  .option("--json", "imprime o resultado em JSON no stdout")
  .action((o) => runWhatsapp(o).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); }));

program
  .command("whatsapp-enviar")
  .description("ESCREVE: manda template aprovado ou flow interativo por WhatsApp")
  .requiredOption("-l, --location <id>", "locationId da subconta")
  .requiredOption("-i, --id <id>", "id do contato")
  .option("--template <id>", "id do template aprovado")
  .option("--flow <id>", "id do flow")
  .option("--corpo <txt>", "corpo (flow)")
  .option("--cta <txt>", "texto do botão (flow)")
  .option("--cabecalho <txt>", "cabeçalho (flow)")
  .option("--rodape <txt>", "rodapé (flow)")
  .option("--de <fromNumberId>", "número de origem")
  .option("--para <numero>", "número de destino")
  .option("--conversa <id>", "conversationId")
  .option("--quando <iso>", "agenda o envio (ISO)")
  .option("--confirmo", "obrigatório: a mensagem sai para o contato")
  .option("--json", "imprime o resultado em JSON no stdout")
  .action((o) => runWhatsappEnviar(o).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); }));

program
  .command("config")
  .description("Configuração de IA e SLA das conversas da subconta")
  .requiredOption("-l, --location <id>", "locationId da subconta")
  .requiredOption("-o <op>", "ia | sla | sla-status | sla-permissao | ia-gravar | sla-gravar | sla-zerar")
  .option("--corpo <json>", "corpo da escrita, em JSON")
  .option("--conversa <id>", "conversationId (sla-zerar)")
  .option("--confirmo", "obrigatório nas escritas")
  .option("--json", "imprime o resultado em JSON no stdout")
  .action((o) => runConfig(o).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); }));

program
  .command("grupo")
  .description("Group chat e chat interno entre usuários")
  .requiredOption("-l, --location <id>", "locationId da subconta")
  .requiredOption("-o <op>", "criar | mensagem | interno-checar | interno-participantes")
  .option("--corpo <json>", "payload cru, em JSON")
  .option("--conversa <id>", "conversationId")
  .option("--usuario <id>", "userId; repetível", (v: string, acc: string[]) => [...acc, v], [])
  .option("--desde <data>", "histórico visível: -1 tudo, 0 nada, YYYY-MM-DD a partir de")
  .option("--confirmo", "obrigatório em criar e mensagem")
  .option("--json", "imprime o resultado em JSON no stdout")
  .action((o) => runGrupo(o).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); }));

program
  .command("conversas-anexar")
  .description("Sobe arquivos como anexo da conversa e devolve as URLs (não envia nada ao contato)")
  .requiredOption("-l, --location <id>", "locationId da subconta")
  .requiredOption("-i, --id <id>", "id do contato")
  .option("--arquivo <path>", "caminho do arquivo; repetível", (v: string, acc: string[]) => [...acc, v], [])
  .option("--conversa <id>", "conversationId (default: a primeira do contato)")
  .option("--grupo", "anexo de group chat (isGroupSms)")
  .option("--v4", "manda o header version: v4")
  .option("--json", "imprime o resultado em JSON no stdout")
  .action((o) => runConversasAnexar(o).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); }));

program
  .command("conversas-marcar")
  .description("ESCREVE: lida/não lida, estrela, ou APAGA a conversa do contato")
  .requiredOption("-l, --location <id>", "locationId da subconta")
  .requiredOption("-i, --id <id>", "id do contato")
  .requiredOption("--acao <acao>", "lida | nao-lida | estrela | sem-estrela | apagar")
  .option("--confirmo", "obrigatório em apagar")
  .option("--json", "imprime o resultado em JSON no stdout")
  .action((o) => runConversasMarcar(o).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); }));

program
  .command("conversas-rascunho")
  .description("Rascunho de mensagem do contato: criar, listar, apagar")
  .requiredOption("-l, --location <id>", "locationId da subconta")
  .requiredOption("-i, --id <id>", "id do contato")
  .requiredOption("--acao <acao>", "criar | listar | apagar")
  .option("--texto <txt>", "corpo (criar)")
  .option("--canal <canal>", "sms | email", "sms")
  .option("--rascunho <id>", "id do rascunho (apagar)")
  .option("--json", "imprime o resultado em JSON no stdout")
  .action((o) => runConversasRascunho(o).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); }));

program
  .command("conversas-mensagem")
  .description("ESCREVE: cancela uma mensagem agendada ou reenvia uma que falhou")
  .requiredOption("-l, --location <id>", "locationId da subconta")
  .requiredOption("--acao <acao>", "cancelar | reenviar")
  .requiredOption("--id <messageId>", "id da mensagem (ou emailMessageId com --email)")
  .option("--email", "trata o id como e-mail")
  .option("--json", "imprime o resultado em JSON no stdout")
  .action((o) => runConversasMensagem(o).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); }));

program
  .command("conversas-buscar")
  .description("Busca texto nas mensagens de toda a subconta")
  .requiredOption("-l, --location <id>", "locationId da subconta")
  .requiredOption("--termo <txt>", "texto a procurar")
  .option("--max <n>", "máximo de conversas", "20")
  .option("--json", "imprime o resultado em JSON no stdout")
  .action((o) => runConversasBuscar(o).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); }));

program
  .command("contato-editar")
  .description("ESCREVE: altera campos/tags de um contato via API interna, com snapshot antes")
  .requiredOption("-l, --location <id>", "locationId da subconta")
  .requiredOption("-i, --id <id>", "id do contato")
  .option("--set <nome=valor>", "campo (nome, fieldKey ou id) = valor; repetível", (v: string, acc: string[]) => [...acc, v], [])
  .option("--tag <+nome|-nome>", "adiciona (+) ou remove (-) tag; repetível", (v: string, acc: string[]) => [...acc, v], [])
  .option("--json", "imprime o resultado em JSON no stdout")
  .action((o) => runContatoEditar(o).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); }));

program
  .command("oportunidades")
  .description("Leitura ao vivo de pipelines e oportunidades da subconta")
  .requiredOption("-l, --location <id>", "locationId da subconta")
  .option("-o, --o <op>", "pipelines | listar | buscar | ver", "pipelines")
  .option("-i, --id <id>", "id da oportunidade (com -o ver)")
  .option("--pipeline <id>", "filtra por pipeline")
  .option("--estagio <id>", "filtra por estágio")
  .option("--status <s>", "open | won | lost | abandoned | all")
  .option("--contato <id>", "filtra pelas oportunidades de um contato")
  .option("--termo <texto>", "termo de busca (com -o buscar)")
  .option("--limite <n>", "quantos cards trazer")
  .option("--json", "imprime o resultado em JSON no stdout")
  .action((o) => runOportunidades(o).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); }));

program
  .command("oportunidade-acao")
  .description("ESCREVE: cria, edita, move, apaga ou restaura uma oportunidade")
  .requiredOption("-l, --location <id>", "locationId da subconta")
  .requiredOption("--acao <a>", "criar | editar | mover | status | apagar | restaurar")
  .option("-i, --id <id>", "id da oportunidade (tudo menos criar)")
  .option("--pipeline <id>", "pipeline do card")
  .option("--estagio <id>", "estágio do card")
  .option("--nome <texto>", "nome do card")
  .option("--valor <n>", "valor monetário")
  .option("--status <s>", "open | won | lost | abandoned")
  .option("--contato <id>", "só na criação; o vínculo não se troca depois")
  .option("--dono <id>", "usuário responsável")
  .option("--confirmo", "obrigatório: muda dado real e não tem desfazer")
  .option("--json", "imprime o resultado em JSON no stdout")
  .action((o) => runOportunidadeAcao(o).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); }));

program
  .command("pipeline")
  .description("ESCREVE: cria, edita ou apaga um pipeline e seus estágios")
  .requiredOption("-l, --location <id>", "locationId da subconta")
  .requiredOption("--acao <a>", "criar | editar | apagar")
  .option("-i, --id <id>", "id do pipeline (editar e apagar)")
  .option("--nome <texto>", "nome do pipeline")
  .option("--estagios <json>", 'lista COMPLETA dos estágios: [{"id":"...","name":"..."}]')
  .option("--apagar-com-cards", "libera remover estágio que tem card dentro; os cards somem junto")
  .option("--confirmo", "obrigatório: muda a estrutura do funil e não tem desfazer")
  .option("--json", "imprime o resultado em JSON no stdout")
  .action((o) => runPipeline(o).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); }));

program.parseAsync(process.argv);
