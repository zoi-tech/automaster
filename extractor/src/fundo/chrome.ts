// O Chrome do processo de fundo: invisível, dono do perfil, com janela só quando o GHL pede login.
// Tokens nunca vão para o log nem para o registro de logins.
import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium, type BrowserContext, type Page } from "playwright";
import { UA_PADRAO } from "../api/client.js";
import { comandoDoPid, vivo } from "../auth/lock.js";
import { cabecalhosCookie } from "../auth/session.js";
import { PedidoDeLogin, SemTokens, captureTokens, type Tokens } from "../auth/token.js";
import { ErroSessao, PRAZOS, linhaDeLogin, registrarLogin, telaDeOrigem } from "./comum.js";
import type { Navegador } from "./servidor.js";

/** User-agent de Chrome normal com o major que o próprio Chrome grava em `Last Version`. */
export function uaDoPerfil(perfil: string): string {
  try {
    const major = /^(\d+)\./.exec(fs.readFileSync(path.join(perfil, "Last Version"), "utf-8").trim())?.[1];
    if (major) {
      return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
    }
  } catch {
    // sem o arquivo: cai no padrão
  }
  return UA_PADRAO;
}

/** O pedido real saiu acusando Chrome invisível? O override de UA não troca o `sec-ch-ua`. */
export function uaHeadless(h: Record<string, string>): boolean {
  return /headless/i.test(h["user-agent"] ?? "") || /headless/i.test(h["sec-ch-ua"] ?? "");
}

/** Quem segura o perfil pelo `SingletonLock` (`<máquina>-<pid>`), confirmado pelo comando do pid. */
export function donoDoPerfil(
  perfil: string,
  comandoDe: (pid: number) => string | null = comandoDoPid,
): { pid: number; invisivel: boolean } | null {
  try {
    const alvo = fs.readlinkSync(path.join(perfil, "SingletonLock"));
    const pid = Number(alvo.slice(alvo.lastIndexOf("-") + 1));
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid || !vivo(pid)) return null;
    const comando = comandoDe(pid);
    if (!comando?.includes("Google Chrome") || !comando.includes(`--user-data-dir=${perfil}`)) return null;
    return { pid, invisivel: comando.includes("--headless") };
  } catch {
    return null;
  }
}

type Lancar = (
  perfil: string,
  opcoes: {
    headless: boolean;
    channel: "chrome";
    userAgent: string;
    handleSIGTERM: boolean;
    handleSIGINT: boolean;
    handleSIGHUP: boolean;
    args?: string[];
    ignoreDefaultArgs?: string[];
  },
) => Promise<BrowserContext>;

export class ChromeDeFundo implements Navegador {
  private contexto: BrowserContext | null = null;
  private pagina: Page | null = null;
  private comJanela = false;
  private loginAberto = false;
  private navegacoes = 0;
  private ultima: { em: string; url: string } | null = null;
  private readonly desde = new Date().toISOString();

  constructor(
    readonly perfil: string,
    private readonly registroLogins: string,
    private readonly log: (m: string) => void,
    private readonly lancar: Lancar = (p, op) => chromium.launchPersistentContext(p, op),
    private readonly comandoDe: (pid: number) => string | null = comandoDoPid,
    // onde gravar a sessão do GHL (cookies e localStorage) para o Playwright MCP importar; sem ele, não grava
    private readonly arquivoEstado?: string,
  ) {}

  private async abrir(comJanela: boolean): Promise<void> {
    const dono = donoDoPerfil(this.perfil, this.comandoDe);
    if (dono?.invisivel) {
      this.log(`sobra de Chrome invisível no perfil (pid ${dono.pid}); encerrando`);
      process.kill(dono.pid, "SIGTERM");
      const fim = Date.now() + 10_000;
      while (vivo(dono.pid) && Date.now() < fim) await sleep(200);
      if (vivo(dono.pid)) {
        throw new ErroSessao(
          "sessao_indisponivel",
          `o Chrome invisível que sobrou no perfil (pid ${dono.pid}) não encerrou; encerre-o e repita.`,
        );
      }
    } else if (dono) {
      throw new ErroSessao(
        "sessao_indisponivel",
        `o perfil ${this.perfil} está aberto por outro Chrome (pid ${dono.pid}). Feche esse Chrome e repita: o perfil é só do processo de fundo do automaster.`,
      );
    }
    const contexto = await this.lancar(this.perfil, {
      headless: !comJanela,
      channel: "chrome",
      userAgent: uaDoPerfil(this.perfil),
      // os tratadores do Playwright matam o Chrome em paralelo ao nosso fechar(): perfil "Crashed" e SingletonLock órfão
      handleSIGTERM: false,
      handleSIGINT: false,
      handleSIGHUP: false,
      // o Google recusa login OAuth em navegador com a marca de automação (`--enable-automation`): sem ela, a janela de login aceita "Sign in with Google"
      ...(comJanela ? { ignoreDefaultArgs: ["--enable-automation"], args: ["--disable-blink-features=AutomationControlled"] } : {}),
    });
    this.contexto = contexto;
    this.comJanela = comJanela;
    contexto.on("close", () => {
      if (this.contexto !== contexto) return;
      this.contexto = null;
      this.pagina = null;
    });
    this.pagina = contexto.pages()[0] ?? (await contexto.newPage());
  }

  private async fecharContexto(): Promise<void> {
    const contexto = this.contexto;
    this.contexto = null;
    this.pagina = null;
    if (!contexto) return;
    const inicio = Date.now();
    // medido ao vivo: contexto.close() direto perpetua exit_type "Crashed" no perfil; fechar as páginas antes deixa "Normal"
    await Promise.allSettled(contexto.pages().map(async (p) => p.close()));
    // fechamento sujo deixa o perfil "Crashed" e pode perder cookies (A8): o motivo vai para o log
    await contexto.close().then(
      () => this.log(`Chrome fechado em ${Date.now() - inicio} ms`),
      (e: unknown) => this.log(`falha ao fechar o Chrome em ${Date.now() - inicio} ms: ${e instanceof Error ? e.message : String(e)}`),
    );
  }

  private async navegarECapturar(
    subconta: string,
    opcoes: { pararNoLogin?: boolean; timeoutMs: number },
  ): Promise<Tokens> {
    const contexto = this.contexto;
    const pagina = this.pagina;
    if (!contexto || !pagina) throw new Error("Target page, context or browser has been closed");
    const tokens = await captureTokens(pagina, subconta, {
      ...opcoes,
      cabecalhos: (h) => this.log(`ua_headless=${uaHeadless(h) ? "sim" : "nao"}`),
    });
    this.navegacoes++;
    this.ultima = { em: new Date().toISOString(), url: pagina.url() };
    const completos = { ...tokens, cookies: await cabecalhosCookie(contexto), userAgent: uaDoPerfil(this.perfil) };
    if (this.arquivoEstado) await this.gravarEstado(contexto, this.arquivoEstado);
    // parado de verdade entre capturas: a SPA do GHL não fica rodando (e navegando) sozinha
    await pagina.goto("about:blank").catch(() => {});
    return completos;
  }

  /** Só cookies e origens do GHL, 0600, escrita atômica. Falha vira linha no log, não derruba a captura. */
  private async gravarEstado(contexto: BrowserContext, arquivo: string): Promise<void> {
    try {
      const estado = await contexto.storageState();
      const doGhl = (dominio: string) => /gohighlevel\.com|leadconnectorhq\.com/.test(dominio);
      const cookies = estado.cookies.filter((c) => doGhl(c.domain));
      const origins = estado.origins.filter((o) => doGhl(new URL(o.origin).hostname));
      const tmp = `${arquivo}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ cookies, origins }), { mode: 0o600 });
      fs.chmodSync(tmp, 0o600);
      fs.renameSync(tmp, arquivo);
    } catch (e) {
      this.log(`não gravei a sessão em ${arquivo}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async capturar(subconta: string): Promise<Tokens> {
    if (!this.contexto || this.comJanela) {
      await this.fecharContexto();
      await this.abrir(false);
    }
    const tentar = () =>
      this.navegarECapturar(subconta, { pararNoLogin: true, timeoutMs: PRAZOS.tentativaInvisivelMs });
    try {
      return await tentar();
    } catch (e) {
      if (e instanceof PedidoDeLogin || e instanceof SemTokens) return await this.login(subconta, e);
      if (e instanceof ErroSessao) throw e;
      this.log(`o Chrome caiu (${e instanceof Error ? e.message : String(e)}); reabrindo uma vez`);
    }
    await this.fecharContexto();
    await this.abrir(false);
    try {
      return await tentar();
    } catch (e) {
      if (e instanceof PedidoDeLogin || e instanceof SemTokens) return await this.login(subconta, e);
      throw e;
    }
  }

  private async login(subconta: string, erro: PedidoDeLogin | SemTokens): Promise<Tokens> {
    const url = erro instanceof PedidoDeLogin ? erro.url : (this.pagina?.url() ?? "");
    registrarLogin(
      this.registroLogins,
      linhaDeLogin({
        via: "fundo",
        motivo: erro instanceof PedidoDeLogin ? "redirecionamento" : "sem_tokens",
        perfil: this.perfil,
        subconta,
        url,
        navegacoes: this.navegacoes,
        ultima: this.ultima,
        desde: this.desde,
      }),
    );
    this.log(`o GHL pediu login (origem ${telaDeOrigem(url) || url}); abrindo janela`);
    await this.fecharContexto();
    this.loginAberto = true;
    try {
      await this.abrir(true);
      return await this.navegarECapturar(subconta, { timeoutMs: PRAZOS.esperaLoginMs });
    } catch (e) {
      if (e instanceof SemTokens) {
        throw new ErroSessao(
          "login_pendente",
          "O GHL pediu login e ninguém entrou na janela do Chrome em 4 min e meio. Faça login nela com e-mail e senha (o Google recusa login feito na janela automatizada) e repita.",
        );
      }
      throw e;
    } finally {
      this.loginAberto = false;
      await this.fecharContexto();
    }
  }

  esperandoLogin(): boolean {
    return this.loginAberto;
  }

  async fechar(): Promise<void> {
    await this.fecharContexto();
  }
}
