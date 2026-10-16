/**
 * Etapa 4: perfil de tela com login próprio e captura do painel (`dashboard-ver`).
 *
 * Contrato esperado (nada disso existe ainda; estes testes devem falhar até a implementação):
 *
 *   src/tela/perfil.ts
 *     abrirPerfilDeTela(opts: { visivel: boolean }, lancar?: Lancar): Promise<PerfilTela>
 *       - `lancar(dir, options)` é o `chromium.launchPersistentContext` por padrão (injetável só
 *         para teste). `dir` = $AUTOMASTER_PERFIL_TELA ou ~/.automaster/perfil-tela; options com
 *         `channel: "chrome"` e `headless: !opts.visivel`.
 *       - trava ~/.automaster/perfil-tela.lock com travarChrome(arquivo, "perfil-tela") ANTES de
 *         lançar; trava ocupada por outro pid rejeita sem lançar nada. Nunca toca em chrome.lock.
 *       - PerfilTela = { context, fechar(): Promise<void> }. `fechar` fecha TODAS as páginas
 *         (context.pages()) e só depois o contexto (context.close() direto marca o perfil como
 *         Crashed), depois solta a trava. Não pode deixar de fechar o contexto nem soltar a trava
 *         se uma página falhar ao fechar; é idempotente.
 *
 *   src/cli/dashboards.ts
 *     runDashboardVer(opts: { location?: string; id?: string; login?: boolean; json?: boolean },
 *                     abrir = abrirPerfilDeTela): Promise<Resultado>
 *       - Resultado = { arquivo, largura, altura, widgets, vazios } (o mesmo objeto que vai ao
 *         `emitir(opts.json, ...)`; a função também o devolve).
 *       - Entra na fila de escrita (`entrarNaFila(caminhosDaSessao().escrita, log)`) ANTES de
 *         chamar `abrir`, solta no fim; chama `abrir({ visivel: !!opts.login })` e SEMPRE `fechar()`
 *         do que `abrir` devolveu, inclusive no erro.
 *       - Normal: `page.goto("https://app.gohighlevel.com/v2/location/<loc>/dashboard?dashboardId=<id>",
 *         { waitUntil não pode ser "networkidle" })`; se `page.url()` contém "/login", rejeita com
 *         erro de `codigo === "login_pendente"` e mensagem com "npm run dashboard-ver -- --login".
 *         Senão `page.waitForSelector(<seletor de widget>, { timeout <= 40000 })`, mede/rola o painel
 *         só por `page.evaluate(...)`, cria a pasta e chama `page.screenshot({ path })` com
 *         path = <AUTOMASTER_DUMPS>/_dashboards/<loc>/<id>/<carimbo>.png.
 *       - O fake de página devolve de `evaluate`, em qualquer chamada, o objeto
 *         `{ widgets, vazios, largura, altura }`; o Resultado usa esses quatro valores.
 *       - `--login` (opts.login): visivel true, `page.goto` numa URL com "login" do GHL, espera a
 *         URL sair de "/login" (`page.url()` por sondagem ou `page.waitForURL`), fecha, resolve.
 *
 *   src/cli.ts / package.json: comando e script `dashboard-ver` (cobertos em cli-comandos.test.ts).
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "amtela-"));
process.env.HOME = HOME;
process.env.AUTOMASTER_PERFIL_TELA = path.join(HOME, "pt");
process.env.AUTOMASTER_DUMPS = path.join(HOME, "dumps");

const { abrirPerfilDeTela } = await import("../src/tela/perfil.js");
const { runDashboardVer } = await import("../src/cli/dashboards.js");
const { caminhosDaSessao } = await import("../src/fundo/comum.js");

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const TRAVA = path.join(HOME, ".automaster", "perfil-tela.lock");
const filhos: number[] = [];
after(() => {
  for (const p of filhos) {
    try { process.kill(p, "SIGKILL"); } catch { /* já saiu */ }
  }
  fs.rmSync(HOME, { recursive: true, force: true });
});

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const URL_LOGIN = "https://app.gohighlevel.com/login?redirect=x";

interface Cenario {
  urlDepoisDoGoto?: string;
  saiDoLogin?: boolean; // cai em /login e sai dele sozinho depois de algumas sondagens
  gotoFalha?: Error;
  seletorFalha?: Error;
  paginaFechaFalha?: boolean;
  medidas?: { widgets: number; vazios: string[]; largura: number; altura: number };
}

/** Contexto/página falsos; `eventos` guarda a ordem de tudo que aconteceu. */
function montar(c: Cenario = {}) {
  const eventos: string[] = [];
  const chamadas = { goto: [] as { url: string; opts: any }[], seletor: [] as { sel: string; opts: any }[], shots: [] as string[], lancar: [] as { dir: string; opts: any }[] };
  const medidas = c.medidas ?? { widgets: 19, vazios: ["Leads sem dono"], largura: 1440, altura: 5200 };
  let url = "about:blank";
  let idas = 0;
  const pagina: any = new Proxy({
    async goto(u: string, opts: any) {
      chamadas.goto.push({ url: u, opts });
      eventos.push("goto");
      if (c.gotoFalha) throw c.gotoFalha;
      url = c.saiDoLogin ? URL_LOGIN : (c.urlDepoisDoGoto ?? u);
    },
    url() {
      if (c.saiDoLogin && url.includes("/login") && ++idas > 3) url = "https://app.gohighlevel.com/v2/location/x/dashboard";
      return url;
    },
    async waitForURL() { url = "https://app.gohighlevel.com/v2/location/x/dashboard"; },
    async waitForSelector(sel: string, opts: any) {
      chamadas.seletor.push({ sel, opts });
      eventos.push("seletor");
      if (c.seletorFalha) throw c.seletorFalha;
    },
    async evaluate() { return medidas; },
    async screenshot(o: { path: string }) {
      chamadas.shots.push(o.path);
      fs.writeFileSync(o.path, PNG); // ENOENT se a pasta não foi criada
      eventos.push("screenshot");
    },
    async close() {
      eventos.push("pagina.close");
      if (c.paginaFechaFalha) throw new Error("página travada");
    },
  }, { get: (t: any, k) => (k in t ? t[k] : async () => undefined) });
  const context: any = {
    pages: () => [pagina],
    newPage: async () => pagina,
    close: async () => { eventos.push("contexto.close"); },
  };
  const lancar = async (dir: string, opts: any) => { chamadas.lancar.push({ dir, opts }); eventos.push("lancar"); return context; };
  const abrir = (o: { visivel: boolean }) => { eventos.push(`abrir:${o.visivel}`); return abrirPerfilDeTela(o, lancar as any); };
  return { eventos, chamadas, lancar, abrir };
}

function travaAlheia(arquivo: string): () => void {
  const dono = spawn("sleep", ["60"], { stdio: "ignore" });
  filhos.push(dono.pid!);
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.writeFileSync(arquivo, `${dono.pid} x`);
  return () => dono.kill("SIGKILL");
}

const limpar = () => {
  fs.rmSync(TRAVA, { force: true });
  fs.rmSync(caminhosDaSessao().escrita, { force: true });
};

// --- abrirPerfilDeTela ---

test("abrirPerfilDeTela lança o Chrome do sistema no perfil de tela, headless por padrão, visível com visivel", async () => {
  limpar();
  const a = montar();
  const p = await abrirPerfilDeTela({ visivel: false }, a.lancar as any);
  assert.equal(a.chamadas.lancar[0]!.dir, process.env.AUTOMASTER_PERFIL_TELA);
  assert.equal(a.chamadas.lancar[0]!.opts.channel, "chrome");
  assert.equal(a.chamadas.lancar[0]!.opts.headless, true);
  await p.fechar();
  const b = montar();
  const q = await abrirPerfilDeTela({ visivel: true }, b.lancar as any);
  assert.equal(b.chamadas.lancar[0]!.opts.headless, false);
  await q.fechar();
});

test("abrirPerfilDeTela trava perfil-tela.lock com o rótulo perfil-tela (não chrome.lock) e solta no fechar", async () => {
  limpar();
  const a = montar();
  const p = await abrirPerfilDeTela({ visivel: false }, a.lancar as any);
  assert.equal(fs.readFileSync(TRAVA, "utf-8").trim(), `${process.pid} perfil-tela`);
  assert.equal(fs.existsSync(path.join(HOME, ".automaster", "chrome.lock")), false, "tocou no chrome.lock do processo de fundo");
  await p.fechar();
  assert.equal(fs.existsSync(TRAVA), false, "trava não foi solta");
});

test("abrirPerfilDeTela com a trava na mão de outro processo rejeita sem lançar o Chrome", async () => {
  limpar();
  const matar = travaAlheia(TRAVA);
  const a = montar();
  try {
    await assert.rejects(abrirPerfilDeTela({ visivel: false }, a.lancar as any));
    assert.deepEqual(a.chamadas.lancar, [], "abriu o perfil em paralelo");
  } finally {
    matar();
    limpar();
  }
});

test("fechar fecha as páginas ANTES do contexto, e só então solta a trava", async () => {
  limpar();
  const a = montar();
  const p = await abrirPerfilDeTela({ visivel: false }, a.lancar as any);
  await p.fechar();
  assert.deepEqual(a.eventos.filter((e) => e.endsWith(".close")), ["pagina.close", "contexto.close"]);
  assert.equal(fs.existsSync(TRAVA), false);
});

test("fechar com página que falha ao fechar ainda fecha o contexto e solta a trava", async () => {
  limpar();
  const a = montar({ paginaFechaFalha: true });
  const p = await abrirPerfilDeTela({ visivel: false }, a.lancar as any);
  await p.fechar().catch(() => {});
  assert.ok(a.eventos.includes("contexto.close"), "contexto ficou aberto");
  assert.equal(fs.existsSync(TRAVA), false, "trava ficou");
});

test("fechar duas vezes não fecha o contexto duas vezes", async () => {
  limpar();
  const a = montar();
  const p = await abrirPerfilDeTela({ visivel: false }, a.lancar as any);
  await p.fechar();
  await p.fechar();
  assert.equal(a.eventos.filter((e) => e === "contexto.close").length, 1);
});

// --- runDashboardVer ---

test("login_pendente: página que cai em /login erra com o código e a instrução de --login, e fecha tudo", async () => {
  limpar();
  const a = montar({ urlDepoisDoGoto: URL_LOGIN });
  await assert.rejects(runDashboardVer({ location: "LOC1", id: "PNL1" }, a.abrir as any), (e: any) => {
    assert.equal(e.codigo, "login_pendente");
    assert.match(e.message, /npm run dashboard-ver -- --login/);
    return true;
  });
  assert.equal(a.chamadas.shots.length, 0, "fotografou a tela de login");
  assert.deepEqual(a.eventos.filter((e) => e.endsWith(".close")), ["pagina.close", "contexto.close"]);
  assert.equal(fs.existsSync(TRAVA), false);
  assert.equal(fs.existsSync(caminhosDaSessao().escrita), false, "fila não foi solta");
});

test("página com widgets: PNG no caminho _dashboards/<loc>/<id>/<carimbo>.png e envelope completo", async () => {
  limpar();
  const a = montar();
  const r = await runDashboardVer({ location: "LOC1", id: "PNL1" }, a.abrir as any);
  const dir = path.join(process.env.AUTOMASTER_DUMPS!, "_dashboards", "LOC1", "PNL1");
  assert.equal(path.dirname(r.arquivo), dir);
  assert.match(path.basename(r.arquivo), /^\d.*\.png$/);
  assert.deepEqual(a.chamadas.shots, [r.arquivo]);
  assert.ok(fs.statSync(r.arquivo).size > 0);
  assert.deepEqual(
    { largura: r.largura, altura: r.altura, widgets: r.widgets, vazios: r.vazios },
    { largura: 1440, altura: 5200, widgets: 19, vazios: ["Leads sem dono"] },
  );
  assert.deepEqual(a.eventos.filter((e) => e.endsWith(".close")), ["pagina.close", "contexto.close"]);
});

test("carrega a rota exata do painel, sem networkidle, e espera seletor de widget até 40 s", async () => {
  limpar();
  const a = montar();
  await runDashboardVer({ location: "LOC1", id: "PNL1" }, a.abrir as any);
  assert.equal(a.chamadas.goto[0]!.url, "https://app.gohighlevel.com/v2/location/LOC1/dashboard?dashboardId=PNL1");
  assert.notEqual(a.chamadas.goto[0]!.opts?.waitUntil, "networkidle");
  assert.ok(a.chamadas.seletor.length >= 1, "não esperou widget");
  for (const s of a.chamadas.seletor) {
    assert.ok(s.opts?.timeout > 0 && s.opts.timeout <= 40_000, `timeout ${s.opts?.timeout}`);
  }
  assert.ok(a.eventos.indexOf("seletor") < a.eventos.indexOf("screenshot"), "fotografou antes de esperar os widgets");
  assert.equal(a.eventos[0], "abrir:false");
});

test("erro em goto: propaga e ainda fecha páginas e depois o contexto", async () => {
  limpar();
  const a = montar({ gotoFalha: new Error("net::ERR_FAILED") });
  await assert.rejects(runDashboardVer({ location: "LOC1", id: "PNL1" }, a.abrir as any), /ERR_FAILED/);
  assert.deepEqual(a.eventos.filter((e) => e.endsWith(".close")), ["pagina.close", "contexto.close"]);
  assert.equal(fs.existsSync(TRAVA), false);
});

test("seletor que estoura o prazo: propaga, não fotografa e fecha tudo", async () => {
  limpar();
  const a = montar({ seletorFalha: new Error("Timeout 40000ms exceeded") });
  await assert.rejects(runDashboardVer({ location: "LOC1", id: "PNL1" }, a.abrir as any), /Timeout/);
  assert.equal(a.chamadas.shots.length, 0);
  assert.deepEqual(a.eventos.filter((e) => e.endsWith(".close")), ["pagina.close", "contexto.close"]);
});

test("--login abre o perfil visível na tela de login, espera a URL sair de /login e fecha", async () => {
  limpar();
  const a = montar({ saiDoLogin: true });
  await runDashboardVer({ login: true }, a.abrir as any);
  assert.ok(a.eventos.includes("abrir:true"), "perfil não abriu visível");
  assert.match(a.chamadas.goto[0]!.url, /gohighlevel\.com.*login|login.*gohighlevel\.com/);
  assert.equal(a.chamadas.shots.length, 0);
  assert.deepEqual(a.eventos.filter((e) => e.endsWith(".close")), ["pagina.close", "contexto.close"]);
});

test("passa pela fila de escrita: com a fila ocupada não abre o perfil até ela soltar", async () => {
  limpar();
  const fila = caminhosDaSessao().escrita;
  const matar = travaAlheia(fila);
  const a = montar();
  const corrida = runDashboardVer({ location: "LOC1", id: "PNL1" }, a.abrir as any);
  corrida.catch(() => {});
  try {
    await sleep(1200);
    assert.deepEqual(a.eventos, [], "abriu o perfil com a fila ocupada");
  } finally {
    matar();
  }
  await corrida;
  assert.ok(a.eventos.includes("abrir:false"));
  assert.equal(fs.existsSync(fila), false, "fila não foi solta");
});

// --- estáticos ---

test("tela/perfil.ts não cita estado-ghl.json nem chrome-profile", () => {
  const texto = fs.readFileSync(path.join(SRC, "tela", "perfil.ts"), "utf-8");
  assert.ok(!texto.includes("estado-ghl.json"), "lê a sessão do processo de fundo");
  assert.ok(!texto.includes("chrome-profile"), "toca o perfil do processo de fundo");
});
