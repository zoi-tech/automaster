import type { GhlClient } from "./client.js";
import { fetchPipelines } from "./entities.js";

/**
 * Oportunidades ficam no mesmo host da API pública v3, mas a chamada aqui vai pela
 * sessão do app: os dois tokens, como todo `opportunities/*`.
 */
const OPP = "https://services.leadconnectorhq.com/opportunities";
const PIPE = `${OPP}/pipelines`;

/** A busca usa snake_case — o 422 do servidor rejeita os nomes camelCase do corpo. */
export interface OppFiltro {
  pipeline_id?: string;
  pipeline_stage_id?: string;
  status?: string;       // open | won | lost | abandoned | all
  contact_id?: string;
  assigned_to?: string;
  q?: string;            // termo livre
  limit?: number;
  page?: number;
}

export interface OppCorpo {
  name?: string;
  status?: string;
  pipelineId?: string;
  pipelineStageId?: string;
  contactId?: string;
  monetaryValue?: number;
  assignedTo?: string;
  forecastExpectedCloseDate?: string;
  forecastProbability?: number;
  customFields?: { id: string; fieldValue: unknown }[];
}

export interface PipeEstagio {
  id?: string;          // sem id = estágio novo
  name: string;
  position?: number;
}

export interface PipelinesResp {
  pipelines?: { id: string; name?: string; stages?: { id: string; name: string }[] }[];
}

/** Pipelines e seus estágios. Reusa o que o extractor já faz. */
export function listPipelines(client: GhlClient, locationId: string): Promise<PipelinesResp> {
  return fetchPipelines(client, locationId) as Promise<PipelinesResp>;
}

/** Query string de um filtro, sem os campos vazios. */
function query(locationId: string, f: OppFiltro): string {
  const p = new URLSearchParams({ location_id: locationId });
  for (const [k, v] of Object.entries(f)) {
    if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  }
  return p.toString();
}

/** Cards, com filtro opcional de pipeline, estágio, status e dono. */
export function listOpportunities(
  client: GhlClient, locationId: string, f: OppFiltro = {},
): Promise<unknown> {
  return client.getJson(`${OPP}/search?${query(locationId, f)}`);
}

/** Busca por termo livre na subconta inteira. */
export function searchOpportunities(
  client: GhlClient, locationId: string, termo: string, f: OppFiltro = {},
): Promise<unknown> {
  return client.getJson(`${OPP}/search?${query(locationId, { ...f, q: termo })}`);
}

/** Um card pelo id. */
export function getOpportunity(client: GhlClient, id: string): Promise<unknown> {
  return client.getJson(`${OPP}/${id}`);
}

/** ESCREVE: cria um card. `contactId` só se define aqui — não dá para trocar depois. */
export function createOpportunity(
  client: GhlClient, locationId: string, corpo: OppCorpo,
): Promise<unknown> {
  return client.postJson(`${OPP}/`, { locationId, ...corpo });
}

/** ESCREVE: edita um card. Mover de estágio é isto com `pipelineStageId` trocado. */
export function updateOpportunity(
  client: GhlClient, id: string, corpo: OppCorpo,
): Promise<unknown> {
  return client.putJson(`${OPP}/${id}`, corpo);
}

/** ESCREVE: apaga um card. Reversível por `restoreOpportunity`. */
export function deleteOpportunity(client: GhlClient, id: string): Promise<unknown> {
  return client.deleteJson(`${OPP}/${id}`);
}

/** ESCREVE: devolve à vida um card apagado. */
export function restoreOpportunity(client: GhlClient, id: string): Promise<unknown> {
  return client.putJson(`${OPP}/${id}/restore`, {});
}

/** `position` é obrigatório no servidor: sem ele o POST/PUT devolve 422. */
function posicionar(stages: PipeEstagio[]): PipeEstagio[] {
  return stages.map((s, i) => ({ ...s, position: s.position ?? i }));
}

/** ESCREVE: cria um pipeline com seus estágios. */
export function createPipeline(
  client: GhlClient, locationId: string, name: string, stages: PipeEstagio[],
): Promise<unknown> {
  return client.postJson(PIPE, { locationId, name, stages: posicionar(stages) });
}

/**
 * ESCREVE: renomeia o pipeline e redefine seus estágios.
 * A lista de estágios é substitutiva: estágio ausente dela é removido.
 * O `locationId` vai na query, não no corpo — o corpo o rejeita com 422.
 */
export function updatePipeline(
  client: GhlClient, locationId: string, id: string, name: string, stages: PipeEstagio[],
): Promise<unknown> {
  return client.putJson(`${PIPE}/${id}?locationId=${locationId}`, { name, stages: posicionar(stages) });
}

/** ESCREVE: apaga um pipeline. NÃO tem restore. */
export function deletePipeline(
  client: GhlClient, locationId: string, id: string,
): Promise<unknown> {
  return client.deleteJson(`${PIPE}/${id}?locationId=${locationId}`);
}
