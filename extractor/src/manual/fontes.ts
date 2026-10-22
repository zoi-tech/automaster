/**
 * Fontes da ZOI (Clash Display e Satoshi, da Fontshare) para o manual: ficam em
 * `~/.automaster/fontes/` e entram no CSS como `@font-face` em data URI, porque o PDF é
 * gerado de HTML sem servidor.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function caminhoFontes(): string {
  return process.env.AUTOMASTER_FONTES || path.join(os.homedir(), ".automaster", "fontes");
}

const FAMILIAS: Record<string, string> = { ClashDisplay: "Clash Display", Satoshi: "Satoshi" };
const PESOS: Record<string, number> = {
  Thin: 100, Extralight: 200, Light: 300, Regular: 400, Medium: 500, Semibold: 600, Bold: 700, Black: 900,
};
const TIPOS = new Set(["otf", "woff2", "woff", "ttf"]);

/** "ClashDisplay-Semibold.otf" → família, peso, estilo e tipo; nome fora do padrão devolve undefined. */
function lerNome(arquivo: string): { familia: string; peso: number; italico: boolean; tipo: string } | undefined {
  const m = /^([A-Za-z]+)-([A-Za-z]*?)(Italic)?\.([a-z0-9]+)$/.exec(arquivo);
  if (!m || !TIPOS.has(m[4])) return undefined;
  const familia = FAMILIAS[m[1]];
  const peso = PESOS[m[2] || "Regular"];
  if (!familia || !peso) return undefined;
  return { familia, peso, italico: !!m[3], tipo: m[4] };
}

/** Um `@font-face` por arquivo de fonte da pasta. Pasta vazia ou inexistente devolve "". */
export function fontesFaces(dir: string): string {
  let arquivos: string[];
  try {
    arquivos = fs.readdirSync(dir).sort();
  } catch {
    return "";
  }
  const faces: string[] = [];
  for (const arquivo of arquivos) {
    const f = lerNome(arquivo);
    if (!f) continue;
    const b64 = fs.readFileSync(path.join(dir, arquivo)).toString("base64");
    faces.push(`@font-face { font-family: '${f.familia}'; font-weight: ${f.peso}; ` +
      `font-style: ${f.italico ? "italic" : "normal"}; font-display: block; ` +
      `src: url("data:font/${f.tipo};base64,${b64}") format("${f.tipo === "otf" ? "opentype" : f.tipo === "ttf" ? "truetype" : f.tipo}"); }`);
  }
  return faces.join("\n");
}

/** O que baixar da Fontshare e os pesos que o zoi.css usa de cada família. */
const DOWNLOADS = [
  { url: "https://api.fontshare.com/v2/fonts/download/clash-display", prefixo: "ClashDisplay", pesos: ["Medium", "Semibold", "Bold"] },
  { url: "https://api.fontshare.com/v2/fonts/download/satoshi", prefixo: "Satoshi", pesos: ["Regular", "Medium", "Bold"] },
];

function listarArquivos(dir: string): string[] {
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => path.join(d.parentPath, d.name));
}

/**
 * Baixa da Fontshare os pesos usados para a pasta de fontes (woff2; .otf se o zip não tiver
 * woff2). Não lança: devolve os avisos do que deu errado, e o manual segue sem as fontes.
 */
export async function baixarFontes(dir: string = caminhoFontes()): Promise<string[]> {
  const avisos: string[] = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "automaster-fontes-"));
  try {
    fs.mkdirSync(dir, { recursive: true });
    for (const d of DOWNLOADS) {
      try {
        const r = await fetch(d.url, { signal: AbortSignal.timeout(60_000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const zip = path.join(tmp, `${d.prefixo}.zip`);
        fs.writeFileSync(zip, Buffer.from(await r.arrayBuffer()));
        const destino = path.join(tmp, d.prefixo);
        execFileSync("/usr/bin/unzip", ["-q", "-o", zip, "-d", destino], { stdio: "pipe" });
        const arquivos = listarArquivos(destino);
        for (const peso of d.pesos) {
          const achar = (tipo: string): string | undefined =>
            arquivos.find((a) => path.basename(a) === `${d.prefixo}-${peso}.${tipo}`);
          const origem = achar("woff2") ?? achar("otf");
          if (!origem) {
            avisos.push(`fonte ${d.prefixo}-${peso} não veio no zip da Fontshare`);
            continue;
          }
          fs.copyFileSync(origem, path.join(dir, path.basename(origem)));
        }
      } catch (e) {
        avisos.push(`não deu para baixar ${d.prefixo} da Fontshare (${e instanceof Error ? e.message : String(e)}); o PDF sai com Helvetica/Arial no lugar`);
      }
    }
  } catch (e) {
    avisos.push(`não deu para preparar a pasta de fontes ${dir} (${e instanceof Error ? e.message : String(e)}); o PDF sai sem as fontes da ZOI`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return avisos;
}
