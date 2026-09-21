import { test } from "node:test";
import assert from "node:assert/strict";
import { listarTags, criarTag, renomearTag, apagarTag, acharTag } from "../src/api/tags.js";

interface Chamada { metodo: string; url: string; corpo?: unknown }

function clienteFalso(resposta: unknown) {
  const chamadas: Chamada[] = [];
  const reg = (metodo: string) => (url: string, corpo?: unknown) => {
    chamadas.push({ metodo, url, corpo });
    return Promise.resolve(resposta);
  };
  return {
    chamadas,
    client: { getJson: reg("get"), putJson: reg("put"), postJson: reg("post"), deleteJson: reg("delete") } as never,
  };
}

const BASE = "https://services.leadconnectorhq.com";

test("listarTags normaliza _id para id", async () => {
  const a = clienteFalso({ tags: [{ _id: "T1", name: "alfa" }, { id: "T2", name: "beta" }] });
  const tags = await listarTags(a.client, "L1");
  assert.deepEqual(tags, [{ id: "T1", name: "alfa" }, { id: "T2", name: "beta" }]);
  assert.match(a.chamadas[0].url, new RegExp(`^${BASE}/locations/L1/tags/search\\?`));
});

test("criarTag manda name e devolve a tag de dentro do envelope", async () => {
  const a = clienteFalso({ tag: { id: "T9", name: "nova", color: null } });
  const t = await criarTag(a.client, "L1", "nova");
  assert.deepEqual(t, { id: "T9", name: "nova" });
  assert.equal(a.chamadas[0].metodo, "post");
  assert.equal(a.chamadas[0].url, `${BASE}/locations/L1/tags`);
  assert.deepEqual(a.chamadas[0].corpo, { name: "nova" });
});

test("renomearTag faz PUT no id", async () => {
  const a = clienteFalso({ tag: { id: "T9", name: "depois" } });
  const t = await renomearTag(a.client, "L1", "T9", "depois");
  assert.equal(t.name, "depois");
  assert.equal(a.chamadas[0].metodo, "put");
  assert.equal(a.chamadas[0].url, `${BASE}/locations/L1/tags/T9`);
  assert.deepEqual(a.chamadas[0].corpo, { name: "depois" });
});

test("apagarTag aceita a grafia errada que o servidor devolve", async () => {
  const a = clienteFalso({ succeded: true });
  assert.equal(await apagarTag(a.client, "L1", "T9"), true);
  assert.equal(a.chamadas[0].metodo, "delete");
  assert.equal(a.chamadas[0].url, `${BASE}/locations/L1/tags/T9`);
});

test("acharTag casa por id exato e por nome sem ligar para maiúscula", () => {
  const tags = [{ id: "T1", name: "Alfa Beta" }];
  assert.equal(acharTag(tags, "T1")?.id, "T1");
  assert.equal(acharTag(tags, "alfa beta")?.id, "T1");
  assert.equal(acharTag(tags, "  ALFA BETA ")?.id, "T1");
  assert.equal(acharTag(tags, "gama"), undefined);
});
