import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Page } from "playwright";
import { captureTokens, decodeUserId } from "../src/auth/token.js";
import { registroDeLoginAntigo } from "../src/cli/shared.js";

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

const URL_LOGIN = "https://app.gohighlevel.com/?url=%2Fv2%2Flocation%2FX%2Fautomation%2Fworkflows";
const URL_WORKFLOWS = "https://app.gohighlevel.com/v2/location/X/automation/workflows";

/** Página falsa do Playwright parada numa URL: nenhum request autenticado sai dela. */
function paginaParadaEm(url: string): Page {
  return {
    on: () => {},
    off: () => {},
    goto: () => Promise.resolve(null),
    reload: () => Promise.resolve(null),
    url: () => url,
  } as unknown as Page;
}

test("captureTokens na tela de login avisa aoVerLogin uma vez só, com a URL, e falha como hoje", async () => {
  const vistas: string[] = [];
  await assert.rejects(
    captureTokens(paginaParadaEm(URL_LOGIN), "X", { timeoutMs: 700, aoVerLogin: (u) => vistas.push(u) }),
    /Não capturei os tokens/,
  );
  assert.deepEqual(vistas, [URL_LOGIN]);
});

test("captureTokens fora da tela de login nunca chama aoVerLogin", async () => {
  let chamadas = 0;
  await assert.rejects(
    captureTokens(paginaParadaEm(URL_WORKFLOWS), "X", { timeoutMs: 700, aoVerLogin: () => chamadas++ }),
    /Não capturei os tokens/,
  );
  assert.equal(chamadas, 0);
});

test("registroDeLoginAntigo grava uma linha do caminho antigo, sem token, quando o GHL pede login", async () => {
  const arquivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "amlogin-")), "logins.jsonl");
  await assert.rejects(
    captureTokens(paginaParadaEm(URL_LOGIN), "X", {
      timeoutMs: 700,
      aoVerLogin: registroDeLoginAntigo(arquivo, "/perfil/x", "X"),
    }),
    /Não capturei os tokens/,
  );
  const linhas = fs.readFileSync(arquivo, "utf-8").split("\n").filter(Boolean);
  assert.equal(linhas.length, 1);
  const linha = JSON.parse(linhas[0]) as Record<string, unknown>;
  assert.equal(linha.via, "withClient");
  assert.equal(linha.motivo, "redirecionamento");
  assert.equal(linha.perfil, "/perfil/x");
  assert.equal(linha.subconta, "X");
  assert.equal(linha.origem, "/v2/location/X/automation/workflows");
  assert.equal(linha.navegouAntes, false);
  assert.deepEqual(Object.keys(linha).filter((k) => /token|bearer/i.test(k)), []);
});
