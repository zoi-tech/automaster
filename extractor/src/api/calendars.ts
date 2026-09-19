import type { GhlClient } from "./client.js";
import { fetchCalendars } from "./entities.js";

/**
 * Rotas de agenda. Host e caminhos vêm da sondagem registrada em
 * docs/endpoints.md § Agenda — não da referência pública, que já recusou nossos tokens.
 */
const BASE = "https://services.leadconnectorhq.com";

/** Situações que o servidor aceita. Não existe "remarcado": remarcar é mudar o horário. */
export const AGENDA_SITUACOES = [
  "new", "confirmed", "cancelled", "showed", "noshow", "invalid", "completed", "active",
] as const;

/** Aceita só ISO com fuso. Fuso implícito marca reunião no horário errado sem avisar. */
export function isoComFuso(v: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)$/.test(v)) {
    throw new Error(
      `data sem fuso ou malformada: ${v}. Use ISO com fuso, ex.: 2026-10-02T14:00:00-03:00`,
    );
  }
  return v;
}

/** Milissegundos desde 1970, para as rotas que não aceitam texto ISO. */
export function epochMs(iso: string): number {
  return Date.parse(isoComFuso(iso));
}

export interface SlotFiltro {
  inicio: string;        // ISO com fuso
  fim: string;           // ISO com fuso
  timezone?: string;     // IANA, ex.: America/Sao_Paulo
  usuario?: string;
}

export interface EventoFiltro {
  inicio: string;
  fim: string;
  calendario?: string;
  usuario?: string;
  grupo?: string;
  /** Não vai para a query: a rota rejeita `contactId` (422 "property contactId should not
   * exist"). Filtramos no cliente pelo `contactId` de cada evento devolvido. */
  contato?: string;
}

interface EventosResposta {
  events?: Array<{ contactId?: string; [k: string]: unknown }>;
  [k: string]: unknown;
}

/** Calendários da subconta. Reusa o que o extractor já faz no dump. */
export function listCalendars(client: GhlClient, locationId: string): Promise<unknown> {
  return fetchCalendars(client, locationId);
}

export function getCalendar(client: GhlClient, calendarId: string): Promise<unknown> {
  return client.getJson(`${BASE}/calendars/${encodeURIComponent(calendarId)}`);
}

/** Horários livres. Esta rota usa epoch e fuso em campo separado; o corpo do
 * compromisso usa ISO. A diferença é da API, não nossa. */
export function freeSlots(
  client: GhlClient, calendarId: string, f: SlotFiltro,
): Promise<unknown> {
  const inicio = epochMs(f.inicio);
  const fim = epochMs(f.fim);
  if (fim - inicio > 31 * 86_400_000) {
    throw new Error("o intervalo de horários livres não pode passar de 31 dias");
  }
  const p = new URLSearchParams({ startDate: String(inicio), endDate: String(fim) });
  if (f.timezone) p.set("timezone", f.timezone);
  if (f.usuario) p.set("userId", f.usuario);
  return client.getJson(
    `${BASE}/calendars/${encodeURIComponent(calendarId)}/free-slots?${p.toString()}`,
  );
}

/**
 * Compromissos e bloqueios do período (mesmo envelope `{events:[...]}` para os dois;
 * o compromisso traz `contactId`/`appointmentStatus`/`appointmentMeta`, o bloqueio não).
 * Exige um de calendário, usuário ou grupo — a rota devolve 422 sem isso.
 */
export function listEvents(
  client: GhlClient, locationId: string, f: EventoFiltro,
): Promise<unknown> {
  if (!f.calendario && !f.usuario && !f.grupo) {
    throw new Error("a listagem exige um de calendário, usuário ou grupo");
  }
  const p = new URLSearchParams({
    locationId,
    startTime: String(epochMs(f.inicio)),
    endTime: String(epochMs(f.fim)),
  });
  if (f.calendario) p.set("calendarId", f.calendario);
  if (f.usuario) p.set("userId", f.usuario);
  if (f.grupo) p.set("groupId", f.grupo);
  const promessa = client.getJson<EventosResposta>(`${BASE}/calendars/events?${p.toString()}`);
  if (!f.contato) return promessa;
  return promessa.then((r) => ({
    ...r,
    events: (r.events ?? []).filter((e) => e.contactId === f.contato),
  }));
}

export function getAppointment(client: GhlClient, eventId: string): Promise<unknown> {
  return client.getJson(
    `${BASE}/calendars/events/appointments/${encodeURIComponent(eventId)}`,
  );
}

export function listNotes(
  client: GhlClient, appointmentId: string, limit = 20, offset = 0,
): Promise<unknown> {
  const p = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  return client.getJson(
    `${BASE}/calendars/appointments/${encodeURIComponent(appointmentId)}/notes?${p.toString()}`,
  );
}

export interface CompromissoCorpo {
  calendarId?: string;
  locationId?: string;
  contactId?: string;
  startTime?: string;
  endTime?: string;
  title?: string;
  description?: string;
  address?: string;
  appointmentStatus?: string;
  assignedUserId?: string;
  toNotify?: boolean;
  ignoreDateRange?: boolean;
  ignoreFreeSlotValidation?: boolean;
  rrule?: string;
}

export function createAppointment(
  client: GhlClient, corpo: CompromissoCorpo,
): Promise<unknown> {
  return client.postJson(`${BASE}/calendars/events/appointments`, corpo);
}

export function updateAppointment(
  client: GhlClient, eventId: string, corpo: CompromissoCorpo,
): Promise<unknown> {
  return client.putJson(
    `${BASE}/calendars/events/appointments/${encodeURIComponent(eventId)}`, corpo,
  );
}

export function createNote(
  client: GhlClient, appointmentId: string, body: string, userId?: string,
): Promise<unknown> {
  return client.postJson(
    `${BASE}/calendars/appointments/${encodeURIComponent(appointmentId)}/notes`,
    { body, ...(userId ? { userId } : {}) },
  );
}

export function updateNote(
  client: GhlClient, appointmentId: string, noteId: string, body: string,
): Promise<unknown> {
  return client.putJson(
    `${BASE}/calendars/appointments/${encodeURIComponent(appointmentId)}` +
    `/notes/${encodeURIComponent(noteId)}`,
    { body },
  );
}

export function deleteNote(
  client: GhlClient, appointmentId: string, noteId: string,
): Promise<unknown> {
  return client.deleteJson(
    `${BASE}/calendars/appointments/${encodeURIComponent(appointmentId)}` +
    `/notes/${encodeURIComponent(noteId)}`,
  );
}

/** Bloqueio de horário. Não tem contato nem situação — a rota só aceita estes campos. */
export interface BloqueioCorpo {
  calendarId?: string;
  locationId?: string;
  startTime?: string;
  endTime?: string;
  title?: string;
  assignedUserId?: string;
}

export function createBlockSlot(
  client: GhlClient, corpo: BloqueioCorpo,
): Promise<unknown> {
  return client.postJson(`${BASE}/calendars/events/block-slots`, corpo);
}

export function updateBlockSlot(
  client: GhlClient, eventId: string, corpo: BloqueioCorpo,
): Promise<unknown> {
  return client.putJson(
    `${BASE}/calendars/events/block-slots/${encodeURIComponent(eventId)}`, corpo,
  );
}

/** Bloqueios do período. Mesmo envelope de `listEvents`, filtro da mesma coleção. */
export function listBlockedSlots(
  client: GhlClient, locationId: string, f: EventoFiltro,
): Promise<unknown> {
  if (!f.calendario && !f.usuario && !f.grupo) {
    throw new Error("a listagem exige um de calendário, usuário ou grupo");
  }
  const p = new URLSearchParams({
    locationId,
    startTime: String(epochMs(f.inicio)),
    endTime: String(epochMs(f.fim)),
  });
  if (f.calendario) p.set("calendarId", f.calendario);
  if (f.usuario) p.set("userId", f.usuario);
  if (f.grupo) p.set("groupId", f.grupo);
  return client.getJson(`${BASE}/calendars/blocked-slots?${p.toString()}`);
}
