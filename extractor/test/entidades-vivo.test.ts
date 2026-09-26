import { test } from "node:test";
import assert from "node:assert/strict";
import { lerEntidadesAoVivo } from "../src/api/entidades-vivo.js";

test("uma rota que falha não derruba as outras", async () => {
  const client = {
    getJson: async (url: string) => {
      if (url.includes("/users/search")) throw new Error("403");
      if (url.includes("/tags/search")) return { tags: [{ name: "nova" }] };
      if (url.includes("/workflow/")) return { rows: [] };
      return {};
    },
  } as any;
  const r = await lerEntidadesAoVivo(client, "L1", "C1");
  assert.deepEqual(r.falhas, ["users"]);
  assert.deepEqual(r.entidades.tags, { tags: [{ name: "nova" }] });
  assert.ok(!("users" in r.entidades));
});
