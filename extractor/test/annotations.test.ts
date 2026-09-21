import { test } from "node:test";
import assert from "node:assert/strict";
import { listar, criar, editar, apagar, concluir, buscarTarefas, deuCerto } from "../src/api/annotations.js";

interface Chamada { metodo: string; url: string; corpo?: unknown }

function clienteFalso(resposta: unknown = { ok: true }) {
  const chamadas: Chamada[] = [];
  const reg = (metodo: string) => (url: string, corpo?: unknown) => {
    chamadas.push({ metodo, url, corpo });
    return Promise.resolve(resposta);
  };
  return {
    chamadas,
    client: { getJson: reg("get"), putJson: reg("put"), postJson: reg("post"), deleteJson: reg("delete") } as never,
  };
}

const BASE = "https://services.leadconnectorhq.com";

test("listar usa /notes para nota e /tasks para tarefa", async () => {
  const a = clienteFalso();
  await listar(a.client, "nota", "C1");
  await listar(a.client, "tarefa", "C1");
  assert.deepEqual(a.chamadas.map((c) => c.url), [
    `${BASE}/contacts/C1/notes`,
    `${BASE}/contacts/C1/tasks`,
  ]);
  assert.deepEqual(a.chamadas.map((c) => c.metodo), ["get", "get"]);
});

test("criar tarefa manda o corpo como recebeu, sem inventar campo", async () => {
  const a = clienteFalso();
  await criar(a.client, "tarefa", "C1", { title: "T", dueDate: "2026-10-01T10:00:00Z", completed: false });
  assert.equal(a.chamadas[0].metodo, "post");
  assert.equal(a.chamadas[0].url, `${BASE}/contacts/C1/tasks`);
  assert.deepEqual(a.chamadas[0].corpo, { title: "T", dueDate: "2026-10-01T10:00:00Z", completed: false });
});

test("editar e apagar apontam para o id", async () => {
  const a = clienteFalso();
  await editar(a.client, "nota", "C1", "N1", { body: "x" });
  await apagar(a.client, "nota", "C1", "N1");
  assert.deepEqual(a.chamadas.map((c) => `${c.metodo} ${c.url}`), [
    `put ${BASE}/contacts/C1/notes/N1`,
    `delete ${BASE}/contacts/C1/notes/N1`,
  ]);
});

test("concluir usa a rota dedicada", async () => {
  const a = clienteFalso();
  await concluir(a.client, "C1", "T1", true);
  assert.equal(a.chamadas[0].url, `${BASE}/contacts/C1/tasks/T1/completed`);
  assert.deepEqual(a.chamadas[0].corpo, { completed: true });
});

test("buscarTarefas manda só os filtros preenchidos", async () => {
  const a = clienteFalso();
  await buscarTarefas(a.client, "L1", { completed: false, limit: 50 });
  assert.equal(a.chamadas[0].metodo, "post");
  assert.equal(a.chamadas[0].url, `${BASE}/locations/L1/tasks/search`);
  assert.deepEqual(a.chamadas[0].corpo, { completed: false, limit: 50 });
});

test("deuCerto aceita as duas grafias do servidor", () => {
  assert.equal(deuCerto({ succeeded: true }), true);
  assert.equal(deuCerto({ succeded: true }), true);
  assert.equal(deuCerto({ succeeded: false, succeded: false }), false);
  assert.equal(deuCerto({}), false);
});
