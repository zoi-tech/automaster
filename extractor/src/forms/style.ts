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
 * Uma entrada da paleta padrão da subconta: rótulo livre + cor.
 *
 * Medido ao vivo em 2026-09-19 contra `GET /forms/default-colors` na
 * Instaltech (`Xb9gDxwxYhdqtprGcb5E`): o servidor devolve
 * `{colors: [{name, value}, ...]}`, uma LISTA de rótulos livres
 * (`"Secondary"`, `"White"`, `"Black"`, `"#00000024"`, `"#212121ff"` na
 * amostra real), não um mapa fixo de chaves semânticas. A hipótese antiga
 * (`{primary, text, background, ...}` como objeto) estava errada na forma
 * (objeto em vez de lista) e no conteúdo (chaves fixas em vez de rótulo
 * livre). `value` já vem em hex de 8 dígitos, como em `cor()`.
 */
export interface CorNomeada {
  name: string;
  value: string;
}

/**
 * Corpo de `colors` para `POST /forms/default-colors`: a paleta padrão da
 * subconta, no formato medido acima. Os rótulos aqui são nossos — o servidor
 * aceita rótulo livre — escolhidos para nomear o papel de cada token.
 */
export function paletaDeTokens(t: Tokens): CorNomeada[] {
  return [
    { name: "Primary", value: cor(t.corPrimaria) },
    { name: "Text", value: cor(t.corTexto) },
    { name: "Background", value: cor(t.corFundo) },
    { name: "Border", value: cor(t.corBorda) },
    { name: "Error", value: cor(t.corErro) },
  ];
}

/**
 * Mescla os cinco rótulos nossos na paleta ATUAL da subconta, em vez de
 * substituir a lista inteira. Nada prova que `POST /forms/default-colors`
 * mescla sozinho no servidor — só a prova ao vivo da Tarefa 9 vai dizer — e
 * a amostra real da Instaltech tem entradas alheias (`Secondary`, `White`,
 * `Black`, rótulos-hex) que não são nossas e não podem desaparecer. Se o
 * servidor já mesclasse, esta função seria redundante e inofensiva; ela
 * existe porque a hipótese de substituição total não foi descartada.
 *
 * Casamento de `name` é sem diferenciar maiúscula/minúscula, já que o
 * rótulo é livre e a amostra real mistura caixa (`"#212121ff"` etc.).
 */
export function mesclarPaleta(atual: CorNomeada[], t: Tokens): CorNomeada[] {
  const novos = paletaDeTokens(t);
  const resultado = atual.map((c) => ({ ...c }));
  for (const novo of novos) {
    const i = resultado.findIndex((c) => c.name.toLowerCase() === novo.name.toLowerCase());
    if (i >= 0) resultado[i] = { ...resultado[i], value: novo.value };
    else resultado.push(novo);
  }
  return resultado;
}

/**
 * Decide o que gravar em `POST /forms/default-colors`, dado o resultado de
 * tentar ler a paleta atual (`null` = leitura falhou; objeto sem `colors`
 * em lista = leitura respondeu num formato inesperado). Extraído puro para
 * ser testável sem rede — o CLI só chama isto e decide o que fazer com
 * `aviso` (log em stderr, campo na saída JSON).
 */
export function resolverPaleta(
  antes: { colors?: unknown } | null, t: Tokens,
): { colors: CorNomeada[]; aviso?: string } {
  const atualColors = antes?.colors;
  if (Array.isArray(atualColors)) {
    return { colors: mesclarPaleta(atualColors as CorNomeada[], t) };
  }
  if (antes === null) {
    return {
      colors: paletaDeTokens(t),
      aviso: "a paleta anterior não pôde ser lida; as cores que existiam na subconta " +
        "podem ter sido substituídas.",
    };
  }
  return {
    colors: paletaDeTokens(t),
    aviso: "a paleta anterior foi lida, mas não veio no formato esperado (colors não é " +
      "uma lista); as cores que já existiam na subconta podem ter sido substituídas.",
  };
}

/**
 * Monta o objeto de saída de `paleta-gravar` — puro, para que um teste
 * morda se alguém tirar o `aviso` do JSON de novo (achado Crítico da
 * revisão: o campo já foi removido em silêncio uma vez, com a suíte toda
 * passando, porque nada exercitava essa fiação).
 */
export function saidaPaletaGravar(
  args: { resposta: unknown; registro: string; aviso?: string },
): { aplicado: true; acao: "paleta-gravar"; resposta: unknown; registro: string; aviso?: string } {
  return {
    aplicado: true, acao: "paleta-gravar", resposta: args.resposta, registro: args.registro,
    ...(args.aviso ? { aviso: args.aviso } : {}),
  };
}
