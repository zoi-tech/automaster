/**
 * `manual-pdf`: gera o PDF do manual do cliente a partir do HTML escrito no modelo da skill
 * automaster-documentar. Injeta o zoi.css, as fontes e a capa ZOI, renderiza no Chrome do
 * sistema e confere duas coisas antes de entregar: seção que não cabe numa página e termo
 * interno que vazou para o texto. Não toca no GHL.
 */
import type { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import type { Browser } from "playwright";
import { emitir, falhar } from "../saida.js";
import { montarCapa, injetar, escapar, PASTA_MANUAL } from "../manual/capa.js";
import { termosInternos, secoesEstouradas } from "../manual/conferencias.js";
import type { MedidaSecao } from "../manual/conferencias.js";
import { caminhoFontes, fontesFaces, baixarFontes } from "../manual/fontes.js";

const PX_POR_MM = 96 / 25.4;
/** A4 menos as margens laterais do @page (22mm de cada lado), a 96 dpi. */
const LARGURA_UTIL = Math.round((210 - 44) * PX_POR_MM);
/** A4 menos as margens de cima (20mm) e de baixo (22mm) do @page, a 96 dpi. */
const ALTURA_UTIL = (297 - 20 - 22) * PX_POR_MM;

interface OpcoesManual {
  html: string; saida?: string; titulo?: string; subtitulo: string; descricao: string;
  preparado: string; email: string; telefone: string; data?: string; json?: boolean;
}

function hoje(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

/** Troca o `<title>` do HTML (ou põe um, se não houver). */
function trocarTitulo(html: string, titulo: string): string {
  const tag = `<title>${escapar(titulo)}</title>`;
  return /<title>[\s\S]*?<\/title>/i.test(html)
    ? html.replace(/<title>[\s\S]*?<\/title>/i, () => tag)
    : html.replace(/<\/head>/i, () => `${tag}\n</head>`);
}

/** Páginas do PDF: cada `/Type /Page` (o `/Pages` é a árvore, não conta). */
function contarPaginas(pdf: string): number {
  return fs.readFileSync(pdf, "latin1").match(/\/Type\s*\/Page(?![a-zA-Z])/g)?.length ?? 0;
}

async function abrirChrome(): Promise<Browser> {
  try {
    return await chromium.launch({ channel: "chrome", headless: true });
  } catch (e) {
    throw new Error(
      `não deu para abrir o Google Chrome do sistema, que gera o PDF. Instale o Chrome e rode de novo. ` +
      `(${e instanceof Error ? e.message.split("\n")[0] : String(e)})`,
      { cause: e },
    );
  }
}

async function runManual(opts: OpcoesManual): Promise<void> {
  const log = opts.json ? console.error : console.log;
  const entrada = path.resolve(opts.html);
  if (!fs.existsSync(entrada)) throw new Error(`HTML do manual não encontrado: ${entrada}`);
  const saida = path.resolve(opts.saida ?? entrada.replace(/\.html?$/i, "") + ".pdf");
  const avisos: string[] = [];

  const css = fs.readFileSync(path.join(PASTA_MANUAL, "zoi.css"), "utf-8");
  const titulo = opts.titulo?.trim() || "Manual";
  const capa = montarCapa({
    titulo, subtitulo: opts.subtitulo, descricao: opts.descricao, preparado: opts.preparado,
    email: opts.email, telefone: opts.telefone, data: opts.data || hoje(),
  });

  const pastaFontes = caminhoFontes();
  let fontes = fontesFaces(pastaFontes);
  if (!fontes) {
    log(`Baixando as fontes da ZOI para ${pastaFontes}...`);
    avisos.push(...await baixarFontes(pastaFontes));
    fontes = fontesFaces(pastaFontes);
    if (!fontes) avisos.push("o PDF saiu sem as fontes da ZOI (Clash Display e Satoshi), com Helvetica/Arial no lugar");
  }

  const html = trocarTitulo(
    injetar(fs.readFileSync(entrada, "utf-8"), css, capa, fontes),
    `${titulo} — ${opts.subtitulo}`,
  );

  const navegador = await abrirChrome();
  let medidas: MedidaSecao[];
  let texto: string;
  try {
    const aba = await navegador.newPage({ viewport: { width: LARGURA_UTIL, height: Math.round(ALTURA_UTIL) } });
    await aba.emulateMedia({ media: "print" });
    await aba.setContent(html, { waitUntil: "load" });
    await aba.evaluate(() => document.fonts.ready.then(() => undefined));
    medidas = await aba.$$eval(".folha:not(.capa)", (folhas) => folhas.map((f) => ({
      titulo: f.querySelector("h2")?.textContent?.trim() ?? "",
      altura: Math.round(f.getBoundingClientRect().height),
    })));
    texto = await aba.evaluate(() => document.body.innerText);
    fs.mkdirSync(path.dirname(saida), { recursive: true });
    await aba.pdf({ path: saida, printBackground: true, preferCSSPageSize: true });
  } finally {
    await navegador.close();
  }

  emitir(opts.json, {
    pdf: saida,
    paginas: contarPaginas(saida),
    secoesEstouradas: secoesEstouradas(medidas, ALTURA_UTIL),
    termosInternos: termosInternos(texto),
    avisos,
  });
}

export function registrarManual(program: Command): void {
  program
    .command("manual-pdf")
    .description("Gera o PDF do manual do cliente (capa ZOI, zoi.css e fontes) e confere seções e termos internos")
    .requiredOption("--html <arquivo>", "HTML do manual, escrito no modelo da skill")
    .option("--saida <arquivo>", "caminho do PDF (padrão: o do HTML com .pdf)")
    .option("--titulo <texto>", "título da capa", "Manual")
    .requiredOption("--subtitulo <texto>", "subtítulo da capa (ex.: Automações da <cliente>)")
    .option("--descricao <texto>", "descrição curta na capa", "")
    .requiredOption("--preparado <nome>", "quem preparou o manual")
    .requiredOption("--email <email>", "e-mail de quem preparou")
    .requiredOption("--telefone <telefone>", "telefone de quem preparou")
    .option("--data <data>", "data da capa, AAAA-MM-DD ou DD/MM/AAAA (padrão: hoje)")
    .option("--json", "imprime o resultado em JSON no stdout")
    .action((o) => runManual(o).catch(falhar));
}
