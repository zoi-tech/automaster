import type { GhlClient } from "./client.js";
import { fetchCustomFields, fetchCustomValues, fetchPipelines, fetchTags, fetchUsers } from "./entities.js";
import { listWorkflows } from "./workflows.js";

/**
 * As listas que as regras de referência consultam, lidas AGORA. A validação de escrita
 * compara contra elas em vez do dump: entidade criada depois da extração não pode virar
 * referência quebrada (três tags da Cliente A nasceram dois minutos depois do dump).
 * Rota que falha sai em `falhas` e a validação cai no dump só para aquela lista.
 */
export async function lerEntidadesAoVivo(
  client: GhlClient, loc: string, companyId: string,
): Promise<{ entidades: Record<string, unknown>; falhas: string[] }> {
  const rotas: [string, () => Promise<unknown>][] = [
    ["tags", () => fetchTags(client, loc)],
    ["users", () => fetchUsers(client, loc, companyId)],
    ["pipelines", () => fetchPipelines(client, loc)],
    ["custom_fields", () => fetchCustomFields(client, loc)],
    ["custom_values", () => fetchCustomValues(client, loc)],
    ["workflows", () => listWorkflows(client, loc)],
  ];
  const entidades: Record<string, unknown> = {};
  const falhas: string[] = [];
  for (const [nome, ler] of rotas) {
    try { entidades[nome] = await ler(); } catch { falhas.push(nome); }
  }
  return { entidades, falhas };
}
