import type { Page, Request } from "playwright";

export interface Tokens {
  bearer: string;
  tokenId: string;
}

/** Payload de um JWT, sem verificar assinatura. `{}` quando o texto não é um JWT. */
function payloadDeJwt(token: string): Record<string, unknown> {
  try {
    const parte = token.split(".")[1];
    if (!parte) return {};
    return JSON.parse(Buffer.from(parte, "base64url").toString("utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Extrai o company_id do JWT `token-id` (necessário para o endpoint de usuários). */
export function decodeCompanyId(tokenId: string): string {
  const v = payloadDeJwt(tokenId).company_id;
  return typeof v === "string" ? v : "";
}

/**
 * Id do usuário logado, para carimbar autoria nas escritas de workflow. Procura nos dois
 * tokens porque o app manda o mesmo usuário em claims de nomes diferentes conforme o
 * emissor. Vazio = não deu para saber; quem chama exige `--usuario` nesse caso.
 */
export function decodeUserId(bearer: string, tokenId: string): string {
  for (const p of [payloadDeJwt(bearer), payloadDeJwt(tokenId)]) {
    for (const chave of ["user_id", "userId", "sub"]) {
      const v = p[chave];
      if (typeof v === "string" && v) return v;
    }
  }
  return "";
}

const WORKFLOWS_URL = (loc: string) =>
  `https://app.gohighlevel.com/v2/location/${loc}/automation/workflows`;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Captura os dois tokens (`authorization: Bearer` + `token-id`) que o app envia
 * aos serviços do GHL. Observa via `page.on('request')` (não bloqueia). Aceita
 * qualquer request autenticado a `leadconnectorhq.com` — após o login o dashboard
 * já dispara requests com ambos os tokens, então não dependemos de chegar à aba
 * de workflows. Espera até `timeoutMs` para dar tempo de login manual (inclui 2FA).
 */
export async function captureTokens(page: Page, locationId: string, timeoutMs = 300_000): Promise<Tokens> {
  let resolved: Tokens | null = null;

  const onRequest = async (req: Request) => {
    if (resolved) return;
    const url = req.url();
    if (!url.includes("leadconnectorhq.com")) return;
    try {
      const h = await req.allHeaders();
      const auth = h["authorization"];
      const tokenId = h["token-id"];
      if (auth?.startsWith("Bearer ") && tokenId) {
        resolved = { bearer: auth.slice("Bearer ".length), tokenId };
      }
    } catch {
      // request pode ter sido descartado; ignora
    }
  };

  page.on("request", onRequest);
  try {
    await page.goto(WORKFLOWS_URL(locationId), { waitUntil: "domcontentloaded" }).catch(() => {});

    const deadline = Date.now() + timeoutMs;
    let reNavigated = false;
    while (!resolved && Date.now() < deadline) {
      await sleep(500);
      // se o login já aconteceu mas paramos noutra tela, força a aba de workflows 1x
      if (!reNavigated && page.url().includes(`/location/${locationId}`) && !page.url().includes("/automation/")) {
        reNavigated = true;
        await page.goto(WORKFLOWS_URL(locationId), { waitUntil: "domcontentloaded" }).catch(() => {});
      }
    }
  } finally {
    page.off("request", onRequest);
  }

  if (!resolved) {
    throw new Error(
      "Não capturei os tokens. Faça login na janela do Chrome e abra a subconta, depois rode de novo.",
    );
  }
  return resolved;
}
