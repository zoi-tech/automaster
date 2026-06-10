import type { Page } from "playwright";

export interface Tokens {
  bearer: string;
  tokenId: string;
}

const WORKFLOWS_URL = (loc: string) =>
  `https://app.gohighlevel.com/v2/location/${loc}/automation/workflows`;

/**
 * Navega para a aba de workflows e captura, do primeiro request autenticado ao
 * backend, os dois tokens que o app envia: `authorization: Bearer <jwt>` e
 * `token-id: <jwt>`. Usa `page.on('request')` só para observar (não bloqueia o
 * fluxo). Headers vêm de `allHeaders()` (completo) e com chaves lower-case.
 */
export async function captureTokens(page: Page, locationId: string, timeoutMs = 120_000): Promise<Tokens> {
  let resolved: Tokens | null = null;

  const onRequest = async (req: import("playwright").Request) => {
    if (resolved) return;
    const url = req.url();
    if (!url.includes("backend.leadconnectorhq.com/workflow/")) return;
    const h = await req.allHeaders();
    const auth = h["authorization"];
    const tokenId = h["token-id"];
    if (auth?.startsWith("Bearer ") && tokenId) {
      resolved = { bearer: auth.slice("Bearer ".length), tokenId };
    }
  };

  page.on("request", onRequest);
  try {
    await page.goto(WORKFLOWS_URL(locationId), { waitUntil: "domcontentloaded" });
    // espera até um request autenticado ao backend aparecer
    await page.waitForRequest(
      (req) => req.url().includes("backend.leadconnectorhq.com/workflow/"),
      { timeout: timeoutMs },
    );
    // pequena folga para o handler async ler os headers
    const deadline = Date.now() + 5_000;
    while (!resolved && Date.now() < deadline) {
      await page.waitForTimeout(100);
    }
  } finally {
    page.off("request", onRequest);
  }

  if (!resolved) {
    throw new Error(
      "Não capturei os tokens. Faça login na janela do Chrome e confirme acesso à subconta, depois rode de novo.",
    );
  }
  return resolved;
}
