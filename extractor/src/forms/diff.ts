import type { Doc } from "./doc.js";
import { listasDeCampos, CAMINHO_PROIBIDO } from "./doc.js";

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

// Mesmo critério de `doc.ts` (CAMINHO_PROIBIDO): fieldCSS/mobileFieldCSS são
// blocos de CSS gigantes gerados pelo builder — se escaparem, a prévia vira
// uma parede ilegível.
const ignorar = (caminho: string) => caminho === "form.fields" || caminho === "slides" || CAMINHO_PROIBIDO.test(caminho);

/** Linhas legíveis do que muda entre dois documentos. Lista vazia = nada muda. */
export function diferenca(antes: Doc, depois: Doc): string[] {
  const linhas: string[] = [];

  // Slides são entidade de primeira classe só em survey; `achatar` ignora
  // `slides` por completo (abaixo) para não duplicar o conteúdo de
  // `slideData` — que já sai coberto pela listagem de tags de campo — e para
  // não poluir a prévia com todo campo de estilo de cada slide (`button`,
  // `border`, `active`, ...). Entrar/saltar/renomear/reordenar slide, porém,
  // precisa de linha própria: sem ela a prévia fica cega para essas quatro
  // operações e o operador confirma uma escrita sem ver o que vai mudar.
  const slidesDe = (d: Doc): any[] => (Array.isArray(d.slides) ? d.slides : []);
  const idsSlide = (d: Doc) => slidesDe(d).map((s: any) => s.id);
  const nomesSlide = (d: Doc) => Object.fromEntries(
    slidesDe(d).map((s: any) => [s.id, s.slideName]));

  const sa = idsSlide(antes);
  const sb = idsSlide(depois);
  for (const id of sb) if (!sa.includes(id)) linhas.push(`+ slide ${id}`);
  for (const id of sa) if (!sb.includes(id)) linhas.push(`- slide ${id}`);
  if (sa.length === sb.length && sa.join() !== sb.join() && linhas.length === 0) {
    linhas.push(`~ ordem dos slides: ${sa.join(", ")} → ${sb.join(", ")}`);
  }

  const nsa = nomesSlide(antes);
  const nsb = nomesSlide(depois);
  for (const [id, nome] of Object.entries(nsb)) {
    if (id in nsa && nsa[id] !== nome) linhas.push(`~ nome do slide ${id}: ${nsa[id]} → ${nome}`);
  }

  const tags = (d: Doc) => listasDeCampos(d).flatMap((l) =>
    l.campos.map((c: any) => `${l.slideId ? `${l.slideId}/` : ""}${c.tag ?? c.id}`));

  const rotulos = (d: Doc) => Object.fromEntries(
    listasDeCampos(d).flatMap((l) => l.campos.map((c: any) => [c.tag ?? c.id, c.label])));
  const a = tags(antes);
  const b = tags(depois);
  const antesDeCampos = linhas.length;
  for (const t of b) if (!a.includes(t)) linhas.push(`+ campo ${t}`);
  for (const t of a) if (!b.includes(t)) linhas.push(`- campo ${t}`);
  if (a.length === b.length && a.join() !== b.join() && linhas.length === antesDeCampos) {
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
