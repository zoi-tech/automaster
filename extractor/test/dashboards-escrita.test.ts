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
 *   plano (editar) = { criar:[{id, titulo?, options?, molde:<widget cru de outro painel>}], atualizar:[{widgetId, ...}],
 *     remover:[widgetId], layout:[{id,x,y,w,h}] } — layout lista a posição final de cada widget.
 *     PUT.layout = o layout final, itens {id,x,y,w,h}; PUT.activityBuffer.create[0][<id>] herda chartType
 *     e module do molde.
 *   Mensagens de recusa (regex): sem molde /molde.*-o detalhe/s; padrão /é o painel padrão da subconta/;
 *     sem versão /--versao-esperada/; divergência /o painel mudou desde a prévia/; layout /sobrepõem/
 *     (a mensagem lista cada problema); cor /#RRGGBB/; contraste /contraste/.
 *   O comando `dashboard-acao` (--help) não tem opção de painel público/compartilhado.
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
  const chamadas: Chamada[] = [];
  const reg = (metodo: string, resposta: (url: string) => unknown) => (url: string, corpo?: unknown) => {
    chamadas.push({ metodo, url, corpo });
    return Promise.resolve(resposta(url));
  };
  const client = {
    getJson: reg("get", (u) => (u.includes("/versions") ? { data: { versions: [], drift: false, nextCursor: null } } : detalheCru(extra))),
    postJson: reg("post", () => ({ data: { _id: "NOVO1" } })),
    putJson: reg("put", () => ({ data: { ok: true } })),
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
  ["criar", { id: undefined, titulo: "ZZ TESTE AUTOMASTER novo" }],
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

test("editar com confirmo: 1 PUT com activityBuffer.create herdando o molde, layout final e version", async () => {
  const { client, escritas } = falso();
  const s = await executarDashboardAcao(client, { ...base, acao: "editar", plano: plano(planoValido) } as never);
  const e = escritas();
  assert.equal(e.length, 1);
  assert.equal(e[0].metodo, "put");
  assert.equal(e[0].url, `${R}/dashboards/${ID}?locationId=${LOC}`);
  const c = e[0].corpo as Record<string, any>;
  assert.deepEqual(Object.keys(c).sort(), ["activityBuffer", "layout", "themeConfig", "title", "version"]);
  assert.equal(c.version, 7);
  assert.equal(c.title, "ZZ TESTE AUTOMASTER etapa 3");
  assert.equal(c.activityBuffer.create.length, 1);
  const novo = c.activityBuffer.create[0].novo1;
  assert.equal(novo.chartType, "numeric");
  assert.equal(novo.module, "crm-opportunities");
  assert.deepEqual(c.activityBuffer.update, []);
  assert.deepEqual(c.activityBuffer.delete, []);
  assert.deepEqual(c.layout.map((i: { id: string }) => i.id).sort(), ["novo1", "w1", "w2"]);
  assert.deepEqual(c.layout.find((i: { id: string }) => i.id === "novo1"), { id: "novo1", x: 6, y: 0, w: 3, h: 4 });
  assert.equal(s.aplicado, true);
});

test("editar remover: o id vai em activityBuffer.delete", async () => {
  const { client, escritas } = falso();
  await executarDashboardAcao(client, { ...base, acao: "editar", plano: plano({ remover: ["w2"], layout: [layoutBase[0]] }) } as never);
  const c = escritas()[0].corpo as Record<string, any>;
  assert.deepEqual(c.activityBuffer.delete, ["w2"]);
  assert.deepEqual(c.layout.map((i: { id: string }) => i.id), ["w1"]);
});

test("editar atualizar: o widget vai em activityBuffer.update[{widgetId: widget}]", async () => {
  const { client, escritas } = falso();
  await executarDashboardAcao(client, {
    ...base, acao: "editar",
    plano: plano({ atualizar: [{ widgetId: "w1", title: "Leads do mês" }], layout: layoutBase }),
  } as never);
  const c = escritas()[0].corpo as Record<string, any>;
  assert.equal(c.activityBuffer.update.length, 1);
  assert.equal(c.activityBuffer.update[0].w1.title, "Leads do mês");
});

test("editar aceita --plano como caminho de arquivo", async () => {
  const { client, escritas } = falso();
  const arq = path.join(HOME, "plano.json");
  fs.writeFileSync(arq, plano(planoValido));
  await executarDashboardAcao(client, { ...base, acao: "editar", plano: arq } as never);
  assert.equal(escritas().length, 1);
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

test("tema: PUT mescla no themeConfig atual (mantém chaves que não vieram) e não mexe no título", async () => {
  const { client, escritas } = falso();
  await executarDashboardAcao(client, { ...base, acao: "tema", tema: '{"metricColor":"#003366"}' } as never);
  const c = escritas()[0].corpo as Record<string, any>;
  assert.equal(c.themeConfig.metricColor, "#003366");
  assert.equal(c.themeConfig.extra, "keep");
  assert.equal(c.themeConfig.titleColor, "#111111");
  assert.equal(c.title, "ZZ TESTE AUTOMASTER etapa 3");
  assert.deepEqual(c.activityBuffer, { create: [], update: [], delete: [] });
  assert.equal(c.layout.length, 2);
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

test("tema confere contra o fundo MESCLADO: trocar só o fundo para preto reprova metricColor escuro", async () => {
  const { client, escritas } = falso();
  await assert.rejects(
    executarDashboardAcao(client, { ...base, acao: "tema", tema: '{"backgroundColor":"#000000"}' } as never),
    /contraste/,
  );
  assert.deepEqual(escritas(), []);
});

// ---------- renomear / apagar / restaurar / criar ----------

test("renomear: PUT só troca o título, preserva layout, tema e version", async () => {
  const { client, escritas } = falso();
  await executarDashboardAcao(client, { ...base, acao: "renomear", titulo: "ZZ TESTE AUTOMASTER novo nome" } as never);
  const c = escritas()[0].corpo as Record<string, any>;
  assert.equal(c.title, "ZZ TESTE AUTOMASTER novo nome");
  assert.equal(c.version, 7);
  assert.equal(c.themeConfig.extra, "keep");
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

test("criar com confirmo: um POST privado, sem exigir --versao-esperada nem id", async () => {
  const { client, escritas } = falso();
  const s = await executarDashboardAcao(client, {
    location: LOC, confirmo: true, acao: "criar", titulo: "ZZ TESTE AUTOMASTER etapa 3", publico: true, isPrivate: false,
  } as never);
  assert.deepEqual(escritas(), [{
    metodo: "post", url: `${R}/dashboards`,
    corpo: { locationId: LOC, title: "ZZ TESTE AUTOMASTER etapa 3", isPrivate: true, permissionAccess: [] },
  }]);
  assert.equal(s.aplicado, true);
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
  assert.doesNotMatch(r.stdout, /p[úu]blic|compartilh|--private|--privado/i);
});

test("dashboard-acao apagar sem -i falha antes de pedir token (saída 1)", () => {
  const r = spawnSync("npx", ["tsx", "src/cli.ts", "dashboard-acao", "-l", LOC, "--acao", "apagar", "--json"], { cwd: RAIZ, encoding: "utf-8" });
  assert.equal(r.status, 1);
  assert.equal(JSON.parse(r.stdout).ok, false);
});
