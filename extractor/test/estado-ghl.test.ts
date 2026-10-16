/**
 * Sessão do GHL para o Playwright MCP: o arquivo leva só cookies e origens do GHL, sai 0600,
 * e um arquivo antigo com outra permissão também fica 0600.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { ChromeDeFundo } from "../src/fundo/chrome.js";

test("grava só cookies e origens do GHL, com permissão 0600, e troca arquivo antigo de forma atômica", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "estado-ghl-"));
  const arquivo = path.join(dir, "estado-ghl.json");
  fs.writeFileSync(arquivo, "{}", { mode: 0o644 });
  const navegador = await chromium.launch({ channel: "chrome", headless: true });
  const contexto = await navegador.newContext();
  try {
    await contexto.addCookies([
      { name: "sessao", value: "x", domain: "app.gohighlevel.com", path: "/" },
      { name: "outro", value: "y", domain: "accounts.google.com", path: "/" },
    ]);
    const chrome = new ChromeDeFundo("/x/perfil", "/x/logins.jsonl", () => {}, undefined, undefined, arquivo);
    await (chrome as unknown as { gravarEstado(c: unknown, a: string): Promise<void> }).gravarEstado(contexto, arquivo);
    const gravado = JSON.parse(fs.readFileSync(arquivo, "utf-8")) as { cookies: { name: string }[] };
    assert.deepEqual(gravado.cookies.map((c) => c.name), ["sessao"]);
    assert.equal(fs.statSync(arquivo).mode & 0o777, 0o600);
    assert.equal(fs.existsSync(`${arquivo}.tmp`), false);
  } finally {
    await contexto.close();
    await navegador.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
