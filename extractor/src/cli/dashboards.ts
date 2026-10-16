import type { Command } from "commander";
import {
  listarPaineis, detalhePainel, catalogoWidgets, versoesPainel, dadosWidget, fusoDaSubconta,
  criarPainel, salvarPainel, apagarPainel, restaurarVersao, publicarPainel,
} from "../api/dashboards.js";
import { validarLayout, validarComposicao, contraste, minimosDoTipo } from "../api/dashboards-layout.js";
import type { CorpoSalvar } from "../api/dashboards.js";
import type { ItemPlano, Problema } from "../api/dashboards-layout.js";
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { withClient, DUMPS_DIR, registroEscrita } from "./shared.js";
import { emitir, falhar } from "../saida.js";
import { entrarNaFila } from "../auth/lock.js";
import { caminhosDaSessao, ErroSessao } from "../fundo/comum.js";
import { abrirPerfilDeTela } from "../tela/perfil.js";
import { conferirPainel } from "../api/dashboards-conferir.js";

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
      // logado, o GHL cai em /v2/...; o formulário também pode viver em "/" ou "/login"
      await page.waitForURL((u) => u.pathname.startsWith("/v2/"), { timeout: 600_000 });
      const vazio: Resultado = { arquivo: "", largura: 0, altura: 0, widgets: 0, vazios: [] };
      emitir(opts.json, { login: "ok" });
      return vazio;
    }
    await page.goto(`https://app.gohighlevel.com/v2/location/${opts.location}/dashboard?dashboardId=${opts.id}`, { waitUntil: "domcontentloaded" });
    if (page.url().includes("/login")) {
      throw new ErroSessao("login_pendente", "o perfil de tela não está logado: rode npm run dashboard-ver -- --login");
    }
    try {
      await page.waitForSelector(SELETOR_WIDGET, { timeout: 40_000 });
    } catch (e) {
      // deslogado, o GHL redireciona para "/?url=..." (sem "/login") e mostra o formulário de e-mail/senha
      if (await page.$("input[type=password]").catch(() => null)) {
        throw new ErroSessao("login_pendente", "o perfil de tela não está logado: rode npm run dashboard-ver -- --login");
      }
      throw e;
    }
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

// ---------- escrita ----------

const ACOES_ESCRITA = ["criar", "editar", "tema", "renomear", "apagar", "restaurar", "publicar"];
const PAPEIS = ["account_admin", "account_user"];
const ACESSOS = ["read", "write"];
// Lista fixa do que o app manda ao criar um widget (copiada do molde); o resto o servidor preenche.
const CAMPOS_WIDGET_NOVO = ["hasTrimmedFilters", "identifier", "className", "module", "moduleName", "eventSource", "group", "title", "chartType", "options", "savedOptionPairs", "locationId", "extras", "apiConfig", "externalDataConfig"];
const objectId = () => randomBytes(12).toString("hex");
/** O GET devolve o tema plano; o PUT só aplica `{dashboardTheme, widgetTheme}`. */
// Painel recém-criado vem sem tema, e o PUT recusa tema vazio (422): o app manda este.
const TEMA_PADRAO = { themeName: "none", titleColor: "#101828", backgroundColor: "#FFFFFF", metricColor: "#334155", linkColor: "#2970ff" };
function temaAninhado(t: Record<string, any>): { dashboardTheme: Record<string, any>; widgetTheme: Record<string, any> } {
  const aninhado = t.dashboardTheme && typeof t.dashboardTheme === "object";
  const dashboardTheme = { ...(aninhado ? t.dashboardTheme : t) };
  return {
    dashboardTheme: Object.keys(dashboardTheme).length ? dashboardTheme : { ...TEMA_PADRAO },
    widgetTheme: (aninhado ? t.widgetTheme : undefined) ?? {},
  };
}
const HEX = /^#[0-9a-fA-F]{6}$/;

interface OpcoesAcao {
  location: string; acao: string; id?: string; titulo?: string; plano?: string; tema?: string;
  versao?: number | string; versaoEsperada?: number | string; papeis?: string; forcar?: boolean; confirmo?: boolean; json?: boolean;
}
interface PlanoEdicao {
  criar?: { id: string; titulo?: string; options?: Record<string, any>; molde?: Record<string, any> }[];
  atualizar?: ({ widgetId: string } & Record<string, unknown>)[];
  remover?: string[];
  layout?: { id: string; x: number; y: number; w: number; h: number }[];
}

function lerPlano(texto: string | undefined): PlanoEdicao {
  if (!texto) throw new Error("--acao editar exige --plano <json|arquivo>");
  return JSON.parse(fs.existsSync(texto) ? fs.readFileSync(texto, "utf-8") : texto);
}

/** O último `dashboard-conferir` gravado no rastro do painel: o de maior `em` entre os de acao=conferir. */
function ultimoConferir(loc: string, id: string): { diverge: number } | null {
  const dir = path.join(DUMPS_DIR, "_dashboards", loc, id);
  if (!fs.existsSync(dir)) return null;
  let melhor: { em: string; diverge: number } | null = null;
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".json"))) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
    if (j.acao === "conferir" && (!melhor || j.em > melhor.em)) melhor = { em: j.em, diverge: j.resumo?.diverge ?? 0 };
  }
  return melhor;
}

const exigeId = (o: OpcoesAcao) => {
  if (o.acao !== "criar" && !o.id) throw new Error(`--acao ${o.acao} exige -i <id> do painel (falta o id)`);
};

/** A lógica de `dashboard-acao`, sem withClient (o teste injeta o cliente). */
export async function executarDashboardAcao(
  client: Parameters<typeof detalhePainel>[0], o: OpcoesAcao, log: (m: string) => void = () => {}, novoId: () => string = objectId,
): Promise<Record<string, any>> {
  if (!ACOES_ESCRITA.includes(o.acao)) throw new Error(`--acao inválida: ${o.acao}. Aceitas: ${ACOES_ESCRITA.join(", ")}`);
  exigeId(o);
  const loc = o.location;
  const problemas: Problema[] = [];
  let avisos: Problema[] = [];
  const mudancas: string[] = [];

  if (o.acao === "criar") {
    if (!o.titulo) throw new Error("--acao criar exige --titulo");
    mudancas.push(`criar o painel privado "${o.titulo}"`);
    if (!o.confirmo) {
      return { acao: o.acao, aplicado: false, motivo: "prévia: nada foi gravado; repita com --confirmo", painel: { id: null, titulo: o.titulo, isDefault: false, isPrivate: true }, versao: null, mudancas, problemas, avisos };
    }
    const resposta = await criarPainel(client, loc, o.titulo);
    const novoId = (resposta as { data?: { _id?: string } })?.data?._id ?? "novo";
    const registro = registroEscrita(loc, "_dashboards", novoId, { acao: o.acao, titulo: o.titulo, resposta });
    return { acao: o.acao, aplicado: true, painel: { id: novoId, titulo: o.titulo, isDefault: false, isPrivate: true }, mudancas, problemas, avisos, registro, resposta };
  }

  const id = o.id!;
  const painel = await detalhePainel(client, loc, id);
  if (painel.isDefault && (o.acao === "apagar" || o.acao === "editar")) {
    throw new Error(`o painel ${id} é o painel padrão da subconta: ${o.acao} recusado`);
  }
  const tema = temaAninhado((painel.themeConfig ?? {}) as Record<string, any>);
  const layoutAtual = painel.widgets.map((w) => {
    const [mw, mh] = minimosDoTipo(w.chartType ?? "");
    return { id: w.widgetId, x: w.layout.x, y: w.layout.y, w: w.layout.w, h: w.layout.h, minW: w.layout.minW ?? mw, minH: w.layout.minH ?? mh };
  });
  type Item = { id: string; x: number; y: number; w: number; h: number; minW: number; minH: number };
  let corpo: CorpoSalvar = { title: painel.titulo, activityBuffer: {}, layout: layoutAtual, themeConfig: tema as unknown, version: painel.__v };
  let posicionar: Item[] | null = null; // 2º PUT: o layout enviado junto do create é ignorado pelo servidor
  let idsServidor = new Map(painel.widgets.map((w) => [w.widgetId, w.dashboardWidgetId ?? w.widgetId]));
  // O PUT acha o item do layout pelo _id da linha de dashboardWidgets; id desconhecido é no-op silencioso.
  const enviar = (c: CorpoSalvar) => salvarPainel(client, loc, id, { ...c, layout: c.layout.map((i) => ({ ...i, id: idsServidor.get(i.id) ?? i.id })) });
  let escrever: () => Promise<unknown>;

  if (o.acao === "renomear") {
    if (!o.titulo) throw new Error("--acao renomear exige --titulo");
    corpo.title = o.titulo;
    mudancas.push(`renomear "${painel.titulo}" para "${o.titulo}"`);
    escrever = () => enviar(corpo);
  } else if (o.acao === "tema") {
    const bruto = JSON.parse(o.tema ?? "null") as Record<string, any> | null;
    if (!bruto || typeof bruto !== "object") throw new Error("--acao tema exige --tema '{\"metricColor\":\"#RRGGBB\"}'");
    const novo: Record<string, string> = temaAninhado(bruto).dashboardTheme;
    for (const [k, v] of Object.entries(novo)) {
      if (!HEX.test(v)) problemas.push({ codigo: "cor_invalida", mensagem: `${k}: "${v}" não está no formato #RRGGBB.` });
    }
    const m = { ...tema.dashboardTheme, ...novo };
    for (const k of ["metricColor", "titleColor"]) {
      if (HEX.test(m[k]) && HEX.test(m.backgroundColor) && contraste(m[k], m.backgroundColor) < 4.5) {
        problemas.push({ codigo: "contraste", mensagem: `${k} ${m[k]} sobre ${m.backgroundColor} tem contraste ${contraste(m[k], m.backgroundColor).toFixed(2)}:1, abaixo de 4.5:1.` });
      }
    }
    corpo.themeConfig = { ...tema, dashboardTheme: m };
    mudancas.push(`tema: ${Object.keys(novo).join(", ")}`);
    escrever = () => enviar(corpo);
  } else if (o.acao === "editar") {
    const p = lerPlano(o.plano);
    const criar = p.criar ?? [];
    for (const c of criar) {
      if (!c.molde) throw new Error(`widget novo ${c.id} sem molde: copie um widget do mesmo tipo de outro painel (-o catalogo ou -o detalhe) para o campo molde`);
    }
    const remover = p.remover ?? [];
    const atualizar = p.atualizar ?? [];
    const layout = p.layout ?? layoutAtual.filter((i) => !remover.includes(i.id));
    for (const c of criar) if (!layout.some((i) => i.id === c.id)) throw new Error(`o layout não inclui o widget novo ${c.id}`);
    const tipo = new Map(painel.widgets.map((w) => [w.widgetId, w]));
    const novos = new Map(criar.map((c) => [c.id, c]));
    problemas.push(...validarLayout(layout.map((i) => ({ ...i, chartType: novos.get(i.id)?.molde?.chartType ?? tipo.get(i.id)?.chartType ?? "" }))));
    avisos = validarComposicao(layout.map((i): ItemPlano => {
      const c = novos.get(i.id);
      const w = tipo.get(i.id);
      return {
        ...i, chartType: c?.molde?.chartType ?? w?.chartType ?? "", module: c?.molde?.module ?? w?.module ?? "",
        titulo: c?.titulo ?? c?.molde?.title ?? w?.titulo ?? "", options: { ...(c ? c.molde?.options : w?.options as object), ...c?.options },
      };
    }));
    // O id do plano é temporário: o servidor exige ObjectId, e o layout o referencia pelo id novo.
    const ids = new Map(criar.map((c) => [c.id, novoId()]));
    const final: Item[] = layout.map((i) => {
      const c = novos.get(i.id);
      const atual = layoutAtual.find((a) => a.id === i.id);
      const [tw, th] = minimosDoTipo(c?.molde?.chartType ?? "");
      return {
        id: ids.get(i.id) ?? i.id, x: i.x, y: i.y, w: i.w, h: i.h,
        minW: atual?.minW ?? c?.molde?.layout?.minW ?? tw, minH: atual?.minH ?? c?.molde?.layout?.minH ?? th,
      };
    });
    const buffer: CorpoSalvar["activityBuffer"] = {};
    if (criar.length) {
      buffer.create = criar.map((c) => {
        const m = c.molde!;
        const w: Record<string, any> = { deleted: false, _id: ids.get(c.id) };
        for (const k of CAMPOS_WIDGET_NOVO) w[k] = m[k];
        w.title = c.titulo ?? m.title;
        w.options = { ...m.options, ...c.options };
        w.metricId = m.group === "custom_metric" ? m.metricId : null;
        return { [ids.get(c.id)!]: w };
      });
    }
    if (atualizar.length) buffer.update = atualizar.map(({ widgetId, ...resto }) => ({ [widgetId]: resto }));
    if (remover.length) buffer.delete = remover;
    const idsNovos = new Set(ids.values());
    const existentes = final.filter((i) => !idsNovos.has(i.id));
    if (criar.length) {
      corpo = { ...corpo, layout: existentes, activityBuffer: buffer };
      posicionar = final;
    } else {
      corpo = { ...corpo, layout: final, activityBuffer: buffer };
    }
    mudancas.push(...criar.map((c) => `criar widget ${c.id}`), ...atualizar.map((a) => `atualizar widget ${a.widgetId}`), ...remover.map((r) => `remover widget ${r}`));
    if (p.layout) mudancas.push("reposicionar o layout");
    escrever = async () => {
      const r = await enviar(corpo);
      if (!posicionar) return r;
      const v = (r as { data?: { __v?: number } })?.data?.__v ?? painel.__v + 1;
      idsServidor = new Map((await detalhePainel(client, loc, id)).widgets.map((w) => [w.widgetId, w.dashboardWidgetId ?? w.widgetId]));
      return enviar({ ...corpo, activityBuffer: {}, layout: posicionar, version: v });
    };
  } else if (o.acao === "publicar") {
    if (!o.papeis) throw new Error("--acao publicar exige --papeis account_admin:read,account_user:read");
    const acessos = o.papeis.split(",").map((p) => {
      const [role, access] = p.trim().split(":");
      if (!PAPEIS.includes(role) || !ACESSOS.includes(access)) {
        throw new Error(`papel inválido: "${p}". Use papel:acesso com papel em ${PAPEIS.join("|")} e acesso em ${ACESSOS.join("|")}`);
      }
      return { role, permission: access };
    });
    mudancas.push(...acessos.map((a) => `${a.role} passa a ver o painel "${painel.titulo}" (${a.permission})`));
    const c = ultimoConferir(loc, id);
    if (c && c.diverge > 0 && !o.forcar) {
      problemas.push({ codigo: "diverge", mensagem: `o último dashboard-conferir achou ${c.diverge} widget(s) que diverge(m): corrija o filtro ou use --forcar` });
    }
    escrever = () => publicarPainel(client, loc, id, acessos);
  } else if (o.acao === "apagar") {
    mudancas.push(`apagar o painel "${painel.titulo}"`);
    escrever = () => apagarPainel(client, loc, id, painel.__v);
  } else {
    if (o.versao === undefined || o.versao === "") throw new Error("--acao restaurar exige --versao <n>");
    mudancas.push(`restaurar a versão ${o.versao}`);
    escrever = () => restaurarVersao(client, loc, id, o.versao!);
  }

  const resumo = { id, titulo: painel.titulo, isDefault: painel.isDefault, isPrivate: painel.isPrivate };
  if (!o.confirmo) {
    return { acao: o.acao, aplicado: false, motivo: "prévia: nada foi gravado; repita com --confirmo e --versao-esperada " + painel.__v, painel: resumo, versao: painel.__v, mudancas, problemas, avisos };
  }
  if (o.versaoEsperada === undefined || o.versaoEsperada === "") throw new Error("--confirmo exige --versao-esperada <n> (a versão que a prévia mostrou)");
  if (Number(o.versaoEsperada) !== painel.__v) {
    throw new Error(`o painel mudou desde a prévia: versão lida ${painel.__v}, esperada ${o.versaoEsperada}. Refaça a prévia.`);
  }
  if (problemas.length) throw new Error(`recusado, sem gravar:\n- ${problemas.map((p) => p.mensagem).join("\n- ")}`);
  const versoes = await versoesPainel(client, loc, id);
  const registro = registroEscrita(loc, "_dashboards", id, { acao: o.acao, versao: painel.__v, versoes, mudancas, corpo: o.acao === "apagar" || o.acao === "restaurar" ? undefined : corpo });
  log(`rastro: ${registro}`);
  const resposta = await escrever();
  return { acao: o.acao, aplicado: true, painel: resumo, versao: painel.__v, mudancas, problemas, avisos, registro, resposta };
}

export async function runDashboardAcao(o: OpcoesAcao): Promise<void> {
  const log = o.json ? console.error : console.log;
  exigeId(o);
  await withClient(o.location, log, async (client) => {
    emitir(o.json, await executarDashboardAcao(client, o, log));
  }, { escrita: !!o.confirmo });
}

/** Leitura: confere cada widget do painel contra uma recontagem. Período: os últimos `dias` (30) até agora. */
export async function runDashboardConferir(opts: { location: string; id?: string; dias?: string; json?: boolean }): Promise<void> {
  const log = opts.json ? console.error : console.log;
  if (!opts.id) throw new Error("dashboard-conferir exige -i <id> do painel (falta o id)");
  const fim = Date.now();
  const dateRange = { inicio: fim - Number(opts.dias ?? 30) * 86_400_000, fim };
  await withClient(opts.location, log, async (client) => {
    const t0 = Date.now();
    const painel = await detalhePainel(client, opts.location, opts.id!);
    const fuso = await fusoDaSubconta(client, opts.location);
    const r = await conferirPainel(client, opts.location, painel, fuso, dateRange);
    // leitura: o rastro é escrito direto (registroEscrita marcaria o envelope como escrita)
    const dir = path.join(DUMPS_DIR, "_dashboards", opts.location, opts.id!);
    fs.mkdirSync(dir, { recursive: true });
    const em = new Date().toISOString();
    fs.writeFileSync(path.join(dir, `${em.replace(/[:.]/g, "-")}-conferir.json`), JSON.stringify({ em, acao: "conferir", resumo: r.resumo }, null, 2));
    emitir(opts.json, { ...r, periodo: dateRange, fuso, segundos: (Date.now() - t0) / 1000 });
  });
}

export function registrarDashboards(program: Command): void {
  program
    .command("dashboard-conferir")
    .description("Confere o número de cada widget do painel contra uma recontagem (leitura ao vivo)")
    .requiredOption("-l, --location <id>", "locationId da subconta")
    .option("-i, --id <id>", "id do painel")
    .option("--dias <n>", "janela em dias até agora", "30")
    .option("--json", "imprime o resultado em JSON no stdout")
    .action((o) => runDashboardConferir(o).catch(falhar));
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
  program
    .command("dashboard-acao")
    .description("ESCREVE painel privado: criar | editar | tema | renomear | apagar | restaurar | publicar. Sem --confirmo é só prévia")
    .requiredOption("-l, --location <id>", "locationId da subconta")
    .requiredOption("--acao <acao>", "criar | editar | tema | renomear | apagar | restaurar | publicar")
    .option("-i, --id <id>", "id do painel (todas menos criar)")
    .option("--titulo <texto>", "título (criar, renomear)")
    .option("--plano <json|arquivo>", "editar: {criar:[{id,titulo,molde}],atualizar:[],remover:[],layout:[{id,x,y,w,h}]}")
    .option("--tema <json>", "tema: cores #RRGGBB (titleColor, backgroundColor, baseColor, metricColor, linkColor)")
    .option("--versao <n>", "restaurar: versão para a qual voltar")
    .option("--versao-esperada <n>", "versão que a prévia mostrou (obrigatória com --confirmo)")
    .option("--papeis <lista>", "publicar: papel:acesso separados por vírgula (account_admin:read,account_user:read)")
    .option("--forcar", "publicar mesmo com o último dashboard-conferir divergente")
    .option("--confirmo", "grava de verdade; sem isso é só prévia")
    .option("--json", "imprime o resultado em JSON no stdout")
    .action((o) => runDashboardAcao(o).catch(falhar));
}
