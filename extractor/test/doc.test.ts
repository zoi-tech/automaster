import { test } from "node:test";
import assert from "node:assert/strict";
import { aplicar, ehSurvey, listasDeCampos, type Doc } from "../src/forms/doc.js";

const campo = (tag: string, label = tag) => ({ tag, label, type: "text", standard: true, required: false });
const botao = () => ({ tag: "button", type: "submit", label: "Enviar" });

const form = (): Doc => ({ form: { fields: [campo("full_name", "Nome"), campo("email", "E-mail"), botao()] } });
const survey = (): Doc => ({
  form: {},
  slides: [
    { id: "s1", slideName: "Slide 1", button: {}, slideData: [campo("full_name", "Nome")] },
    { id: "s2", slideName: "Slide 2", button: {}, slideData: [campo("email", "E-mail")] },
  ],
});

test("reconhece survey pelo slides", () => {
  assert.equal(ehSurvey(survey()), true);
  assert.equal(ehSurvey(form()), false);
});

test("lista de campos do formulário é uma só, sem slide", () => {
  const l = listasDeCampos(form());
  assert.equal(l.length, 1);
  assert.equal(l[0].slideId, undefined);
  assert.equal(l[0].campos.length, 3);
});

test("lista de campos do survey é uma por slide", () => {
  const l = listasDeCampos(survey());
  assert.deepEqual(l.map((x) => x.slideId), ["s1", "s2"]);
});

test("adicionar campo entra no fim da lista, antes do botão", () => {
  const d = aplicar(form(), [{ op: "adicionar-campo", campo: campo("phone", "Telefone") }]);
  assert.deepEqual(d.form.fields.map((f: any) => f.tag), ["full_name", "email", "phone", "button"]);
});

test("adicionar campo em survey exige slide existente", () => {
  assert.throws(
    () => aplicar(survey(), [{ op: "adicionar-campo", campo: campo("phone"), slide: "naoexiste" }]),
    /slide naoexiste não existe/,
  );
});

test("adicionar campo em survey sem slide vai para o último", () => {
  const d = aplicar(survey(), [{ op: "adicionar-campo", campo: campo("phone") }]);
  assert.deepEqual(d.slides[1].slideData.map((f: any) => f.tag), ["email", "phone"]);
});

test("remover campo por tag", () => {
  const d = aplicar(form(), [{ op: "remover-campo", alvo: "email" }]);
  assert.deepEqual(d.form.fields.map((f: any) => f.tag), ["full_name", "button"]);
});

test("remover campo inexistente é erro, não silêncio", () => {
  assert.throws(() => aplicar(form(), [{ op: "remover-campo", alvo: "cep" }]), /cep não existe/);
});

test("remover o botão de envio é recusado sem permissão explícita", () => {
  assert.throws(() => aplicar(form(), [{ op: "remover-campo", alvo: "button" }]), /sem botão de envio/);
});

test("remover o botão passa com permitirSemBotao", () => {
  const d = aplicar(form(), [{ op: "remover-campo", alvo: "button" }], { permitirSemBotao: true });
  assert.deepEqual(d.form.fields.map((f: any) => f.tag), ["full_name", "email"]);
});

test("esvaziar o documento é recusado", () => {
  assert.throws(() => aplicar(form(), [
    { op: "remover-campo", alvo: "full_name" },
    { op: "remover-campo", alvo: "email" },
  ]), /sem nenhum campo/);
});

test("renomear troca o label e mantém a tag", () => {
  const d = aplicar(form(), [{ op: "renomear-campo", alvo: "email", label: "Seu melhor e-mail" }]);
  assert.equal(d.form.fields[1].label, "Seu melhor e-mail");
  assert.equal(d.form.fields[1].tag, "email");
});

test("reordenar põe os nomeados na ordem dada e preserva o resto", () => {
  const d = aplicar(form(), [{ op: "reordenar-campos", ordem: ["email", "full_name"] }]);
  assert.deepEqual(d.form.fields.map((f: any) => f.tag), ["email", "full_name", "button"]);
});

test("criar slide entra no fim e ganha id único", () => {
  const d = aplicar(survey(), [{ op: "criar-slide", nome: "Slide 3" }]);
  assert.equal(d.slides.length, 3);
  assert.equal(d.slides[2].slideName, "Slide 3");
  assert.equal(new Set(d.slides.map((s: any) => s.id)).size, 3);
  assert.deepEqual(d.slides[2].slideData, []);
});

test("criar slide em formulário é erro", () => {
  assert.throws(() => aplicar(form(), [{ op: "criar-slide", nome: "x" }]), /só existe em survey/);
});

test("remover o último slide é recusado", () => {
  const d = aplicar(survey(), [{ op: "remover-slide", alvo: "s2" }]);
  assert.equal(d.slides.length, 1);
  assert.throws(() => aplicar(d, [{ op: "remover-slide", alvo: "s1" }]), /sem nenhum slide/);
});

test("mover campo entre slides", () => {
  const d = aplicar(survey(), [{ op: "mover-campo", alvo: "full_name", paraSlide: "s2" }]);
  assert.deepEqual(d.slides[0].slideData, []);
  assert.deepEqual(d.slides[1].slideData.map((f: any) => f.tag), ["email", "full_name"]);
});

test("reordenar slides", () => {
  const d = aplicar(survey(), [{ op: "reordenar-slides", ordem: ["s2", "s1"] }]);
  assert.deepEqual(d.slides.map((s: any) => s.id), ["s2", "s1"]);
});

test("renomear slide", () => {
  const d = aplicar(survey(), [{ op: "renomear-slide", alvo: "s1", nome: "Dados" }]);
  assert.equal(d.slides[0].slideName, "Dados");
});

test("definir valores de navegação", () => {
  const d = aplicar(survey(), [{ op: "definir", caminho: "form.isProgressBarEnabled", valor: true }]);
  assert.equal(d.form.isProgressBarEnabled, true);
});

test("definir recusa fieldCSS", () => {
  assert.throws(
    () => aplicar(form(), [{ op: "definir", caminho: "form.fieldCSS", valor: "a{}" }]),
    /gerado pelo builder/,
  );
});

test("definir recusa fieldCSS e mobileFieldCSS, na raiz e sob form", () => {
  for (const caminho of ["fieldCSS", "mobileFieldCSS", "form.fieldCSS", "form.mobileFieldCSS"]) {
    assert.throws(
      () => aplicar(form(), [{ op: "definir", caminho, valor: "a{}" }]),
      /gerado pelo builder/,
      `esperava recusa para ${caminho}`,
    );
  }
});

test("aplicar não muda o documento de entrada", () => {
  const d0 = form();
  aplicar(d0, [{ op: "remover-campo", alvo: "email" }]);
  assert.equal(d0.form.fields.length, 3);
});

test("campo que o motor não entende sobrevive intacto", () => {
  const d0 = form();
  d0.form.fields.push({ tag: "coisa_nova_do_ghl", propriedadeDesconhecida: 42 });
  const d = aplicar(d0, [{ op: "renomear-campo", alvo: "email", label: "x" }]);
  assert.deepEqual(d.form.fields.at(-1), { tag: "coisa_nova_do_ghl", propriedadeDesconhecida: 42 });
});

test("validar botão de envio não roda em survey", () => {
  assert.doesNotThrow(() => aplicar(survey(), [{ op: "renomear-slide", alvo: "s1", nome: "Dados" }]));
});

test("aplicar não muda objetos aninhados do documento de entrada (imutabilidade profunda)", () => {
  const d0 = form();
  const labelOriginal = d0.form.fields[1].label;
  aplicar(d0, [{ op: "renomear-campo", alvo: "email", label: "outro label" }]);
  assert.equal(d0.form.fields[1].label, labelOriginal);

  const d1 = form();
  aplicar(d1, [{ op: "definir", caminho: "form.fieldStyle.fontColor", valor: "#000000" }]);
  assert.equal(d1.form.fieldStyle, undefined);

  const d2 = survey();
  const nomeOriginal = d2.slides[0].slideName;
  aplicar(d2, [{ op: "renomear-slide", alvo: "s1", nome: "outro nome" }]);
  assert.equal(d2.slides[0].slideName, nomeOriginal);
});

test("criar slide copia o button do slide anterior, não a referência", () => {
  const s = survey();
  s.slides[1].button = { background: "#fff", color: "#000", border: "1px" };
  const d = aplicar(s, [{ op: "criar-slide", nome: "Slide 3" }]);
  assert.deepEqual(d.slides[2].button, { background: "#fff", color: "#000", border: "1px" });
  d.slides[2].button.background = "#123";
  assert.equal(d.slides[1].button.background, "#fff");
});

test("definir-logica grava as regras em form.conditionalLogic", () => {
  const regras = [
    {
      conditionalOperation: "then",
      conditions: [{ selectedField: "full_name", selectedOperation: "isEqualTo", inputValue: "x" }],
      outcome: { jumpTarget: "s2", jumpTargetType: "slide", type: "jumpTo", value: "" },
    },
  ];
  const d = aplicar(survey(), [{ op: "definir-logica", regras }]);
  assert.deepEqual(d.form.conditionalLogic, regras);
});

test("definir-logica recusa regra apontando para slide inexistente", () => {
  const regras = [
    { conditionalOperation: "then", conditions: [], outcome: { jumpTarget: "naoexiste", jumpTargetType: "slide", type: "jumpTo", value: "" } },
  ];
  assert.throws(
    () => aplicar(survey(), [{ op: "definir-logica", regras }]),
    /slide naoexiste, que não existe/,
  );
});

test("definir-logica em formulário grava sem checar jumpTarget (sem slides p/ validar)", () => {
  const regras = [{ conditionalOperation: "then", conditions: [], outcome: { jumpTarget: "qualquer-coisa" } }];
  const d = aplicar(form(), [{ op: "definir-logica", regras }]);
  assert.deepEqual(d.form.conditionalLogic, regras);
});

test("remover slide destino de salto condicional é recusado", () => {
  const regras = [{
    conditionalOperation: "then",
    conditions: [{ selectedField: "full_name", selectedOperation: "isEqualTo", inputValue: "x" }],
    outcome: { jumpTarget: "s2", jumpTargetType: "slide", type: "jumpTo", value: "" },
  }];
  const d = aplicar(survey(), [{ op: "definir-logica", regras }]);
  assert.throws(
    () => aplicar(d, [{ op: "remover-slide", alvo: "s2" }]),
    /slide s2 é o destino de uma regra de lógica condicional/,
  );
});

test("remover campo usado numa condição é recusado", () => {
  const regras = [{
    conditionalOperation: "then",
    conditions: [{ selectedField: "full_name", selectedOperation: "isEqualTo", inputValue: "x" }],
    outcome: { jumpTarget: "s2", jumpTargetType: "slide", type: "jumpTo", value: "" },
  }];
  const d = aplicar(survey(), [{ op: "definir-logica", regras }]);
  assert.throws(
    () => aplicar(d, [{ op: "remover-campo", alvo: "full_name" }]),
    /campo full_name é usado numa condição de lógica condicional/,
  );
});

test("adicionar campo com posicao explícita entra exatamente ali", () => {
  const d = aplicar(form(), [{ op: "adicionar-campo", campo: campo("phone", "Telefone"), posicao: 0 }]);
  assert.deepEqual(d.form.fields.map((f: any) => f.tag), ["phone", "full_name", "email", "button"]);
});

test("reordenar campos em survey sem slide vai para o último, igual adicionar-campo", () => {
  const s = survey();
  s.slides[1].slideData.push(campo("phone", "Telefone"));
  const d = aplicar(s, [{ op: "reordenar-campos", ordem: ["phone", "email"] }]);
  assert.deepEqual(d.slides[1].slideData.map((f: any) => f.tag), ["phone", "email"]);
  assert.deepEqual(d.slides[0].slideData.map((f: any) => f.tag), ["full_name"]);
});

test("reordenar campos em survey com slide explícito respeita o slide pedido", () => {
  const d = aplicar(survey(), [{ op: "reordenar-campos", ordem: ["full_name"], slide: "s1" }]);
  assert.deepEqual(d.slides[0].slideData.map((f: any) => f.tag), ["full_name"]);
});

test("definir recusa caminho que desce dentro de fieldCSS", () => {
  assert.throws(
    () => aplicar(form(), [{ op: "definir", caminho: "form.fieldCSS.algo", valor: "x" }]),
    /gerado pelo builder/,
  );
});

test("op desconhecido estoura, não é ignorado em silêncio", () => {
  assert.throws(
    () => aplicar(form(), [{ op: "renomear-cmpo", alvo: "email", label: "x" } as any]),
    /operação desconhecida: "renomear-cmpo"/,
  );
});
