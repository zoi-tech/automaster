/**
 * PROVA AO VIVO, DESCARTÁVEL — apagar depois de rodar.
 *
 * Pergunta: o PUT de rename de tag da subconta propaga o nome novo para os workflows que
 * citam a tag (step add_contact_tag e trigger contact_tag), como a interface do app faz
 * desde 15/05/2024, ou deixa a referência apontando para um nome que não existe mais?
 *
 * Roteiro: cria tag descartável, cria workflow draft com um step que adiciona a tag e um
 * trigger que dispara com ela, renomeia a tag pela API, relê workflow e trigger, limpa tudo.
 */
import { openSession } from "./src/auth/session.js";
import { captureTokens, decodeUserId, type Tokens } from "./src/auth/token.js";
import { GhlClient } from "./src/api/client.js";
import {
  listarPastas, criarWorkflow, nascerVisivel, salvarWorkflow, apagarWorkflow,
  criarTrigger, listarTriggers, lerDocumento,
} from "./src/api/workflows-write.js";
import { criarStep, montarCorpo } from "./src/api/workflow-edit.js";

const LOC = "Xb9gDxwxYhdqtprGcb5E";
const SERVICES = "https://services.leadconnectorhq.com";
const TAG_VELHA = "zz-prova-rename-automaster";
const TAG_NOVA = "zz-prova-rename-automaster-2";

const p = (...a: unknown[]) => console.log(...a);

const { context, page } = await openSession();
const corpoPrincipal = async (client: GhlClient, tokens: Tokens) => {
  const usuarioId = decodeUserId(tokens.bearer, tokens.tokenId);
  let tagId: string | undefined;
  let wid: string | undefined;
  try {
    // 1. tag descartável
    const tag = await client.postJson<any>(`${SERVICES}/locations/${LOC}/tags`, { name: TAG_VELHA });
    tagId = tag?.tag?.id ?? tag?.tag?._id ?? tag?.id;
    p("1. tag criada:", JSON.stringify(tag));
    if (!tagId) throw new Error("sem id de tag na resposta");

    // 2. workflow draft numa pasta
    const pastas = await listarPastas(client, LOC);
    p("2. pastas:", pastas.length, pastas[0]?.name);
    const novo = await criarWorkflow(client, LOC, { name: "ZZ PROVA RENAME TAG", parentId: pastas[0].id }) as any;
    wid = novo?.id ?? novo?._id ?? novo?.workflow?.id;
    p("   workflow:", wid);
    p("   visivel:", JSON.stringify(await nascerVisivel(client, LOC, wid!, pastas[0].id, usuarioId)));

    // 3. step add_contact_tag citando a tag
    const doc = await lerDocumento(client, LOC, wid!);
    const r = criarStep(doc, {
      type: "add_contact_tag", name: "ZZ põe a tag", attributes: { tags: [TAG_VELHA] },
    });
    await salvarWorkflow(client, LOC, wid!, montarCorpo(doc, r.doc, usuarioId));
    p("3. step criado:", r.mudancas.join("; "));

    // 4. trigger contact_tag citando a tag
    const t = await criarTrigger(client, LOC, wid!, {
      type: "contact_tag", name: "ZZ tag adicionada",
      conditions: [{ operator: "index-of-true", field: "tagsAdded", value: TAG_VELHA,
                     title: "Tag adicionada", type: "select", id: "tag-added" }],
    });
    p("4. trigger criado:", JSON.stringify(t));

    // 5. RENOMEIA pela API
    const ren = await client.putJson<any>(`${SERVICES}/locations/${LOC}/tags/${tagId}`, { name: TAG_NOVA });
    p("5. rename:", JSON.stringify(ren));

    // 6. relê os dois lados
    await new Promise((r) => setTimeout(r, 3000)); // dá tempo de uma propagação assíncrona
    const depois = await lerDocumento(client, LOC, wid!);
    const step = (depois.workflowData?.templates ?? []).find((s: any) => s.type === "add_contact_tag");
    const trigs = await listarTriggers(client, LOC, wid!);
    p("");
    p("=== VEREDITO ===");
    p("step.attributes.tags   :", JSON.stringify(step?.attributes?.tags));
    p("trigger conditions     :", JSON.stringify(trigs.map((x: any) => x?.conditions)));
    p("esperado se propagou   :", JSON.stringify([TAG_NOVA]));
    p("PROPAGOU no step?      :", step?.attributes?.tags?.[0] === TAG_NOVA);
    p("PROPAGOU no trigger?   :", JSON.stringify(trigs).includes(TAG_NOVA));
    p("tags da subconta agora :", JSON.stringify(
      ((await client.getJson<any>(`${SERVICES}/locations/${LOC}/tags/search?skip=0&limit=10000&query=zz-prova&getCount=true`))?.tags ?? [])
        .map((x: any) => x.name)));
  } finally {
    // 7. limpeza
    if (wid) { try { await apagarWorkflow(client, LOC, wid, usuarioId); p("7. workflow apagado"); } catch (e) { p("!! workflow NÃO apagado", wid, e); } }
    if (tagId) { try { p("7. tag apagada:", JSON.stringify(await client.deleteJson(`${SERVICES}/locations/${LOC}/tags/${tagId}`))); } catch (e) { p("!! tag NÃO apagada", tagId, e); } }
  }
};

try {
  p("Capturando tokens (faça login no Chrome, se pedido)...");
  let tokens = await captureTokens(page, LOC);
  const refresh = async (): Promise<Tokens> => {
    p("401 — recapturando tokens...");
    await page.reload({ waitUntil: "domcontentloaded" });
    tokens = await captureTokens(page, LOC);
    return tokens;
  };
  await corpoPrincipal(new GhlClient(context, tokens, refresh), tokens);
} finally {
  await context.close();
}
