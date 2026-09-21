import { test } from "node:test";
import assert from "node:assert/strict";
import { avisoPublicado, guardaPublicado } from "../src/api/workflows-live.js";
import {
  trocarReferencia, pareceId, conferirEscrita, conferirVersaoEsperada, type Documento,
} from "../src/api/workflow-edit.js";

const opts = (extra: { publicado?: boolean } = {}) => ({ location: "LOC1", id: "WF1", ...extra });

/** Cliente falso: devolve uma página de inscritos e nada mais. */
function clienteInscritos(quantos: number, estrangulado = false) {
  const statuses = Array.from({ length: quantos }, (_, i) => ({
    _id: `i${i}`, id: `i${i}`, sid: `s${i}`, contactId: `c${i}`, status: "waiting", createdAt: "2026-01-01",
  }));
  return { getJson: () => Promise.resolve({ statuses, isLocationRateLimited: estrangulado }) } as never;
}

const silencio = () => {};

// A guarda é o que separa "editei um rascunho" de "troquei o chão debaixo de quem está andando".
test("guarda de publicado RECUSA sem --publicado", async () => {
  const saida: Record<string, unknown> = {};
  await assert.rejects(
    () => guardaPublicado(clienteInscritos(3), opts(), saida, silencio, "gravar"),
    /PUBLICADO com 3 contato\(s\).*repita com --publicado/s,
  );
});

test("guarda de publicado DEIXA gravar com --publicado, e registra o aviso", async () => {
  const saida: Record<string, unknown> = {};
  await guardaPublicado(clienteInscritos(2), opts({ publicado: true }), saida, silencio, "gravar");
  assert.match(String(saida.aviso), /PUBLICADO com 2 contato\(s\) dentro agora/);
});

// Contagem cortada ou estrangulada é PISO, nunca total: apresentar o número fechado
// faria alguém decidir sobre uma base que não existe.
test("contagem estrangulada vira mensagem de piso, não número fechado", async () => {
  const saida: Record<string, unknown> = {};
  await guardaPublicado(clienteInscritos(4, true), opts({ publicado: true }), saida, silencio, "apagar");
  assert.match(String(saida.aviso), /pelo menos 4 contato\(s\)/);
  assert.match(String(saida.aviso), /não há desfazer/);
});

test("avisoPublicado sem corte dá o número fechado", () => {
  assert.match(avisoPublicado(7, false, "gravar"), /com 7 contato\(s\)/);
  assert.doesNotMatch(avisoPublicado(7, false, "gravar"), /pelo menos/);
});

// I3: `--de` é texto livre, e trocarReferencia reescreve DENTRO de qualquer string.
test("trocar-ref recusa --de que não tem cara de id", () => {
  const doc = {
    workflowData: { templates: [{ id: "s1", type: "sms", attributes: { message: "Olá, tudo bem?" } }] },
  } as unknown as Documento;
  assert.throws(() => trocarReferencia(doc, "Olá", "Oi"), /não parece um id/);
  assert.equal(doc.workflowData.templates[0].attributes!.message, "Olá, tudo bem?");
});

test("pareceId aceita uuid, ObjectId e base62 do GHL; recusa texto", () => {
  assert.ok(pareceId("57f93292-2152-4782-b703-6a4f691f6fe8"));
  assert.ok(pareceId("AkbAIoxcORSn9CELCijZ"));
  assert.ok(pareceId("507f1f77bcf86cd799439011"));
  assert.equal(pareceId("Olá"), false);
  assert.equal(pareceId("Bom dia, tudo certo?"), false);
  assert.equal(pareceId("curto123"), false);
});

// C1: 200 e bump de `version` não são prova nesta API.
test("conferirEscrita aprova quando a releitura bate com o pedido", () => {
  const d = { workflowData: { templates: [{ id: "s1", type: "sms" }] } } as unknown as Documento;
  const relido = { ...JSON.parse(JSON.stringify(d)), version: 9, meta: {} } as Documento;
  assert.equal(conferirEscrita(d, relido).ok, true);
});

test("conferirEscrita acusa duvidoso quando o servidor não gravou o que foi pedido", () => {
  const pedido = { workflowData: { templates: [{ id: "s1", type: "sms", attributes: { message: "novo" } }] } } as unknown as Documento;
  const relido = { workflowData: { templates: [{ id: "s1", type: "sms", attributes: { message: "velho" } }] } } as unknown as Documento;
  const r = conferirEscrita(pedido, relido);
  assert.equal(r.ok, false);
  assert.deepEqual(r.residual.stepsAlterados[0].campos, ["attributes.message"]);
});

// I1: a janela entre prévia e gravação, que são dois processos.
test("--versao-esperada aborta quando o workflow mudou entre prévia e gravação", () => {
  assert.throws(() => conferirVersaoEsperada({ versaoEsperada: "5" }, 6), /mudou entre a prévia e a gravação/);
  conferirVersaoEsperada({ versaoEsperada: "5" }, 5);
  conferirVersaoEsperada({}, 99);
});
