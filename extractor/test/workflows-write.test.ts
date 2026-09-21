import { test } from "node:test";
import assert from "node:assert/strict";
import {
  criarWorkflow, duplicarWorkflow, renomearWorkflow, moverWorkflow, apagarWorkflow,
  salvarWorkflow, listarTriggers, apagarTrigger, historicoVersoes, versaoPorNumero,
} from "../src/api/workflows-write.js";

type Chamada = { metodo: string; url: string; corpo?: unknown };

function clienteFalso() {
  const chamadas: Chamada[] = [];
  const reg = (metodo: string) => (url: string, corpo?: unknown) => {
    chamadas.push({ metodo, url, corpo });
    return Promise.resolve({ ok: true });
  };
  return {
    chamadas,
    client: {
      getJson: reg("get"), putJson: reg("put"),
      postJson: reg("post"), deleteJson: reg("delete"),
    } as never,
  };
}

const LOC = "LOC1";
const WID = "WF1";

test("salvarWorkflow faz PUT no workflow, prefixo singular", async () => {
  const { client, chamadas } = clienteFalso();
  await salvarWorkflow(client, LOC, WID, { name: "x" });
  assert.deepEqual(chamadas[0], {
    metodo: "put",
    url: "https://backend.leadconnectorhq.com/workflow/LOC1/WF1",
    corpo: { name: "x" },
  });
});

// A lista de triggers NÃO vem no documento do workflow, e o `only-triggers` responde 200
// sem criar nada: a única escrita de trigger que funciona é este DELETE (prova ao vivo).
test("listarTriggers lê a lista autoritativa pela rota de trigger", async () => {
  const { client, chamadas } = clienteFalso();
  await listarTriggers(client, LOC, WID);
  assert.equal(chamadas[0].metodo, "get");
  assert.equal(chamadas[0].url, "https://backend.leadconnectorhq.com/workflow/LOC1/trigger?workflowId=WF1");
});

test("apagarTrigger faz DELETE no trigger com o workflowId na query", async () => {
  const { client, chamadas } = clienteFalso();
  await apagarTrigger(client, LOC, WID, "T1");
  assert.equal(chamadas[0].metodo, "delete");
  assert.equal(chamadas[0].url, "https://backend.leadconnectorhq.com/workflow/LOC1/trigger/T1?workflowId=WF1");
});

test("criarWorkflow faz POST na subconta com location_id no corpo", async () => {
  const { client, chamadas } = clienteFalso();
  await criarWorkflow(client, LOC, { name: "Novo" });
  assert.deepEqual(chamadas[0], {
    metodo: "post",
    url: "https://backend.leadconnectorhq.com/workflow/LOC1",
    corpo: { name: "Novo", location_id: "LOC1" },
  });
});

test("duplicarWorkflow é o POST de criação com workflow_id", async () => {
  const { client, chamadas } = clienteFalso();
  await duplicarWorkflow(client, LOC, { workflowId: WID, novoNome: "Cópia", parentId: "P1" });
  assert.equal(chamadas[0].metodo, "post");
  assert.equal(chamadas[0].url, "https://backend.leadconnectorhq.com/workflow/LOC1");
  assert.deepEqual(chamadas[0].corpo, {
    new_workflow_name: "Cópia", workflow_id: "WF1", parentId: "P1", location_id: "LOC1",
  });
});

test("duplicarWorkflow manda parentId null quando não vem pasta", async () => {
  const { client, chamadas } = clienteFalso();
  await duplicarWorkflow(client, LOC, { workflowId: WID, novoNome: "Cópia" });
  assert.equal((chamadas[0].corpo as { parentId: unknown }).parentId, null);
});

test("renomearWorkflow e moverWorkflow usam as rotas dedicadas", async () => {
  const { client, chamadas } = clienteFalso();
  await renomearWorkflow(client, LOC, WID, "Nome novo");
  await moverWorkflow(client, LOC, WID, "P2");
  assert.equal(chamadas[0].url, "https://backend.leadconnectorhq.com/workflow/LOC1/rename-workflow/WF1");
  assert.deepEqual(chamadas[0].corpo, { name: "Nome novo" });
  assert.equal(chamadas[1].url, "https://backend.leadconnectorhq.com/workflow/LOC1/move-directory/WF1");
  assert.deepEqual(chamadas[1].corpo, { parentId: "P2" });
});

test("apagarWorkflow manda o userId na query", async () => {
  const { client, chamadas } = clienteFalso();
  await apagarWorkflow(client, LOC, WID, "U1");
  assert.equal(chamadas[0].metodo, "delete");
  assert.equal(chamadas[0].url, "https://backend.leadconnectorhq.com/workflow/LOC1/WF1?userId=U1");
});

test("histórico de versões: lista e por número", async () => {
  const { client, chamadas } = clienteFalso();
  await historicoVersoes(client, LOC, WID);
  await versaoPorNumero(client, LOC, WID, 7);
  assert.equal(chamadas[0].url, "https://backend.leadconnectorhq.com/workflow/LOC1/WF1/history");
  assert.equal(chamadas[1].url, "https://backend.leadconnectorhq.com/workflow/LOC1/WF1/history-by-number/7");
});
