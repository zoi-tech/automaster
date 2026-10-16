import type { Command } from "commander";
import {
  listarPaineis, detalhePainel, catalogoWidgets, versoesPainel, dadosWidget, fusoDaSubconta,
} from "../api/dashboards.js";
import fs from "node:fs";
import path from "node:path";
import { withClient, DUMPS_DIR } from "./shared.js";
import { emitir, falhar } from "../saida.js";
import { entrarNaFila } from "../auth/lock.js";
import { caminhosDaSessao, ErroSessao } from "../fundo/comum.js";
import { abrirPerfilDeTela } from "../tela/perfil.js";

/**
 * As opções salvas no widget não valem como corpo: o app as materializa antes de pedir os números
 * (groupBy como objetos, a data do painel como filtro, o fuso). Aqui a janela é os últimos 30 dias.
 */
function materializar(options: unknown, timezone: string): unknown {
  const o = structuredClone(options) as Record<string, any>;
  const fim = Date.now();
  const janela = [fim - 30 * 86_400_000, fim];
  if (o.groupBy?.fields) {
    o.groupBy.fields = o.groupBy.fields.map((f: unknown) => (typeof f === "string" ? { field: f, type: "field" } : f));
  }
  o.filters = [{ group: "AND", filters: [{ field: o.dateProperty ?? "date_added", operator: "time_series", value: janela }, ...(o.filters ?? [])] }];
  o.timezone = timezone;
  return o;
}

async function runDashboards(opts: {
  location: string; o: string; id?: string; widget?: string; json?: boolean;
}): Promise<void> {
  const log = opts.json ? console.error : console.log;
  const op = opts.o;
  if (!["lista", "detalhe", "catalogo", "versoes", "dados", "fuso"].includes(op)) {
    throw new Error(`-o inválido: ${op}. Aceitos: lista, detalhe, catalogo, versoes, dados, fuso`);
  }
  if (["detalhe", "versoes", "dados"].includes(op) && !opts.id) throw new Error(`-o ${op} exige -i <id> do painel (falta o id)`);
  if (op === "dados" && !opts.widget) throw new Error("-o dados exige --widget <widgetId> (falta o widget)");
  await withClient(opts.location, log, async (client) => {
    const loc = opts.location;
    let saida: unknown;
    if (op === "lista") saida = await listarPaineis(client, loc);
    else if (op === "detalhe") saida = await detalhePainel(client, loc, opts.id!);
    else if (op === "catalogo") saida = await catalogoWidgets(client, loc);
    else if (op === "versoes") saida = await versoesPainel(client, loc, opts.id!);
    else if (op === "fuso") saida = await fusoDaSubconta(client, loc);
    else {
      const painel = await detalhePainel(client, loc, opts.id!);
      const w = painel.widgets.find((x) => x.widgetId === opts.widget);
      if (!w) throw new Error(`widget ${opts.widget} não está no painel ${opts.id}`);
      if (!w.definicao) throw new Error(`widget ${opts.widget} não tem definição no painel`);
      const fuso = await fusoDaSubconta(client, loc);
      saida = await dadosWidget(client, loc, { ...w.definicao, options: materializar(w.definicao.options, fuso) });
    }
    emitir(opts.json, saida);
  });
}

// Candidatos a confirmar ao vivo: seletor de widget e contêiner que rola.
const SELETOR_WIDGET = ".location-dashboard-numeric-card, .chart-container";
const URL_LOGIN = "https://app.gohighlevel.com/login";

interface Resultado { arquivo: string; largura: number; altura: number; widgets: number; vazios: string[] }

/** Mede o painel: rola o contêiner interno até o fim (carrega os widgets de baixo) e conta o que renderizou. */
const MEDIR = `(async () => {
  const w = document.querySelectorAll(${JSON.stringify(SELETOR_WIDGET)});
  let rolavel = w[0]?.parentElement;
  while (rolavel && rolavel.scrollHeight <= rolavel.clientHeight + 1) rolavel = rolavel.parentElement;
  if (rolavel) {
    for (let y = 0; y < rolavel.scrollHeight; y += 600) { rolavel.scrollTo(0, y); await new Promise((r) => setTimeout(r, 250)); }
    rolavel.scrollTo(0, 0);
  }
  const vazios = [...w].filter((x) => /sem dados|no data/i.test(x.textContent || "")).map((x) => (x.querySelector("h1,h2,h3,h4,.title,[class*=title]")?.textContent || "").trim());
  return {
    widgets: w.length, vazios,
    largura: Math.max(document.documentElement.scrollWidth, window.innerWidth),
    altura: Math.max(rolavel ? rolavel.scrollHeight + rolavel.getBoundingClientRect().top : 0, document.documentElement.scrollHeight, window.innerHeight),
  };
})()`;

export async function runDashboardVer(
  opts: { location?: string; id?: string; login?: boolean; json?: boolean },
  abrir: typeof abrirPerfilDeTela = abrirPerfilDeTela,
): Promise<Resultado> {
  const log = opts.json ? console.error : console.log;
  if (!opts.login && (!opts.location || !opts.id)) throw new Error("dashboard-ver exige -l <locationId> e -i <painelId> (ou --login)");
  // sem withClient: não usa tokens, mas carregar o painel grava widget-preference (escrita)
  const sairDaFila = await entrarNaFila(caminhosDaSessao().escrita, log);
  let perfil: Awaited<ReturnType<typeof abrirPerfilDeTela>> | undefined;
  try {
    perfil = await abrir({ visivel: !!opts.login });
    const page = perfil.context.pages()[0] ?? (await perfil.context.newPage());
    if (opts.login) {
      await page.goto(URL_LOGIN, { waitUntil: "domcontentloaded" });
      log("faça o login na janela; ela fecha sozinha quando o GHL sair da tela de login (até 10 min)");
      await page.waitForURL((u) => !u.href.includes("/login"), { timeout: 600_000 });
      const vazio: Resultado = { arquivo: "", largura: 0, altura: 0, widgets: 0, vazios: [] };
      emitir(opts.json, { login: "ok" });
      return vazio;
    }
    await page.goto(`https://app.gohighlevel.com/v2/location/${opts.location}/dashboard?dashboardId=${opts.id}`, { waitUntil: "domcontentloaded" });
    if (page.url().includes("/login")) {
      throw new ErroSessao("login_pendente", "o perfil de tela não está logado: rode npm run dashboard-ver -- --login");
    }
    await page.waitForSelector(SELETOR_WIDGET, { timeout: 40_000 });
    const m = (await page.evaluate(MEDIR)) as Omit<Resultado, "arquivo">;
    await page.setViewportSize({ width: m.largura, height: m.altura }); // painel inteiro numa tela só
    await page.waitForTimeout(1500);
    const dir = path.join(DUMPS_DIR, "_dashboards", opts.location!, opts.id!);
    fs.mkdirSync(dir, { recursive: true });
    const arquivo = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}.png`);
    await page.screenshot({ path: arquivo });
    const r: Resultado = { arquivo, largura: m.largura, altura: m.altura, widgets: m.widgets, vazios: m.vazios };
    emitir(opts.json, r);
    return r;
  } finally {
    try {
      await perfil?.fechar();
    } finally {
      sairDaFila();
    }
  }
}

export function registrarDashboards(program: Command): void {
  program
    .command("dashboards")
    .description("Leitura ao vivo de painéis nativos do GHL, catálogo de widgets, dados e fuso da subconta")
    .requiredOption("-l, --location <id>", "locationId da subconta")
    .option("-o, --o <op>", "lista | detalhe | catalogo | versoes | dados | fuso", "lista")
    .option("-i, --id <id>", "id do painel (detalhe, versoes, dados)")
    .option("--widget <id>", "widgetId (com -o dados)")
    .option("--json", "imprime o resultado em JSON no stdout")
    .action((o) => runDashboards(o).catch(falhar));
  program
    .command("dashboard-ver")
    .description("Carrega o painel no perfil de tela e salva um PNG inteiro (ESCREVE: o app grava preferência de widget)")
    .option("-l, --location <id>", "locationId da subconta")
    .option("-i, --id <id>", "id do painel")
    .option("--login", "abre o perfil de tela visível para o login do GHL (uma vez)")
    .option("--json", "imprime o resultado em JSON no stdout")
    .action((o) => runDashboardVer(o).then(() => undefined).catch(falhar));
}
