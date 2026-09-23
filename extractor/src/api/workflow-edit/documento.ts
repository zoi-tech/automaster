/**
 * Edições sobre o documento inteiro: referências, tags, órfãos, atributos, nome.
 *
 * O que muda o CANVAS (criar, remover e mover step) mora em `canvas.ts`; as guardas que
 * decidem se a gravação pode sair, em `guardas.ts`.
 */
import type { Step, Documento, Resultado } from "./tipos.js";
import { clonar, pareceId, paiDe, porId, igual } from "./tipos.js";

/**
 * Troca um id em qualquer profundidade do documento, inclusive dentro de strings
 * maiores. Por isso `de` TEM que ser um id: ver `pareceId`. Para TAG, que é
 * referenciada por NOME, use `trocarTag`.
 */
export function trocarReferencia(doc: Documento, de: string, para: string): Resultado {
  if (!pareceId(de)) {
    throw new Error(
      `--de ${JSON.stringify(de)} não parece um id: trocar-ref substitui em qualquer profundidade ` +
      "do documento, inclusive DENTRO do texto de SMS, e-mail e WhatsApp. Texto livre aqui reescreveria " +
      "o que o cliente fala com a base dele. Para trocar tag pelo nome use --acao trocar-tag; para um " +
      "campo de um step, --acao atributo.",
    );
  }
  const out = clonar(doc);
  const mudancas: string[] = [];
  const avisos: string[] = [];
  const anda = (no: any, caminho: string): any => {
    if (typeof no === "string") {
      if (no === de) { mudancas.push(caminho); return para; }
      if (no.includes(de)) { mudancas.push(caminho); return no.split(de).join(para); }
      return no;
    }
    if (Array.isArray(no)) return no.map((v, i) => anda(v, `${caminho}[${i}]`));
    if (no && typeof no === "object") {
      const antes = JSON.stringify(no);
      for (const k of Object.keys(no)) no[k] = anda(no[k], `${caminho}.${k}`);
      // O id manda, mas o app mostra `title`: trocado o id, o rótulo humano fica
      // velho e confunde quem abrir o editor. Não dá para adivinhar o rótulo novo.
      if (JSON.stringify(no) !== antes && typeof no.title === "string" && no.title) {
        avisos.push(`${caminho}: o rótulo continua "${no.title}" — o id mudou, o texto não`);
      }
    }
    return no;
  };
  anda(out.workflowData?.templates, "steps");
  anda(out.triggersData, "triggers");
  return { doc: out, mudancas, avisos };
}

const mesmaTag = (a: unknown, b: string) =>
  typeof a === "string" && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Troca uma tag pelo nome, SÓ onde tag mora: `attributes.tags` de
 * add/remove_contact_tag e `conditionValue` de condição com
 * `conditionSubType: "tags"`. Nunca varre texto livre — trocar em mensagem
 * reescreveria o que o cliente fala com o contato.
 */
export function trocarTag(doc: Documento, de: string, para: string): Resultado {
  const out = clonar(doc);
  const mudancas: string[] = [];
  for (const step of out.workflowData?.templates ?? []) {
    const attrs = step.attributes ?? {};
    if (step.type === "add_contact_tag" || step.type === "remove_contact_tag") {
      const tags = attrs.tags;
      if (Array.isArray(tags) && tags.some((t) => mesmaTag(t, de))) {
        attrs.tags = tags.map((t) => (mesmaTag(t, de) ? para : t));
        mudancas.push(`step ${step.id} (${step.type})`);
      }
    }
    const condicoes: any[] = [];
    const cata = (no: any): void => {
      if (Array.isArray(no)) { no.forEach(cata); return; }
      if (no && typeof no === "object") {
        if (no.conditionSubType === "tags") condicoes.push(no);
        Object.values(no).forEach(cata);
      }
    };
    cata(attrs);
    for (const c of condicoes) {
      if (Array.isArray(c.conditionValue) && c.conditionValue.some((t: unknown) => mesmaTag(t, de))) {
        c.conditionValue = c.conditionValue.map((t: unknown) => (mesmaTag(t, de) ? para : t));
        mudancas.push(`step ${step.id} (condição)`);
      }
    }
  }
  return { doc: out, mudancas };
}

/** Ids alcançáveis a partir das entradas, seguindo `next` e `goto`. */
function alcancaveis(steps: Step[]): Set<string> {
  const porId = new Map(steps.filter((s) => s.id).map((s) => [s.id, s]));
  const raizes = steps.filter((s) => s.id && !paiDe(s)).map((s) => s.id);
  const vistos = new Set<string>();
  const fila = [...raizes];
  while (fila.length) {
    const id = fila.shift()!;
    if (vistos.has(id)) continue;
    vistos.add(id);
    const s = porId.get(id);
    if (!s) continue;
    const proximos: string[] = [];
    if (Array.isArray(s.next)) proximos.push(...s.next.filter((x): x is string => typeof x === "string" && !!x));
    else if (typeof s.next === "string" && s.next) proximos.push(s.next);
    if (s.type === "goto") {
      const alvo = s.attributes?.targetNodeId;
      if (typeof alvo === "string" && alvo) proximos.push(alvo);
    }
    fila.push(...proximos);
  }
  return vistos;
}

/**
 * Remove os steps que nunca executam. Ninguém alcançável aponta para eles, então
 * não há ponteiro a recosturar — é por isso que só o inalcançável sai em A.
 * Workflow sem entrada identificável não é mexido (mesmo critério da regra
 * `unreachable_step` do auditor).
 */
export function removerStepsInalcancaveis(doc: Documento): Resultado {
  const out = clonar(doc);
  const steps = out.workflowData?.templates ?? [];
  const temRaiz = steps.some((s) => s.id && !paiDe(s));
  if (!steps.length || !temRaiz) return { doc: out, mudancas: [] };
  const vivos = alcancaveis(steps);
  const removidos = steps.filter((s) => s.id && !vivos.has(s.id)).map((s) => s.id);
  out.workflowData.templates = steps.filter((s) => !s.id || vivos.has(s.id));
  return { doc: out, mudancas: removidos };
}

/** Escreve em `attributes.<caminho>` de um step. Caminho aninhado usa ponto. */
export function alterarAtributo(doc: Documento, stepId: string, caminho: string, valor: unknown): Resultado {
  const out = clonar(doc);
  const step = (out.workflowData?.templates ?? []).find((s) => s.id === stepId);
  if (!step) throw new Error(`step ${stepId} não existe neste workflow`);
  step.attributes ??= {};
  const partes = caminho.split(".");
  let no: any = step.attributes;
  for (const p of partes.slice(0, -1)) {
    if (typeof no[p] !== "object" || no[p] === null) no[p] = {};
    no = no[p];
  }
  no[partes[partes.length - 1]] = valor;
  return { doc: out, mudancas: [`step ${stepId}: ${caminho}`] };
}

/**
 * Trigger NÃO se edita pelo documento: o `GET` do workflow não traz a lista (só
 * `triggersFilePath`), e o `only-triggers` responde 200 sem criar nada — prova ao
 * vivo em `docs/superpowers/handoffs/2026-09-20-workflows-escrita-prova.md`. A única
 * rota de escrita conhecida é o DELETE de trigger, em `workflows-write.ts`.
 */
export function renomear(doc: Documento, nome: string): Resultado {
  const limpo = nome.trim();
  if (!limpo) throw new Error("nome vazio: o workflow precisa de um nome");
  const out = clonar(doc);
  const antes = out.name;
  out.name = limpo;
  return { doc: out, mudancas: antes === limpo ? [] : [`nome: ${antes} → ${limpo}`] };
}

/**
 * Configurações gerais do workflow que a ação `configuracao` altera. Só entra chave com
 * prova ao vivo de que sobrevive ao save: `allowMultiple` (reentrada), provada na Cliente A
 * Mulher em 2026-09-22. As outras chaves de raiz do documento ficam de fora até serem provadas.
 */
export const CONFIG_CAMPOS = ["allowMultiple"] as const;

export function configurarWorkflow(doc: Documento, campo: string, valor: unknown): Resultado {
  if (!(CONFIG_CAMPOS as readonly string[]).includes(campo)) {
    throw new Error(`--campo ${campo} não é configurável. Use: ${CONFIG_CAMPOS.join(" | ")}`);
  }
  if (typeof valor !== "boolean") throw new Error(`--valor de ${campo} precisa ser true ou false`);
  const out = clonar(doc);
  const antes = out[campo];
  out[campo] = valor;
  return { doc: out, mudancas: antes === valor ? [] : [`${campo}: ${String(antes)} → ${String(valor)}`] };
}

/**
 * Corpo do PUT: o documento EDITADO, tal como veio da leitura, mais as três
 * listas que o app recalcula a cada save e o autor da edição. Nada é inventado:
 * campo que a leitura não trouxe não entra (ver spec, "Como o corpo é montado").
 */
export function montarCorpo(
  original: Documento,
  editado: Documento,
  usuarioId: string,
): Record<string, unknown> {
  const antes = porId(original.workflowData?.templates ?? []);
  const depois = porId(editado.workflowData?.templates ?? []);
  const createdSteps = [...depois.keys()].filter((id) => !antes.has(id));
  const deletedSteps = [...antes.keys()].filter((id) => !depois.has(id));
  const modifiedSteps = [...depois.keys()].filter((id) => antes.has(id) && !igual(antes.get(id), depois.get(id)));
  return { ...clonar(editado), createdSteps, modifiedSteps, deletedSteps, updatedBy: usuarioId };
}

/**
 * As duas validações de publicação do app que dá para replicar sem entender cada
 * tipo de ação. As outras (remetente de e-mail, loop sem corpo, múltiplos goals)
 * ficam para a parte B — limite declarado, não coberto.
 */
export function checarPublicavel(doc: Documento, acao?: string): string[] {
  const steps = doc.workflowData?.templates ?? [];
  const erros: string[] = [];
  if (!steps.length) {
    erros.push(
      acao === "configuracao"
        ? "o workflow ainda não tem nenhum step, e o app recusa salvar workflow vazio: crie o primeiro step (--acao step-criar) e configure depois"
        : "o workflow ficaria sem nenhuma ação, e o app recusa salvar workflow vazio",
    );
  }
  const ids = new Set(steps.map((s) => s.id));
  for (const s of steps) {
    if (s.type !== "goto") continue;
    const alvo = s.attributes?.targetNodeId;
    if (!alvo || !ids.has(alvo)) {
      erros.push(`o step goto '${s.name ?? s.id}' apontaria para ${alvo ?? "lugar nenhum"}, que não existe no workflow`);
    }
  }
  return erros;
}
