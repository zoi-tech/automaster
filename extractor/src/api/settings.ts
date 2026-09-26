import type { GhlClient } from "./client.js";

const CONV = "https://services.leadconnectorhq.com/conversations";

// ------------------------------------------------------------------ IA

/** Configuração da IA de conversas da subconta. */
export function fetchAiSettings(client: GhlClient, locationId: string): Promise<unknown> {
  return client.getJson(`${CONV}/ai/settings/${locationId}`);
}

/** ESCREVE: muda a configuração da IA. Vale para a subconta inteira. */
export function updateAiSettings(client: GhlClient, locationId: string, body: unknown): Promise<unknown> {
  return client.putJson(`${CONV}/ai/settings/${locationId}`, body);
}

/** ESCREVE: cria a configuração quando a subconta ainda não tem. */
export function createAiSettings(client: GhlClient, body: unknown): Promise<unknown> {
  return client.postJson(`${CONV}/ai/settings`, body);
}

// ----------------------------------------------------------------- SLA

/** Regras de SLA da caixa de entrada. */
export function fetchSlaSettings(client: GhlClient, locationId: string): Promise<unknown> {
  return client.getJson(`${CONV}/sla-settings/${locationId}`);
}

/** Estado atual do SLA na caixa (o que está estourando agora). */
export function fetchSlaInboxStatus(client: GhlClient, locationId: string): Promise<unknown> {
  return client.getJson(`${CONV}/sla-settings/${locationId}/inbox-sla-status`);
}

/** Quem pode zerar SLA na mão. */
export function fetchSlaClearPermission(client: GhlClient, locationId: string): Promise<unknown> {
  return client.getJson(`${CONV}/sla-settings/${locationId}/manual-clear-permission`);
}

/** ESCREVE: muda as regras de SLA da subconta. */
export function updateSlaSettings(client: GhlClient, locationId: string, body: unknown): Promise<unknown> {
  return client.putJson(`${CONV}/sla-settings/${locationId}`, body);
}

/** ESCREVE: cria as regras quando a subconta ainda não tem. */
export function createSlaSettings(client: GhlClient, body: unknown): Promise<unknown> {
  return client.postJson(`${CONV}/sla-settings`, body);
}

/** ESCREVE: zera o SLA de uma conversa. */
export function clearSla(client: GhlClient, conversationId: string, body: unknown = {}): Promise<unknown> {
  return client.postJson(`${CONV}/sla-settings/clear-sla/${conversationId}`, body);
}
