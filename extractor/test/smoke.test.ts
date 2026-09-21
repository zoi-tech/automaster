import { test } from "node:test";
import assert from "node:assert/strict";
import {
  lista, listaEm, objetoCom, objeto, executar, resumo,
  CHECAGENS, janela, type Checagem, type Contexto, type Resultado,
} from "../src/cli/smoke.js";
import { isoComFuso } from "../src/api/calendars.js";
import type { GhlClient } from "../src/api/client.js";

const cliente = {} as GhlClient;
const ctx = (): Contexto => ({ loc: "L1", companyId: "C1" });
const mudo = (): void => {};

test("lista aceita array com o mínimo e acusa o que não é array", () => {
  assert.equal(lista(1)([{ id: "a" }]), null);
  assert.match(String(lista(1)([])), /ao menos 1/);
  assert.match(String(lista()({ tags: [] })), /esperado array, veio object/);
  assert.equal(lista(0)([]), null);
});

test("listaEm acusa o campo que sumiu da resposta, nomeando o que veio", () => {
  assert.equal(listaEm("tags")({ tags: [{ id: "a" }], total: 1 }), null);
  const erro = String(listaEm("tags")({ items: [], total: 0 }));
  assert.match(erro, /"tags" sumiu/);
  assert.match(erro, /items, total/);
});

test("listaEm acusa o campo que mudou de tipo", () => {
  assert.match(String(listaEm("pipelines")({ pipelines: { a: 1 } })), /esperado array, veio object/);
});

test("objetoCom lista todos os campos ausentes de uma vez", () => {
  assert.equal(objetoCom("detail", "steps")({ detail: {}, steps: {} }), null);
  assert.equal(String(objetoCom("detail", "steps", "triggers")({ detail: {} })), "campos ausentes: steps, triggers");
});

test("objeto recusa array, null e objeto vazio", () => {
  assert.equal(objeto()({ sla: 1 }), null);
  assert.match(String(objeto()([])), /veio array/);
  assert.match(String(objeto()(null)), /veio null/);
  assert.match(String(objeto()({})), /sem nenhuma chave/);
});

test("executar: uma falha não interrompe as seguintes, e erro virado exceção também é falha", async () => {
  const checagens: Checagem[] = [
    { nome: "a", chamar: async () => [1], conferir: lista(1) },
    { nome: "b", chamar: async () => ({}), conferir: lista(1) },
    { nome: "c", chamar: async () => { throw new Error("401 sem token"); }, conferir: lista(0) },
    { nome: "d", chamar: async () => [], conferir: lista(0) },
  ];
  const rs = await executar(cliente, ctx(), checagens, mudo);
  assert.deepEqual(rs.map((r) => r.estado), ["ok", "falhou", "falhou", "ok"]);
  assert.match(String(rs[2].motivo), /401 sem token/);
  assert.deepEqual(resumo(rs), { ok: 2, falhou: 2, pulado: 0 });
});

test("executar: checagem sem o dado de que depende sai como pulado, sem chamar a API", async () => {
  let chamou = false;
  const rs = await executar(cliente, ctx(), [{
    nome: "contato",
    precisa: (c) => Boolean(c.contato),
    chamar: async () => { chamou = true; return []; },
    conferir: lista(0),
  }], mudo);
  assert.equal(chamou, false);
  assert.equal(rs[0].estado, "pulado");
});

test("executar: o que uma checagem colhe alimenta a seguinte", async () => {
  let visto: string | undefined;
  const checagens: Checagem[] = [
    {
      nome: "lista",
      chamar: async () => [{ id: "w1" }],
      conferir: lista(1),
      colher: (r, c) => { c.workflow = (r as { id: string }[])[0] as never; },
    },
    {
      nome: "detalhe",
      precisa: (c) => Boolean(c.workflow),
      chamar: async (_cl, c) => { visto = (c.workflow as { id: string }).id; return { a: 1 }; },
      conferir: objeto(),
    },
  ];
  const rs: Resultado[] = await executar(cliente, ctx(), checagens, mudo);
  assert.equal(visto, "w1");
  assert.deepEqual(rs.map((r) => r.estado), ["ok", "ok"]);
});

test("colher só roda quando a checagem passou: forma quebrada não contamina o contexto", async () => {
  const c = ctx();
  await executar(cliente, c, [{
    nome: "lista",
    chamar: async () => ({ items: [] }),
    conferir: lista(1),
    colher: () => { throw new Error("não deveria rodar"); },
  }], mudo);
  assert.equal(c.workflow, undefined);
});

test("a tabela de checagens não tem nome repetido", () => {
  const nomes = CHECAGENS.map((c) => c.nome);
  assert.equal(new Set(nomes).size, nomes.length);
});

test("a janela de datas passa pela guarda da agenda (ISO com fuso, sem milissegundos)", () => {
  const { inicio, fim } = janela(new Date("2026-09-21T23:01:01.818Z"));
  assert.equal(isoComFuso(inicio), "2026-09-21T23:01:01Z");
  assert.equal(isoComFuso(fim), "2026-09-28T23:01:01Z");
});
