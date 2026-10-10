// Comando `sessao`: exercita o processo de fundo de verdade antes de qualquer comando depender dele.
import { Command } from "commander";
import {
  encerrarFundo, estadoDoFundo, garantirFundo, opcoesPadrao, renovarNoFundo, tokensDoFundo,
  type OpcoesFundo,
} from "../fundo/cliente.js";
import { caminhosDaSessao } from "../fundo/comum.js";
import { payloadDeJwt, type Tokens } from "../auth/token.js";
import { emitir, falhar } from "../saida.js";

async function status(o: OpcoesFundo): Promise<Record<string, unknown>> {
  const e = await estadoDoFundo(o);
  const { socket, log, logins } = caminhosDaSessao();
  return {
    rodando: !!e,
    pid: e?.pid ?? null,
    versao: e?.versao ?? null,
    perfil: e?.perfil ?? null,
    esperandoLogin: e?.esperandoLogin ?? false,
    versaoDoCodigo: o.versao,
    perfilEsperado: o.perfil,
    atualizado: e?.versao === o.versao && e?.perfil === o.perfil,
    socket,
    log,
    logins,
  };
}

/** Só o resumo do par: os tokens nunca saem daqui. */
function resumo(loc: string, t: Tokens): Record<string, unknown> {
  const exp = (jwt: string): string | null => {
    const v = payloadDeJwt(jwt).exp;
    return typeof v === "number" ? new Date(v * 1000).toISOString() : null;
  };
  const locations = payloadDeJwt(t.tokenId).locations;
  return {
    expBearer: exp(t.bearer),
    expTokenId: exp(t.tokenId),
    subcontaNaLista: Array.isArray(locations) && locations.includes(loc),
    hostsComCookie: Object.keys(t.cookies ?? {}),
    userAgent: t.userAgent,
  };
}

async function runSessao(opts: { acao: string; location?: string; json?: boolean }): Promise<void> {
  const log = opts.json ? console.error : console.log;
  const precisaLoc = opts.acao === "tokens" || opts.acao === "renovar";
  if (!["status", "subir", "encerrar", "tokens", "renovar"].includes(opts.acao)) {
    throw new Error("--acao aceita status, subir, encerrar, tokens ou renovar");
  }
  if (precisaLoc && !opts.location) throw new Error("--acao tokens e renovar exigem -l <locationId>");
  const o = opcoesPadrao(log);
  const loc = opts.location ?? "";
  let out: unknown;
  switch (opts.acao) {
    case "status": out = await status(o); break;
    case "subir": await garantirFundo(o); out = await status(o); break;
    case "encerrar": out = { encerrado: await encerrarFundo(o) }; break;
    case "tokens": out = resumo(loc, await tokensDoFundo(loc, o)); break;
    case "renovar": out = resumo(loc, await renovarNoFundo(loc, await tokensDoFundo(loc, o), o)); break;
  }
  emitir(opts.json, out);
}

export function registrarSessao(program: Command): void {
  program
    .command("sessao")
    .description("processo de fundo que segura o Chrome invisível: status, subir, encerrar, tokens ou renovar")
    .option("--acao <a>", "status | subir | encerrar | tokens | renovar", "status")
    .option("-l, --location <id>", "locationId da subconta (exigido por tokens e renovar)")
    .option("--json", "imprime o resultado em JSON no stdout")
    .action((o) => runSessao(o).catch(falhar));
}
