import { chromium, type BrowserContext, type Page } from "playwright";
import os from "node:os";
import path from "node:path";
import { donoDoPerfil } from "../fundo/chrome.js";
import { lockPath, travarChrome } from "./lock.js";

export interface Session {
  context: BrowserContext;
  page: Page;
  /** Solta a trava do perfil. Quem abre chama junto com o `context.close()`. */
  soltar: () => void;
}

export const HOSTS_API = ["backend.leadconnectorhq.com", "services.leadconnectorhq.com"];

/** Cookies do perfil prontos para o cabeçalho `cookie`, por host; host sem cookie fica de fora. */
export async function cabecalhosCookie(
  contexto: Pick<BrowserContext, "cookies">, hosts = HOSTS_API,
): Promise<Record<string, string>> {
  const r: Record<string, string> = {};
  for (const host of hosts) {
    const linha = (await contexto.cookies(`https://${host}/`)).map((c) => `${c.name}=${c.value}`).join("; ");
    if (linha) r[host] = linha;
  }
  return r;
}

/** Diretório do perfil persistente do Chrome (fora do repo). */
export function defaultUserDataDir(): string {
  return path.join(os.homedir(), ".automaster", "chrome-profile");
}

/**
 * Abre Chrome visível com perfil persistente, só para o `discover` (observar requests).
 * Os outros comandos pedem os tokens ao processo de fundo e nunca abrem Chrome.
 * `launchPersistentContext` retorna o context (não a page).
 */
export async function openSession(userDataDir = defaultUserDataDir(), rotulo = ""): Promise<Session> {
  const dono = donoDoPerfil(userDataDir);
  if (dono) throw new Error(`o perfil ${userDataDir} está aberto por outro Chrome (pid ${dono.pid}). Feche esse Chrome e repita.`);
  const soltar = travarChrome(lockPath(), rotulo);
  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      channel: "chrome",
    });
    const page = context.pages()[0] ?? (await context.newPage());
    return { context, page, soltar };
  } catch (e) {
    soltar();
    throw e;
  }
}
