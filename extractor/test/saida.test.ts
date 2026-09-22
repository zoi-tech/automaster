import { test } from "node:test";
import assert from "node:assert/strict";
import { emitir, marcarEscrita, marcarRastro } from "../src/saida.js";

function capturar(fn: () => void): string[] {
  const linhas: string[] = [];
  const orig = console.log;
  console.log = (l: string) => { linhas.push(l); };
  try { fn(); } finally { console.log = orig; }
  return linhas;
}

test("--json emite envelope de uma linha; sem ele, o dado pretty", () => {
  const [json] = capturar(() => emitir(true, { n: 3 }));
  assert.deepEqual(JSON.parse(json), { ok: true, data: { n: 3 } });
  const [pretty] = capturar(() => emitir(false, { n: 3 }));
  assert.equal(pretty.includes("\n"), true);
});

test("escrita que saiu aparece no envelope com o rastro", () => {
  marcarEscrita();
  marcarRastro("/r/antes.json");
  const [json] = capturar(() => emitir(true, { ok: "feito" }));
  assert.deepEqual(JSON.parse(json).escrita, { tentada: true, rastros: ["/r/antes.json"] });
});
