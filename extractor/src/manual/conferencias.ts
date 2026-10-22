/**
 * Conferências do manual antes de entregar: termo interno que vazou para o texto do cliente e
 * seção que não cabe numa página.
 */

export interface TermoInterno {
  termo: string;
  padrao: RegExp;
}

// início e fim de palavra que valem para letra acentuada (o \b do JS só conhece ASCII)
const INI = "(?<![\\p{L}\\d])";
const FIM = "(?![\\p{L}\\d])";

/** O que não pode aparecer no texto do cliente. Todos com `g`; `u` por causa do \p{L}. */
export const TERMOS_INTERNOS: readonly TermoInterno[] = [
  { termo: "id", padrao: /(?<![A-Za-z0-9])(?=[A-Za-z0-9]*[A-Za-z])(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{20,}(?![A-Za-z0-9])/g },
  { termo: "workflow", padrao: new RegExp(`${INI}workflow`, "giu") },
  { termo: "tag", padrao: new RegExp(`${INI}tags?(?=\\s)`, "giu") },
  { termo: "trigger", padrao: new RegExp(`${INI}trigger`, "giu") },
  { termo: "gatilho", padrao: new RegExp(`${INI}gatilho`, "giu") },
  { termo: "webhook", padrao: new RegExp(`${INI}webhook`, "giu") },
  { termo: "automaster", padrao: new RegExp(`${INI}automaster`, "giu") },
  { termo: "Hub", padrao: new RegExp(`${INI}Hub${FIM}`, "gu") },
  { termo: "dump", padrao: new RegExp(`${INI}dump`, "giu") },
  { termo: "→ NNNN]]", padrao: /→ \d{4}\]\]/g },
  { termo: "]]", padrao: /\]\]/g },
  { termo: "{{", padrao: /\{\{/g },
  { termo: "}}", padrao: /\}\}/g },
];

export interface Achado {
  termo: string;
  posicao: number;
  /** O pedaço do texto em volta do achado, para achar no manual. */
  trecho: string;
}

const MARGEM_TRECHO = 30;

/** Cada termo interno do texto, com a posição, em ordem de posição. Texto limpo devolve `[]`. */
export function termosInternos(texto: string): Achado[] {
  const achados: Achado[] = [];
  for (const { termo, padrao } of TERMOS_INTERNOS) {
    for (const m of texto.matchAll(new RegExp(padrao.source, padrao.flags))) {
      const posicao = m.index;
      const trecho = texto.slice(Math.max(0, posicao - MARGEM_TRECHO), posicao + m[0].length + MARGEM_TRECHO)
        .replace(/\s+/g, " ").trim();
      achados.push({ termo, posicao, trecho });
    }
  }
  return achados.sort((a, b) => a.posicao - b.posicao);
}

export interface MedidaSecao {
  titulo: string;
  altura: number;
}

/** As seções mais altas que a altura útil de uma página, na ordem em que vieram. */
export function secoesEstouradas(medidas: MedidaSecao[], alturaUtil: number): MedidaSecao[] {
  return medidas.filter((m) => m.altura > alturaUtil);
}

/**
 * Altura do conteúdo de uma folha: o fundo mais baixo dos elementos visíveis menos o topo da
 * folha. Folha sem elementos mede 0; nunca negativa.
 */
export function alturaConteudo(topoFolha: number, fundos: number[]): number {
  if (fundos.length === 0) return 0;
  return Math.max(0, Math.max(...fundos) - topoFolha);
}

/** Aviso quando o PDF saiu com mais páginas que folhas (alguma folha quebrou em duas). */
export function avisoPaginas(paginas: number, folhas: number): string | null {
  return paginas > folhas ? `o PDF tem ${paginas} páginas para ${folhas} folhas` : null;
}
