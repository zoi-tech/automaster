import { test } from "node:test";
import assert from "node:assert/strict";
import { cor, opsDeEstilo, paletaDeTokens, mesclarPaleta, type Tokens } from "../src/forms/style.js";
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

test("paleta da subconta sai dos mesmos tokens, em lista de {name, value}", () => {
  const p = paletaDeTokens(tokens);
  assert.ok(Array.isArray(p));
  const primary = p.find((c) => c.name === "Primary");
  assert.equal(primary?.value, "0f62feFF");
});

test("mesclar paleta troca o valor de um rótulo nosso já existente", () => {
  const atual = [{ name: "Primary", value: "AAAAAAFF" }];
  const r = mesclarPaleta(atual, tokens);
  const primary = r.find((c) => c.name === "Primary");
  assert.equal(primary?.value, "0f62feFF");
});

test("mesclar paleta acrescenta rótulo nosso ausente, sem remover o que já existe", () => {
  const atual = [{ name: "Secondary", value: "188BF6FF" }];
  const r = mesclarPaleta(atual, tokens);
  assert.equal(r.length, 6); // Secondary + os 5 nossos
  assert.ok(r.some((c) => c.name === "Primary" && c.value === "0f62feFF"));
});

test("mesclar paleta preserva intacto rótulo alheio", () => {
  const atual = [
    { name: "Secondary", value: "188BF6FF" },
    { name: "White", value: "FFFFFFFF" },
    { name: "Black", value: "000000" },
  ];
  const r = mesclarPaleta(atual, tokens);
  assert.ok(r.some((c) => c.name === "Secondary" && c.value === "188BF6FF"));
  assert.ok(r.some((c) => c.name === "White" && c.value === "FFFFFFFF"));
  assert.ok(r.some((c) => c.name === "Black" && c.value === "000000"));
});

test("mesclar paleta casa rótulo sem diferenciar maiúscula de minúscula", () => {
  const atual = [{ name: "primary", value: "AAAAAAFF" }];
  const r = mesclarPaleta(atual, tokens);
  assert.equal(r.length, 5); // "primary" e "Primary" são o mesmo rótulo
  const primary = r.find((c) => c.name.toLowerCase() === "primary");
  assert.equal(primary?.value, "0f62feFF");
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

const baseSurvey = (): Doc => ({
  slides: [
    { id: "s1", slideName: "Slide 1", slideData: [{ tag: "full_name", label: "Nome" }] },
    { id: "s2", slideName: "Slide 2", slideData: [] },
  ],
});

test("survey igual não tem diferença", () => {
  assert.deepEqual(diferenca(baseSurvey(), baseSurvey()), []);
});

test("a prévia nomeia slide que entra", () => {
  const antes = baseSurvey();
  const depois = aplicar(antes, [{ op: "criar-slide", nome: "Slide 3" }], { permitirVazio: true });
  assert.ok(diferenca(antes, depois).some((l) => l.startsWith("+ slide ")));
});

test("a prévia nomeia slide que sai", () => {
  const antes = baseSurvey();
  const depois = aplicar(antes, [{ op: "remover-slide", alvo: "s2" }], { permitirVazio: true });
  assert.ok(diferenca(antes, depois).includes("- slide s2"));
});

test("a prévia nomeia nome de slide trocado", () => {
  const antes = baseSurvey();
  const depois = aplicar(antes, [{ op: "renomear-slide", alvo: "s2", nome: "Slide 2 renomeado" }], { permitirVazio: true });
  assert.ok(diferenca(antes, depois).some((l) => l.includes("nome do slide s2")));
});

test("a prévia nomeia ordem dos slides alterada", () => {
  const antes = baseSurvey();
  const depois = aplicar(antes, [{ op: "reordenar-slides", ordem: ["s2", "s1"] }], { permitirVazio: true });
  assert.ok(diferenca(antes, depois).some((l) => l.includes("ordem dos slides")));
});
