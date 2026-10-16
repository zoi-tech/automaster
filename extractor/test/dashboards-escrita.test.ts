/**
 * Etapa 3 do plano de dashboards: escrita de painel (criar privado, editar, tema, renomear,
 * apagar, restaurar). Contrato que o implementador deve cumprir.
 *
 * src/api/dashboards.ts (BASE = "https://backend.leadconnectorhq.com/reporting"; client usa
 * getJson/postJson/putJson/deleteJson)
 *   criarPainel(client, loc, titulo): POST `${BASE}/dashboards`
 *     corpo EXATO { locationId: loc, title: titulo, isPrivate: true, permissionAccess: [] }.
 *     Sem parâmetro de visibilidade: nunca cria painel público.
 *   salvarPainel(client, loc, id, { title, activityBuffer, layout, themeConfig, version }):
 *     PUT `${BASE}/dashboards/<id>?locationId=<loc>` com esse objeto como corpo, só essas 5 chaves.
 *     activityBuffer = { create:[{<idTemporario>: <widget>}], update:[{<widgetId>: <widget>}], delete:[<widgetId>] }
 *   apagarPainel(client, loc, id, version): DELETE `${BASE}/dashboards/<id>` (SEM query),
 *     corpo { locationId: loc, version }.
 *   restaurarVersao(client, loc, id, v): POST `${BASE}/dashboards/<id>/versions/<v>/restore?locationId=<loc>`,
 *     corpo {}.
 *
 * src/cli/dashboards.ts
 *   executarDashboardAcao(client, o, log?): Promise<Record<string, any>>   (a lógica, sem withClient)
 *   runDashboardAcao(o): withClient(o.location, log, fn, { escrita: !!o.confirmo }) -> executarDashboardAcao
 *   o = { location, acao: criar|editar|tema|renomear|apagar|restaurar, id?, titulo?, plano?, tema?,
 *         versao?, versaoEsperada?, confirmo?, json? }
 *     --plano é JSON em texto OU caminho de arquivo; --tema é JSON em texto; --versao é a versão
 *     a restaurar; --versao-esperada (o.versaoEsperada) é a versão que a prévia mostrou.
 *   Fluxo: lê detalhePainel; isDefault recusa apagar e editar (também na prévia); valida; sem
 *   confirmo devolve a prévia e NÃO escreve; com confirmo exige versaoEsperada (exceto criar),
 *   confere com o __v lido, lê GET .../versions, grava registroEscrita(loc, "_dashboards", id, {acao, versao, ...})
 *   e só então escreve.
 *   Prévia (retorno sem confirmo): { acao, aplicado:false, motivo, painel:{id,titulo,isDefault,isPrivate},
 *     versao:<__v lido>, mudancas:[...não vazio], problemas:[{codigo,mensagem}], avisos:[{codigo,mensagem}] }
 *   Gravação: { ..., aplicado:true, registro:<caminho do json do rastro>, resposta }
 *   executarDashboardAcao(client, o, log?, novoId?): novoId() -> ObjectId de 24 hex, injetável; o padrão
 *     gera ids aleatórios. A chave de activityBuffer.create e o _id do widget novo são esses ids.
 *   plano (editar) = { criar:[{id, titulo?, options?, molde:<widget cru de outro painel>}], atualizar:[{widgetId, ...}],
 *     remover:[widgetId], layout:[{id,x,y,w,h}] } — `id` do criar é temporário e só vale no plano
 *     (layout o referencia); a ferramenta troca pelo ObjectId gerado.
 *   Fatos medidos ao vivo (Xb9g) que os testes fixam:
 *     - activityBuffer é {} quando não há mudança de widget (tema, renomear, 2º PUT do editar).
 *     - cada item de layout no PUT: {id,x,y,w,h,minW,minH}. Widget existente: minW/minH do layout atual.
 *       Item novo: minW/minH de molde.layout se existir, senão mínimos do tipo (numeric 3x4, table 6x6,
 *       funnel 5x6, demais 4x6).
 *     - themeConfig no PUT é aninhado { dashboardTheme:{...cores e chaves extras}, widgetTheme }. O GET
 *       devolve plano; o `tema` aceita plano OU aninhado, mescla e envia aninhado, preservando widgetTheme
 *       ({} se não houver) e chaves extras.
 *     - widget novo: corpo = lista fixa copiada do molde (deleted:false, _id, hasTrimmedFilters, identifier,
 *       className, module, moduleName, eventSource, group, title, chartType, options, savedOptionPairs,
 *       locationId, extras, apiConfig, externalDataConfig, metricId), sem dashboardId/createdBy/__v.
 *     - o layout enviado no create é IGNORADO: editar com widget novo faz 2 PUTs. 1º {activityBuffer:{create},
 *       version:<__v>}; 2º {activityBuffer:{}, layout completo com os ids novos, version:<__v+1>}.
 *       Sem widget novo, 1 PUT. Cada PUT sobe o __v em 1.
 *   Mensagens de recusa (regex): sem molde /molde.*-o detalhe/s; padrão /é o painel padrão da subconta/;
 *     sem versão /--versao-esperada/; divergência /o painel mudou desde a prévia/; layout /sobrepõem/
 *     (a mensagem lista cada problema); cor /#RRGGBB/; contraste /contraste/.
 *   O comando `dashboard-acao` (--help) não tem opção de painel público/compartilhado.
 *
 * Etapa 11 — tema padrão branco quando o painel nasce:
 *   criar com confirmo faz 2 escritas, nesta ordem: o POST de sempre (corpo exato, privado) e um
 *   PUT `${BASE}/dashboards/<idNovo>?locationId=<loc>` com activityBuffer {} e
 *   themeConfig { dashboardTheme:{ themeName:"custom", backgroundColor:"#FFFFFF", titleColor:<escuro,
 *   contraste >= 7 no branco>, metricColor/baseColor/linkColor: <cor da marca> }, widgetTheme:{} }.
 *   A cor da marca vem de o.corMarca (CLI --cor-marca #RRGGBB); o padrão é "#1F7A3A" (verde, 5.4:1
 *   no branco). corMarca fora de #RRGGBB recusa com /#RRGGBB/ e abaixo de 4.5:1 no branco com
 *   /contraste/, as duas ANTES do POST (zero escritas). A prévia de criar cita o fundo branco.
 *   O `tema` segue trocando só o que vier.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "amdash-"));
process.env.AUTOMASTER_DUMPS = path.join(HOME, "dumps");
after(() => fs.rmSync(HOME, { recursive: true, force: true }));

const { criarPainel, salvarPainel, apagarPainel, restaurarVersao } = await import("../src/api/dashboards.js");
const { executarDashboardAcao } = await import("../src/cli/dashboards.js");
const { contraste } = await import("../src/api/dashboards-layout.js");

const R = "https://backend.leadconnectorhq.com/reporting";
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOC = "LOC1";
const ID = "PNL1";

interface Chamada { metodo: string; url: string; corpo?: unknown }

function detalheCru(extra: { isDefault?: boolean; v?: number; theme?: unknown } = {}) {
  const def = (id: string, t: string) => ({
    widgetId: id, title: t, chartType: "numeric", module: "crm-opportunities",
    options: { dateProperty: "date_added" }, apiConfig: { path: "/dashboards/widgets/crm/x" },
  });
  return { data: {
    dashboard: {
      _id: ID, title: "ZZ TESTE AUTOMASTER etapa 3", isDefault: extra.isDefault ?? false, isPrivate: true,
      __v: extra.v ?? 7,
      themeConfig: extra.theme ?? {
        titleColor: "#111111", backgroundColor: "#ffffff", baseColor: "#eeeeee", metricColor: "#222222",
        linkColor: "#0000ee", extra: "keep",
      },
    },
    dashboardWidgets: [
      { widgetId: "w1", layout: { x: 0, y: 0, w: 3, h: 4, minW: 3, minH: 4 } },
      { widgetId: "w2", layout: { x: 3, y: 0, w: 3, h: 4, minW: 3, minH: 4 } },
    ],
    widgets: [def("w1", "Leads"), def("w2", "Ganhos")],
  } };
}

/** Cliente falso que roteia as leituras e registra TODAS as chamadas, em ordem. */
function falso(extra: Parameters<typeof detalheCru>[0] = {}) {
  let v = extra.v ?? 7; // cada save sobe o __v em 1
  const chamadas: Chamada[] = [];
  const reg = (metodo: string, resposta: (url: string) => unknown) => (url: string, corpo?: unknown) => {
    chamadas.push({ metodo, url, corpo });
    return Promise.resolve(resposta(url));
  };
  const client = {
    getJson: reg("get", (u) => (u.includes("/versions") ? { data: { versions: [], drift: false, nextCursor: null } } : detalheCru({ ...extra, v }))),
    postJson: reg("post", () => ({ data: { _id: "NOVO1" } })),
    putJson: reg("put", () => { v += 1; return { data: { ok: true } }; }),
    deleteJson: reg("delete", () => ({ data: { ok: true } })),
  } as never;
  const escritas = () => chamadas.filter((c) => c.metodo !== "get");
  return { client, chamadas, escritas };
}

const base = { location: LOC, id: ID, confirmo: true, versaoEsperada: 7 };
const molde = {
  widgetId: "w1", title: "Leads", chartType: "numeric", module: "crm-opportunities",
  options: { dateProperty: "date_added" }, apiConfig: { path: "/dashboards/widgets/crm/x" },
};
const layoutBase = [
  { id: "w1", x: 0, y: 0, w: 3, h: 4 }, { id: "w2", x: 3, y: 0, w: 3, h: 4 },
];
const planoValido = {
  criar: [{ id: "novo1", titulo: "Perdidos (data de criação)", molde }],
  layout: [...layoutBase, { id: "novo1", x: 6, y: 0, w: 3, h: 4 }],
};
const plano = (p: unknown) => JSON.stringify(p);
/** Gerador determinístico de ObjectId (24 hex). */
function geraIds() {
  let n = 0;
  return () => `aaaaaaaaaaaaaaaaaaaa${(++n).toString(16).padStart(4, "0")}`;
}
/** executarDashboardAcao com o 4º parâmetro (gerador de ids), sem exigir o tipo antes de existir. */
const comIds = (client: unknown, o: object) =>
  (executarDashboardAcao as unknown as (...a: unknown[]) => Promise<Record<string, any>>)(client, o, undefined, geraIds());
const G1 = "aaaaaaaaaaaaaaaaaaaa0001";
const CAMPOS_WIDGET_NOVO = [
  "_id", "apiConfig", "chartType", "className", "deleted", "eventSource", "externalDataConfig", "extras",
  "group", "hasTrimmedFilters", "identifier", "locationId", "metricId", "module", "moduleName", "options",
  "savedOptionPairs", "title",
];
const moldeCompleto = {
  ...molde, deleted: false, _id: "x", hasTrimmedFilters: false, identifier: "i", className: "c", moduleName: "m",
  eventSource: "e", group: "g", savedOptionPairs: [], locationId: LOC, extras: {}, externalDataConfig: null, metricId: "mt",
  dashboardId: ID, createdBy: "u", __v: 3,
};

// ---------- os 4 verbos da API ----------

test("criarPainel: POST com corpo exato e SEMPRE privado", async () => {
  const { client, chamadas } = falso();
  await criarPainel(client, LOC, "ZZ TESTE AUTOMASTER x");
  assert.deepEqual(chamadas, [{
    metodo: "post", url: `${R}/dashboards`,
    corpo: { locationId: LOC, title: "ZZ TESTE AUTOMASTER x", isPrivate: true, permissionAccess: [] },
  }]);
});

test("criarPainel ignora tentativa de passar visibilidade por argumento extra", async () => {
  const { client, chamadas } = falso();
  await (criarPainel as (...a: unknown[]) => Promise<unknown>)(client, LOC, "t", { isPrivate: false });
  assert.equal((chamadas[0].corpo as { isPrivate: boolean }).isPrivate, true);
});

test("salvarPainel: PUT com locationId na query e as 5 chaves do corpo", async () => {
  const { client, chamadas } = falso();
  const corpo = {
    title: "t", activityBuffer: { create: [], update: [], delete: ["w2"] },
    layout: [{ id: "w1", x: 0, y: 0, w: 3, h: 4 }], themeConfig: { metricColor: "#000000" }, version: 7,
  };
  await salvarPainel(client, LOC, ID, corpo);
  assert.deepEqual(chamadas, [{ metodo: "put", url: `${R}/dashboards/${ID}?locationId=${LOC}`, corpo }]);
});

test("apagarPainel: DELETE sem query e com {locationId, version} no CORPO", async () => {
  const { client, chamadas } = falso();
  await apagarPainel(client, LOC, ID, 7);
  assert.deepEqual(chamadas, [{ metodo: "delete", url: `${R}/dashboards/${ID}`, corpo: { locationId: LOC, version: 7 } }]);
});

test("restaurarVersao: POST em versions/<v>/restore com locationId na query", async () => {
  const { client, chamadas } = falso();
  await restaurarVersao(client, LOC, ID, 3);
  assert.deepEqual(chamadas, [{ metodo: "post", url: `${R}/dashboards/${ID}/versions/3/restore?locationId=${LOC}`, corpo: {} }]);
});

// ---------- prévia: zero escritas ----------

for (const [acao, extra] of [
  ["criar", { titulo: "ZZ TESTE AUTOMASTER novo" }],
  ["renomear", { titulo: "outro nome" }],
  ["tema", { tema: '{"metricColor":"#003366"}' }],
  ["editar", { plano: plano(planoValido) }],
  ["apagar", {}],
  ["restaurar", { versao: 3 }],
] as const) {
  test(`${acao} sem --confirmo: zero escritas e devolve prévia`, async () => {
    const { client, escritas } = falso();
    const s = await executarDashboardAcao(client, { location: LOC, id: ID, acao, ...extra } as never);
    assert.deepEqual(escritas(), []);
    assert.equal(s.aplicado, false);
    assert.equal(typeof s.motivo, "string");
  });
}

test("prévia de editar traz painel atual, versão lida, mudanças, problemas e avisos", async () => {
  const { client } = falso();
  const s = await executarDashboardAcao(client, { location: LOC, id: ID, acao: "editar", plano: plano(planoValido) } as never);
  assert.equal(s.versao, 7);
  assert.equal(s.painel.id, ID);
  assert.equal(s.painel.titulo, "ZZ TESTE AUTOMASTER etapa 3");
  assert.equal(s.painel.isPrivate, true);
  assert.ok(Array.isArray(s.mudancas) && s.mudancas.length > 0);
  assert.deepEqual(s.problemas, []);
  assert.ok(Array.isArray(s.avisos));
});

test("prévia de editar lista os problemas de validarLayout (sobreposição) sem escrever", async () => {
  const { client, escritas } = falso();
  const ruim = { ...planoValido, layout: [...layoutBase, { id: "novo1", x: 0, y: 0, w: 3, h: 4 }] };
  const s = await executarDashboardAcao(client, { location: LOC, id: ID, acao: "editar", plano: plano(ruim) } as never);
  assert.ok(s.problemas.some((p: { codigo: string }) => p.codigo === "sobreposicao"));
  assert.deepEqual(escritas(), []);
});

test("prévia de editar lista os avisos de validarComposicao (donut sem limite de fatias)", async () => {
  const { client } = falso();
  const donut = {
    criar: [{ id: "d1", titulo: "Por origem", molde: { ...molde, chartType: "donut" } }],
    layout: [...layoutBase, { id: "d1", x: 6, y: 0, w: 4, h: 6 }],
  };
  const s = await executarDashboardAcao(client, { location: LOC, id: ID, acao: "editar", plano: plano(donut) } as never);
  assert.ok(s.avisos.some((a: { codigo: string }) => a.codigo === "donut_com_fatias_demais"), JSON.stringify(s.avisos));
});

// ---------- editar ----------

test("editar com widget novo: 2 PUTs. 1º cria (ObjectId gerado, corpo do molde); 2º posiciona com o layout completo", async () => {
  const { client, escritas } = falso();
  const s = await comIds(client, { ...base, acao: "editar", plano: plano(planoValido) });
  const e = escritas();
  assert.equal(e.length, 2);
  for (const c of e) {
    assert.equal(c.metodo, "put");
    assert.equal(c.url, `${R}/dashboards/${ID}?locationId=${LOC}`);
    assert.deepEqual(Object.keys(c.corpo as object).sort(), ["activityBuffer", "layout", "themeConfig", "title", "version"]);
  }
  const p1 = e[0].corpo as Record<string, any>;
  assert.equal(p1.version, 7);
  assert.equal(p1.activityBuffer.create.length, 1);
  assert.deepEqual(Object.keys(p1.activityBuffer.create[0]), [G1]);
  const novo = p1.activityBuffer.create[0][G1];
  assert.deepEqual(Object.keys(novo).sort(), CAMPOS_WIDGET_NOVO);
  assert.equal(novo._id, G1);
  assert.equal(novo.deleted, false);
  assert.equal(novo.chartType, "numeric");
  assert.equal(novo.module, "crm-opportunities");
  assert.equal(novo.title, "Perdidos (data de criação)");
  assert.ok(!("dashboardId" in novo) && !("createdBy" in novo) && !("__v" in novo));
  assert.ok(!(p1.activityBuffer.update?.length) && !(p1.activityBuffer.delete?.length));
  const p2 = e[1].corpo as Record<string, any>;
  assert.equal(p2.version, 8); // o 1º save subiu o __v
  assert.deepEqual(p2.activityBuffer, {});
  assert.equal(p2.title, "ZZ TESTE AUTOMASTER etapa 3");
  assert.deepEqual(p2.layout, [
    { id: "w1", x: 0, y: 0, w: 3, h: 4, minW: 3, minH: 4 },
    { id: "w2", x: 3, y: 0, w: 3, h: 4, minW: 3, minH: 4 },
    { id: G1, x: 6, y: 0, w: 3, h: 4, minW: 3, minH: 4 }, // minW/minH do tipo numeric (molde sem layout)
  ]);
  assert.equal(s.aplicado, true);
});

test("item novo do layout herda minW/minH de molde.layout quando o molde tem", async () => {
  const { client, escritas } = falso();
  const p = {
    criar: [{ id: "n", titulo: "t", molde: { ...moldeCompleto, layout: { x: 0, y: 0, w: 4, h: 5, minW: 4, minH: 5 } } }],
    layout: [...layoutBase, { id: "n", x: 6, y: 0, w: 4, h: 5 }],
  };
  await comIds(client, { ...base, acao: "editar", plano: plano(p) });
  const lay = (escritas()[1].corpo as { layout: Record<string, unknown>[] }).layout;
  assert.deepEqual(lay.find((i) => i.id === G1), { id: G1, x: 6, y: 0, w: 4, h: 5, minW: 4, minH: 5 });
});

test("item novo sem layout no molde usa os mínimos do tipo (table 6x6)", async () => {
  const { client, escritas } = falso();
  const p = {
    criar: [{ id: "n", titulo: "t", molde: { ...moldeCompleto, chartType: "table" } }],
    layout: [...layoutBase, { id: "n", x: 0, y: 4, w: 6, h: 6 }],
  };
  await comIds(client, { ...base, acao: "editar", plano: plano(p) });
  const lay = (escritas()[1].corpo as { layout: Record<string, unknown>[] }).layout;
  assert.deepEqual(lay.find((i) => i.id === G1), { id: G1, x: 0, y: 4, w: 6, h: 6, minW: 6, minH: 6 });
});

test("o ObjectId do widget novo tem 24 hex também com o gerador padrão", async () => {
  const { client, escritas } = falso();
  await executarDashboardAcao(client, { ...base, acao: "editar", plano: plano(planoValido) } as never);
  const [chave] = Object.keys((escritas()[0].corpo as any).activityBuffer.create[0]);
  assert.match(chave, /^[0-9a-f]{24}$/);
});

test("editar remover: 1 PUT, o id vai em activityBuffer.delete e sai do layout", async () => {
  const { client, escritas } = falso();
  await executarDashboardAcao(client, { ...base, acao: "editar", plano: plano({ remover: ["w2"], layout: [layoutBase[0]] }) } as never);
  assert.equal(escritas().length, 1);
  const c = escritas()[0].corpo as Record<string, any>;
  assert.deepEqual(c.activityBuffer.delete, ["w2"]);
  assert.deepEqual(c.layout, [{ id: "w1", x: 0, y: 0, w: 3, h: 4, minW: 3, minH: 4 }]);
});

test("editar atualizar: o widget vai em activityBuffer.update[{widgetId: widget}]", async () => {
  const { client, escritas } = falso();
  await executarDashboardAcao(client, {
    ...base, acao: "editar",
    plano: plano({ atualizar: [{ widgetId: "w1", title: "Leads do mês" }], layout: layoutBase }),
  } as never);
  assert.equal(escritas().length, 1);
  const c = escritas()[0].corpo as Record<string, any>;
  assert.equal(c.activityBuffer.update.length, 1);
  assert.equal(c.activityBuffer.update[0].w1.title, "Leads do mês");
});

test("editar aceita --plano como caminho de arquivo", async () => {
  const { client, escritas } = falso();
  const arq = path.join(HOME, "plano.json");
  fs.writeFileSync(arq, plano(planoValido));
  await executarDashboardAcao(client, { ...base, acao: "editar", plano: arq } as never);
  assert.equal(escritas().length, 2); // widget novo: 1º PUT cria, 2º posiciona
});

test("widget novo sem molde erra mandando copiar um widget do mesmo tipo", async () => {
  const { client, escritas } = falso();
  const semMolde = { criar: [{ id: "n1", titulo: "x" }], layout: [...layoutBase, { id: "n1", x: 6, y: 0, w: 3, h: 4 }] };
  for (const confirmo of [false, true]) {
    await assert.rejects(
      executarDashboardAcao(falso().client, { ...base, confirmo, acao: "editar", plano: plano(semMolde) } as never),
      /molde[\s\S]*-o detalhe/,
    );
  }
  assert.deepEqual(escritas(), []);
  void client;
});

test("layout inválido com confirmo recusa sem gravar e lista o problema", async () => {
  const { client, escritas } = falso();
  const ruim = { ...planoValido, layout: [...layoutBase, { id: "novo1", x: 0, y: 0, w: 3, h: 4 }] };
  await assert.rejects(executarDashboardAcao(client, { ...base, acao: "editar", plano: plano(ruim) } as never), /sobrepõem/);
  assert.deepEqual(escritas(), []);
});

test("layout fora da grade também recusa sem gravar", async () => {
  const { client, escritas } = falso();
  const ruim = { ...planoValido, layout: [...layoutBase, { id: "novo1", x: 10, y: 0, w: 3, h: 4 }] };
  await assert.rejects(executarDashboardAcao(client, { ...base, acao: "editar", plano: plano(ruim) } as never), /grade/);
  assert.deepEqual(escritas(), []);
});

// ---------- versão esperada ----------

test("com confirmo e sem --versao-esperada recusa sem gravar", async () => {
  const { client, escritas } = falso();
  await assert.rejects(
    executarDashboardAcao(client, { location: LOC, id: ID, confirmo: true, acao: "renomear", titulo: "n" } as never),
    /--versao-esperada/,
  );
  assert.deepEqual(escritas(), []);
});

test("versão lida diferente da esperada recusa com 'o painel mudou desde a prévia', em todas as ações de escrita", async () => {
  for (const [acao, extra] of [
    ["renomear", { titulo: "n" }], ["tema", { tema: '{"metricColor":"#003366"}' }],
    ["editar", { plano: plano(planoValido) }], ["apagar", {}], ["restaurar", { versao: 3 }],
  ] as const) {
    const { client, escritas } = falso({ v: 9 }); // servidor já está na 9; a prévia mostrou 7
    await assert.rejects(executarDashboardAcao(client, { ...base, acao, ...extra } as never), /o painel mudou desde a prévia/, acao);
    assert.deepEqual(escritas(), [], acao);
  }
});

test("versaoEsperada vinda como texto da CLI ('7') também confere com o __v 7", async () => {
  const { client, escritas } = falso();
  await executarDashboardAcao(client, { ...base, versaoEsperada: "7", acao: "renomear", titulo: "n" } as never);
  assert.equal(escritas().length, 1);
});

// ---------- isDefault ----------

test("apagar e editar recusam painel isDefault, com ou sem --confirmo", async () => {
  for (const [acao, extra] of [["apagar", {}], ["editar", { plano: plano(planoValido) }]] as const) {
    for (const confirmo of [false, true]) {
      const { client, escritas } = falso({ isDefault: true });
      await assert.rejects(
        executarDashboardAcao(client, { ...base, confirmo, acao, ...extra } as never),
        /é o painel padrão da subconta/, `${acao} confirmo=${confirmo}`,
      );
      assert.deepEqual(escritas(), []);
    }
  }
});

// ---------- tema ----------

test("tema (GET plano): PUT aninhado { dashboardTheme, widgetTheme:{} }, mescla e mantém chaves extras", async () => {
  const { client, escritas } = falso();
  await executarDashboardAcao(client, { ...base, acao: "tema", tema: '{"metricColor":"#003366"}' } as never);
  assert.equal(escritas().length, 1);
  const c = escritas()[0].corpo as Record<string, any>;
  assert.deepEqual(c.themeConfig, {
    dashboardTheme: {
      titleColor: "#111111", backgroundColor: "#ffffff", baseColor: "#eeeeee", metricColor: "#003366",
      linkColor: "#0000ee", extra: "keep",
    },
    widgetTheme: {},
  });
  assert.equal(c.title, "ZZ TESTE AUTOMASTER etapa 3");
  assert.equal(c.version, 7);
  assert.deepEqual(c.activityBuffer, {});
  assert.equal(c.layout.length, 2);
  assert.equal(c.layout[0].minW, 3);
});

test("tema (GET já aninhado): preserva widgetTheme e chaves extras, sem aninhar duas vezes", async () => {
  const { client, escritas } = falso({ theme: {
    dashboardTheme: { titleColor: "#111111", backgroundColor: "#ffffff", baseColor: "#eeeeee", metricColor: "#222222", linkColor: "#0000ee", extra: "keep" },
    widgetTheme: { raio: 8 },
  } });
  await executarDashboardAcao(client, { ...base, acao: "tema", tema: '{"linkColor":"#003366"}' } as never);
  const c = escritas()[0].corpo as Record<string, any>;
  assert.equal(c.themeConfig.dashboardTheme.linkColor, "#003366");
  assert.equal(c.themeConfig.dashboardTheme.extra, "keep");
  assert.deepEqual(c.themeConfig.widgetTheme, { raio: 8 });
  assert.ok(!("dashboardTheme" in c.themeConfig.dashboardTheme));
});

test("tema recusa cor fora de #RRGGBB", async () => {
  for (const ruim of ["#fff", "003366", "red", "#12345g", "#1234567"]) {
    const { client, escritas } = falso();
    await assert.rejects(
      executarDashboardAcao(client, { ...base, acao: "tema", tema: JSON.stringify({ linkColor: ruim }) } as never),
      /#RRGGBB/, ruim,
    );
    assert.deepEqual(escritas(), []);
  }
});

test("tema recusa contraste < 4.5 de metricColor e de titleColor contra backgroundColor", async () => {
  for (const chave of ["metricColor", "titleColor"]) {
    for (const cor of ["#cccccc", "#949494"]) { // 1.6:1 e ~3.0:1 sobre branco
      const { client, escritas } = falso();
      await assert.rejects(
        executarDashboardAcao(client, { ...base, acao: "tema", tema: JSON.stringify({ [chave]: cor }) } as never),
        /contraste/, `${chave} ${cor}`,
      );
      assert.deepEqual(escritas(), []);
    }
  }
});

test("tema aceita contraste logo acima de 4.5 (#767676 sobre branco = 4.54)", async () => {
  const { client, escritas } = falso();
  await executarDashboardAcao(client, { ...base, acao: "tema", tema: '{"metricColor":"#767676","titleColor":"#767676"}' } as never);
  assert.equal(escritas().length, 1);
});

test("tema aceita themeName (não é cor) e ainda recusa cor fora do formato", async () => {
  const { client, escritas } = falso();
  await executarDashboardAcao(client, { ...base, acao: "tema", tema: '{"themeName":"custom","metricColor":"#767676"}' } as never);
  assert.equal(escritas().length, 1);
  await assert.rejects(executarDashboardAcao(client, { ...base, acao: "tema", tema: '{"themeName":"custom","metricColor":"red"}' } as never));
});

test("tema confere contra o fundo MESCLADO: trocar só o fundo para preto reprova metricColor escuro", async () => {
  const { client, escritas } = falso();
  await assert.rejects(
    executarDashboardAcao(client, { ...base, acao: "tema", tema: '{"backgroundColor":"#000000"}' } as never),
    /contraste/,
  );
  assert.deepEqual(escritas(), []);
});

// ---------- renomear / apagar / restaurar / criar ----------

test("renomear: 1 PUT só troca o título; preserva layout, tema aninhado, version e activityBuffer {}", async () => {
  const { client, escritas } = falso();
  await executarDashboardAcao(client, { ...base, acao: "renomear", titulo: "ZZ TESTE AUTOMASTER novo nome" } as never);
  assert.equal(escritas().length, 1);
  const c = escritas()[0].corpo as Record<string, any>;
  assert.equal(c.title, "ZZ TESTE AUTOMASTER novo nome");
  assert.equal(c.version, 7);
  assert.equal(c.themeConfig.dashboardTheme.extra, "keep");
  assert.deepEqual(c.themeConfig.widgetTheme, {});
  assert.deepEqual(c.activityBuffer, {});
  assert.equal(c.layout.length, 2);
});

test("apagar com confirmo: um DELETE com a versão lida no corpo", async () => {
  const { client, escritas } = falso();
  await executarDashboardAcao(client, { ...base, acao: "apagar" } as never);
  assert.deepEqual(escritas(), [{ metodo: "delete", url: `${R}/dashboards/${ID}`, corpo: { locationId: LOC, version: 7 } }]);
});

test("restaurar com confirmo: um POST na versão pedida", async () => {
  const { client, escritas } = falso();
  await executarDashboardAcao(client, { ...base, acao: "restaurar", versao: 3 } as never);
  assert.deepEqual(escritas().map((c) => [c.metodo, c.url]), [["post", `${R}/dashboards/${ID}/versions/3/restore?locationId=${LOC}`]]);
});

test("criar com confirmo: o POST é privado, sem exigir --versao-esperada nem id; depois só o PUT do tema", async () => {
  const { client, escritas } = falso();
  const s = await executarDashboardAcao(client, {
    location: LOC, confirmo: true, acao: "criar", titulo: "ZZ TESTE AUTOMASTER etapa 3", publico: true, isPrivate: false,
  } as never);
  const e = escritas();
  assert.equal(e.length, 2); // etapa 11: POST cria, PUT aplica o tema branco
  assert.deepEqual(e[0], {
    metodo: "post", url: `${R}/dashboards`,
    corpo: { locationId: LOC, title: "ZZ TESTE AUTOMASTER etapa 3", isPrivate: true, permissionAccess: [] },
  });
  assert.equal(e[1].metodo, "put");
  assert.ok(!("isPrivate" in (e[1].corpo as object)) && !("permissionAccess" in (e[1].corpo as object)));
  assert.equal(s.aplicado, true);
});

// ---------- etapa 11: tema padrão branco ao criar ----------

const criarCom = (extra: object = {}) => {
  const f = falso();
  const r = executarDashboardAcao(f.client, { location: LOC, confirmo: true, acao: "criar", titulo: "ZZ novo", ...extra } as never);
  return { ...f, r };
};

test("criar: o 2º PUT vai no painel novo, com activityBuffer {} e tema branco aninhado", async () => {
  const { escritas, r } = criarCom();
  await r;
  const put = escritas()[1];
  assert.equal(put.url, `${R}/dashboards/NOVO1?locationId=${LOC}`);
  const c = put.corpo as Record<string, any>;
  assert.deepEqual(c.activityBuffer, {});
  assert.equal(typeof c.version, "number");
  assert.equal(c.title, "ZZ novo");
  assert.deepEqual(c.themeConfig.widgetTheme, {});
  const t = c.themeConfig.dashboardTheme;
  assert.equal(t.themeName, "custom");
  assert.equal(String(t.backgroundColor).toUpperCase(), "#FFFFFF");
  assert.ok(!("dashboardTheme" in t), "aninhado uma vez só");
});

test("criar: título escuro (contraste >= 7) e a cor da marca padrão legível no branco em números, linhas e links", async () => {
  const { escritas, r } = criarCom();
  await r;
  const t = (escritas()[1].corpo as Record<string, any>).themeConfig.dashboardTheme;
  const HEX6 = /^#[0-9a-fA-F]{6}$/;
  assert.match(t.titleColor, HEX6);
  assert.ok(contraste(t.titleColor, "#FFFFFF") >= 7, t.titleColor);
  assert.equal(t.metricColor.toUpperCase(), "#1F7A3A");
  assert.equal(t.baseColor, t.metricColor);
  assert.equal(t.linkColor, t.metricColor);
  assert.ok(contraste(t.metricColor, "#FFFFFF") >= 4.5);
});

test("criar --cor-marca: a cor pedida vai em metricColor, baseColor e linkColor; fundo segue branco", async () => {
  const { escritas, r } = criarCom({ corMarca: "#003366" });
  await r;
  const t = (escritas()[1].corpo as Record<string, any>).themeConfig.dashboardTheme;
  assert.deepEqual([t.metricColor, t.baseColor, t.linkColor].map((x: string) => x.toUpperCase()), ["#003366", "#003366", "#003366"]);
  assert.equal(String(t.backgroundColor).toUpperCase(), "#FFFFFF");
});

test("criar --cor-marca fora de #RRGGBB recusa antes do POST", async () => {
  for (const ruim of ["#fff", "verde", "#12345g"]) {
    const { escritas, r } = criarCom({ corMarca: ruim });
    await assert.rejects(r, /#RRGGBB/, ruim);
    assert.deepEqual(escritas(), [], ruim);
  }
});

test("criar --cor-marca com contraste < 4.5 no branco recusa antes do POST (o verde #b5ff81 da ZOI)", async () => {
  const { escritas, r } = criarCom({ corMarca: "#b5ff81" });
  await assert.rejects(r, /contraste/);
  assert.deepEqual(escritas(), []);
});

test("criar sem --confirmo: prévia cita o fundo branco e não escreve", async () => {
  const { client, escritas } = falso();
  const s = await executarDashboardAcao(client, { location: LOC, acao: "criar", titulo: "ZZ novo" } as never);
  assert.deepEqual(escritas(), []);
  assert.match(s.mudancas.join(" | "), /#FFFFFF|branco/i);
});

test("`dashboard-acao --help` lista --cor-marca", () => {
  const r = spawnSync("npx", ["tsx", "src/cli.ts", "dashboard-acao", "--help"], { cwd: RAIZ, encoding: "utf-8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /--cor-marca/);
});

test("criar sem --titulo erra antes de qualquer escrita", async () => {
  const { client, escritas } = falso();
  await assert.rejects(executarDashboardAcao(client, { location: LOC, confirmo: true, acao: "criar" } as never), /--titulo/);
  assert.deepEqual(escritas(), []);
});

test("--acao desconhecida erra sem escrever", async () => {
  const { client, escritas } = falso();
  await assert.rejects(executarDashboardAcao(client, { ...base, acao: "publicar" } as never));
  assert.deepEqual(escritas(), []);
});

// ---------- versions antes, rastro depois ----------

test("toda gravação lê GET .../versions ANTES da escrita e deixa rastro em _dashboards com a versão anterior", async () => {
  for (const [acao, extra] of [
    ["renomear", { titulo: "n" }], ["tema", { tema: '{"metricColor":"#003366"}' }],
    ["editar", { plano: plano(planoValido) }], ["apagar", {}], ["restaurar", { versao: 3 }],
  ] as const) {
    const { client, chamadas } = falso();
    const s = await executarDashboardAcao(client, { ...base, acao, ...extra } as never);
    const iVersoes = chamadas.findIndex((c) => c.metodo === "get" && c.url === `${R}/dashboards/${ID}/versions?locationId=${LOC}`);
    const iEscrita = chamadas.findIndex((c) => c.metodo !== "get");
    assert.ok(iVersoes >= 0 && iVersoes < iEscrita, `${acao}: versions deve ser lido antes de escrever`);
    assert.equal(typeof s.registro, "string", acao);
    assert.ok(s.registro.startsWith(path.join(process.env.AUTOMASTER_DUMPS!, "_dashboards", LOC, ID)), s.registro);
    const r = JSON.parse(fs.readFileSync(s.registro, "utf8"));
    assert.equal(r.acao, acao);
    assert.equal(r.versao, 7, `${acao}: o rastro guarda a versão anterior (__v lido)`);
  }
});

test("prévia não deixa rastro nem lê versions", async () => {
  const { client, chamadas } = falso();
  const s = await executarDashboardAcao(client, { location: LOC, id: ID, acao: "renomear", titulo: "n" } as never);
  assert.equal(s.registro, undefined);
  assert.ok(!chamadas.some((c) => c.url.includes("/versions")));
});

// ---------- CLI ----------

test("`dashboard-acao --help` lista as ações e NÃO tem opção de painel público", () => {
  const r = spawnSync("npx", ["tsx", "src/cli.ts", "dashboard-acao", "--help"], { cwd: RAIZ, encoding: "utf-8" });
  assert.equal(r.status, 0, r.stderr);
  for (const a of ["criar", "editar", "tema", "renomear", "apagar", "restaurar"]) assert.match(r.stdout, new RegExp(a));
  for (const o of ["--confirmo", "--versao-esperada", "--plano", "--tema"]) assert.match(r.stdout, new RegExp(o));
  // "publicar" é uma ação (papéis), não visibilidade: só pode aparecer como valor de --acao
  assert.doesNotMatch(r.stdout, /--publ|--public|--shared|--compartilh|--private|--privado|--visib/i);
  for (const flag of ["--publico", "--public", "--privado", "--private"]) {
    const x = spawnSync("npx", ["tsx", "src/cli.ts", "dashboard-acao", "-l", LOC, "--acao", "criar", "--titulo", "t", flag, "--json"], { cwd: RAIZ, encoding: "utf-8" });
    assert.notEqual(x.status, 0, `${flag} deveria ser recusado pelo parser`);
    assert.match(x.stderr, /unknown option/i, flag);
  }
});

test("dashboard-acao apagar sem -i falha antes de pedir token (saída 1)", () => {
  const r = spawnSync("npx", ["tsx", "src/cli.ts", "dashboard-acao", "-l", LOC, "--acao", "apagar", "--json"], { cwd: RAIZ, encoding: "utf-8" });
  assert.equal(r.status, 1);
  assert.equal(JSON.parse(r.stdout).ok, false);
});
