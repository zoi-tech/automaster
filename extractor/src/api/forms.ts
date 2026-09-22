import type { GhlClient } from "./client.js";

/**
 * Formulários e surveys da subconta. Host `services.leadconnectorhq.com`,
 * dois tokens da sessão — as mesmas rotas existem na API pública v3, mas
 * devolvendo só id e nome.
 * Rotas em docs/endpoints.md, seção `## Formulários e surveys`.
 */
const BASE = "https://services.leadconnectorhq.com";

/** O servidor recusa mais que isto por página (422). */
const PAGINA = 50;

export interface SubFiltro {
  formId?: string;
  surveyId?: string;
  q?: string;        // contactId, nome, e-mail ou telefone
  startAt?: string;  // YYYY-MM-DD
  endAt?: string;    // YYYY-MM-DD
  limit?: number;    // até 100
  page?: number;     // a partir de 1
}

/** Varre todas as páginas de uma lista (`forms` ou `surveys`). */
async function listarTudo(
  client: GhlClient, rota: "forms" | "surveys", locationId: string,
): Promise<{ itens: unknown[]; total: number }> {
  const itens: unknown[] = [];
  let total = 0; // eslint-disable-line no-useless-assignment -- o TS exige inicialização; o loop só sai pelo break
  for (let skip = 0; ; skip += PAGINA) {
    const url = `${BASE}/${rota}/?locationId=${locationId}&limit=${PAGINA}&skip=${skip}`;
    const resp = await client.getJson<Record<string, unknown>>(url);
    const pagina = (resp[rota] as unknown[]) ?? [];
    total = Number(resp.total ?? 0);
    itens.push(...pagina);
    if (pagina.length < PAGINA || itens.length >= total) break;
  }
  return { itens, total };
}

/** Todos os formulários da subconta, já paginados. Pasta não entra na lista. */
export async function listForms(client: GhlClient, locationId: string): Promise<unknown> {
  const { itens, total } = await listarTudo(client, "forms", locationId);
  return { forms: itens, total };
}

/** Todos os surveys da subconta, já paginados. */
export async function listSurveys(client: GhlClient, locationId: string): Promise<unknown> {
  const { itens, total } = await listarTudo(client, "surveys", locationId);
  return { surveys: itens, total };
}

/** Um formulário, com os campos em `form.formData`. */
export function getForm(client: GhlClient, id: string): Promise<unknown> {
  return client.getJson(`${BASE}/forms/${encodeURIComponent(id)}`);
}

/** Um survey. Aqui o locationId é obrigatório; no formulário, não. */
export function getSurvey(client: GhlClient, locationId: string, id: string): Promise<unknown> {
  return client.getJson(`${BASE}/surveys/${encodeURIComponent(id)}?locationId=${locationId}`);
}

function querySub(locationId: string, f: SubFiltro): string {
  const p = new URLSearchParams({ locationId });
  for (const [k, v] of Object.entries(f)) {
    if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  }
  return p.toString();
}

/** Submissões de formulário. Filtro vazio = a subconta inteira, mês corrente. */
export function listFormSubmissions(
  client: GhlClient, locationId: string, f: SubFiltro = {},
): Promise<unknown> {
  return client.getJson(`${BASE}/forms/submissions?${querySub(locationId, f)}`);
}

/** Submissões de survey. */
export function listSurveySubmissions(
  client: GhlClient, locationId: string, f: SubFiltro = {},
): Promise<unknown> {
  return client.getJson(`${BASE}/surveys/submissions?${querySub(locationId, f)}`);
}
