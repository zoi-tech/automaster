/**
 * Montagem do canvas: criar, remover e mover step, com o cuidado de container e ramo.
 *
 * Nenhuma das três estreia rota — as três mandam o documento pelo mesmo save.
 */
import { randomUUID } from "node:crypto";
import type { Step, Documento, Resultado } from "./tipos.js";
import { clonar, paiDe } from "./tipos.js";

/**
 * Nó de RAMO: a saída nomeada de um container. `transition` nos containers multi-path
 * (`workflow_split`, `find_opportunity`, `wait` com caminhos), `branch-yes`/`branch-no` no
 * `if_else`. Não é um passo do fluxo: é estrutura do container, indexada por
 * `attributes.branches` dele e pelo `sibling[]` dos irmãos.
 */
const ehRamo = (s: Step): boolean =>
  s.type === "transition" || String(s.nodeType ?? "").startsWith("branch");

/** Container: mais de uma saída. Quem o remove leva os ramos e tudo que pende deles. */
const ehContainer = (s: Step): boolean => Array.isArray(s.next) && s.next.length > 1;

/** Primeiro (e, fora de container, único) destino de `next`. */
const primeiroNext = (s: Step): string | undefined => {
  if (Array.isArray(s.next)) return s.next.find((x): x is string => typeof x === "string" && !!x);
  return typeof s.next === "string" && s.next ? s.next : undefined;
};

/** Troca um destino de `next` preservando a forma: array continua array, string continua string. */
function trocarNext(s: Step, de: string, para: string | undefined): void {
  if (Array.isArray(s.next)) {
    s.next = s.next.map((x) => (x === de ? para : x)).filter((x): x is string => !!x);
  } else if (s.next === de) {
    if (para) s.next = para;
    else delete s.next;
  }
}

/**
 * Pai novo do step. `parentKey` é o que o servidor grava; `parent` só é reescrito onde já
 * existia — ressuscitar o campo legado em step que não o tem seria inventar dado.
 */
function reparentar(s: Step, novoPai: string | undefined): void {
  if (novoPai === undefined) {
    delete s.parentKey;
    delete s.parent;
    return;
  }
  s.parentKey = novoPai;
  if ("parent" in s) s.parent = novoPai;
}

/**
 * Descendentes por `parentKey`, não por `next`: `next` de um ramo entra no corpo dele e o
 * `goto` arrastaria o workflow inteiro. A árvore de verdade é a de pais.
 */
function descendentes(steps: Step[], id: string): Set<string> {
  const filhos = new Map<string, string[]>();
  for (const s of steps) {
    const p = paiDe(s);
    if (!p || !s.id) continue;
    filhos.set(p, [...(filhos.get(p) ?? []), s.id]);
  }
  const out = new Set<string>();
  const fila = [...(filhos.get(id) ?? [])];
  while (fila.length) {
    const atual = fila.shift()!;
    if (out.has(atual)) continue;
    out.add(atual);
    fila.push(...(filhos.get(atual) ?? []));
  }
  return out;
}

/** Âncora válida para inserção: qualquer step que não seja container de N saídas. */
function acharAncora(steps: Step[], depoisDe: string): Step {
  const ancora = steps.find((s) => s.id === depoisDe);
  if (!ancora) throw new Error(`--depois-de ${depoisDe}: não existe step com esse id neste workflow`);
  if (ehContainer(ancora)) {
    throw new Error(
      `--depois-de ${depoisDe} é um container de ${(ancora.next as string[]).length} saídas: inserir logo ` +
      "abaixo dele é ambíguo, porque o fluxo continua dentro de cada ramo. Ancore no nó de ramo " +
      `(${(ancora.next as string[]).join(", ")}) em que a ação deve entrar.`,
    );
  }
  return ancora;
}

/** Onde o step entra: o pai que passa a apontar para ele, e a cauda que ele herda. */
interface Ponto { pai?: Step; cauda?: string }

/**
 * Sem `depoisDe` o step entra no INÍCIO do fluxo: vira a entrada do workflow e a entrada
 * antiga passa a pendurar nele. Workflow sem step nenhum cai aqui também — é o único jeito
 * de pôr o primeiro step, já que não existe âncora para ancorar.
 */
function pontoDeInsercao(steps: Step[], depoisDe?: string): Ponto {
  if (depoisDe) {
    const pai = acharAncora(steps, depoisDe);
    return { pai, cauda: primeiroNext(pai) };
  }
  const raizes = steps.filter((s) => s.id && !paiDe(s));
  if (raizes.length > 1) {
    throw new Error(
      `sem --depois-de o step entra no início do fluxo, mas este workflow tem ${raizes.length} entradas ` +
      `(${raizes.map((r) => r.id).join(", ")}): diga em qual ancorar com --depois-de.`,
    );
  }
  return { cauda: raizes[0]?.id };
}

/** Costura `no` no ponto, com `recebeCauda` herdando o que vinha depois (o ramo, num container). */
function costurar(steps: Step[], no: Step, ponto: Ponto, recebeCauda: Step): void {
  reparentar(no, ponto.pai?.id);
  if (ponto.cauda) {
    recebeCauda.next = ponto.cauda;
    const f = steps.find((s) => s.id === ponto.cauda);
    if (f) reparentar(f, recebeCauda.id);
  } else {
    delete recebeCauda.next;
  }
  if (ponto.pai) ponto.pai.next = Array.isArray(ponto.pai.next) ? [no.id] : no.id;
}

/** Um ramo pedido na linha de comando: o rótulo humano, a condição, e quem é o "else". */
export interface Ramo {
  name?: string;
  /** Conteúdo da entrada em `attributes.branches` do `if_else` (segments, operator…). */
  branch?: Record<string, unknown>;
  /** O ramo "None" do `if_else`: nasce `branch-no` e não entra em `attributes.branches`. */
  else?: boolean;
}

/**
 * Transforma `no` num container de N saídas e devolve os nós de ramo.
 *
 * Duas famílias, medidas nos 4.017 steps da subconta de teste: o `if_else` tem nós de ramo que são
 * eles mesmos `if_else` (`branch-yes`/`branch-no`), com `sibling[]` cruzado, e cujos ids são
 * exatamente os `attributes.branches[].id` do container; os outros containers (`workflow_split`,
 * `find_opportunity`, `wait` e `whatsapp_v2` multi-path) usam `transition`.
 */
function montarRamos(no: Step, ramos: Ramo[], ordemBase: number): Step[] {
  if (ramos.length < 2) {
    throw new Error("--ramos precisa de pelo menos 2 ramos: container de uma saída só é um step comum");
  }
  const elses = ramos.filter((r) => r.else).length;
  if (elses > 1) throw new Error("--ramos: só um ramo pode ser o `else` (o \"None\" do if_else)");
  const ehIf = no.type === "if_else";
  if (!ehIf && elses) {
    throw new Error(`--ramos: \`else\` só existe em if_else; num container ${no.type} todo ramo é uma saída nomeada`);
  }
  const nos: Step[] = ramos.map((r, i) => {
    const base = {
      id: randomUUID(),
      name: r.name ?? (r.else ? "None" : `Ramo ${i + 1}`),
      order: ordemBase + i + 1,
      parentKey: no.id,
    };
    return ehIf
      ? {
          ...base, type: "if_else", cat: "conditions",
          nodeType: r.else ? "branch-no" : "branch-yes",
          attributes: r.else ? { else: true } : { if: false, conditionName: "Condition", operator: "and", branches: [] },
        }
      : { ...base, type: "transition", cat: "transition", attributes: {} };
  });
  no.next = nos.map((n) => n.id);
  if (ehIf) {
    for (const n of nos) n.sibling = nos.filter((o) => o.id !== n.id).map((o) => o.id);
    no.nodeType = "condition-node";
    no.cat = "conditions";
    no.attributes = {
      // O app rotula a caixa do `if_else` por `attributes.conditionName`, NÃO pelo `name`
      // do step (prova ao vivo, parte B): sem isto a condição sai como "Condition" no
      // canvas mesmo com nome escolhido. `conditionName` explícito no corpo vence.
      conditionName: (no.attributes?.conditionName as string | undefined) ?? no.name ?? "Condition",
      ...(no.attributes ?? {}),
      branches: ramos.flatMap((r, i) =>
        r.else ? [] : [{ ...(r.branch ?? {}), id: nos[i].id, name: nos[i].name }]),
    };
  } else {
    // O servidor recusa o save se cada nó `transition` não tiver entrada com o mesmo id em
    // `attributes.transitions` do container ("Multi-path node is missing transitions").
    for (const n of nos) n.parent = no.id;
    no.attributes = {
      ...(no.attributes ?? {}),
      transitions: nos.map((n) => ({ id: n.id, name: n.name, fields: [], meta: {}, conditionType: "default" })),
    };
  }
  return nos;
}

/**
 * Insere um step novo entre `depoisDe` e o que ele apontava. Sem `depoisDe`, no início do
 * fluxo — é assim que nasce o primeiro step de um workflow criado do zero.
 *
 * O corpo vem em JSON CRU: os `attributes` dos 41 tipos de step não são modelados aqui, e
 * inventar schema por tipo produziria step que o editor do app não abre — o caminho seguro é
 * copiar um step existente do mesmo tipo como molde. O que esta função decide é só o
 * encadeamento: `id`, `parentKey`/`parent`, `next` e `order`.
 *
 * Com `ramos`, o step nasce container de N saídas, com os nós de ramo já costurados. A cauda
 * da âncora vai para o PRIMEIRO ramo: um container não tem "depois" próprio, o fluxo continua
 * dentro de cada ramo, e mandar a cauda para o primeiro é a única escolha determinística.
 */
export function criarStep(
  doc: Documento, corpo: Record<string, unknown>, depoisDe?: string, ramos?: Ramo[],
): Resultado {
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) {
    throw new Error("--corpo precisa ser um objeto JSON com o step (pelo menos `type`)");
  }
  if (typeof corpo.type !== "string" || !corpo.type) {
    throw new Error("--corpo precisa trazer `type` (o tipo do step, como no documento do workflow)");
  }
  const out = clonar(doc);
  out.workflowData ??= { templates: [] };
  out.workflowData.templates ??= [];
  const steps = out.workflowData.templates;
  const ponto = pontoDeInsercao(steps, depoisDe);

  const avisos: string[] = [];
  const ignorados = ["id", "parentKey", "parent", "next"].filter((k) => k in corpo);
  if (ignorados.length) {
    avisos.push(
      `--corpo: ${ignorados.join(", ")} foi ignorado — quem decide o encadeamento é --depois-de`,
    );
  }
  const { id: _i, parentKey: _p, parent: _q, next: _n, ...resto } = corpo as Record<string, any>;
  // `order` existe em todos os 4.017 steps medidos, mas não é sequencial em 42 dos 71
  // workflows da subconta de teste (num deles todo step tem 0): é campo a preencher, não endereço.
  const ordem = Math.max(-1, ...steps.map((s) => (typeof s.order === "number" ? s.order : -1))) + 1;
  const novo: Step = {
    name: "Novo passo",
    attributes: {},
    ...resto,
    id: randomUUID(),
    order: ordem,
  } as Step;

  const filhos = ramos?.length ? montarRamos(novo, ramos, ordem) : [];
  costurar(steps, novo, ponto, filhos[0] ?? novo);
  steps.push(novo, ...filhos);

  const onde = depoisDe ? `depois de ${depoisDe}` : "no início do fluxo";
  const mudancas = [
    filhos.length
      ? `container ${novo.id} (${novo.type}) com ${filhos.length} ramos inserido ${onde}`
      : `step ${novo.id} (${novo.type}) inserido ${onde}`,
    ...filhos.map((f) => `ramo ${f.id} (${f.name})`),
  ];
  if (filhos.length && ponto.cauda) {
    avisos.push(
      `o que vinha depois (${ponto.cauda}) foi para o primeiro ramo (${filhos[0].name}): um container ` +
      "não tem cauda própria, o fluxo segue dentro de cada ramo",
    );
  }
  return { doc: out, mudancas, avisos: avisos.length ? avisos : undefined };
}

/**
 * Remove um step e recostura quem apontava para ele.
 *
 * Nó de ramo nunca sai sozinho: é estrutura do container, e tirá-lo deixaria
 * `attributes.branches` e o `sibling[]` dos irmãos apontando para um id que não existe mais.
 * Container só sai com `comSubarvore`, levando os ramos e tudo que pende deles — sem isso, "o
 * que emenda onde" não tem resposta única, porque a cauda pende dos ramos, não do container.
 *
 * Step alcançado por um `goto` não precisa de guarda aqui: `checarPublicavel` recusa a edição
 * antes de gravar.
 */
export function removerStep(doc: Documento, stepId: string, comSubarvore = false): Resultado {
  const out = clonar(doc);
  const steps = out.workflowData?.templates ?? [];
  const alvo = steps.find((s) => s.id === stepId);
  if (!alvo) throw new Error(`--step ${stepId}: não existe step com esse id neste workflow`);
  if (ehRamo(alvo)) {
    throw new Error(
      `o step ${stepId} é um ramo (${alvo.nodeType ?? alvo.type}) de um container, não um passo do fluxo: ` +
      "removê-lo deixaria o container apontando para um id que não existe. Para tirar um ramo, remova o " +
      `container (${paiDe(alvo) ?? "o pai dele"}) com --com-subarvore.`,
    );
  }
  const pai = steps.find((s) => s.id === paiDe(alvo));

  if (ehContainer(alvo)) {
    const fora = descendentes(steps, stepId);
    if (!comSubarvore) {
      throw new Error(
        `o step ${stepId} é um container de ${(alvo.next as string[]).length} saídas: removê-lo tira também ` +
        `os ${fora.size} steps que pendem dele, e o fluxo termina onde ele estava. Repita com --com-subarvore.`,
      );
    }
    fora.add(stepId);
    if (pai) trocarNext(pai, stepId, undefined);
    out.workflowData.templates = steps.filter((s) => !fora.has(s.id));
    return { doc: out, mudancas: [...fora] };
  }

  const filho = primeiroNext(alvo);
  if (pai) trocarNext(pai, stepId, filho);
  if (filho) {
    const f = steps.find((s) => s.id === filho);
    if (f) reparentar(f, pai?.id);
  }
  out.workflowData.templates = steps.filter((s) => s.id !== stepId);
  return { doc: out, mudancas: [stepId] };
}

/**
 * Tira o step de onde está e o costura depois de `depoisDe`, preservando o id e o corpo.
 * Só step simples: mover container exigiria decidir o que fica com a cauda de cada ramo.
 */
export function moverStep(doc: Documento, stepId: string, depoisDe: string): Resultado {
  if (stepId === depoisDe) throw new Error("--step e --depois-de são o mesmo step: não há para onde mover");
  const steps = doc.workflowData?.templates ?? [];
  const alvo = steps.find((s) => s.id === stepId);
  if (!alvo) throw new Error(`--step ${stepId}: não existe step com esse id neste workflow`);
  if (ehRamo(alvo) || ehContainer(alvo)) {
    throw new Error(
      `o step ${stepId} é ${ehRamo(alvo) ? "um ramo de container" : "um container de N saídas"}, e mover isso ` +
      "exigiria decidir o que acontece com a cauda de cada ramo. Mova os steps de dentro, um a um.",
    );
  }
  // Não há guarda de ciclo: um step simples não leva descendentes quando sai — a cauda dele
  // é reparentada no pai antigo por `removerStep`. Mover `b` para depois de `c` numa linha
  // a→b→c é troca de ordem, não ciclo, e uma guarda por descendência a recusaria.
  acharAncora(steps, depoisDe);

  const { doc: out } = removerStep(doc, stepId);
  const restantes = out.workflowData.templates;
  const movido = clonar(alvo);
  const ancora = acharAncora(restantes, depoisDe);
  costurar(restantes, movido, { pai: ancora, cauda: primeiroNext(ancora) }, movido);
  restantes.push(movido);
  return { doc: out, mudancas: [`step ${stepId} movido para depois de ${depoisDe}`] };
}
