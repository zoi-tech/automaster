import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { conferirDump, carregarSchema, SCHEMA_JSON } from "../src/dump/schema.js";

const SCHEMA = carregarSchema();

function dump(ajustes: (dir: string) => void): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amdump-"));
  fs.mkdirSync(path.join(dir, "workflows"));
  const env = (raw: unknown): string => JSON.stringify({ fetchedAt: "2026-01-01T00:00:00Z", raw });
  fs.writeFileSync(path.join(dir, "pipelines.json"), env({ pipelines: [] }));
  fs.writeFileSync(path.join(dir, "tags.json"), env({ tags: [] }));
  fs.writeFileSync(path.join(dir, "custom_fields.json"), env({ customFields: [] }));
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({
    schemaVersion: 1, locationId: "L1", extractedAt: "2026-01-01T00:00:00Z",
    extractorVersion: "0.1.0", counts: {}, warnings: [],
  }));
  ajustes(dir);
  return dir;
}

test("o schema do auditor é alcançável a partir do extractor", () => {
  assert.ok(SCHEMA, `dump_schema.json não encontrado em ${SCHEMA_JSON}`);
  assert.equal(SCHEMA?.schemaVersion, 1);
});

test("dump no contrato não acusa nada, mesmo sem nenhum workflow", () => {
  assert.deepEqual(conferirDump(dump(() => {})), []);
});

test("campo obrigatório ausente e tipo trocado são acusados com o caminho", () => {
  const problemas = conferirDump(dump((dir) => {
    fs.writeFileSync(path.join(dir, "tags.json"), JSON.stringify({ fetchedAt: "x", raw: { tags: {} } }));
    fs.writeFileSync(path.join(dir, "pipelines.json"), JSON.stringify({ raw: { pipelines: [] } }));
  }));
  assert.ok(problemas.some((p) => /tags\.json: raw\.tags deveria ser array, veio object/.test(p)), problemas.join("; "));
  assert.ok(problemas.some((p) => /pipelines\.json: campo obrigatório ausente: fetchedAt/.test(p)), problemas.join("; "));
});

test("arquivo opcional ausente não acusa; obrigatório ausente acusa", () => {
  assert.deepEqual(conferirDump(dump((dir) => fs.rmSync(path.join(dir, "forms.json"), { force: true }))), []);
  const problemas = conferirDump(dump((dir) => fs.rmSync(path.join(dir, "tags.json"))));
  assert.deepEqual(problemas, ["arquivo ausente no dump: tags.json"]);
});

test("sem schema ao alcance a checagem é pulada, não falha", () => {
  assert.equal(carregarSchema("/nao/existe/dump_schema.json"), undefined);
  // dump vazio: com schema acusaria tudo; sem schema, nada — a checagem é rede, não portão
  const vazio = fs.mkdtempSync(path.join(os.tmpdir(), "amvazio-"));
  assert.deepEqual(conferirDump(vazio, "/nao/existe/dump_schema.json"), []);
  assert.ok(conferirDump(vazio).length > 0);
});
