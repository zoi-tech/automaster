import type { GhlClient } from "./client.js";

/**
 * Notas e tarefas do CONTATO. Host `services.leadconnectorhq.com`, os dois tokens da sessão.
 * Rotas em docs/endpoints.md, seção `## Notas, tarefas e tags da subconta`.
 *
 * Nota de COMPROMISSO é outra entidade, em `api/calendars.ts` — ali o pai é o compromisso.
 */
const BASE = "https://services.leadconnectorhq.com";

export type Tipo = "nota" | "tarefa";

/** `notes` ou `tasks`: é a única diferença entre as duas áreas. */
const rota = (tipo: Tipo): string => (tipo === "nota" ? "notes" : "tasks");

const url = (tipo: Tipo, contactId: string, id?: string): string =>
  `${BASE}/contacts/${contactId}/${rota(tipo)}${id ? `/${id}` : ""}`;

export function listar(client: GhlClient, tipo: Tipo, contactId: string): Promise<unknown> {
  return client.getJson(url(tipo, contactId));
}

export function ler(client: GhlClient, tipo: Tipo, contactId: string, id: string): Promise<unknown> {
  return client.getJson(url(tipo, contactId, id));
}

/**
 * Criar nota exige só `body`. Criar tarefa exige `title`, `dueDate` E `completed` — quem
 * monta o corpo é a CLI, que preenche `completed: false` quando o usuário não disser nada.
 * Aqui nada é inventado: o corpo vai como veio.
 */
export function criar(
  client: GhlClient, tipo: Tipo, contactId: string, corpo: Record<string, unknown>,
): Promise<unknown> {
  return client.postJson(url(tipo, contactId), corpo);
}

/** PUT parcial: o servidor trata como patch, apesar do verbo. */
export function editar(
  client: GhlClient, tipo: Tipo, contactId: string, id: string, corpo: Record<string, unknown>,
): Promise<unknown> {
  return client.putJson(url(tipo, contactId, id), corpo);
}

export function apagar(client: GhlClient, tipo: Tipo, contactId: string, id: string): Promise<unknown> {
  return client.deleteJson(url(tipo, contactId, id));
}

/** Rota dedicada de concluir, que existe em paralelo ao PUT geral. */
export function concluir(
  client: GhlClient, contactId: string, taskId: string, completed: boolean,
): Promise<unknown> {
  return client.putJson(`${BASE}/contacts/${contactId}/tasks/${taskId}/completed`, { completed });
}

export interface FiltroTarefa {
  contactId?: string[];
  completed?: boolean;
  assignedTo?: string[];
  query?: string;
  limit?: number;
  skip?: number;
}

/** Tarefas de toda a subconta, não de um contato. `limit` do servidor é 25 por padrão. */
export function buscarTarefas(client: GhlClient, loc: string, filtro: FiltroTarefa): Promise<unknown> {
  const corpo = Object.fromEntries(Object.entries(filtro).filter(([, v]) => v !== undefined));
  return client.postJson(`${BASE}/locations/${loc}/tasks/search`, corpo);
}

/**
 * O servidor devolve `succeeded` em nota e tarefa, e AS DUAS grafias em tag
 * (`{"succeded":true,"succeeded":true}`). A doc de tag só traz a errada. Ler as duas.
 */
export function deuCerto(r: unknown): boolean {
  const o = (r ?? {}) as Record<string, unknown>;
  return o.succeeded === true || o.succeded === true;
}
