import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { travarChrome } from "../src/auth/lock.js";

const tmp = (): string => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "amlock-")), "chrome.lock");

test("segunda trava do mesmo perfil falha enquanto a primeira está viva", () => {
  const arq = tmp();
  const soltar = travarChrome(arq);
  fs.writeFileSync(arq, "1"); // pid 1 (init) está sempre vivo: simula outro processo segurando
  assert.throws(() => travarChrome(arq), /já está com o Chrome \(pid 1\)/);
  fs.writeFileSync(arq, String(process.pid));
  soltar();
  assert.equal(fs.existsSync(arq), false);
});

test("lock órfão de processo morto é roubado", () => {
  const arq = tmp();
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  fs.writeFileSync(arq, "2147480000"); // PID que não existe
  const soltar = travarChrome(arq);
  assert.equal(fs.readFileSync(arq, "utf-8"), String(process.pid));
  soltar();
});
