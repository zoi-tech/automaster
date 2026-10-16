/**
 * Etapa 8 do plano de dashboards: ação `publicar` do `dashboard-acao`. Contrato que o implementador cumpre.
 *
 * src/api/dashboards.ts
 *   publicarPainel(client, loc, id, papeis): POST `${BASE}/dashboards/<id>/permissions` (a query, se a prova
 *     ao vivo exigir, é livre: o teste só confere o prefixo). Corpo (CONFIRMADO ao vivo: a chave é `permission`, valores read|write;
 *     com `access` o servidor responde 422):
 *       { locationId: loc, isPrivate: false, permissionAccess: [{ role: "account_admin", permission: "read" }, ...] }
 *     Só os papéis pedidos entram. A rota veio do bundle (pesquisa A1); a forma do corpo veio da prova ao vivo.
 *
 * src/cli/dashboards.ts
 *   executarDashboardAcao(client, o, log?) com o.acao === "publicar" e dois campos novos em `o`:
 *     papeis?: string   "account_admin:read,account_user:read" (papel:acesso, separados por vírgula)
 *     forcar?: boolean  --forcar: publica mesmo com o último conferir divergente
 *   Papéis aceitos: account_admin, account_user; acessos aceitos: read, write. Qualquer outro -> recusa /papel/.
 *   Fluxo (mesmo molde das outras ações): lê detalhePainel; sem confirmo devolve a prévia sem escrever; com
 *   confirmo exige versaoEsperada (/--versao-esperada/) e confere com o __v (/o painel mudou desde a prévia/).
 *   Prévia: { acao:"publicar", aplicado:false, mudancas:[texto que cita cada papel], problemas:[...] }.
 *   Gravação: { aplicado:true, registro } e registroEscrita(loc, "_dashboards", id, { acao:"publicar", papeis, ... }).
 *
 *   Guarda do conferir: o comando `dashboard-conferir` passa a deixar rastro em
 *   `<AUTOMASTER_DUMPS>/_dashboards/<loc>/<id>/<carimbo>.json` com { em:<ISO>, acao:"conferir",
 *   resumo:{bate,diverge,sem_conferencia} }. O "último conferir" é o de maior `em` entre os arquivos com
 *   acao === "conferir" daquele painel (rastros de outras ações não contam). resumo.diverge > 0 => recusa
 *   /diverge/ sem escrever (a prévia lista o mesmo texto em `problemas`), a menos que forcar. Sem nenhum
 *   conferir, ou com o último limpo, publica.
 */
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "amdash-pub-"));
process.env.AUTOMASTER_DUMPS = path.join(HOME, "dumps");
after(() => fs.rmSync(HOME, { recursive: true, force: true }));

const { executarDashboardAcao } = await import("../src/cli/dashboards.js");

const R = "https://backend.leadconnectorhq.com/reporting";
const LOC = "LOC1";
const ID = "PNL1";
const RASTRO = path.join(HOME, "dumps", "_dashboards", LOC);

interface Chamada { metodo: string; url: string; corpo?: unknown }

function detalhe(v = 7) {
  const def = (id: string, t: string) => ({
    widgetId: id, title: t, chartType: "numeric", module: "crm-opportunities",
    options: { dateProperty: "date_added" }, apiConfig: { path: "/dashboards/widgets/crm/x" },
  });
  return { data: {
    dashboard: { _id: ID, title: "ZZ TESTE AUTOMASTER etapa 8", isDefault: false, isPrivate: true, __v: v,
      themeConfig: { titleColor: "#111111", backgroundColor: "#ffffff", baseColor: "#eeeeee", metricColor: "#222222", linkColor: "#0000ee" } },
    dashboardWidgets: [{ widgetId: "w1", layout: { x: 0, y: 0, w: 3, h: 4, minW: 3, minH: 4 } }],
    widgets: [def("w1", "Leads")],
  } };
}

function falso() {
  const chamadas: Chamada[] = [];
  const reg = (metodo: string, resposta: (url: string) => unknown) => (url: string, corpo?: unknown) => {
    chamadas.push({ metodo, url, corpo });
    return Promise.resolve(resposta(url));
  };
  const client = {
    getJson: reg("get", (u) => (u.includes("/versions") ? { data: { versions: [], drift: false, nextCursor: null } } : detalhe())),
    postJson: reg("post", () => ({ data: { ok: true } })),
    putJson: reg("put", () => ({ data: { ok: true } })),
    deleteJson: reg("delete", () => ({ data: { ok: true } })),
  } as never;
  return { client, chamadas, escritas: () => chamadas.filter((c) => c.metodo !== "get") };
}

/** Corpo confirmado ao vivo: um item { role, permission } por papel pedido. */
const acessoDe = (role: string, permission: string) => ({ role, permission });
const PAPEIS = "account_admin:read,account_user:read";
const base = { location: LOC, id: ID, acao: "publicar", papeis: PAPEIS, versaoEsperada: 7 };
const pub = (client: unknown, o: object) =>
  (executarDashboardAcao as unknown as (...a: unknown[]) => Promise<Record<string, any>>)(client, { ...base, ...o });

/** Planta um rastro de conferir no painel (ou em outro). `dia` ordena: maior = mais novo. */
function conferir(dia: number, diverge: number, opts: { id?: string; acao?: string } = {}) {
  const dir = path.join(RASTRO, opts.id ?? ID);
  fs.mkdirSync(dir, { recursive: true });
  const em = new Date(Date.UTC(2026, 9, dia, 12)).toISOString();
  fs.writeFileSync(path.join(dir, `202610${String(dia).padStart(2, "0")}-1200.json`),
    JSON.stringify({ em, acao: opts.acao ?? "conferir", resumo: { bate: 3, diverge, sem_conferencia: 0 } }));
}

beforeEach(() => fs.rmSync(RASTRO, { recursive: true, force: true }));

test("sem --confirmo: zero escritas e a prévia mostra quem passa a ver", async () => {
  const { client, escritas } = falso();
  const r = await pub(client, {});
  assert.equal(escritas().length, 0);
  assert.equal(r.aplicado, false);
  assert.equal(r.acao, "publicar");
  const texto = JSON.stringify(r.mudancas);
  assert.match(texto, /account_admin/);
  assert.match(texto, /account_user/);
});

test("com --confirmo: um POST em permissions, isPrivate false e só os papéis pedidos", async () => {
  const { client, escritas } = falso();
  const r = await pub(client, { confirmo: true });
  const e = escritas();
  assert.equal(e.length, 1);
  assert.equal(e[0].metodo, "post");
  assert.ok(e[0].url.startsWith(`${R}/dashboards/${ID}/permissions`), e[0].url);
  assert.deepEqual(e[0].corpo, {
    locationId: LOC, isPrivate: false,
    permissionAccess: [acessoDe("account_admin", "read"), acessoDe("account_user", "read")],
  });
  assert.equal(r.aplicado, true);
});

test("papel único pedido: só ele entra no corpo", async () => {
  const { client, escritas } = falso();
  await pub(client, { confirmo: true, papeis: "account_user:read" });
  assert.deepEqual((escritas()[0].corpo as any).permissionAccess, [acessoDe("account_user", "read")]);
});

test("a gravação deixa rastro acao=publicar no painel", async () => {
  const { client } = falso();
  const r = await pub(client, { confirmo: true });
  assert.ok(fs.existsSync(r.registro), "registro não existe");
  const j = JSON.parse(fs.readFileSync(r.registro, "utf8"));
  assert.equal(j.acao, "publicar");
  assert.ok(r.registro.includes(path.join("_dashboards", LOC, ID)));
});

test("--confirmo sem --versao-esperada recusa sem escrever", async () => {
  const { client, escritas } = falso();
  await assert.rejects(pub(client, { confirmo: true, versaoEsperada: undefined }), /--versao-esperada/);
  assert.equal(escritas().length, 0);
});

test("versão esperada diferente do __v lido recusa sem escrever", async () => {
  const { client, escritas } = falso();
  await assert.rejects(pub(client, { confirmo: true, versaoEsperada: 6 }), /o painel mudou desde a prévia/);
  assert.equal(escritas().length, 0);
});

for (const papeis of ["dono:read", "account_user:voar", "account_admin", "account_user:read,root:read"]) {
  test(`papel inválido (${papeis}) recusa sem escrever`, async () => {
    const { client, escritas } = falso();
    await assert.rejects(pub(client, { confirmo: true, papeis }), /papel/i);
    assert.equal(escritas().length, 0);
  });
}

test("sem --papeis recusa (publicar não escolhe papel por conta própria)", async () => {
  const { client, escritas } = falso();
  await assert.rejects(pub(client, { confirmo: true, papeis: undefined }), /--papeis/);
  assert.equal(escritas().length, 0);
});

test("último conferir com diverge: recusa sem escrever", async () => {
  conferir(10, 2);
  const { client, escritas } = falso();
  await assert.rejects(pub(client, { confirmo: true }), /diverge/);
  assert.equal(escritas().length, 0);
});

test("a prévia já lista a divergência em problemas e não escreve", async () => {
  conferir(10, 2);
  const { client, escritas } = falso();
  const r = await pub(client, {});
  assert.equal(escritas().length, 0);
  assert.match(JSON.stringify(r.problemas), /diverge/);
});

test("--forcar publica mesmo com o último conferir divergente", async () => {
  conferir(10, 2);
  const { client, escritas } = falso();
  const r = await pub(client, { confirmo: true, forcar: true });
  assert.equal(escritas().length, 1);
  assert.equal(r.aplicado, true);
});

test("conferir antigo divergente mas o mais novo limpo: publica", async () => {
  conferir(10, 2);
  conferir(12, 0);
  const { client, escritas } = falso();
  await pub(client, { confirmo: true });
  assert.equal(escritas().length, 1);
});

test("conferir antigo limpo e o mais novo divergente: recusa", async () => {
  conferir(10, 0);
  conferir(12, 1);
  const { client, escritas } = falso();
  await assert.rejects(pub(client, { confirmo: true }), /diverge/);
  assert.equal(escritas().length, 0);
});

test("rastro de outra ação mais novo não esconde o conferir divergente", async () => {
  conferir(10, 2);
  conferir(14, 0, { acao: "editar" });
  const { client, escritas } = falso();
  await assert.rejects(pub(client, { confirmo: true }), /diverge/);
  assert.equal(escritas().length, 0);
});

test("conferir divergente de OUTRO painel não bloqueia este", async () => {
  conferir(10, 5, { id: "OUTRO" });
  const { client, escritas } = falso();
  await pub(client, { confirmo: true });
  assert.equal(escritas().length, 1);
});

test("sem nenhum conferir gravado: publica", async () => {
  const { client, escritas } = falso();
  await pub(client, { confirmo: true });
  assert.equal(escritas().length, 1);
});
