import type { GhlClient } from "./client.js";

/**
 * Templates do email builder da subconta. Host `backend.leadconnectorhq.com`,
 * dois tokens da sessão. A lista vem uma pasta por vez: item com
 * `templateType: "folder"` esconde os seus, que só aparecem passando
 * `parentId=<id da pasta>`.
 * Rotas em docs/endpoints.md, seção `## Templates de e-mail`.
 */
const BACKEND = "https://backend.leadconnectorhq.com";

/** O default do servidor é 25; este valor cobre subconta grande sem paginar à toa. */
const PAGINA = 100;

type Item = Record<string, unknown> & { id?: string; templateType?: string };

/** Varre a raiz e desce em cada pasta. `buscar` recebe o parentId (undefined = raiz). */
export async function achatarPastas(
  buscar: (parentId?: string) => Promise<unknown[]>,
): Promise<unknown[]> {
  const vistos = new Set<string>();
  const saida: unknown[] = [];

  const descer = async (parentId?: string): Promise<void> => {
    const itens = (await buscar(parentId)) as Item[];
    const pastas: string[] = [];
    for (const it of itens) {
      const id = String(it.id ?? "");
      if (!id || vistos.has(id)) continue; // pasta que se referencia não vira loop
      vistos.add(id);
      saida.push(it);
      if (it.templateType === "folder") pastas.push(id);
    }
    for (const p of pastas) await descer(p);
  };

  await descer(undefined);
  return saida;
}

/** Uma página por vez da rota, já paginada por offset. */
async function paginar(client: GhlClient, locationId: string, parentId?: string): Promise<unknown[]> {
  const itens: unknown[] = [];
  for (let offset = 0; ; offset += PAGINA) {
    const q = new URLSearchParams({ locationId, limit: String(PAGINA), offset: String(offset) });
    if (parentId) q.set("parentId", parentId);
    const resp = await client.getJson<{ builders?: unknown[] }>(`${BACKEND}/emails/builder?${q}`);
    const pagina = resp.builders ?? [];
    itens.push(...pagina);
    if (pagina.length < PAGINA) break;
  }
  return itens;
}

/** Todos os templates e pastas do email builder, achatados. */
export async function fetchEmailTemplates(
  client: GhlClient, locationId: string,
): Promise<{ builders: unknown[] }> {
  const builders = await achatarPastas((parentId) => paginar(client, locationId, parentId));
  return { builders };
}
