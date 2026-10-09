// Processo de fundo falso: a mesma `executarFundo` do real, com um navegador que não abre Chrome.
// Uso: tsx test/fixtures/fundo-falso.ts <dir> <lock> [perfil]
import fs from "node:fs";
import path from "node:path";
import type { Tokens } from "../../src/auth/token.js";
import { caminhosDaSessao } from "../../src/fundo/comum.js";
import { executarFundo } from "../../src/fundo/processo.js";
import type { Navegador } from "../../src/fundo/servidor.js";

const [dir, lock, perfil] = process.argv.slice(2);
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
fs.writeFileSync(path.join(dir, "debug.txt"), process.env.DEBUG ?? "(nenhum)");

function jwt(payload: Record<string, unknown>): string {
  return `xxx.${Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url")}.yyy`;
}

const navegador: Navegador = {
  async capturar(sub: string): Promise<Tokens> {
    fs.appendFileSync(path.join(dir, "capturas.log"), `${sub}\n`);
    const agora = Math.floor(Date.now() / 1000);
    return {
      bearer: jwt({ exp: agora + 3600 }),
      tokenId: jwt({ exp: agora + 3600, locations: [sub] }),
      cookies: {},
      userAgent: "UA falso",
    };
  },
  esperandoLogin: () => false,
  async fechar(): Promise<void> {
    fs.appendFileSync(path.join(dir, "navegador.log"), "fechado\n");
  },
};

executarFundo({
  caminhos: caminhosDaSessao(dir),
  lock,
  perfil: perfil || "perfil-falso",
  navegador,
  versao: process.env.FUNDO_FALSO_VERSAO ?? "falsa",
  ociosoMs: Number(process.env.FUNDO_FALSO_OCIOSO_MS) || undefined,
  log: console.log,
}).catch((e: unknown) => {
  console.log(`não subiu: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
