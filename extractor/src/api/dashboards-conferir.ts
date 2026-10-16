import type { GhlClient } from "./client.js";
import { dadosWidget, type WidgetPainel, type Painel } from "./dashboards.js";
import { listOpportunities } from "./opportunities.js";
import { listCalendars } from "./calendars.js";
import { insightsMeta, tokenMeta } from "./meta-ads.js";

/**
 * Conferência: o número que o painel mostra (POST de dados) contra uma recontagem feita aqui pelas
 * rotas de leitura. Tudo é filtrado no lado do automaster; ver docs/endpoints.md, seção `## Dashboards`.
 */
export interface Periodo { inicio: number; fim: number }
export interface Medida { total: number; grupos?: { id: string; value: number }[] }
export interface Cond { campo: string; valores: string[] }
export type CampoData = "date_added" | "updated_at" | "last_status_change_at";
export interface Filtro {
  campoData: CampoData; inicio: number; fim: number; fuso: string;
  grupos: Cond[][]; agrupar: string | null; soma: boolean;
}
export interface Divergencia { id: string; ghl: number; recontagem: number }
export type Resultado = "bate" | "diverge" | "sem_conferencia";
export interface Item {
  widgetId: string; titulo: string | null; modulo: string | null; resultado: Resultado;
  ghl: Medida | null; recontagem: Medida | null; motivo?: string; filtro: Filtro | null;
  divergencias?: Divergencia[];
  /** Quem fornece a recontagem; `independente: false` = o GHL conferido contra ele mesmo. */
  fonte?: "ghl" | "meta"; independente?: boolean; resumo?: string;
}

const CAL = "https://services.leadconnectorhq.com";
const TOLERANCIA = 0.01;

/** `data` é lista nos gráficos e um objeto `{label, value}` (sem `total`) nos cartões numéricos. */
interface Metrica { data?: { id?: string; label?: string; value: number }[] | { value: number }; total?: number }

function normalizar(raw: unknown): Medida {
  const m = ((raw as Metrica[] | null) ?? [])[0] ?? {};
  if (m.data && !Array.isArray(m.data)) return { total: Number(m.data.value) };
  const grupos = (m.data ?? []).map((g) => ({ id: String(g.id ?? g.label), value: Number(g.value) }));
  return grupos.length ? { total: Number(m.total ?? 0), grupos } : { total: Number(m.total ?? 0) };
}

export function comparar(ghlCru: unknown, recontagem: Medida): {
  resultado: "bate" | "diverge"; ghl: Medida; recontagem: Medida; divergencias: Divergencia[];
} {
  const ghl = normalizar(ghlCru);
  const a = new Map((ghl.grupos ?? []).map((g) => [g.id, g.value]));
  const b = new Map((recontagem.grupos ?? []).map((g) => [g.id, g.value]));
  const divergencias: Divergencia[] = [];
  for (const id of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(id) ?? 0, y = b.get(id) ?? 0;
    if (!(Math.abs(x - y) < TOLERANCIA)) divergencias.push({ id, ghl: x, recontagem: y });
  }
  const bate = Math.abs(ghl.total - recontagem.total) < TOLERANCIA && divergencias.length === 0;
  return { resultado: bate ? "bate" : "diverge", ghl, recontagem, divergencias };
}

// ---------- options do widget -> filtro ----------

const DATAS: Record<string, CampoData> = {
  date_added: "date_added", dateAdded: "date_added",
  createdAt: "date_added", dateCreated: "date_added",
  date_updated: "updated_at", updated_at: "updated_at",
  last_status_change_date: "last_status_change_at", last_status_change_at: "last_status_change_at",
};
const CAMPOS = ["status", "pipeline_id", "assigned_to", "appointmentStatus", "direction", "callStatus", "adAccountId"];
const AGRUPAR = ["status", "pipeline_id", "assigned_to", "source", "appointmentStatus", "callStatus"];
// métricas do Graph (anúncios): a soma delas não é valor monetário de oportunidade
const METRICAS_META = ["spend", "clicks", "impressions", "conversions"];

type No = { group?: string; filters?: No[]; field?: string; operator?: string; value?: unknown };

/** Alternativas (OR de ANDs) de um nó; lança com o motivo quando algo não é reproduzível. */
function alternativas(no: No): Cond[][] {
  const cond = (c: No): Cond => {
    if (!CAMPOS.includes(c.field ?? "")) throw new Error(`campo de condição sem recontagem: ${c.field} (${c.operator})`);
    if (c.operator !== "eq" && c.operator !== "in") throw new Error(`operador sem recontagem: ${c.operator} em ${c.field}`);
    return { campo: c.field!, valores: (Array.isArray(c.value) ? c.value : [c.value]).map(String) };
  };
  const ands = (n: No): Cond[] => (n.filters ?? []).filter((c) => c.operator !== "time_series").flatMap((c) => (c.group ? ands(c) : [cond(c)]));
  if (no.group === "OR") {
    return (no.filters ?? []).map((c) => (c.group ? ands(c) : [cond(c)])).filter((a) => a.length);
  }
  const a = ands(no);
  return a.length ? [a] : [];
}

function achaPeriodo(no: No): number[] | null {
  for (const c of no.filters ?? []) {
    if (c.operator === "time_series" && Array.isArray(c.value)) return c.value as number[];
    const r = c.group ? achaPeriodo(c) : null;
    if (r) return r;
  }
  return null;
}

export function filtroDoWidget(
  widget: { options: unknown; module?: string | null }, fuso: string, dateRange: Periodo,
): { ok: true; filtro: Filtro } | { ok: false; motivo: string } {
  const o = (widget.options ?? {}) as {
    aggregations?: { operator: string; field: string }[]; dateProperty?: string; dateRangeOverride?: { operator?: string };
    filters?: No[]; groupBy?: { fields?: (string | { field: string })[]; groupFieldType?: string };
  };
  // A tela aplica ao widget o período do painel (dashboard_date_range) ou, com till_date, tudo até hoje
  // (provado ao vivo: sem time_series e com [0, agora] o GHL devolve o mesmo número). Os outros períodos fixos não são reproduzidos.
  const override = o.dateRangeOverride?.operator ?? "dashboard_date_range";
  try {
    const campoData = DATAS[o.dateProperty ?? "date_added"];
    if (!campoData) throw new Error(`campo de data sem recontagem: ${o.dateProperty}`);
    let soma = false;
    for (const ag of o.aggregations ?? []) {
      if (ag.operator === "sum" && /^monetary_?value$/i.test(ag.field)) soma = true;
      else if (ag.operator === "sum" && METRICAS_META.includes(ag.field)) continue;
      else if (ag.operator !== "count") throw new Error(`agregação sem recontagem: ${ag.operator} em ${ag.field}`);
    }
    let grupos: Cond[][] = [];
    let periodo: number[] | null = null;
    for (const g of o.filters ?? []) {
      periodo ??= achaPeriodo(g);
      const alt = alternativas(g);
      if (!alt.length) continue;
      grupos = grupos.length ? grupos.flatMap((x) => alt.map((y) => [...x, ...y])) : alt;
    }
    let agrupar: string | null = null;
    const f0 = o.groupBy?.fields?.[0];
    if (f0) {
      const nome = (typeof f0 === "string" ? f0 : f0.field).replace("appoinmentStatus", "appointmentStatus").replace(/\.keyword$/, "");
      if (o.groupBy?.groupFieldType === "time_series" || !AGRUPAR.includes(nome)) throw new Error(`agrupamento sem recontagem: ${nome}`);
      agrupar = nome;
    }
    if (!periodo && override !== "dashboard_date_range" && override !== "till_date") {
      throw new Error(`período próprio do widget sem recontagem: dateRangeOverride ${override}`);
    }
    const inicio = periodo?.[0] ?? (override === "till_date" ? 0 : dateRange.inicio);
    return { ok: true, filtro: { campoData, inicio, fim: periodo?.[1] ?? dateRange.fim, fuso, grupos, agrupar, soma } };
  } catch (e) {
    return { ok: false, motivo: (e as Error).message };
  }
}

// ---------- recontagens ----------

const casa = (grupos: Cond[][], valor: (campo: string) => unknown) =>
  grupos.length === 0 || grupos.some((a) => a.every((c) => c.valores.includes(String(valor(c.campo)))));

function medir<T>(itens: T[], f: Filtro, valor: (x: T) => number, chave: (x: T, campo: string) => unknown): Medida {
  const soma = (xs: T[]) => xs.reduce((s, x) => s + valor(x), 0);
  if (!f.agrupar) return { total: soma(itens) };
  const por = new Map<string, T[]>();
  for (const x of itens) {
    // grupo sem valor: o GHL o rotula "N/A" + espaço de largura zero (U+200B) no id
    const v = chave(x, f.agrupar);
    const k = v === undefined || v === null || v === "" ? "N/A\u200b" : String(v);
    por.set(k, [...(por.get(k) ?? []), x]);
  }
  return { total: soma(itens), grupos: [...por].map(([id, xs]) => ({ id, value: soma(xs) })) };
}

interface Card {
  status?: string; pipelineId?: string; assignedTo?: string; source?: string; monetaryValue?: number;
  createdAt?: string; updatedAt?: string; lastStatusChangeAt?: string;
}
const DATA_CARD: Record<CampoData, keyof Card> = { date_added: "createdAt", updated_at: "updatedAt", last_status_change_at: "lastStatusChangeAt" };
const CAMPO_CARD: Record<string, keyof Card> = { status: "status", pipeline_id: "pipelineId", assigned_to: "assignedTo", source: "source" };

// Um painel tem vários widgets de oportunidade: pagina uma vez por cliente e janela (o processo da CLI é curto).
// A rota filtra `date`/`endDate` só pela CRIAÇÃO; a janela vai com 1 dia de folga e o filtro exato é feito aqui.
const cartoes = new WeakMap<object, Map<string, Promise<Card[]>>>();
async function todosOsCards(client: GhlClient, loc: string, janela: { date?: number; endDate?: number }): Promise<Card[]> {
  const cards: Card[] = [];
  for (let page = 1; page <= 500; page++) {
    const r = (await listOpportunities(client, loc, { page, limit: 100, ...janela })) as { opportunities?: Card[]; meta?: { nextPage?: number | null } };
    cards.push(...(r.opportunities ?? []));
    if (!r.meta?.nextPage) break;
  }
  return cards;
}

export async function recontarOportunidades(client: GhlClient, loc: string, f: Filtro): Promise<Medida> {
  const janela = f.campoData === "date_added" && f.inicio > 0 ? { date: f.inicio - 86_400_000, endDate: f.fim + 86_400_000 } : {};
  const porJanela = cartoes.get(client) ?? new Map<string, Promise<Card[]>>();
  cartoes.set(client, porJanela);
  const chave = JSON.stringify(janela);
  if (!porJanela.has(chave)) porJanela.set(chave, todosOsCards(client, loc, janela));
  const cards = await porJanela.get(chave)!;
  const dentro = cards.filter((c) => {
    const t = Date.parse(String(c[DATA_CARD[f.campoData]] ?? ""));
    return t >= f.inicio && t <= f.fim && casa(f.grupos, (campo) => c[CAMPO_CARD[campo]]);
  });
  return medir(dentro, f, (c) => (f.soma ? Number(c.monetaryValue ?? 0) : 1), (c, campo) => c[CAMPO_CARD[campo]]);
}

export async function recontarAgenda(client: GhlClient, loc: string, f: Filtro): Promise<Medida> {
  const cals = ((await listCalendars(client, loc)) as { calendars?: { id: string }[] }).calendars ?? [];
  const eventos: { appointmentStatus?: string; dateAdded?: string }[] = [];
  for (const c of cals) {
    // A rota filtra por startTime e o widget por criação: busca até 1 ano à frente e recorta por dateAdded aqui.
    // listEvents recusa ISO com milissegundos; mesma rota, montada aqui.
    const q = new URLSearchParams({ locationId: loc, startTime: String(f.inicio), endTime: String(f.fim + 365 * 86_400_000), calendarId: c.id });
    const r = await client.getJson<{ events?: { appointmentStatus?: string; dateAdded?: string }[] }>(`${CAL}/calendars/events?${q}`);
    eventos.push(...(r.events ?? []));
  }
  const dentro = eventos.filter((e) => Date.parse(e.dateAdded ?? "") >= f.inicio && Date.parse(e.dateAdded ?? "") <= f.fim && casa(f.grupos, () => e.appointmentStatus));
  return medir(dentro, f, () => 1, (e) => e.appointmentStatus);
}

/** Só `assigned_to` (um valor, uma alternativa) chega às rotas de busca de contatos e conversas. */
function atribuido(f: Filtro, rota: string): string | null {
  if (f.agrupar) throw new Error(`agrupamento sem recontagem em ${rota}: ${f.agrupar}`);
  const conds = f.grupos.flat();
  for (const c of conds) if (c.campo !== "assigned_to") throw new Error(`condição sem recontagem em ${rota}: ${c.campo}`);
  if (f.grupos.length > 1 || conds.length > 1 || (conds[0] && conds[0].valores.length !== 1)) {
    throw new Error(`assigned_to com várias alternativas sem recontagem em ${rota}`);
  }
  return conds[0]?.valores[0] ?? null;
}

/** POST /contacts/search: o `total` da resposta é o do filtro inteiro, uma página basta. */
export async function recontarContatos(client: GhlClient, loc: string, f: Filtro): Promise<Medida> {
  if (f.campoData === "last_status_change_at") throw new Error("campo de data sem recontagem em contatos: last_status_change_at");
  const dono = atribuido(f, "contatos");
  const filters: unknown[] = [{ field: f.campoData === "date_added" ? "date_added" : "date_updated", operator: "range", value: { gte: f.inicio, lte: f.fim } }];
  if (dono) filters.push({ field: "assigned_to", operator: "eq", value: dono });
  const r = await client.postJson<{ total?: number }>(`${CAL}/contacts/search`, { locationId: loc, pageLimit: 1, page: 1, filters });
  return { total: Number(r.total ?? 0) };
}

/** GET /conversations/search: startDate/endDate filtram a criação da conversa; o total vem na resposta. */
export async function recontarConversas(client: GhlClient, loc: string, f: Filtro): Promise<Medida> {
  if (f.campoData !== "date_added") throw new Error(`a busca de conversas só filtra criação, não ${f.campoData} (date_updated)`);
  const dono = atribuido(f, "conversas");
  const q = new URLSearchParams({ locationId: loc, limit: "1", startDate: String(f.inicio), endDate: String(f.fim) });
  if (dono) q.set("assignedTo", dono);
  const r = await client.getJson<{ total?: number }>(`${CAL}/conversations/search?${q}`);
  return { total: Number(r.total ?? 0) };
}

/**
 * POST backend/reporting/calls/get-call-status-summary: contagem por status da chamada. As datas vão em ISO
 * (ms dá 422). O relatório é do próprio GHL, então esta conferência é o GHL contra o GHL.
 */
// O relatório devolve o rótulo de exibição; o widget agrupa pelo valor cru (medido ao vivo na Xb9g).
// Rótulo fora da tabela é normalizado (minúsculas, espaço→hífen) para não divergir à toa; o "N/A" do grupo vazio fica.
const ROTULO_STATUS: Record<string, string> = { Answered: "completed", Missed: "no-answer", "No answer": "no-answer", Busy: "busy" };
const statusCru = (r: string) => ROTULO_STATUS[r] ?? (r.startsWith("N/A") ? r : r.trim().toLowerCase().replace(/\s+/g, "-"));
export async function recontarLigacoes(client: GhlClient, loc: string, f: Filtro): Promise<Medida> {
  if (f.grupos.length > 1) throw new Error("ligações com várias alternativas (OR) sem recontagem");
  const conds = f.grupos[0] ?? [];
  const valor = (campo: string) => {
    const v = conds.find((c) => c.campo === campo)?.valores;
    if (v && v.length !== 1 && campo === "direction") throw new Error("direction com mais de um valor sem recontagem");
    return v;
  };
  const direction = valor("direction")?.[0];
  const status = valor("callStatus");
  const r = await client.postJson<{ callStatusStats?: Record<string, { count?: number }> }>(
    `https://backend.leadconnectorhq.com/reporting/calls/get-call-status-summary?locationId=${loc}`,
    { locationId: loc, startDate: new Date(f.inicio).toISOString(), endDate: new Date(f.fim).toISOString(), ...(direction ? { direction } : {}) },
  );
  const por = new Map<string, number>();
  for (const [id, v] of Object.entries(r.callStatusStats ?? {})) por.set(statusCru(id), (por.get(statusCru(id)) ?? 0) + Number(v.count ?? 0));
  const grupos = [...por].map(([id, value]) => ({ id, value })).filter((g) => !status || status.includes(g.id));
  const total = grupos.reduce((s, g) => s + g.value, 0);
  return f.agrupar === "callStatus" ? { total, grupos } : { total };
}

/** BLOQUEADO: nenhum bundle do app (reportingApp, lcEmailApp, emailMarketingApp) traz rota de relatório de e-mail da subconta. */
export function recontarEmails(_client: GhlClient, _loc: string, _f: Filtro): Promise<Medida> {
  return Promise.reject(new Error("rota do relatório de e-mail não encontrada (docs/endpoints.md, seção Dashboards)"));
}

/** Anúncios do Meta: Graph API com o token de AUTOMASTER_META_TOKEN. Conta e métrica saem das options do widget. */
export async function recontarMetaAds(
  widget: { options: unknown }, f: Filtro,
  deps: { env?: Record<string, string | undefined>; fetch?: typeof fetch } = {},
): Promise<{ ok: true; medida: Medida } | { ok: false; motivo: string }> {
  const o = (widget.options ?? {}) as { aggregations?: { operator: string; field: string }[]; filters?: No[]; groupBy?: { groupFieldType?: string } };
  const token = tokenMeta(deps.env);
  if (!token) return { ok: false, motivo: "defina AUTOMASTER_META_TOKEN para conferir anúncios do Meta" };
  const achaConta = (n: No): unknown => {
    for (const c of n.filters ?? []) {
      const v = c.group ? achaConta(c) : c.field === "adAccountId" ? c.value : undefined;
      if (v !== undefined) return v;
    }
    return undefined;
  };
  const conta = [o.filters?.map(achaConta).find((v) => v !== undefined)].flat()[0];
  if (!conta) return { ok: false, motivo: "widget sem conta de anúncio (adAccountId) escolhida" };
  const ag = o.aggregations?.[0];
  const metrica = ag?.operator === "sum" ? ({ spend: "spend", clicks: "clicks", impressions: "impressions", conversions: "leads" } as const)[ag.field as "spend"] : undefined;
  if (!metrica) return { ok: false, motivo: `agregação sem equivalente no Graph: ${ag?.operator} em ${ag?.field}` };
  const porDia = o.groupBy?.groupFieldType === "time_series";
  const r = await insightsMeta({ conta: String(conta), token, inicio: f.inicio, fim: f.fim, fuso: f.fuso, porDia }, deps.fetch);
  if (!r.ok) return r;
  const total = r.linhas.reduce((s, l) => s + l[metrica], 0);
  if (!porDia) return { ok: true, medida: { total } };
  const por = new Map<string, number>();
  for (const l of r.linhas) por.set(l.dia ?? "", (por.get(l.dia ?? "") ?? 0) + l[metrica]);
  return { ok: true, medida: { total, grupos: [...por].map(([id, value]) => ({ id, value })) } };
}

// ---------- despachante ----------

/** As options salvas não valem como corpo: o app materializa período, fuso e groupBy antes de pedir os números. */
function materializar(options: unknown, f: Filtro): unknown {
  const o = structuredClone(options) as Record<string, any>;
  const semPeriodo = (n: No): No => ({ ...n, filters: (n.filters ?? []).filter((c) => c.operator !== "time_series").map((c) => (c.group ? semPeriodo(c) : c)) });
  if (o.groupBy?.fields) o.groupBy.fields = o.groupBy.fields.map((x: unknown) => (typeof x === "string" ? { field: x, type: "field" } : x));
  o.filters = [{ group: "AND", filters: [
    { field: o.dateProperty ?? "date_added", operator: "time_series", value: [f.inicio, f.fim] },
    ...((o.filters ?? []) as No[]).map(semPeriodo),
  ] }];
  o.timezone = f.fuso;
  return o;
}

export async function conferirWidget(
  client: GhlClient, loc: string, widget: WidgetPainel, fuso: string, dateRange: Periodo,
  deps: { env?: Record<string, string | undefined>; fetch?: typeof fetch } = {},
): Promise<Item> {
  const base = { widgetId: widget.widgetId, titulo: widget.titulo, modulo: widget.module };
  const sem = (motivo: string, filtro: Filtro | null = null): Item => ({ ...base, resultado: "sem_conferencia", ghl: null, recontagem: null, motivo, filtro });
  if (!widget.apiConfig) return sem("widget sem apiConfig (custom): não há número para conferir");
  const recontar = widget.module === "crm-opportunities" ? recontarOportunidades
    : widget.module === "automation-appointments" ? recontarAgenda
    : widget.module === "crm-contacts" ? recontarContatos
    : widget.module === "crm-conversations" ? recontarConversas
    : widget.module === "revex-calls" ? recontarLigacoes
    : widget.module === "automation-admanager-fb-ads" ? async (_c: GhlClient, _l: string, f: Filtro) => {
      const r = await recontarMetaAds(widget, f, deps);
      if (!r.ok) throw new Error(r.motivo);
      return r.medida;
    } : null;
  if (widget.module === "crm-emails") return sem("rota do relatório de e-mail não encontrada (docs/endpoints.md, seção Dashboards)");
  if (!recontar) return sem("fonte entra numa etapa seguinte");
  const extra: Partial<Item> = widget.module === "revex-calls"
    ? { fonte: "ghl", independente: false, resumo: "Conferência GHL contra GHL: o relatório de ligações é do próprio GHL, não uma fonte independente." }
    : widget.module === "automation-admanager-fb-ads" ? { fonte: "meta", independente: true } : {};
  const fr = filtroDoWidget(widget, fuso, dateRange);
  if (!fr.ok) return sem(fr.motivo);
  let medida: Medida;
  try { medida = await recontar(client, loc, fr.filtro); } catch (e) { return sem((e as Error).message, fr.filtro); }
  const cru = await dadosWidget(client, loc, {
    chartType: widget.chartType ?? "", apiConfig: widget.apiConfig, options: materializar(widget.options, fr.filtro),
  });
  const c = comparar(cru, medida);
  return { ...base, resultado: c.resultado, ghl: c.ghl, recontagem: c.recontagem, filtro: fr.filtro, divergencias: c.divergencias, ...extra };
}

export async function conferirPainel(
  client: GhlClient, loc: string, painel: Painel, fuso: string, dateRange: Periodo,
  deps: { env?: Record<string, string | undefined>; fetch?: typeof fetch } = {},
): Promise<{ itens: Item[]; resumo: Record<Resultado, number> }> {
  const itens: Item[] = [];
  for (const w of painel.widgets) itens.push(await conferirWidget(client, loc, w, fuso, dateRange, deps));
  const resumo = { bate: 0, diverge: 0, sem_conferencia: 0 };
  for (const i of itens) resumo[i.resultado]++;
  return { itens, resumo };
}
