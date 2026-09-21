import { test } from "node:test";
import assert from "node:assert/strict";
import {
  trocarReferencia, trocarTag, removerStepsInalcancaveis, alterarAtributo,
  renomear, montarCorpo, checarPublicavel, diffWorkflow, type Documento,
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

test("trocarReferencia avisa que o rótulo humano continua o antigo", () => {
  const d = doc([
    { id: "s1", type: "update_contact_field", attributes: {
      fields: [{ field: ID_VELHO, value: "Olá", title: "Mensagem recente " }] } },
  ]);
  const r = trocarReferencia(d, ID_VELHO, ID_NOVO);
  assert.equal(r.avisos?.length, 1);
  assert.match(r.avisos![0], /Mensagem recente/);
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

// O campo real do documento do GHL é `parentKey`; `parent` NÃO existe em step nenhum.
// Com `parent` todo step virava raiz e a limpeza nunca removia nada (prova ao vivo, Task 8).
test("removerStepsInalcancaveis tira o bloco órfão e preserva o fluxo vivo", () => {
  const d = doc([
    { id: "a", type: "wait", next: "b" },            // entrada (sem parentKey)
    { id: "b", type: "sms", parentKey: "a", next: null },
    { id: "orf1", type: "sms", parentKey: "x", next: "orf2" },
    { id: "orf2", type: "sms", parentKey: "orf1" },
  ]);
  const r = removerStepsInalcancaveis(d);
  assert.deepEqual(r.mudancas.sort(), ["orf1", "orf2"]);
  assert.deepEqual(r.doc.workflowData.templates.map((s) => s.id), ["a", "b"]);
});

test("removerStepsInalcancaveis usa parentKey: com `parent` (campo que não existe) tudo vira raiz", () => {
  const comCampoErrado = doc([
    { id: "a", type: "wait", next: "b" },
    { id: "b", type: "sms", parent: "a" },
    { id: "orf", type: "sms", parent: "x" },   // órfão SÓ se o campo lido fosse `parent`
  ]);
  // sem `parentKey` nenhum step tem pai: todos são entrada, nada é inalcançável
  assert.deepEqual(removerStepsInalcancaveis(comCampoErrado).mudancas, []);
});

test("removerStepsInalcancaveis segue goto ao decidir o que é alcançável", () => {
  const d = doc([
    { id: "a", type: "goto", next: null, attributes: { targetNodeId: "z" } },
    { id: "z", type: "sms", parentKey: "q" },
  ]);
  assert.deepEqual(removerStepsInalcancaveis(d).mudancas, []);
});

test("removerStepsInalcancaveis não faz nada em workflow sem entrada identificável", () => {
  const d = doc([{ id: "a", type: "sms", parentKey: "sumiu" }]);
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

test("renomear apara espaço nas pontas e recusa nome vazio", () => {
  const d = doc([]);
  assert.equal(renomear(d, "  Novo  ").doc.name, "Novo");
  assert.throws(() => renomear(d, "   "), /vazio/);
});

test("montarCorpo parte do documento editado e calcula as três listas de steps", () => {
  const antes = doc([
    { id: "a", type: "wait", attributes: { dias: 2 } },
    { id: "b", type: "sms", attributes: {} },
  ]);
  const depois = doc([
    { id: "a", type: "wait", attributes: { dias: 5 } },
    { id: "c", type: "sms", attributes: {} },
  ]);
  const corpo = montarCorpo(antes, depois, "U1");
  assert.deepEqual(corpo.createdSteps, ["c"]);
  assert.deepEqual(corpo.modifiedSteps, ["a"]);
  assert.deepEqual(corpo.deletedSteps, ["b"]);
  assert.equal(corpo.updatedBy, "U1");
  assert.equal(corpo.name, "Fluxo");
});

test("montarCorpo não inventa campo que a leitura não trouxe", () => {
  const d = doc([]);
  const corpo = montarCorpo(d, d, "U1");
  for (const proibido of ["paused", "workflowType", "templateId", "location_id"]) {
    assert.equal(proibido in corpo, false, `${proibido} não deveria ser inventado`);
  }
});

test("checarPublicavel acusa workflow sem nenhuma ação", () => {
  assert.deepEqual(
    checarPublicavel(doc([])),
    ["o workflow ficaria sem nenhuma ação, e o app recusa salvar workflow vazio"],
  );
});

test("checarPublicavel acusa goto apontando para step que não existe", () => {
  const d = doc([{ id: "a", type: "goto", attributes: { targetNodeId: "sumiu" } }]);
  assert.match(checarPublicavel(d)[0], /goto.*sumiu/);
});

test("checarPublicavel aprova workflow são", () => {
  assert.deepEqual(checarPublicavel(doc([{ id: "a", type: "sms", attributes: {} }])), []);
});

test("diffWorkflow separa step somado, removido e alterado, e mostra o campo", () => {
  const antes = doc([
    { id: "a", type: "wait", name: "Espera", attributes: { dias: 2 } },
    { id: "b", type: "sms", name: "Aviso", attributes: {} },
  ], [{ id: "t1", name: "Form" }]);
  const depois = doc([
    { id: "a", type: "wait", name: "Espera", attributes: { dias: 5 } },
    { id: "c", type: "sms", name: "Novo", attributes: {} },
  ], []);
  const d = diffWorkflow(antes, depois);
  assert.deepEqual(d.stepsAdicionados, [{ id: "c", nome: "Novo", tipo: "sms" }]);
  assert.deepEqual(d.stepsRemovidos, [{ id: "b", nome: "Aviso", tipo: "sms" }]);
  assert.equal(d.stepsAlterados.length, 1);
  assert.equal(d.stepsAlterados[0].id, "a");
  assert.deepEqual(d.stepsAlterados[0].campos, ["attributes.dias"]);
  assert.deepEqual(d.triggersRemovidos, [{ id: "t1", nome: "Form" }]);
  assert.equal(d.vazio, false);
});

test("diffWorkflow marca vazio quando nada mudou", () => {
  const d = doc([{ id: "a", type: "sms", attributes: {} }]);
  assert.equal(diffWorkflow(d, d).vazio, true);
});
