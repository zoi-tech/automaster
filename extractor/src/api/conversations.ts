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
  client: GhlClient, conversationId: string, max = 100, pageSize = 50, tipo?: string,
): Promise<{ mensagens: RawMessage[]; maisPaginas: boolean; proximo: string | null }> {
  const todas: RawMessage[] = [];
  let lastMessageId: string | null = null;
  let nextPage = false;
  while (todas.length < max) {
    const q = new URLSearchParams({ limit: String(Math.min(pageSize, max - todas.length)) });
    // no filtro o tipo é a STRING da API pública (TYPE_EMAIL), não o número que a resposta traz
    if (tipo) q.set("type", tipo);
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

/** Busca de texto dentro de uma conversa. Devolve só os ids que casaram. */
export async function searchInConversation(
  client: GhlClient, locationId: string, conversationId: string, query: string, limit = 50,
): Promise<{ messageId: string; emailMessageId?: string; source?: string }[]> {
  const r = await client.postJson<{ matchedMessageIds?: { messageId: string }[] }>(
    `${SERVICES}/conversations/message-search/${conversationId}`,
    { locationId, query, limit, sortDirection: "desc" });
  return r.matchedMessageIds ?? [];
}

/** Busca de texto em toda a subconta: devolve conversas com a mensagem que casou. */
export async function searchMessages(
  client: GhlClient, locationId: string, query: string, limit = 20,
): Promise<any[]> {
  const r = await client.postJson<{ conversations?: any[] }>(
    `${SERVICES}/conversations/message-search`, { locationId, query, limit });
  // o `limit` do corpo é ignorado pelo servidor (devolveu 20 pedindo 3) — cortar aqui
  return (r.conversations ?? []).slice(0, limit);
}

/**
 * E-mail completo. O id **não** é o da mensagem: é o `emailMessageId` que a
 * busca devolve (o `id` da mensagem vale como `threadId`). Com o id errado a
 * resposta é 400 "Email message does not exist".
 */
export async function fetchEmail(client: GhlClient, emailMessageId: string): Promise<any> {
  const r = await client.getJson<{ emailMessage?: any }>(`${SERVICES}/conversations/messages/email/${emailMessageId}`);
  return r.emailMessage ?? r;
}

/** Vários e-mails de uma vez (o `search?threadId=` recusa toda combinação testada). */
export async function fetchEmails(client: GhlClient, locationId: string, ids: string[]): Promise<any[]> {
  const r = await client.postJson<{ emails?: any[] }>(`${SERVICES}/conversations/messages/email/batch`, { locationId, ids });
  return r.emails ?? [];
}

/** Gravação de chamada (binário). Só existe em mensagem de chamada: 422 nas demais. */
export function recordingUrl(locationId: string, messageId: string, index = 0): string {
  return `${SERVICES}/conversations/messages/${messageId}/locations/${locationId}/recording?index=${index}`;
}

/** Transcrição de chamada. 400 quando a mensagem não tem uma. */
export async function fetchTranscription(
  client: GhlClient, locationId: string, messageId: string, index = 0,
): Promise<any> {
  return client.getJson(`${SERVICES}/conversations/locations/${locationId}/messages/${messageId}/transcription?index=${index}`);
}

/**
 * Altera flags da conversa. `unreadCount: 1` marca como não lida, `0` como lida
 * — e os campos `firstUnreadInbound*` que a interface manda junto são recusados
 * com 422. `starred` liga/desliga a estrela.
 */
export async function updateConversation(
  client: GhlClient, locationId: string, conversationId: string,
  patch: { unreadCount?: 0 | 1; starred?: boolean },
): Promise<any> {
  return client.putJson(`${SERVICES}/conversations/${conversationId}`, { locationId, ...patch });
}

/** APAGA a conversa inteira — não há como apagar uma mensagem só. Sem desfazer. */
export async function deleteConversation(client: GhlClient, conversationId: string): Promise<any> {
  return client.deleteJson(`${SERVICES}/conversations/${conversationId}`);
}

export async function saveDraft(
  client: GhlClient, locationId: string, contactId: string, body: string,
  channel = "sms", attachments: string[] = [],
): Promise<{ _id?: string }> {
  return client.postJson(`${SERVICES}/conversations/messages/drafts`, { locationId, contactId, body, channel, attachments });
}

export async function fetchDrafts(client: GhlClient, locationId: string, contactId: string): Promise<any[]> {
  const r = await client.getJson<{ drafts?: any[] }>(`${SERVICES}/conversations/messages/drafts/${locationId}/contacts/${contactId}`);
  return r.drafts ?? [];
}

export async function deleteDraft(client: GhlClient, draftId: string): Promise<any> {
  return client.deleteJson(`${SERVICES}/conversations/messages/drafts/${draftId}`);
}

/** Cancela mensagem agendada. Responde 200 com aviso quando já saiu. */
export async function cancelScheduled(
  client: GhlClient, id: string, email = false,
): Promise<{ message?: string; status?: number }> {
  const rota = email ? `messages/email/${id}/schedule` : `messages/${id}/schedule`;
  return client.deleteJson(`${SERVICES}/conversations/${rota}`);
}

/** Reenvia uma mensagem que falhou. Não exercitado ao vivo. */
export async function resend(
  client: GhlClient, locationId: string, id: string, email = false,
): Promise<any> {
  return email
    ? client.postJson(`${SERVICES}/conversations/messages/resend/email`, { emailMessageId: id, locationId })
    : client.postJson(`${SERVICES}/conversations/messages/resend/text`, { messageId: id, locationId });
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
  /** epoch em SEGUNDOS. Ignorado em InternalComment — a nota sai na hora. */
  scheduledTimestamp?: number;
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
