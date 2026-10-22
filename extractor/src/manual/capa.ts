/**
 * Capa ZOI do manual (porte da capa do MD Converter, a mesma do mockup aprovado) e a injeção
 * do `zoi.css` e da capa no HTML do manual.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Pasta do modelo do manual na skill, a partir deste módulo (vale em src/ e em dist/). */
export const PASTA_MANUAL = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "skills", "automaster-documentar", "manual",
);

/** Marcador do head onde entra o `<style>` com as fontes e o `zoi.css`. */
export const MARCADOR_CSS = "<!-- CSS DA ZOI -->";
/** Marcador do body onde entra a capa. */
export const MARCADOR_CAPA = "{{CAPA}}";

export interface DadosCapa {
  titulo?: string;
  subtitulo: string;
  descricao: string;
  preparado: string;
  email: string;
  telefone: string;
  /** AAAA-MM-DD ou DD/MM/AAAA. */
  data: string;
}

export function escapar(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** AAAA-MM-DD vira DD/MM/AAAA; qualquer outra coisa fica como veio. */
function dataBr(data: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data.trim());
  return m ? `${m[3]}/${m[2]}/${m[1]}` : data;
}

// Largura do bloco do título na capa: 210mm menos as margens de .capa-centro e .capa-marca.
const LARGURA_TITULO_PT = ((210 - 16.5 - 14 - 7.5) / 25.4) * 72;
// Largura média de um caractere da Clash Display bold, em fração do corpo.
const LARGURA_CARACTERE = 0.55;

/** Corpo do título em pt: 65pt enquanto cabe numa linha, encolhendo até 34pt. */
function tamanhoTitulo(titulo: string): number {
  const cabe = LARGURA_TITULO_PT / (LARGURA_CARACTERE * Math.max(titulo.length, 1));
  return Math.round(Math.min(65, Math.max(34, cabe)) * 10) / 10;
}

/** O `<svg>` do sol da ZOI, sem prólogo XML. */
function sol(): string {
  const svg = fs.readFileSync(path.join(PASTA_MANUAL, "assets", "sol.svg"), "utf-8");
  return svg.slice(svg.indexOf("<svg")).trim();
}

export function montarCapa(dados: DadosCapa): string {
  const titulo = dados.titulo?.trim() || "Manual";
  return `<section class="folha capa" aria-label="Capa">
  <div class="capa-regua"></div>
  <div class="capa-contatos">
    <div><b>ZOI</b><br>Benjamin Constant 2839<br>Joinville — SC, Brasil<br>+55 (47) 9 9638-4996</div>
    <div>contato@zoi.tech<br>www.zoitech.com.br<br><b>Representante Técnico</b><br>Luccas Silveira</div>
  </div>
  <div class="capa-centro">
    <div class="capa-sol">${sol()}</div>
    <h1 class="capa-marca" style="font-size:${tamanhoTitulo(titulo)}pt">${escapar(titulo)}</h1>
    <div class="capa-bloco">
      <div class="capa-sub">${escapar(dados.subtitulo)}</div>
      <div class="capa-desc">${escapar(dados.descricao)}</div>
    </div>
  </div>
  <div class="capa-faixa">
    <div><b>Preparado por:</b><span class="nome">${escapar(dados.preparado)}</span>${escapar(dados.email)}<br>${escapar(dados.telefone)}</div>
    <div><b>Data:</b> ${escapar(dataBr(dados.data))}</div>
  </div>
</section>`;
}

/**
 * Troca o marcador do CSS por um `<style>` (fontes antes do `zoi.css`) e o `{{CAPA}}` pela capa.
 * Replace por função: `$` no CSS ou na capa sai literal.
 */
export function injetar(html: string, css: string, capa: string, fontes: string): string {
  const faltam = [MARCADOR_CSS, MARCADOR_CAPA].filter((m) => !html.includes(m));
  if (faltam.length) {
    throw new Error(`o HTML do manual não tem ${faltam.join(" nem ")}: o modelo precisa de ${MARCADOR_CSS} no head e de ${MARCADOR_CAPA} no começo do body`);
  }
  const estilo = `<style>\n${fontes ? `${fontes}\n` : ""}${css}\n</style>`;
  return html.replace(MARCADOR_CSS, () => estilo).replace(MARCADOR_CAPA, () => capa);
}
