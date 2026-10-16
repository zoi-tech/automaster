/**
 * Etapa 5 do plano de dashboards: conferência (comparador, oportunidades e agenda).
 *
 * Contrato que o implementador deve cumprir. `client` é o GhlClient (só getJson/postJson).
 *
 * src/api/dashboards-conferir.ts
 *   tipos
 *     Periodo  = { inicio: number; fim: number }  (ms, inclusive nos dois lados)
 *     Medida   = { total: number; grupos?: { id: string; value: number }[] }
 *     Cond     = { campo: string; valores: string[] }     (eq -> [v]; in -> v)
 *     Filtro   = { campoData: "date_added"|"updated_at"|"last_status_change_at"; inicio; fim; fuso: string;
 *                  grupos: Cond[][]    (OR de ANDs; `[{group:"OR",filters:[]}]` -> [])
 *                  agrupar: string|null (groupBy.fields[0]; "appoinmentStatus.keyword" -> "appointmentStatus")
 *                  soma: boolean }     (aggregations sum em monetary(_)value -> true; count -> false)
 *   comparar(ghl, recontagem: Medida)
 *     `ghl` é o `data` cru de dadosWidget: [{metricKey, data:[{label,value,id}], total}].
 *     devolve { resultado:"bate"|"diverge", ghl: Medida (normalizado), recontagem: Medida,
 *               divergencias: {id, ghl, recontagem}[] }  (grupo ausente de um lado vale 0)
 *     bate = totais com diferença < 0,01 E todo grupo (por id, sem ordem) com diferença < 0,01.
 *   filtroDoWidget(widget: {options, module?}, fuso, dateRange: Periodo)
 *     devolve { ok:true, filtro: Filtro } | { ok:false, motivo: string }
 *     período: filtro `time_series` (ms) dentro de options.filters; sem ele, o dateRange do painel.
 *     campoData: date_added|dateAdded -> date_added; date_updated|updated_at -> updated_at;
 *     last_status_change_date|last_status_change_at -> last_status_change_at.
 *     Campos de condição aceitos: status, pipeline_id, assigned_to, appointmentStatus; operadores eq e in.
 *     Qualquer outro campo/operador, ou agregação que não seja count/sum de valor monetário
 *     -> { ok:false, motivo } citando o campo ou o operador.
 *   recontarOportunidades(client, loc, filtro): Promise<Medida>
 *     pagina GET services.leadconnectorhq.com/opportunities/search?location_id=..&page=N (via
 *     listOpportunities) até meta.nextPage ser nulo; resposta { opportunities:[{id,status,pipelineId,
 *     assignedTo,source,monetaryValue,createdAt,updatedAt,lastStatusChangeAt}], meta:{total,nextPage} }.
 *     Filtra TUDO no lado do automaster (data pelo campoData, em ms; grupos). `grupos` só vem em
 *     Medida quando filtro.agrupar != null. soma:true -> total = soma de monetaryValue (ausente = 0).
 *   recontarAgenda(client, loc, filtro): Promise<Medida>
 *     lista calendários (GET .../calendars/?locationId= -> { calendars:[{id}] }), e para cada um UMA
 *     chamada de listEvents (calendarId=<id>, startTime/endTime em ms = filtro.inicio/fim);
 *     eventos { id, appointmentStatus, startTime, dateAdded }; aplica grupos; agrupa por
 *     appointmentStatus quando filtro.agrupar == "appointmentStatus".
 *   conferirWidget(client, loc, widget: WidgetPainel, fuso, dateRange): Promise<Item>   (o despachante)
 *     escolhe pelo module: crm-opportunities -> recontarOportunidades; automation-appointments ->
 *     recontarAgenda; outro module -> sem_conferencia "fonte entra numa etapa seguinte";
 *     widget sem apiConfig (custom) -> sem_conferencia. O número do GHL vem de dadosWidget com as
 *     options materializadas NA MESMA janela da recontagem (time_series [inicio,fim], timezone,
 *     groupBy.fields como objetos).
 *   conferirPainel(client, loc, painel, fuso, dateRange): Promise<{ itens: Item[]; resumo }>
 *     Item   = { widgetId, titulo, modulo, resultado: "bate"|"diverge"|"sem_conferencia",
 *                ghl, recontagem, motivo?, filtro }     (motivo só quando sem_conferencia/diverge sem filtro)
 *     resumo = { bate, diverge, sem_conferencia }  (contagens)
 *
 * src/cli/dashboards.ts: registrarDashboards ganha `dashboard-conferir -l -i [--json]`;
 *   runDashboardConferir é LEITURA (withClient sem `escrita`). Sem -i erra ANTES de pedir token.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  comparar, filtroDoWidget, recontarOportunidades, recontarAgenda, conferirWidget, conferirPainel,
} from "../src/api/dashboards-conferir.js";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SP = "America/Sao_Paulo";
// 15/10/2026 inteiro no horário de Brasília (UTC-3)
const DIA = { inicio: Date.parse("2026-10-15T00:00:00-03:00"), fim: Date.parse("2026-10-15T23:59:59.999-03:00") };

interface Chamada { metodo: string; url: string; corpo?: unknown }
function clienteRota(rota: (metodo: string, url: string, corpo?: unknown) => unknown) {
  const chamadas: Chamada[] = [];
  const reg = (metodo: string) => (url: string, corpo?: unknown) => {
    chamadas.push({ metodo, url, corpo });
    return Promise.resolve(rota(metodo, url, corpo));
  };
  return { chamadas, client: { getJson: reg("get"), postJson: reg("post") } as never };
}

const ghlRaw = (total: number, grupos: { id: string; label?: string; value: number }[] = []) =>
  [{ metricKey: "count::id", data: grupos.map((g) => ({ label: g.label ?? g.id, ...g })), total }];

// ---------- comparar ----------

test("comparar: contagens iguais batem", () => {
  const r = comparar(ghlRaw(5), { total: 5 });
  assert.equal(r.resultado, "bate");
  assert.equal(r.ghl.total, 5);
});

test("comparar: contagens diferentes divergem e trazem os dois números", () => {
  const r = comparar(ghlRaw(5), { total: 4 });
  assert.equal(r.resultado, "diverge");
  assert.equal(r.ghl.total, 5);
  assert.equal(r.recontagem.total, 4);
});

test("comparar: valor monetário com diferença menor que 1 centavo bate; de 2 centavos diverge", () => {
  assert.equal(comparar(ghlRaw(1000.004), { total: 1000 }).resultado, "bate");
  assert.equal(comparar(ghlRaw(1000.02), { total: 1000 }).resultado, "diverge");
  // contagem não ganha tolerância: 1 de diferença diverge
  assert.equal(comparar(ghlRaw(10), { total: 11 }).resultado, "diverge");
});

test("comparar: grupo a grupo por id, mesmo com totais iguais, lista só os grupos divergentes", () => {
  const ghl = ghlRaw(448, [{ id: "open", label: "Abrir", value: 429 }, { id: "lost", label: "Perdido(a)", value: 18 }, { id: "abandoned", value: 1 }]);
  const r = comparar(ghl, { total: 448, grupos: [{ id: "open", value: 429 }, { id: "lost", value: 17 }] });
  assert.equal(r.resultado, "diverge");
  const porId = Object.fromEntries(r.divergencias.map((d) => [d.id, d]));
  assert.deepEqual(Object.keys(porId).sort(), ["abandoned", "lost"]);
  assert.deepEqual([porId.lost.ghl, porId.lost.recontagem], [18, 17]);
  assert.deepEqual([porId.abandoned.ghl, porId.abandoned.recontagem], [1, 0]);
});

test("comparar: grupos iguais em outra ordem e com rótulos diferentes batem (casa por id, não por posição)", () => {
  const ghl = ghlRaw(3, [{ id: "won", label: "Ganho", value: 2 }, { id: "lost", label: "Perdido(a)", value: 1 }]);
  const r = comparar(ghl, { total: 3, grupos: [{ id: "lost", value: 1 }, { id: "won", value: 2 }] });
  assert.equal(r.resultado, "bate");
  assert.deepEqual(r.divergencias, []);
});

// ---------- filtroDoWidget ----------

const opts = (extra: Record<string, unknown> = {}) => ({
  aggregations: [{ operator: "count", field: "id" }],
  dateProperty: "date_added",
  dateRangeOverride: { operator: "dashboard_date_range" },
  filters: [{ group: "OR", filters: [] }],
  ...extra,
});
const cond = (field: string, operator: string, value: unknown) => ({ field, operator, value, uiMeta: {} });
const ands = (...c: unknown[]) => ({ group: "AND", filters: c });
const ou = (...a: unknown[]) => ({ group: "OR", filters: a });
const ok = (r: ReturnType<typeof filtroDoWidget>) => {
  assert.equal(r.ok, true, JSON.stringify(r));
  return (r as { ok: true; filtro: any }).filtro;
};

test("filtroDoWidget: sem período no widget usa o dateRange do painel e carrega o fuso", () => {
  const f = ok(filtroDoWidget({ options: opts(), module: "crm-opportunities" }, SP, DIA));
  assert.equal(f.inicio, DIA.inicio);
  assert.equal(f.fim, DIA.fim);
  assert.equal(f.fuso, SP);
  assert.deepEqual(f.grupos, []);
  assert.equal(f.agrupar, null);
  assert.equal(f.soma, false);
});

test("filtroDoWidget: time_series em ms nas options vence o dateRange do painel", () => {
  const ini = Date.parse("2026-09-01T00:00:00-03:00"), fim = Date.parse("2026-09-30T23:59:59.999-03:00");
  const o = opts({ filters: [{ group: "AND", filters: [{ field: "date_added", operator: "time_series", value: [ini, fim] }] }] });
  const f = ok(filtroDoWidget({ options: o, module: "crm-opportunities" }, SP, DIA));
  assert.equal(f.inicio, ini);
  assert.equal(f.fim, fim);
});

test("filtroDoWidget: dateProperty vira o campo de data (criação, atualização, mudança de status)", () => {
  const campo = (dateProperty: string, module = "crm-opportunities") =>
    ok(filtroDoWidget({ options: opts({ dateProperty }), module }, SP, DIA)).campoData;
  assert.equal(campo("date_added"), "date_added");
  assert.equal(campo("date_updated"), "updated_at");
  assert.equal(campo("last_status_change_date"), "last_status_change_at");
  assert.equal(campo("dateAdded", "automation-appointments"), "date_added");
});

test("filtroDoWidget: status, pipeline_id e assigned_to em AND, com eq e in", () => {
  const o = opts({ filters: [ou(ands(cond("status", "eq", "won"), cond("pipeline_id", "eq", "P1"), cond("assigned_to", "in", ["U1", "U2"])))] });
  const f = ok(filtroDoWidget({ options: o, module: "crm-opportunities" }, SP, DIA));
  assert.deepEqual(f.grupos, [[
    { campo: "status", valores: ["won"] },
    { campo: "pipeline_id", valores: ["P1"] },
    { campo: "assigned_to", valores: ["U1", "U2"] },
  ]]);
  // status "in" com um valor só (forma real de "Vendas por Campanha")
  const g = ok(filtroDoWidget({ options: opts({ filters: [ou(ands(cond("status", "in", ["won"])))] }), module: "crm-opportunities" }, SP, DIA));
  assert.deepEqual(g.grupos, [[{ campo: "status", valores: ["won"] }]]);
});

test("filtroDoWidget: dois grupos AND dentro do OR viram duas alternativas; grupo vazio vira nenhuma", () => {
  const o = opts({ filters: [ou(ands(cond("status", "eq", "won")), ands(cond("status", "eq", "lost"), cond("pipeline_id", "eq", "P1")))] });
  const f = ok(filtroDoWidget({ options: o, module: "crm-opportunities" }, SP, DIA));
  assert.deepEqual(f.grupos, [
    [{ campo: "status", valores: ["won"] }],
    [{ campo: "status", valores: ["lost"] }, { campo: "pipeline_id", valores: ["P1"] }],
  ]);
});

test("filtroDoWidget: agenda lê appointmentStatus e o groupBy com a grafia 'appoinmentStatus.keyword'", () => {
  const o = opts({ dateProperty: "dateAdded", filters: [ou(ands(cond("appointmentStatus", "eq", "noshow")))], groupBy: { fields: ["appoinmentStatus.keyword"], limit: 10, orderBy: "desc" } });
  const f = ok(filtroDoWidget({ options: o, module: "automation-appointments" }, SP, DIA));
  assert.deepEqual(f.grupos, [[{ campo: "appointmentStatus", valores: ["noshow"] }]]);
  assert.equal(f.agrupar, "appointmentStatus");
});

test("filtroDoWidget: groupBy status passa direto; agregação de soma monetária liga soma", () => {
  const f = ok(filtroDoWidget({ options: opts({ groupBy: { fields: ["status"], limit: 15, orderBy: "desc" }, aggregations: [{ operator: "sum", field: "monetary_value" }] }), module: "crm-opportunities" }, SP, DIA));
  assert.equal(f.agrupar, "status");
  assert.equal(f.soma, true);
});

test("filtroDoWidget: condição que a recontagem não reproduz vira sem_conferencia com motivo (nunca ok)", () => {
  const casos: [string, unknown, RegExp][] = [
    ["campo desconhecido", ou(ands(cond("source", "contains", "face"))), /source|contains/],
    ["custom field", ou(ands(cond("custom_fields.abc.raw", "eq", "x"))), /custom_fields/],
    ["operador desconhecido em campo conhecido", ou(ands(cond("status", "neq", "won"))), /neq/],
    ["um AND bom e um ruim no mesmo OR", ou(ands(cond("status", "eq", "won")), ands(cond("tags", "eq", "a"))), /tags/],
  ];
  for (const [nome, filtro, re] of casos) {
    const r = filtroDoWidget({ options: opts({ filters: [filtro] }), module: "crm-opportunities" }, SP, DIA);
    assert.equal(r.ok, false, nome);
    assert.match((r as { motivo: string }).motivo, re, nome);
  }
  const avg = filtroDoWidget({ options: opts({ aggregations: [{ operator: "avg", field: "monetary_value" }] }), module: "crm-opportunities" }, SP, DIA);
  assert.equal(avg.ok, false);
  assert.match((avg as { motivo: string }).motivo, /avg/);
});

// ---------- recontarOportunidades ----------

const filtroOpp = (extra: Record<string, unknown> = {}) => ({
  campoData: "date_added", inicio: DIA.inicio, fim: DIA.fim, fuso: SP, grupos: [], agrupar: null, soma: false, ...extra,
}) as never;
const card = (id: string, extra: Record<string, unknown> = {}) => ({
  id, status: "open", pipelineId: "P1", assignedTo: "U1", source: "site", monetaryValue: 0,
  createdAt: "2026-10-15T15:00:00.000Z", updatedAt: "2026-10-15T15:00:00.000Z", lastStatusChangeAt: "2026-10-15T15:00:00.000Z",
  ...extra,
});
/** Servidor que ignora todo filtro (como se a rota não filtrasse) e entrega `paginas[page-1]`. */
function servidorOpp(paginas: unknown[][]) {
  return clienteRota((_m, url) => {
    const page = Number(new URL(url).searchParams.get("page") ?? "1");
    return {
      opportunities: paginas[page - 1] ?? [],
      meta: { total: paginas.flat().length, currentPage: page, nextPage: page < paginas.length ? page + 1 : null },
    };
  });
}

test("recontarOportunidades: pagina até o fim e soma todas as páginas", async () => {
  const a = servidorOpp([[card("1"), card("2")], [card("3"), card("4")], [card("5")]]);
  const r = await recontarOportunidades(a.client, "L1", filtroOpp());
  assert.equal(r.total, 5);
  const pages = a.chamadas.map((c) => new URL(c.url).searchParams.get("page"));
  for (const p of ["1", "2", "3"]) assert.ok(pages.includes(p), `faltou a página ${p}: ${pages}`);
  assert.ok(a.chamadas.every((c) => c.url.startsWith("https://services.leadconnectorhq.com/opportunities/search?")));
  assert.ok(a.chamadas.every((c) => new URL(c.url).searchParams.get("location_id") === "L1"));
});

test("recontarOportunidades: filtra no lado do automaster mesmo que a rota devolva tudo", async () => {
  const a = servidorOpp([[
    card("ok", { status: "won" }),
    card("lost", { status: "lost" }),
    card("outroFunil", { status: "won", pipelineId: "P2" }),
    card("foraDoPeriodo", { status: "won", createdAt: "2026-10-10T15:00:00.000Z" }),
  ]]);
  const grupos = [[{ campo: "status", valores: ["won"] }, { campo: "pipeline_id", valores: ["P1"] }]];
  const r = await recontarOportunidades(a.client, "L1", filtroOpp({ grupos }));
  assert.equal(r.total, 1);
});

test("recontarOportunidades: alternativas OR somam a união, sem contar duas vezes quem casa nas duas", async () => {
  const a = servidorOpp([[card("a", { status: "won" }), card("b", { status: "lost" }), card("c", { status: "open" })]]);
  const grupos = [[{ campo: "status", valores: ["won", "lost"] }], [{ campo: "status", valores: ["won"] }]];
  assert.equal((await recontarOportunidades(a.client, "L1", filtroOpp({ grupos }))).total, 2);
});

test("recontarOportunidades: assigned_to filtra pelo dono do card", async () => {
  const a = servidorOpp([[card("1", { assignedTo: "U1" }), card("2", { assignedTo: "U2" }), card("3", { assignedTo: "U3" })]]);
  const grupos = [[{ campo: "assigned_to", valores: ["U1", "U3"] }]];
  assert.equal((await recontarOportunidades(a.client, "L1", filtroOpp({ grupos }))).total, 2);
});

test("recontarOportunidades: soma monetaryValue dos cards do período (ausente vale 0)", async () => {
  const a = servidorOpp([[
    card("1", { monetaryValue: 100.1 }), card("2", { monetaryValue: 200.2 }), card("3", { monetaryValue: undefined }),
    card("fora", { monetaryValue: 9999, createdAt: "2026-09-01T15:00:00.000Z" }),
  ]]);
  const r = await recontarOportunidades(a.client, "L1", filtroOpp({ soma: true }));
  assert.ok(Math.abs(r.total - 300.3) < 0.001, `total ${r.total}`);
});

test("recontarOportunidades: agrupa por status (contagem) e por status com soma", async () => {
  const cards = [card("1", { status: "won", monetaryValue: 10 }), card("2", { status: "won", monetaryValue: 5 }), card("3", { status: "lost", monetaryValue: 7 })];
  const mapa = (r: { grupos?: { id: string; value: number }[] }) => Object.fromEntries((r.grupos ?? []).map((g) => [g.id, g.value]));
  const cont = await recontarOportunidades(servidorOpp([cards]).client, "L1", filtroOpp({ agrupar: "status" }));
  assert.equal(cont.total, 3);
  assert.deepEqual(mapa(cont), { won: 2, lost: 1 });
  const soma = await recontarOportunidades(servidorOpp([cards]).client, "L1", filtroOpp({ agrupar: "status", soma: true }));
  assert.deepEqual(mapa(soma), { won: 15, lost: 7 });
  // sem agrupar não inventa grupos
  assert.equal((await recontarOportunidades(servidorOpp([cards]).client, "L1", filtroOpp())).grupos, undefined);
});

test("recontarOportunidades: o dia 15 no fuso de São Paulo pega o card das 23:30 locais e solta os vizinhos", async () => {
  const a = servidorOpp([[
    card("23h30Local", { createdAt: "2026-10-16T02:30:00.000Z" }), // 15/10 23:30 em Brasília
    card("00h00Local", { createdAt: "2026-10-15T03:00:00.000Z" }), // 15/10 00:00: início inclusivo
    card("23h30Anterior", { createdAt: "2026-10-15T02:30:00.000Z" }), // 14/10 23:30 em Brasília
    card("00h00Seguinte", { createdAt: "2026-10-16T03:00:00.000Z" }), // 16/10 00:00 em Brasília
  ]]);
  const r = await recontarOportunidades(a.client, "L1", filtroOpp({ agrupar: "status" }));
  assert.equal(r.total, 2);
});

test("recontarOportunidades: campo de mudança de status usa lastStatusChangeAt, não a criação; atualização usa updatedAt", async () => {
  const dentro = "2026-10-15T15:00:00.000Z", fora = "2026-09-01T15:00:00.000Z";
  const cards = [
    card("criadoDentroMudouFora", { status: "s1", createdAt: dentro, lastStatusChangeAt: fora, updatedAt: fora }),
    card("criadoForaMudouDentro", { status: "s2", createdAt: fora, lastStatusChangeAt: dentro, updatedAt: fora }),
    card("criadoForaAtualizadoDentro", { status: "s3", createdAt: fora, lastStatusChangeAt: fora, updatedAt: dentro }),
  ];
  const mud = await recontarOportunidades(servidorOpp([cards]).client, "L1", filtroOpp({ campoData: "last_status_change_at" }));
  assert.equal(mud.total, 1);
  const upd = await recontarOportunidades(servidorOpp([cards]).client, "L1", filtroOpp({ campoData: "updated_at" }));
  assert.equal(upd.total, 1);
  const cri = await recontarOportunidades(servidorOpp([cards]).client, "L1", filtroOpp({ campoData: "date_added" }));
  assert.equal(cri.total, 1);
  // e são cards diferentes em cada campo
  const quem = async (campoData: string) => {
    const a = servidorOpp([cards]);
    const r = await recontarOportunidades(a.client, "L1", filtroOpp({ campoData, agrupar: "status" }));
    return (r.grupos ?? []).map((g) => g.id);
  };
  assert.deepEqual(await quem("last_status_change_at"), ["s2"]);
  assert.deepEqual(await quem("date_added"), ["s1"]);
});

// ---------- recontarAgenda ----------

const filtroAg = (extra: Record<string, unknown> = {}) => ({
  campoData: "date_added", inicio: DIA.inicio, fim: DIA.fim, fuso: SP, grupos: [], agrupar: null, soma: false, ...extra,
}) as never;
const ev = (id: string, st: string) => ({ id, appointmentStatus: st, startTime: "2026-10-15 10:00:00", dateAdded: "2026-10-15T12:00:00.000Z" });
function servidorAgenda(porCal: Record<string, unknown[]>) {
  return clienteRota((_m, url) => {
    if (url.includes("/calendars/events")) {
      const id = new URL(url).searchParams.get("calendarId") ?? "";
      return { events: porCal[id] ?? [] };
    }
    if (url.includes("/calendars/")) return { calendars: Object.keys(porCal).map((id) => ({ id })) };
    throw new Error(`rota inesperada ${url}`);
  });
}

test("recontarAgenda: uma chamada de eventos por calendário, startTime no início da janela e endTime = fim + 365 dias (o widget filtra por criação), e soma", async () => {
  const a = servidorAgenda({ C1: [ev("1", "showed"), ev("2", "noshow")], C2: [ev("3", "showed")] });
  const r = await recontarAgenda(a.client, "L1", filtroAg());
  assert.equal(r.total, 3);
  const evs = a.chamadas.filter((c) => c.url.includes("/calendars/events")).map((c) => new URL(c.url).searchParams);
  assert.deepEqual(evs.map((p) => p.get("calendarId")).sort(), ["C1", "C2"]);
  for (const p of evs) {
    assert.equal(p.get("startTime"), String(DIA.inicio));
    assert.equal(p.get("endTime"), String(DIA.fim + 365 * 86_400_000));
    assert.equal(p.get("locationId"), "L1");
  }
});

test("recontarAgenda: o recorte da janela é local, por dateAdded, não por startTime", async () => {
  const e = (id: string, dateAdded: string, startTime: string) => ({ id, appointmentStatus: "new", startTime, dateAdded });
  const a = servidorAgenda({ C1: [
    e("criadoDentroMarcadoDepois", "2026-10-15T12:00:00.000Z", "2026-12-20 10:00:00"), // entra
    e("criadoForaStartDentro", "2026-10-10T12:00:00.000Z", "2026-10-15 10:00:00"), // não entra
    e("criado23h30Local", "2026-10-16T02:30:00.000Z", "2026-11-01 10:00:00"), // 15/10 23:30 em Brasília: entra
    e("criadoDia16", "2026-10-16T03:00:00.000Z", "2026-11-01 10:00:00"), // não entra
  ] });
  const r = await recontarAgenda(a.client, "L1", filtroAg({ agrupar: "appointmentStatus" }));
  assert.equal(r.total, 2);
});

test("recontarAgenda: agrupa por situação e aplica o filtro de appointmentStatus", async () => {
  const dados = { C1: [ev("1", "showed"), ev("2", "noshow"), ev("3", "noshow")], C2: [ev("4", "showed")] };
  const g = await recontarAgenda(servidorAgenda(dados).client, "L1", filtroAg({ agrupar: "appointmentStatus" }));
  assert.deepEqual(Object.fromEntries((g.grupos ?? []).map((x) => [x.id, x.value])), { showed: 2, noshow: 2 });
  const f = await recontarAgenda(servidorAgenda(dados).client, "L1", filtroAg({ grupos: [[{ campo: "appointmentStatus", valores: ["noshow"] }]] }));
  assert.equal(f.total, 2);
});

// ---------- despachante ----------

const R = "https://backend.leadconnectorhq.com/reporting";
function widget(widgetId: string, module: string, options: unknown, extra: Record<string, unknown> = {}) {
  const apiConfig = extra.apiConfig === undefined
    ? { path: module === "crm-opportunities" ? "/dashboards/crm/opportunities" : "/dashboards/automations/appointments" }
    : extra.apiConfig;
  const def = { widgetId, title: `T-${widgetId}`, chartType: "donut", module, options, apiConfig };
  return { widgetId, titulo: def.title, chartType: "donut", module, layout: {}, options, apiConfig, definicao: def };
}
const donutStatus = opts({ groupBy: { fields: ["status"], limit: 15, orderBy: "desc" } });

/** Painel falso: dados do GHL por path, cards de oportunidade e eventos da agenda. */
function mundo(ghlOpp: unknown, ghlAg: unknown) {
  return clienteRota((m, url) => {
    if (m === "post" && url.startsWith(`${R}/dashboards/crm/opportunities`)) return { data: ghlOpp };
    if (m === "post" && url.startsWith(`${R}/dashboards/automations/appointments`)) return { data: ghlAg };
    if (url.includes("/opportunities/search")) {
      return { opportunities: [card("1", { status: "won" }), card("2", { status: "won" }), card("3", { status: "lost" })], meta: { total: 3, nextPage: null } };
    }
    if (url.includes("/calendars/events")) return { events: [ev("1", "showed")] };
    if (url.includes("/calendars/")) return { calendars: [{ id: "C1" }] };
    throw new Error(`rota inesperada ${m} ${url}`);
  });
}

test("conferirWidget: oportunidades batem quando o número do GHL é o recontado", async () => {
  const a = mundo(ghlRaw(3, [{ id: "won", value: 2 }, { id: "lost", value: 1 }]), ghlRaw(1));
  const it = await conferirWidget(a.client, "L1", widget("W1", "crm-opportunities", donutStatus) as never, SP, DIA);
  assert.equal(it.resultado, "bate");
  assert.deepEqual([it.widgetId, it.titulo, it.modulo], ["W1", "T-W1", "crm-opportunities"]);
  assert.ok(it.ghl && it.recontagem && it.filtro);
  assert.equal(it.motivo, undefined);
});

test("conferirWidget: número diferente do GHL diverge", async () => {
  const a = mundo(ghlRaw(4, [{ id: "won", value: 3 }, { id: "lost", value: 1 }]), ghlRaw(1));
  const it = await conferirWidget(a.client, "L1", widget("W1", "crm-opportunities", donutStatus) as never, SP, DIA);
  assert.equal(it.resultado, "diverge");
});

test("conferirWidget: o POST de dados vai materializado na mesma janela da recontagem", async () => {
  const a = mundo(ghlRaw(3, [{ id: "won", value: 2 }, { id: "lost", value: 1 }]), ghlRaw(1));
  await conferirWidget(a.client, "L1", widget("W1", "crm-opportunities", donutStatus) as never, SP, DIA);
  const post = a.chamadas.find((c) => c.metodo === "post");
  assert.ok(post, "não buscou o número do GHL");
  const corpo = post.corpo as { chartType: string; options: any };
  assert.equal(corpo.options.timezone, SP);
  const ts = (corpo.options.filters as any[]).flatMap((g) => g.filters).find((c) => c.operator === "time_series");
  assert.deepEqual(ts?.value, [DIA.inicio, DIA.fim]);
  assert.deepEqual(corpo.options.groupBy.fields, [{ field: "status", type: "field" }]);
});

test("filtroDoWidget: dateRangeOverride till_date ignora o período do painel: do início dos tempos até o fim do painel", () => {
  const f = ok(filtroDoWidget({ options: opts({ dateRangeOverride: { operator: "till_date" } }), module: "crm-opportunities" }, SP, DIA));
  assert.equal(f.inicio, 0);
  assert.equal(f.fim, DIA.fim);
});

test("filtroDoWidget: dateRangeOverride que a conferência não reproduz (today, last_month, custom...) sai sem_conferencia", () => {
  for (const op of ["today", "last_month", "custom"]) {
    const r = filtroDoWidget({ options: opts({ dateRangeOverride: { operator: op } }), module: "crm-opportunities" }, SP, DIA);
    assert.equal(r.ok, false, op);
    assert.match((r as { motivo: string }).motivo, new RegExp(op), op);
  }
});

test("conferirWidget: widget till_date (estoque de hoje) reconta tudo e pede ao GHL sem a janela do painel", async () => {
  const antigo = { createdAt: "2020-01-01T12:00:00.000Z" };
  const a = clienteRota((m, url) => {
    if (m === "post") return { data: ghlRaw(2, [{ id: "open", value: 2 }]) };
    assert.equal(new URL(url).searchParams.get("date"), null, "till_date não manda janela de criação à busca");
    return { opportunities: [card("1", antigo), card("2", antigo), card("3", { ...antigo, status: "won" })], meta: { nextPage: null } };
  });
  const o = opts({ dateRangeOverride: { operator: "till_date" }, filters: [ou(ands(cond("status", "eq", "open")))], groupBy: { fields: ["status"] } });
  const it = await conferirWidget(a.client, "L1", widget("W9", "crm-opportunities", o) as never, SP, DIA);
  assert.equal(it.resultado, "bate", JSON.stringify(it));
  assert.equal(it.recontagem?.total, 2);
  const corpo = a.chamadas.find((c) => c.metodo === "post")!.corpo as { options: any };
  const ts = (corpo.options.filters as any[]).flatMap((g) => g.filters).find((c) => c.operator === "time_series");
  assert.deepEqual(ts?.value, [0, DIA.fim]);
});

test("conferirWidget: agenda bate por situação", async () => {
  const o = opts({ dateProperty: "dateAdded", groupBy: { fields: ["appoinmentStatus.keyword"], limit: 10, orderBy: "desc" } });
  const a = mundo(ghlRaw(0), ghlRaw(1, [{ id: "showed", value: 1 }]));
  const it = await conferirWidget(a.client, "L1", widget("W2", "automation-appointments", o) as never, SP, DIA);
  assert.equal(it.resultado, "bate");
});

test("conferirWidget: módulo sem fonte e widget custom saem sem_conferencia, nunca bate", async () => {
  const a = mundo(ghlRaw(0), ghlRaw(0));
  for (const m of ["conversations", "crm-sms", "leadgen-funnel-stats", "leadgen-payments-orders", "automation-admanager-google-ads"]) {
    const it = await conferirWidget(a.client, "L1", widget("W3", m, opts(), { apiConfig: { path: "/dashboards/x/y" } }) as never, SP, DIA);
    assert.equal(it.resultado, "sem_conferencia", m);
    assert.match(it.motivo ?? "", /fonte entra numa etapa seguinte/, m);
    assert.equal(it.modulo, m);
  }
  const cust = await conferirWidget(a.client, "L1", widget("W4", "custom", {}, { apiConfig: null }) as never, SP, DIA);
  assert.equal(cust.resultado, "sem_conferencia");
  assert.ok((cust.motivo ?? "").length > 0);
});

test("conferirWidget: condição irreproduzível sai sem_conferencia com motivo mesmo se os números coincidirem", async () => {
  const o = opts({ filters: [ou(ands(cond("source", "contains", "face")))] });
  const a = mundo(ghlRaw(3), ghlRaw(0)); // total 3 == os 3 cards do servidor falso
  const it = await conferirWidget(a.client, "L1", widget("W5", "crm-opportunities", o) as never, SP, DIA);
  assert.equal(it.resultado, "sem_conferencia");
  assert.match(it.motivo ?? "", /source|contains/);
});

test("conferirPainel: um item por widget, na ordem, e o resumo conta cada resultado", async () => {
  const a = mundo(ghlRaw(3, [{ id: "won", value: 2 }, { id: "lost", value: 1 }]), ghlRaw(2, [{ id: "showed", value: 2 }]));
  const painel = { id: "D1", titulo: "P", widgets: [
    widget("A", "crm-opportunities", donutStatus), // bate
    widget("B", "automation-appointments", opts({ dateProperty: "dateAdded", groupBy: { fields: ["appoinmentStatus.keyword"] } })), // diverge: GHL 2, agenda 1
    widget("C", "custom", {}, { apiConfig: null }), // sem_conferencia
    widget("D", "crm-sms", opts(), { apiConfig: { path: "/dashboards/c/d" } }), // sem_conferencia
  ] };
  const r = await conferirPainel(a.client, "L1", painel as never, SP, DIA);
  assert.deepEqual(r.itens.map((i) => [i.widgetId, i.resultado]), [
    ["A", "bate"], ["B", "diverge"], ["C", "sem_conferencia"], ["D", "sem_conferencia"],
  ]);
  assert.deepEqual(r.resumo, { bate: 1, diverge: 1, sem_conferencia: 2 });
});

// ---------- CLI ----------

test("CLI: dashboard-conferir sem -i erra dizendo que falta o id, antes de pedir token", () => {
  const r = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", "dashboard-conferir", "-l", "L1", "--json"], {
    cwd: RAIZ, encoding: "utf-8", timeout: 30000,
  });
  const env = JSON.parse(r.stdout.trim().split("\n").pop() ?? "") as { ok: boolean; error?: { message: string } };
  assert.equal(r.status, 1);
  assert.equal(env.ok, false);
  assert.match(env.error?.message ?? "", /\bid\b/i);
});
