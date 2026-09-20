import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizarInscricao, cortar, porqueVazio, resumoPorWorkflow, resumoPorContato,
  saidaWorkflowAcao, avisoDespublicar, resolverInscricao, nomeContato, type InscricaoCrua,
} from "../src/api/workflows-live.js";

const crua: InscricaoCrua = {
  _id: "S1",
  contactId: "C1",
  workflowId: "W1",
  status: "waiting",
  createdAt: "2026-09-01T10:00:00.000Z",
  currentStepName: "Espera 2 dias",
  currentStepType: "wait",
  executeOn: "2026-09-03T10:00:00.000Z",
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

test("normalizarInscricao aceita nextExecutionOn como segunda opção quando executeOn falta", () => {
  const r = normalizarInscricao({ id: "S3", nextExecutionOn: "2026-09-05T10:00:00.000Z" });
  assert.equal(r.proximaExecucao, "2026-09-05T10:00:00.000Z");
});

test("normalizarInscricao prefere executeOn a nextExecutionOn quando os dois vêm", () => {
  const r = normalizarInscricao({
    id: "S4", executeOn: "2026-09-06T10:00:00.000Z", nextExecutionOn: "2026-09-07T10:00:00.000Z",
  });
  assert.equal(r.proximaExecucao, "2026-09-06T10:00:00.000Z");
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

test("resumoPorWorkflow junta status e inscrições normalizadas", () => {
  const out = resumoPorWorkflow({
    workflow: { id: "W1", name: "Boas-vindas", status: "published" },
    cruas: [crua],
    cortou: false,
    estrangulado: false,
    nomes: {},
  });
  assert.equal(out.workflow.id, "W1");
  assert.equal(out.workflow.status, "published");
  assert.ok(!("total_historico" in out));
  assert.ok(!("terminados" in out));
  assert.equal(out.dentro_agora, 1);
  assert.equal(out.cortou, false);
  assert.equal(out.inscricoes[0].passo, "Espera 2 dias");
  assert.equal(out.vazio_porque, undefined);
});

test("resumoPorWorkflow explica a lista vazia em vez de devolver [] mudo", () => {
  const out = resumoPorWorkflow({
    workflow: { id: "W1", name: "Boas-vindas", status: "draft" },
    cruas: [], cortou: false, estrangulado: true, nomes: {},
  });
  assert.deepEqual(out.inscricoes, []);
  assert.match(out.vazio_porque ?? "", /estrangul/i);
});

test("resumoPorWorkflow preenche o nome do contato quando ele foi resolvido", () => {
  const out = resumoPorWorkflow({
    workflow: { id: "W1", status: "published" },
    cruas: [crua], cortou: false, estrangulado: false,
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

test("resumoPorContato não conta quem já terminou em dentro_agora", () => {
  const out = resumoPorContato({
    contactId: "C1",
    cruas: [
      { ...crua, workflowId: "W1", status: "finished" },
      { ...crua, _id: "S9", workflowId: "W2", status: "finished" },
    ],
    nomesWorkflow: {},
  });
  assert.equal(out.dentro_agora, 0);
  assert.equal(out.inscricoes.length, 2);
  assert.ok(out.vazio_porque, "lista com só finished precisa explicar dentro_agora=0");
});

test("resumoPorContato conta só as inscrições ativas quando há finished e ativa juntas", () => {
  const out = resumoPorContato({
    contactId: "C1",
    cruas: [
      { ...crua, workflowId: "W1", status: "finished" },
      { ...crua, _id: "S9", workflowId: "W2", status: "wait_time" },
    ],
    nomesWorkflow: {},
  });
  assert.equal(out.dentro_agora, 1);
  assert.equal(out.inscricoes.length, 2);
  assert.equal(out.vazio_porque, undefined);
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

test("avisoDespublicar com aoMenos e n>0 diz que a contagem é um piso, mas continua avisando o resto", () => {
  const a = avisoDespublicar(3, true);
  assert.match(a, /pelo menos/i);
  assert.match(a, /3/);
  assert.match(a, /congel/i);
  assert.match(a, /republic/i);
  assert.doesNotMatch(a, /perd/i);
});

test("avisoDespublicar com um argumento só mantém o texto de hoje", () => {
  const a = avisoDespublicar(3);
  assert.doesNotMatch(a, /pelo menos/i);
});

test("avisoDespublicar com aoMenos e n=0 não afirma que ninguém está dentro", () => {
  const a = avisoDespublicar(0, true);
  assert.doesNotMatch(a, /nenhum contato/i);
});

test("resolverInscricao acha a única inscrição do contato naquele workflow", () => {
  const r = resolverInscricao(
    [
      { _id: "S1", workflowId: "W1", contactId: "C1" },
      { _id: "S2", workflowId: "W2", contactId: "C1" },
    ],
    "W1", "C1",
  );
  assert.deepEqual(r, { id: "S1" });
});

test("resolverInscricao recusa quando o contato está duas vezes no mesmo workflow", () => {
  const r = resolverInscricao(
    [
      { _id: "S1", workflowId: "W1", contactId: "C1" },
      { _id: "S3", workflowId: "W1", contactId: "C1" },
    ],
    "W1", "C1",
  );
  assert.ok("erro" in r);
  assert.match(r.erro, /S1/);
  assert.match(r.erro, /S3/);
  assert.match(r.erro, /--inscricao/);
});

test("resolverInscricao recusa quando o contato não está no workflow", () => {
  const r = resolverInscricao([{ _id: "S1", workflowId: "W2", contactId: "C1" }], "W1", "C1");
  assert.ok("erro" in r);
  assert.match(r.erro, /não está/i);
});

test("resolverInscricao ignora inscrição de outro contato no mesmo workflow", () => {
  const r = resolverInscricao(
    [
      { _id: "S1", workflowId: "W1", contactId: "C2" },
      { _id: "S2", workflowId: "W1", contactId: "C1" },
    ],
    "W1", "C1",
  );
  assert.deepEqual(r, { id: "S2" });
});

test("nomeContato usa contactName quando existe", () => {
  assert.equal(nomeContato({ contactName: "Maria Silva", name: "outro", firstName: "x" }), "Maria Silva");
});

test("nomeContato cai para name quando não há contactName", () => {
  assert.equal(nomeContato({ name: "João", firstName: "x" }), "João");
});

test("nomeContato monta firstName + lastName aparados quando faltam contactName e name", () => {
  assert.equal(nomeContato({ firstName: " Ana ", lastName: " Souza " }), "Ana Souza");
});

test("nomeContato usa só firstName quando não há lastName", () => {
  assert.equal(nomeContato({ firstName: "Pedro" }), "Pedro");
});

test("nomeContato cai para email quando não há nome nenhum", () => {
  assert.equal(nomeContato({ email: "a@b.com" }), "a@b.com");
});

test("nomeContato devolve string vazia quando nada serve", () => {
  assert.equal(nomeContato({}), "");
});
