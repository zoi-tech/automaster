/**
 * Defaults de caminho que extrator e auditor precisam compartilhar: a pasta dos dumps
 * (o MCP lê de ~/.automaster/dumps) e o perfil do Chrome (AUTOMASTER_PERFIL troca).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultUserDataDir } from "../src/auth/session.js";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("sem AUTOMASTER_DUMPS, o extrator grava em ~/.automaster/dumps, não na pasta de onde roda", () => {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: "/tmp/home-fake-dumps" };
  delete env.AUTOMASTER_DUMPS;
  const r = spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", "import('./src/cli/shared.ts').then(m => console.log(m.DUMPS_DIR))"],
    { cwd: RAIZ, env, encoding: "utf-8" },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), path.join("/tmp/home-fake-dumps", ".automaster", "dumps"));
});

test("AUTOMASTER_PERFIL troca o perfil do Chrome; sem ela, fica em ~/.automaster/chrome-profile", () => {
  const antes = process.env.AUTOMASTER_PERFIL;
  try {
    delete process.env.AUTOMASTER_PERFIL;
    assert.equal(defaultUserDataDir(), path.join(os.homedir(), ".automaster", "chrome-profile"));
    process.env.AUTOMASTER_PERFIL = "/tmp/perfil-outro";
    assert.equal(defaultUserDataDir(), "/tmp/perfil-outro");
  } finally {
    if (antes === undefined) delete process.env.AUTOMASTER_PERFIL;
    else process.env.AUTOMASTER_PERFIL = antes;
  }
});
