// Entrada do processo de fundo. Uso: main.ts [dir] [lock] [perfil]; o stdout vai para fundo.log.
import { lockPath } from "../auth/lock.js";
import { defaultUserDataDir } from "../auth/session.js";
import { ChromeDeFundo } from "./chrome.js";
import { caminhosDaSessao, impressaoDigital } from "./comum.js";
import { executarFundo } from "./processo.js";

const [dir, lock, perfil] = process.argv.slice(2);
const caminhos = caminhosDaSessao(dir || undefined);
const log = (m: string): void => console.log(`${new Date().toISOString()} ${m}`);
const p = perfil || defaultUserDataDir();
executarFundo({
  caminhos,
  lock: lock || lockPath(),
  perfil: p,
  versao: impressaoDigital(),
  log,
  navegador: new ChromeDeFundo(p, caminhos.logins, log, undefined, undefined, caminhos.estado),
}).catch((e: unknown) => {
  log(`não subiu: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
