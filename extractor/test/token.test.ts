import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeUserId } from "../src/auth/token.js";

/** Monta um JWT de mentira: só o payload importa, a assinatura nunca é verificada aqui. */
function jwt(payload: Record<string, unknown>): string {
  const b64 = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  return `xxx.${b64}.yyy`;
}

test("tira o userId do Bearer quando ele traz user_id", () => {
  assert.equal(decodeUserId(jwt({ user_id: "U1" }), jwt({ company_id: "C1" })), "U1");
});

test("aceita a grafia userId no Bearer", () => {
  assert.equal(decodeUserId(jwt({ userId: "U2" }), ""), "U2");
});

test("cai para o token-id quando o Bearer não traz nada", () => {
  assert.equal(decodeUserId(jwt({ company_id: "C1" }), jwt({ user_id: "U3" })), "U3");
});

test("aceita sub como último recurso, que é o claim padrão do Firebase", () => {
  assert.equal(decodeUserId("", jwt({ sub: "U4" })), "U4");
});

test("devolve vazio quando nenhum token traz id — o CLI exige --usuario nesse caso", () => {
  assert.equal(decodeUserId(jwt({ company_id: "C1" }), jwt({ company_id: "C1" })), "");
});

test("devolve vazio em token quebrado, sem estourar", () => {
  assert.equal(decodeUserId("não é jwt", ""), "");
});

test("ignora claim que não é string", () => {
  assert.equal(decodeUserId(jwt({ user_id: 42 }), ""), "");
});
