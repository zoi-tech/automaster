import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TravaOcupada, comandoDoPid, entrarNaFila, lerTrava, travarChrome } from "../src/auth/lock.js";

const tmp = (): string => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "amlock-")), "chrome.lock");
const PID_MORTO = 2147480000; // PID que não existe

/** Arquivo de trava já segurado por `conteudo` (pid 1, o init, está sempre vivo). */
function seguradoPor(conteudo: string): string {
  const arq = tmp();
  fs.writeFileSync(arq, conteudo);
  return arq;
}

/** Erro esperado de trava ocupada: classe, pid, rótulo, arquivo e texto da mensagem. */
function ocupada(arq: string, pid: number, rotulo: string, ...textos: RegExp[]) {
  return (e: unknown): boolean => {
    assert.ok(e instanceof TravaOcupada, `esperava TravaOcupada, veio ${String(e)}`);
    assert.ok(e instanceof Error);
    assert.equal(e.pid, pid);
    assert.equal(e.rotulo, rotulo);
    assert.equal(e.arquivo, arq);
    for (const t of textos) assert.match(e.message, t);
    return true;
  };
}

test("segunda trava do mesmo perfil falha enquanto a primeira está viva", () => {
  const arq = tmp();
  const soltar = travarChrome(arq);
  fs.writeFileSync(arq, "1"); // pid 1 (init) está sempre vivo: simula outro processo segurando
  assert.throws(() => travarChrome(arq), /\(pid 1\)/);
  fs.writeFileSync(arq, String(process.pid));
  soltar();
  assert.equal(fs.existsSync(arq), false);
});

test("lock órfão de processo morto é roubado", () => {
  const arq = tmp();
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  fs.writeFileSync(arq, String(PID_MORTO));
  const soltar = travarChrome(arq);
  assert.equal(fs.readFileSync(arq, "utf-8"), String(process.pid));
  soltar();
});

test("travar com rótulo grava '<pid> <rótulo>', lerTrava devolve os dois, soltar apaga", () => {
  const arq = tmp();
  const soltar = travarChrome(arq, "fundo");
  assert.equal(fs.readFileSync(arq, "utf-8"), `${process.pid} fundo`);
  assert.deepEqual(lerTrava(arq), { pid: process.pid, rotulo: "fundo" });
  soltar();
  assert.equal(fs.existsSync(arq), false);
});

test("trava do discover: TravaOcupada com pid, rótulo e mensagem que cita o discover", () => {
  const arq = seguradoPor("1 discover");
  assert.throws(() => travarChrome(arq, "fundo"), ocupada(arq, 1, "discover", /discover/, /\(pid 1\)/));
  assert.equal(fs.readFileSync(arq, "utf-8"), "1 discover", "a trava alheia não pode ser tocada");
});

test("trava do processo de fundo: mensagem diz que o processo de fundo está com o perfil", () => {
  const arq = seguradoPor("1 fundo");
  assert.throws(
    () => travarChrome(arq),
    ocupada(arq, 1, "fundo", /processo de fundo do automaster/, /perfil/, /\(pid 1\)/),
  );
});

test("trava sem rótulo (formato antigo, só o pid): mensagem cita o pid e o caminho do arquivo", () => {
  const arq = seguradoPor("1");
  assert.throws(() => travarChrome(arq, "fundo"), ocupada(arq, 1, "", /\(pid 1\)/));
  assert.throws(() => travarChrome(arq, "fundo"), (e: unknown) => (e as Error).message.includes(arq));
});

test("trava de pid vivo gravada antes do último boot é roubada (pid pode ter sido reaproveitado)", () => {
  const arq = seguradoPor("1 discover");
  fs.utimesSync(arq, new Date(0), new Date(0)); // 1970: antes de qualquer boot
  const soltar = travarChrome(arq, "fundo");
  assert.equal(fs.readFileSync(arq, "utf-8"), `${process.pid} fundo`);
  soltar();
  assert.equal(fs.existsSync(arq), false);
});

test("lerTrava devolve null para arquivo ausente, pid morto e arquivo de antes do boot", () => {
  assert.equal(lerTrava(tmp()), null);
  assert.equal(lerTrava(seguradoPor(`${PID_MORTO} fundo`)), null);
  const antigo = seguradoPor("1 fundo");
  fs.utimesSync(antigo, new Date(0), new Date(0));
  assert.equal(lerTrava(antigo), null);
  // controle: o mesmo arquivo com data de agora tem dono
  assert.deepEqual(lerTrava(seguradoPor("1 fundo")), { pid: 1, rotulo: "fundo" });
});

test("comandoDoPid devolve a linha de comando do processo, e null para pid que não existe", () => {
  const cmd = comandoDoPid(process.pid);
  assert.ok(cmd && cmd.includes("node"), `esperava 'node' em ${String(cmd)}`);
  assert.equal(comandoDoPid(PID_MORTO), null);
});

test("entrarNaFila com a fila livre resolve na hora, grava '<pid> escrita' e a saída apaga", async () => {
  const arq = tmp();
  const logs: string[] = [];
  const inicio = Date.now();
  const sair = await entrarNaFila(arq, (m) => logs.push(m));
  assert.ok(Date.now() - inicio < 400, "fila livre não espera");
  assert.equal(fs.readFileSync(arq, "utf-8"), `${process.pid} escrita`);
  assert.deepEqual(logs, []);
  sair();
  assert.equal(fs.existsSync(arq), false);
});

test("entrarNaFila espera a escrita anterior terminar e avisa uma vez só", async () => {
  const arq = seguradoPor("1 escrita");
  const logs: string[] = [];
  const liberar = setTimeout(() => fs.rmSync(arq, { force: true }), 300);
  const inicio = Date.now();
  try {
    const sair = await entrarNaFila(arq, (m) => logs.push(m), 5_000);
    assert.ok(Date.now() - inicio >= 250, "resolveu antes de a fila ser liberada");
    assert.equal(fs.readFileSync(arq, "utf-8"), `${process.pid} escrita`);
    sair();
  } finally {
    clearTimeout(liberar);
  }
  assert.equal(logs.length, 1, `log chamado ${logs.length} vezes: ${JSON.stringify(logs)}`);
  assert.match(logs[0], /esperando a vez/);
  assert.match(logs[0], /\(pid 1\)/);
});

test("entrarNaFila desiste passado esperaMaxMs, citando a fila de escrita e o pid", async () => {
  const arq = seguradoPor("1 escrita");
  const logs: string[] = [];
  await assert.rejects(entrarNaFila(arq, (m) => logs.push(m), 300), (e: unknown) => {
    assert.match((e as Error).message, /fila de escrita/);
    // o "como fazer" do plano escreve "com o pid 1", a prova escreve "(pid 1)": vale citar o pid
    assert.match((e as Error).message, /pid 1\b/);
    return true;
  });
  assert.equal(fs.readFileSync(arq, "utf-8"), "1 escrita", "a trava alheia não pode ser tocada");
  assert.equal(logs.length, 1, `o aviso de espera sai uma vez só, não a cada tentativa: ${JSON.stringify(logs)}`);
});

test("a espera padrão da fila é PRAZOS.filaEscritaMs", () => {
  const fonte = fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "auth", "lock.ts"),
    "utf-8",
  );
  const assinatura = /export async function entrarNaFila\(([\s\S]*?)\): Promise/.exec(fonte);
  assert.ok(assinatura, "entrarNaFila não encontrada em src/auth/lock.ts");
  assert.ok(assinatura[1].includes("esperaMaxMs: number = PRAZOS.filaEscritaMs"), assinatura[1]);
});
