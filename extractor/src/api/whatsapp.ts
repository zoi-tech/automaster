import type { GhlClient } from "./client.js";
import { sendMessage } from "./conversations.js";

/** WhatsApp fica noutra base que o resto das conversas. */
const PHONE = "https://services.leadconnectorhq.com/phone-system";

export interface WaTemplateComponent {
  type: string;           // HEADER | BODY | FOOTER | BUTTONS | CALL_PERMISSION_REQUEST
  format?: string;        // TEXT | IMAGE | DOCUMENT | LOCATION | VIDEO
  text?: string;
  customVariables?: string[];
  buttons?: unknown[];
  [k: string]: unknown;
}

export interface WaTemplate {
  id?: string;
  name: string;
  language: string;
  category?: string;
  correct_category?: string;
  status?: string;
  components?: WaTemplateComponent[];
  [k: string]: unknown;
}

export interface WaFlow {
  id: string;
  name: string;
  status: string;         // PUBLISHED | DRAFT | ...
  config?: unknown;
  [k: string]: unknown;
}

/** A subconta tem WhatsApp ligado? */
export function isConfigured(client: GhlClient, locationId: string): Promise<unknown> {
  return client.getJson(`${PHONE}/whatsapp/location/${locationId}/is-configured`);
}

/** Números de WhatsApp da subconta (o `id` alimenta `fromNumberId` no envio). */
export function fetchPhoneNumbers(client: GhlClient, locationId: string): Promise<unknown> {
  return client.getJson(`${PHONE}/whatsapp/location/${locationId}/phone-numbers`);
}

/**
 * Templates da subconta. Sem `templateId` devolve a lista; com, o template
 * único (é o mesmo endpoint — o app filtra por query).
 */
export async function fetchTemplates(
  client: GhlClient, locationId: string, templateId?: string,
): Promise<WaTemplate[]> {
  let url = `${PHONE}/whatsapp/location/${locationId}/template`;
  if (templateId) url += `?templateId=${encodeURIComponent(templateId)}`;
  const r = await client.getJson<WaTemplate[] | { templates?: WaTemplate[] }>(url);
  if (Array.isArray(r)) return r;
  return r.templates ?? [];
}

/** Só os templates aprovados, no formato de opção que o app usa. */
export function fetchApprovedTemplateOptions(client: GhlClient, locationId: string): Promise<unknown> {
  return client.getJson(`${PHONE}/whatsapp/workflow/options/template_id?locationId=${locationId}`);
}

/** Flows (formulários interativos) da subconta. */
export async function fetchFlows(client: GhlClient, locationId: string): Promise<WaFlow[]> {
  const r = await client.getJson<WaFlow[] | { flows?: WaFlow[] }>(`${PHONE}/whatsapp/flows?locationId=${locationId}`);
  return Array.isArray(r) ? r : (r.flows ?? []);
}

/** Texto que o app monta a partir dos componentes, com as variáveis já trocadas. */
export function renderTemplate(t: WaTemplate): string {
  const partes: string[] = [];
  for (const tipo of ["HEADER", "BODY", "FOOTER"]) {
    const c = (t.components ?? []).find((x) => x.type === tipo);
    if (!c?.text) continue;
    let texto = c.text;
    (c.customVariables ?? []).forEach((v, i) => { texto = texto.replace(`{{${i + 1}}}`, v); });
    partes.push(texto);
  }
  return partes.join("\n\n");
}

export interface WaSendCommon {
  contactId: string;
  conversationId?: string;
  fromNumberId?: string;
  toNumber?: string;
  scheduledTimestamp?: number;
}

/**
 * ESCREVE: manda um template aprovado. A mensagem SAI para o contato.
 * `placeholders` são os valores das variáveis de cada bloco.
 */
export function sendTemplate(
  client: GhlClient,
  t: WaTemplate,
  opts: WaSendCommon & { placeholders?: { header?: unknown[]; body?: unknown[]; buttons?: unknown[] } },
): Promise<{ conversationId?: string; messageId?: string; [k: string]: unknown }> {
  return sendMessage(client, {
    type: "WhatsApp",
    contactId: opts.contactId,
    message: renderTemplate(t),
    ...(opts.conversationId ? { conversationId: opts.conversationId } : {}),
    ...(opts.scheduledTimestamp ? { scheduledTimestamp: opts.scheduledTimestamp } : {}),
    whatsapp: {
      type: "template",
      template: { name: t.name, lang: t.language, category: t.correct_category ?? t.category },
      placeholders: { header: [], body: [], buttons: [], ...(opts.placeholders ?? {}) },
      ...(opts.fromNumberId ? { fromNumberId: opts.fromNumberId } : {}),
      ...(opts.toNumber ? { toNumber: opts.toNumber } : {}),
    },
  });
}

/** ESCREVE: manda um flow interativo. A mensagem SAI para o contato. */
export function sendFlow(
  client: GhlClient,
  flow: { id: string; header?: string; body: string; footer?: string; cta: string },
  opts: WaSendCommon,
): Promise<{ conversationId?: string; messageId?: string; [k: string]: unknown }> {
  const { id, header = "", body, footer = "", cta } = flow;
  return sendMessage(client, {
    type: "WhatsApp",
    contactId: opts.contactId,
    message: [header, body, footer].filter(Boolean).join("\n"),
    ...(opts.conversationId ? { conversationId: opts.conversationId } : {}),
    ...(opts.scheduledTimestamp ? { scheduledTimestamp: opts.scheduledTimestamp } : {}),
    whatsapp: {
      type: "interactive",
      interactive: { type: "flow", flow: { id, header, body, footer, cta } },
      ...(opts.fromNumberId ? { fromNumberId: opts.fromNumberId } : {}),
      ...(opts.toNumber ? { toNumber: opts.toNumber } : {}),
    },
  });
}
