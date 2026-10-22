/**
 * Etapa 1 — status de entrega na leitura de conversa.
 *
 * `resumirMensagem` é o que a CLI `conversas --json` devolve por mensagem (e o
 * que a tool MCP `conversas` repassa). Importar `cli/conversas.ts` só registra
 * comando — outros testes já importam módulos de `src/cli/` do mesmo jeito.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resumirMensagem } from "../src/cli/conversas.js";
import type { RawMessage } from "../src/api/conversations.js";

const base = (extra: Partial<RawMessage> & Record<string, unknown> = {}): RawMessage => ({
  id: "msg1",
  type: 19, // WHATSAPP
  direction: "outbound",
  body: "Oi, tudo bem?",
  dateAdded: "2026-10-20T12:00:00.000Z",
  userId: "user1",
  conversationId: "conv1",
  ...extra,
});

// --- status ----------------------------------------------------------------

test("saída entregue: status 'delivered' e erro null", () => {
  const r = resumirMensagem(base({ status: "delivered" }));
  assert.equal(r.status, "delivered");
  assert.equal(r.erro, null);
});

test("mensagem sem status sai com status null (não undefined, não some do objeto)", () => {
  const r = resumirMensagem(base());
  assert.ok("status" in r, "campo status tem de existir");
  assert.equal(r.status, null);
  assert.ok("erro" in r, "campo erro tem de existir");
  assert.equal(r.erro, null);
});

test("status desconhecido passa como veio", () => {
  assert.equal(resumirMensagem(base({ status: "read" })).status, "read");
});

// --- erro ------------------------------------------------------------------

test("falha com erro em texto: status 'failed' e erro com o texto", () => {
  const r = resumirMensagem(base({ status: "failed", error: "Número não está no WhatsApp" }));
  assert.equal(r.status, "failed");
  assert.equal(r.erro, "Número não está no WhatsApp");
});

test("erro como objeto {message}: vira o texto da mensagem, não o objeto nem '[object Object]'", () => {
  const r = resumirMensagem(base({ status: "failed", error: { message: "Janela de 24h fechada", code: 470 } }));
  assert.equal(r.status, "failed");
  assert.equal(r.erro, "Janela de 24h fechada");
});

test("erro só em errorMessage: vira o texto", () => {
  const r = resumirMensagem(base({ status: "failed", errorMessage: "Carrier rejected" }));
  assert.equal(r.erro, "Carrier rejected");
});

test("error em texto vence errorMessage", () => {
  const r = resumirMensagem(base({ status: "failed", error: "primeiro", errorMessage: "segundo" }));
  assert.equal(r.erro, "primeiro");
});

test("error.message vence errorMessage", () => {
  const r = resumirMensagem(base({ status: "failed", error: { message: "do objeto" }, errorMessage: "solto" }));
  assert.equal(r.erro, "do objeto");
});

test("error objeto sem message cai para errorMessage", () => {
  const r = resumirMensagem(base({ status: "failed", error: { code: 131026 }, errorMessage: "Undeliverable" }));
  assert.equal(r.erro, "Undeliverable");
});

test("falha sem nenhum campo de erro: erro null", () => {
  const r = resumirMensagem(base({ status: "failed" }));
  assert.equal(r.status, "failed");
  assert.equal(r.erro, null);
});

// --- campos que já existiam -----------------------------------------------

test("mensagem completa: campos antigos iguais e só status/erro a mais", () => {
  const r = resumirMensagem(base({
    status: "delivered",
    source: "workflow",
    altId: "email-abc",
    meta: { call: { duration: 30 } },
    // campos crus que não podem vazar para a saída
    contentType: "text/plain",
    locationId: "loc1",
  }));
  assert.deepEqual(r, {
    id: "msg1",
    data: "2026-10-20T12:00:00.000Z",
    tipo: "WHATSAPP",
    direcao: "outbound",
    autor: "user1",
    origem: "workflow",
    corpo: "Oi, tudo bem?",
    emailMessageId: "email-abc",
    temGravacao: true,
    status: "delivered",
    erro: null,
  });
});

test("mensagem mínima: defaults dos campos antigos (autor/origem/emailMessageId null, sem gravação)", () => {
  const r = resumirMensagem({
    id: "m2",
    type: 2, // SMS
    direction: "inbound",
    body: "chegou",
    dateAdded: "2026-10-21T08:30:00.000Z",
    conversationId: "conv1",
  });
  assert.deepEqual(r, {
    id: "m2",
    data: "2026-10-21T08:30:00.000Z",
    tipo: "SMS",
    direcao: "inbound",
    autor: null,
    origem: null,
    corpo: "chegou",
    emailMessageId: null,
    temGravacao: false,
    status: null,
    erro: null,
  });
});

test("tipo numérico sem nome no mapa vira TYPE_<n>", () => {
  assert.equal(resumirMensagem(base({ type: 999 })).tipo, "TYPE_999");
});

test("corpo: sem body usa activity.title; sem nenhum dos dois, string vazia", () => {
  const semBody = base({ type: 31, activity: { title: "Agendamento criado" } });
  delete (semBody as { body?: string }).body;
  assert.equal(resumirMensagem(semBody).corpo, "Agendamento criado");
  assert.equal(resumirMensagem(semBody).tipo, "ACTIVITY_APPOINTMENT");

  const vazio = base();
  delete (vazio as { body?: string }).body;
  assert.equal(resumirMensagem(vazio).corpo, "");
});

test("body vazio não cai para activity.title (?? e não ||)", () => {
  const r = resumirMensagem(base({ body: "", activity: { title: "não usar" } }));
  assert.equal(r.corpo, "");
});
