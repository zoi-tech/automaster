/**
 * Prévia visual de formulário/survey fora do perfil: um Chrome sem perfil, sem trava e sem
 * processo de fundo, que só fotografa a página pública do widget. Nada aqui abre Chrome de
 * verdade: o navegador é falso e a CLI só roda o caminho que falha antes de abrir qualquer coisa.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser } from "playwright";
import { fotografarWidget } from "../src/cli/formularios.js";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRAZO = { timeout: 30_000 };
const URL_WIDGET = "https://link.msgsndr.com/widget/form/abc123?notrack=true";
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

/** Navegador falso: registra cada chamada, na ordem, com os argumentos. */
function navegadorFalso(opcoes: { seletorFalha?: boolean } = {}) {
  const eventos: { nome: string; args: unknown[] }[] = [];
  const reg = (nome: string) => (...args: unknown[]) => {
    eventos.push({ nome, args });
    return Promise.resolve();
  };
  const aba = {
    goto: reg("goto"),
    waitForSelector: (...args: unknown[]) => {
      eventos.push({ nome: "waitForSelector", args });
      return opcoes.seletorFalha ? Promise.reject(new Error("Timeout 15000ms exceeded.")) : Promise.resolve(null);
    },
    waitForTimeout: reg("waitForTimeout"),
    screenshot: reg("screenshot"),
    setViewportSize: reg("setViewportSize"),
    close: reg("aba.close"),
  };
  const navegador = {
    newPage: (...args: unknown[]) => {
      eventos.push({ nome: "newPage", args });
      return Promise.resolve(aba);
    },
    close: reg("navegador.close"),
  };
  const aberturas: unknown[][] = [];
  const abrir = (...args: unknown[]) => {
    aberturas.push(args);
    return Promise.resolve(navegador as unknown as Browser);
  };
  return { eventos, aberturas, abrir: abrir as () => Promise<Browser> };
}

const nomes = (eventos: { nome: string }[]) => eventos.map((e) => e.nome);

test("fotografarWidget abre um navegador sem argumento, viewport 480x900, espera o campo, fotografa a página inteira e fecha", PRAZO, async () => {
  const f = navegadorFalso();
  const destino = path.join(os.tmpdir(), "previa-teste.png");
  await fotografarWidget(URL_WIDGET, destino, f.abrir);

  assert.equal(f.aberturas.length, 1, "abrir chamado uma vez");
  assert.equal(f.aberturas[0].length, 0, "abrir chamado sem argumento (nenhum perfil)");

  const novaAba = f.eventos.filter((e) => e.nome === "newPage");
  assert.equal(novaAba.length, 1);
  assert.deepEqual(
    (novaAba[0].args[0] as { viewport?: unknown } | undefined)?.viewport,
    { width: 480, height: 900 },
    "a página nasce com viewport 480x900",
  );

  const goto = f.eventos.find((e) => e.nome === "goto");
  assert.equal(goto?.args[0], URL_WIDGET);

  const espera = f.eventos.find((e) => e.nome === "waitForSelector");
  assert.equal(espera?.args[0], "form, input, button");

  const fotos = f.eventos.filter((e) => e.nome === "screenshot");
  assert.equal(fotos.length, 1);
  assert.deepEqual(
    { path: (fotos[0].args[0] as { path?: string }).path, fullPage: (fotos[0].args[0] as { fullPage?: boolean }).fullPage },
    { path: destino, fullPage: true },
  );

  const ordem = nomes(f.eventos);
  assert.equal(ordem.filter((n) => n === "navegador.close").length, 1, "o navegador é fechado uma vez");
  assert.ok(ordem.indexOf("goto") < ordem.indexOf("waitForSelector"), `ordem: ${ordem.join(", ")}`);
  assert.ok(ordem.indexOf("waitForSelector") < ordem.indexOf("screenshot"), `ordem: ${ordem.join(", ")}`);
  assert.ok(ordem.indexOf("screenshot") < ordem.indexOf("navegador.close"), `ordem: ${ordem.join(", ")}`);
});

test("fotografarWidget sem campo renderizado rejeita com a mensagem dos 15 s e a URL, e fecha o navegador do mesmo jeito", PRAZO, async () => {
  const f = navegadorFalso({ seletorFalha: true });
  await assert.rejects(
    fotografarWidget(URL_WIDGET, path.join(os.tmpdir(), "previa-falha.png"), f.abrir),
    (e: Error) => {
      assert.match(e.message, /página pública não renderizou nenhum campo em 15 ?s/);
      assert.ok(e.message.includes(URL_WIDGET), `mensagem sem a URL: ${e.message}`);
      return true;
    },
  );
  const ordem = nomes(f.eventos);
  assert.ok(!ordem.includes("screenshot"), "não fotografa página sem campo");
  assert.equal(ordem.filter((n) => n === "navegador.close").length, 1, "o navegador é fechado mesmo com a falha");
});

test("a prévia usa chromium.launch, nunca o perfil persistente", () => {
  const fonte = fs.readFileSync(path.join(RAIZ, "src", "cli", "formularios.ts"), "utf-8");
  const inicio = fonte.indexOf("export async function fotografarWidget");
  assert.ok(inicio >= 0, "fotografarWidget não está exportada de src/cli/formularios.ts");
  const fim = fonte.indexOf("\n}\n", inicio);
  const trecho = fonte.slice(inicio, fim < 0 ? undefined : fim);
  assert.ok(trecho.includes("chromium.launch("), "o trecho de fotografarWidget não chama chromium.launch(");
  assert.ok(!trecho.includes("launchPersistentContext"), "fotografarWidget abre o perfil persistente");
});

test("previa-visual sem --id falha com o envelope e não passa pela sessão", PRAZO, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "amprevia-"));
  temps.push(home);
  // Rede de segurança: `.automaster` existe como ARQUIVO. Uma implementação que ainda passe
  // pela sessão (trava do perfil, pasta do processo de fundo) quebra no mkdir antes de
  // abrir Chrome e sai com outra mensagem, em vez de abrir uma janela na máquina de quem testa.
  const sentinela = path.join(home, ".automaster");
  fs.writeFileSync(sentinela, "sentinela");
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home };
  delete env.AUTOMASTER_PERFIL;

  const r = spawnSync(
    "npx",
    ["tsx", "src/cli.ts", "formulario-estilo", "-l", "X", "--acao", "previa-visual", "--json"],
    { cwd: RAIZ, env, encoding: "utf-8", timeout: 20_000 },
  );

  assert.equal(r.status, 1, `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
  const ultima = r.stdout.trim().split("\n").at(-1) ?? "";
  let envelope: { ok: boolean; error?: { message: string } };
  try {
    envelope = JSON.parse(ultima);
  } catch {
    assert.fail(`última linha do stdout não é envelope: ${r.stdout}\nstderr: ${r.stderr}`);
  }
  assert.equal(envelope.ok, false);
  assert.match(envelope.error?.message ?? "", /previa-visual exige --id/);

  assert.ok(fs.statSync(sentinela).isFile(), "a pasta .automaster foi criada");
  assert.equal(fs.readFileSync(sentinela, "utf-8"), "sentinela");
});
