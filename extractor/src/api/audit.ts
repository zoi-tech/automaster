import type { GhlClient } from "./client.js";

/** Evento do audit log (shape observado em audit/search/v2 — passthrough). */
export interface AuditLog {
  documentType?: string;
  id?: string;
  type?: string;
  after?: Record<string, unknown>;
  before?: Record<string, unknown>;
  source?: string;
  sourceName?: string;
  sourceId?: string;
  channel?: string;
  documentName?: string;
  changedFields?: string[];
  createdAt?: string;
  [k: string]: unknown;
}

const PAGE_SIZE = 100;

/**
 * Busca sob demanda os audit logs de UM registro (contato/oportunidade) por id.
 * Pagina até esgotar. Nada é gravado em disco — uso efêmero.
 */
export async function fetchAuditLogs(
  client: GhlClient,
  locationId: string,
  id: string,
  days: number,
): Promise<AuditLog[]> {
  const endAt = new Date();
  const startAt = new Date(endAt.getTime() - days * 86_400_000);
  const logs: AuditLog[] = [];
  for (let page = 1; ; page++) {
    const url =
      "https://services.leadconnectorhq.com/audit/search/v2" +
      `?page=${page}&pageSize=${PAGE_SIZE}` +
      `&startAt=${encodeURIComponent(startAt.toISOString())}` +
      `&endAt=${encodeURIComponent(endAt.toISOString())}` +
      `&id=${encodeURIComponent(id)}&locationId=${encodeURIComponent(locationId)}`;
    const res = await client.getJson<{ logs?: AuditLog[] }>(url);
    const batch = res.logs ?? [];
    logs.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return logs;
}
