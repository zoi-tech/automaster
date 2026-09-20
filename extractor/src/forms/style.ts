import type { Doc, Op } from "./doc.js";
import { ehSurvey } from "./doc.js";

/**
 * Tokens de identidade visual, produzidos pela skill
 * `automaster-formulario-visual`, traduzidos aqui para o que o GHL guarda.
 *
 * Só dois destinos: `form.fieldStyle` (o painel do builder, que sobrevive a
 * edição na interface) e `form.customStyle` (CSS livre). `fieldCSS` é gerado
 * pelo builder e nunca recebe escrita nossa.
 */
export interface Tokens {
  corPrimaria: string;
  corTexto: string;
  corFundo: string;
  corBorda: string;
  corErro: string;
  fonte: string;
  tamanhoRotulo: number;
  pesoRotulo: number;
  radius: number;
  espacamento: number;
  cssLivre?: string;
}

const HEX = /^#?([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/;

/** `#0f62fe` → `0f62feFF`. O GHL guarda cor em 8 dígitos, sem cerquilha. */
export function cor(v: string): string {
  const m = HEX.exec(v.trim());
  if (!m) throw new Error(`cor inválida: ${v}. Use hex, ex.: #0f62fe`);
  return `${m[1]}${m[2] ?? "FF"}`;
}

export function opsDeEstilo(doc: Doc, t: Tokens): Op[] {
  const def = (caminho: string, valor: unknown): Op => ({ op: "definir", caminho, valor });
  const ops: Op[] = [
    def("form.fieldStyle.bgColor", cor(t.corFundo)),
    def("form.fieldStyle.fontColor", cor(t.corTexto)),
    def("form.fieldStyle.labelColor", cor(t.corTexto)),
    def("form.fieldStyle.labelFontFamily", t.fonte),
    def("form.fieldStyle.labelFontSize", t.tamanhoRotulo),
    def("form.fieldStyle.labelFontWeight", t.pesoRotulo),
    def("form.fieldStyle.placeholderColor", cor(t.corBorda)),
    def("form.fieldStyle.border.color", cor(t.corBorda)),
    def("form.fieldStyle.border.radius", t.radius),
    def("form.fieldStyle.padding", {
      top: Math.round(t.espacamento / 2), bottom: Math.round(t.espacamento / 2),
      left: Math.round(t.espacamento / 2), right: Math.round(t.espacamento / 2),
    }),
    def("form.style.fieldSpacing", t.espacamento),
    def("form.style.background", cor(t.corFundo)),
    def("form.submitMessageStyle.fontColor", cor(t.corTexto)),
    def("form.customStyle", t.cssLivre ?? ""),
  ];
  if (ehSurvey(doc)) {
    ops.push(
      def("form.footerStyle.backgroundFill", cor(t.corFundo)),
      def("form.footerStyle.buttonStyle.fontColor", cor(t.corFundo)),
      def("form.footerStyle.buttonStyle.nextButtonBgColor", cor(t.corPrimaria)),
      def("form.footerStyle.buttonStyle.submitButtonBgColor", cor(t.corPrimaria)),
      def("form.footerStyle.buttonStyle.backButtonBgColor", cor(t.corBorda)),
    );
  }
  return ops;
}

/**
 * Corpo de `POST /forms/default-colors`: a paleta padrão da subconta.
 *
 * Nota: estas chaves (`primary`, `text`, `background`, `border`, `error`) são
 * uma hipótese. Antes de gravar a paleta ao vivo (Tarefa 5), leia
 * `GET /forms/default-colors` de uma subconta que já tenha uma e ajuste as
 * chaves ao que o servidor devolve. Se as chaves divergirem, corrija aqui e
 * no teste.
 */
export function paletaDeTokens(t: Tokens): Record<string, string> {
  return {
    primary: cor(t.corPrimaria),
    text: cor(t.corTexto),
    background: cor(t.corFundo),
    border: cor(t.corBorda),
    error: cor(t.corErro),
  };
}
