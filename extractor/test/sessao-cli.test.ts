/**
 * Comando `sessao` visto de fora: roda a CLI num HOME temporário vazio, onde não há
 * processo de fundo nenhum. Nada aqui pode subir o processo de fundo real: se uma
 * implementação errada subir, o `after` mata tudo que cita a pasta temporária.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { impressaoDigital } from "../src/fundo/comum.js";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRAZO = { timeout: 30_000 };
const temps: string[] = [];

after(() => {
  for (const t of temps) {
    let pids: number[] = [];
    try {
      pids = execFileSync("pgrep", ["-f", t], { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] })
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
    fs.rmSync(t, { recursive: true, force: true });
  }
});

function homeVazio(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amsessao-"));
  temps.push(dir);
  return dir;
}

interface Envelope {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: { code: string; message: string };
}

function sessao(home: string, ...args: string[]): { status: number | null; envelope: Envelope; ms: number } {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home };
  delete env.AUTOMASTER_PERFIL;
  const inicio = Date.now();
  const r = spawnSync("npx", ["tsx", "src/cli.ts", "sessao", ...args, "--json"], {
    cwd: RAIZ,
    env,
    encoding: "utf-8",
    timeout: 20_000,
  });
  const ms = Date.now() - inicio;
  const linhas = r.stdout.trim().split("\n");
  let envelope: Envelope;
  try {
    envelope = JSON.parse(linhas.at(-1) ?? "");
  } catch {
    assert.fail(`última linha do stdout não é envelope: ${r.stdout}\nstderr: ${r.stderr}`);
  }
  return { status: r.status, envelope, ms };
}

const socketDe = (home: string) => path.join(home, ".automaster", "sessao", "sock");

test("status sem processo de fundo: rodando false, versão e perfil esperados, e nunca sobe nada", PRAZO, () => {
  const home = homeVazio();
  const { status, envelope, ms } = sessao(home, "--acao", "status");
  assert.equal(status, 0);
  assert.ok(ms < 5000, `status levou ${ms} ms`);
  assert.equal(envelope.ok, true);
  const d = envelope.data!;
  assert.equal(d.rodando, false);
  assert.match(String(d.versaoDoCodigo), /^[0-9a-f]{16}$/);
  assert.equal(d.versaoDoCodigo, impressaoDigital());
  assert.ok(String(d.perfilEsperado).endsWith(path.join(".automaster", "chrome-profile")));
  assert.equal(d.perfilEsperado, path.join(home, ".automaster", "chrome-profile"));
  assert.equal(d.atualizado, false);
  assert.equal(d.socket, socketDe(home));
  assert.equal(fs.existsSync(socketDe(home)), false, "status criou o socket: subiu o processo de fundo");
});

test("status é o padrão quando --acao não vem", PRAZO, () => {
  const home = homeVazio();
  const { status, envelope } = sessao(home);
  assert.equal(status, 0);
  assert.equal(envelope.data?.rodando, false);
  assert.equal(fs.existsSync(socketDe(home)), false);
});

test("encerrar sem processo de fundo: encerrado false", PRAZO, () => {
  const home = homeVazio();
  const { status, envelope } = sessao(home, "--acao", "encerrar");
  assert.equal(status, 0);
  assert.equal(envelope.ok, true);
  assert.equal(envelope.data?.encerrado, false);
  assert.equal(fs.existsSync(socketDe(home)), false);
});

test("tokens e renovar sem -l: código 1 e envelope de erro citando -l, sem subir nada", PRAZO, () => {
  const home = homeVazio();
  for (const acao of ["tokens", "renovar"]) {
    const { status, envelope } = sessao(home, "--acao", acao);
    assert.equal(status, 1, acao);
    assert.equal(envelope.ok, false, acao);
    assert.match(envelope.error!.message, /-l\b/, acao);
  }
  assert.equal(fs.existsSync(socketDe(home)), false);
});

test("ação desconhecida: código 1 e envelope de erro citando --acao", PRAZO, () => {
  const home = homeVazio();
  const { status, envelope } = sessao(home, "--acao", "qualquer");
  assert.equal(status, 1);
  assert.equal(envelope.ok, false);
  assert.match(envelope.error!.message, /--acao/);
  assert.equal(fs.existsSync(socketDe(home)), false);
});
