// Processo de fundo falso: a mesma `executarFundo` do real, com um navegador que não abre Chrome.
// Uso: tsx test/fixtures/fundo-falso.ts <dir> <lock> [perfil]
import fs from "node:fs";
import path from "node:path";
import type { Tokens } from "../../src/auth/token.js";
import { caminhosDaSessao, ErroSessao } from "../../src/fundo/comum.js";
import { executarFundo } from "../../src/fundo/processo.js";
import type { Navegador } from "../../src/fundo/servidor.js";

const [dir, lock, perfil] = process.argv.slice(2);
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
fs.writeFileSync(path.join(dir, "debug.txt"), process.env.DEBUG ?? "(nenhum)");

function jwt(payload: Record<string, unknown>): string {
  return `xxx.${Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url")}.yyy`;
}

// Modos por FUNDO_FALSO_MODO, aplicados depois de anotar a captura em capturas.log.
const modo = process.env.FUNDO_FALSO_MODO ?? "";
const nunca = (): Promise<never> => new Promise(() => {});
let esperando = false;
let seq = 0; // cada captura devolve um par diferente, mesmo no mesmo segundo

const navegador: Navegador = {
  async capturar(sub: string): Promise<Tokens> {
    fs.appendFileSync(path.join(dir, "capturas.log"), `${sub}\n`);
    switch (modo) {
      case "morre-uma-vez": {
        const marca = path.join(dir, "morreu");
        if (!fs.existsSync(marca)) {
          fs.writeFileSync(marca, "");
          process.exit(1);
        }
        break;
      }
      case "morre-sempre":
        process.exit(1);
        break;
      case "login":
        esperando = true;
        await new Promise((r) => setTimeout(r, Number(process.env.FUNDO_FALSO_LOGIN_MS) || 800));
        esperando = false;
        break;
      case "mudo":
        return nunca();
      case "login-mudo":
        esperando = true;
        return nunca();
      case "erro-login":
        throw new ErroSessao("login_pendente", "falso pediu login");
      case "sai-devagar":
        // o socket some na hora; a trava só é solta pelo exit, 1 s depois
        fs.rmSync(caminhosDaSessao(dir).socket, { force: true });
        setTimeout(() => process.exit(0), 1000);
        throw new Error("saindo");
    }
    const agora = Math.floor(Date.now() / 1000);
    seq++;
    return {
      bearer: jwt({ exp: agora + 3600, seq }),
      tokenId: jwt({ exp: agora + 3600, locations: [sub], seq }),
      cookies: {},
      userAgent: "UA falso",
    };
  },
  esperandoLogin: () => esperando,
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
