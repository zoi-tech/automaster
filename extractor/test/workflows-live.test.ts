import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizarInscricao, cortar, porqueVazio, resumoPorWorkflow, resumoPorContato,
  saidaWorkflowAcao, avisoDespublicar, type InscricaoCrua,
} from "../src/api/workflows-live.js";

const crua: InscricaoCrua = {
  _id: "S1",
  contactId: "C1",
  workflowId: "W1",
  status: "waiting",
  createdAt: "2026-09-01T10:00:00.000Z",
  currentStepName: "Espera 2 dias",
  currentStepType: "wait",
  nextExecutionOn: "2026-09-03T10:00:00.000Z",
  meta: { addedSource: { source: "trigger", sourceName: "Formulário enviado" } },
};

test("normalizarInscricao achata a linha crua nos campos que interessam", () => {
  assert.deepEqual(normalizarInscricao(crua), {
    inscricaoId: "S1",
    contactId: "C1",
    status: "waiting",
    entrouEm: "2026-09-01T10:00:00.000Z",
    passo: "Espera 2 dias",
    passoTipo: "wait",
    proximaExecucao: "2026-09-03T10:00:00.000Z",
    origem: "trigger",
    origemNome: "Formulário enviado",
  });
});

test("normalizarInscricao aceita id no lugar de _id e sobrevive a campo ausente", () => {
  const r = normalizarInscricao({ id: "S2", contactId: "C2" });
  assert.equal(r.inscricaoId, "S2");
  assert.equal(r.passo, "");
  assert.equal(r.origem, "");
});

test("cortar devolve tudo e cortou=false quando cabe no teto", () => {
  assert.deepEqual(cortar([1, 2, 3], 5), { linhas: [1, 2, 3], cortou: false });
});

test("cortar apara no teto e avisa que cortou", () => {
  assert.deepEqual(cortar([1, 2, 3], 2), { linhas: [1, 2], cortou: true });
});

test("porqueVazio distingue vazio de verdade de corte do servidor", () => {
  assert.match(porqueVazio(false), /nenhum contato/i);
  assert.match(porqueVazio(true), /estrangul/i);
});

test("resumoPorWorkflow junta status, total e inscrições normalizadas", () => {
  const out = resumoPorWorkflow({
    workflow: { id: "W1", name: "Boas-vindas", status: "published" },
    cruas: [crua],
    total: 12,
    finished: 4,
    cortou: false,
    estrangulado: false,
    nomes: {},
  });
  assert.equal(out.workflow.id, "W1");
  assert.equal(out.workflow.status, "published");
  assert.equal(out.total_historico, 12);
  assert.equal(out.terminados, 4);
  assert.equal(out.dentro_agora, 1);
  assert.equal(out.cortou, false);
  assert.equal(out.inscricoes[0].passo, "Espera 2 dias");
  assert.equal(out.vazio_porque, undefined);
});

test("resumoPorWorkflow explica a lista vazia em vez de devolver [] mudo", () => {
  const out = resumoPorWorkflow({
    workflow: { id: "W1", name: "Boas-vindas", status: "draft" },
    cruas: [], total: 0, finished: 0, cortou: false, estrangulado: true, nomes: {},
  });
  assert.deepEqual(out.inscricoes, []);
  assert.match(out.vazio_porque ?? "", /estrangul/i);
});

test("resumoPorWorkflow preenche o nome do contato quando ele foi resolvido", () => {
  const out = resumoPorWorkflow({
    workflow: { id: "W1", status: "published" },
    cruas: [crua], total: 1, finished: 0, cortou: false, estrangulado: false,
    nomes: { C1: "Maria Silva" },
  });
  assert.equal(out.inscricoes[0].contato, "Maria Silva");
});

test("resumoPorContato usa a mesma linha normalizada do outro lado", () => {
  const out = resumoPorContato({
    contactId: "C1",
    cruas: [{ ...crua, workflowId: "W1" }],
    nomesWorkflow: { W1: "Boas-vindas" },
  });
  assert.equal(out.contactId, "C1");
  assert.equal(out.dentro_agora, 1);
  assert.equal(out.inscricoes[0].workflowId, "W1");
  assert.equal(out.inscricoes[0].workflow, "Boas-vindas");
  assert.equal(out.inscricoes[0].passo, "Espera 2 dias");
});

test("resumoPorContato explica a lista vazia", () => {
  const out = resumoPorContato({ contactId: "C9", cruas: [], nomesWorkflow: {} });
  assert.deepEqual(out.inscricoes, []);
  assert.match(out.vazio_porque ?? "", /nenhum workflow/i);
});

test("saidaWorkflowAcao carrega o aviso quando ele existe", () => {
  const out = saidaWorkflowAcao({
    acao: "publicar", workflowId: "W1", resposta: { ok: true },
    registro: "/tmp/x.json", aviso: "3 contatos congelaram",
  });
  assert.deepEqual(out, {
    aplicado: true, acao: "publicar", workflowId: "W1", resposta: { ok: true },
    registro: "/tmp/x.json", aviso: "3 contatos congelaram",
  });
});

test("saidaWorkflowAcao não inventa o campo aviso quando não há aviso", () => {
  const out = saidaWorkflowAcao({
    acao: "remover", workflowId: "W1", resposta: { ok: true }, registro: "/tmp/x.json",
  });
  assert.ok(!("aviso" in out));
});

test("avisoDespublicar diz o número e que os contatos retomam, não somem", () => {
  const a = avisoDespublicar(3);
  assert.match(a, /3/);
  assert.match(a, /congel/i);
  assert.match(a, /republic/i);
  assert.doesNotMatch(a, /perd/i);
});

test("avisoDespublicar no vazio não fala de congelamento", () => {
  assert.match(avisoDespublicar(0), /nenhum contato/i);
});
