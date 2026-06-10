import type { APIResponse, BrowserContext } from "playwright";
import type { Tokens } from "../auth/token.js";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Cliente da API interna GHL. Envia sempre os dois tokens + headers obrigatórios
 * (channel/source/version/UA). Em 401, chama `onRefresh` (que recaptura tokens)
 * uma vez e repete. Em 429, faz backoff. Throttle entre chamadas validado no spike.
 */
export class GhlClient {
  private tokens: Tokens;
  constructor(
    private context: BrowserContext,
    tokens: Tokens,
    private onRefresh: () => Promise<Tokens>,
    private throttleMs = 200,
  ) {
    this.tokens = tokens;
  }

  private authHeaders(): Record<string, string> {
    return {
      authorization: `Bearer ${this.tokens.bearer}`,
      "token-id": this.tokens.tokenId,
      channel: "APP",
      source: "WEB_USER",
      version: "2021-07-28",
      "user-agent": UA,
      accept: "application/json",
    };
  }

  /** GET autenticado com JSON de resposta. Trata 401 (refresh 1x) e 429 (backoff). */
  async getJson<T = unknown>(url: string): Promise<T> {
    await sleep(this.throttleMs);
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      const res = await this.context.request.get(url, { headers: this.authHeaders() });
      if (res.ok()) return (await res.json()) as T;

      const status = res.status();
      if (status === 401 && !refreshed) {
        this.tokens = await this.onRefresh();
        refreshed = true;
        continue;
      }
      if (status === 429 && attempt < 4) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      throw new Error(`GET ${url} → HTTP ${status} ${await safeBody(res)}`);
    }
  }

  /** GET sem auth (para URLs pré-assinadas do Firebase). */
  async getJsonNoAuth<T = unknown>(url: string): Promise<T> {
    const res = await this.context.request.get(url, { headers: { "user-agent": UA, accept: "application/json" } });
    if (!res.ok()) throw new Error(`GET ${url} → HTTP ${res.status()}`);
    return (await res.json()) as T;
  }
}

async function safeBody(res: APIResponse): Promise<string> {
  try {
    return (await res.text()).slice(0, 200);
  } catch {
    return "";
  }
}
