import type { GhlClient } from "./client.js";

/**
 * Escrita de formulários e surveys. Host `services.` — é o que o app usa
 * (FORM_SERVER_URL no bundle do builder). Rotas em docs/endpoints.md,
 * seção `## Formulários e surveys`.
 *
 * O documento inteiro vai no corpo do POST; o servidor grava a versão no
 * Cloud Storage sozinho e devolve o `versionHistory` atualizado.
 */
const BASE = "https://services.leadconnectorhq.com";

export type Tipo = "formulario" | "survey";

/** `forms` ou `surveys` — o segmento de rota de cada tipo. */
function rota(tipo: Tipo): string {
  return tipo === "survey" ? "surveys" : "forms";
}

export interface CriarOpts {
  locationId: string;
  productType: "Form" | "Survey" | "Quiz";
  parentId?: string;
}

/** Cria o objeto vazio e devolve a resposta crua (traz `form._id`). */
export function criar(client: GhlClient, tipo: Tipo, o: CriarOpts): Promise<unknown> {
  return client.postJson(`${BASE}/${rota(tipo)}/`, {
    locationId: o.locationId,
    productType: o.productType,
    source: "landing_page",
    ...(o.parentId ? { parentId: o.parentId } : {}),
  });
}

/** Republica o documento inteiro. É POST, não PUT. */
export function publicar(
  client: GhlClient, tipo: Tipo, id: string, nome: string, formData: unknown,
): Promise<unknown> {
  return client.postJson(`${BASE}/${rota(tipo)}/${encodeURIComponent(id)}`, { name: nome, formData });
}

export function apagar(client: GhlClient, tipo: Tipo, id: string): Promise<unknown> {
  return client.deleteJson(`${BASE}/${rota(tipo)}/${encodeURIComponent(id)}`);
}

export function duplicar(
  client: GhlClient, tipo: Tipo, id: string, nome: string, folderId?: string,
): Promise<unknown> {
  return client.postJson(`${BASE}/${rota(tipo)}/duplicate/${encodeURIComponent(id)}`, {
    name: nome, ...(folderId ? { folderId } : {}),
  });
}

/** Volta o objeto para uma versão do `versionHistory`. */
export function restaurarVersao(
  client: GhlClient, tipo: Tipo, id: string, versionId: string,
): Promise<unknown> {
  const chave = tipo === "survey" ? "surveyId" : "formId";
  return client.postJson(`${BASE}/${rota(tipo)}/restore-version`, { [chave]: id, versionId });
}

/**
 * Documento de uma versão. A URL do `versionHistory` é pública no Cloud
 * Storage: baixa SEM auth, como os steps de workflow.
 */
export function baixarVersao(client: GhlClient, url: string): Promise<unknown> {
  return client.getJsonNoAuth(url);
}

export function paletaPadrao(client: GhlClient, locationId: string): Promise<unknown> {
  return client.getJson(`${BASE}/forms/default-colors?locationId=${encodeURIComponent(locationId)}`);
}

export function gravarPaletaPadrao(
  client: GhlClient, locationId: string, colors: unknown,
): Promise<unknown> {
  return client.postJson(`${BASE}/forms/default-colors`, { locationId, colors });
}

export function temas(client: GhlClient, tipo: Tipo, locationId: string): Promise<unknown> {
  return client.getJson(`${BASE}/${rota(tipo)}/themes?locationId=${encodeURIComponent(locationId)}`);
}

export function tema(
  client: GhlClient, tipo: Tipo, locationId: string, themeId: string,
): Promise<unknown> {
  return client.getJson(
    `${BASE}/${rota(tipo)}/theme-style/${encodeURIComponent(themeId)}?locationId=${encodeURIComponent(locationId)}`,
  );
}
