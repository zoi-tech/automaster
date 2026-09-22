/**
 * Motor de operações sobre o documento de formulário ou survey. Puro: sem
 * rede, sem fs. O documento de entrada nunca é mutado.
 *
 * Formulário: campos em `form.fields` (lista plana).
 * Survey: campos em `slides[].slideData`, um por slide. No survey o botão de
 * envio não é um campo — é estilo em `slide.button` — então a checagem de
 * botão de envio só vale para formulário.
 *
 * A lista de campos tem também blocos de texto (`tag:"header"`) e o aceite de
 * termos — por isso remover exige nomear o alvo, nunca a posição.
 */

// o documento vem do GHL e tem dezenas de campos que não modelamos; `any` aqui
// é deliberado: o que não entendemos precisa atravessar intacto
export type Doc = Record<string, any>;

export type Op =
  | { op: "adicionar-campo"; campo: any; slide?: string; posicao?: number }
  | { op: "remover-campo"; alvo: string }
  | { op: "renomear-campo"; alvo: string; label: string }
  | { op: "reordenar-campos"; ordem: string[]; slide?: string }
  | { op: "mover-campo"; alvo: string; paraSlide: string }
  | { op: "criar-slide"; nome: string; posicao?: number }
  | { op: "remover-slide"; alvo: string }
  | { op: "renomear-slide"; alvo: string; nome: string }
  | { op: "reordenar-slides"; ordem: string[] }
  | { op: "definir"; caminho: string; valor: unknown }
  | { op: "definir-logica"; regras: unknown[] };

/** Elementos da lista que não são campo de dado (só existem em formulário). */
const NAO_CAMPO = new Set(["button", "header", "terms_and_conditions"]);

// fieldCSS/mobileFieldCSS aparecem tanto na raiz do documento quanto sob
// `form.` no documento real — pegar só a segunda forma deixaria passar
// exatamente o caminho que existe de verdade.
// `(\.|$)` em vez de só `$`: pega também um caminho que desce dentro do
// campo proibido (ex.: "form.fieldCSS.algo"), sem confundir com um nome
// vizinho que só começa igual (ex.: "fieldCSSExtra").
export const CAMINHO_PROIBIDO = /^(form\.)?(mobileF|f)ieldCSS(\.|$)/;

export function ehSurvey(doc: Doc): boolean {
  return Array.isArray(doc.slides);
}

/** A lista (ou listas, no survey) onde os campos moram. */
export function listasDeCampos(doc: Doc): { slideId?: string; campos: any[] }[] {
  if (ehSurvey(doc)) {
    return doc.slides.map((s: any) => ({ slideId: s.id, campos: s.slideData ?? [] }));
  }
  return [{ campos: doc.form?.fields ?? [] }];
}

/** Identificador de um campo dentro da lista: `tag` é o que o GHL usa. */
function identifica(campo: any): string {
  return String(campo?.tag ?? campo?.id ?? "");
}

function clonar<T>(v: T): T {
  return structuredClone(v);
}

/** Regra de `form.conditionalLogic` cujo salto aponta para o slide `id`, se existir. */
function regraQueSaltaPara(doc: Doc, id: string): any | undefined {
  const regras = (doc.form?.conditionalLogic ?? []) as any[];
  return regras.find((r) => r?.outcome?.jumpTarget === id);
}

/** Regra de `form.conditionalLogic` cuja condição depende do campo `tag`, se existir. */
function regraQueDependeDe(doc: Doc, tag: string): any | undefined {
  const regras = (doc.form?.conditionalLogic ?? []) as any[];
  return regras.find((r) => (r?.conditions ?? []).some((c: any) => c?.selectedField === tag));
}

function slidePorId(doc: Doc, id: string): any {
  const s = doc.slides.find((x: any) => x.id === id);
  if (!s) throw new Error(`slide ${id} não existe neste survey`);
  return s;
}

/** Onde o campo `alvo` está; erro se não estiver em lugar nenhum. */
function acharCampo(doc: Doc, alvo: string): { lista: any[]; indice: number } {
  for (const { campos } of listasDeCampos(doc)) {
    const i = campos.findIndex((c) => identifica(c) === alvo);
    if (i >= 0) return { lista: campos, indice: i };
  }
  throw new Error(`campo ${alvo} não existe neste documento`);
}

function validar(doc: Doc, permitirSemBotao: boolean, permitirVazio: boolean): void {
  if (ehSurvey(doc) && doc.slides.length === 0) {
    throw new Error("a operação deixaria o survey sem nenhum slide");
  }

  const todos = listasDeCampos(doc).flatMap((l) => l.campos);
  const campos = todos.filter((c) => !NAO_CAMPO.has(identifica(c)));
  if (campos.length === 0 && !permitirVazio) {
    throw new Error(
      "a operação deixaria o documento sem nenhum campo — um formulário assim recebe " +
      "visita e não coleta nada. Se é isso mesmo, repita com --permitir-vazio.",
    );
  }

  // survey não tem campo "button" na lista — o botão é estilo em
  // slide.button — então essa checagem só vale para formulário.
  if (!ehSurvey(doc) && !permitirSemBotao && !todos.some((c) => identifica(c) === "button")) {
    throw new Error(
      "a operação deixaria o documento sem botão de envio — ele continua no ar e nenhum " +
      "lead consegue enviar. Se é isso mesmo, repita com --permitir-sem-botao.",
    );
  }
}

export function aplicar(
  entrada: Doc, ops: Op[], opts: { permitirSemBotao?: boolean; permitirVazio?: boolean } = {},
): Doc {
  const doc = clonar(entrada);

  for (const o of ops) {
    switch (o.op) {
      case "adicionar-campo": {
        // Sem `slide`, cai no ÚLTIMO — mesmo default de `reordenar-campos`,
        // de propósito (ver comentário lá).
        let lista: any[];
        if (ehSurvey(doc)) {
          const s = o.slide ? slidePorId(doc, o.slide) : doc.slides.at(-1);
          s.slideData ??= [];
          lista = s.slideData;
        } else {
          doc.form ??= {};
          doc.form.fields ??= [];
          lista = doc.form.fields;
        }
        const iBotao = lista.findIndex((c) => identifica(c) === "button");
        const pos = o.posicao ?? (iBotao >= 0 ? iBotao : lista.length);
        lista.splice(pos, 0, clonar(o.campo));
        break;
      }
      case "remover-campo": {
        const { lista, indice } = acharCampo(doc, o.alvo);
        const regra = regraQueDependeDe(doc, o.alvo);
        if (regra) {
          throw new Error(
            `campo ${o.alvo} é usado numa condição de lógica condicional (regra que salta ` +
            `para ${regra.outcome?.jumpTarget}) e removê-lo deixaria a regra órfã. Ajuste ou ` +
            "remova a regra primeiro (op definir-logica).",
          );
        }
        lista.splice(indice, 1);
        break;
      }
      case "renomear-campo": {
        const { lista, indice } = acharCampo(doc, o.alvo);
        lista[indice].label = o.label;
        break;
      }
      case "reordenar-campos": {
        // Sem `slide`, cai no ÚLTIMO — mesmo default de `adicionar-campo`,
        // para que "adicionar três campos, depois reordenar sem --slide"
        // opere no mesmo slide nos dois passos.
        let alvo: any[];
        if (ehSurvey(doc)) {
          const s = o.slide ? slidePorId(doc, o.slide) : doc.slides.at(-1);
          if (!s) throw new Error("survey sem slides — nada para reordenar");
          s.slideData ??= [];
          alvo = s.slideData;
        } else {
          doc.form ??= {};
          doc.form.fields ??= [];
          alvo = doc.form.fields;
        }
        const nomeados = o.ordem.map((t) => {
          const c = alvo.find((x: any) => identifica(x) === t);
          if (!c) throw new Error(`campo ${t} não existe neste documento`);
          return c;
        });
        const resto = alvo.filter((c: any) => !o.ordem.includes(identifica(c)));
        alvo.splice(0, alvo.length, ...nomeados, ...resto);
        break;
      }
      case "mover-campo": {
        if (!ehSurvey(doc)) throw new Error("mover campo entre slides só existe em survey");
        const destino = slidePorId(doc, o.paraSlide);
        const { lista, indice } = acharCampo(doc, o.alvo);
        const [c] = lista.splice(indice, 1);
        destino.slideData ??= [];
        destino.slideData.push(c);
        break;
      }
      case "criar-slide": {
        if (!ehSurvey(doc)) throw new Error("slide só existe em survey");
        const id = `${Date.now()}-${doc.slides.length}`;
        const novo = { id, slideName: o.nome, button: clonar(doc.slides.at(-1)?.button ?? {}), slideData: [] };
        doc.slides.splice(o.posicao ?? doc.slides.length, 0, novo);
        break;
      }
      case "remover-slide": {
        if (!ehSurvey(doc)) throw new Error("slide só existe em survey");
        const i = doc.slides.findIndex((s: any) => s.id === o.alvo);
        if (i < 0) throw new Error(`slide ${o.alvo} não existe neste survey`);
        const regraSalto = regraQueSaltaPara(doc, o.alvo);
        if (regraSalto) {
          const campos = ((regraSalto.conditions ?? []) as any[])
            .map((c: any) => c?.selectedField).filter(Boolean).join(", ") || "nenhum campo";
          throw new Error(
            `slide ${o.alvo} é o destino de uma regra de lógica condicional (salto para ` +
            `este slide, condição em ${campos}) e removê-lo deixaria essa regra órfã. ` +
            "Ajuste ou remova a regra primeiro (op definir-logica).",
          );
        }
        // remover o slide também remove os campos do `slideData` dele — uma
        // regra que dependa de um desses campos (mas salte para OUTRO slide)
        // ficaria órfã do mesmo jeito, e sem essa checagem passava batido.
        // Reaproveita a mesma função de `remover-campo`, um campo por vez.
        for (const campo of doc.slides[i].slideData ?? []) {
          const tag = identifica(campo);
          const regraCampo = regraQueDependeDe(doc, tag);
          if (regraCampo) {
            throw new Error(
              `slide ${o.alvo} contém o campo ${tag}, usado numa condição de lógica ` +
              `condicional (regra que salta para ${regraCampo.outcome?.jumpTarget}), e ` +
              "removê-lo deixaria essa regra órfã. Ajuste ou remova a regra primeiro " +
              "(op definir-logica).",
            );
          }
        }
        doc.slides.splice(i, 1);
        break;
      }
      case "renomear-slide": {
        if (!ehSurvey(doc)) throw new Error("slide só existe em survey");
        slidePorId(doc, o.alvo).slideName = o.nome;
        break;
      }
      case "reordenar-slides": {
        if (!ehSurvey(doc)) throw new Error("slide só existe em survey");
        const nomeados = o.ordem.map((id) => slidePorId(doc, id));
        const resto = doc.slides.filter((s: any) => !o.ordem.includes(s.id));
        doc.slides = [...nomeados, ...resto];
        break;
      }
      case "definir-logica": {
        // Sem `slide`: form.conditionalLogic é do documento inteiro, não por
        // slide — nenhuma das 29 amostras reais tem lógica por slide (ver
        // docs/superpowers/.../logica-condicional.md).
        const regras = o.regras as any[];
        if (ehSurvey(doc)) {
          for (const r of regras) {
            const alvo = (r as any)?.outcome?.jumpTarget;
            if (alvo != null && !doc.slides.some((s: any) => s.id === alvo)) {
              throw new Error(
                `regra de lógica condicional aponta para o slide ${alvo}, que não existe neste survey`,
              );
            }
          }
        }
        // formulário (não-survey) também tem form.conditionalLogic, mas sem
        // slides não há como validar jumpTarget — escreve sem checagem.
        doc.form ??= {};
        doc.form.conditionalLogic = clonar(regras);
        break;
      }
      case "definir": {
        if (CAMINHO_PROIBIDO.test(o.caminho)) {
          throw new Error(
            `${o.caminho} é gerado pelo builder a partir de form.fieldStyle: o que for escrito ` +
            "aqui some assim que alguém abrir o formulário na interface. Use fieldStyle ou customStyle.",
          );
        }
        const partes = o.caminho.split(".");
        let alvo: any = doc;
        for (const p of partes.slice(0, -1)) {
          alvo[p] ??= {};
          alvo = alvo[p];
        }
        alvo[partes.at(-1)!] = o.valor;
        break;
      }
      default:
        // sem este default, um `op` com typo era ignorado em silêncio: o loop
        // seguia, a operação não acontecia, e quem chamou terminava com
        // "aplicado:true" sem saber que nada mudou.
        throw new Error(
          `operação desconhecida: "${(o as any).op}". Aceitas: adicionar-campo, remover-campo, ` +
          "renomear-campo, reordenar-campos, mover-campo, criar-slide, remover-slide, " +
          "renomear-slide, reordenar-slides, definir-logica, definir.",
        );
    }
  }

  validar(doc, opts.permitirSemBotao ?? false, opts.permitirVazio ?? false);
  return doc;
}
