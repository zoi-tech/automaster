import type { GhlClient } from "./client.js";
import { dadosWidget, type WidgetPainel, type Painel } from "./dashboards.js";
import { listOpportunities } from "./opportunities.js";
import { listCalendars } from "./calendars.js";

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
  date_updated: "updated_at", updated_at: "updated_at",
  last_status_change_date: "last_status_change_at", last_status_change_at: "last_status_change_at",
};
const CAMPOS = ["status", "pipeline_id", "assigned_to", "appointmentStatus"];
const AGRUPAR = ["status", "pipeline_id", "assigned_to", "source", "appointmentStatus"];

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
    aggregations?: { operator: string; field: string }[]; dateProperty?: string;
    filters?: No[]; groupBy?: { fields?: (string | { field: string })[]; groupFieldType?: string };
  };
  try {
    const campoData = DATAS[o.dateProperty ?? "date_added"];
    if (!campoData) throw new Error(`campo de data sem recontagem: ${o.dateProperty}`);
    let soma = false;
    for (const ag of o.aggregations ?? []) {
      if (ag.operator === "sum" && /^monetary_?value$/i.test(ag.field)) soma = true;
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
    return { ok: true, filtro: { campoData, inicio: periodo?.[0] ?? dateRange.inicio, fim: periodo?.[1] ?? dateRange.fim, fuso, grupos, agrupar, soma } };
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
  const janela = f.campoData === "date_added" ? { date: f.inicio - 86_400_000, endDate: f.fim + 86_400_000 } : {};
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
): Promise<Item> {
  const base = { widgetId: widget.widgetId, titulo: widget.titulo, modulo: widget.module };
  const sem = (motivo: string, filtro: Filtro | null = null): Item => ({ ...base, resultado: "sem_conferencia", ghl: null, recontagem: null, motivo, filtro });
  if (!widget.apiConfig) return sem("widget sem apiConfig (custom): não há número para conferir");
  const recontar = widget.module === "crm-opportunities" ? recontarOportunidades
    : widget.module === "automation-appointments" ? recontarAgenda : null;
  if (!recontar) return sem("fonte entra numa etapa seguinte");
  const fr = filtroDoWidget(widget, fuso, dateRange);
  if (!fr.ok) return sem(fr.motivo);
  const cru = await dadosWidget(client, loc, {
    chartType: widget.chartType ?? "", apiConfig: widget.apiConfig, options: materializar(widget.options, fr.filtro),
  });
  const c = comparar(cru, await recontar(client, loc, fr.filtro));
  return { ...base, resultado: c.resultado, ghl: c.ghl, recontagem: c.recontagem, filtro: fr.filtro, divergencias: c.divergencias };
}

export async function conferirPainel(
  client: GhlClient, loc: string, painel: Painel, fuso: string, dateRange: Periodo,
): Promise<{ itens: Item[]; resumo: Record<Resultado, number> }> {
  const itens: Item[] = [];
  for (const w of painel.widgets) itens.push(await conferirWidget(client, loc, w, fuso, dateRange));
  const resumo = { bate: 0, diverge: 0, sem_conferencia: 0 };
  for (const i of itens) resumo[i.resultado]++;
  return { itens, resumo };
}
