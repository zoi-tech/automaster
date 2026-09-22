import { test } from "node:test";
import assert from "node:assert/strict";
import {
  trocarReferencia, trocarTag, removerStepsInalcancaveis, alterarAtributo,
  renomear, montarCorpo, checarPublicavel, diffWorkflow, type Documento,
  criarStep, removerStep, moverStep, conferirTriggersEsperados,
} from "../src/api/workflow-edit.js";

function doc(steps: unknown[], triggers: unknown[] = []): Documento {
  return {
    _id: "WF1", name: "Fluxo", status: "draft", version: 3,
    workflowData: { templates: steps },
    triggersData: triggers,
  } as unknown as Documento;
}

/** `attributes` é opcional em `Step`; nos steps de teste ele sempre existe. */
const attrs = (d: Documento, i: number): any => d.workflowData.templates[i]!.attributes;

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
  assert.equal(attrs(r.doc, 0).fields[0].id, ID_NOVO);
  assert.equal(attrs(r.doc, 1).url, "https://x/" + ID_NOVO);
});

test("trocarReferencia não muta o documento original", () => {
  const d = doc([{ id: "s1", type: "x", attributes: { campo: ID_VELHO } }]);
  trocarReferencia(d, ID_VELHO, ID_NOVO);
  assert.equal(attrs(d, 0).campo, ID_VELHO);
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
  assert.deepEqual(attrs(r.doc, 0).tags, ["morno", "frio"]);
  assert.equal(attrs(r.doc, 1).message, "você está quente");
  assert.deepEqual(
    attrs(r.doc, 2).branches[0].segments[0].conditions[0].conditionValue,
    ["morno"],
  );
  assert.equal(r.mudancas.length, 2);
});

test("trocarTag compara ignorando caixa e espaço nas pontas, como a auditoria", () => {
  const d = doc([{ id: "s1", type: "remove_contact_tag", attributes: { tags: [" Quente "] } }]);
  assert.deepEqual(attrs(trocarTag(d, "quente", "morno").doc, 0).tags, ["morno"]);
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
  assert.equal(attrs(r.doc, 0).dias, 5);
  assert.equal(r.mudancas.length, 1);
  assert.throws(() => alterarAtributo(d, "naoexiste", "dias", 5), /naoexiste/);
});

test("alterarAtributo aceita caminho aninhado com ponto", () => {
  const d = doc([{ id: "s1", type: "x", attributes: { alvo: { interno: 1 } } }]);
  assert.equal(attrs(alterarAtributo(d, "s1", "alvo.interno", 9).doc, 0).alvo.interno, 9);
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

test("array com os mesmos itens em outra ordem sai marcado como reordenado", () => {
  // sem isso o diff dizia só "attributes.tags", que se lê como "as tags mudaram" —
  // quem revisa não tinha como saber que nada entrou nem saiu.
  const antes = doc([{ id: "a", type: "add_contact_tag", name: "Marca", attributes: { tags: ["x", "y"] } }]);
  const depois = doc([{ id: "a", type: "add_contact_tag", name: "Marca", attributes: { tags: ["y", "x"] } }]);
  assert.deepEqual(diffWorkflow(antes, depois).stepsAlterados[0].campos, ["attributes.tags (reordenado)"]);
});

test("array com item somado continua aparecendo como o campo alterado", () => {
  const antes = doc([{ id: "a", type: "add_contact_tag", name: "Marca", attributes: { tags: ["x"] } }]);
  const depois = doc([{ id: "a", type: "add_contact_tag", name: "Marca", attributes: { tags: ["x", "y"] } }]);
  assert.deepEqual(diffWorkflow(antes, depois).stepsAlterados[0].campos, ["attributes.tags"]);
});

test("diffWorkflow marca vazio quando nada mudou", () => {
  const d = doc([{ id: "a", type: "sms", attributes: {} }]);
  assert.equal(diffWorkflow(d, d).vazio, true);
});

test("limpar-orfaos lê o `parent` legado quando é o único campo de ancestralidade", () => {
  // O servidor grava `parentKey`, mas parte dos steps em disco só tem o `parent` antigo.
  // Lendo só `parentKey`, esses steps contariam como entrada do fluxo e nada seria órfão.
  const d = doc([
    { id: "a", type: "wait", attributes: {}, next: "b" },
    { id: "b", type: "sms", attributes: {}, parent: "a" },
    { id: "z", type: "sms", attributes: {}, parent: "a" },
  ]);
  assert.deepEqual(removerStepsInalcancaveis(d).mudancas, ["z"]);
});

// ---- steps do canvas (parte B) ----

/** a → b → c, encadeado por parentKey e next, como o servidor grava. */
const linha = () => doc([
  { id: "a", type: "wait", order: 0, attributes: {}, next: "b" },
  { id: "b", type: "sms", order: 1, attributes: {}, parentKey: "a", next: "c" },
  { id: "c", type: "add_contact_tag", order: 2, attributes: {}, parentKey: "b" },
]);

/** container if_else com dois ramos; o ramo "sim" leva a um corpo. */
const comRamos = () => doc([
  { id: "a", type: "wait", order: 0, attributes: {}, next: "cond" },
  { id: "cond", type: "if_else", nodeType: "condition-node", order: 1, parentKey: "a",
    next: ["sim", "nao"], attributes: { branches: [{ id: "sim", name: "Sim" }] } },
  { id: "sim", type: "if_else", nodeType: "branch-yes", order: 2, parentKey: "cond",
    sibling: ["nao"], next: "corpo", attributes: { if: false, branches: [] } },
  { id: "nao", type: "if_else", nodeType: "branch-no", order: 3, parentKey: "cond",
    sibling: ["sim"], attributes: { else: true } },
  { id: "corpo", type: "sms", order: 4, parentKey: "sim", attributes: {} },
]);

const acha = (d: Documento, id: string) => d.workflowData.templates.find((s: any) => s.id === id) as any;

test("criarStep costura o step novo entre a âncora e o que ela apontava", () => {
  const r = criarStep(linha(), { type: "webhook", name: "Avisa" }, "a");
  const novo = r.doc.workflowData.templates.find((s: any) => s.type === "webhook") as any;
  assert.equal(acha(r.doc, "a").next, novo.id);
  assert.equal(novo.parentKey, "a");
  assert.equal(novo.next, "b");
  assert.equal(acha(r.doc, "b").parentKey, novo.id);
  assert.equal(novo.order, 3);
});

test("criarStep no fim da linha não inventa next", () => {
  const r = criarStep(linha(), { type: "webhook" }, "c");
  const novo = r.doc.workflowData.templates.find((s: any) => s.type === "webhook") as any;
  assert.equal(acha(r.doc, "c").next, novo.id);
  assert.equal("next" in novo, false);
});

test("criarStep aceita ancorar num nó de ramo: é assim que se põe ação dentro do sim", () => {
  const r = criarStep(comRamos(), { type: "sms", name: "Dentro do sim" }, "sim");
  const novo = r.doc.workflowData.templates.find((s: any) => s.name === "Dentro do sim") as any;
  assert.equal(acha(r.doc, "sim").next, novo.id);
  assert.equal(novo.next, "corpo");
  assert.equal(acha(r.doc, "corpo").parentKey, novo.id);
});

test("criarStep recusa ancorar num container e diz em qual ramo ancorar", () => {
  assert.throws(() => criarStep(comRamos(), { type: "sms" }, "cond"), /ambíguo[\s\S]*sim, nao/);
});

test("criarStep ignora id/parentKey/next do corpo e avisa", () => {
  const r = criarStep(linha(), { type: "sms", id: "forjado", next: "z" }, "a");
  assert.equal(acha(r.doc, "forjado"), undefined);
  assert.match(r.avisos![0], /id, next/);
});

test("criarStep exige type no corpo", () => {
  assert.throws(() => criarStep(linha(), { name: "sem tipo" }, "a"), /precisa trazer `type`/);
});

test("criarStep não muta o documento original", () => {
  const d = linha();
  criarStep(d, { type: "sms" }, "a");
  assert.equal(d.workflowData.templates.length, 3);
  assert.equal(d.workflowData.templates[0].next, "b");
});

test("removerStep emenda o pai no filho do step que saiu", () => {
  const r = removerStep(linha(), "b");
  assert.deepEqual(r.mudancas, ["b"]);
  assert.equal(r.doc.workflowData.templates.length, 2);
  assert.equal(acha(r.doc, "a").next, "c");
  assert.equal(acha(r.doc, "c").parentKey, "a");
});

test("removerStep na raiz deixa o filho virar raiz", () => {
  const r = removerStep(linha(), "a");
  assert.equal("parentKey" in acha(r.doc, "b"), false);
  assert.equal("parent" in acha(r.doc, "b"), false);
});

test("removerStep no fim da linha tira o next do pai", () => {
  const r = removerStep(linha(), "c");
  assert.equal("next" in acha(r.doc, "b"), false);
});

test("removerStep recusa nó de ramo e manda remover o container", () => {
  assert.throws(() => removerStep(comRamos(), "sim"), /é um ramo[\s\S]*remova o container \(cond\)/);
});

test("removerStep recusa container sem --com-subarvore e conta o que sairia", () => {
  assert.throws(() => removerStep(comRamos(), "cond"), /tira também os 3 steps/);
});

test("removerStep com subárvore leva ramos e corpo, e o pai termina ali", () => {
  const r = removerStep(comRamos(), "cond", true);
  assert.deepEqual([...r.mudancas].sort(), ["cond", "corpo", "nao", "sim"]);
  assert.deepEqual(r.doc.workflowData.templates.map((s: any) => s.id), ["a"]);
  assert.equal("next" in acha(r.doc, "a"), false);
});

test("moverStep tira do lugar antigo e costura no novo", () => {
  const r = moverStep(linha(), "b", "c");
  assert.equal(acha(r.doc, "a").next, "c");
  assert.equal(acha(r.doc, "c").parentKey, "a");
  assert.equal(acha(r.doc, "c").next, "b");
  assert.equal(acha(r.doc, "b").parentKey, "c");
  assert.equal("next" in acha(r.doc, "b"), false);
  assert.equal(r.doc.workflowData.templates.length, 3);
});

test("moverStep recusa a âncora igual ao próprio step", () => {
  assert.throws(() => moverStep(linha(), "b", "b"), /mesmo step/);
});

test("moverStep recusa container e ramo", () => {
  assert.throws(() => moverStep(comRamos(), "cond", "a"), /container de N saídas/);
  assert.throws(() => moverStep(comRamos(), "sim", "a"), /ramo de container/);
});

// ---- primeiro step e containers (workflow do zero) ----

test("criarStep sem âncora põe o primeiro step de um workflow vazio", () => {
  const r = criarStep(doc([]), { type: "assign_user", name: "Atribui" });
  const [novo] = r.doc.workflowData.templates as any[];
  assert.equal(novo.type, "assign_user");
  assert.equal("parentKey" in novo, false);
  assert.equal("next" in novo, false);
  assert.match(r.mudancas[0], /no início do fluxo/);
});

test("criarStep sem âncora vira a nova entrada e empurra a antiga para baixo", () => {
  const r = criarStep(linha(), { type: "webhook" });
  const novo = r.doc.workflowData.templates.find((s: any) => s.type === "webhook") as any;
  assert.equal("parentKey" in novo, false);
  assert.equal(novo.next, "a");
  assert.equal(acha(r.doc, "a").parentKey, novo.id);
});

test("criarStep sem âncora recusa workflow com mais de uma entrada", () => {
  const d = doc([
    { id: "a", type: "sms", attributes: {} },
    { id: "b", type: "sms", attributes: {} },
  ]);
  assert.throws(() => criarStep(d, { type: "webhook" }), /2 entradas[\s\S]*--depois-de/);
});

test("criarStep com ramos monta o if_else de três camadas", () => {
  const r = criarStep(doc([]), { type: "if_else", name: "Tem tag?" }, undefined, [
    { name: "Sim", branch: { operator: "and", segments: [{ conditions: [] }] } },
    { name: "None", else: true },
  ]);
  const steps = r.doc.workflowData.templates as any[];
  const cont = steps.find((s) => s.name === "Tem tag?");
  const [sim, nao] = (cont.next as string[]).map((id) => steps.find((s) => s.id === id));
  assert.equal(cont.nodeType, "condition-node");
  assert.equal(cont.attributes.branches.length, 1);
  // o id do ramo "sim" É a entrada em attributes.branches, como o servidor grava
  assert.equal(cont.attributes.branches[0].id, sim.id);
  assert.equal(cont.attributes.branches[0].operator, "and");
  assert.equal(sim.nodeType, "branch-yes");
  assert.deepEqual(sim.sibling, [nao.id]);
  assert.equal(nao.nodeType, "branch-no");
  assert.deepEqual(nao.attributes, { else: true });
  assert.equal(nao.parentKey, cont.id);
});

test("criarStep com ramos fora do if_else usa transition, sem branches nem sibling", () => {
  const r = criarStep(doc([]), { type: "workflow_split" }, undefined, [{ name: "A" }, { name: "B" }]);
  const steps = r.doc.workflowData.templates as any[];
  const cont = steps.find((s) => s.type === "workflow_split");
  const ramos = (cont.next as string[]).map((id) => steps.find((s) => s.id === id));
  assert.equal(cont.attributes.branches, undefined);
  assert.deepEqual(ramos.map((x: any) => x.type), ["transition", "transition"]);
  assert.equal(ramos[0].sibling, undefined);
  assert.deepEqual(ramos.map((x: any) => x.name), ["A", "B"]);
});

test("criarStep com ramos manda a cauda da âncora para o primeiro ramo, e avisa", () => {
  const r = criarStep(linha(), { type: "if_else" }, "a", [{ name: "Sim" }, { else: true }]);
  const steps = r.doc.workflowData.templates as any[];
  const cont = steps.find((s) => s.type === "if_else");
  const primeiro = steps.find((s) => s.id === (cont.next as string[])[0]);
  assert.equal(acha(r.doc, "a").next, cont.id);
  assert.equal(primeiro.next, "b");
  assert.equal(acha(r.doc, "b").parentKey, primeiro.id);
  assert.match(r.avisos!.join(" "), /foi para o primeiro ramo/);
});

test("criarStep recusa um ramo só e mais de um else", () => {
  assert.throws(() => criarStep(doc([]), { type: "if_else" }, undefined, [{ name: "Só" }]),
    /pelo menos 2 ramos/);
  assert.throws(() => criarStep(doc([]), { type: "if_else" }, undefined,
    [{ else: true }, { else: true }]), /só um ramo pode ser o `else`/);
  assert.throws(() => criarStep(doc([]), { type: "workflow_split" }, undefined,
    [{ name: "A" }, { else: true }]), /só existe em if_else/);
});

test("conferirTriggersEsperados aceita mesma lista em qualquer ordem e recusa lista mudada", () => {
  const agora = [{ id: "t2" }, { id: "t1" }];
  conferirTriggersEsperados({ triggersEsperados: "t1,t2" }, agora);
  conferirTriggersEsperados({}, agora); // sem a flag, não há o que conferir
  assert.throws(
    () => conferirTriggersEsperados({ triggersEsperados: "t1,t2,t3" }, agora),
    /lista de triggers mudou/,
  );
});

test("container if_else leva o nome do step para attributes.conditionName", () => {
  // O app rotula a caixa por `conditionName`; sem isso a condição sai como "Condition".
  const d = doc([]);
  const r = criarStep(d, { type: "if_else", name: "Tem a tag?" }, undefined, [{ name: "Tem" }, { else: true }]);
  const cont = r.doc.workflowData.templates.find((s: any) => s.nodeType === "condition-node") as any;
  assert.equal(cont.attributes.conditionName, "Tem a tag?");

  const d2 = doc([]);
  const r2 = criarStep(d2, { type: "if_else", name: "X", attributes: { conditionName: "Escolhido" } },
    undefined, [{ name: "a" }, { name: "b" }]);
  const c2 = r2.doc.workflowData.templates.find((s: any) => s.nodeType === "condition-node") as any;
  assert.equal(c2.attributes.conditionName, "Escolhido");
});
