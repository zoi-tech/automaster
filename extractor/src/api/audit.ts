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

/** IDs das oportunidades associadas a um contato (associations API). */
export async function fetchContactOpportunityIds(
  client: GhlClient,
  locationId: string,
  contactId: string,
): Promise<string[]> {
  const ids: string[] = [];
  for (let skip = 0; ; skip += 10) {
    const url =
      "https://services.leadconnectorhq.com/associations/relations/record/" +
      `${encodeURIComponent(contactId)}?locationId=${encodeURIComponent(locationId)}` +
      `&associationIds=OPPORTUNITIES_CONTACTS_ASSOCIATION&skip=${skip}&limit=10`;
    const res = await client.getJson<{ relations?: { recordId?: string }[] }>(url);
    const batch = res.relations ?? [];
    ids.push(...batch.map((r) => r.recordId).filter((x): x is string => !!x));
    if (batch.length < 10 || ids.length >= 100) break;
  }
  return ids;
}

/** Agendamentos do contato (calendars/events). Lança em endpoint indisponível —
 * o chamador decide degradar com aviso. */
export async function fetchContactAppointments(
  client: GhlClient,
  locationId: string,
  contactId: string,
  days: number,
): Promise<Record<string, unknown>[]> {
  const end = Date.now() + 90 * 86_400_000; // inclui agendamentos futuros
  const start = Date.now() - days * 86_400_000;
  const url =
    "https://services.leadconnectorhq.com/calendars/events" +
    `?locationId=${encodeURIComponent(locationId)}&contactId=${encodeURIComponent(contactId)}` +
    `&startTime=${start}&endTime=${end}`;
  const res = await client.getJson<{ events?: Record<string, unknown>[] }>(url);
  return res.events ?? [];
}

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
