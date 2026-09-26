import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Trava única do perfil persistente do Chrome.
 *
 * O perfil (`~/.automaster/chrome-profile`) é um só: dois comandos de escrita ao vivo
 * em paralelo disputam o `SingletonLock` do Chrome e um deles trava ou grava no lugar
 * errado — aconteceu ao vivo na 0.12.0. Aqui a corrida vira erro na hora, com o PID de
 * quem está segurando.
 *
 * Lock órfão (processo morto sem soltar) é roubado: `process.kill(pid, 0)` não mata,
 * só pergunta se o PID existe.
 */
export function lockPath(): string {
  return path.join(os.homedir(), ".automaster", "chrome.lock");
}

function vivo(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM = existe, de outro usuário. Só ESRCH significa morto.
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Trava; devolve a função que solta. Lança se outro processo vivo está com ela. */
export function travarChrome(arquivo = lockPath()): () => void {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    try {
      fs.writeFileSync(arquivo, String(process.pid), { flag: "wx" });
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const dono = Number(fs.readFileSync(arquivo, "utf-8").trim());
      if (Number.isFinite(dono) && dono !== process.pid && vivo(dono)) {
        throw new Error(
          `outro comando automaster já está com o Chrome (pid ${dono}). A escrita ao vivo é serial: ` +
            `espere ele terminar. Se tiver certeza de que morreu, apague ${arquivo}.`,
          { cause: e },
        );
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
      if (fs.readFileSync(arquivo, "utf-8").trim() === String(process.pid)) fs.rmSync(arquivo, { force: true });
    } catch {
      /* já sumiu */
    }
  };
  process.once("exit", soltar);
  return soltar;
}
