import { chromium, type BrowserContext, type Page } from "playwright";
import os from "node:os";
import path from "node:path";
import { travarChrome } from "./lock.js";

export interface Session {
  context: BrowserContext;
  page: Page;
  /** Solta a trava do perfil. `withClient` chama junto com o `context.close()`. */
  soltar: () => void;
}

/** Diretório do perfil persistente do Chrome (fora do repo). */
export function defaultUserDataDir(): string {
  return path.join(os.homedir(), ".automaster", "chrome-profile");
}

/**
 * Abre Chrome com perfil persistente. Login manual na 1ª vez; depois a sessão
 * é reaproveitada. `launchPersistentContext` retorna o context (não a page).
 */
export async function openSession(userDataDir = defaultUserDataDir()): Promise<Session> {
  const soltar = travarChrome();
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
