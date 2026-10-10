import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { argsDoCarregador, caminhosDaSessao, pedir } from "../src/fundo/comum.js";

// Cada teste sobe o processo de fundo falso como filho: prazo próprio para falhar em vez de pendurar.
const PRAZO = { timeout: 30_000 };
const fundoFalso = fileURLToPath(new URL("./fixtures/fundo-falso.ts", import.meta.url));

const filhos: ChildProcess[] = [];
const temps: string[] = [];

after(() => {
  for (const f of filhos) {
    try {
      // só quem ainda não saiu: o pid de um filho morto pode já ser de outro processo
      if (f.pid && f.exitCode === null && f.signalCode === null) process.kill(f.pid, "SIGKILL");
    } catch {
      /* já saiu */
    }
  }
  for (const t of temps) fs.rmSync(t, { recursive: true, force: true });
});

function pasta(): { dir: string; lock: string; sock: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amproc-"));
  temps.push(dir);
  return { dir, lock: path.join(dir, "chrome.lock"), sock: caminhosDaSessao(dir).socket };
}

interface Filho {
  proc: ChildProcess;
  pid: number;
  /** Só o stdout, que é para onde vai o log do processo de fundo. */
  saida: () => string;
  /** stdout + stderr, para o diagnóstico das falhas. */
  tudo: () => string;
  fim: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

function subir(dir: string, lock: string, env: Record<string, string> = {}): Filho {
  const proc = spawn(process.execPath, [...argsDoCarregador(process.execArgv), fundoFalso, dir, lock, "perfil-x"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...env },
  });
  filhos.push(proc);
  let out = "";
  let err = "";
  proc.stdout!.setEncoding("utf-8").on("data", (c: string) => (out += c));
  proc.stderr!.setEncoding("utf-8").on("data", (c: string) => (err += c));
  const fim = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
    proc.once("exit", (code, signal) => resolve({ code, signal })),
  );
  assert.ok(proc.pid, "o filho não ganhou pid");
  return { proc, pid: proc.pid, saida: () => out, tudo: () => `${out}\n--- stderr ---\n${err}`, fim };
}

/** Sonda `GET /versao` a cada 100 ms, até 10 s; falha cedo se o filho morrer. */
async function esperarResponder(f: Filho, sock: string): Promise<{ status: number; corpo: any }> {
  let morreu = false;
  void f.fim.then(() => (morreu = true));
  const limite = Date.now() + 10_000;
  while (Date.now() < limite && !morreu) {
    try {
      return await pedir(sock, "GET", "/versao", undefined, 1000);
    } catch {
      await sleep(100);
    }
  }
  assert.fail(`o processo de fundo não respondeu em 10 s (morreu=${morreu}); saída:\n${f.tudo()}`);
}

async function esperarSair(f: Filho, ms = 5000) {
  const r = await Promise.race([f.fim, sleep(ms).then(() => null)]);
  assert.ok(r, `o processo não saiu em ${ms / 1000} s; saída:\n${f.tudo()}`);
  return r;
}

function ler(arquivo: string): string {
  try {
    return fs.readFileSync(arquivo, "utf-8");
  } catch {
    return "";
  }
}

/** O que todo encerramento limpo deixa: código 0, navegador fechado, trava e socket fora. */
async function confereEncerramentoLimpo(f: Filho, p: { dir: string; lock: string; sock: string }) {
  const r = await esperarSair(f);
  assert.deepEqual(r, { code: 0, signal: null }, `saída:\n${f.tudo()}`);
  assert.match(ler(path.join(p.dir, "navegador.log")), /fechado/);
  assert.equal(fs.existsSync(p.lock), false, "a trava do perfil ficou para trás");
  assert.equal(fs.existsSync(p.sock), false, "o socket ficou para trás");
}

test("sobe: /versao responde com o pid do filho e o perfil do argv, e a trava é dele com rótulo fundo", PRAZO, async () => {
  const p = pasta();
  const f = subir(p.dir, p.lock);
  const r = await esperarResponder(f, p.sock);
  assert.equal(r.status, 200);
  assert.equal(r.corpo.pid, f.pid);
  assert.equal(r.corpo.perfil, "perfil-x");
  assert.equal(ler(p.lock).trim(), `${f.pid} fundo`);
});

for (const sinal of ["SIGTERM", "SIGINT"] as const) {
  test(`${sinal}: sai com 0 em até 5 s, fecha o navegador e solta trava e socket`, PRAZO, async () => {
    const p = pasta();
    const f = subir(p.dir, p.lock);
    await esperarResponder(f, p.sock);
    process.kill(f.pid, sinal);
    await confereEncerramentoLimpo(f, p);
  });
}

test("POST /encerrar: sai com 0 em até 5 s, fecha o navegador e solta trava e socket", PRAZO, async () => {
  const p = pasta();
  const f = subir(p.dir, p.lock);
  await esperarResponder(f, p.sock);
  const r = await pedir(p.sock, "POST", "/encerrar");
  assert.equal(r.status, 200);
  await confereEncerramentoLimpo(f, p);
});

test("ociosidade: com FUNDO_FALSO_OCIOSO_MS=300 e sem pedidos, sai sozinho e solta a trava", PRAZO, async () => {
  const p = pasta();
  const f = subir(p.dir, p.lock, { FUNDO_FALSO_OCIOSO_MS: "300" });
  await esperarResponder(f, p.sock);
  await confereEncerramentoLimpo(f, p);
});

test("socket órfão e trava de pid morto: o processo sobe mesmo assim e toma a trava", PRAZO, async () => {
  const p = pasta();
  fs.writeFileSync(p.sock, "sobra de processo morto");
  fs.writeFileSync(p.lock, "2147480000 fundo");
  const f = subir(p.dir, p.lock);
  const r = await esperarResponder(f, p.sock);
  assert.equal(r.status, 200);
  assert.equal(r.corpo.pid, f.pid);
  assert.equal(ler(p.lock).trim(), `${f.pid} fundo`);
});

test("segundo processo com a mesma trava: sai com 1 dizendo que não subiu, e o primeiro segue respondendo", PRAZO, async () => {
  const p = pasta();
  const primeiro = subir(p.dir, p.lock);
  await esperarResponder(primeiro, p.sock);

  const segundo = subir(p.dir, p.lock);
  const r = await esperarSair(segundo, 10_000);
  assert.equal(r.code, 1, `saída:\n${segundo.tudo()}`);
  const linhas = segundo.saida().split("\n");
  assert.ok(
    linhas.some((l) => l.includes("não subiu") && l.includes("processo de fundo")),
    `nenhuma linha com "não subiu" e "processo de fundo" no stdout; saída:\n${segundo.tudo()}`,
  );

  const v = await pedir(p.sock, "GET", "/versao");
  assert.equal(v.status, 200);
  assert.equal(v.corpo.pid, primeiro.pid);
  assert.equal(ler(p.lock).trim(), `${primeiro.pid} fundo`);
});
