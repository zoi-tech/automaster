import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BrowserContext } from "playwright";
import { setTimeout as sleep } from "node:timers/promises";
import { UA_PADRAO } from "../src/api/client.js";
import { ErroSessao } from "../src/fundo/comum.js";
import { ChromeDeFundo, donoDoPerfil, uaDoPerfil, uaHeadless } from "../src/fundo/chrome.js";

// Sem Chrome no CI (A52): contexto e página falsos. Prazo próprio para falhar em vez de pendurar.
const PRAZO = { timeout: 10_000 };

const URL_LOGIN = "https://app.gohighlevel.com/?url=%2Fv2%2Flocation%2FX%2Fautomation%2Fworkflows";
const BEARER = "BEARER-SECRETO-123";
const TOKEN_ID = "TOKENID-SECRETO-456";
const UA_NORMAL =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36";
const CHROME_BIN = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function pastaTemp(prefixo: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefixo));
}

/** Perfil temporário sem SingletonLock, com a versão do Chrome que o `uaDoPerfil` lê. */
function perfilTemp(): string {
  const p = pastaTemp("amperfil-");
  fs.writeFileSync(path.join(p, "Last Version"), "154.0.8037.98");
  return p;
}

type Ouvinte = (r: unknown) => void;

/** Página falsa: guarda os `goto`; no da tela de workflows emite um request com os tokens. */
class PaginaFalsa {
  gotos: string[] = [];
  ouvintes: Ouvinte[] = [];
  fechada = false;
  constructor(
    readonly modo: {
      login?: boolean;
      headers?: Record<string, string>;
      falhar?: () => boolean;
      /** Forma real da queda: o goto rejeita (o captureTokens engole) e a página passa a estar fechada. */
      cair?: () => boolean;
      aoGoto?: (url: string) => void;
    } = {},
  ) {}
  on(ev: string, fn: Ouvinte) {
    if (ev === "request") this.ouvintes.push(fn);
    return this;
  }
  off(ev: string, fn: Ouvinte) {
    if (ev === "request") this.ouvintes = this.ouvintes.filter((f) => f !== fn);
    return this;
  }
  isClosed(): boolean {
    return this.fechada;
  }
  url(): string {
    if (this.modo.login) return URL_LOGIN;
    return this.gotos.at(-1) ?? "about:blank";
  }
  // Não é async de propósito: o `captureTokens` engole rejeição do goto (`.catch(() => {})`);
  // o Chrome caído aparece aqui como exceção que atravessa a captura.
  goto(url: string) {
    if (this.modo.falhar?.()) throw new Error("page.goto: Target page, context or browser has been closed");
    if (this.modo.cair?.()) {
      this.fechada = true;
      return Promise.reject(new Error("page.goto: Target page, context or browser has been closed"));
    }
    this.gotos.push(url);
    this.modo.aoGoto?.(url);
    if (!this.modo.login && url.includes("/automation/workflows")) {
      const h = this.modo.headers ?? {
        authorization: `Bearer ${BEARER}`,
        "token-id": TOKEN_ID,
        "user-agent": UA_NORMAL,
        "sec-ch-ua": '"Google Chrome";v="154"',
      };
      const req = { url: () => "https://backend.leadconnectorhq.com/x", allHeaders: () => Promise.resolve(h) };
      for (const fn of [...this.ouvintes]) fn(req);
    }
    return Promise.resolve(null);
  }
  reload() {
    return Promise.resolve(null);
  }
}

class ContextoFalso {
  fechado = 0;
  private ouvintesClose: (() => void)[] = [];
  private morto = false;
  constructor(readonly pagina: PaginaFalsa) {}
  on(ev: string, fn: () => void) {
    if (ev === "close") this.ouvintesClose.push(fn);
    return this;
  }
  off() {
    return this;
  }
  pages() {
    return [this.pagina];
  }
  newPage() {
    return Promise.resolve(this.pagina);
  }
  cookies() {
    return Promise.resolve([{ name: "c", value: "1" }]);
  }
  close() {
    this.fechado++;
    this.emitirClose();
    return Promise.resolve();
  }
  emitirClose() {
    if (this.morto) return;
    this.morto = true;
    for (const fn of [...this.ouvintesClose]) fn();
  }
}

type Opcoes = {
  headless: boolean;
  channel: "chrome";
  userAgent: string;
  handleSIGTERM?: boolean;
  handleSIGINT?: boolean;
  handleSIGHUP?: boolean;
};

/** A8: o Playwright não pode instalar tratador de sinal; quem encerra o Chrome é o nosso `fechar()`. */
function semTratadoresDeSinal(opcoes: Opcoes): void {
  assert.deepEqual(
    { handleSIGTERM: opcoes.handleSIGTERM, handleSIGINT: opcoes.handleSIGINT, handleSIGHUP: opcoes.handleSIGHUP },
    { handleSIGTERM: false, handleSIGINT: false, handleSIGHUP: false },
  );
}

/** Lançador falso: registra cada chamada e devolve o contexto que `fabrica(n)` montar (n a partir de 1). */
function montar(fabrica: (n: number, chrome: () => ChromeDeFundo) => ContextoFalso, perfil = perfilTemp()) {
  const lancamentos: { perfil: string; opcoes: Opcoes }[] = [];
  const contextos: ContextoFalso[] = [];
  const logs: string[] = [];
  const registro = path.join(pastaTemp("amlogins-"), "logins.jsonl");
  const lancar = (p: string, opcoes: Opcoes) => {
    lancamentos.push({ perfil: p, opcoes });
    const ctx = fabrica(lancamentos.length, () => chrome);
    contextos.push(ctx);
    return Promise.resolve(ctx as unknown as BrowserContext);
  };
  const chrome: ChromeDeFundo = new ChromeDeFundo(perfil, registro, (m) => logs.push(m), lancar, () => null);
  return { chrome, lancamentos, contextos, logs, registro, perfil };
}

// ---------------------------------------------------------------- uaHeadless / uaDoPerfil

test("uaHeadless acusa HeadlessChrome no user-agent", () => {
  assert.equal(uaHeadless({ "user-agent": "Mozilla/5.0 (Macintosh) HeadlessChrome/154.0.0.0 Safari/537.36" }), true);
});

test("uaHeadless acusa HeadlessChrome no sec-ch-ua mesmo com user-agent ausente", () => {
  assert.equal(uaHeadless({ "sec-ch-ua": '"HeadlessChrome";v="154"' }), true);
});

test("uaHeadless não acusa o Chrome normal", () => {
  assert.equal(uaHeadless({ "user-agent": UA_NORMAL, "sec-ch-ua": '"Google Chrome";v="154", "Chromium";v="154"' }), false);
});

test("uaDoPerfil monta o user-agent de Chrome normal com o major do Last Version", () => {
  const ua = uaDoPerfil(perfilTemp());
  assert.match(ua, /Chrome\/154\.0\.0\.0/);
  assert.doesNotMatch(ua, /Headless/i);
  assert.doesNotMatch(ua, /8037/);
});

test("uaDoPerfil sem Last Version cai no UA_PADRAO do cliente", () => {
  assert.equal(uaDoPerfil(pastaTemp("amperfil-")), UA_PADRAO);
});

test("uaDoPerfil com Last Version sem número cai no UA_PADRAO", () => {
  const p = pastaTemp("amperfil-");
  fs.writeFileSync(path.join(p, "Last Version"), "lixo");
  assert.equal(uaDoPerfil(p), UA_PADRAO);
});

// ---------------------------------------------------------------- donoDoPerfil

function perfilComTrava(alvo: string): string {
  const p = pastaTemp("amperfil-");
  fs.symlinkSync(alvo, path.join(p, "SingletonLock"));
  return p;
}

test("donoDoPerfil acusa o Chrome com janela dono do perfil", () => {
  const p = perfilComTrava("maquina-1");
  assert.deepEqual(donoDoPerfil(p, () => `${CHROME_BIN} --user-data-dir=${p}`), { pid: 1, invisivel: false });
});

test("donoDoPerfil acusa o Chrome invisível dono do perfil", () => {
  const p = perfilComTrava("maquina-1");
  assert.deepEqual(
    donoDoPerfil(p, () => `${CHROME_BIN} --headless --user-data-dir=${p}`),
    { pid: 1, invisivel: true },
  );
});

test("donoDoPerfil ignora pid reaproveitado por outro programa", () => {
  const p = perfilComTrava("maquina-1");
  assert.equal(donoDoPerfil(p, () => "/sbin/launchd"), null);
});

test("donoDoPerfil ignora Chrome aberto em outro perfil", () => {
  const p = perfilComTrava("maquina-1");
  assert.equal(donoDoPerfil(p, () => `${CHROME_BIN} --user-data-dir=/outro/perfil`), null);
});

test("donoDoPerfil ignora trava de pid morto", () => {
  const p = perfilComTrava("maquina-2147480000");
  assert.equal(donoDoPerfil(p, () => `${CHROME_BIN} --user-data-dir=${p}`), null);
});

test("donoDoPerfil ignora trava apontando para o próprio processo", () => {
  const p = perfilComTrava(`maquina-${process.pid}`);
  assert.equal(donoDoPerfil(p, () => `${CHROME_BIN} --user-data-dir=${p}`), null);
});

test("donoDoPerfil sem SingletonLock devolve null", () => {
  const p = pastaTemp("amperfil-");
  assert.equal(donoDoPerfil(p, () => `${CHROME_BIN} --user-data-dir=${p}`), null);
});

// ---------------------------------------------------------------- ChromeDeFundo

test("ChromeDeFundo.perfil devolve o caminho do construtor", () => {
  const c = new ChromeDeFundo("/x/perfil", "/x/logins.jsonl", () => {}, () => Promise.reject(new Error("não lança")), () => null);
  assert.equal(c.perfil, "/x/perfil");
});

test("capturar abre o Chrome invisível com o UA do perfil, devolve tokens com cookies e para em about:blank", PRAZO, async () => {
  const m = montar(() => new ContextoFalso(new PaginaFalsa()));
  const tokens = await m.chrome.capturar("X");

  assert.equal(m.lancamentos.length, 1);
  const { perfil, opcoes } = m.lancamentos[0];
  assert.equal(perfil, m.perfil);
  assert.equal(opcoes.headless, true);
  assert.equal(opcoes.channel, "chrome");
  assert.equal(opcoes.userAgent, uaDoPerfil(m.perfil));

  assert.equal(tokens.bearer, BEARER);
  assert.equal(tokens.tokenId, TOKEN_ID);
  assert.equal(tokens.userAgent, uaDoPerfil(m.perfil));
  assert.equal(tokens.cookies?.["backend.leadconnectorhq.com"], "c=1");

  assert.equal(m.contextos[0].pagina.gotos.at(-1), "about:blank");
  assert.ok(m.logs.includes("ua_headless=nao"), `log: ${JSON.stringify(m.logs)}`);
  assert.ok(!m.logs.some((l) => l.includes(BEARER) || l.includes(TOKEN_ID)), "token vazou para o log");
  assert.equal(m.chrome.esperandoLogin(), false);
});

test("capturar loga ua_headless=sim quando o pedido real sai com HeadlessChrome", PRAZO, async () => {
  const m = montar(
    () =>
      new ContextoFalso(
        new PaginaFalsa({
          headers: {
            authorization: `Bearer ${BEARER}`,
            "token-id": TOKEN_ID,
            "user-agent": "Mozilla/5.0 (Macintosh) HeadlessChrome/154.0.0.0 Safari/537.36",
          },
        }),
      ),
  );
  await m.chrome.capturar("X");
  assert.ok(m.logs.includes("ua_headless=sim"), `log: ${JSON.stringify(m.logs)}`);
});

test("duas capturas seguidas reaproveitam o mesmo Chrome", PRAZO, async () => {
  const m = montar(() => new ContextoFalso(new PaginaFalsa()));
  await m.chrome.capturar("X");
  const t = await m.chrome.capturar("Y");
  assert.equal(m.lancamentos.length, 1);
  assert.equal(t.bearer, BEARER);
});

test("Chrome que morreu entre capturas é reaberto na seguinte", PRAZO, async () => {
  const m = montar(() => new ContextoFalso(new PaginaFalsa()));
  await m.chrome.capturar("X");
  m.contextos[0].emitirClose();
  const t = await m.chrome.capturar("X");
  assert.equal(m.lancamentos.length, 2);
  assert.equal(m.lancamentos[1].opcoes.headless, true);
  assert.equal(t.bearer, BEARER);
  assert.equal(t.tokenId, TOKEN_ID);
});

test("Chrome que cai no meio da captura é fechado e reaberto uma vez, sem abrir janela de login", PRAZO, async () => {
  let gotos = 0;
  const m = montar(() => new ContextoFalso(new PaginaFalsa({ falhar: () => ++gotos === 1 })));
  const t = await m.chrome.capturar("X");
  assert.equal(t.bearer, BEARER);
  assert.equal(m.lancamentos.length, 2);
  assert.ok(m.contextos[0].fechado >= 1, "o contexto caído não foi fechado");
  assert.equal(m.lancamentos[1].opcoes.headless, true);
  assert.equal(fs.existsSync(m.registro), false, "não era caso de login");
});

test("Chrome que cai de verdade no meio da captura (goto rejeita, página fecha) é reaberto uma vez invisível", PRAZO, async () => {
  let gotos = 0;
  const m = montar(() => new ContextoFalso(new PaginaFalsa({ cair: () => ++gotos === 1 })));
  const t0 = Date.now();
  const t = await m.chrome.capturar("X");
  // bem abaixo dos 30 s de tentativaInvisivelMs: a queda é percebida, não esperada até o fim
  assert.ok(Date.now() - t0 < 5000, `demorou ${Date.now() - t0} ms`);
  assert.equal(t.bearer, BEARER);
  assert.equal(t.tokenId, TOKEN_ID);
  assert.equal(m.lancamentos.length, 2);
  assert.ok(m.lancamentos.every((l) => l.opcoes.headless), "abriu janela");
  assert.ok(m.contextos[0].fechado >= 1, "o contexto caído não foi fechado");
  assert.equal(fs.existsSync(m.registro), false, "não era caso de login");
  assert.equal(m.chrome.esperandoLogin(), false);
});

test("Chrome que cai sempre faz capturar rejeitar depois de exatamente 2 lançamentos", PRAZO, async () => {
  const m = montar(() => new ContextoFalso(new PaginaFalsa({ falhar: () => true })));
  await assert.rejects(m.chrome.capturar("X"), /has been closed/);
  assert.equal(m.lancamentos.length, 2);
  assert.ok(m.lancamentos.every((l) => l.opcoes.headless));
});

test("GHL pedindo login abre a janela, registra o login e volta invisível na captura seguinte", PRAZO, async () => {
  let duranteEspera: boolean | null = null;
  const m = montar((n, chrome) => {
    if (n === 1) return new ContextoFalso(new PaginaFalsa({ login: true }));
    return new ContextoFalso(
      new PaginaFalsa({
        aoGoto: (url) => {
          if (n === 2 && url.includes("/automation/workflows")) duranteEspera = chrome().esperandoLogin();
        },
      }),
    );
  });

  const t = await m.chrome.capturar("X");
  assert.equal(t.bearer, BEARER);
  assert.equal(m.lancamentos.length, 2);
  assert.equal(m.lancamentos[0].opcoes.headless, true);
  assert.equal(m.lancamentos[1].opcoes.headless, false);
  assert.equal(m.lancamentos[1].opcoes.channel, "chrome");
  assert.equal(m.lancamentos[1].opcoes.userAgent, uaDoPerfil(m.perfil));

  const texto = fs.readFileSync(m.registro, "utf-8");
  const linhas = texto.split("\n").filter(Boolean);
  assert.equal(linhas.length, 1);
  const linha = JSON.parse(linhas[0]) as Record<string, unknown>;
  assert.equal(linha.via, "fundo");
  assert.equal(linha.motivo, "redirecionamento");
  assert.equal(linha.subconta, "X");
  assert.ok(!texto.includes(BEARER) && !texto.includes(TOKEN_ID), "token vazou para o registro de logins");

  assert.equal(duranteEspera, true, "esperandoLogin() devia ser true durante a janela de login");
  assert.equal(m.chrome.esperandoLogin(), false);
  assert.ok(m.contextos[0].fechado >= 1, "o Chrome invisível não foi fechado antes da janela");
  assert.ok(m.contextos[1].fechado >= 1, "a janela de login não foi fechada no fim");

  await m.chrome.capturar("X");
  assert.equal(m.lancamentos.length, 3);
  assert.equal(m.lancamentos[2].opcoes.headless, true);
  assert.equal(fs.readFileSync(m.registro, "utf-8").split("\n").filter(Boolean).length, 1);
});

test("perfil aberto por outro Chrome com janela: capturar recusa com sessao_indisponivel sem lançar nada", PRAZO, async () => {
  const perfil = perfilComTrava("maquina-1");
  const lancamentos: unknown[] = [];
  const chrome = new ChromeDeFundo(
    perfil,
    path.join(pastaTemp("amlogins-"), "logins.jsonl"),
    () => {},
    (p) => {
      lancamentos.push(p);
      return Promise.resolve(new ContextoFalso(new PaginaFalsa()) as unknown as BrowserContext);
    },
    () => `${CHROME_BIN} --user-data-dir=${perfil}`,
  );
  const erro = await chrome.capturar("X").then(
    () => assert.fail("devia rejeitar"),
    (e: unknown) => e,
  );
  assert.ok(erro instanceof ErroSessao, `esperava ErroSessao, veio ${String(erro)}`);
  assert.equal(erro.codigo, "sessao_indisponivel");
  assert.match(erro.message, /\(pid 1\)/);
  assert.equal(lancamentos.length, 0);
});

// ---------------------------------------------------------------- fechamento limpo (A8)

test("lançamento invisível desliga os tratadores de SIGTERM, SIGINT e SIGHUP do Playwright", PRAZO, async () => {
  const m = montar(() => new ContextoFalso(new PaginaFalsa()));
  await m.chrome.capturar("X");
  assert.equal(m.lancamentos[0].opcoes.headless, true);
  semTratadoresDeSinal(m.lancamentos[0].opcoes);
});

test("lançamento com janela (login) desliga os tratadores de SIGTERM, SIGINT e SIGHUP do Playwright", PRAZO, async () => {
  const m = montar((n) => new ContextoFalso(new PaginaFalsa({ login: n === 1 })));
  await m.chrome.capturar("X");
  assert.equal(m.lancamentos[1].opcoes.headless, false);
  semTratadoresDeSinal(m.lancamentos[1].opcoes);
});

/** Contexto cujo `close()` demora, como o Chrome gravando cookies e Preferences antes de sair. */
class ContextoLento extends ContextoFalso {
  fechouDeVerdade = false;
  override close() {
    this.fechado++;
    return sleep(300).then(() => {
      this.fechouDeVerdade = true;
      this.emitirClose();
    });
  }
}

test("fechar() só resolve depois que o close() do contexto resolveu", PRAZO, async () => {
  const m = montar(() => new ContextoLento(new PaginaFalsa()));
  await m.chrome.capturar("X");
  const ctx = m.contextos[0] as ContextoLento;
  const t0 = Date.now();
  await m.chrome.fechar();
  assert.equal(ctx.fechado, 1);
  assert.equal(ctx.fechouDeVerdade, true, "fechar() resolveu antes de o contexto fechar");
  assert.ok(Date.now() - t0 >= 250, `fechar() resolveu em ${Date.now() - t0} ms`);
});

/** Página que registra o próprio `close()` na ordem compartilhada; `rejeitar` simula a página que não fecha. */
class PaginaQueFecha extends PaginaFalsa {
  constructor(
    readonly nome: string,
    readonly ordem: string[],
    private readonly opcoes: { rejeitar?: boolean; modo?: PaginaFalsa["modo"] } = {},
  ) {
    super(opcoes.modo);
  }
  close() {
    this.ordem.push(this.nome);
    this.fechada = true;
    return this.opcoes.rejeitar ? Promise.reject(new Error("page.close: Target page has been closed")) : Promise.resolve();
  }
}

/** Contexto com várias páginas que registra o próprio `close()` na mesma ordem das páginas. */
class ContextoQueRegistra extends ContextoFalso {
  constructor(
    readonly paginas: PaginaFalsa[],
    readonly ordem: string[],
    readonly nome = "contexto",
  ) {
    super(paginas[0]);
  }
  override pages() {
    return this.paginas;
  }
  override close() {
    this.ordem.push(this.nome);
    return super.close();
  }
}

// Medido ao vivo: contexto.close() direto perpetua `exit_type: "Crashed"`; fechar as páginas antes sai "Normal".
test("fechar() fecha todas as páginas do contexto antes do close() do contexto", PRAZO, async () => {
  const ordem: string[] = [];
  const m = montar(
    () => new ContextoQueRegistra([new PaginaQueFecha("pagina-1", ordem), new PaginaQueFecha("pagina-2", ordem)], ordem),
  );
  await m.chrome.capturar("X");
  await m.chrome.fechar();
  assert.deepEqual(ordem, ["pagina-1", "pagina-2", "contexto"]);
  assert.equal(m.contextos[0].fechado, 1);
});

test("página cujo close() rejeita não impede o close() do contexto, e fechar() resolve", PRAZO, async () => {
  const ordem: string[] = [];
  const m = montar(
    () =>
      new ContextoQueRegistra(
        [new PaginaQueFecha("pagina-1", ordem, { rejeitar: true }), new PaginaQueFecha("pagina-2", ordem)],
        ordem,
      ),
  );
  await m.chrome.capturar("X");
  await m.chrome.fechar();
  assert.deepEqual(ordem, ["pagina-1", "pagina-2", "contexto"]);
  assert.equal(m.contextos[0].fechado, 1);
});

test("reabertura depois de o Chrome cair fecha as páginas do contexto antigo antes do contexto", PRAZO, async () => {
  const ordem: string[] = [];
  let gotos = 0;
  const m = montar((n) => {
    if (n > 1) ordem.push(`lancar-${n}`);
    const pagina = new PaginaQueFecha(`pagina-${n}`, ordem, { modo: { falhar: () => ++gotos === 1 } });
    return new ContextoQueRegistra([pagina], ordem, `contexto-${n}`);
  });
  const t = await m.chrome.capturar("X");
  assert.equal(t.bearer, BEARER);
  assert.equal(m.lancamentos.length, 2);
  assert.deepEqual(ordem, ["pagina-1", "contexto-1", "lancar-2"]);
});
