import { test } from "node:test";
import assert from "node:assert/strict";
import { cor, opsDeEstilo, paletaDeTokens, type Tokens } from "../src/forms/style.js";
import { diferenca } from "../src/forms/diff.js";
import { aplicar, type Doc } from "../src/forms/doc.js";

const tokens: Tokens = {
  corPrimaria: "#0f62fe",
  corTexto: "#161616",
  corFundo: "#ffffff",
  corBorda: "#8d8d8d",
  corErro: "#da1e28",
  fonte: "IBM Plex Sans",
  tamanhoRotulo: 14,
  pesoRotulo: 600,
  radius: 4,
  espacamento: 16,
  cssLivre: ".hl-error { font-weight: 600 }",
};

test("cor vira hex de 8 dígitos sem cerquilha", () => {
  assert.equal(cor("#0f62fe"), "0f62feFF");
  assert.equal(cor("0f62fe"), "0f62feFF");
  assert.equal(cor("#0f62fe80"), "0f62fe80");
});

test("cor recusa valor que não é hex", () => {
  assert.throws(() => cor("azul"), /hex/);
});

test("tokens viram operações de estilo, nunca em fieldCSS", () => {
  const ops = opsDeEstilo({ form: { fields: [] } }, tokens);
  const caminhos = ops.map((o: any) => o.caminho);
  assert.ok(caminhos.includes("form.fieldStyle.fontColor"));
  assert.ok(caminhos.includes("form.customStyle"));
  assert.ok(!caminhos.some((c: string) => c.includes("fieldCSS")));
});

test("survey também recebe o rodapé de navegação", () => {
  const ops = opsDeEstilo({ form: {}, slides: [{ id: "s1", slideData: [] }] }, tokens);
  const caminhos = ops.map((o: any) => o.caminho);
  assert.ok(caminhos.some((c: string) => c.startsWith("form.footerStyle")));
});

test("formulário não recebe rodapé de navegação", () => {
  const ops = opsDeEstilo({ form: { fields: [] } }, tokens);
  assert.ok(!ops.some((o: any) => o.caminho.startsWith("form.footerStyle")));
});

test("paleta da subconta sai dos mesmos tokens", () => {
  const p = paletaDeTokens(tokens);
  assert.equal(p.primary, "0f62feFF");
});

const base = (): Doc => ({
  form: { fields: [{ tag: "email", label: "E-mail" }, { tag: "button", type: "submit" }], fieldStyle: { fontColor: "000000FF" } },
});

test("a prévia nomeia campo que entra, campo que sai e estilo alterado", () => {
  const antes = base();
  const depois = aplicar(antes, [
    { op: "adicionar-campo", campo: { tag: "phone", label: "Telefone" } },
    { op: "remover-campo", alvo: "email" },
    { op: "definir", caminho: "form.fieldStyle.fontColor", valor: "161616FF" },
  ]);
  const linhas = diferenca(antes, depois);
  assert.ok(linhas.some((l) => l.includes("+ campo phone")));
  assert.ok(linhas.some((l) => l.includes("- campo email")));
  assert.ok(linhas.some((l) => l.includes("form.fieldStyle.fontColor")));
});

test("documento igual não tem diferença", () => {
  assert.deepEqual(diferenca(base(), base()), []);
});

test("a prévia nomeia rótulo trocado", () => {
  const antes = base();
  const depois = aplicar(antes, [{ op: "renomear-campo", alvo: "email", label: "Seu e-mail" }]);
  assert.ok(diferenca(antes, depois).some((l) => l.includes("rótulo de email")));
});

test("fieldCSS de raiz nunca aparece na prévia, em nenhuma das duas formas", () => {
  const antes: Doc = { form: { fields: [] }, fieldCSS: "body{color:red}", mobileFieldCSS: "a{}" };
  const depois: Doc = { form: { fields: [] }, fieldCSS: "body{color:blue}", mobileFieldCSS: "b{}" };
  assert.deepEqual(diferenca(antes, depois), []);
});
