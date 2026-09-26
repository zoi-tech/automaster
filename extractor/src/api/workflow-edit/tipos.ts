/** Os tipos do documento de workflow e os utilitários que todo o resto usa. */
/** Um step do workflow. Encadeia por ponteiro: `next` é id, lista de ids, ou nada. */
export interface Step {
  id: string;
  type?: string;
  name?: string;
  /**
   * Pai no encadeamento. O servidor grava `parentKey`; `parent` é o campo legado, que
   * ainda aparece em parte dos steps (3.788 dos 4.017 da subconta de teste) e às vezes é o
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

export const clonar = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

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

/** Pai do step: `parentKey` do servidor, com o `parent` legado como reserva. */
export const paiDe = (s: Step): string | undefined => s.parentKey || s.parent;

export const porId = (steps: Step[]): Map<string, Step> =>
  new Map(steps.filter((s) => s?.id).map((s) => [s.id, s]));

export const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
