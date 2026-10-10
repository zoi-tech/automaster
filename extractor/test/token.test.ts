import { test } from "node:test";
import assert from "node:assert/strict";
import type { Page } from "playwright";
import { PedidoDeLogin, SemTokens, captureTokens, decodeUserId } from "../src/auth/token.js";

/** Monta um JWT de mentira: só o payload importa, a assinatura nunca é verificada aqui. */
function jwt(payload: Record<string, unknown>): string {
  const b64 = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  return `xxx.${b64}.yyy`;
}

test("tira o userId do Bearer quando ele traz user_id", () => {
  assert.equal(decodeUserId(jwt({ user_id: "U1" }), jwt({ company_id: "C1" })), "U1");
});

test("aceita a grafia userId no Bearer", () => {
  assert.equal(decodeUserId(jwt({ userId: "U2" }), ""), "U2");
});

test("cai para o token-id quando o Bearer não traz nada", () => {
  assert.equal(decodeUserId(jwt({ company_id: "C1" }), jwt({ user_id: "U3" })), "U3");
});

test("aceita sub como último recurso, que é o claim padrão do Firebase", () => {
  assert.equal(decodeUserId("", jwt({ sub: "U4" })), "U4");
});

test("devolve vazio quando nenhum token traz id — o CLI exige --usuario nesse caso", () => {
  assert.equal(decodeUserId(jwt({ company_id: "C1" }), jwt({ company_id: "C1" })), "");
});

test("devolve vazio em token quebrado, sem estourar", () => {
  assert.equal(decodeUserId("não é jwt", ""), "");
});

test("ignora claim que não é string", () => {
  assert.equal(decodeUserId(jwt({ user_id: 42 }), ""), "");
});

const URL_LOGIN = "https://app.gohighlevel.com/?url=%2Fv2%2Flocation%2FX%2Fautomation%2Fworkflows";
const URL_WORKFLOWS = "https://app.gohighlevel.com/v2/location/X/automation/workflows";

/** Página falsa do Playwright parada numa URL: nenhum request autenticado sai dela. */
function paginaParadaEm(url: string): Page {
  return {
    on: () => {},
    off: () => {},
    goto: () => Promise.resolve(null),
    reload: () => Promise.resolve(null),
    url: () => url,
    isClosed: () => false,
  } as unknown as Page;
}

// Teto próprio: sem `pararNoLogin` implementado, a captura esperaria os 300 s padrão.
const PRAZO = { timeout: 8_000 };

test("pararNoLogin na tela de login rejeita com PedidoDeLogin, com a url, em menos de 2 s", PRAZO, async () => {
  const t0 = Date.now();
  const erro = await captureTokens(paginaParadaEm(URL_LOGIN), "X", { pararNoLogin: true }).then(
    () => assert.fail("devia rejeitar"),
    (e: unknown) => e,
  );
  assert.ok(erro instanceof PedidoDeLogin, `esperava PedidoDeLogin, veio ${String(erro)}`);
  assert.equal(erro.url, URL_LOGIN);
  assert.ok(Date.now() - t0 < 2000, `demorou ${Date.now() - t0} ms`);
});

test("pararNoLogin percebe o redirecionamento ao login que chega depois do goto, no laço", PRAZO, async () => {
  const t0 = Date.now();
  const pagina = {
    on: () => {},
    off: () => {},
    goto: () => Promise.resolve(null),
    reload: () => Promise.resolve(null),
    url: () => (Date.now() - t0 > 600 ? URL_LOGIN : URL_WORKFLOWS),
    isClosed: () => false,
  } as unknown as Page;
  const erro = await captureTokens(pagina, "X", { pararNoLogin: true, timeoutMs: 5000 }).then(
    () => assert.fail("devia rejeitar"),
    (e: unknown) => e,
  );
  assert.ok(erro instanceof PedidoDeLogin, `esperava PedidoDeLogin, veio ${String(erro)}`);
  assert.ok(Date.now() - t0 < 2000, `demorou ${Date.now() - t0} ms`);
});

test("sem pararNoLogin, a tela de login esgota o prazo e rejeita com SemTokens e a mensagem de hoje", PRAZO, async () => {
  const erro = await captureTokens(paginaParadaEm(URL_LOGIN), "X", { timeoutMs: 700 }).then(
    () => assert.fail("devia rejeitar"),
    (e: unknown) => e,
  );
  assert.ok(erro instanceof SemTokens, `esperava SemTokens, veio ${String(erro)}`);
  assert.match(erro.message, /^Não capturei os tokens/);
});

test("captura os tokens de um request ao backend e entrega à opção cabecalhos, uma vez, os cabeçalhos dele", PRAZO, async () => {
  const comTokens = { authorization: "Bearer B", "token-id": "T", "user-agent": "U" };
  const ouvintes: ((r: unknown) => void)[] = [];
  const pedido = (h: Record<string, string>) => ({
    url: () => "https://backend.leadconnectorhq.com/x",
    allHeaders: () => Promise.resolve(h),
  });
  const pagina = {
    on: (_ev: string, fn: (r: unknown) => void) => ouvintes.push(fn),
    off: () => {},
    goto: () => {
      // primeiro um request do backend ainda sem tokens: não pode chegar a `cabecalhos`
      for (const fn of [...ouvintes]) fn(pedido({ "user-agent": "U" }));
      for (const fn of [...ouvintes]) fn(pedido(comTokens));
      return Promise.resolve(null);
    },
    reload: () => Promise.resolve(null),
    url: () => URL_WORKFLOWS,
    isClosed: () => false,
  } as unknown as Page;
  const recebidos: Record<string, string>[] = [];
  const tokens = await captureTokens(pagina, "X", { timeoutMs: 3000, cabecalhos: (h) => recebidos.push(h) });
  assert.deepEqual(tokens, { bearer: "B", tokenId: "T" });
  assert.deepEqual(recebidos, [comTokens]);
});

test("página que fecha no meio da captura (goto rejeitado e engolido) rejeita na hora, sem esperar o prazo", PRAZO, async () => {
  let fechada = false;
  const pagina = {
    on: () => {},
    off: () => {},
    goto: () => {
      fechada = true;
      return Promise.reject(new Error("page.goto: Target page, context or browser has been closed"));
    },
    reload: () => Promise.resolve(null),
    url: () => URL_WORKFLOWS,
    isClosed: () => fechada,
  } as unknown as Page;
  const t0 = Date.now();
  // prazo de 60 s: quem não confere isClosed() só falharia pelo timeout do teste
  await assert.rejects(
    captureTokens(pagina, "X", { pararNoLogin: true, timeoutMs: 60_000 }),
    /Target page, context or browser has been closed/,
  );
  assert.ok(Date.now() - t0 < 2000, `demorou ${Date.now() - t0} ms`);
});
