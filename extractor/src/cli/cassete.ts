import type { GhlClient } from "../api/client.js";

/**
 * Cassete do smoke: a FORMA das respostas da API interna, gravada uma vez ao vivo e
 * reproduzida no CI.
 *
 * O smoke ao vivo é o que avisa que a API do GHL mudou, mas não roda em CI (abre Chrome
 * com login manual). Sem ele, nada defende o parsing de `src/api/*` de uma regressão nossa.
 * O cassete fecha essa metade: as mesmas checagens rodam contra respostas gravadas.
 *
 * Só a forma é gravada, porque o cassete é commitado e a resposta de uma subconta real traz
 * dado de cliente: toda string vira "x", todo número 0, e um array guarda no máximo o
 * primeiro item. As exceções estão em VOCABULARIO: um punhado de chaves cujo valor é
 * palavra do protocolo do GHL, não dado de ninguém (`type: "workflow"` é o que separa
 * workflow de pasta na mesma lista). Sem elas o replay não exercita o parsing que ramifica
 * por esses valores — era o caso de 4 das 23 checagens.
 */

/** Chaves cujo valor de string é vocabulário da API, nunca dado de cliente. */
export const VOCABULARIO = new Set([
  "type", "status", "dataType", "model", "templateType", "channel", "category",
  "eventType", "appointmentStatus", "calendarType", "widgetType", "role", "roleType",
]);
export interface Cassete {
  gravadoEm: string;
  /** Nome da checagem → respostas na ordem em que a checagem as pediu. */
  respostas: Record<string, unknown[]>;
}

export function forma(v: unknown, chave = ""): unknown {
  if (Array.isArray(v)) return v.length ? [forma(v[0], chave)] : [];
  if (v === null) return null;
  if (typeof v === "object") {
    return Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, forma(x, k)]));
  }
  // `count`/`total` ficam em 0 de propósito: o array guardou 1 item, e o número real
  // faria a paginação pedir uma página que o cassete não tem.
  if (typeof v === "string") return VOCABULARIO.has(chave) ? v : "x";
  if (typeof v === "number") return 0;
  return v;
}

/** Cliente que serve o cassete no lugar da rede. Cada checagem consome as suas, em ordem. */
export function clienteDoCassete(cassete: Cassete): { client: GhlClient; usar: (checagem: string) => void } {
  let fila: unknown[] = [];
  let atual = "";
  const proxima = (): unknown => {
    if (!fila.length) throw new Error(`cassete sem resposta gravada para "${atual}" (regrave com smoke --gravar)`);
    return fila.shift();
  };
  const responder = (): Promise<unknown> => Promise.resolve(proxima());
  const client = {
    getJson: responder, putJson: responder, postJson: responder,
    deleteJson: responder, postMultipart: responder, getJsonNoAuth: responder,
    espiar: () => {}, coletar: () => [],
  } as unknown as GhlClient;
  return {
    client,
    usar: (checagem: string) => {
      atual = checagem;
      fila = [...(cassete.respostas[checagem] ?? [])];
    },
  };
}
