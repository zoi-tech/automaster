import type { GhlClient } from "./client.js";

const SERVICES = "https://services.leadconnectorhq.com";

/**
 * `type` das mensagens é NUMÉRICO na API interna (a pública usa as strings
 * `TYPE_*`). Mapa extraído do bundle `conversations-new-ui` em 2026-09-19.
 * Os `TYPE_ACTIVITY_*` não são mensagem: são eventos de timeline no mesmo array.
 */
export const MESSAGE_TYPES: Record<number, string> = {
  1: "CALL", 2: "SMS", 3: "EMAIL", 4: "SMS_REVIEW_REQUEST", 5: "WEBCHAT",
  6: "SMS_NO_SHOW_REQUEST", 7: "CAMPAIGN_SMS", 8: "CAMPAIGN_CALL", 9: "CAMPAIGN_EMAIL",
  10: "CAMPAIGN_VOICEMAIL", 11: "FACEBOOK", 12: "CAMPAIGN_FACEBOOK", 13: "CAMPAIGN_MANUAL_CALL",
  14: "CAMPAIGN_MANUAL_SMS", 15: "GMB", 16: "CAMPAIGN_GMB", 17: "REVIEW", 18: "INSTAGRAM",
  19: "WHATSAPP", 20: "CUSTOM_SMS", 21: "CUSTOM_EMAIL", 22: "CUSTOM_PROVIDER_SMS",
  23: "CUSTOM_PROVIDER_EMAIL", 24: "IVR_CALL", 25: "ACTIVITY_CONTACT", 26: "ACTIVITY_INVOICE",
  27: "ACTIVITY_PAYMENT", 28: "ACTIVITY_OPPORTUNITY", 29: "LIVE_CHAT",
  30: "LIVE_CHAT_INFO_MESSAGE", 31: "ACTIVITY_APPOINTMENT", 32: "FACEBOOK_COMMENT",
  33: "INSTAGRAM_COMMENT", 34: "CUSTOM_CALL", 35: "GROUP_SMS", 36: "INTERNAL_CHAT",
  37: "INTERNAL_COMMENT", 38: "ACTIVITY_EMPLOYEE_ACTION_LOG", 40: "EXTERNAL_HUBSPOT_EMAIL",
  41: "TIKTOK", 42: "TIKTOK_COMMENT", 43: "RCS", 44: "ACTIVITY_WHATSAPP", 45: "SMS_REACTION",
  50: "FORM_SUBMISSION", 51: "ACTIVITY_SLA", 60: "META_MARKETING", 61: "META_MARKETING_OPTIN",
  100: "NO_SHOW",
};

export const typeName = (t: number): string => MESSAGE_TYPES[t] ?? `TYPE_${t}`;
export const isActivity = (t: number): boolean => typeName(t).startsWith("ACTIVITY_");

export interface ConversationSummary {
  id: string;
  contactId: string;
  lastMessageDate: number;
  lastMessageType: string;
  lastMessageDirection: string;
  lastOutboundMessageAction?: string;
  unreadCount: number;
}

export interface RawMessage {
  id: string;
  type: number;
  direction: string;
  body?: string;
  dateAdded: string;
  userId?: string;
  conversationId: string;
  contentType?: string;
  activity?: { title?: string; type?: string };
  [k: string]: unknown;
}

/** Conversas de um contato (uma por canal agrupado; normalmente uma só). */
export async function searchConversations(
  client: GhlClient, locationId: string, contactId: string, limit = 20,
): Promise<ConversationSummary[]> {
  const url = `${SERVICES}/conversations/search?locationId=${locationId}&contactId=${contactId}&limit=${limit}`;
  const r = await client.getJson<{ conversations?: ConversationSummary[] }>(url);
  return r.conversations ?? [];
}

/**
 * Mensagens de uma conversa, da mais recente para a mais antiga. Pagina por
 * `lastMessageId` (não por offset); `nextPage` diz se há mais. Sem o prefixo
 * `/f1` a resposta traz `nextPage` — com ele, não.
 */
export async function fetchMessages(
  client: GhlClient, conversationId: string, max = 100, pageSize = 50,
): Promise<{ mensagens: RawMessage[]; maisPaginas: boolean; proximo: string | null }> {
  const todas: RawMessage[] = [];
  let lastMessageId: string | null = null;
  let nextPage = false;
  while (todas.length < max) {
    const q = new URLSearchParams({ limit: String(Math.min(pageSize, max - todas.length)) });
    if (lastMessageId) q.set("lastMessageId", lastMessageId);
    const r: { messages?: { messages?: RawMessage[]; lastMessageId?: string; nextPage?: boolean } } =
      await client.getJson(`${SERVICES}/conversations/${conversationId}/messages?${q}`);
    const page = r.messages?.messages ?? [];
    todas.push(...page);
    nextPage = Boolean(r.messages?.nextPage);
    lastMessageId = r.messages?.lastMessageId ?? null;
    if (!nextPage || !page.length || !lastMessageId) break;
  }
  return { mensagens: todas, maisPaginas: nextPage, proximo: nextPage ? lastMessageId : null };
}

/** Canais aceitos pelo POST de envio (mesmos nomes da API pública). */
export const SEND_TYPES = ["SMS", "Email", "WhatsApp", "IG", "FB", "Live_Chat", "Custom", "InternalComment"] as const;
export type SendType = (typeof SEND_TYPES)[number];

export interface SendPayload {
  type: SendType;
  contactId: string;
  message?: string;
  html?: string;
  subject?: string;
  emailFrom?: string;
  attachments?: string[];
  conversationId?: string;
}

/**
 * ESCREVE: envia mensagem ao contato. `InternalComment` é nota interna — fica
 * na conversa e **não sai** para o contato; é o tipo seguro para testar o caminho.
 * Resposta traz `conversationId` e `messageId` (e `msg` quando o canal responde).
 */
export async function sendMessage(
  client: GhlClient, payload: SendPayload,
): Promise<{ conversationId?: string; messageId?: string; [k: string]: unknown }> {
  return client.postJson(`${SERVICES}/conversations/messages`, payload);
}
