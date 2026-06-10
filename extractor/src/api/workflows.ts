import type { GhlClient } from "./client.js";

const BACKEND = "https://backend.leadconnectorhq.com";

export interface ListEntry {
  id: string;
  name: string;
  status: string;
  type?: string;
  parentId?: string | null;
  [k: string]: unknown;
}

interface ListResponse {
  rows: ListEntry[];
  count: number;
}

export interface FullWorkflow {
  list_entry: ListEntry;
  detail: Record<string, unknown>;
  steps: unknown;
  triggers: unknown;
}

/**
 * Lista plana de todos os workflows (paginado). Usa `?type=workflow` — NÃO
 * `parentId=root`, que só traz pastas.
 */
export async function listWorkflows(client: GhlClient, locationId: string): Promise<ListEntry[]> {
  const rows: ListEntry[] = [];
  const limit = 100;
  for (let offset = 0; ; offset += limit) {
    const qs = new URLSearchParams({
      type: "workflow",
      limit: String(limit),
      offset: String(offset),
      sortBy: "name",
      sortOrder: "asc",
    });
    const d = await client.getJson<ListResponse>(`${BACKEND}/workflow/${locationId}/list?${qs}`);
    rows.push(...d.rows);
    if (rows.length >= d.count || d.rows.length === 0) break;
  }
  return rows.filter((r) => r.type === "workflow");
}

/**
 * Busca o workflow completo: detalhe (metadados + fileUrl), steps (Firebase, sem
 * auth) e triggers (array separado).
 */
export async function fetchWorkflow(
  client: GhlClient,
  locationId: string,
  entry: ListEntry,
): Promise<FullWorkflow> {
  const detail = await client.getJson<Record<string, unknown>>(
    `${BACKEND}/workflow/${locationId}/${entry.id}?includeScheduledPauseInfo=true`,
  );

  let steps: unknown = null;
  const fileUrl = detail["fileUrl"];
  if (typeof fileUrl === "string" && fileUrl) {
    steps = await client.getJsonNoAuth(fileUrl);
  }

  const triggers = await client.getJson(
    `${BACKEND}/workflow/${locationId}/trigger?workflowId=${entry.id}`,
  );

  return { list_entry: entry, detail, steps, triggers };
}
