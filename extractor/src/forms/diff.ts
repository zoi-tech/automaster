import type { Doc } from "./doc.js";
import { listasDeCampos } from "./doc.js";

/** Achata o documento em caminho → valor, ignorando as listas de campos. */
function achatar(o: unknown, prefixo = "", fora: (caminho: string) => boolean = () => false): Record<string, string> {
  const r: Record<string, string> = {};
  if (o === null || typeof o !== "object" || Array.isArray(o)) {
    if (prefixo) r[prefixo] = JSON.stringify(o);
    return r;
  }
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    const caminho = prefixo ? `${prefixo}.${k}` : k;
    if (fora(caminho)) continue;
    Object.assign(r, achatar(v, caminho, fora));
  }
  return r;
}

// Mesmo critério de `doc.ts` (CAMINHO_PROIBIDO): fieldCSS/mobileFieldCSS
// aparecem na raiz do documento (survey) ou sob `form.` (formulário) nos
// documentos reais. São blocos de CSS gigantes gerados pelo builder — se
// escaparem, a prévia vira uma parede ilegível.
const CAMINHO_IGNORADO = /^(form\.)?(mobileF|f)ieldCSS$/;
const ignorar = (caminho: string) => caminho === "form.fields" || caminho === "slides" || CAMINHO_IGNORADO.test(caminho);

/** Linhas legíveis do que muda entre dois documentos. Lista vazia = nada muda. */
export function diferenca(antes: Doc, depois: Doc): string[] {
  const linhas: string[] = [];

  const tags = (d: Doc) => listasDeCampos(d).flatMap((l) =>
    l.campos.map((c: any) => `${l.slideId ? `${l.slideId}/` : ""}${c.tag ?? c.id}`));

  const rotulos = (d: Doc) => Object.fromEntries(
    listasDeCampos(d).flatMap((l) => l.campos.map((c: any) => [c.tag ?? c.id, c.label])));
  const a = tags(antes);
  const b = tags(depois);
  for (const t of b) if (!a.includes(t)) linhas.push(`+ campo ${t}`);
  for (const t of a) if (!b.includes(t)) linhas.push(`- campo ${t}`);
  if (a.length === b.length && a.join() !== b.join() && !linhas.length) {
    linhas.push(`~ ordem dos campos: ${a.join(", ")} → ${b.join(", ")}`);
  }

  const ra = rotulos(antes);
  const rb = rotulos(depois);
  for (const [t, r] of Object.entries(rb)) {
    if (t in ra && ra[t] !== r) linhas.push(`~ rótulo de ${t}: ${ra[t]} → ${r}`);
  }

  const fa = achatar(antes, "", ignorar);
  const fb = achatar(depois, "", ignorar);
  for (const k of new Set([...Object.keys(fa), ...Object.keys(fb)])) {
    if (fa[k] !== fb[k]) linhas.push(`~ ${k}: ${fa[k] ?? "(vazio)"} → ${fb[k] ?? "(vazio)"}`);
  }
  return linhas;
}
