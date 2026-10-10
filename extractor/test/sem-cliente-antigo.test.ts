/**
 * Etapa 13: nenhum comando abre Chrome; todos pedem os tokens ao processo de fundo.
 *
 * Parte estática: varre `src/` atrás do caminho antigo. Parte viva: `withClient` num HOME
 * temporário onde já roda o processo de fundo FALSO (dono da trava do perfil, então o
 * caminho antigo esbarra na trava e nunca chega a abrir Chrome). O falso é posto de pé
 * antes de cada chamada, com a versão e o perfil que `opcoesPadrao` espera: assim
 * `garantirFundo` o reusa e nunca sobe o `main.ts` real. O `after` mata tudo que cita a
 * pasta temporária.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { lockPath } from "../src/auth/lock.js";
import type { Tokens } from "../src/auth/token.js";
import { withClient } from "../src/cli/shared.js";
import { caminhosDaSessao, impressaoDigital } from "../src/fundo/comum.js";
import { estadoDoFundo, garantirFundo, opcoesPadrao, type OpcoesFundo } from "../src/fundo/cliente.js";

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const fundoFalso = fileURLToPath(new URL("./fixtures/fundo-falso.ts", import.meta.url));
const PRAZO = { timeout: 30_000 };

// --- estático ---

function arquivosDe(dir: string): string[] {
  return (fs.readdirSync(dir, { recursive: true, encoding: "utf-8" }) as string[])
    .filter((f) => f.endsWith(".ts"))
    .map((f) => path.join(dir, f));
}

const rel = (f: string): string => path.relative(SRC, f).split(path.sep).join("/");

test("openSession( só aparece na definição (auth/session.ts) e no discover (cli/extract.ts)", () => {
  const onde = arquivosDe(SRC)
    .filter((f) => fs.readFileSync(f, "utf-8").includes("openSession("))
    .map(rel)
    .sort();
  assert.deepEqual(onde, ["auth/session.ts", "cli/extract.ts"]);
});

for (const proibido of ["context.request", "AUTOMASTER_CLIENTE_FETCH", "registroDeLoginAntigo", "aoVerLogin"]) {
  test(`${proibido} não aparece em lugar nenhum de src/`, () => {
    const onde = arquivosDe(SRC)
      .filter((f) => fs.readFileSync(f, "utf-8").includes(proibido))
      .map(rel);
    assert.deepEqual(onde, [], `${proibido} ainda em: ${onde.join(", ")}`);
  });
}

// --- vivo: withClient sobre o processo de fundo falso ---

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "amwc-"));
process.env.HOME = HOME; // os.homedir() lê o HOME a cada chamada: caminhosDaSessao, lockPath e o perfil caem aqui
process.env.AUTOMASTER_PERFIL = path.join(HOME, "perfil");
process.env.FUNDO_FALSO_OCIOSO_MS = "60000"; // rede de segurança: falso esquecido sai sozinho
process.env.FUNDO_FALSO_VERSAO = impressaoDigital();
const filhos: number[] = [];

after(() => {
  for (const pid of filhos) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* já saiu */
    }
  }
  let pids: number[] = [];
  try {
    pids = execFileSync("pgrep", ["-f", HOME], { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] })
      .split("\n")
      .map(Number)
      .filter((p) => Number.isInteger(p) && p > 0 && p !== process.pid);
  } catch {
    /* pgrep sai com 1 quando não acha nada */
  }
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* já saiu */
    }
  }
  fs.rmSync(HOME, { recursive: true, force: true });
});

const ler = (f: string): string => {
  try {
    return fs.readFileSync(f, "utf-8");
  } catch {
    return "";
  }
};
const capturas = (): string[] => ler(path.join(caminhosDaSessao().dir, "capturas.log")).split("\n").filter(Boolean);

/** Põe o falso de pé com a versão e o perfil que `opcoesPadrao` pede, e confere que é ele quem responde. */
async function fundoFalsoDePe(): Promise<OpcoesFundo> {
  const o: OpcoesFundo = { ...opcoesPadrao(() => {}), main: fundoFalso, esperaSubidaMs: 10_000 };
  assert.equal(o.caminhos.dir, path.join(HOME, ".automaster", "sessao"));
  assert.equal(o.lock, lockPath());
  await garantirFundo(o);
  const e = await estadoDoFundo(o);
  assert.ok(e, `o falso não respondeu; fundo.log:\n${ler(o.caminhos.log)}`);
  assert.equal(ler(o.lock).trim(), `${e.pid} fundo`, "o falso é o dono da trava do perfil");
  return o;
}

interface Pedido {
  headers: http.IncomingHttpHeaders;
}

/** Servidor HTTP local: responde 401 aos `quantos401` primeiros pedidos e 200 depois. */
async function comServidor(quantos401: number, fn: (base: string, pedidos: Pedido[]) => Promise<void>): Promise<void> {
  const pedidos: Pedido[] = [];
  const server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      pedidos.push({ headers: req.headers });
      const status = pedidos.length <= quantos401 ? 401 : 200;
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ n: pedidos.length }));
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`, pedidos);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((ok) => server.close(() => ok()));
  }
}

test("withClient pede os tokens ao processo de fundo e o client os usa (bearer, token-id e user-agent)", PRAZO, async () => {
  const o = await fundoFalsoDePe();
  const antes = capturas().length;
  let recebidos: Tokens | undefined;
  await comServidor(0, async (base, pedidos) => {
    await withClient("SUBTESTE1", () => {}, async (client, tokens) => {
      recebidos = tokens;
      assert.deepEqual(await client.getJson(`${base}/x`), { n: 1 });
    });
    assert.ok(recebidos, "o callback não rodou");
    const h = pedidos[0]!.headers;
    assert.equal(h["authorization"], `Bearer ${recebidos.bearer}`);
    assert.equal(h["token-id"], recebidos.tokenId);
    assert.equal(h["user-agent"], "UA falso", "o user-agent vem dos tokens do processo de fundo");
  });
  assert.ok(capturas().slice(antes).includes("SUBTESTE1"), "o processo de fundo não recebeu o pedido da subconta");
  assert.ok(await estadoDoFundo(o), "o comando não pode encerrar o processo de fundo ao sair");
});

test("401: o client pede tokens novos ao processo de fundo e repete com o bearer novo", PRAZO, async () => {
  await fundoFalsoDePe();
  const antes = capturas().length;
  await comServidor(1, async (base, pedidos) => {
    await withClient("SUBTESTE2", () => {}, async (client) => {
      assert.deepEqual(await client.getJson(`${base}/x`), { n: 2 });
    });
    assert.equal(pedidos.length, 2);
    assert.notEqual(pedidos[1]!.headers["authorization"], pedidos[0]!.headers["authorization"], "repetiu com o bearer velho");
  });
  // uma captura para /tokens e outra para /renovar
  assert.deepEqual(capturas().slice(antes), ["SUBTESTE2", "SUBTESTE2"]);
});

test("com escrita, withClient espera a fila antes de pedir tokens e segue quando ela solta", PRAZO, async () => {
  await fundoFalsoDePe();
  const dono = spawn("sleep", ["30"], { stdio: "ignore" });
  filhos.push(dono.pid!);
  const fila = caminhosDaSessao().escrita;
  fs.mkdirSync(path.dirname(fila), { recursive: true });
  fs.writeFileSync(fila, `${dono.pid} escrita`);
  const antes = capturas().length;
  let rodou = false;
  const comando = withClient("SUBTESTE3", () => {}, async () => {
    rodou = true;
  }, { escrita: true });
  comando.catch(() => {}); // a rejeição é conferida no await abaixo, não como rejeição solta
  try {
    await sleep(1500);
    assert.equal(rodou, false, "rodou com a fila ocupada");
    assert.equal(capturas().length, antes, "pediu tokens antes de ter a vez na fila");
  } finally {
    dono.kill("SIGKILL");
  }
  await comando;
  assert.equal(rodou, true);
  assert.ok(capturas().slice(antes).includes("SUBTESTE3"));
  assert.equal(fs.existsSync(fila), false, "a fila não foi solta no fim");
});
