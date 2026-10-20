// O que o processo de fundo e os comandos compartilham: caminhos, prazos, o pedido HTTP
// pelo socket Unix e o registro de logins. Tokens nunca passam por aqui rumo a disco ou log.
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APP_GHL } from "../app-ghl.js";

export interface Caminhos {
  dir: string;
  socket: string;
  log: string;
  logins: string;
  escrita: string;
  estado: string;
}

export const PRAZOS = {
  // primeira tentativa do Chrome invisível antes de concluir que o GHL pediu login
  tentativaInvisivelMs: 30_000,
  // margem de cada abertura do Chrome
  aberturaChromeMs: 10_000,
  // quanto a janela de login espera alguém entrar (4 min e meio, dentro dos "até 5 minutos")
  esperaLoginMs: 270_000,
  // corte do pedido /tokens ou /renovar do comando ao processo de fundo
  pedidoTokensMs: 330_000,
  // espera máxima na fila de escrita
  filaEscritaMs: 120_000,
  // espera pela subida do processo de fundo
  subidaMs: 15_000,
  // espera pelo encerramento de um processo velho. Medido ao vivo: o Chrome invisível parado há
  // uns 20 s leva 20 a 26 s para fechar (perfil novo ou real, com ou sem o GHL aberto); logo
  // depois de abrir fecha em 0,1 s. Matar antes deixaria o perfil "Crashed" (A8).
  encerrarMs: 45_000,
} as const;

export function caminhosDaSessao(dir = path.join(os.homedir(), ".automaster", "sessao")): Caminhos {
  const socket = path.join(dir, "sock");
  const n = Buffer.byteLength(socket);
  if (n > 103) {
    throw new Error(`caminho do socket longo demais (${n} bytes; o macOS aceita 103): ${socket}`);
  }
  return {
    dir,
    socket,
    log: path.join(dir, "fundo.log"),
    logins: path.join(dir, "logins.jsonl"),
    escrita: path.join(dir, "escrita.lock"),
    estado: path.join(dir, "estado-ghl.json"),
  };
}

/** A permissão da pasta é a proteção do socket: só o usuário entra. */
export function prepararDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700); // o `mode` do mkdir não vale para pasta que já existe
}

/** Hash do código do extractor: o comando percebe que o processo de fundo vivo roda código mais velho. */
export function impressaoDigital(
  raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
): string {
  const arquivos = fs
    .readdirSync(raiz, { recursive: true, encoding: "utf-8" })
    .filter((f) => f.endsWith(".ts") || f.endsWith(".js"))
    .sort();
  const h = createHash("sha256");
  for (const f of arquivos) {
    h.update(f);
    h.update("\0");
    h.update(fs.readFileSync(path.join(raiz, f)));
    h.update("\0");
  }
  return h.digest("hex").slice(0, 16);
}

export class ErroSessao extends Error {
  constructor(
    readonly codigo: "login_pendente" | "sessao_indisponivel",
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "ErroSessao";
  }
}

/** HTTP sobre o socket Unix. `code` ETIMEOUT = o processo de fundo demorou; ENOENT/ECONNREFUSED = caiu. */
export function pedir(
  socket: string,
  metodo: "GET" | "POST",
  caminho: string,
  corpo?: unknown,
  timeoutMs = 5000,
): Promise<{ status: number; corpo: any }> {
  return new Promise((resolve, reject) => {
    const dados = corpo === undefined ? undefined : JSON.stringify(corpo);
    const headers: http.OutgoingHttpHeaders = dados === undefined
      ? {}
      : { "content-type": "application/json", "content-length": Buffer.byteLength(dados) };
    const req = http.request(
      { socketPath: socket, path: caminho, method: metodo, agent: false, timeout: timeoutMs, headers },
      (res) => {
        let txt = "";
        res.setEncoding("utf-8");
        res.on("data", (c: string) => (txt += c));
        res.on("end", () => {
          let parsed: any = {};
          if (txt) {
            try {
              parsed = JSON.parse(txt);
            } catch {
              parsed = { message: txt };
            }
          }
          resolve({ status: res.statusCode ?? 0, corpo: parsed });
        });
        res.on("error", reject);
      },
    );
    req.on("timeout", () => {
      const e = Object.assign(
        new Error(`o processo de fundo não respondeu ${metodo} ${caminho} em ${timeoutMs / 1000} s`),
        { code: "ETIMEOUT" },
      );
      req.destroy(e);
    });
    req.on("error", reject);
    req.end(dados);
  });
}

/** O GHL redireciona para `app.gohighlevel.com/?url=<destino>` quando pede login. */
export function ehTelaDeLogin(url: string): boolean {
  try {
    const u = new URL(url);
    return [new URL(APP_GHL).hostname, "app.gohighlevel.com"].includes(u.hostname) && u.pathname === "/" && u.searchParams.has("url");
  } catch {
    return false;
  }
}

export function telaDeOrigem(url: string): string {
  try {
    return new URL(url).searchParams.get("url") ?? "";
  } catch {
    return "";
  }
}

/** Uma linha do registro de logins: horário, tela de origem e se havia navegação antes. */
export function linhaDeLogin(d: {
  via: "fundo" | "withClient";
  motivo: "redirecionamento" | "sem_tokens";
  perfil: string;
  subconta: string;
  url: string;
  navegacoes: number;
  ultima: { em: string; url: string } | null;
  desde: string;
  agora?: Date;
}): Record<string, unknown> {
  return {
    em: (d.agora ?? new Date()).toISOString(),
    via: d.via,
    motivo: d.motivo,
    perfil: d.perfil,
    subconta: d.subconta,
    origem: telaDeOrigem(d.url) || d.url,
    navegouAntes: d.navegacoes > 0,
    navegacoesDesdeSubida: d.navegacoes,
    ultimaNavegacao: d.ultima,
    processoDesde: d.desde,
  };
}

export function registrarLogin(arquivo: string, linha: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true, mode: 0o700 });
  fs.appendFileSync(arquivo, JSON.stringify(linha) + "\n", { mode: 0o600 });
}

/**
 * Só o carregador (`--require`/`--import`) do execArgv, normalizado em `--x=valor` e sem
 * repetição: sem ele o processo de fundo não lê `.ts`; o resto (opções do test runner) não vai junto.
 */
export function argsDoCarregador(execArgv: string[]): string[] {
  const saida: string[] = [];
  for (let i = 0; i < execArgv.length; i++) {
    const a = execArgv[i];
    if (a.startsWith("--require=") || a.startsWith("--import=")) saida.push(a);
    else if ((a === "--require" || a === "--import") && i + 1 < execArgv.length) saida.push(`${a}=${execArgv[++i]}`);
  }
  return [...new Set(saida)];
}
