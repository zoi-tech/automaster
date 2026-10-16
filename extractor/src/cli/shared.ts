import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { entrarNaFila } from "../auth/lock.js";
import type { Tokens } from "../auth/token.js";
import { GhlClient } from "../api/client.js";
import { stampNow } from "../dump/writer.js";
import { opcoesPadrao, renovarNoFundo, tokensDoFundo } from "../fundo/cliente.js";
import { caminhosDaSessao } from "../fundo/comum.js";
import { marcarRastro } from "../saida.js";

// Mesmo default do auditor (`mcp/base.py:_root`): extrair e ler têm de apontar para a mesma pasta.
export const DUMPS_DIR = process.env.AUTOMASTER_DUMPS || path.join(os.homedir(), ".automaster", "dumps");

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Snapshot mais recente da subconta: só pastas com manifest.json contam. */
export function latestDumpDir(locationId: string): string | undefined {
  try {
    const base = path.join(DUMPS_DIR, locationId);
    const snaps = fs.readdirSync(base).filter((d) => fs.existsSync(path.join(base, d, "manifest.json"))).sort();
    const latest = snaps.at(-1);
    return latest ? path.join(base, latest) : undefined;
  } catch {
    return undefined;
  }
}

/** `raw` de uma entidade do dump mais recente; undefined sem dump ou sem o arquivo. */
export function latestDumpEntity(locationId: string, name: string): unknown {
  const dir = latestDumpDir(locationId);
  if (!dir) return undefined;
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), "utf-8"))?.raw;
  } catch {
    return undefined;
  }
}

/**
 * Tokens do processo de fundo + client, com tokens novos em 401. Nenhum Chrome abre aqui.
 * Com `escrita`, o comando inteiro roda dentro da fila de escrita: espera a vez de outra
 * escrita em andamento.
 */
export async function withClient(
  locationId: string,
  log: (msg: string) => void,
  // `tokens` no callback é para o `runExtract`, que tira o companyId do token-id
  fn: (client: GhlClient, tokens: Tokens) => Promise<void>,
  opcoes: { escrita?: boolean } = {},
): Promise<void> {
  const sairDaFila = opcoes.escrita ? await entrarNaFila(caminhosDaSessao().escrita, log) : () => {};
  try {
    const fundo = opcoesPadrao(log);
    log("Pedindo tokens ao processo de fundo...");
    let atual = await tokensDoFundo(locationId, fundo);
    const refresh = async (): Promise<Tokens> => {
      log("401 — pedindo tokens novos ao processo de fundo...");
      atual = await renovarNoFundo(locationId, atual, fundo);
      return atual;
    };
    await fn(new GhlClient(atual, refresh), atual);
  } finally {
    sairDaFila();
  }
}

/** Grava o rastro de uma escrita que não tem desfazer. */
export function registroEscrita(loc: string, pasta: string, chave: string, dados: unknown): string {
  const dir = path.join(DUMPS_DIR, pasta, loc, chave);
  fs.mkdirSync(dir, { recursive: true });
  const now = new Date();
  const registro = path.join(dir, `${stampNow(now)}${now.getSeconds().toString().padStart(2, "0")}.json`);
  fs.writeFileSync(registro, JSON.stringify({ em: now.toISOString(), ...(dados as object) }, null, 2));
  marcarRastro(registro);
  return registro;
}

/** Igual ao problema de --pagina: valor não numérico viraria NaN no filtro. Ausente fica undefined. */
export function numeroOpcional(v: string | undefined, campo: string, log: (msg: string) => void): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) {
    log(`aviso: --${campo} ${v} inválido, ignorado.`);
    return undefined;
  }
  return n;
}
