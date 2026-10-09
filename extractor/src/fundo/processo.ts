// O processo de fundo: dono do perfil do Chrome, serve os tokens pelo socket até ser encerrado.
import { travarChrome } from "../auth/lock.js";
import { prepararDir, type Caminhos } from "./comum.js";
import { iniciarServidor, type Navegador } from "./servidor.js";

export async function executarFundo(o: {
  caminhos: Caminhos;
  lock: string;
  perfil: string;
  navegador: Navegador;
  versao: string;
  ociosoMs?: number;
  log: (m: string) => void;
}): Promise<void> {
  prepararDir(o.caminhos.dir);
  // antes do socket: o segundo processo numa corrida cai aqui (TravaOcupada) sem tocar no socket do primeiro
  const soltar = travarChrome(o.lock, "fundo");
  const srv = await iniciarServidor({
    socket: o.caminhos.socket,
    navegador: o.navegador,
    versao: o.versao,
    perfil: o.perfil,
    ociosoMs: o.ociosoMs,
    log: o.log,
    aoEncerrar: () => {
      // SIGTERM/SIGINT não disparam o `exit` em que travarChrome pendura a soltura (A24)
      soltar();
      process.exit(0);
    },
  });
  process.once("SIGTERM", () => void srv.encerrar("SIGTERM"));
  process.once("SIGINT", () => void srv.encerrar("SIGINT"));
  o.log(`subiu (pid ${process.pid}, perfil ${o.perfil}, versão ${o.versao})`);
}
