/**
 * Etapa 1 do plano de dashboards: leitura de painéis e fuso da subconta.
 *
 * Contrato que o implementador deve cumprir (assinaturas e formas de resposta).
 * `client` é o GhlClient; só getJson/postJson são usados.
 *
 * src/api/dashboards.ts, BASE = "https://backend.leadconnectorhq.com/reporting"
 *   listarPaineis(client, loc): GET `${BASE}/dashboards?locationId=<loc>`
 *     resposta crua (medida ao vivo): { data: { defaultDashboardId, dashboard: [{_id,title,isDefault|null,isFavorite}],
 *       sharedDashboards: [mesmo formato] } } (sem isPrivate nem __v)
 *     devolve [{ id, titulo, isDefault (null vira false), isFavorite, compartilhado }]:
 *       primeiro os de `dashboard` (compartilhado=false), depois os de `sharedDashboards` (true)
 *   detalhePainel(client, loc, id): GET `${BASE}/dashboards/<id>?locationId=<loc>`
 *     resposta crua: { data: { dashboard: { _id, title, isDefault, isPrivate, __v, themeConfig },
 *       dashboardWidgets: [{ widgetId, layout: {x,y,w,h,minW,minH} }],
 *       widgets: [{ widgetId, title, chartType, module, options, apiConfig }] } }
 *     devolve { id, titulo, isDefault, isPrivate, __v, themeConfig,
 *       widgets: [{ widgetId, titulo, chartType, module, layout, options, apiConfig, definicao }] }
 *     na ordem de dashboardWidgets; `definicao` = o objeto cru de data.widgets com o mesmo
 *     widgetId, ou null se não houver par (então titulo/chartType/module/options/apiConfig = null).
 *   catalogoWidgets(client, loc): GET `${BASE}/dashboards/widgets-definitions?locationId=<loc>`
 *     data é um objeto ({filters, groups, definitions, ...}); devolve-o sem tocar.
 *   versoesPainel(client, loc, id): GET `${BASE}/dashboards/<id>/versions?locationId=<loc>`
 *     data = { versions: [], drift, nextCursor }; devolve-o sem tocar.
 *   dadosWidget(client, loc, widget: {chartType, options, apiConfig:{path}}):
 *     POST `${BASE}${apiConfig.path}?locationId=<loc>` com corpo EXATO { chartType, options };
 *     devolve o `data` da resposta, sem tocar.
 *   fusoDaSubconta(client, loc): GET `https://services.leadconnectorhq.com/locations/<loc>`
 *     resposta crua: { location: { timezone } }; devolve a string IANA.
 *
 * src/cli/dashboards.ts: registrarDashboards(program) e runDashboards(opts)
 *   `-o detalhe|versoes|dados` sem `-i`, e `-o dados` sem `--widget`, falham ANTES de
 *   pedir token (validação de argumento antes do withClient), com envelope
 *   {ok:false,error:{message}} no stdout e saída 1.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  listarPaineis, detalhePainel, catalogoWidgets, versoesPainel, dadosWidget, fusoDaSubconta,
} from "../src/api/dashboards.js";

interface Chamada { metodo: string; url: string; corpo?: unknown }

function clienteFalso(resposta: unknown) {
  const chamadas: Chamada[] = [];
  const reg = (metodo: string) => (url: string, corpo?: unknown) => {
    chamadas.push({ metodo, url, corpo });
    return Promise.resolve(resposta);
  };
  return { chamadas, client: { getJson: reg("get"), postJson: reg("post") } as never };
}

const R = "https://backend.leadconnectorhq.com/reporting";
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("listarPaineis junta próprios e compartilhados, normaliza isDefault null e não inventa isPrivate/__v", async () => {
  const a = clienteFalso({ data: {
    defaultDashboardId: "D1",
    dashboard: [
      { _id: "D1", title: "Vendas", isDefault: true, isFavorite: true },
      { _id: "D2", title: "Meu", isDefault: null, isFavorite: false },
    ],
    sharedDashboards: [{ _id: "D3", title: "Do time", isDefault: null, isFavorite: false }],
  } });
  const r = await listarPaineis(a.client, "L1");
  assert.deepEqual(a.chamadas, [{ metodo: "get", url: `${R}/dashboards?locationId=L1`, corpo: undefined }]);
  assert.deepEqual(r, [
    { id: "D1", titulo: "Vendas", isDefault: true, isFavorite: true, compartilhado: false },
    { id: "D2", titulo: "Meu", isDefault: false, isFavorite: false, compartilhado: false },
    { id: "D3", titulo: "Do time", isDefault: false, isFavorite: false, compartilhado: true },
  ]);
});

const DETALHE = { data: {
  dashboard: { _id: "D1", title: "Vendas", isDefault: false, isPrivate: true, __v: 7, themeConfig: { cor: "x" } },
  dashboardWidgets: [
    { widgetId: "W2", layout: { x: 0, y: 0, w: 6, h: 4, minW: 2, minH: 2 } },
    { widgetId: "W1", layout: { x: 6, y: 0, w: 6, h: 4, minW: 3, minH: 3 } },
  ],
  // ordem invertida de propósito: o par se faz por widgetId, não por posição
  widgets: [
    { widgetId: "W1", title: "Um", chartType: "pie", module: "opportunities",
      options: { a: 1 }, apiConfig: { path: "/x/um" } },
    { widgetId: "W2", title: "Dois", chartType: "bar", module: "contacts",
      options: { b: 2 }, apiConfig: { path: "/x/dois" } },
  ],
} };

test("detalhePainel faz GET no painel e junta layout e definição pelo widgetId", async () => {
  const a = clienteFalso(DETALHE);
  const r = await detalhePainel(a.client, "L1", "D1");
  assert.deepEqual(a.chamadas, [{ metodo: "get", url: `${R}/dashboards/D1?locationId=L1`, corpo: undefined }]);
  assert.deepEqual(r.widgets.map((w) => w.widgetId), ["W2", "W1"]);
  assert.deepEqual(r.widgets[0], {
    widgetId: "W2", titulo: "Dois", chartType: "bar", module: "contacts",
    layout: { x: 0, y: 0, w: 6, h: 4, minW: 2, minH: 2 },
    options: { b: 2 }, apiConfig: { path: "/x/dois" },
    definicao: DETALHE.data.widgets[1],
  });
  assert.equal(r.widgets[1].titulo, "Um");
  assert.deepEqual(r.widgets[1].layout, { x: 6, y: 0, w: 6, h: 4, minW: 3, minH: 3 });
});

test("detalhePainel devolve id, título, themeConfig, isPrivate, isDefault e a versão __v", async () => {
  const r = await detalhePainel(clienteFalso(DETALHE).client, "L1", "D1");
  assert.equal(r.id, "D1");
  assert.equal(r.titulo, "Vendas");
  assert.deepEqual(r.themeConfig, { cor: "x" });
  assert.equal(r.isPrivate, true);
  assert.equal(r.isDefault, false);
  assert.equal(r.__v, 7);
});

test("detalhePainel mantém widget sem definição, com definicao: null", async () => {
  const a = clienteFalso({ data: {
    dashboard: { _id: "D1", title: "T", isDefault: false, isPrivate: false, __v: 1, themeConfig: {} },
    dashboardWidgets: [
      { widgetId: "W1", layout: { x: 0, y: 0, w: 4, h: 4, minW: 1, minH: 1 } },
      { widgetId: "ORFAO", layout: { x: 4, y: 0, w: 4, h: 4, minW: 1, minH: 1 } },
    ],
    widgets: [{ widgetId: "W1", title: "Um", chartType: "pie", module: "m", options: {}, apiConfig: { path: "/p" } }],
  } });
  const r = await detalhePainel(a.client, "L1", "D1");
  assert.equal(r.widgets.length, 2);
  const orfao = r.widgets.find((w) => w.widgetId === "ORFAO");
  assert.ok(orfao, "widget sem par sumiu");
  assert.equal(orfao.definicao, null);
  assert.deepEqual(orfao.layout, { x: 4, y: 0, w: 4, h: 4, minW: 1, minH: 1 });
  assert.notEqual(r.widgets.find((w) => w.widgetId === "W1")?.definicao, null);
});

test("catalogoWidgets faz GET em widgets-definitions e devolve o data", async () => {
  const a = clienteFalso({ data: { filters: [{ k: 1 }], groups: [], definitions: [{ chartType: "pie" }] } });
  const r = await catalogoWidgets(a.client, "L1");
  assert.deepEqual(a.chamadas, [{ metodo: "get", url: `${R}/dashboards/widgets-definitions?locationId=L1`, corpo: undefined }]);
  assert.deepEqual(r, { filters: [{ k: 1 }], groups: [], definitions: [{ chartType: "pie" }] });
});

test("versoesPainel faz GET em versions do painel e devolve o data", async () => {
  const a = clienteFalso({ data: { versions: [{ v: 1 }, { v: 2 }], drift: null, nextCursor: null } });
  const r = await versoesPainel(a.client, "L1", "D1");
  assert.deepEqual(a.chamadas, [{ metodo: "get", url: `${R}/dashboards/D1/versions?locationId=L1`, corpo: undefined }]);
  assert.deepEqual(r, { versions: [{ v: 1 }, { v: 2 }], drift: null, nextCursor: null });
});

test("dadosWidget faz POST no path do apiConfig com corpo {chartType, options} e devolve o data intacto", async () => {
  const dados = { series: [{ nome: "open", valor: 3 }], meta: { n: 1 } };
  const a = clienteFalso({ data: dados, outro: "ignorado" });
  const opcoes = { pipelineId: "P1", periodo: "30d" };
  const r = await dadosWidget(a.client, "L1", {
    chartType: "pie", options: opcoes, apiConfig: { path: "/opportunities/status" }, title: "nao vai",
  } as never);
  assert.equal(a.chamadas.length, 1);
  assert.equal(a.chamadas[0].metodo, "post");
  assert.equal(a.chamadas[0].url, `${R}/opportunities/status?locationId=L1`);
  assert.deepEqual(a.chamadas[0].corpo, { chartType: "pie", options: opcoes });
  assert.deepEqual(r, dados);
});

test("dadosWidget recusa path com query, traversal ou fragmento", async () => {
  for (const path of ["/a?x=1", "/a/../b", "/a#f", "/a%2e%2e/b", "//evil", "a/b"]) {
    const a = clienteFalso({ data: 1 });
    await assert.rejects(dadosWidget(a.client, "L1", { chartType: "pie", options: {}, apiConfig: { path } } as never), /suspeito/);
    assert.equal(a.chamadas.length, 0);
  }
});

test("fusoDaSubconta faz GET da subconta e devolve o timezone IANA", async () => {
  const a = clienteFalso({ location: { id: "L1", timezone: "America/Sao_Paulo" } });
  const r = await fusoDaSubconta(a.client, "L1");
  assert.deepEqual(a.chamadas, [{ metodo: "get", url: "https://services.leadconnectorhq.com/locations/L1", corpo: undefined }]);
  assert.equal(r, "America/Sao_Paulo");
});

function cli(...args: string[]) {
  const r = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", "dashboards", "-l", "L1", ...args, "--json"], {
    cwd: RAIZ, encoding: "utf-8", timeout: 30000,
  });
  const linha = r.stdout.trim().split("\n").pop() ?? "";
  return { status: r.status, env: JSON.parse(linha) as { ok: boolean; error?: { message: string } } };
}

test("CLI: -o detalhe sem -i erra dizendo que falta o id", () => {
  const { status, env } = cli("-o", "detalhe");
  assert.equal(status, 1);
  assert.equal(env.ok, false);
  assert.match(env.error?.message ?? "", /\bid\b/i);
});

test("CLI: -o dados sem -i erra dizendo que falta o id", () => {
  const { status, env } = cli("-o", "dados", "--widget", "W1");
  assert.equal(status, 1);
  assert.equal(env.ok, false);
  assert.match(env.error?.message ?? "", /\bid\b/i);
});

test("CLI: -o dados sem --widget erra dizendo que falta o widget", () => {
  const { status, env } = cli("-o", "dados", "-i", "D1");
  assert.equal(status, 1);
  assert.equal(env.ok, false);
  assert.match(env.error?.message ?? "", /widget/i);
});
