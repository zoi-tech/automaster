import type { GhlClient } from "./client.js";

/**
 * Rotas de ESCRITA de workflow, mapeadas do bundle do editor
 * (client-app-automation-workflows.leadconnectorhq.com). Prefixo SINGULAR.
 * Transporte puro: nenhuma decisão mora aqui.
 */
export const WF_WRITE = "https://backend.leadconnectorhq.com/workflow";

/** URL do editor no app. `workflow` no SINGULAR: com o plural (rota da lista) o app dá 404. */
export function urlEditor(loc: string, wid: string): string {
  return `https://app.gohighlevel.com/v2/location/${loc}/automation/workflow/${wid}`;
}

/**
 * Pastas da raiz, pela mesma rota que a interface usa. A lista do app mostra PASTA na raiz,
 * não workflow: workflow fora de pasta não aparece para ninguém.
 */
export async function listarPastas(client: GhlClient, loc: string): Promise<{ id: string; name: string }[]> {
  const r = await client.getJson<{ rows?: any[] }>(
    `${WF_WRITE}/${loc}/list?parentId=root&limit=100&offset=0&sortBy=name&sortOrder=asc`,
  );
  return (r?.rows ?? []).filter((x) => x?.type === "directory").map((x) => ({ id: x.id, name: x.name }));
}

/**
 * Cria o trigger. A chave é `workflowId` em CAMELCASE: com `workflow_id` (que é como a
 * leitura devolve o campo) o servidor responde 200 com id e o trigger nasce órfão, invisível
 * para sempre. Medido ao vivo em 2026-09-21.
 */
export function criarTrigger(
  client: GhlClient, loc: string, wid: string, corpo: Record<string, unknown>,
): Promise<{ id?: string }> {
  const { id: _i, _id: _u, workflow_id: _w, workflowId: _c, location_id: _l, ...resto } = corpo as any;
  return client.postJson(`${WF_WRITE}/${loc}/trigger`, {
    ...resto,
    workflowId: wid,
    location_id: loc,
    actions: (corpo.actions as unknown[] | undefined)?.length
      ? (corpo.actions as any[]).map((a) => ({ ...a, workflow_id: wid }))
      : [{ workflow_id: wid, type: "add_to_workflow" }],
  });
}

/**
 * Workflow recém-criado nasce SEM `status` e, sem pasta, com `parentId` vazio: a API o lista
 * normalmente e a interface não o mostra, com o editor em branco. Move para a pasta e grava
 * `status: "draft"`. Idempotente: não faz nada no que já está inteiro.
 */
export async function nascerVisivel(
  client: GhlClient, loc: string, wid: string, pasta: string, usuarioId: string,
): Promise<{ parentId?: string; status?: string }> {
  const doc = await client.getJson<any>(`${WF_WRITE}/${loc}/${wid}`);
  if (doc?.parentId !== pasta) await moverWorkflow(client, loc, wid, pasta);
  if (!doc?.status) {
    const atual = await client.getJson<any>(`${WF_WRITE}/${loc}/${wid}`);
    await salvarWorkflow(client, loc, wid, {
      ...atual, status: "draft", createdSteps: [], modifiedSteps: [], deletedSteps: [], updatedBy: usuarioId,
    });
  }
  const fim = await client.getJson<any>(`${WF_WRITE}/${loc}/${wid}`);
  return { parentId: fim?.parentId, status: fim?.status };
}

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
