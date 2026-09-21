import { test } from "node:test";
import assert from "node:assert/strict";
import {
  criarWorkflow, duplicarWorkflow, renomearWorkflow, moverWorkflow, apagarWorkflow,
  salvarWorkflow, listarTriggers, apagarTrigger, historicoVersoes, versaoPorNumero,
  criarTrigger, nascerVisivel, urlEditor, listarPastas,
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

// --- os cinco aprendizados da montagem ao vivo de 2026-09-21 ---

// O falso positivo mais caro desta API: com `workflow_id` (snake, que é como a LEITURA
// devolve o campo) o POST responde 200 com id e o trigger nasce órfão, invisível para
// sempre. `workflowId` camelCase é o que grava.
test("criarTrigger manda workflowId em camelCase e nunca workflow_id na raiz", async () => {
  const { client, chamadas } = clienteFalso();
  await criarTrigger(client, LOC, WID, {
    id: "velho", workflow_id: "OUTRO", location_id: "OUTRA", type: "appointment", conditions: [],
  });
  const c = chamadas[0];
  assert.equal(c.metodo, "post");
  assert.equal(c.url, "https://backend.leadconnectorhq.com/workflow/LOC1/trigger");
  const corpo = c.corpo as Record<string, unknown>;
  assert.equal(corpo.workflowId, WID);
  assert.ok(!("workflow_id" in corpo), "workflow_id na raiz faz o trigger nascer órfão");
  assert.ok(!("id" in corpo), "id de outro trigger não pode vazar para a criação");
  assert.equal(corpo.location_id, LOC, "location_id vem da subconta, não do corpo recebido");
  assert.deepEqual(corpo.actions, [{ workflow_id: WID, type: "add_to_workflow" }]);
});

test("criarTrigger reaponta as actions recebidas para o workflow certo", async () => {
  const { client, chamadas } = clienteFalso();
  await criarTrigger(client, LOC, WID, {
    type: "appointment", actions: [{ workflow_id: "OUTRO", type: "add_to_workflow" }],
  });
  assert.deepEqual((chamadas[0].corpo as any).actions, [{ workflow_id: WID, type: "add_to_workflow" }]);
});

// A URL do editor é `workflow` no SINGULAR; com o plural (rota da lista) o app devolve 404
// e a página fica branca, inclusive em workflow publicado e íntegro.
test("urlEditor usa workflow no singular", () => {
  assert.equal(urlEditor(LOC, WID), "https://app.gohighlevel.com/v2/location/LOC1/automation/workflow/WF1");
});

test("listarPastas devolve só os diretórios da raiz", async () => {
  const chamadas: Chamada[] = [];
  const client = {
    getJson: (url: string) => {
      chamadas.push({ metodo: "get", url });
      return Promise.resolve({ rows: [
        { id: "d1", name: "Vendas", type: "directory" },
        { id: "w1", name: "um workflow", type: "workflow" },
      ] });
    },
  } as never;
  assert.deepEqual(await listarPastas(client, LOC), [{ id: "d1", name: "Vendas" }]);
  assert.ok(chamadas[0].url.includes("/list?parentId=root"));
});

// Workflow recém-criado nasce sem `status` e fora de pasta: a API o lista e a interface
// não o mostra, com o editor em branco.
test("nascerVisivel move para a pasta e grava status draft", async () => {
  const chamadas: Chamada[] = [];
  let doc: Record<string, unknown> = { id: WID, parentId: "", name: "novo" };
  const client = {
    getJson: (url: string) => { chamadas.push({ metodo: "get", url }); return Promise.resolve({ ...doc }); },
    putJson: (url: string, corpo?: unknown) => {
      chamadas.push({ metodo: "put", url, corpo });
      if (url.includes("move-directory")) doc = { ...doc, parentId: (corpo as any).parentId };
      else doc = { ...doc, status: (corpo as any).status };
      return Promise.resolve({ ok: true });
    },
  } as never;
  const fim = await nascerVisivel(client, LOC, WID, "PASTA1", "U1");
  assert.deepEqual(fim, { parentId: "PASTA1", status: "draft" });
  assert.ok(chamadas.some((c) => c.url.includes("move-directory")));
  const save = chamadas.find((c) => c.metodo === "put" && !c.url.includes("move-directory"));
  assert.equal((save!.corpo as any).status, "draft");
  assert.equal((save!.corpo as any).updatedBy, "U1");
});

test("nascerVisivel não mexe no que já está inteiro", async () => {
  const chamadas: Chamada[] = [];
  const client = {
    getJson: (url: string) => { chamadas.push({ metodo: "get", url }); return Promise.resolve({ parentId: "PASTA1", status: "published" }); },
    putJson: (url: string) => { chamadas.push({ metodo: "put", url }); return Promise.resolve({}); },
  } as never;
  const fim = await nascerVisivel(client, LOC, WID, "PASTA1", "U1");
  assert.deepEqual(fim, { parentId: "PASTA1", status: "published" });
  assert.equal(chamadas.filter((c) => c.metodo === "put").length, 0);
});
