/**
 * Validador de layout e regras de composição dos painéis (funções puras, sem cliente).
 * Grade de 12 colunas, linha de 54 px (`cellHeight`), igual ao GridStack do app.
 */
export type Problema = { codigo: string; mensagem: string };
export type ItemLayout = { id: string; x: number; y: number; w: number; h: number; chartType: string };
export type ItemPlano = ItemLayout & { titulo: string; module: string; options: Record<string, any> };

const COLUNAS = 12;
const MINIMOS: Record<string, [number, number]> = { numeric: [3, 4], table: [6, 6], funnel: [5, 6] };

/** Mínimos de largura e altura por tipo de widget (o que o GridStack do app impõe). */
export const minimosDoTipo = (chartType: string): [number, number] => MINIMOS[chartType] ?? [4, 6];

export function validarLayout(itens: ItemLayout[]): Problema[] {
  const erros: Problema[] = [];
  const dentro: ItemLayout[] = [];
  for (const i of itens) {
    if (i.x < 0 || i.w < 1 || i.x + i.w > COLUNAS) {
      erros.push({ codigo: "fora_da_grade", mensagem: `O widget ${i.id} sai da grade de ${COLUNAS} colunas (x ${i.x}, largura ${i.w}).` });
    } else dentro.push(i);
    const [mw, mh] = minimosDoTipo(i.chartType);
    if (i.w < mw || i.h < mh) {
      erros.push({ codigo: "abaixo_do_minimo", mensagem: `O widget ${i.id} (${i.chartType}) tem ${i.w}x${i.h}, abaixo do mínimo ${mw}x${mh}.` });
    }
  }
  for (let a = 0; a < itens.length; a++) {
    for (let b = a + 1; b < itens.length; b++) {
      const p = itens[a], q = itens[b];
      if (p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h) {
        erros.push({ codigo: "sobreposicao", mensagem: `Os widgets ${p.id} e ${q.id} se sobrepõem.` });
      }
    }
  }
  // Buraco: só sobre widgets dentro da grade. ponytail: varredura O(linhas*colunas*n), painel tem dezenas de widgets.
  if (dentro.length) {
    const minY = Math.min(...dentro.map((i) => i.y));
    const maxY = Math.max(...dentro.map((i) => i.y + i.h));
    const ocupa = (r: number, c: number, ignora?: ItemLayout) =>
      dentro.some((i) => i !== ignora && c >= i.x && c < i.x + i.w && r >= i.y && r < i.y + i.h);
    const livre = (w: ItemLayout, r: number) => {
      for (let rr = r; rr < r + w.h; rr++) for (let c = w.x; c < w.x + w.w; c++) if (ocupa(rr, c, w)) return false;
      return true;
    };
    const acusados = new Set<ItemLayout>();
    for (let r = minY; r < maxY; r++) {
      for (let c = 0; c < COLUNAS; c++) {
        if (ocupa(r, c)) continue;
        for (const w of dentro) {
          if (w.y > r && c >= w.x && c < w.x + w.w && livre(w, r) && !acusados.has(w)) {
            acusados.add(w);
            erros.push({ codigo: "buraco", mensagem: `Há um buraco na linha ${r} que o widget ${w.id} poderia ocupar subindo.` });
          }
        }
      }
    }
  }
  return erros;
}

export function validarComposicao(plano: ItemPlano[]): Problema[] {
  const avisos: Problema[] = [];
  if (!plano.length) return avisos;
  const topo = Math.min(...plano.map((i) => i.y));
  const numerosNoTopo = plano.filter((i) => i.chartType === "numeric" && i.y === topo).length;
  if (numerosNoTopo > 4) {
    avisos.push({ codigo: "numeros_demais_no_topo", mensagem: `${numerosNoTopo} números na linha do topo; mais de 4 apertam o painel.` });
  }
  for (const i of plano) {
    if (i.chartType === "donut") {
      const limit = i.options?.groupBy?.limit;
      if (typeof limit !== "number" || limit > 5) {
        avisos.push({ codigo: "donut_com_fatias_demais", mensagem: `O donut ${i.id} precisa de groupBy.limit de até 5 fatias.` });
      }
    }
    if (i.module === "crm-opportunities") {
      const data = i.options?.dateProperty;
      if (data && data !== "date_added" && !/data/i.test(i.titulo)) {
        avisos.push({ codigo: "data_nao_dita_no_titulo", mensagem: `O widget ${i.id} usa a data ${data}; o título "${i.titulo}" deveria dizer qual.` });
      }
    }
    if (i.w <= 4 && [...i.titulo].length > 32) {
      avisos.push({ codigo: "titulo_longo", mensagem: `O título do widget ${i.id} passa de 32 caracteres numa largura de ${i.w} colunas.` });
    }
  }
  return avisos;
}

/** Razão de contraste WCAG 2.x entre duas cores "#rrggbb". */
export function contraste(corA: string, corB: string): number {
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [a, b] = [lum(corA), lum(corB)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
