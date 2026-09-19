import type { GhlClient } from "./client.js";

const BACKEND = "https://backend.leadconnectorhq.com";
const SERVICES = "https://services.leadconnectorhq.com";

// `loc` não entra em nenhuma das rotas abaixo — nenhuma leva locationId, o escopo vem dos
// tokens. Fica na assinatura por simetria com o resto da API e para o dia em que levar.

/** Contato inteiro (snapshot). GET validado ao vivo, host `services`. */
export function getContact(client: GhlClient, loc: string, id: string): Promise<unknown> {
  return client.getJson(`${SERVICES}/contacts/${id}`);
}

/** Campos do contato (nunca tags — ver endpoints granulares abaixo). Host `backend`, query fixa da rota. */
export function updateContactFields(client: GhlClient, loc: string, id: string, body: Record<string, unknown>): Promise<unknown> {
  return client.putJson(`${BACKEND}/contacts/${id}?version=14-05-22`, body);
}

/** Adiciona tags. Host `backend`. */
export function addContactTags(client: GhlClient, loc: string, id: string, tags: string[]): Promise<unknown> {
  return client.postJson(`${BACKEND}/contacts/${id}/tags`, { tags });
}

/** Remove tags. Host `backend`. */
export function removeContactTags(client: GhlClient, loc: string, id: string, tags: string[]): Promise<unknown> {
  return client.deleteJson(`${BACKEND}/contacts/${id}/tags`, { tags });
}
