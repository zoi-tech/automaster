import { test } from "node:test";
import assert from "node:assert/strict";
import { emitir, falhar, marcarEscrita, marcarRastro } from "../src/saida.js";
import { ErroSessao } from "../src/fundo/comum.js";

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

/** Roda `falhar` com `process.exit` trocado por um que lança: devolve o envelope e o código de saída. */
function falharCapturado(e: unknown): { envelope: { ok: boolean; error: { code: string; message: string } }; saida: unknown } {
  const linhas: string[] = [];
  const [log, err, exit] = [console.log, console.error, process.exit];
  let saida: unknown;
  console.log = (l: string) => { linhas.push(l); };
  console.error = () => {};
  process.exit = ((c?: number) => { saida = c; throw new Error("saiu"); }) as typeof process.exit;
  try {
    assert.throws(() => falhar(e), /saiu/);
  } finally {
    console.log = log;
    console.error = err;
    process.exit = exit;
  }
  return { envelope: JSON.parse(linhas.at(-1)!), saida };
}

test("falhar leva o codigo do erro de sessão ao envelope: login_pendente", () => {
  // a mensagem cita HTTP 401 de propósito: o `codigo` do erro vence o que a mensagem sugere
  const { envelope, saida } = falharCapturado(new ErroSessao("login_pendente", "o GHL pediu login depois do HTTP 401"));
  assert.equal(saida, 1);
  assert.equal(envelope.ok, false);
  assert.deepEqual(envelope.error, { code: "login_pendente", message: "o GHL pediu login depois do HTTP 401" });
});

test("falhar leva o codigo do erro de sessão ao envelope: sessao_indisponivel", () => {
  const { envelope, saida } = falharCapturado(new ErroSessao("sessao_indisponivel", "o processo de fundo não respondeu"));
  assert.equal(saida, 1);
  assert.deepEqual(envelope.error, { code: "sessao_indisponivel", message: "o processo de fundo não respondeu" });
});

test("falhar sem codigo segue como antes: HTTP 422 vira http_422, o resto vira erro", () => {
  assert.equal(falharCapturado(new Error("GET x → HTTP 422 corpo")).envelope.error.code, "http_422");
  assert.equal(falharCapturado(new Error("deu ruim")).envelope.error.code, "erro");
  // `code` de erro do Node não é `codigo`, e `codigo` que não é texto não conta
  const enoent = Object.assign(new Error("ENOENT: arquivo"), { code: "ENOENT" });
  assert.equal(falharCapturado(enoent).envelope.error.code, "erro");
  const numerico = Object.assign(new Error("GET x → HTTP 500"), { codigo: 500 });
  assert.equal(falharCapturado(numerico).envelope.error.code, "http_500");
  assert.equal(falharCapturado("texto solto").envelope.error.code, "erro");
});
