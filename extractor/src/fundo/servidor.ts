// Servidor do processo de fundo: entrega tokens pelo socket Unix. Nunca chama o GHL, só
// guarda o par atual e decide quando o navegador precisa capturar de novo.
import fs from "node:fs";
import http from "node:http";
import { payloadDeJwt, type Tokens } from "../auth/token.js";
import { ErroSessao } from "./comum.js";

export const OCIOSO_MS = 4 * 60 * 60 * 1000; // decisão A18
export const MARGEM_MS = 60_000; // decisão A15/A49: vencido ou a menos de 60 s

export interface Navegador {
  /** Navega até a subconta e devolve tokens com cookies e userAgent. */
  capturar(subconta: string): Promise<Tokens>;
  esperandoLogin(): boolean;
  fechar(): Promise<void>;
}

type Motivo = "inicio" | "vencido" | "subconta" | "401";
type Par = { bearer?: unknown; tokenId?: unknown };

class ErroPedido extends Error {}

function lerCorpo(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let txt = "";
    req.setEncoding("utf-8");
    req.on("data", (c: string) => (txt += c));
    req.on("end", () => {
      try {
        const v: unknown = txt ? JSON.parse(txt) : {};
        if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("corpo não é objeto JSON");
        resolve(v as Record<string, unknown>);
      } catch (e) {
        reject(new ErroPedido(`corpo inválido: ${(e as Error).message}`));
      }
    });
    req.on("error", reject);
  });
}

export async function iniciarServidor(o: {
  socket: string;
  navegador: Navegador;
  versao: string;
  perfil: string;
  ociosoMs?: number;
  agora?: () => number;
  log?: (m: string) => void;
  aoEncerrar?: () => void;
}): Promise<{ encerrar(motivo: string): Promise<void> }> {
  const agora = o.agora ?? Date.now;
  const log = o.log ?? (() => {});
  const ociosoMs = o.ociosoMs ?? OCIOSO_MS;

  let atual: Tokens | null = null;
  let emCurso: Promise<Tokens> | null = null;
  // subcontas já recapturadas com o token-id atual: não navegar no app a cada pedido (A7)
  const jaTentadas = new Set<string>();

  function precisa(t: Tokens | null, subconta: string, falho?: Par): Motivo | null {
    if (!t) return "inicio";
    const exps = [payloadDeJwt(t.bearer).exp, payloadDeJwt(t.tokenId).exp].filter(
      (e): e is number => typeof e === "number",
    );
    if (exps.length && Math.min(...exps) * 1000 - agora() < MARGEM_MS) return "vencido";
    const locs = payloadDeJwt(t.tokenId).locations;
    if (Array.isArray(locs) && locs.length && !locs.includes(subconta) && !jaTentadas.has(subconta)) {
      return "subconta";
    }
    if (falho && falho.bearer === t.bearer && falho.tokenId === t.tokenId) return "401";
    return null;
  }

  async function obter(subconta: string, falho?: Par): Promise<Tokens> {
    if (!precisa(atual, subconta, falho)) {
      log(`tokens subconta=${subconta} cache`);
      return atual!;
    }
    while (emCurso) {
      // sem engolir o erro: quem esperava uma captura que falhou recebe o mesmo erro
      await emCurso;
      if (!precisa(atual, subconta, falho)) {
        log(`tokens subconta=${subconta} cache`);
        return atual!;
      }
    }
    const motivo = precisa(atual, subconta, falho)!;
    log(`tokens subconta=${subconta} motivo=${motivo}`);
    const anterior = atual?.tokenId;
    emCurso = o.navegador.capturar(subconta);
    try {
      const t = await emCurso;
      if (t.tokenId !== anterior) jaTentadas.clear();
      atual = t;
      if (motivo === "subconta") jaTentadas.add(subconta);
      return t; // sem reconferir: no máximo uma captura por pedido
    } finally {
      emCurso = null;
    }
  }

  let timer: NodeJS.Timeout | undefined;
  function tocar(): void {
    clearTimeout(timer);
    timer = setTimeout(() => void encerrar("ociosidade"), ociosoMs);
    // o listen já segura o processo; um timer com ref de 4 h prenderia o processo do teste
    timer.unref();
  }

  function responder(res: http.ServerResponse, status: number, corpo: unknown): void {
    const dados = JSON.stringify(corpo);
    res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(dados) });
    res.end(dados);
  }

  async function atender(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const rota = `${req.method} ${req.url}`;
    if (rota === "GET /versao") {
      responder(res, 200, {
        versao: o.versao,
        pid: process.pid,
        perfil: o.perfil,
        esperandoLogin: o.navegador.esperandoLogin(),
      });
      return;
    }
    if (rota === "POST /encerrar") {
      responder(res, 200, { ok: true });
      setImmediate(() => void encerrar("pedido"));
      return;
    }
    if (rota !== "POST /tokens" && rota !== "POST /renovar") {
      responder(res, 404, { code: "erro", message: `rota desconhecida: ${rota}` });
      return;
    }
    let subconta = "";
    try {
      const corpo = await lerCorpo(req);
      if (typeof corpo.subconta !== "string" || !corpo.subconta) throw new ErroPedido("falta `subconta`");
      subconta = corpo.subconta;
      const falho = rota === "POST /renovar" ? { bearer: corpo.bearer, tokenId: corpo.tokenId } : undefined;
      responder(res, 200, await obter(subconta, falho));
    } catch (e) {
      const message = (e as Error).message;
      if (e instanceof ErroPedido) {
        responder(res, 400, { code: "erro", message });
        return;
      }
      const code = e instanceof ErroSessao ? e.codigo : "sessao_indisponivel";
      log(`erro subconta=${subconta} ${code}: ${message}`);
      responder(res, 503, { code, message });
    }
  }

  const server = http.createServer((req, res) => {
    tocar();
    void atender(req, res).finally(tocar);
  });

  let encerrando: Promise<void> | null = null;
  function encerrar(motivo: string): Promise<void> {
    encerrando ??= (async () => {
      log(`encerrando (${motivo})`);
      clearTimeout(timer);
      server.close();
      server.closeAllConnections();
      try {
        await o.navegador.fechar();
      } catch (e) {
        log(`erro ao fechar o navegador: ${(e as Error).message}`);
      }
      fs.rmSync(o.socket, { force: true });
      o.aoEncerrar?.();
    })();
    return encerrando;
  }

  // quem chama já tem a trava do perfil: um arquivo no caminho do socket é sobra de processo morto
  fs.rmSync(o.socket, { force: true });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(o.socket, () => {
      server.off("error", reject);
      resolve();
    });
  });
  fs.chmodSync(o.socket, 0o600);
  tocar();
  return { encerrar };
}
