import type { GhlClient } from "./client.js";
import type { SendPayload } from "./conversations.js";

const CONV = "https://services.leadconnectorhq.com/conversations";

/**
 * Group chat e chat interno. As rotas saíram do bundle `conversations-new-ui`
 * (2026-09-19); o corpo de `createGroup` **não foi confirmado ao vivo** — o app
 * monta esse payload num chunk que não baixamos. Passe o objeto cru.
 */

/** ESCREVE: cria uma conversa em grupo. Contrato do corpo não confirmado. */
export function createGroup(client: GhlClient, body: unknown): Promise<unknown> {
  return client.postJson(`${CONV}/group`, body);
}

/**
 * ESCREVE: manda mensagem num group chat. A mensagem SAI para todo o grupo.
 * É o mesmo payload do envio normal mais `subType: 3`, que é o que o app
 * acrescenta quando a conversa é de grupo.
 */
export function sendGroupMessage(
  client: GhlClient, payload: SendPayload & { subType?: number },
): Promise<{ conversationId?: string; messageId?: string; [k: string]: unknown }> {
  return client.postJson(`${CONV}/group/messages`, { subType: 3, ...payload });
}

/** ESCREVE: manda mensagem no chat interno entre usuários (não vai a contato). */
export function sendInternalChatMessage(client: GhlClient, payload: unknown): Promise<unknown> {
  return client.postJson(`${CONV}/internal`, payload);
}

/** Existe chat interno com esses usuários? */
export function checkInternalChat(client: GhlClient, body: unknown): Promise<unknown> {
  return client.postJson(`${CONV}/internal/check`, body);
}

/**
 * ESCREVE: troca os participantes de um chat interno. `startAfter` é a data
 * (YYYY-MM-DD) a partir da qual o novo participante vê o histórico; `"-1"` é
 * tudo, `"0"` é nada.
 */
export function updateInternalChatParticipants(
  client: GhlClient,
  opts: { conversationId: string; userIds: string[]; locationId: string; startAfter?: string },
): Promise<unknown> {
  return client.postJson(`${CONV}/internal/user`, { startAfter: "0", ...opts });
}
