import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { BrowserContext } from "playwright";
import { GhlClient, UA_PADRAO } from "../src/api/client.js";
import { cabecalhosCookie } from "../src/auth/session.js";
import type { Tokens } from "../src/auth/token.js";

/** O que o servidor de teste viu de cada pedido. */
interface Pedido {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

/** Resposta do servidor ao n-ésimo pedido (0 = primeiro). `null` = nunca responde. */
type Roteiro = (n: number, p: Pedido) => { status: number; body?: unknown } | null;

interface Servidor {
  base: string;
  host: string;
  pedidos: Pedido[];
}

/**
 * Sobe um servidor HTTP em 127.0.0.1 (porta 0), roda `fn` e fecha no fim, mesmo quando o
 * servidor nunca respondeu: `closeAllConnections` derruba a conexão que ficou pendurada.
 */
async function comServidor(roteiro: Roteiro, fn: (s: Servidor) => Promise<void>): Promise<void> {
  const pedidos: Pedido[] = [];
  const server = http.createServer((req, res) => {
    const partes: Buffer[] = [];
    req.on("data", (c: Buffer) => partes.push(c));
    req.on("end", () => {
      const p: Pedido = { method: req.method ?? "", url: req.url ?? "", headers: req.headers, body: Buffer.concat(partes) };
      pedidos.push(p);
      const r = roteiro(pedidos.length - 1, p);
      if (!r) return;
      const texto = typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {});
      res.writeHead(r.status, { "content-type": "application/json" });
      res.end(texto);
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const { port } = server.address() as AddressInfo;
  try {
    await fn({ base: `http://127.0.0.1:${port}`, host: `127.0.0.1:${port}`, pedidos });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((ok) => server.close(() => ok()));
  }
}

const TOKENS: Tokens = { bearer: "B1", tokenId: "T1" };
const semRefresh = (): Promise<Tokens> => Promise.reject(new Error("não devia renovar"));
const sempre = (status: number, body: unknown = { ok: true }): Roteiro => () => ({ status, body });

test("getJson manda os dois tokens e os cabeçalhos do app e devolve o JSON", async () => {
  await comServidor(sempre(200, { a: 1 }), async ({ base, pedidos }) => {
    const c = new GhlClient(TOKENS, semRefresh, { throttleMs: 0 });
    assert.deepEqual(await c.getJson(`${base}/x`), { a: 1 });
    assert.equal(pedidos.length, 1);
    const h = pedidos[0]!.headers;
    assert.equal(pedidos[0]!.method, "GET");
    assert.equal(h["authorization"], "Bearer B1");
    assert.equal(h["token-id"], "T1");
    assert.equal(h["channel"], "APP");
    assert.equal(h["source"], "WEB_USER");
    assert.equal(h["version"], "2021-07-28");
    assert.equal(h["accept"], "application/json");
    assert.equal(h["user-agent"], UA_PADRAO);
    assert.match(UA_PADRAO, /^Mozilla\/5\.0 .*Chrome\/\d+/);
  });
});

test("user-agent vem dos tokens quando preenchido", async () => {
  await comServidor(sempre(200), async ({ base, pedidos }) => {
    const c = new GhlClient({ ...TOKENS, userAgent: "UA-do-perfil/1.0" }, semRefresh, { throttleMs: 0 });
    await c.getJson(`${base}/x`);
    assert.equal(pedidos[0]!.headers["user-agent"], "UA-do-perfil/1.0");
  });
});

test("401 uma vez: renova uma vez e repete com o bearer novo", async () => {
  await comServidor((n) => (n === 0 ? { status: 401 } : { status: 200, body: { depois: true } }), async ({ base, pedidos }) => {
    let renovou = 0;
    const refresh = (): Promise<Tokens> => {
      renovou++;
      return Promise.resolve({ bearer: "B2", tokenId: "T2" });
    };
    const c = new GhlClient(TOKENS, refresh, { throttleMs: 0 });
    assert.deepEqual(await c.getJson(`${base}/x`), { depois: true });
    assert.equal(renovou, 1);
    assert.equal(pedidos.length, 2);
    assert.equal(pedidos[1]!.headers["authorization"], "Bearer B2");
    assert.equal(pedidos[1]!.headers["token-id"], "T2");
  });
});

test("401 duas vezes: lança HTTP 401 e renovou só uma vez", { timeout: 5_000 }, async () => {
  await comServidor(sempre(401), async ({ base, pedidos }) => {
    let renovou = 0;
    const refresh = (): Promise<Tokens> => {
      renovou++;
      return Promise.resolve({ bearer: "B2", tokenId: "T2" });
    };
    const c = new GhlClient(TOKENS, refresh, { throttleMs: 0 });
    await assert.rejects(c.getJson(`${base}/x`), /HTTP 401/);
    assert.equal(renovou, 1);
    assert.equal(pedidos.length, 2);
  });
});

test("429 seguido de 200 devolve o JSON", async () => {
  await comServidor((n) => (n === 0 ? { status: 429 } : { status: 200, body: { b: 2 } }), async ({ base, pedidos }) => {
    const c = new GhlClient(TOKENS, semRefresh, { throttleMs: 0, backoffMs: 1 });
    assert.deepEqual(await c.getJson(`${base}/x`), { b: 2 });
    assert.equal(pedidos.length, 2);
  });
});

test("429 sempre: lança HTTP 429 depois de exatamente 5 pedidos", { timeout: 5_000 }, async () => {
  await comServidor(sempre(429), async ({ base, pedidos }) => {
    const c = new GhlClient(TOKENS, semRefresh, { throttleMs: 0, backoffMs: 1 });
    await assert.rejects(c.getJson(`${base}/x`), /HTTP 429/);
    assert.equal(pedidos.length, 5);
  });
});

test("putJson, postJson e deleteJson mandam o corpo como JSON com content-type", async () => {
  await comServidor(sempre(200), async ({ base, pedidos }) => {
    const c = new GhlClient(TOKENS, semRefresh, { throttleMs: 0 });
    await c.putJson(`${base}/p`, { put: 1 });
    await c.postJson(`${base}/p`, { post: [2] });
    await c.deleteJson(`${base}/p`, { ids: ["x"] });
    assert.deepEqual(pedidos.map((p) => p.method), ["PUT", "POST", "DELETE"]);
    const esperados = [{ put: 1 }, { post: [2] }, { ids: ["x"] }];
    pedidos.forEach((p, i) => {
      assert.match(String(p.headers["content-type"]), /^application\/json/);
      assert.deepEqual(JSON.parse(p.body.toString("utf-8")), esperados[i]);
      assert.equal(p.headers["authorization"], "Bearer B1");
    });
  });
});

test("getJson não manda content-type nem corpo", async () => {
  await comServidor(sempre(200), async ({ base, pedidos }) => {
    const c = new GhlClient(TOKENS, semRefresh, { throttleMs: 0 });
    await c.getJson(`${base}/x`);
    assert.equal(pedidos[0]!.headers["content-type"], undefined);
    assert.equal(pedidos[0]!.body.length, 0);
  });
});

test("postMultipart manda campo, nome e bytes do arquivo com boundary, e extraHeaders sobrescreve version", async () => {
  await comServidor(sempre(200, { up: true }), async ({ base, pedidos }) => {
    const c = new GhlClient(TOKENS, semRefresh, { throttleMs: 0 });
    const form = new FormData();
    form.append("conversationId", "conv-123");
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x10]);
    form.append("fileAttachment", new Blob([bytes], { type: "image/png" }), "foto.png");
    assert.deepEqual(await c.postMultipart(`${base}/up`, form, { version: "v4" }), { up: true });
    const p = pedidos[0]!;
    assert.equal(p.method, "POST");
    assert.match(String(p.headers["content-type"]), /^multipart\/form-data; boundary=.+/);
    assert.equal(p.headers["version"], "v4");
    assert.equal(p.headers["authorization"], "Bearer B1");
    const corpo = p.body.toString("latin1");
    assert.match(corpo, /name="conversationId"\r\n\r\nconv-123\r\n/);
    assert.match(corpo, /filename="foto\.png"/);
    assert.ok(p.body.includes(bytes), "os bytes do arquivo chegam intactos");
  });
});

test("getJsonNoAuth nunca manda authorization, token-id nem cookie", async () => {
  await comServidor(sempre(200, { firebase: 1 }), async ({ base, host, pedidos }) => {
    const c = new GhlClient({ ...TOKENS, cookies: { [host]: "a=1; b=2" } }, semRefresh, { throttleMs: 0 });
    assert.deepEqual(await c.getJsonNoAuth(`${base}/firebase`), { firebase: 1 });
    const h = pedidos[0]!.headers;
    assert.equal(h["authorization"], undefined);
    assert.equal(h["token-id"], undefined);
    assert.equal(h["cookie"], undefined);
  });
});

test("cookie dos tokens vai só para o host dele", async () => {
  await comServidor(sempre(200), async (a) => {
    await comServidor(sempre(200), async (b) => {
      const c = new GhlClient({ ...TOKENS, cookies: { [a.host]: "a=1; b=2" } }, semRefresh, { throttleMs: 0 });
      await c.getJson(`${a.base}/x`);
      await c.postJson(`${a.base}/x`, { v: 1 });
      await c.getJson(`${b.base}/x`);
      assert.equal(a.pedidos[0]!.headers["cookie"], "a=1; b=2");
      assert.equal(a.pedidos[1]!.headers["cookie"], "a=1; b=2");
      assert.equal(b.pedidos[0]!.headers["cookie"], undefined);
    });
  });
});

test("servidor que não responde: tempo esgotado, sem HTTP na mensagem", { timeout: 5_000 }, async () => {
  await comServidor(() => null, async ({ base }) => {
    const c = new GhlClient(TOKENS, semRefresh, { throttleMs: 0, timeoutMs: 50 });
    const inicio = Date.now();
    await assert.rejects(c.getJson(`${base}/x`), (e: unknown) => {
      assert.ok(e instanceof Error);
      assert.match(e.message, /tempo esgotado/);
      assert.doesNotMatch(e.message, /HTTP/);
      return true;
    });
    assert.ok(Date.now() - inicio < 5_000, "o corte respeita timeoutMs");
  });
});

test("erro HTTP mantém o formato '<MÉTODO> <url> → HTTP <status> <até 200 caracteres>'", async () => {
  const longo = "x".repeat(300);
  await comServidor(sempre(422, longo), async ({ base }) => {
    const c = new GhlClient(TOKENS, semRefresh, { throttleMs: 0 });
    await assert.rejects(c.getJson(`${base}/g`), (e: unknown) => {
      assert.ok(e instanceof Error);
      assert.equal(e.message, `GET ${base}/g → HTTP 422 ${"x".repeat(200)}`);
      return true;
    });
    await assert.rejects(c.postJson(`${base}/p`, { a: 1 }), (e: unknown) => {
      assert.ok(e instanceof Error);
      assert.equal(e.message, `POST ${base}/p → HTTP 422 ${"x".repeat(200)}`);
      return true;
    });
  });
});

test("espia: coletar devolve as respostas na ordem e zera; sem espiar, vazio", async () => {
  await comServidor((n) => ({ status: 200, body: { n } }), async ({ base }) => {
    const desligada = new GhlClient(TOKENS, semRefresh, { throttleMs: 0 });
    await desligada.getJson(`${base}/x`);
    assert.deepEqual(desligada.coletar(), []);

    const c = new GhlClient(TOKENS, semRefresh, { throttleMs: 0 });
    c.espiar();
    await c.getJson(`${base}/a`);
    const form = new FormData();
    form.append("k", "v");
    await c.postMultipart(`${base}/b`, form);
    await c.getJsonNoAuth(`${base}/c`);
    assert.deepEqual(c.coletar(), [{ n: 1 }, { n: 2 }, { n: 3 }]);
    assert.deepEqual(c.coletar(), []);
  });
});

test("cabecalhosCookie junta os cookies por host e omite host sem cookie", async () => {
  const vistos: unknown[] = [];
  const contexto = {
    cookies: (url: unknown) => {
      vistos.push(url);
      if (url === "https://backend.leadconnectorhq.com/") {
        return Promise.resolve([{ name: "a", value: "1" }, { name: "b", value: "2" }]);
      }
      return Promise.resolve([]);
    },
  } as unknown as Pick<BrowserContext, "cookies">;
  assert.deepEqual(await cabecalhosCookie(contexto), { "backend.leadconnectorhq.com": "a=1; b=2" });
  assert.ok(vistos.includes("https://services.leadconnectorhq.com/"), "consulta também o services");
});

test("com contexto, getJson passa pelo contexto.request e não põe cookie à mão", async () => {
  await comServidor(sempre(200), async ({ base, host, pedidos }) => {
    const chamadas: { url: string; opcoes: { method?: string; headers?: Record<string, string> } }[] = [];
    const resposta = {
      status: () => 200,
      ok: () => true,
      json: () => Promise.resolve({ viaContexto: true }),
      text: () => Promise.resolve('{"viaContexto":true}'),
    };
    const responder = (url: string, opcoes: { method?: string; headers?: Record<string, string> } = {}) => {
      chamadas.push({ url, opcoes });
      return Promise.resolve(resposta);
    };
    const contexto = {
      request: {
        fetch: responder,
        get: (url: string, o: { headers?: Record<string, string> } = {}) => responder(url, { ...o, method: "GET" }),
      },
    } as unknown as BrowserContext;
    const c = new GhlClient({ ...TOKENS, cookies: { [host]: "a=1; b=2" } }, semRefresh, { throttleMs: 0, contexto });
    assert.deepEqual(await c.getJson(`${base}/x`), { viaContexto: true });
    assert.equal(pedidos.length, 0, "nada saiu pelo fetch do Node");
    assert.equal(chamadas.length, 1);
    assert.equal(chamadas[0]!.url, `${base}/x`);
    assert.equal(chamadas[0]!.opcoes.method?.toUpperCase() ?? "GET", "GET");
    const h = chamadas[0]!.opcoes.headers ?? {};
    assert.equal(h["authorization"], "Bearer B1");
    assert.equal(h["cookie"], undefined);
  });
});
