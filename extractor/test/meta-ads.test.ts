/**
 * Etapa 7 do plano de dashboards: cliente do Graph API da Meta (sem rede, `fetch` injetado).
 *
 * Contrato que o implementador deve cumprir.
 *
 * src/api/meta-ads.ts
 *   tokenMeta(env = process.env): string | null
 *     lê SÓ `AUTOMASTER_META_TOKEN`; ausente, vazio ou só espaços -> null. O módulo não importa fs:
 *     o token nunca é gravado em disco pelo automaster.
 *   insightsMeta(
 *     o: { conta: string; token: string; inicio: number; fim: number; fuso: string; porDia?: boolean },
 *     fetchFn: typeof fetch = fetch,
 *   ): Promise<
 *     | { ok: true; linhas: { dia?: string; spend: number; impressions: number; clicks: number; leads: number }[] }
 *     | { ok: false; motivo: string }>
 *     GET https://graph.facebook.com/v21.0/<act_id>/insights
 *       fields=spend,impressions,clicks,actions
 *       time_range={"since":"AAAA-MM-DD","until":"AAAA-MM-DD"}  (datas LOCAIS no `fuso`, não UTC)
 *       time_increment=1 só quando porDia (sem porDia o parâmetro não vai, ou vai "all_days")
 *       access_token=<token>
 *     `conta` aceita "act_123" ou "123"; a URL sempre leva "act_123".
 *     spend vem em reais, como texto ("123.45"); NÃO divide por 100 (amount_spent é que vem em centavos).
 *     leads = soma dos `actions` com action_type EXATAMENTE "lead" (nem lead_grouped, nem link_click).
 *     Erro do Graph de permissão/inexistência (error.code 100 ou 200, em HTTP 400 ou 200) ->
 *       { ok:false, motivo contendo "token sem acesso à conta act_<id>" }.
 *     Outra falha (HTTP 500, rede) -> { ok:false, motivo } sem vazar o token.
 *
 * (recontarMetaAds, que usa isto, está em dashboards-conferir-externos.test.ts.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tokenMeta, insightsMeta } from "../src/api/meta-ads.js";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SP = "America/Sao_Paulo";
const TOKEN = "TOKEN-DE-TESTE-NAO-REAL";
const DIA = { inicio: Date.parse("2026-10-15T00:00:00-03:00"), fim: Date.parse("2026-10-15T23:59:59.999-03:00") };

function fetchFalso(corpo: unknown, status = 200) {
  const urls: string[] = [];
  const fn = (async (url: unknown) => {
    urls.push(String(url));
    return { ok: status < 400, status, json: async () => corpo, text: async () => JSON.stringify(corpo) };
  }) as unknown as typeof fetch;
  return { urls, fn };
}
const base = { conta: "act_123", token: TOKEN, ...DIA, fuso: SP };
const linha = (extra: Record<string, unknown> = {}) => ({
  spend: "123.45", impressions: "1000", clicks: "50", date_start: "2026-10-15", date_stop: "2026-10-15",
  actions: [{ action_type: "link_click", value: "50" }, { action_type: "lead", value: "7" }], ...extra,
});

test("tokenMeta: lê AUTOMASTER_META_TOKEN; ausente, vazio ou em branco é null", () => {
  assert.equal(tokenMeta({ AUTOMASTER_META_TOKEN: "abc" }), "abc");
  assert.equal(tokenMeta({}), null);
  assert.equal(tokenMeta({ AUTOMASTER_META_TOKEN: "" }), null);
  assert.equal(tokenMeta({ AUTOMASTER_META_TOKEN: "   " }), null);
  // outra variável não vale (ex.: o token do GHL ou um META_TOKEN genérico)
  assert.equal(tokenMeta({ META_TOKEN: "x", FACEBOOK_TOKEN: "y" }), null);
});

test("insightsMeta: monta a URL do Graph v21.0 com os fields, o time_range e o token", async () => {
  const f = fetchFalso({ data: [linha()] });
  await insightsMeta(base, f.fn);
  assert.equal(f.urls.length, 1);
  const u = new URL(f.urls[0]);
  assert.equal(`${u.origin}${u.pathname}`, "https://graph.facebook.com/v21.0/act_123/insights");
  assert.equal(u.searchParams.get("fields"), "spend,impressions,clicks,actions");
  assert.deepEqual(JSON.parse(u.searchParams.get("time_range")!), { since: "2026-10-15", until: "2026-10-15" });
  assert.equal(u.searchParams.get("access_token"), TOKEN);
});

test("insightsMeta: conta sem o prefixo act_ ganha o prefixo", async () => {
  const f = fetchFalso({ data: [linha()] });
  await insightsMeta({ ...base, conta: "123" }, f.fn);
  assert.match(new URL(f.urls[0]).pathname, /^\/v21\.0\/act_123\/insights$/);
});

test("insightsMeta: conta que não é só dígitos não chega à URL", async () => {
  for (const conta of ["123/../me", "123?x=1", "act_12#3", "abc", "123%2f"]) {
    const f = fetchFalso({ data: [linha()] });
    const r = await insightsMeta({ ...base, conta }, f.fn);
    assert.equal(r.ok, false);
    assert.equal(f.urls.length, 0);
  }
});

test("insightsMeta: time_range usa as datas LOCAIS (o último instante do dia em Brasília cai em 16/10 UTC)", async () => {
  const f = fetchFalso({ data: [linha()] });
  await insightsMeta(base, f.fn);
  assert.deepEqual(JSON.parse(new URL(f.urls[0]).searchParams.get("time_range")!), { since: "2026-10-15", until: "2026-10-15" });
  // janela de vários dias, começando à noite: 22h locais de 14/10 já é 15/10 em UTC
  const g = fetchFalso({ data: [linha()] });
  await insightsMeta({ ...base, inicio: Date.parse("2026-10-14T22:00:00-03:00"), fim: Date.parse("2026-10-16T01:00:00-03:00") }, g.fn);
  assert.deepEqual(JSON.parse(new URL(g.urls[0]).searchParams.get("time_range")!), { since: "2026-10-14", until: "2026-10-16" });
});

test("insightsMeta: o fuso manda — em Tóquio o mesmo instante cai em outro dia", async () => {
  const f = fetchFalso({ data: [linha()] });
  await insightsMeta({ ...base, inicio: Date.parse("2026-10-15T20:00:00Z"), fim: Date.parse("2026-10-15T20:30:00Z"), fuso: "Asia/Tokyo" }, f.fn);
  assert.deepEqual(JSON.parse(new URL(f.urls[0]).searchParams.get("time_range")!), { since: "2026-10-16", until: "2026-10-16" });
});

test("insightsMeta: spend sai em reais (texto do Graph vira número, sem dividir por 100)", async () => {
  const r = await insightsMeta(base, fetchFalso({ data: [linha({ spend: "123.45" })] }).fn);
  assert.equal(r.ok, true);
  assert.equal((r as { ok: true; linhas: any[] }).linhas[0].spend, 123.45);
  assert.equal(typeof (r as { ok: true; linhas: any[] }).linhas[0].spend, "number");
});

test("insightsMeta: impressões e cliques viram número", async () => {
  const r = (await insightsMeta(base, fetchFalso({ data: [linha()] }).fn)) as { ok: true; linhas: any[] };
  assert.equal(r.linhas[0].impressions, 1000);
  assert.equal(r.linhas[0].clicks, 50);
});

test("insightsMeta: leads somam só o action_type 'lead' (nem lead_grouped, nem link_click)", async () => {
  const actions = [
    { action_type: "link_click", value: "50" },
    { action_type: "lead", value: "7" },
    { action_type: "onsite_conversion.lead_grouped", value: "7" },
    { action_type: "offsite_conversion.fb_pixel_lead", value: "3" },
  ];
  const r = (await insightsMeta(base, fetchFalso({ data: [linha({ actions })] }).fn)) as { ok: true; linhas: any[] };
  assert.equal(r.linhas[0].leads, 7);
});

test("insightsMeta: linha sem actions tem 0 leads, sem erro", async () => {
  const sem = linha();
  delete (sem as Record<string, unknown>).actions;
  const r = (await insightsMeta(base, fetchFalso({ data: [sem] }).fn)) as { ok: true; linhas: any[] };
  assert.equal(r.ok, true);
  assert.equal(r.linhas[0].leads, 0);
});

test("insightsMeta: sem dados no período devolve ok com lista vazia (vazio é achado, não falha)", async () => {
  const r = await insightsMeta(base, fetchFalso({ data: [] }).fn);
  assert.deepEqual(r, { ok: true, linhas: [] });
});

test("insightsMeta: time_increment=1 só com porDia, e cada linha traz o dia", async () => {
  const sem = fetchFalso({ data: [linha()] });
  await insightsMeta(base, sem.fn);
  const incSem = new URL(sem.urls[0]).searchParams.get("time_increment");
  assert.ok(incSem === null || incSem === "all_days", `time_increment sem porDia: ${incSem}`);

  const com = fetchFalso({ data: [linha({ date_start: "2026-10-14", date_stop: "2026-10-14" }), linha()] });
  const r = (await insightsMeta({ ...base, porDia: true }, com.fn)) as { ok: true; linhas: any[] };
  assert.equal(new URL(com.urls[0]).searchParams.get("time_increment"), "1");
  assert.deepEqual(r.linhas.map((l) => l.dia), ["2026-10-14", "2026-10-15"]);
});

test("insightsMeta: erro 100/200 do Graph (conta sem permissão) vira 'token sem acesso à conta act_...'", async () => {
  for (const [status, code] of [[400, 100], [400, 200], [200, 100]] as const) {
    const f = fetchFalso({ error: { message: "Unsupported get request", type: "GraphMethodException", code } }, status);
    const r = await insightsMeta(base, f.fn);
    assert.equal(r.ok, false, `${status}/${code}`);
    assert.match((r as { motivo: string }).motivo, /token sem acesso à conta act_123/, `${status}/${code}`);
  }
});

test("insightsMeta: falha de servidor não vira 'sem acesso' e não vaza o token no motivo", async () => {
  const f = fetchFalso({ error: { message: "boom", code: 2 } }, 500);
  const r = (await insightsMeta(base, f.fn)) as { ok: false; motivo: string };
  assert.equal(r.ok, false);
  assert.doesNotMatch(r.motivo, /token sem acesso/);
  assert.ok(!r.motivo.includes(TOKEN), "o token apareceu no motivo");
});

test("insightsMeta: erro de rede devolve ok:false com motivo (sem lançar) e sem o token", async () => {
  const fn = (async () => { throw new Error(`getaddrinfo ENOTFOUND graph.facebook.com?access_token=${TOKEN}`); }) as unknown as typeof fetch;
  const r = (await insightsMeta(base, fn)) as { ok: false; motivo: string };
  assert.equal(r.ok, false);
  assert.ok(!r.motivo.includes(TOKEN), "o token apareceu no motivo");
});

test("meta-ads.ts nunca grava em disco: não importa fs e não carrega o token em literal", () => {
  const src = fs.readFileSync(path.join(RAIZ, "src/api/meta-ads.ts"), "utf8");
  assert.doesNotMatch(src, /from\s+["'](node:)?fs(\/promises)?["']|require\(["'](node:)?fs/);
  assert.match(src, /AUTOMASTER_META_TOKEN/);
  assert.doesNotMatch(src, /EAA[A-Za-z0-9]{20,}/); // formato de token de usuário da Meta
});
