/** Um step do workflow. Encadeia por ponteiro: `next` é id, lista de ids, ou nada. */
export interface Step {
  id: string;
  type?: string;
  name?: string;
  /** Pai no encadeamento. O servidor grava `parentKey`; `parent` nunca aparece. */
  parentKey?: string;
  next?: string | string[] | null;
  attributes?: Record<string, any>;
  [k: string]: unknown;
}

/** O documento do workflow, como `GET /workflow/<loc>/<wid>` devolve. */
export interface Documento {
  _id?: string;
  name?: string;
  status?: string;
  version?: number;
  workflowData: { templates: Step[] };
  /**
   * NÃO vem do `GET /workflow/<loc>/<wid>` — a resposta só traz `triggersFilePath`.
   * Quem quiser diff de trigger preenche esta chave com a lista autoritativa de
   * `GET /workflow/<loc>/trigger?workflowId=<wid>`.
   */
  triggersData?: any[];
  [k: string]: unknown;
}

export interface Resultado {
  doc: Documento;
  /** Descrição de cada mudança aplicada; vazio = nada mudou. */
  mudancas: string[];
  /** Avisos sobre o que a operação NÃO fez; não impedem gravar. */
  avisos?: string[];
}

const clonar = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/**
 * Troca um id em qualquer profundidade do documento. Ids do GHL são opacos e
 * longos (uuid/ObjectId), então comparar a string inteira não colide com texto
 * de mensagem. Para TAG, que é referenciada por NOME, use `trocarTag`.
 */
export function trocarReferencia(doc: Documento, de: string, para: string): Resultado {
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
  const raizes = steps.filter((s) => s.id && !s.parentKey).map((s) => s.id);
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
  const temRaiz = steps.some((s) => s.id && !s.parentKey);
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

const porId = (steps: Step[]): Map<string, Step> =>
  new Map(steps.filter((s) => s?.id).map((s) => [s.id, s]));

const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

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
export function checarPublicavel(doc: Documento): string[] {
  const steps = doc.workflowData?.templates ?? [];
  const erros: string[] = [];
  if (!steps.length) {
    erros.push("o workflow ficaria sem nenhuma ação, e o app recusa salvar workflow vazio");
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

export interface DiffWorkflow {
  nome?: { antes?: string; depois?: string };
  stepsAdicionados: { id: string; nome?: string; tipo?: string }[];
  stepsRemovidos: { id: string; nome?: string; tipo?: string }[];
  stepsAlterados: { id: string; nome?: string; tipo?: string; campos: string[] }[];
  triggersAdicionados: { id: string; nome?: string }[];
  triggersRemovidos: { id: string; nome?: string }[];
  triggersAlterados: { id: string; nome?: string }[];
  vazio: boolean;
}

/** Caminhos (com ponto) dos campos que diferem entre dois objetos. */
function camposDiferentes(a: any, b: any, prefixo = ""): string[] {
  if (igual(a, b)) return [];
  const obj = (v: unknown) => v && typeof v === "object" && !Array.isArray(v);
  if (!obj(a) || !obj(b)) return [prefixo || "(valor)"];
  const chaves = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out: string[] = [];
  for (const k of chaves) out.push(...camposDiferentes(a[k], b[k], prefixo ? `${prefixo}.${k}` : k));
  return out;
}

const rotuloStep = (s: Step) => ({ id: s.id, nome: s.name, tipo: s.type });

export function diffWorkflow(antes: Documento, depois: Documento): DiffWorkflow {
  const a = porId(antes.workflowData?.templates ?? []);
  const d = porId(depois.workflowData?.templates ?? []);
  const stepsAdicionados = [...d.values()].filter((s) => !a.has(s.id)).map(rotuloStep);
  const stepsRemovidos = [...a.values()].filter((s) => !d.has(s.id)).map(rotuloStep);
  const stepsAlterados = [...d.values()]
    .filter((s) => a.has(s.id) && !igual(a.get(s.id), s))
    .map((s) => ({ ...rotuloStep(s), campos: camposDiferentes(a.get(s.id), s) }));

  const ta = new Map((antes.triggersData ?? []).map((t: any) => [t?.id, t]));
  const td = new Map((depois.triggersData ?? []).map((t: any) => [t?.id, t]));
  const rotuloTrigger = (t: any) => ({ id: t?.id, nome: t?.name });
  const triggersAdicionados = [...td.values()].filter((t: any) => !ta.has(t?.id)).map(rotuloTrigger);
  const triggersRemovidos = [...ta.values()].filter((t: any) => !td.has(t?.id)).map(rotuloTrigger);
  const triggersAlterados = [...td.values()]
    .filter((t: any) => ta.has(t?.id) && !igual(ta.get(t?.id), t))
    .map(rotuloTrigger);

  const nome = antes.name === depois.name ? undefined : { antes: antes.name, depois: depois.name };
  const vazio =
    !nome && !stepsAdicionados.length && !stepsRemovidos.length && !stepsAlterados.length &&
    !triggersAdicionados.length && !triggersRemovidos.length && !triggersAlterados.length;
  return {
    nome, stepsAdicionados, stepsRemovidos, stepsAlterados,
    triggersAdicionados, triggersRemovidos, triggersAlterados, vazio,
  };
}
