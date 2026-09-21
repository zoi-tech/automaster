import type { GhlClient } from "./client.js";

/**
 * Rotas de ESCRITA de workflow, mapeadas do bundle do editor
 * (client-app-automation-workflows.leadconnectorhq.com). Prefixo SINGULAR.
 * Transporte puro: nenhuma decisão mora aqui.
 */
export const WF_WRITE = "https://backend.leadconnectorhq.com/workflow";

/** POST de criação. `location_id` só existe no POST — o PUT nunca o leva. */
export function criarWorkflow(client: GhlClient, loc: string, corpo: Record<string, unknown>): Promise<unknown> {
  return client.postJson(`${WF_WRITE}/${loc}`, { ...corpo, location_id: loc });
}

/** Duplicar na MESMA subconta é o POST de criação com o id do original. */
export function duplicarWorkflow(
  client: GhlClient,
  loc: string,
  a: { workflowId: string; novoNome: string; parentId?: string },
): Promise<unknown> {
  return client.postJson(`${WF_WRITE}/${loc}`, {
    new_workflow_name: a.novoNome,
    workflow_id: a.workflowId,
    parentId: a.parentId ?? null,
    location_id: loc,
  });
}

export function renomearWorkflow(client: GhlClient, loc: string, wid: string, nome: string): Promise<unknown> {
  return client.putJson(`${WF_WRITE}/${loc}/rename-workflow/${wid}`, { name: nome });
}

export function moverWorkflow(client: GhlClient, loc: string, wid: string, parentId: string | null): Promise<unknown> {
  return client.putJson(`${WF_WRITE}/${loc}/move-directory/${wid}`, { parentId });
}

export function apagarWorkflow(client: GhlClient, loc: string, wid: string, userId: string): Promise<unknown> {
  return client.deleteJson(`${WF_WRITE}/${loc}/${wid}?userId=${encodeURIComponent(userId)}`);
}

export function recuperarWorkflow(client: GhlClient, loc: string, wid: string, corpo: Record<string, unknown>): Promise<unknown> {
  return client.putJson(`${WF_WRITE}/${loc}/${wid}/recover`, corpo);
}

/** Salva o workflow inteiro. O corpo é o documento lido, com o alvo trocado. */
export function salvarWorkflow(client: GhlClient, loc: string, wid: string, corpo: Record<string, unknown>): Promise<unknown> {
  return client.putJson(`${WF_WRITE}/${loc}/${wid}`, corpo);
}

/**
 * Rota usada pelo app quando SÓ triggers mudaram. O corpo é o mesmo do save
 * inteiro — não é operação mais leve nem mais segura, só outra URL.
 */
export function salvarSomenteTriggers(client: GhlClient, loc: string, wid: string, corpo: Record<string, unknown>): Promise<unknown> {
  return client.putJson(`${WF_WRITE}/${loc}/only-triggers/${wid}`, corpo);
}

export function historicoVersoes(client: GhlClient, loc: string, wid: string): Promise<unknown> {
  return client.getJson(`${WF_WRITE}/${loc}/${wid}/history`);
}

export function versaoPorNumero(client: GhlClient, loc: string, wid: string, n: number): Promise<unknown> {
  return client.getJson(`${WF_WRITE}/${loc}/${wid}/history-by-number/${n}`);
}
