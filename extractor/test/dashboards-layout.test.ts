/**
 * Etapa 2 do plano de dashboards: validador de layout e das regras de composição.
 *
 * Contrato que o implementador deve cumprir (src/api/dashboards-layout.ts, funções puras):
 *   validarLayout(itens: {id, x, y, w, h, chartType}[]): {codigo, mensagem}[]
 *     vazia quando passa. mensagem em português e cita o `id` do widget (na sobreposição, os dois).
 *     códigos: fora_da_grade | sobreposicao | abaixo_do_minimo | buraco
 *     mínimos (w,h): numeric 3x4, table 6x6, funnel 5x6, demais (inclui custom) 4x6.
 *     buraco: célula vazia entre a primeira e a última linha ocupadas que algum widget
 *     abaixo caberia ocupar subindo (mesmas colunas livres). Uma acusação por widget que sobe.
 *   validarComposicao(plano: {id, titulo, chartType, module, x, y, w, h, options}[]): {codigo, mensagem}[]
 *     avisos: numeros_demais_no_topo | donut_com_fatias_demais | data_nao_dita_no_titulo | titulo_longo
 *       | painel_simploria | numero_alto_demais (etapa 11)
 *     painel_simploria: de 1 a 11 widgets (objectWidget, o título de seção, não conta); painel
 *       vazio não avisa (é o estado de quem ainda vai montar); 12 ou mais não avisa.
 *     numero_alto_demais: numeric com h maior que 4 (h 4 passa); a mensagem cita o id.
 *     sem_secoes: mais de 8 widgets que não são objectWidget e nenhum título de seção. Título de
 *       seção = chartType "objectWidget" com identifier "object-title" (o item do plano pode trazer
 *       `identifier`, copiado do molde). object-textbox/object-image/object-embed não contam como
 *       título. 8 widgets sem título não avisa.
 *     "título cita a data" = o título contém a palavra "data" (sem diferenciar maiúscula).
 *     a data usada de um widget de oportunidade é options.dateProperty.
 *   contraste(corA: string, corB: string): number
 *     razão de contraste WCAG 2.x entre duas cores hex "#rrggbb" (maiúscula ou minúscula),
 *     simétrica, de 1 a 21. A etapa 3 usa para validar o tema.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { validarLayout, validarComposicao, contraste } from "../src/api/dashboards-layout.js";

const it = (id: string, x: number, y: number, w: number, h: number, chartType = "bar") => ({
  id, x, y, w, h, chartType,
});
const codigos = (p: { codigo: string }[]) => p.map((e) => e.codigo);

// Layout real do painel "Visão Geral das Vendas" da Xb9g (pesquisa A4), 19 widgets.
const REAIS = [
  { id: "67b728d6b858388406f66113", x: 6, y: 24, w: 6, h: 10, chartType: "bar" },
  { id: "68aded75035add56a641d64a", x: 0, y: 8, w: 5, h: 7, chartType: "donut" },
  { id: "68adee69874fd86ce58802e4", x: 0, y: 15, w: 5, h: 9, chartType: "custom" },
  { id: "68ae06cb5efba5145411a680", x: 0, y: 24, w: 6, h: 10, chartType: "custom" },
  { id: "68ae0761fd6fa4b616f6f8b6", x: 5, y: 9, w: 7, h: 15, chartType: "custom" },
  { id: "690b56850a2149993e187038", x: 0, y: 48, w: 6, h: 6, chartType: "donut" },
  { id: "690b58004fe9170b47c8fe81", x: 0, y: 54, w: 6, h: 6, chartType: "donut" },
  { id: "690b58e20de6eb423f5d40f5", x: 6, y: 48, w: 6, h: 6, chartType: "donut" },
  { id: "690b582e31177518934d615b", x: 0, y: 60, w: 6, h: 6, chartType: "donut" },
  { id: "690b5af160ae347b290da789", x: 6, y: 60, w: 6, h: 6, chartType: "donut" },
  { id: "690b5adc4b2572292e8dc0f6", x: 6, y: 54, w: 6, h: 6, chartType: "donut" },
  { id: "690b5bccda4bf38032f600eb", x: 5, y: 0, w: 7, h: 9, chartType: "bar" },
  { id: "69207fe30c81929536967587", x: 0, y: 42, w: 6, h: 6, chartType: "custom" },
  { id: "696634bde908dc6afececea8", x: 0, y: 0, w: 5, h: 8, chartType: "donut" },
  { id: "69a9a5bdb76a23af176eb1b8", x: 0, y: 34, w: 6, h: 8, chartType: "donut" },
  { id: "69b192f33285728a757968bf", x: 9, y: 34, w: 3, h: 6, chartType: "numeric" },
  { id: "69b192d8fb646ac377847e4e", x: 6, y: 34, w: 3, h: 6, chartType: "numeric" },
  { id: "69b193ca4379cfad4c7dd228", x: 6, y: 40, w: 6, h: 8, chartType: "donut" },
  { id: "6a2210b2c0ea4a650170116d", x: 0, y: 66, w: 12, h: 6, chartType: "custom" },
];

// ---------- validarLayout ----------

test("painel vazio passa", () => {
  assert.deepEqual(validarLayout([]), []);
});

test("um widget só, 12 de largura, passa", () => {
  assert.deepEqual(validarLayout([it("a", 0, 0, 12, 6)]), []);
});

test("os widgets reais da Xb9g passam (confere a contagem da fixture)", () => {
  // 19 widgets no painel real; a fixture tem 19 linhas
  assert.equal(REAIS.length, 19);
  assert.deepEqual(validarLayout(REAIS), []);
});

test("fora_da_grade: x negativo", () => {
  const p = validarLayout([it("neg", -1, 0, 6, 6)]);
  assert.ok(codigos(p).includes("fora_da_grade"));
  assert.match(p.find((e) => e.codigo === "fora_da_grade")!.mensagem, /neg/);
});

test("fora_da_grade: w menor que 1", () => {
  assert.ok(codigos(validarLayout([it("zero", 0, 0, 0, 6)])).includes("fora_da_grade"));
});

test("fora_da_grade: x + w passa de 12", () => {
  assert.ok(codigos(validarLayout([it("larg", 8, 0, 5, 6)])).includes("fora_da_grade"));
});

test("x + w igual a 12 é a borda e passa", () => {
  assert.deepEqual(validarLayout([it("borda", 6, 0, 6, 6)]), []);
});

test("sobreposicao: acusa e nomeia os dois widgets", () => {
  const p = validarLayout([it("um", 0, 0, 6, 6), it("dois", 5, 3, 6, 6)]);
  const s = p.filter((e) => e.codigo === "sobreposicao");
  assert.ok(s.length >= 1);
  assert.match(s[0].mensagem, /um/);
  assert.match(s[0].mensagem, /dois/);
});

test("lado a lado e um sobre o outro, encostados, não são sobreposição", () => {
  const p = validarLayout([it("a", 0, 0, 6, 6), it("b", 6, 0, 6, 6), it("c", 0, 6, 12, 6)]);
  assert.deepEqual(p, []);
});

test("sobreposicao: objectWidget entra na conta como qualquer widget", () => {
  const p = validarLayout([it("grafico", 0, 0, 6, 6), it("caixa", 3, 2, 6, 6, "objectWidget")]);
  assert.ok(codigos(p).includes("sobreposicao"));
});

test("abaixo_do_minimo: numeric aceita 3x3 (provado ao vivo) e recusa w 2 ou h 2", () => {
  assert.deepEqual(validarLayout([it("n", 0, 0, 3, 3, "numeric")]), []);
  assert.ok(codigos(validarLayout([it("n", 0, 0, 2, 3, "numeric")])).includes("abaixo_do_minimo"));
  assert.ok(codigos(validarLayout([it("n", 0, 0, 3, 2, "numeric")])).includes("abaixo_do_minimo"));
});

test("abaixo_do_minimo: table exige 6x6", () => {
  assert.deepEqual(validarLayout([it("t", 0, 0, 6, 6, "table")]), []);
  assert.ok(codigos(validarLayout([it("t", 0, 0, 5, 6, "table")])).includes("abaixo_do_minimo"));
  assert.ok(codigos(validarLayout([it("t", 0, 0, 6, 5, "table")])).includes("abaixo_do_minimo"));
});

test("abaixo_do_minimo: funnel exige 5x6", () => {
  assert.deepEqual(validarLayout([it("f", 0, 0, 5, 6, "funnel")]), []);
  assert.ok(codigos(validarLayout([it("f", 0, 0, 4, 6, "funnel")])).includes("abaixo_do_minimo"));
  assert.ok(codigos(validarLayout([it("f", 0, 0, 5, 5, "funnel")])).includes("abaixo_do_minimo"));
});

test("abaixo_do_minimo: demais tipos exigem 4x6 e a mensagem cita o widget", () => {
  assert.deepEqual(validarLayout([it("d", 0, 0, 4, 6, "donut")]), []);
  const p = validarLayout([it("pequeno", 0, 0, 3, 6, "donut")]);
  assert.ok(codigos(p).includes("abaixo_do_minimo"));
  assert.match(p.find((e) => e.codigo === "abaixo_do_minimo")!.mensagem, /pequeno/);
  assert.ok(codigos(validarLayout([it("d", 0, 0, 4, 5, "bar")])).includes("abaixo_do_minimo"));
});

test("abaixo_do_minimo: o mínimo do próprio widget vence o do tipo (conversão custom é 3x4)", () => {
  assert.deepEqual(validarLayout([{ ...it("conv", 0, 0, 3, 4, "custom"), minW: 3, minH: 4 }]), []);
  assert.ok(codigos(validarLayout([{ ...it("conv", 0, 0, 3, 3, "custom"), minW: 3, minH: 4 }])).includes("abaixo_do_minimo"));
});

test("buraco: faixa vazia inteira com widget abaixo que subiria", () => {
  const p = validarLayout([it("a", 0, 0, 6, 6), it("b", 6, 0, 6, 6), it("c", 0, 8, 12, 6)]);
  assert.ok(codigos(p).includes("buraco"));
  assert.match(p.find((e) => e.codigo === "buraco")!.mensagem, /c/);
});

test("buraco: célula vazia ao lado, com widget abaixo que cabe nas colunas livres", () => {
  const p = validarLayout([it("a", 0, 0, 12, 6), it("b", 0, 6, 6, 6), it("c", 6, 12, 6, 6)]);
  assert.ok(codigos(p).includes("buraco"));
});

test("sem buraco: vazio que nenhum widget abaixo caberia ocupar", () => {
  // x6..12 de y4 a y10 está vazio, mas "c" tem 12 de largura e não sobe sem bater em "a"
  const p = validarLayout([it("a", 0, 0, 6, 10), it("b", 6, 0, 6, 4), it("c", 0, 10, 12, 6)]);
  assert.ok(!codigos(p).includes("buraco"), JSON.stringify(p));
});

// ---------- validarComposicao ----------

const w = (o: Record<string, unknown>) => ({
  id: "w", titulo: "Titulo", chartType: "bar", module: "automation-appointments",
  x: 0, y: 0, w: 6, h: 6, options: {}, ...o,
});
const numeros = (n: number, yDoUltimo = 0) =>
  Array.from({ length: n }, (_, i) =>
    w({ id: `n${i}`, chartType: "numeric", x: i * 2, w: 2, h: 4, y: i === n - 1 ? yDoUltimo : 0 }),
  );

test("composição: painel vazio e widget comum não avisam", () => {
  assert.deepEqual(validarComposicao([]), []);
  // um widget só cai em painel_simploria (etapa 11); fora isso, nada
  assert.deepEqual(validarComposicao([w({})]).filter((e) => e.codigo !== "painel_simploria"), []);
});

test("numeros_demais_no_topo: 5 numeric na linha do topo avisa", () => {
  assert.ok(codigos(validarComposicao(numeros(5))).includes("numeros_demais_no_topo"));
});

test("numeros_demais_no_topo: 4 numeric no topo não avisa", () => {
  assert.ok(!codigos(validarComposicao(numeros(4))).includes("numeros_demais_no_topo"));
});

test("numeros_demais_no_topo: 5 numeric, um deles fora do topo, não avisa", () => {
  const plano = [...numeros(5, 6), w({ id: "base", y: 0, x: 10, w: 2 })];
  assert.ok(!codigos(validarComposicao(plano)).includes("numeros_demais_no_topo"));
});

test("numeros_demais_no_topo: o topo é o menor y do painel, não y 0", () => {
  const plano = numeros(5).map((n) => ({ ...n, y: 3 }));
  assert.ok(codigos(validarComposicao(plano)).includes("numeros_demais_no_topo"));
});

test("donut_com_fatias_demais: limit ausente avisa", () => {
  const p = validarComposicao([w({ id: "d", chartType: "donut", options: { groupBy: { fields: ["status"] } } })]);
  assert.ok(codigos(p).includes("donut_com_fatias_demais"));
});

test("donut_com_fatias_demais: sem groupBy avisa", () => {
  assert.ok(codigos(validarComposicao([w({ chartType: "donut", options: {} })])).includes("donut_com_fatias_demais"));
});

test("donut_com_fatias_demais: limit 6 avisa, 5 não", () => {
  const com = (limit: number) =>
    validarComposicao([w({ chartType: "donut", options: { groupBy: { fields: ["status"], limit } } })]);
  assert.ok(codigos(com(6)).includes("donut_com_fatias_demais"));
  assert.ok(codigos(com(15)).includes("donut_com_fatias_demais"));
  assert.ok(!codigos(com(5)).includes("donut_com_fatias_demais"));
});

test("donut_com_fatias_demais: só vale para donut", () => {
  const p = validarComposicao([w({ chartType: "bar", options: { groupBy: { fields: ["x"], limit: 15 } } })]);
  assert.ok(!codigos(p).includes("donut_com_fatias_demais"));
});

test("data_nao_dita_no_titulo: oportunidade com outra data e título mudo avisa", () => {
  const p = validarComposicao([
    w({ module: "crm-opportunities", titulo: "Oportunidades por status", options: { dateProperty: "last_status_change_date" } }),
  ]);
  assert.ok(codigos(p).includes("data_nao_dita_no_titulo"));
});

test("data_nao_dita_no_titulo: título que cita a data não avisa", () => {
  const p = validarComposicao([
    w({ module: "crm-opportunities", titulo: "Por status (data de mudança)", options: { dateProperty: "last_status_change_date" } }),
  ]);
  assert.ok(!codigos(p).includes("data_nao_dita_no_titulo"));
});

test("data_nao_dita_no_titulo: date_added não avisa", () => {
  const p = validarComposicao([
    w({ module: "crm-opportunities", titulo: "Oportunidades por status", options: { dateProperty: "date_added" } }),
  ]);
  assert.ok(!codigos(p).includes("data_nao_dita_no_titulo"));
});

test("data_nao_dita_no_titulo: outro módulo não avisa", () => {
  const p = validarComposicao([
    w({ module: "automation-appointments", titulo: "Agendamentos", options: { dateProperty: "dateAdded" } }),
  ]);
  assert.ok(!codigos(p).includes("data_nao_dita_no_titulo"));
});

test("titulo_longo: mais de 32 caracteres em até 4 colunas avisa", () => {
  const t = "a".repeat(33);
  assert.ok(codigos(validarComposicao([w({ titulo: t, w: 4 })])).includes("titulo_longo"));
  assert.ok(codigos(validarComposicao([w({ titulo: t, w: 3 })])).includes("titulo_longo"));
});

test("titulo_longo: exatamente 32 caracteres, ou 5+ colunas, não avisa", () => {
  assert.ok(!codigos(validarComposicao([w({ titulo: "a".repeat(32), w: 4 })])).includes("titulo_longo"));
  assert.ok(!codigos(validarComposicao([w({ titulo: "a".repeat(40), w: 5 })])).includes("titulo_longo"));
});

test("titulo_longo: conta caracteres, não bytes (acentos)", () => {
  assert.ok(!codigos(validarComposicao([w({ titulo: "ã".repeat(32), w: 4 })])).includes("titulo_longo"));
});

test("os avisos citam o widget na mensagem", () => {
  const p = validarComposicao([w({ id: "longo1", titulo: "a".repeat(40), w: 4 })]);
  assert.match(p.find((e) => e.codigo === "titulo_longo")!.mensagem, /longo1|a{10}/);
});

// ---------- etapa 11: painel_simploria e numero_alto_demais ----------

const comuns = (n: number) => Array.from({ length: n }, (_, i) => w({ id: `g${i}`, y: i * 6 }));

test("painel_simploria: 11 widgets avisa e a mensagem cita a contagem", () => {
  const p = validarComposicao(comuns(11));
  const s = p.find((e) => e.codigo === "painel_simploria");
  assert.ok(s, JSON.stringify(p));
  assert.match(s.mensagem, /11/);
});

test("painel_simploria: 1 widget avisa", () => {
  assert.ok(codigos(validarComposicao(comuns(1))).includes("painel_simploria"));
});

test("painel_simploria: 12 widgets não avisa", () => {
  assert.ok(!codigos(validarComposicao(comuns(12))).includes("painel_simploria"));
});

test("painel_simploria: objectWidget não entra na conta (11 + 3 títulos de seção avisa)", () => {
  const plano = [...comuns(11), ...["s1", "s2", "s3"].map((id, i) => w({ id, chartType: "objectWidget", y: 100 + i }))];
  assert.ok(codigos(validarComposicao(plano)).includes("painel_simploria"));
});

test("painel_simploria: painel vazio não avisa", () => {
  assert.ok(!codigos(validarComposicao([])).includes("painel_simploria"));
});

test("numero_alto_demais: numeric com h 5 avisa e cita o widget", () => {
  const p = validarComposicao([w({ id: "alto1", chartType: "numeric", w: 3, h: 5 })]);
  const a = p.find((e) => e.codigo === "numero_alto_demais");
  assert.ok(a, JSON.stringify(p));
  assert.match(a.mensagem, /alto1/);
});

test("numero_alto_demais: numeric com h 4 ou 3 não avisa", () => {
  for (const h of [3, 4]) {
    assert.ok(!codigos(validarComposicao([w({ chartType: "numeric", w: 3, h })])).includes("numero_alto_demais"), String(h));
  }
});

test("numero_alto_demais: só vale para numeric (bar com h 10 não avisa)", () => {
  assert.ok(!codigos(validarComposicao([w({ chartType: "bar", h: 10 })])).includes("numero_alto_demais"));
});

test("numero_alto_demais: acusa cada numeric alto, um aviso por widget", () => {
  const plano = [w({ id: "a1", chartType: "numeric", w: 3, h: 6 }), w({ id: "a2", chartType: "numeric", x: 3, w: 3, h: 8 })];
  assert.equal(codigos(validarComposicao(plano)).filter((c) => c === "numero_alto_demais").length, 2);
});

// ---------- etapa 11: sem_secoes ----------

const objeto = (id: string, identifier: string) =>
  ({ ...w({ id, chartType: "objectWidget", module: "object-widget", x: 0, y: 200, w: 12, h: 1 }), identifier });

test("sem_secoes: 9 widgets e nenhum objeto de título avisa", () => {
  assert.ok(codigos(validarComposicao(comuns(9))).includes("sem_secoes"));
});

test("sem_secoes: 8 widgets sem título não avisa", () => {
  assert.ok(!codigos(validarComposicao(comuns(8))).includes("sem_secoes"));
});

test("sem_secoes: 9 widgets com um object-title não avisa", () => {
  assert.ok(!codigos(validarComposicao([...comuns(9), objeto("sec1", "object-title")])).includes("sem_secoes"));
});

test("sem_secoes: caixa de texto, imagem ou embed não contam como título de seção", () => {
  const plano = [...comuns(9), objeto("t", "object-textbox"), objeto("i", "object-image"), objeto("e", "object-embed")];
  assert.ok(codigos(validarComposicao(plano)).includes("sem_secoes"));
});

test("sem_secoes: objectWidget não entra na conta dos 8 (8 widgets + 3 caixas de texto não avisa)", () => {
  const plano = [...comuns(8), objeto("t1", "object-textbox"), objeto("t2", "object-textbox"), objeto("t3", "object-textbox")];
  assert.ok(!codigos(validarComposicao(plano)).includes("sem_secoes"));
});

// ---------- contraste ----------

test("contraste: preto sobre branco é 21 e branco sobre branco é 1", () => {
  assert.ok(Math.abs(contraste("#000000", "#FFFFFF") - 21) < 0.01);
  assert.ok(Math.abs(contraste("#ffffff", "#FFFFFF") - 1) < 0.01);
});

test("contraste: é simétrico", () => {
  assert.ok(Math.abs(contraste("#336699", "#ffffff") - contraste("#ffffff", "#336699")) < 1e-9);
});

test("contraste: cinza claro sobre branco fica abaixo de 4.5", () => {
  assert.ok(contraste("#cccccc", "#ffffff") < 4.5);
});

test("contraste: #767676 sobre branco passa de 4.5 (limite AA conhecido)", () => {
  const c = contraste("#767676", "#ffffff");
  assert.ok(c >= 4.5 && c < 4.7, String(c));
});

test("contraste: verde da marca #b5ff81 sobre branco é baixo", () => {
  assert.ok(contraste("#b5ff81", "#ffffff") < 2);
});
