import { test, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { Tokens } from "../src/auth/token.js";
import { ErroSessao, pedir } from "../src/fundo/comum.js";
import { OCIOSO_MS, iniciarServidor, type Navegador } from "../src/fundo/servidor.js";

// Todo teste aqui sobe um servidor de verdade: o prazo próprio faz a suíte falhar em vez de pendurar.
const PRAZO = { timeout: 10_000 };

/** Monta um JWT de mentira: só o payload importa (igual a test/token.test.ts). */
function jwt(payload: Record<string, unknown>): string {
  const b64 = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  return `xxx.${b64}.yyy`;
}

/** Navegador falso: conta as capturas e devolve o que `responder` mandar. */
class Falso implements Navegador {
  capturas: string[] = [];
  fechou = 0;
  login = false;
  atraso = 0;
  responder: (subconta: string, n: number) => Tokens = (_s, n) => ({
    bearer: jwt({ tipo: "bearer", n }),
    tokenId: jwt({ tipo: "tokenId", n }),
    cookies: { "backend.leadconnectorhq.com": `c=${n}` },
    userAgent: "UA-teste",
  });
  async capturar(subconta: string): Promise<Tokens> {
    this.capturas.push(subconta);
    const n = this.capturas.length;
    // Teto contra servidor que recaptura em laço: a captura falsa resolve em microtarefa, e um
    // laço só de microtarefas nunca deixa o timeout do teste disparar.
    if (n > 20) throw new Error("laço de captura");
    if (this.atraso) await sleep(this.atraso);
    return this.responder(subconta, n);
  }
  esperandoLogin(): boolean {
    return this.login;
  }
  async fechar(): Promise<void> {
    this.fechou++;
  }
}

async function subir(
  nav: Navegador,
  extra: { agora?: () => number; log?: (m: string) => void; aoEncerrar?: () => void } = {},
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amfundo-"));
  const sock = path.join(dir, "sock");
  const srv = await iniciarServidor({ socket: sock, navegador: nav, versao: "9.9.9-teste", perfil: "/perfil/teste", ...extra });
  return { srv, sock };
}

const tokens = (sock: string, subconta: string) => pedir(sock, "POST", "/tokens", { subconta });

/** Espera uma condição girando o laço de eventos por setImmediate (que o mock de setTimeout não toca). */
async function girarAte(cond: () => boolean, voltas = 500): Promise<boolean> {
  for (let i = 0; i < voltas && !cond(); i++) await new Promise((r) => setImmediate(r));
  return cond();
}

// --- /versao ----------------------------------------------------------------

test("GET /versao devolve versão, pid, perfil e esperandoLogin lido na hora", PRAZO, async () => {
  const nav = new Falso();
  const { srv, sock } = await subir(nav);
  try {
    const r1 = await pedir(sock, "GET", "/versao");
    assert.equal(r1.status, 200);
    assert.deepEqual(r1.corpo, { versao: "9.9.9-teste", pid: process.pid, perfil: "/perfil/teste", esperandoLogin: false });
    nav.login = true;
    const r2 = await pedir(sock, "GET", "/versao");
    assert.equal(r2.corpo.esperandoLogin, true);
  } finally {
    await srv.encerrar("fim do teste");
  }
});

// --- /tokens: cache e captura única -------------------------------------------

test("POST /tokens captura na primeira vez e serve do cache na segunda", PRAZO, async () => {
  const nav = new Falso();
  const { srv, sock } = await subir(nav);
  try {
    const r1 = await tokens(sock, "LOC1");
    assert.equal(r1.status, 200);
    assert.deepEqual(r1.corpo, nav.responder("LOC1", 1));
    assert.deepEqual(nav.capturas, ["LOC1"]);
    const r2 = await tokens(sock, "LOC1");
    assert.deepEqual(r2.corpo, r1.corpo);
    assert.equal(nav.capturas.length, 1);
  } finally {
    await srv.encerrar("fim do teste");
  }
});

test("cinco POST /tokens simultâneos sem cache: uma captura só, todos com os mesmos tokens", PRAZO, async () => {
  const nav = new Falso();
  nav.atraso = 150;
  const { srv, sock } = await subir(nav);
  try {
    const rs = await Promise.all(Array.from({ length: 5 }, () => tokens(sock, "LOC1")));
    assert.equal(nav.capturas.length, 1);
    for (const r of rs) {
      assert.equal(r.status, 200);
      assert.deepEqual(r.corpo, rs[0].corpo);
    }
    assert.equal(typeof rs[0].corpo.bearer, "string");
  } finally {
    await srv.encerrar("fim do teste");
  }
});

// --- validade pelo relógio ------------------------------------------------------

for (const qual of ["bearer", "tokenId"] as const) {
  test(`${qual} a 30 s do exp recaptura; a 2 min, não`, PRAZO, async () => {
    const exp = 2_000_000_000; // segundos
    let agora = exp * 1000 - 10 * 60_000;
    const nav = new Falso();
    nav.responder = (_s, n) => {
      // a primeira captura vence em `exp`; as seguintes, uma hora depois
      const venc = n === 1 ? exp : exp + 3600;
      const outro = exp + 86_400;
      return {
        bearer: jwt({ n, exp: qual === "bearer" ? venc : outro }),
        tokenId: jwt({ n, exp: qual === "tokenId" ? venc : outro }),
      };
    };
    const { srv, sock } = await subir(nav, { agora: () => agora });
    try {
      await tokens(sock, "LOC1");
      assert.equal(nav.capturas.length, 1);

      agora = exp * 1000 - 2 * 60_000;
      const r2 = await tokens(sock, "LOC1");
      assert.equal(nav.capturas.length, 1, "a 2 min do exp ainda vale");
      assert.deepEqual(r2.corpo, nav.responder("LOC1", 1));

      agora = exp * 1000 - 30_000;
      const r3 = await tokens(sock, "LOC1");
      assert.equal(nav.capturas.length, 2, "a 30 s do exp recaptura");
      assert.deepEqual(r3.corpo, nav.responder("LOC1", 2));
    } finally {
      await srv.encerrar("fim do teste");
    }
  });
}

test("token sem exp conta como válido", PRAZO, async () => {
  const nav = new Falso(); // o padrão do falso não tem exp
  const { srv, sock } = await subir(nav, { agora: () => 4_000_000_000_000 });
  try {
    await tokens(sock, "LOC1");
    await tokens(sock, "LOC1");
    await tokens(sock, "LOC1");
    assert.equal(nav.capturas.length, 1);
  } finally {
    await srv.encerrar("fim do teste");
  }
});

test("recaptura no máximo uma vez por pedido, mesmo se o token novo já nasce perto de vencer", PRAZO, async () => {
  const agora = 1_900_000_000_000;
  const nav = new Falso();
  nav.responder = (_s, n) => ({ bearer: jwt({ n, exp: agora / 1000 + 10 }), tokenId: jwt({ n }) });
  const { srv, sock } = await subir(nav, { agora: () => agora });
  try {
    const r1 = await tokens(sock, "LOC1");
    assert.equal(r1.status, 200);
    assert.equal(nav.capturas.length, 1);
    const r2 = await tokens(sock, "LOC1");
    assert.equal(r2.status, 200);
    assert.equal(nav.capturas.length, 2, "uma captura por pedido, não um laço");
    assert.deepEqual(r2.corpo, nav.responder("LOC1", 2));
  } finally {
    await srv.encerrar("fim do teste");
  }
});

// --- subconta fora da lista do token-id ---------------------------------------

test("subconta fora de `locations` do token-id recaptura passando essa subconta ao navegador", PRAZO, async () => {
  const nav = new Falso();
  nav.responder = (_s, n) => ({
    bearer: jwt({ n }),
    tokenId: jwt({ n, locations: n === 1 ? ["LOC1"] : ["LOC1", "LOC2"] }),
  });
  const { srv, sock } = await subir(nav);
  try {
    await tokens(sock, "LOC1");
    const r = await tokens(sock, "LOC2");
    assert.deepEqual(nav.capturas, ["LOC1", "LOC2"]);
    assert.deepEqual(r.corpo, nav.responder("LOC2", 2));
    await tokens(sock, "LOC1");
    await tokens(sock, "LOC2");
    assert.equal(nav.capturas.length, 2);
  } finally {
    await srv.encerrar("fim do teste");
  }
});

for (const [rotulo, extra] of [
  ["sem `locations`", {}],
  ["com `locations` vazia", { locations: [] }],
] as const) {
  test(`token-id ${rotulo} não recaptura por subconta`, PRAZO, async () => {
    const nav = new Falso();
    nav.responder = (_s, n) => ({ bearer: jwt({ n }), tokenId: jwt({ n, ...extra }) });
    const { srv, sock } = await subir(nav);
    try {
      await tokens(sock, "LOC1");
      await tokens(sock, "LOC2");
      await tokens(sock, "LOC3");
      assert.deepEqual(nav.capturas, ["LOC1"]);
    } finally {
      await srv.encerrar("fim do teste");
    }
  });
}

test("subconta que a navegação nunca põe na lista: tenta uma vez por token-id, não a cada pedido", PRAZO, async () => {
  let versaoDoTokenId = 1;
  const nav = new Falso();
  // o token-id nunca traz LOC2; o texto só muda quando o teste troca a versão
  nav.responder = (_s, n) => ({ bearer: jwt({ n }), tokenId: jwt({ v: versaoDoTokenId, locations: ["LOC1"] }) });
  const { srv, sock } = await subir(nav);
  try {
    await tokens(sock, "LOC1");
    assert.equal(nav.capturas.length, 1);

    await tokens(sock, "LOC2");
    await tokens(sock, "LOC2");
    assert.equal(nav.capturas.length, 2, "o segundo pedido para LOC2 sai do cache");

    // recaptura que devolve o MESMO token-id não reabre a tentativa de LOC2
    const atual = (await tokens(sock, "LOC1")).corpo;
    await pedir(sock, "POST", "/renovar", { subconta: "LOC1", bearer: atual.bearer, tokenId: atual.tokenId });
    assert.equal(nav.capturas.length, 3);
    await tokens(sock, "LOC2");
    assert.equal(nav.capturas.length, 3, "token-id igual: LOC2 continua tentada");

    // token-id novo (outro texto): LOC2 volta a merecer uma tentativa, uma só
    versaoDoTokenId = 2;
    const atual2 = (await tokens(sock, "LOC1")).corpo;
    await pedir(sock, "POST", "/renovar", { subconta: "LOC1", bearer: atual2.bearer, tokenId: atual2.tokenId });
    assert.equal(nav.capturas.length, 4);
    await tokens(sock, "LOC2");
    assert.equal(nav.capturas.length, 5, "token-id novo: LOC2 recaptura de novo");
    assert.equal(nav.capturas[4], "LOC2");
    await tokens(sock, "LOC2");
    assert.equal(nav.capturas.length, 5);
  } finally {
    await srv.encerrar("fim do teste");
  }
});

// --- /renovar -------------------------------------------------------------------

test("POST /renovar com o par atual recaptura; com par antigo devolve o atual sem capturar", PRAZO, async () => {
  const nav = new Falso();
  const { srv, sock } = await subir(nav);
  try {
    const t1 = (await tokens(sock, "LOC1")).corpo;
    const r2 = await pedir(sock, "POST", "/renovar", { subconta: "LOC1", bearer: t1.bearer, tokenId: t1.tokenId });
    assert.equal(r2.status, 200);
    assert.equal(nav.capturas.length, 2);
    assert.deepEqual(r2.corpo, nav.responder("LOC1", 2));
    assert.notEqual(r2.corpo.bearer, t1.bearer);

    const r3 = await pedir(sock, "POST", "/renovar", { subconta: "LOC1", bearer: t1.bearer, tokenId: t1.tokenId });
    assert.equal(r3.status, 200);
    assert.equal(nav.capturas.length, 2, "par antigo: o atual sai sem captura");
    assert.deepEqual(r3.corpo, r2.corpo);
  } finally {
    await srv.encerrar("fim do teste");
  }
});

test("três /renovar simultâneos com o mesmo par atual: uma captura só", PRAZO, async () => {
  const nav = new Falso();
  const { srv, sock } = await subir(nav);
  try {
    const t1 = (await tokens(sock, "LOC1")).corpo;
    nav.atraso = 150;
    const corpo = { subconta: "LOC1", bearer: t1.bearer, tokenId: t1.tokenId };
    const rs = await Promise.all([1, 2, 3].map(() => pedir(sock, "POST", "/renovar", corpo)));
    assert.equal(nav.capturas.length, 2, "1 inicial + 1 renovação");
    for (const r of rs) {
      assert.equal(r.status, 200);
      assert.deepEqual(r.corpo, nav.responder("LOC1", 2));
    }
  } finally {
    await srv.encerrar("fim do teste");
  }
});

// --- erros --------------------------------------------------------------------

test("ErroSessao login_pendente vira 503 {code: login_pendente, message}", PRAZO, async () => {
  const nav = new Falso();
  nav.responder = () => {
    throw new ErroSessao("login_pendente", "entre no GHL na janela aberta");
  };
  const { srv, sock } = await subir(nav);
  try {
    const r = await tokens(sock, "LOC1");
    assert.equal(r.status, 503);
    assert.deepEqual(r.corpo, { code: "login_pendente", message: "entre no GHL na janela aberta" });
  } finally {
    await srv.encerrar("fim do teste");
  }
});

test("erro comum do navegador vira 503 {code: sessao_indisponivel, message}", PRAZO, async () => {
  const nav = new Falso();
  nav.responder = () => {
    throw new Error("x");
  };
  const { srv, sock } = await subir(nav);
  try {
    const r = await tokens(sock, "LOC1");
    assert.equal(r.status, 503);
    assert.deepEqual(r.corpo, { code: "sessao_indisponivel", message: "x" });
  } finally {
    await srv.encerrar("fim do teste");
  }
});

test("três pedidos simultâneos com login pendente: 1 captura, três 503; o erro não fica guardado", PRAZO, async () => {
  const nav = new Falso();
  nav.atraso = 150;
  nav.responder = () => {
    throw new ErroSessao("login_pendente", "faça login");
  };
  const { srv, sock } = await subir(nav);
  try {
    const rs = await Promise.all([1, 2, 3].map(() => tokens(sock, "LOC1")));
    assert.equal(nav.capturas.length, 1);
    for (const r of rs) {
      assert.equal(r.status, 503);
      assert.deepEqual(r.corpo, { code: "login_pendente", message: "faça login" });
    }
    const r4 = await tokens(sock, "LOC1");
    assert.equal(r4.status, 503);
    assert.equal(nav.capturas.length, 2, "pedido depois do erro tenta capturar de novo");
  } finally {
    await srv.encerrar("fim do teste");
  }
});

test("POST /tokens sem subconta: 400 e nenhuma captura", PRAZO, async () => {
  const nav = new Falso();
  const { srv, sock } = await subir(nav);
  try {
    const r = await pedir(sock, "POST", "/tokens", {});
    assert.equal(r.status, 400);
    assert.equal(nav.capturas.length, 0);
  } finally {
    await srv.encerrar("fim do teste");
  }
});

// --- encerramento ---------------------------------------------------------------

test("POST /encerrar responde 200, fecha o navegador, apaga o socket e chama aoEncerrar", PRAZO, async () => {
  const nav = new Falso();
  let noAoEncerrar: { fechou: number; socketExiste: boolean } | null = null;
  let sockRef = "";
  const { srv, sock } = await subir(nav, {
    aoEncerrar: () => {
      noAoEncerrar = { fechou: nav.fechou, socketExiste: fs.existsSync(sockRef) };
    },
  });
  sockRef = sock;
  try {
    const r = await pedir(sock, "POST", "/encerrar");
    assert.equal(r.status, 200);
    assert.ok(await girarAte(() => noAoEncerrar !== null), "aoEncerrar não foi chamado");
    assert.deepEqual(noAoEncerrar, { fechou: 1, socketExiste: false });
    assert.equal(fs.existsSync(sock), false);
  } finally {
    await srv.encerrar("fim do teste");
  }
});

test("ociosidade: encerra OCIOSO_MS (4 h) depois do último pedido, e um pedido no meio adia", PRAZO, async () => {
  assert.equal(OCIOSO_MS, 4 * 60 * 60 * 1000);
  const H = 60 * 60 * 1000;
  mock.timers.enable({ apis: ["setTimeout"] });
  const nav = new Falso();
  let encerrou = 0;
  let srv: Awaited<ReturnType<typeof iniciarServidor>> | undefined;
  try {
    const s = await subir(nav, { aoEncerrar: () => encerrou++ });
    srv = s.srv;
    const encerrado = () => nav.fechou > 0 || encerrou > 0;

    // 3 h, pedido, mais 3 h: o pedido adiou
    mock.timers.tick(3 * H);
    await girarAte(() => false, 20);
    assert.equal(encerrado(), false);
    await tokens(s.sock, "LOC1");
    await girarAte(() => false, 20);
    mock.timers.tick(3 * H);
    await girarAte(() => false, 50);
    assert.equal(encerrado(), false, "o pedido no meio deveria ter adiado o encerramento");

    // contando do pedido: OCIOSO_MS - 1 não encerra, mais 1 ms encerra
    mock.timers.tick(OCIOSO_MS - 3 * H - 1);
    await girarAte(() => false, 50);
    assert.equal(encerrado(), false, "encerrou 1 ms antes da hora");
    mock.timers.tick(1);
    assert.ok(await girarAte(() => encerrou > 0), "não encerrou por ociosidade");
    assert.equal(nav.fechou, 1);
    assert.equal(encerrou, 1);
    assert.equal(fs.existsSync(s.sock), false);
  } finally {
    mock.timers.reset();
    await srv?.encerrar("fim do teste");
  }
});

// --- socket ---------------------------------------------------------------------

test("o socket nasce com 0600 e um arquivo velho no caminho não impede a subida", PRAZO, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amfundo-"));
  const sock = path.join(dir, "sock");
  fs.writeFileSync(sock, "sobra de processo morto");
  const nav = new Falso();
  const srv = await iniciarServidor({ socket: sock, navegador: nav, versao: "1", perfil: "/p" });
  try {
    assert.equal(fs.statSync(sock).mode & 0o777, 0o600);
    assert.ok(fs.statSync(sock).isSocket());
    const r = await pedir(sock, "GET", "/versao");
    assert.equal(r.status, 200);
  } finally {
    await srv.encerrar("fim do teste");
  }
});

// --- log --------------------------------------------------------------------------

test("o log nunca recebe o texto de um bearer ou token-id entregue", PRAZO, async () => {
  const nav = new Falso();
  nav.responder = (_s, n) => ({
    bearer: jwt({ segredo: `bearer-${n}` }),
    tokenId: jwt({ segredo: `tokenid-${n}`, locations: n === 1 ? ["LOC1"] : ["LOC1", "LOC2"] }),
  });
  const linhas: string[] = [];
  const { srv, sock } = await subir(nav, { log: (m) => linhas.push(m) });
  const entregues: Tokens[] = [];
  try {
    entregues.push((await tokens(sock, "LOC1")).corpo); // inicio
    entregues.push((await tokens(sock, "LOC1")).corpo); // cache
    entregues.push((await tokens(sock, "LOC2")).corpo); // subconta
    const t = entregues[2];
    entregues.push((await pedir(sock, "POST", "/renovar", { subconta: "LOC2", bearer: t.bearer, tokenId: t.tokenId })).corpo); // 401
  } finally {
    await srv.encerrar("fim do teste");
  }
  assert.ok(linhas.length >= 4, `esperava uma linha por pedido, veio ${linhas.length}`);
  const tudo = linhas.join("\n");
  for (const t of entregues) {
    for (const segredo of [t.bearer, t.tokenId, t.bearer.split(".")[1], t.tokenId.split(".")[1]]) {
      assert.ok(!tudo.includes(segredo), `token apareceu no log: ${segredo.slice(0, 12)}…`);
    }
  }
});
