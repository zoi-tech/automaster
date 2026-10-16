import os from "node:os";
import path from "node:path";
import { chromium, type BrowserContext } from "playwright";
import { travarChrome } from "../auth/lock.js";

/** Perfil só para fotografar telas: login próprio, separado do perfil do processo de fundo. */
export interface PerfilTela {
  context: BrowserContext;
  fechar(): Promise<void>;
}

type Lancar = (dir: string, options: Record<string, unknown>) => Promise<BrowserContext>;

export async function abrirPerfilDeTela(
  opts: { visivel: boolean },
  lancar: Lancar = chromium.launchPersistentContext as unknown as Lancar,
): Promise<PerfilTela> {
  const raiz = path.join(os.homedir(), ".automaster");
  const dir = process.env.AUTOMASTER_PERFIL_TELA || path.join(raiz, "perfil-tela");
  const soltar = travarChrome(path.join(raiz, "perfil-tela.lock"), "perfil-tela");
  let context: BrowserContext;
  try {
    context = await lancar(dir, { channel: "chrome", headless: !opts.visivel, viewport: { width: 1440, height: 900 } });
  } catch (e) {
    soltar();
    throw e;
  }
  let fechado = false;
  return {
    context,
    async fechar() {
      if (fechado) return;
      fechado = true;
      try {
        // páginas primeiro: context.close() direto marca o perfil como Crashed
        for (const p of context.pages()) await p.close().catch(() => {});
        await context.close();
      } finally {
        soltar();
      }
    },
  };
}
