import { randomUUID } from "node:crypto";
/** Um step do workflow. Encadeia por ponteiro: `next` é id, lista de ids, ou nada. */
export interface Step {
  id: string;
  type?: string;
  name?: string;
  /**
   * Pai no encadeamento. O servidor grava `parentKey`; `parent` é o campo legado, que
   * ainda aparece em parte dos steps (3.788 dos 4.017 da Instaltech) e às vezes é o
   * único presente. Leia os dois por `paiDe`, como o auditor faz em `flow.parent_of`.
   */
  parentKey?: string;
  parent?: string;
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
 * Ids do GHL são opacos: uuid, ObjectId (24 hex) ou base62 de 20+ caracteres. Texto
 * com espaço, acento ou curto não é id. É a única defesa de `trocarReferencia`, que
 * faz substring replace em TODA string do documento — `--de "Olá"` reescreveria o
 * corpo de SMS, e-mail e WhatsApp que o cliente manda para a base dele, e nenhuma das
 * 18 regras acha isso estranho.
 */
export function pareceId(v: string): boolean {
  return /^[A-Za-z0-9_-]{16,}$/.test(v.trim());
}

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

/** Pai do step: `parentKey` do servidor, com o `parent` legado como reserva. */
export const paiDe = (s: Step): string | undefined => s.parentKey || s.parent;

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
  // Array com os mesmos itens em outra ordem é o caso que mais confunde na leitura do
  // diff: aparecia como o campo inteiro alterado, sem dizer que nada entrou nem saiu.
  // Descer por índice diria menos ainda em lista grande (toda posição a partir da
  // primeira mudança conta como alterada), então o diff só marca a reordenação.
  if (Array.isArray(a) && Array.isArray(b)) {
    const ordenado = (v: unknown[]) => [...v].map((x) => JSON.stringify(x)).sort();
    if (igual(ordenado(a), ordenado(b))) return [`${prefixo || "(valor)"} (reordenado)`];
  }
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

/**
 * 200 não é prova nesta API: a rota irmã `only-triggers` responde 200, incrementa
 * `version` e não grava nada (prova ao vivo, §2.1b). Depois de gravar, o comando relê e
 * compara o que PEDIU (`editado`) com o que o servidor TEM (`depois`). Sobrou diferença,
 * a escrita é duvidosa — não sucesso.
 */
export function conferirEscrita(editado: Documento, depois: Documento): { ok: boolean; residual: DiffWorkflow } {
  const residual = diffWorkflow(editado, depois);
  return { ok: residual.vazio, residual };
}

/**
 * I1: a prévia e a gravação são DOIS processos — na tool MCP, com um Chrome subindo entre
 * elas e dezenas de segundos de janela. A guarda interna (`version` lida x meta) só enxerga
 * o que acontece dentro da segunda invocação. `--versao-esperada` carrega a `version` que a
 * prévia viu e aborta se o workflow mudou entre as duas.
 */
export function conferirVersaoEsperada(o: { versaoEsperada?: string }, versaoAgora: number | undefined): void {
  if (o.versaoEsperada === undefined) return;
  if (String(versaoAgora) !== String(o.versaoEsperada)) {
    throw new Error(
      `o workflow mudou entre a prévia e a gravação (versão esperada ${o.versaoEsperada}, agora ${versaoAgora}). ` +
      "Nada foi gravado: rode a prévia de novo para ver o estado atual.",
    );
  }
}


// ---- steps do canvas (parte B) ----

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
 * Duas famílias, medidas nos 4.017 steps da Instaltech: o `if_else` tem nós de ramo que são
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
      ...(no.attributes ?? {}),
      branches: ramos.flatMap((r, i) =>
        r.else ? [] : [{ ...(r.branch ?? {}), id: nos[i].id, name: nos[i].name }]),
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
  // workflows da Instaltech (num deles todo step tem 0): é campo a preencher, não endereço.
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
