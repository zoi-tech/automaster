import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { PRAZOS } from "../fundo/comum.js";

/**
 * Duas travas de arquivo, no formato `"<pid>"` ou `"<pid> <rótulo>"`:
 *
 * - a do perfil (`~/.automaster/chrome.lock`): de quem abre o perfil persistente do Chrome
 *   (`~/.automaster/chrome-profile`). Dois Chromes no mesmo perfil disputam o `SingletonLock`
 *   e um deles trava; aqui a disputa vira erro na hora, dizendo quem está com o perfil.
 * - a da fila de escrita (`~/.automaster/sessao/escrita.lock`): de quem está escrevendo no GHL.
 *   Quem chega depois espera a vez (`entrarNaFila`) em vez de falhar.
 *
 * Trava órfã (processo morto, ou gravada antes do último boot, quando o pid pode ter sido
 * reaproveitado) é roubada: `process.kill(pid, 0)` não mata, só pergunta se o PID existe.
 */
export function lockPath(): string {
  return path.join(os.homedir(), ".automaster", "chrome.lock");
}

export function vivo(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM = existe, de outro usuário. Só ESRCH significa morto.
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

export class TravaOcupada extends Error {
  constructor(
    readonly pid: number,
    readonly rotulo: string,
    readonly arquivo: string,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "TravaOcupada";
  }
}

/** Linha de comando do processo, para conferir que o pid é mesmo de quem diz ser. */
export function comandoDoPid(pid: number): string | null {
  try {
    return execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}

/** Dono vivo da trava, ou `null` se ela não existe ou é órfã. */
export function lerTrava(arquivo: string): { pid: number; rotulo: string } | null {
  let conteudo: string;
  let mtimeMs: number;
  try {
    conteudo = fs.readFileSync(arquivo, "utf-8");
    mtimeMs = fs.statSync(arquivo).mtimeMs;
  } catch {
    return null;
  }
  const [p, rotulo = ""] = conteudo.trim().split(/\s+/);
  const pid = Number(p);
  if (!Number.isInteger(pid) || pid <= 0 || !vivo(pid)) return null;
  if (mtimeMs < Date.now() - os.uptime() * 1000) return null; // gravada antes do boot
  return { pid, rotulo };
}

function mensagemOcupada(arquivo: string, pid: number, rotulo: string): string {
  switch (rotulo) {
    case "fundo": return `o processo de fundo do automaster já está com o perfil do Chrome (pid ${pid}).`;
    case "discover": return `o discover está com o perfil do Chrome (pid ${pid}): feche a janela dele e repita.`;
    case "escrita": return `outra escrita automaster está em andamento (pid ${pid}).`;
    default:
      return `outro processo automaster está com ${arquivo} (pid ${pid}). Se tiver certeza de que ele morreu, apague ${arquivo}.`;
  }
}

/** Trava; devolve a função que solta. Lança `TravaOcupada` se outro processo vivo está com ela. */
export function travarChrome(arquivo = lockPath(), rotulo = ""): () => void {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    try {
      fs.writeFileSync(arquivo, rotulo ? `${process.pid} ${rotulo}` : String(process.pid), { flag: "wx" });
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const dono = lerTrava(arquivo);
      if (dono && dono.pid !== process.pid) {
        throw new TravaOcupada(dono.pid, dono.rotulo, arquivo, mensagemOcupada(arquivo, dono.pid, dono.rotulo));
      }
      fs.rmSync(arquivo, { force: true }); // órfão
      if (tentativa === 1) throw new Error(`não consegui travar ${arquivo}`, { cause: e });
    }
  }
  let solto = false;
  const soltar = (): void => {
    if (solto) return;
    solto = true;
    try {
      if (fs.readFileSync(arquivo, "utf-8").trim().split(/\s+/)[0] === String(process.pid)) fs.rmSync(arquivo, { force: true });
    } catch {
      /* já sumiu */
    }
  };
  process.once("exit", soltar);
  return soltar;
}

/** Espera a vez na fila de escrita; devolve a função que sai dela. */
export async function entrarNaFila(
  arquivo: string,
  log: (m: string) => void,
  esperaMaxMs: number = PRAZOS.filaEscritaMs,
): Promise<() => void> {
  // ponytail: espera por sondagem a cada 500 ms, sem ordem de chegada; fila de verdade se a disputa virar rotina.
  const limite = Date.now() + esperaMaxMs;
  let avisou = false;
  for (;;) {
    try {
      return travarChrome(arquivo, "escrita");
    } catch (e) {
      if (!(e instanceof TravaOcupada)) throw e;
      if (Date.now() >= limite) {
        throw new Error(
          `a fila de escrita está com o pid ${e.pid} há mais de ${Math.round(esperaMaxMs / 1000)} s; ` +
            `se esse processo travou, encerre-o e repita`,
          { cause: e },
        );
      }
      if (!avisou) {
        avisou = true;
        log(`outra escrita automaster em andamento (pid ${e.pid}); esperando a vez...`);
      }
      await setTimeout(500);
    }
  }
}
