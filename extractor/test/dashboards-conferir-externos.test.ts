/**
 * Etapa 7 do plano de dashboards: conferência de e-mail, ligações e anúncios do Meta.
 *
 * Contrato que o implementador deve cumprir (somado ao de dashboards-conferir.test.ts).
 * `client` é o GhlClient (só getJson/postJson). Módulos reais do catálogo da Xb9g:
 * `crm-emails`, `revex-calls`, `automation-admanager-fb-ads`.
 *
 * src/api/dashboards-conferir.ts
 *   Item ganha: `fonte?: "ghl" | "meta"`, `independente?: boolean`, `resumo?: string`.
 *     E-mail e ligações: fonte "ghl", independente false, resumo dizendo que a conferência é
 *     "GHL contra GHL" (a rota de recontagem é do próprio GHL, não uma fonte independente).
 *     Meta: fonte "meta", independente true.
 *
 *   recontarLigacoes(client, loc, filtro): Promise<Medida>
 *     ROTA DESCOBERTA no bundle do reportingApp (build 306) e provada ao vivo na Xb9g:
 *       POST https://backend.leadconnectorhq.com/reporting/calls/get-call-status-summary?locationId=<loc>
 *       corpo { locationId, startDate, endDate }  -- ISO 8601 (new Date(ms).toISOString()); ms dá 422;
 *                                                    "direction": "inbound"|"outbound" filtra a direção
 *       resposta { callStatusStats: { <callStatus>: { count, change } }, callDurationSummary: {...} }
 *     total = soma dos `count`; `grupos` (id = callStatus) só quando filtro.agrupar == "callStatus".
 *     Condição `direction` (eq/in com um valor) do widget vira o campo `direction` do corpo.
 *
 *   E-mail (crm-emails): FORA desta entrega. A rota do relatório de e-mail não existe nos bundles
 *     (reportingApp, lcEmailApp, emailMarketingApp; ~170 caminhos sob /reporting/emails/ deram 404).
 *     conferirWidget devolve sem_conferencia com motivo contendo "e-mail" e "rota" ("rota do relatório
 *     de e-mail não encontrada"), sem chamar rota de relatório e sem fonte "ghl" falsa. Pendência.
 *
 *   recontarMetaAds(widget: { options }, filtro, deps?: { env?: Record<string,string|undefined>; fetch?: typeof fetch })
 *     : Promise<{ ok: true; medida: Medida } | { ok: false; motivo: string }>
 *     conta = filtro `adAccountId` (eq/in) de widget.options ("act_123" ou "123"), token = tokenMeta(deps.env).
 *     Sem token: { ok:false, motivo contendo "defina AUTOMASTER_META_TOKEN" }.
 *     Conta sem acesso: motivo "token sem acesso à conta act_...".
 *     Métrica pela agregação: sum spend -> spend (reais); sum clicks -> clicks; sum impressions ->
 *     impressions; sum conversions -> leads (actions do tipo "lead"). Outra (avg cpc, reach...) ->
 *     ok:false com motivo citando o campo. time_increment=1 quando groupBy é time_series
 *     (grupos com id = dia "AAAA-MM-DD").
 *
 *   conferirWidget(client, loc, widget, fuso, dateRange, deps?) e conferirPainel(..., deps?)  (6º parâmetro opcional, repassado)
 *     crm-emails -> recontarEmails; revex-calls -> recontarLigacoes; automation-admanager-fb-ads ->
 *     recontarMetaAds (período = o do painel, na falta de time_series nas options).
 *     Sem token Meta -> sem_conferencia (nunca bate) com o motivo.
 *     filtroDoWidget passa a aceitar: campos direction e callStatus (revex-calls), status (crm-emails),
 *     dateProperty createdAt (e-mail) e dateCreated (Meta) -> date_added; groupBy callStatus.
 *
 * Token só de AUTOMASTER_META_TOKEN, nunca gravado em disco (ver meta-ads.test.ts).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filtroDoWidget, recontarLigacoes, recontarMetaAds, conferirWidget, conferirPainel,
} from "../src/api/dashboards-conferir.js";

const SP = "America/Sao_Paulo";
const DIA = { inicio: Date.parse("2026-10-15T00:00:00-03:00"), fim: Date.parse("2026-10-15T23:59:59.999-03:00") };
const ISO_INI = "2026-10-15T03:00:00.000Z";
const ISO_FIM = "2026-10-16T02:59:59.999Z";
const R = "https://backend.leadconnectorhq.com/reporting";
const TOKEN = "TOKEN-DE-TESTE-NAO-REAL";

interface Chamada { metodo: string; url: string; corpo?: any }
function clienteRota(rota: (metodo: string, url: string, corpo?: any) => unknown) {
  const chamadas: Chamada[] = [];
  const reg = (metodo: string) => (url: string, corpo?: unknown) => {
    chamadas.push({ metodo, url, corpo });
    return Promise.resolve(rota(metodo, url, corpo));
  };
  return { chamadas, client: { getJson: reg("get"), postJson: reg("post") } as never };
}
function fetchFalso(corpo: unknown, status = 200) {
  const urls: string[] = [];
  const fn = (async (url: unknown) => {
    urls.push(String(url));
    return { ok: status < 400, status, json: async () => corpo, text: async () => JSON.stringify(corpo) };
  }) as unknown as typeof fetch;
  return { urls, fn };
}
const filtro = (extra: Record<string, unknown> = {}) => ({
  campoData: "date_added", inicio: DIA.inicio, fim: DIA.fim, fuso: SP, grupos: [], agrupar: null, soma: false, ...extra,
}) as never;

// ---------- filtroDoWidget: os módulos novos ----------

const cond = (field: string, operator: string, value: unknown) => ({ field, operator, value, uiMeta: {} });
const ou = (...a: unknown[]) => ({ group: "OR", filters: a });
const e = (...c: unknown[]) => ({ group: "AND", filters: c });
const okf = (r: ReturnType<typeof filtroDoWidget>) => {
  assert.equal(r.ok, true, JSON.stringify(r));
  return (r as { ok: true; filtro: any }).filtro;
};

test("filtroDoWidget: ligações — direction eq e agrupamento por callStatus (forma do catálogo da Xb9g)", () => {
  const o = {
    aggregations: [{ operator: "count", field: "_id" }], dateProperty: "dateAdded",
    filters: [ou(e(cond("direction", "eq", "inbound")))], groupBy: { fields: ["callStatus"], limit: 10, orderBy: "desc" },
  };
  const f = okf(filtroDoWidget({ options: o, module: "revex-calls" }, SP, DIA));
  assert.deepEqual(f.grupos, [[{ campo: "direction", valores: ["inbound"] }]]);
  assert.equal(f.agrupar, "callStatus");
  assert.equal(f.campoData, "date_added");
  assert.equal(f.soma, false);
});

test("filtroDoWidget: e-mail — status events_delivered e dateProperty createdAt viram date_added", () => {
  const o = {
    aggregations: [{ operator: "count", field: "id" }], dateProperty: "createdAt",
    filters: [ou(e(cond("status", "eq", "events_delivered")))],
  };
  const f = okf(filtroDoWidget({ options: o, module: "crm-emails" }, SP, DIA));
  assert.deepEqual(f.grupos, [[{ campo: "status", valores: ["events_delivered"] }]]);
  assert.equal(f.campoData, "date_added");
});

test("filtroDoWidget: ligações com campo sem recontagem (answeredBy.user) continua sem_conferencia citando o campo", () => {
  const o = { aggregations: [{ operator: "count", field: "_id" }], dateProperty: "dateAdded", filters: [ou(e(cond("answeredBy.user", "eq", "U1")))] };
  const r = filtroDoWidget({ options: o, module: "revex-calls" }, SP, DIA);
  assert.equal(r.ok, false);
  assert.match((r as { motivo: string }).motivo, /answeredBy\.user/);
});

// ---------- recontarLigacoes ----------

const resumoLig = (stats: Record<string, number>) => ({
  callStatusStats: Object.fromEntries(Object.entries(stats).map(([k, count]) => [k, { count, change: 100 }])),
  callDurationSummary: { totalDuration: 600, averageDuration: 30 },
});

test("recontarLigacoes: POST get-call-status-summary com locationId e o período em ISO (não em ms)", async () => {
  const a = clienteRota(() => resumoLig({ completed: 1 }));
  await recontarLigacoes(a.client, "L1", filtro());
  assert.equal(a.chamadas.length, 1);
  const c = a.chamadas[0];
  assert.equal(c.metodo, "post");
  assert.equal(c.url, `${R}/calls/get-call-status-summary?locationId=L1`);
  assert.equal(c.corpo.locationId, "L1");
  assert.equal(c.corpo.startDate, ISO_INI);
  assert.equal(c.corpo.endDate, ISO_FIM);
  assert.equal(c.corpo.direction, undefined, "sem condição de direção não manda direction");
});

test("recontarLigacoes: total soma todos os status, inclusive o rótulo 'N/A' com espaço de largura zero", async () => {
  const a = clienteRota(() => resumoLig({ completed: 16, failed: 1, "no-answer": 2, "N/A​": 3 }));
  const m = await recontarLigacoes(a.client, "L1", filtro());
  assert.equal(m.total, 22);
  assert.equal(m.grupos, undefined, "sem agrupar não devolve grupos");
});

test("recontarLigacoes: agrupar por callStatus devolve um grupo por status", async () => {
  const a = clienteRota(() => resumoLig({ completed: 16, failed: 1, "no-answer": 2 }));
  const m = await recontarLigacoes(a.client, "L1", filtro({ agrupar: "callStatus" }));
  assert.equal(m.total, 19);
  assert.deepEqual(Object.fromEntries((m.grupos ?? []).map((g: { id: string; value: number }) => [g.id, g.value])), { completed: 16, failed: 1, "no-answer": 2 });
});

test("recontarLigacoes: rótulos de exibição (No answer, Busy, Missed...) viram o valor cru; desconhecido é normalizado", async () => {
  const a = clienteRota(() => resumoLig({ Answered: 5, "No answer": 2, Missed: 1, Busy: 3, Voicemail: 1, "Canceled Call": 4 }));
  const m = await recontarLigacoes(a.client, "L1", filtro({ agrupar: "callStatus" }));
  assert.deepEqual(Object.fromEntries((m.grupos ?? []).map((g: { id: string; value: number }) => [g.id, g.value])),
    { completed: 5, "no-answer": 3, busy: 3, voicemail: 1, "canceled-call": 4 });
  const b = clienteRota(() => resumoLig({ "No answer": 2, Busy: 3, Answered: 1 }));
  const so = await recontarLigacoes(b.client, "L1", filtro({ grupos: [[{ campo: "callStatus", valores: ["no-answer", "busy"] }]] }));
  assert.equal(so.total, 5);
});

test("recontarLigacoes: a condição direction do widget vai no corpo", async () => {
  const a = clienteRota(() => resumoLig({ completed: 1 }));
  await recontarLigacoes(a.client, "L1", filtro({ grupos: [[{ campo: "direction", valores: ["inbound"] }]] }));
  assert.equal(a.chamadas[0].corpo.direction, "inbound");
  const b = clienteRota(() => resumoLig({ completed: 1 }));
  await recontarLigacoes(b.client, "L1", filtro({ grupos: [[{ campo: "direction", valores: ["outbound"] }]] }));
  assert.equal(b.chamadas[0].corpo.direction, "outbound");
});

test("recontarLigacoes: período sem ligação (callStatusStats vazio) dá total 0", async () => {
  const a = clienteRota(() => resumoLig({}));
  const m = await recontarLigacoes(a.client, "L1", filtro());
  assert.equal(m.total, 0);
});

// ---------- despachante: e-mail e ligações ----------

const opts = (extra: Record<string, unknown> = {}) => ({
  aggregations: [{ operator: "count", field: "_id" }], dateProperty: "dateAdded",
  dateRangeOverride: { operator: "dashboard_date_range" }, filters: [{ group: "OR", filters: [] }], ...extra,
});
function widget(widgetId: string, module: string, options: unknown, path: string | null) {
  const apiConfig = path ? { path } : null;
  const def = { widgetId, title: `T-${widgetId}`, chartType: "numeric", module, options, apiConfig };
  return { widgetId, titulo: def.title, chartType: "numeric", module, layout: {}, options, apiConfig, definicao: def } as never;
}
const numero = (v: number) => ({ data: [{ metricKey: "count::_id", data: { label: "total", value: v } }] });

function mundoLig(ghl: number, stats: Record<string, number>) {
  return clienteRota((m, url) => {
    if (m === "post" && url.startsWith(`${R}/dashboards/revex/calls`)) return numero(ghl);
    if (m === "post" && url.startsWith(`${R}/calls/get-call-status-summary`)) return resumoLig(stats);
    throw new Error(`rota inesperada ${m} ${url}`);
  });
}

test("conferirWidget: ligações batem quando o número do widget é o do relatório, com fonte ghl e independente:false", async () => {
  const a = mundoLig(19, { completed: 16, failed: 1, "no-answer": 2 });
  const it = await conferirWidget(a.client, "L1", widget("W1", "revex-calls", opts(), "/dashboards/revex/calls"), SP, DIA);
  assert.equal(it.resultado, "bate");
  assert.equal(it.fonte, "ghl");
  assert.equal(it.independente, false);
  assert.match(it.resumo ?? "", /GHL contra (o )?GHL/i);
  assert.equal(it.modulo, "revex-calls");
});

test("conferirWidget: ligações com número diferente divergem (mesmo sendo GHL contra GHL)", async () => {
  const a = mundoLig(20, { completed: 16, failed: 1, "no-answer": 2 });
  const it = await conferirWidget(a.client, "L1", widget("W1", "revex-calls", opts(), "/dashboards/revex/calls"), SP, DIA);
  assert.equal(it.resultado, "diverge");
  assert.equal(it.fonte, "ghl");
  assert.equal(it.independente, false);
});

test("conferirWidget: ligações — a direção do widget chega ao relatório e o período é o mesmo do POST de dados", async () => {
  const a = mundoLig(0, {});
  const o = opts({ filters: [ou(e(cond("direction", "eq", "inbound")))] });
  await conferirWidget(a.client, "L1", widget("W1", "revex-calls", o, "/dashboards/revex/calls"), SP, DIA);
  const rel = a.chamadas.find((c) => c.url.includes("/calls/get-call-status-summary"))!;
  assert.equal(rel.corpo.direction, "inbound");
  assert.equal(rel.corpo.startDate, ISO_INI);
  const dados = a.chamadas.find((c) => c.url.includes("/dashboards/revex/calls"))!;
  const ts = (dados.corpo.options.filters as any[]).flatMap((g) => g.filters).find((c) => c.operator === "time_series");
  assert.deepEqual(ts?.value, [DIA.inicio, DIA.fim]);
});

test("conferirWidget: e-mail sai sem_conferencia (rota do relatório não encontrada), sem rede de relatório e sem fonte falsa", async () => {
  const a = clienteRota((m, url) => {
    if (m === "post" && url.startsWith(`${R}/dashboards/crm/emails`)) return numero(5);
    throw new Error(`rota inesperada ${m} ${url}`);
  });
  const o = { aggregations: [{ operator: "count", field: "id" }], dateProperty: "createdAt", dateRangeOverride: { operator: "dashboard_date_range" }, filters: [ou(e(cond("status", "eq", "events_delivered")))] };
  const it = await conferirWidget(a.client, "L1", widget("W3", "crm-emails", o, "/dashboards/crm/emails"), SP, DIA);
  assert.equal(it.resultado, "sem_conferencia");
  assert.match(it.motivo ?? "", /e-mail/);
  assert.match(it.motivo ?? "", /rota/);
  assert.notEqual(it.motivo, "fonte entra numa etapa seguinte");
  assert.ok(!a.chamadas.some((c) => c.url.includes("/reporting/emails/") || c.url.includes("/emails/")), "chamou rota de relatório de e-mail");
  assert.notEqual(it.fonte, "ghl");
  assert.notEqual(it.independente, false);
});

test("conferirWidget: oportunidades NÃO ganham o selo 'GHL contra GHL' (quem lê o painel não pode confundir as fontes)", async () => {
  const a = clienteRota((m, url) => {
    if (m === "post") return { data: [{ metricKey: "count::id", data: [], total: 0 }] };
    if (url.includes("/opportunities/search")) return { opportunities: [], meta: { total: 0, nextPage: null } };
    throw new Error(`rota inesperada ${m} ${url}`);
  });
  const w = widget("W9", "crm-opportunities", { aggregations: [{ operator: "count", field: "id" }], dateProperty: "date_added", filters: [{ group: "OR", filters: [] }] }, "/dashboards/crm/opportunities");
  const it = await conferirWidget(a.client, "L1", w, SP, DIA);
  assert.doesNotMatch(it.resumo ?? "", /GHL contra (o )?GHL/i);
  assert.notEqual(it.independente, false);
});

// ---------- recontarMetaAds ----------

const optsMeta = (extra: Record<string, unknown> = {}, conta: unknown = ["act_123"]) => ({
  options: {
    aggregations: [{ operator: "sum", field: "spend" }], dateProperty: "dateCreated",
    filters: [ou(e(cond("adAccountId", "eq", conta)))], ...extra,
  },
});
const grafo = (extra: Record<string, unknown> = {}) => ({
  data: [{
    spend: "123.45", impressions: "1000", clicks: "50", date_start: "2026-10-15", date_stop: "2026-10-15",
    actions: [{ action_type: "link_click", value: "50" }, { action_type: "lead", value: "7" }], ...extra,
  }],
});

test("recontarMetaAds: sem AUTOMASTER_META_TOKEN devolve o motivo 'defina AUTOMASTER_META_TOKEN' e não chama a rede", async () => {
  const f = fetchFalso(grafo());
  const r = await recontarMetaAds(optsMeta(), filtro(), { env: {}, fetch: f.fn });
  assert.equal(r.ok, false);
  assert.match((r as { motivo: string }).motivo, /defina AUTOMASTER_META_TOKEN/);
  assert.equal(f.urls.length, 0);
});

test("recontarMetaAds: gasto sai em reais, com a conta e o período do widget na URL do Graph", async () => {
  const f = fetchFalso(grafo());
  const r = await recontarMetaAds(optsMeta(), filtro(), { env: { AUTOMASTER_META_TOKEN: TOKEN }, fetch: f.fn });
  assert.equal(r.ok, true);
  assert.equal((r as { medida: { total: number } }).medida.total, 123.45);
  const u = new URL(f.urls[0]);
  assert.equal(u.pathname, "/v21.0/act_123/insights");
  assert.equal(u.searchParams.get("fields"), "spend,impressions,clicks,actions");
  assert.deepEqual(JSON.parse(u.searchParams.get("time_range")!), { since: "2026-10-15", until: "2026-10-15" });
});

test("recontarMetaAds: adAccountId sem o prefixo act_ (e como texto, não lista) acha a mesma conta", async () => {
  const f = fetchFalso(grafo());
  await recontarMetaAds(optsMeta({}, "123"), filtro(), { env: { AUTOMASTER_META_TOKEN: TOKEN }, fetch: f.fn });
  assert.equal(new URL(f.urls[0]).pathname, "/v21.0/act_123/insights");
});

test("recontarMetaAds: a métrica vem da agregação (cliques, impressões, conversões = leads)", async () => {
  const env = { AUTOMASTER_META_TOKEN: TOKEN };
  const total = async (campo: string) => {
    const r = await recontarMetaAds(optsMeta({ aggregations: [{ operator: "sum", field: campo }] }), filtro(), { env, fetch: fetchFalso(grafo()).fn });
    assert.equal(r.ok, true, campo);
    return (r as { medida: { total: number } }).medida.total;
  };
  assert.equal(await total("clicks"), 50);
  assert.equal(await total("impressions"), 1000);
  assert.equal(await total("conversions"), 7); // actions do tipo lead, não link_click
});

test("recontarMetaAds: várias linhas somam (conta com mais de uma campanha)", async () => {
  const f = fetchFalso({ data: [grafo().data[0], { ...grafo().data[0], spend: "76.55" }] });
  const r = await recontarMetaAds(optsMeta(), filtro(), { env: { AUTOMASTER_META_TOKEN: TOKEN }, fetch: f.fn });
  assert.equal(Math.round((r as { medida: { total: number } }).medida.total * 100) / 100, 200);
});

test("recontarMetaAds: agregação sem equivalente no Graph (avg cpc) não confere e cita o campo", async () => {
  const f = fetchFalso(grafo());
  const r = await recontarMetaAds(optsMeta({ aggregations: [{ operator: "avg", field: "cpc" }] }), filtro(), { env: { AUTOMASTER_META_TOKEN: TOKEN }, fetch: f.fn });
  assert.equal(r.ok, false);
  assert.match((r as { motivo: string }).motivo, /cpc/);
});

test("recontarMetaAds: widget sem conta de anúncio escolhida não confere", async () => {
  const f = fetchFalso(grafo());
  const r = await recontarMetaAds(optsMeta({}, []), filtro(), { env: { AUTOMASTER_META_TOKEN: TOKEN }, fetch: f.fn });
  assert.equal(r.ok, false);
  assert.match((r as { motivo: string }).motivo, /adAccountId|conta/i);
  assert.equal(f.urls.length, 0);
});

test("recontarMetaAds: conta sem acesso devolve 'token sem acesso à conta act_...'", async () => {
  const f = fetchFalso({ error: { message: "Unsupported get request", type: "GraphMethodException", code: 100 } }, 400);
  const r = await recontarMetaAds(optsMeta(), filtro(), { env: { AUTOMASTER_META_TOKEN: TOKEN }, fetch: f.fn });
  assert.equal(r.ok, false);
  assert.match((r as { motivo: string }).motivo, /token sem acesso à conta act_123/);
});

test("recontarMetaAds: groupBy por dia manda time_increment=1 e agrupa pelo dia", async () => {
  const dados = { data: [
    { ...grafo().data[0], spend: "10.00", date_start: "2026-10-14", date_stop: "2026-10-14" },
    { ...grafo().data[0], spend: "20.50", date_start: "2026-10-15", date_stop: "2026-10-15" },
  ] };
  const f = fetchFalso(dados);
  const r = await recontarMetaAds(
    optsMeta({ groupBy: { fields: ["dateCreated"], groupFieldType: "time_series" } }),
    filtro({ inicio: Date.parse("2026-10-14T00:00:00-03:00") }),
    { env: { AUTOMASTER_META_TOKEN: TOKEN }, fetch: f.fn },
  );
  assert.equal(new URL(f.urls[0]).searchParams.get("time_increment"), "1");
  const m = (r as { medida: { total: number; grupos?: { id: string; value: number }[] } }).medida;
  assert.equal(m.total, 30.5);
  assert.deepEqual(Object.fromEntries((m.grupos ?? []).map((g) => [g.id, g.value])), { "2026-10-14": 10, "2026-10-15": 20.5 });
});

// ---------- despachante: Meta ----------

const widgetMeta = (agg = [{ operator: "sum", field: "spend" }]) =>
  widget("WM", "automation-admanager-fb-ads", { ...optsMeta({ aggregations: agg }).options, dateRangeOverride: { operator: "dashboard_date_range" } }, "/dashboards/automation/admanager/fb-ads");
const mundoMeta = (valor: number) => clienteRota((m, url) => {
  if (m === "post" && url.startsWith(`${R}/dashboards/automation/admanager/fb-ads`)) return numero(valor);
  throw new Error(`rota inesperada ${m} ${url}`);
});

test("conferirWidget: anúncio sem token vira sem_conferencia com 'defina AUTOMASTER_META_TOKEN' (nunca bate)", async () => {
  const a = mundoMeta(0);
  const f = fetchFalso(grafo());
  const it = await conferirWidget(a.client, "L1", widgetMeta(), SP, DIA, { env: {}, fetch: f.fn });
  assert.equal(it.resultado, "sem_conferencia");
  assert.match(it.motivo ?? "", /defina AUTOMASTER_META_TOKEN/);
  assert.equal(f.urls.length, 0);
});

test("conferirWidget: anúncio com token — gasto igual ao do painel bate; fonte meta e independente", async () => {
  const a = mundoMeta(123.45);
  const it = await conferirWidget(a.client, "L1", widgetMeta(), SP, DIA, { env: { AUTOMASTER_META_TOKEN: TOKEN }, fetch: fetchFalso(grafo()).fn });
  assert.equal(it.resultado, "bate");
  assert.equal(it.fonte, "meta");
  assert.equal(it.independente, true);
});

test("conferirWidget: gasto lido em centavos (12345) ou diferente do painel diverge", async () => {
  const a = mundoMeta(123.45);
  const it = await conferirWidget(a.client, "L1", widgetMeta(), SP, DIA, { env: { AUTOMASTER_META_TOKEN: TOKEN }, fetch: fetchFalso(grafo({ spend: "12345" })).fn });
  assert.equal(it.resultado, "diverge");
});

test("conferirWidget: conta sem acesso vira sem_conferencia com o motivo da conta", async () => {
  const a = mundoMeta(1);
  const f = fetchFalso({ error: { message: "x", code: 200 } }, 400);
  const it = await conferirWidget(a.client, "L1", widgetMeta(), SP, DIA, { env: { AUTOMASTER_META_TOKEN: TOKEN }, fetch: f.fn });
  assert.equal(it.resultado, "sem_conferencia");
  assert.match(it.motivo ?? "", /token sem acesso à conta act_123/);
});

test("conferirWidget: o token Meta nunca aparece no item devolvido nem nas chamadas ao GHL", async () => {
  const a = mundoMeta(123.45);
  const it = await conferirWidget(a.client, "L1", widgetMeta(), SP, DIA, { env: { AUTOMASTER_META_TOKEN: TOKEN }, fetch: fetchFalso(grafo()).fn });
  assert.ok(!JSON.stringify(it).includes(TOKEN), "token no item");
  assert.ok(!JSON.stringify(a.chamadas).includes(TOKEN), "token enviado ao GHL");
});

test("conferirPainel: o resumo conta os itens externos e 'sem token' entra em sem_conferencia", async () => {
  const a = clienteRota((m, url) => {
    if (m === "post" && url.startsWith(`${R}/dashboards/revex/calls`)) return numero(19);
    if (m === "post" && url.startsWith(`${R}/dashboards/automation/admanager/fb-ads`)) return numero(0);
    if (m === "post" && url.startsWith(`${R}/calls/get-call-status-summary`)) return resumoLig({ completed: 19 });
    throw new Error(`rota inesperada ${m} ${url}`);
  });
  const painel = { widgets: [widget("A", "revex-calls", opts(), "/dashboards/revex/calls"), widgetMeta()] } as never;
  const r = await conferirPainel(a.client, "L1", painel, SP, DIA, { env: {} });
  assert.deepEqual(r.itens.map((i) => i.widgetId), ["A", "WM"]);
  assert.deepEqual(r.resumo, { bate: 1, diverge: 0, sem_conferencia: 1 });
});
