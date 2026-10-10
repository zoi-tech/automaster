import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { comandoDoPid, vivo } from "../src/auth/lock.js";
import { argsDoCarregador, caminhosDaSessao, ErroSessao, pedir } from "../src/fundo/comum.js";
import {
  encerrarFundo,
  estadoDoFundo,
  garantirFundo,
  renovarNoFundo,
  tokensDoFundo,
  type OpcoesFundo,
} from "../src/fundo/cliente.js";

// Cada teste sobe processos de fundo falsos: prazo próprio para falhar em vez de pendurar.
const PRAZO = { timeout: 30_000 };
const fundoFalso = fileURLToPath(new URL("./fixtures/fundo-falso.ts", import.meta.url));
const sobeESai = fileURLToPath(new URL("./fixtures/sobe-e-sai.ts", import.meta.url));
const AVISO_LOGIN = "O GHL pediu login: há uma janela do Chrome esperando você entrar (até 4 min e meio).";

// rede de segurança: se o `after` falhar, nenhum falso passa de 1 min ocioso
process.env.FUNDO_FALSO_OCIOSO_MS = "60000";

const temps: string[] = [];

/** Pids de qualquer processo com a pasta temporária no argv (falsos, dorme.mjs, falha.mjs). */
function processosDa(dir: string): number[] {
  try {
    return execFileSync("pgrep", ["-f", dir], { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] })
      .split("\n")
      .map(Number)
      .filter((p) => Number.isInteger(p) && p > 0 && p !== process.pid);
  } catch {
    return []; // pgrep sai com 1 quando não acha nada
  }
}

after(() => {
  for (const t of temps) {
    for (const pid of processosDa(t)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* já saiu */
      }
    }
    fs.rmSync(t, { recursive: true, force: true });
  }
});

function pasta(): { dir: string; lock: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amcli-"));
  temps.push(dir);
  return { dir, lock: path.join(dir, "chrome.lock") };
}

function opcoes(p: { dir: string; lock: string }, extra: Partial<OpcoesFundo> = {}): OpcoesFundo & { msgs: string[] } {
  const msgs: string[] = [];
  return {
    caminhos: caminhosDaSessao(p.dir),
    lock: p.lock,
    main: fundoFalso,
    perfil: "perfil-a",
    versao: process.env.FUNDO_FALSO_VERSAO ?? "falsa",
    esperaSubidaMs: 10_000,
    avisoMs: 5_000,
    corteMs: 5_000,
    log: (m: string) => msgs.push(m),
    ...extra,
    msgs,
  };
}

/** Roda `fn` com variáveis de ambiente trocadas (o filho herda) e as restaura no fim. */
async function comEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const antes: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    antes[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(antes)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function ler(arquivo: string): string {
  try {
    return fs.readFileSync(arquivo, "utf-8");
  } catch {
    return "";
  }
}

function linhas(arquivo: string): string[] {
  return ler(arquivo).split("\n").filter(Boolean);
}

async function esperarAte(cond: () => boolean | Promise<boolean>, ms: number, oQue: string): Promise<void> {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    if (await cond()) return;
    await sleep(100);
  }
  assert.fail(`${oQue}: não aconteceu em ${ms / 1000} s`);
}

/** O processo que responde é um falso de verdade, dono da trava do perfil. */
async function respondendo(o: OpcoesFundo) {
  const e = await estadoDoFundo(o);
  assert.ok(e, `ninguém responde no socket; fundo.log:\n${ler(o.caminhos.log)}`);
  assert.notEqual(e.pid, process.pid);
  assert.equal(ler(o.lock).trim(), `${e.pid} fundo`, "a trava do perfil não é de quem responde");
  assert.ok((comandoDoPid(e.pid) ?? "").includes(fundoFalso), `o pid ${e.pid} não é o processo de fundo falso`);
  return e;
}

async function rejeitaCom(p: Promise<unknown>, codigo: string): Promise<ErroSessao> {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof ErroSessao, `esperava ErroSessao, veio ${String(e)}`);
    assert.equal(e.codigo, codigo, `mensagem: ${e.message}`);
    return e;
  }
  assert.fail(`esperava rejeição ${codigo}, mas resolveu`);
}

// --- garantirFundo ---

test("sem processo de fundo: garantirFundo sobe um, que já responde com o pid, a versão e o perfil das opções", PRAZO, async () => {
  const p = pasta();
  await comEnv({ FUNDO_FALSO_VERSAO: "v-sobe" }, async () => {
    const o = opcoes(p, { perfil: "perfil-a" });
    assert.equal(await estadoDoFundo(o), null, "sem processo, estadoDoFundo deve ser null");
    await garantirFundo(o);
    const e = await respondendo(o); // já na volta, sem espera extra
    assert.equal(e.versao, "v-sobe");
    assert.equal(e.perfil, "perfil-a");
    assert.equal(e.esperandoLogin, false);
  });
});

test("corrida: duas chamadas simultâneas terminam com um processo só, e no máximo uma linha 'não subiu'", PRAZO, async () => {
  const p = pasta();
  await comEnv({ FUNDO_FALSO_VERSAO: "v-corrida" }, async () => {
    const a = opcoes(p);
    const b = opcoes(p);
    await Promise.all([garantirFundo(a), garantirFundo(b)]);
    const e = await respondendo(a);
    const v = await pedir(a.caminhos.socket, "GET", "/versao");
    assert.equal(v.corpo.pid, e.pid);
    // o perdedor, se subiu, sai sozinho com 1
    await esperarAte(() => processosDa(p.dir).length === 1, 5_000, "sobrar um processo de fundo só");
    const naoSubiu = linhas(a.caminhos.log).filter((l) => l.includes("não subiu"));
    assert.ok(naoSubiu.length <= 1, `fundo.log com ${naoSubiu.length} linhas "não subiu":\n${ler(a.caminhos.log)}`);
  });
});

test("versão diferente: o processo v1 é encerrado e um novo v2 responde", PRAZO, async () => {
  const p = pasta();
  const v1 = await comEnv({ FUNDO_FALSO_VERSAO: "v1" }, async () => {
    const o = opcoes(p);
    await garantirFundo(o);
    return respondendo(o);
  });
  await comEnv({ FUNDO_FALSO_VERSAO: "v2" }, async () => {
    const o = opcoes(p);
    await garantirFundo(o);
    const e = await respondendo(o);
    assert.equal(e.versao, "v2");
    assert.notEqual(e.pid, v1.pid);
    await esperarAte(() => !vivo(v1.pid), 3_000, `o processo velho (pid ${v1.pid}) morrer`);
  });
});

test("perfil diferente: o processo do perfil a é encerrado e um novo responde com o perfil b", PRAZO, async () => {
  const p = pasta();
  await comEnv({ FUNDO_FALSO_VERSAO: "v-perfil" }, async () => {
    const oa = opcoes(p, { perfil: "perfil-a" });
    await garantirFundo(oa);
    const a = await respondendo(oa);
    assert.equal(a.perfil, "perfil-a");

    const ob = opcoes(p, { perfil: "perfil-b" });
    await garantirFundo(ob);
    const b = await respondendo(ob);
    assert.equal(b.perfil, "perfil-b");
    assert.notEqual(b.pid, a.pid);
    await esperarAte(() => !vivo(a.pid), 3_000, `o processo do perfil a (pid ${a.pid}) morrer`);
  });
});

test("versão diferente esperando login: não troca, o pid continua o mesmo", PRAZO, async () => {
  const p = pasta();
  await comEnv({ FUNDO_FALSO_VERSAO: "v1", FUNDO_FALSO_MODO: "login", FUNDO_FALSO_LOGIN_MS: "3000" }, async () => {
    const o1 = opcoes(p, { versao: "v1" });
    await garantirFundo(o1);
    const antes = await respondendo(o1);
    // o handler já preso: a rejeição, se vier, não escapa como unhandledRejection
    const tokens = tokensDoFundo("sub-login", o1).catch((e: unknown) => e);
    try {
      await esperarAte(async () => (await estadoDoFundo(o1))?.esperandoLogin === true, 2_000, "o falso esperar login");
      const o2 = opcoes(p, { versao: "v2" });
      await garantirFundo(o2);
      const depois = await respondendo(o2);
      assert.equal(depois.pid, antes.pid, "trocou o processo com a janela de login aberta");
      assert.equal(depois.versao, "v1");
    } finally {
      await tokens;
    }
  });
});

test("trava do perfil com o discover: rejeita em menos de 1 s com sessao_indisponivel citando o discover", PRAZO, async () => {
  const p = pasta();
  fs.writeFileSync(p.lock, "1 discover");
  const o = opcoes(p);
  const t0 = Date.now();
  const e = await rejeitaCom(garantirFundo(o), "sessao_indisponivel");
  assert.ok(Date.now() - t0 < 1000, `demorou ${Date.now() - t0} ms`);
  assert.match(e.message, /discover/);
  assert.equal(ler(p.lock).trim(), "1 discover", "mexeu na trava do discover");
  assert.deepEqual(processosDa(p.dir), [], "subiu um processo de fundo com o discover no perfil");
});

test("trava 'fundo' de pid reaproveitado (pid 1) e sem socket: apaga a trava e sobe um processo novo", PRAZO, async () => {
  const p = pasta();
  fs.writeFileSync(p.lock, "1 fundo");
  const o = opcoes(p);
  await garantirFundo(o);
  const e = await respondendo(o);
  assert.notEqual(e.pid, 1);
});

test("processo de fundo saindo (socket já fora, trava ainda presa): garantirFundo espera e sobe um novo", PRAZO, async () => {
  const p = pasta();
  await comEnv({ FUNDO_FALSO_MODO: "sai-devagar" }, async () => {
    const o = opcoes(p);
    await garantirFundo(o);
    const velho = await respondendo(o);
    // ao receber /tokens, o falso apaga o socket e só solta a trava 1 s depois
    const r = await pedir(o.caminhos.socket, "POST", "/tokens", { subconta: "sub" });
    assert.equal(r.status, 503);
    assert.equal(ler(o.lock).trim(), `${velho.pid} fundo`, "a trava já tinha sido solta: o teste não prova nada");
    await garantirFundo(o);
    const novo = await respondendo(o);
    assert.notEqual(novo.pid, velho.pid);
  });
});

test("main que nunca escuta: rejeita com sessao_indisponivel citando o fundo.log", PRAZO, async () => {
  const p = pasta();
  const dorme = path.join(p.dir, "dorme.mjs");
  fs.writeFileSync(dorme, "setTimeout(() => {}, 3000);\n");
  const o = opcoes(p, { main: dorme, esperaSubidaMs: 1000 });
  const t0 = Date.now();
  const e = await rejeitaCom(garantirFundo(o), "sessao_indisponivel");
  assert.ok(Date.now() - t0 < 5000, `demorou ${Date.now() - t0} ms com esperaSubidaMs 1000`);
  assert.ok(e.message.includes(o.caminhos.log), `a mensagem não cita ${o.caminhos.log}: ${e.message}`);
});

test("main que grava 'não subiu' e sai com 1: o motivo chega na mensagem do erro", PRAZO, async () => {
  const p = pasta();
  const falha = path.join(p.dir, "falha.mjs");
  fs.writeFileSync(falha, 'console.log("não subiu: perfil X inválido");\nprocess.exit(1);\n');
  const o = opcoes(p, { main: falha, esperaSubidaMs: 1000 });
  const e = await rejeitaCom(garantirFundo(o), "sessao_indisponivel");
  assert.ok(e.message.includes("perfil X inválido"), `mensagem: ${e.message}`);
});

test("DEBUG do comando não chega ao processo de fundo", PRAZO, async () => {
  const p = pasta();
  await comEnv({ DEBUG: "pw:protocol" }, async () => {
    const o = opcoes(p);
    await garantirFundo(o);
    await respondendo(o);
  });
  assert.equal(ler(path.join(p.dir, "debug.txt")), "(nenhum)");
});

// --- tokensDoFundo / renovarNoFundo ---

test("tokensDoFundo sobe o processo se preciso e devolve os tokens do navegador falso", PRAZO, async () => {
  const p = pasta();
  const o = opcoes(p);
  const t = await tokensDoFundo("sub-1", o);
  assert.equal(t.userAgent, "UA falso");
  const loc = JSON.parse(Buffer.from(t.tokenId.split(".")[1], "base64url").toString("utf-8"));
  assert.deepEqual(loc.locations, ["sub-1"]);
  assert.deepEqual(linhas(path.join(p.dir, "capturas.log")), ["sub-1"]);
});

test("morre-uma-vez: o processo cai no meio do pedido, o comando religa uma vez e recebe os tokens", PRAZO, async () => {
  const p = pasta();
  await comEnv({ FUNDO_FALSO_MODO: "morre-uma-vez" }, async () => {
    const o = opcoes(p);
    const t = await tokensDoFundo("sub-m", o);
    assert.equal(t.userAgent, "UA falso");
    assert.deepEqual(linhas(path.join(p.dir, "capturas.log")), ["sub-m", "sub-m"]);
    assert.ok(o.msgs.some((m) => m.includes("religando")), `log: ${JSON.stringify(o.msgs)}`);
  });
});

test("morre-sempre: desiste depois de exatamente uma religação, com sessao_indisponivel", PRAZO, async () => {
  const p = pasta();
  await comEnv({ FUNDO_FALSO_MODO: "morre-sempre" }, async () => {
    const o = opcoes(p);
    await rejeitaCom(tokensDoFundo("sub-s", o), "sessao_indisponivel");
    assert.deepEqual(linhas(path.join(p.dir, "capturas.log")), ["sub-s", "sub-s"]);
  });
});

test("mudo: estoura o corte com sessao_indisponivel, sem religar", PRAZO, async () => {
  const p = pasta();
  await comEnv({ FUNDO_FALSO_MODO: "mudo" }, async () => {
    const o = opcoes(p, { corteMs: 200 });
    await rejeitaCom(tokensDoFundo("sub-mudo", o), "sessao_indisponivel");
    assert.deepEqual(linhas(path.join(p.dir, "capturas.log")), ["sub-mudo"]);
    assert.ok(!o.msgs.some((m) => m.includes("religando")), `religou: ${JSON.stringify(o.msgs)}`);
  });
});

test("login-mudo: estoura o corte esperando login e rejeita com login_pendente, sem religar", PRAZO, async () => {
  const p = pasta();
  await comEnv({ FUNDO_FALSO_MODO: "login-mudo" }, async () => {
    const o = opcoes(p, { corteMs: 200 });
    await rejeitaCom(tokensDoFundo("sub-lm", o), "login_pendente");
    assert.deepEqual(linhas(path.join(p.dir, "capturas.log")), ["sub-lm"]);
    assert.ok(!o.msgs.some((m) => m.includes("religando")), `religou: ${JSON.stringify(o.msgs)}`);
  });
});

test("login: avisa uma única vez que há uma janela esperando login, e os tokens chegam", PRAZO, async () => {
  const p = pasta();
  await comEnv({ FUNDO_FALSO_MODO: "login", FUNDO_FALSO_LOGIN_MS: undefined }, async () => {
    const o = opcoes(p, { avisoMs: 100 });
    const t = await tokensDoFundo("sub-l", o);
    assert.equal(t.userAgent, "UA falso");
    assert.equal(o.msgs.filter((m) => m === AVISO_LOGIN).length, 1, `log: ${JSON.stringify(o.msgs)}`);
  });
});

test("erro-login: 503 login_pendente vira ErroSessao login_pendente, sem religar", PRAZO, async () => {
  const p = pasta();
  await comEnv({ FUNDO_FALSO_MODO: "erro-login" }, async () => {
    const o = opcoes(p);
    const e = await rejeitaCom(tokensDoFundo("sub-el", o), "login_pendente");
    assert.doesNotMatch(e.message, /HTTP/);
    assert.deepEqual(linhas(path.join(p.dir, "capturas.log")), ["sub-el"]);
  });
});

test("renovarNoFundo manda o par que falhou e devolve um par novo", PRAZO, async () => {
  const p = pasta();
  const o = opcoes(p);
  const t1 = await tokensDoFundo("sub-r", o);
  const t2 = await renovarNoFundo("sub-r", t1, o);
  assert.notEqual(t2.bearer, t1.bearer);
  assert.notEqual(t2.tokenId, t1.tokenId);
  // o servidor só recaptura se reconheceu o par que falhou
  assert.deepEqual(linhas(path.join(p.dir, "capturas.log")), ["sub-r", "sub-r"]);
});

// --- encerrarFundo ---

test("encerrarFundo com processo vivo: true, e trava e socket somem e o navegador foi fechado", PRAZO, async () => {
  const p = pasta();
  const o = opcoes(p);
  await garantirFundo(o);
  await respondendo(o);
  assert.equal(await encerrarFundo(o), true);
  assert.equal(fs.existsSync(p.lock), false, "a trava do perfil ficou");
  assert.equal(fs.existsSync(o.caminhos.socket), false, "o socket ficou");
  assert.match(ler(path.join(p.dir, "navegador.log")), /fechado/);
});

test("encerrarFundo sem processo: false", PRAZO, async () => {
  const p = pasta();
  assert.equal(await encerrarFundo(opcoes(p)), false);
});

// --- pipes desacoplados ---

test("pipes desacoplados: o filho que chamou garantirFundo sai em menos de 10 s e o processo de fundo segue respondendo", PRAZO, async () => {
  const p = pasta();
  const t0 = Date.now();
  const r = await promisify(execFile)(
    process.execPath,
    [...argsDoCarregador(process.execArgv), sobeESai, p.dir, p.lock, fundoFalso],
    { timeout: 15_000, killSignal: "SIGKILL", encoding: "utf-8" },
  );
  const ms = Date.now() - t0;
  assert.ok(ms < 10_000, `o execFile levou ${ms} ms: os pipes ficaram presos ao processo de fundo`);
  assert.match(r.stdout, /pronto/);
  const v = await pedir(caminhosDaSessao(p.dir).socket, "GET", "/versao");
  assert.equal(v.status, 200);
  assert.equal(ler(p.lock).trim(), `${v.corpo.pid} fundo`);
});
