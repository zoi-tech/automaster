/**
 * Etapa 10: a conta de seção estourada mede o fim do conteúdo da folha (fundo do último
 * elemento visível em relação ao topo da folha), e o comando avisa quando o PDF tem mais
 * páginas que folhas. As duas contas são funções puras de `conferencias.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { alturaConteudo, avisoPaginas } from "../src/manual/conferencias.js";

test("alturaConteudo: fundo mais baixo menos o topo da folha, mesmo fora de ordem", () => {
  // o maior fundo está no meio da lista: não vale pegar o último
  assert.equal(alturaConteudo(100, [150, 420, 300]), 320);
});

test("alturaConteudo: mede a partir do topo da folha, não do topo da página", () => {
  assert.equal(alturaConteudo(2000, [2350, 2900]), 900);
  assert.equal(alturaConteudo(0, [2350, 2900]), 2900);
});

test("alturaConteudo: um elemento só", () => {
  assert.equal(alturaConteudo(40, [41.5]), 1.5);
});

test("alturaConteudo: folha sem filhos mede 0", () => {
  assert.equal(alturaConteudo(100, []), 0);
});

test("alturaConteudo: fundos acima do topo nunca dão altura negativa", () => {
  assert.equal(alturaConteudo(500, [100, 200]), 0);
});

test("avisoPaginas: mais páginas que folhas avisa com os dois números", () => {
  assert.equal(avisoPaginas(9, 8), "o PDF tem 9 páginas para 8 folhas");
  assert.equal(avisoPaginas(14, 10), "o PDF tem 14 páginas para 10 folhas");
});

test("avisoPaginas: páginas iguais às folhas não avisa", () => {
  assert.equal(avisoPaginas(8, 8), null);
});

test("avisoPaginas: menos páginas que folhas não avisa", () => {
  assert.equal(avisoPaginas(7, 8), null);
});
