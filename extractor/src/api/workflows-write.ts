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

// `PUT /<loc>/<wid>/recover` aparece no bundle do editor e está no mapa da spec, mas NUNCA
// foi exercitado: não se sabe o corpo, nem se restaura workflow apagado ou versão do
// histórico. Enquanto não houver prova ao vivo, `apagar` é irreversível — é por isso que ele
// guarda cópia do documento no registro antes do DELETE. A função morta saiu daqui para
// ninguém a reencontrar e acreditar que existe desfazer.

/** Salva o workflow inteiro. O corpo é o documento lido, com o alvo trocado. */
export function salvarWorkflow(client: GhlClient, loc: string, wid: string, corpo: Record<string, unknown>): Promise<unknown> {
  return client.putJson(`${WF_WRITE}/${loc}/${wid}`, corpo);
}

/**
 * Lista AUTORITATIVA de triggers. É a mesma rota da leitura: o documento do
 * workflow não traz os triggers, só `triggersFilePath`.
 */
export function listarTriggers(client: GhlClient, loc: string, wid: string): Promise<any[]> {
  return client.getJson<any[]>(`${WF_WRITE}/${loc}/trigger?workflowId=${encodeURIComponent(wid)}`);
}

/**
 * Única rota de ESCRITA de trigger provada ao vivo: apaga um trigger. Responde `{}`.
 * Criar e trocar trigger não têm rota conhecida — `only-triggers` responde 200,
 * incrementa `version` e NÃO cria nada (prova ao vivo, Task 8).
 */
export function apagarTrigger(client: GhlClient, loc: string, wid: string, triggerId: string): Promise<unknown> {
  return client.deleteJson(`${WF_WRITE}/${loc}/trigger/${triggerId}?workflowId=${encodeURIComponent(wid)}`);
}

export function historicoVersoes(client: GhlClient, loc: string, wid: string): Promise<unknown> {
  return client.getJson(`${WF_WRITE}/${loc}/${wid}/history`);
}

export function versaoPorNumero(client: GhlClient, loc: string, wid: string, n: number): Promise<unknown> {
  return client.getJson(`${WF_WRITE}/${loc}/${wid}/history-by-number/${n}`);
}
