import { setTimeout as sleep } from "node:timers/promises";
import type { Tokens } from "../auth/token.js";
import { marcarEscrita } from "../saida.js";

export const UA_PADRAO =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

type Metodo = "get" | "put" | "post" | "delete";

/** O mínimo de uma resposta do `fetch` que o cliente usa. */
interface Resposta {
  status: number;
  ok: boolean;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

/**
 * Cliente da API interna GHL. Envia sempre os dois tokens + headers obrigatórios
 * (channel/source/version/UA). Em 401, chama `onRefresh` (que recaptura tokens)
 * uma vez e repete. Em 429, faz backoff. Throttle entre chamadas validado no spike.
 */
export class GhlClient {
  private tokens: Tokens;
  /** Respostas desde o último `coletar()`. Ligado só pelo `smoke --gravar`. */
  private espiadas: unknown[] | undefined;
  private throttleMs: number;
  private backoffMs: number;
  private timeoutMs: number;
  constructor(
    tokens: Tokens,
    private onRefresh: () => Promise<Tokens>,
    opcoes: { throttleMs?: number; backoffMs?: number; timeoutMs?: number } = {},
  ) {
    this.tokens = tokens;
    this.throttleMs = opcoes.throttleMs ?? 200;
    this.backoffMs = opcoes.backoffMs ?? 1000;
    this.timeoutMs = opcoes.timeoutMs ?? 30_000;
  }

  /** Liga a espia: daqui em diante toda resposta ok é acumulada para `coletar()`. */
  espiar(): void {
    this.espiadas = [];
  }

  /** Devolve o que chegou desde a última chamada e zera. Vazio quando a espia está desligada. */
  coletar(): unknown[] {
    const r = this.espiadas ?? [];
    if (this.espiadas) this.espiadas = [];
    return r;
  }

  private guardar<T>(r: T): T {
    this.espiadas?.push(r);
    return r;
  }

  private authHeaders(url: string): Record<string, string> {
    const h: Record<string, string> = {
      authorization: `Bearer ${this.tokens.bearer}`,
      "token-id": this.tokens.tokenId,
      channel: "APP",
      source: "WEB_USER",
      version: "2021-07-28",
      "user-agent": this.tokens.userAgent ?? UA_PADRAO,
      accept: "application/json",
    };
    const cookie = this.tokens.cookies?.[new URL(url).host];
    if (cookie) h.cookie = cookie;
    return h;
  }

  /** Um pedido HTTP pelo `fetch` do Node. */
  private async enviar(
    metodo: Metodo, url: string, headers: Record<string, string>, corpo: { json?: unknown; form?: FormData } = {},
  ): Promise<Resposta> {
    try {
      const r = await fetch(url, {
        method: metodo.toUpperCase(),
        headers,
        body: corpo.form ?? (corpo.json === undefined ? undefined : JSON.stringify(corpo.json)),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return { status: r.status, ok: r.ok, json: () => r.json() as Promise<unknown>, text: () => r.text() };
    } catch (e) {
      if (e instanceof Error && e.name === "TimeoutError") {
        throw new Error(`${metodo.toUpperCase()} ${url} → tempo esgotado (${this.timeoutMs / 1000} s)`, { cause: e });
      }
      throw e;
    }
  }

  /** Chamada autenticada com JSON. Trata 401 (refresh 1x) e 429 (backoff). */
  private async request<T>(method: Metodo, url: string, body?: unknown): Promise<T> {
    await sleep(this.throttleMs);
    if (method !== "get") marcarEscrita();
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      const headers = body === undefined ? this.authHeaders(url) : { ...this.authHeaders(url), "content-type": "application/json" };
      const res = await this.enviar(method, url, headers, { json: body });
      if (res.ok) return this.guardar((await res.json().catch(() => ({}))) as T);

      const status = res.status;
      if (status === 401 && !refreshed) {
        this.tokens = await this.onRefresh();
        refreshed = true;
        continue;
      }
      if (status === 429 && attempt < 4) {
        await sleep(this.backoffMs * (attempt + 1));
        continue;
      }
      throw new Error(`${method.toUpperCase()} ${url} → HTTP ${status} ${await safeBody(res)}`);
    }
  }

  getJson<T = unknown>(url: string): Promise<T> { return this.request<T>("get", url); }
  putJson<T = unknown>(url: string, body: unknown): Promise<T> { return this.request<T>("put", url, body); }
  postJson<T = unknown>(url: string, body: unknown): Promise<T> { return this.request<T>("post", url, body); }
  deleteJson<T = unknown>(url: string, body?: unknown): Promise<T> { return this.request<T>("delete", url, body); }

  /**
   * POST multipart. Mesmo tratamento de 401/429 do JSON; o `content-type` (com
   * boundary) é montado pelo `fetch` a partir do FormData — nunca defina à mão.
   */
  async postMultipart<T = unknown>(
    url: string, form: FormData, extraHeaders: Record<string, string> = {},
  ): Promise<T> {
    await sleep(this.throttleMs);
    marcarEscrita();
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      const headers = { ...this.authHeaders(url), ...extraHeaders };
      const res = await this.enviar("post", url, headers, { form });
      if (res.ok) return this.guardar((await res.json().catch(() => ({}))) as T);

      const status = res.status;
      if (status === 401 && !refreshed) {
        this.tokens = await this.onRefresh();
        refreshed = true;
        continue;
      }
      if (status === 429 && attempt < 4) {
        await sleep(this.backoffMs * (attempt + 1));
        continue;
      }
      throw new Error(`POST ${url} → HTTP ${status} ${await safeBody(res)}`);
    }
  }

  /** GET sem auth (para URLs pré-assinadas do Firebase). */
  async getJsonNoAuth<T = unknown>(url: string): Promise<T> {
    // nunca auth nem cookie: a URL pré-assinada do Firebase não pode receber token do GHL
    const res = await this.enviar("get", url, { "user-agent": this.tokens.userAgent ?? UA_PADRAO, accept: "application/json" });
    if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
    return this.guardar((await res.json()) as T);
  }
}

async function safeBody(res: Resposta): Promise<string> {
  try {
    return (await res.text()).slice(0, 200);
  } catch {
    return "";
  }
}
