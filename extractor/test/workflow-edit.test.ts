import { test } from "node:test";
import assert from "node:assert/strict";
import {
  trocarReferencia, trocarTag, removerStepsInalcancaveis, alterarAtributo,
  editarTriggers, renomear, type Documento,
} from "../src/api/workflow-edit.js";

function doc(steps: unknown[], triggers: unknown[] = []): Documento {
  return {
    _id: "WF1", name: "Fluxo", status: "draft", version: 3,
    workflowData: { templates: steps },
    triggersData: triggers,
  } as unknown as Documento;
}

const ID_VELHO = "AkbAIoxcORSn9CELCijZ";
const ID_NOVO = "ZZnovoCampo000000001";

test("trocarReferencia troca o id em qualquer profundidade e conta as trocas", () => {
  const d = doc([
    { id: "s1", type: "update_contact_field", next: null,
      attributes: { fields: [{ id: ID_VELHO, value: "x" }] } },
    { id: "s2", type: "webhook", attributes: { url: "https://x/" + ID_VELHO } },
  ]);
  const r = trocarReferencia(d, ID_VELHO, ID_NOVO);
  assert.equal(r.mudancas.length, 2);
  assert.equal(r.doc.workflowData.templates[0].attributes.fields[0].id, ID_NOVO);
  assert.equal(r.doc.workflowData.templates[1].attributes.url, "https://x/" + ID_NOVO);
});

test("trocarReferencia não muta o documento original", () => {
  const d = doc([{ id: "s1", type: "x", attributes: { campo: ID_VELHO } }]);
  trocarReferencia(d, ID_VELHO, ID_NOVO);
  assert.equal(d.workflowData.templates[0].attributes.campo, ID_VELHO);
});

test("trocarReferencia devolve zero mudanças quando o id não aparece", () => {
  const d = doc([{ id: "s1", type: "x", attributes: {} }]);
  assert.equal(trocarReferencia(d, ID_VELHO, ID_NOVO).mudancas.length, 0);
});

test("trocarTag só mexe nos campos onde tag mora, nunca no texto de mensagem", () => {
  const d = doc([
    { id: "s1", type: "add_contact_tag", attributes: { tags: ["quente", "frio"] } },
    { id: "s2", type: "sms", attributes: { message: "você está quente" } },
    { id: "s3", type: "if_else", attributes: { branches: [{ segments: [{ conditions: [
      { conditionSubType: "tags", conditionValue: ["quente"] }] }] }] } },
  ]);
  const r = trocarTag(d, "quente", "morno");
  assert.deepEqual(r.doc.workflowData.templates[0].attributes.tags, ["morno", "frio"]);
  assert.equal(r.doc.workflowData.templates[1].attributes.message, "você está quente");
  assert.deepEqual(
    r.doc.workflowData.templates[2].attributes.branches[0].segments[0].conditions[0].conditionValue,
    ["morno"],
  );
  assert.equal(r.mudancas.length, 2);
});

test("trocarTag compara ignorando caixa e espaço nas pontas, como a auditoria", () => {
  const d = doc([{ id: "s1", type: "remove_contact_tag", attributes: { tags: [" Quente "] } }]);
  assert.deepEqual(trocarTag(d, "quente", "morno").doc.workflowData.templates[0].attributes.tags, ["morno"]);
});

test("removerStepsInalcancaveis tira o bloco órfão e preserva o fluxo vivo", () => {
  const d = doc([
    { id: "a", type: "wait", next: "b" },            // entrada (sem parent)
    { id: "b", type: "sms", parent: "a", next: null },
    { id: "orf1", type: "sms", parent: "x", next: "orf2" },
    { id: "orf2", type: "sms", parent: "orf1" },
  ]);
  const r = removerStepsInalcancaveis(d);
  assert.deepEqual(r.mudancas.sort(), ["orf1", "orf2"]);
  assert.deepEqual(r.doc.workflowData.templates.map((s) => s.id), ["a", "b"]);
});

test("removerStepsInalcancaveis segue goto ao decidir o que é alcançável", () => {
  const d = doc([
    { id: "a", type: "goto", next: null, attributes: { targetNodeId: "z" } },
    { id: "z", type: "sms", parent: "q" },
  ]);
  assert.deepEqual(removerStepsInalcancaveis(d).mudancas, []);
});

test("removerStepsInalcancaveis não faz nada em workflow sem entrada identificável", () => {
  const d = doc([{ id: "a", type: "sms", parent: "sumiu" }]);
  assert.deepEqual(removerStepsInalcancaveis(d).mudancas, []);
});

test("alterarAtributo escreve no caminho e recusa step inexistente", () => {
  const d = doc([{ id: "s1", type: "wait", attributes: { dias: 2 } }]);
  const r = alterarAtributo(d, "s1", "dias", 5);
  assert.equal(r.doc.workflowData.templates[0].attributes.dias, 5);
  assert.equal(r.mudancas.length, 1);
  assert.throws(() => alterarAtributo(d, "naoexiste", "dias", 5), /naoexiste/);
});

test("alterarAtributo aceita caminho aninhado com ponto", () => {
  const d = doc([{ id: "s1", type: "x", attributes: { alvo: { interno: 1 } } }]);
  assert.equal(alterarAtributo(d, "s1", "alvo.interno", 9).doc.workflowData.templates[0].attributes.alvo.interno, 9);
});

test("editarTriggers adiciona, remove e substitui", () => {
  const d = doc([], [{ id: "t1", name: "Form" }, { id: "t2", name: "Tag" }]);
  assert.equal(editarTriggers(d, { acao: "remover", id: "t1" }).doc.triggersData.length, 1);
  assert.equal(editarTriggers(d, { acao: "adicionar", trigger: { id: "t3" } }).doc.triggersData.length, 3);
  const sub = editarTriggers(d, { acao: "substituir", id: "t2", trigger: { id: "t2", name: "Outro" } });
  assert.equal(sub.doc.triggersData[1].name, "Outro");
  assert.throws(() => editarTriggers(d, { acao: "remover", id: "nao" }), /nao/);
});

test("renomear apara espaço nas pontas e recusa nome vazio", () => {
  const d = doc([]);
  assert.equal(renomear(d, "  Novo  ").doc.name, "Novo");
  assert.throws(() => renomear(d, "   "), /vazio/);
});
