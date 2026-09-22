import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { forma, clienteDoCassete, VOCABULARIO, type Cassete } from "../src/cli/cassete.js";
import { CHECAGENS, executar, resumo, type Contexto } from "../src/cli/smoke.js";

const FIXTURE = path.join(import.meta.dirname, "fixtures", "api-forma.json");

test("forma apaga o valor e preserva chave, tipo e aninhamento", () => {
  assert.deepEqual(
    forma({ id: "abc", n: 7, ok: true, nada: null, lista: [{ nome: "a" }, { nome: "b" }], vazia: [] }),
    { id: "x", n: 0, ok: true, nada: null, lista: [{ nome: "x" }], vazia: [] },
  );
});

test("só o vocabulário do protocolo sobrevive à redação", () => {
  assert.deepEqual(forma({ type: "workflow", name: "Boas-vindas" }), { type: "workflow", name: "x" });
});

test("o cassete não guarda nenhum dado de cliente", () => {
  if (!fs.existsSync(FIXTURE)) return;
  const vazando: string[] = [];
  const varrer = (v: unknown, chave = ""): void => {
    if (Array.isArray(v)) v.forEach((x) => varrer(x, chave));
    else if (v && typeof v === "object") Object.entries(v).forEach(([k, x]) => varrer(x, k));
    else if (typeof v === "string" && v !== "x" && !VOCABULARIO.has(chave)) vazando.push(`${chave}=${v}`);
  };
  varrer(JSON.parse(fs.readFileSync(FIXTURE, "utf-8")).respostas);
  assert.deepEqual(vazando, [], "há valor de cliente no cassete — regrave com smoke --gravar");
});

test("as checagens do smoke passam contra o cassete gravado ao vivo", async () => {
  if (!fs.existsSync(FIXTURE)) {
    // Sem cassete não há o que reproduzir. Grave com:
    //   npm run smoke -- -l <loc> --contato <id> --gravar test/fixtures/api-forma.json
    return;
  }
  const cassete = JSON.parse(fs.readFileSync(FIXTURE, "utf-8")) as Cassete;
  const { client, usar } = clienteDoCassete(cassete);
  const gravadas = CHECAGENS.filter((c) => cassete.respostas[c.nome]?.length);
  assert.ok(gravadas.length >= 10, `cassete com só ${gravadas.length} checagem(ns) gravada(s)`);
  const ctx: Contexto = { loc: "L1", companyId: "C1", contato: "K1" };
  const rs = await executar(client, ctx, gravadas.map((c) => ({ ...c, precisa: undefined })),
                            () => {}, { antes: usar });
  const falhas = rs.filter((r) => r.estado === "falhou");
  assert.deepEqual(falhas.map((f) => `${f.nome}: ${f.motivo}`), []);
  assert.equal(resumo(rs).ok, gravadas.length);
});
