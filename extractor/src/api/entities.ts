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
