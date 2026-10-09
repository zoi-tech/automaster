import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import {
  PRAZOS,
  ErroSessao,
  argsDoCarregador,
  caminhosDaSessao,
  ehTelaDeLogin,
  impressaoDigital,
  linhaDeLogin,
  pedir,
  prepararDir,
  registrarLogin,
  telaDeOrigem,
} from "../src/fundo/comum.js";

const tmp = (prefixo = "amfundo-"): string => fs.mkdtempSync(path.join(os.tmpdir(), prefixo));
const modo = (p: string): number => fs.statSync(p).mode & 0o777;

// --- caminhos ---------------------------------------------------------------

test("caminhosDaSessao(dir) põe socket, log, logins e trava de escrita dentro de dir", () => {
  const dir = "/tmp/amsessao";
  assert.deepEqual(caminhosDaSessao(dir), {
    dir,
    socket: path.join(dir, "sock"),
    log: path.join(dir, "fundo.log"),
    logins: path.join(dir, "logins.jsonl"),
    escrita: path.join(dir, "escrita.lock"),
  });
});

test("caminhosDaSessao() sem argumento fica em ~/.automaster/sessao/", () => {
  const c = caminhosDaSessao();
  assert.ok(c.socket.startsWith(os.homedir()), c.socket);
  assert.ok(c.socket.endsWith(".automaster/sessao/sock"), c.socket);
  assert.equal(c.dir, path.join(os.homedir(), ".automaster", "sessao"));
});

test("socket de 104 bytes é recusado com 'longo demais'; 103 bytes passa", () => {
  // path.join(dir, "sock") acrescenta 5 bytes ("/sock")
  const dir103 = "/" + "a".repeat(103 - 5 - 1);
  const dir104 = "/" + "a".repeat(104 - 5 - 1);
  assert.equal(Buffer.byteLength(caminhosDaSessao(dir103).socket), 103);
  assert.throws(() => caminhosDaSessao(dir104), /longo demais/);
});

test("o limite do socket conta bytes, não caracteres", () => {
  // 98 caracteres + "/sock" = 103 caracteres, mas "ç" ocupa 2 bytes
  const dir = "/" + "ç" + "a".repeat(103 - 5 - 2);
  assert.equal(path.join(dir, "sock").length, 103);
  assert.throws(() => caminhosDaSessao(dir), /longo demais/);
});

test("prepararDir cria a pasta com 0700", () => {
  const dir = path.join(tmp(), "a", "sessao");
  prepararDir(dir);
  assert.equal(modo(dir), 0o700);
});

test("prepararDir aperta para 0700 uma pasta que já existia com 0755", () => {
  const dir = path.join(tmp(), "sessao");
  fs.mkdirSync(dir, { mode: 0o755 });
  fs.chmodSync(dir, 0o755);
  prepararDir(dir);
  assert.equal(modo(dir), 0o700);
});

// --- impressão digital ------------------------------------------------------

test("impressaoDigital muda com o conteúdo de .ts/.js, inclusive em subpasta, e ignora o resto", () => {
  const raiz = tmp();
  fs.writeFileSync(path.join(raiz, "a.ts"), "export const a = 1;\n");
  fs.mkdirSync(path.join(raiz, "sub"));
  fs.writeFileSync(path.join(raiz, "sub", "b.ts"), "export const b = 1;\n");

  const h1 = impressaoDigital(raiz);
  assert.equal(impressaoDigital(raiz), h1, "duas chamadas seguidas dão o mesmo texto");

  fs.writeFileSync(path.join(raiz, "sub", "b.ts"), "export const b = 2;\n");
  const h2 = impressaoDigital(raiz);
  assert.notEqual(h2, h1, "mudar sub/b.ts muda a impressão");

  fs.writeFileSync(path.join(raiz, "notas.md"), "# nada\n");
  assert.equal(impressaoDigital(raiz), h2, "arquivo que não é código não conta");

  fs.writeFileSync(path.join(raiz, "c.ts"), "export const c = 1;\n");
  const h3 = impressaoDigital(raiz);
  assert.notEqual(h3, h2, "arquivo .ts novo conta");

  fs.writeFileSync(path.join(raiz, "d.js"), "export const d = 1;\n");
  assert.notEqual(impressaoDigital(raiz), h3, "arquivo .js novo conta");
});

test("impressaoDigital() sem argumento devolve 16 hexadecimais", () => {
  assert.match(impressaoDigital(), /^[0-9a-f]{16}$/);
});

// --- erro -------------------------------------------------------------------

test("ErroSessao é Error com codigo e message", () => {
  const e = new ErroSessao("login_pendente", "x");
  assert.ok(e instanceof Error);
  assert.equal(e.codigo, "login_pendente");
  assert.equal(e.message, "x");
  assert.equal(e.name, "ErroSessao");
});

// --- pedir ------------------------------------------------------------------

async function servidor(
  tratar: http.RequestListener,
): Promise<{ sock: string; fechar: () => void }> {
  const sock = path.join(tmp("amsock-"), "s");
  const server = http.createServer(tratar);
  await new Promise<void>((ok) => server.listen(sock, ok));
  return {
    sock,
    fechar: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}

test("pedir manda POST com corpo JSON e devolve status e resposta parseada", async () => {
  let visto: { metodo?: string; url?: string; tipo?: string; corpo?: unknown } = {};
  const s = await servidor((req, res) => {
    let txt = "";
    req.setEncoding("utf-8");
    req.on("data", (c: string) => (txt += c));
    req.on("end", () => {
      visto = { metodo: req.method, url: req.url, tipo: req.headers["content-type"], corpo: JSON.parse(txt) };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, eco: visto.corpo }));
    });
  });
  try {
    // acento no corpo: content-length precisa ser em bytes
    const corpo = { subconta: "loc1", nota: "ação" };
    const r = await pedir(s.sock, "POST", "/tokens", corpo);
    assert.equal(visto.metodo, "POST");
    assert.equal(visto.url, "/tokens");
    assert.match(visto.tipo ?? "", /application\/json/);
    assert.deepEqual(visto.corpo, corpo);
    assert.equal(r.status, 200);
    assert.deepEqual(r.corpo, { ok: true, eco: corpo });
  } finally {
    s.fechar();
  }
});

test("pedir devolve 503 com o corpo {code, message}", async () => {
  const s = await servidor((_req, res) => {
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ code: "login_pendente", message: "entre no GHL" }));
  });
  try {
    const r = await pedir(s.sock, "GET", "/estado");
    assert.equal(r.status, 503);
    assert.deepEqual(r.corpo, { code: "login_pendente", message: "entre no GHL" });
  } finally {
    s.fechar();
  }
});

test("pedir devolve resposta que não é JSON como {message: texto}", async () => {
  const s = await servidor((_req, res) => {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end("deu ruim");
  });
  try {
    const r = await pedir(s.sock, "GET", "/estado");
    assert.equal(r.status, 500);
    assert.deepEqual(r.corpo, { message: "deu ruim" });
  } finally {
    s.fechar();
  }
});

test("pedir devolve resposta vazia como {}", async () => {
  const s = await servidor((_req, res) => {
    res.writeHead(204);
    res.end();
  });
  try {
    const r = await pedir(s.sock, "POST", "/encerrar");
    assert.equal(r.status, 204);
    assert.deepEqual(r.corpo, {});
  } finally {
    s.fechar();
  }
});

test("pedir a servidor que nunca responde rejeita com ETIMEOUT e 'não respondeu'", { timeout: 5000 }, async () => {
  const s = await servidor(() => {
    /* aceita e fica calado */
  });
  try {
    const inicio = Date.now();
    await assert.rejects(pedir(s.sock, "POST", "/tokens", {}, 100), (e: any) => {
      assert.equal(e.code, "ETIMEOUT");
      assert.match(e.message, /não respondeu/);
      return true;
    });
    assert.ok(Date.now() - inicio < 2000, "o corte respeita o timeoutMs");
  } finally {
    s.fechar();
  }
});

test("pedir a socket inexistente rejeita com ENOENT ou ECONNREFUSED", async () => {
  const sock = path.join(tmp("amsock-"), "nao-existe");
  await assert.rejects(pedir(sock, "GET", "/estado"), (e: any) => {
    assert.ok(["ENOENT", "ECONNREFUSED"].includes(e.code), String(e.code));
    return true;
  });
});

// --- prazos -----------------------------------------------------------------

test("PRAZOS tem os valores combinados e as somas cabem nos cortes", () => {
  assert.deepEqual({ ...PRAZOS }, {
    tentativaInvisivelMs: 30_000,
    aberturaChromeMs: 10_000,
    esperaLoginMs: 270_000,
    pedidoTokensMs: 330_000,
    filaEscritaMs: 120_000,
    subidaMs: 15_000,
    encerrarMs: 20_000,
  });
  const p = PRAZOS;
  assert.ok(p.tentativaInvisivelMs + 2 * p.aberturaChromeMs + p.esperaLoginMs <= p.pedidoTokensMs);
  assert.ok(p.filaEscritaMs + p.encerrarMs + p.subidaMs + p.pedidoTokensMs < 600_000);
});

// --- tela de login ----------------------------------------------------------

const LOGIN = "https://app.gohighlevel.com/?url=%2Fv2%2Flocation%2FX%2Fautomation%2Fworkflows";

test("ehTelaDeLogin reconhece só o redirecionamento de login do app.gohighlevel.com", () => {
  assert.equal(ehTelaDeLogin(LOGIN), true);
  assert.equal(ehTelaDeLogin("https://app.gohighlevel.com/v2/location/X/automation/workflows"), false);
  assert.equal(ehTelaDeLogin("https://app.zoitech.com.br/?url=%2Fv2%2Flocation%2FX"), false);
  assert.equal(ehTelaDeLogin("https://outro.gohighlevel.com/?url=%2Fv2"), false);
  assert.equal(ehTelaDeLogin("https://app.gohighlevel.com/v2/location/X?url=%2Fv2"), false);
  assert.equal(ehTelaDeLogin("https://app.gohighlevel.com/"), false);
  assert.equal(ehTelaDeLogin("about:blank"), false);
  assert.equal(ehTelaDeLogin("não é url ?url=x"), false);
});

test("telaDeOrigem tira o destino decodificado do url=", () => {
  assert.equal(telaDeOrigem(LOGIN), "/v2/location/X/automation/workflows");
  assert.equal(telaDeOrigem("https://app.gohighlevel.com/v2/location/X/automation/workflows"), "");
  assert.equal(telaDeOrigem("não é url ?url=x"), "");
});

// --- registro de logins -----------------------------------------------------

const base = {
  via: "fundo" as const,
  motivo: "redirecionamento" as const,
  perfil: "/home/u/.automaster/chrome-profile",
  subconta: "loc1",
  url: LOGIN,
  navegacoes: 0,
  ultima: null,
  desde: "2026-10-09T10:00:00.000Z",
  agora: new Date("2026-10-09T12:34:56.000Z"),
};

test("linhaDeLogin monta exatamente as chaves do registro, sem token", () => {
  const ultima = { em: "2026-10-09T12:00:00.000Z", url: "https://app.gohighlevel.com/v2/location/X" };
  const l = linhaDeLogin({ ...base, via: "withClient", motivo: "sem_tokens", navegacoes: 2, ultima });
  assert.deepEqual(Object.keys(l).sort(), [
    "em", "motivo", "navegacoesDesdeSubida", "navegouAntes", "origem", "perfil",
    "processoDesde", "subconta", "ultimaNavegacao", "via",
  ]);
  assert.ok(!Object.keys(l).some((k) => /token|bearer/i.test(k)));
  assert.deepEqual(l, {
    em: "2026-10-09T12:34:56.000Z",
    via: "withClient",
    motivo: "sem_tokens",
    perfil: base.perfil,
    subconta: "loc1",
    origem: "/v2/location/X/automation/workflows",
    navegouAntes: true,
    navegacoesDesdeSubida: 2,
    ultimaNavegacao: ultima,
    processoDesde: base.desde,
  });
});

test("linhaDeLogin: origem cai na própria URL sem url=, e navegouAntes segue as navegações", () => {
  const semUrl = "https://app.gohighlevel.com/v2/location/X/automation/workflows";
  const l = linhaDeLogin({ ...base, url: semUrl });
  assert.equal(l.origem, semUrl);
  assert.equal(l.navegouAntes, false);
  assert.equal(l.navegacoesDesdeSubida, 0);
  assert.equal(l.ultimaNavegacao, null);
});

test("registrarLogin acrescenta uma linha JSON por chamada, em arquivo 0600", () => {
  const arq = path.join(tmp(), "nova", "logins.jsonl");
  registrarLogin(arq, linhaDeLogin(base));
  registrarLogin(arq, linhaDeLogin({ ...base, navegacoes: 2 }));
  const linhas = fs.readFileSync(arq, "utf-8").split("\n").filter(Boolean);
  assert.equal(linhas.length, 2);
  const [a, b] = linhas.map((x) => JSON.parse(x));
  assert.equal(a.navegouAntes, false);
  assert.equal(b.navegouAntes, true);
  assert.equal(modo(arq), 0o600);
});

// --- carregador -------------------------------------------------------------

test("argsDoCarregador fica só com --require/--import, normalizados e sem repetição", () => {
  const pre = "/r/node_modules/tsx/dist/preflight.cjs";
  const load = "file:///r/node_modules/tsx/dist/loader.mjs";
  const execArgv = [
    "--test-concurrency=0",
    `--require=${pre}`,
    `--import=${load}`,
    "--test-reporter=spec",
    "--test",
    "--require",
    pre,
    "--import",
    load,
  ];
  assert.deepEqual(argsDoCarregador(execArgv), [`--require=${pre}`, `--import=${load}`]);
  assert.deepEqual(argsDoCarregador(["--import", "tsx"]), ["--import=tsx"]);
  assert.deepEqual(argsDoCarregador([]), []);
});
