import { test } from "node:test";
import assert from "node:assert/strict";
import { achatarPastas } from "../src/api/emails.js";

test("achatarPastas desce nas pastas e preserva parentId", async () => {
  const paginas: Record<string, unknown[]> = {
    "": [
      { id: "t1", name: "Solto", templateType: "html" },
      { id: "f1", name: "Pasta", templateType: "folder" },
    ],
    f1: [{ id: "t2", name: "Dentro", templateType: "html", parentId: "f1" }],
  };
  const buscar = async (parentId?: string) => paginas[parentId ?? ""] ?? [];
  const itens = await achatarPastas(buscar);
  assert.deepEqual(itens.map((i: any) => i.id), ["t1", "f1", "t2"]);
  assert.equal((itens[2] as any).parentId, "f1");
});

test("achatarPastas nao entra em loop com pasta que se referencia", async () => {
  const buscar = async () => [{ id: "f1", templateType: "folder" }];
  const itens = await achatarPastas(buscar);
  assert.equal(itens.length, 1);
});
