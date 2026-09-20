import type { GhlClient } from "./client.js";

/**
 * API interna do app, achada no bundle público do editor de workflows.
 * Atenção ao prefixo: a busca de inscritos usa `/workflows` (PLURAL), as demais
 * usam `/workflow` (singular). Não é engano de digitação — são serviços diferentes.
 */
const BACKEND = "https://backend.leadconnectorhq.com";
const WF = `${BACKEND}/workflow`;
const WFS = `${BACKEND}/workflows`;

/** O servidor tem quatro status, não dois. `locked` e `paused` aparecem no app. */
export type StatusWorkflow = "published" | "draft" | "locked" | "paused";

export const STATUS_WORKFLOW: StatusWorkflow[] = ["published", "draft", "locked", "paused"];

/** Linha da lista de workflows, como o `/list` devolve. */
export interface WorkflowLinha {
  id: string;
  name?: string;
  status?: string;
  updatedAt?: string;
}

/**
 * Uma inscrição, como o servidor manda. Campos opcionais porque a rota é interna e
 * não documentada: tudo que a gente lê daqui pode sumir numa atualização do app.
 */
export interface InscricaoCrua {
  _id?: string;
  id?: string;
  contactId?: string;
  workflowId?: string;
  status?: string;
  createdAt?: string;
  currentStepName?: string;
  currentStepType?: string;
  nextExecutionOn?: string;
  meta?: { addedSource?: { source?: string; sourceName?: string } };
}

/** Cursor da paginação: os três campos que a próxima página exige. */
export interface Cursor {
  referenceId: string;
  referenceCreatedAt: string;
  referenceSid: string;
}

export interface PaginaInscritos {
  linhas: InscricaoCrua[];
  cursor?: Cursor;
  estrangulado: boolean;
}

/** Metadados de um workflow, sem baixar os steps do Firebase (que é a parte cara). */
export function getWorkflowMeta(client: GhlClient, loc: string, wid: string): Promise<unknown> {
  return client.getJson(`${WF}/${loc}/${wid}?includeScheduledPauseInfo=true`);
}

/**
 * Lista plana de workflows da subconta. Mesma rota que a extração usa, paginada por
 * offset; aqui só interessam id, nome e status correntes.
 */
export async function listarWorkflows(client: GhlClient, loc: string): Promise<WorkflowLinha[]> {
  const limit = 100;
  const todos: WorkflowLinha[] = [];
  for (let offset = 0; ; offset += limit) {
    const d = await client.getJson<{ rows?: WorkflowLinha[]; count?: number }>(
      `${WF}/${loc}/list?type=workflow&limit=${limit}&offset=${offset}&sortBy=name&sortOrder=asc`,
    );
    const rows = d.rows ?? [];
    todos.push(...rows);
    if (!rows.length || todos.length >= (d.count ?? 0)) return todos;
  }
}

/**
 * Uma página de inscritos. Sem `cursor`, traz a primeira; com `cursor`, a seguinte.
 * `isLocationRateLimited` é uma bandeira do próprio servidor dizendo que estrangulou a
 * subconta — resposta curta com ela ligada é resposta cortada, não lista curta.
 */
export async function paginaDeInscritos(
  client: GhlClient, loc: string, wid: string, limite: number, cursor?: Cursor,
): Promise<PaginaInscritos> {
  const p = new URLSearchParams({
    workflowId: wid,
    locationId: loc,
    limit: String(limite),
    action: cursor ? "next" : "first",
  });
  if (cursor) {
    p.set("referenceId", cursor.referenceId);
    p.set("referenceCreatedAt", cursor.referenceCreatedAt);
    p.set("referenceSid", cursor.referenceSid);
  }
  const d = await client.getJson<{ statuses?: InscricaoCrua[]; isLocationRateLimited?: boolean }>(
    `${WFS}/status/search/workflow-with-filter?${p.toString()}`,
  );
  const linhas = d.statuses ?? [];
  const ultima = linhas.at(-1);
  return {
    linhas,
    cursor: ultima
      ? {
          referenceId: String(ultima._id ?? ultima.id ?? ""),
          referenceCreatedAt: String(ultima.createdAt ?? ""),
          referenceSid: String(ultima.contactId ?? ""),
        }
      : undefined,
    estrangulado: d.isLocationRateLimited === true,
  };
}

/** Quantos passaram pelo workflow e quantos já terminaram. Uma chamada, resposta curta. */
export function contarInscritos(
  client: GhlClient, loc: string, wid: string,
): Promise<{ total?: number; finished?: number }> {
  return client.getJson(`${WFS}/status/enroll-stats?workflowId=${wid}&locationId=${loc}`);
}

/** O lado inverso: em que workflows este contato está agora. */
export function inscricoesDoContato(
  client: GhlClient, loc: string, cid: string,
): Promise<{ count?: number; workflowStatuses?: InscricaoCrua[] }> {
  return client.getJson(`${WF}/${loc}/contact/${cid}/statuses_v2`);
}
