import type { GhlClient } from "./client.js";

const BACKEND = "https://backend.leadconnectorhq.com";
const SERVICES = "https://services.leadconnectorhq.com";

/** Pipelines + stages. */
export function fetchPipelines(client: GhlClient, locationId: string): Promise<unknown> {
  return client.getJson(`${BACKEND}/opportunities/pipelines?locationId=${locationId}`);
}

/** Custom fields (inclui standards). */
export function fetchCustomFields(client: GhlClient, locationId: string): Promise<unknown> {
  const qs = new URLSearchParams({
    parentId: "",
    skip: "0",
    limit: "10000",
    documentType: "field",
    model: "all",
    query: "",
    includeStandards: "true",
  });
  return client.getJson(`${BACKEND}/locations/${locationId}/customFields/search?${qs}`);
}

/** Tags (host `services`, não `backend`). */
export function fetchTags(client: GhlClient, locationId: string): Promise<unknown> {
  const qs = new URLSearchParams({ skip: "0", limit: "10000", query: "", getCount: "true" });
  return client.getJson(`${SERVICES}/locations/${locationId}/tags/search?${qs}`);
}

/** Usuários da subconta. Requer companyId (decodificado do token). */
export function fetchUsers(client: GhlClient, locationId: string, companyId: string): Promise<unknown> {
  const qs = new URLSearchParams({ companyId, locationId, limit: "500", skip: "0" });
  return client.getJson(`${BACKEND}/users/search?${qs}`);
}

/** Calendários (lista geral). */
export function fetchCalendars(client: GhlClient, locationId: string): Promise<unknown> {
  return client.getJson(`${BACKEND}/calendars/?locationId=${locationId}`);
}

/** Custom values (host `backend`: fieldKey traz o token literal `{{ custom_values.x }}`). */
export function fetchCustomValues(client: GhlClient, locationId: string): Promise<unknown> {
  return client.getJson(`${BACKEND}/locations/${locationId}/customValues/`);
}

/**
 * Templates de mensagem da subconta (SMS e os canais que compartilham a mesma
 * coleção — o template citado por um step `instagram-dm` sai aqui com
 * `type: "sms"`). Sem `type` devolve todos; `limit` default do servidor é 25 e
 * `offset` não existe (o servidor responde 422 `property offset should not exist`).
 */
export function fetchMessageTemplates(client: GhlClient, locationId: string): Promise<unknown> {
  return client.getJson(`${BACKEND}/locations/${locationId}/templates?limit=10000`);
}

// Templates do email builder vivem em `./emails.ts`: a lista precisa descer nas
// pastas por `parentId`, e o cruzamento com o step sai do `previewUrl`, não do
// `template_id`. Detalhes em docs/endpoints.md, seção `## Templates de e-mail`.
