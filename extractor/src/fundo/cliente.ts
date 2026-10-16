// Lado do comando: garante o processo de fundo (sobe, troca, espera) e pede tokens a ele pelo socket.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { comandoDoPid, lerTrava, lockPath } from "../auth/lock.js";
import { defaultUserDataDir } from "../auth/session.js";
import type { Tokens } from "../auth/token.js";
import {
  argsDoCarregador,
  caminhosDaSessao,
  ErroSessao,
  impressaoDigital,
  pedir,
  prepararDir,
  PRAZOS,
  type Caminhos,
} from "./comum.js";

export interface OpcoesFundo {
  caminhos: Caminhos;
  lock: string;
  main: string;
  perfil: string;
  versao: string;
  esperaSubidaMs: number;
  avisoMs: number;
  corteMs: number;
  log: (m: string) => void;
}

const AVISO_LOGIN = "O GHL pediu login: há uma janela do Chrome esperando você entrar (até 4 min e meio).";

export function opcoesPadrao(log: (m: string) => void): OpcoesFundo {
  const aqui = fileURLToPath(import.meta.url);
  return {
    caminhos: caminhosDaSessao(),
    lock: lockPath(),
    // vale para `.ts` com tsx e para `.js` no dist
    main: fileURLToPath(new URL(`./main${path.extname(aqui)}`, import.meta.url)),
    // AUTOMASTER_PERFIL existe só para a prova ao vivo usar um perfil descartável
    perfil: defaultUserDataDir(),
    versao: impressaoDigital(),
    esperaSubidaMs: PRAZOS.subidaMs,
    avisoMs: 5_000,
    corteMs: PRAZOS.pedidoTokensMs,
    log,
  };
}

export async function estadoDoFundo(
  o: OpcoesFundo,
): Promise<{ versao: string; pid: number; perfil: string; esperandoLogin: boolean } | null> {
  try {
    const r = await pedir(o.caminhos.socket, "GET", "/versao", undefined, 2000);
    return r.status === 200 ? r.corpo : null;
  } catch {
    return null;
  }
}

function tamanho(arquivo: string): number {
  try {
    return fs.statSync(arquivo).size;
  } catch {
    return 0;
  }
}

/** Sobe o processo de fundo desligado dos pipes do comando (A21/A50). Devolve o tamanho do log antes. */
function subir(o: OpcoesFundo): number {
  prepararDir(o.caminhos.dir);
  const antes = tamanho(o.caminhos.log);
  const fd = fs.openSync(o.caminhos.log, "a", 0o600);
  const env = { ...process.env };
  delete env.DEBUG; // com DEBUG=pw:* o Playwright escreveria os cabeçalhos com tokens no log
  try {
    const filho = spawn(process.execPath, [...argsDoCarregador(process.execArgv), o.main, o.caminhos.dir, o.lock, o.perfil], {
      detached: true,
      stdio: ["ignore", fd, fd],
      env,
      cwd: path.resolve(path.dirname(o.main), "..", ".."),
    });
    filho.unref();
  } finally {
    fs.closeSync(fd);
  }
  return antes;
}

function trechoDoLog(arquivo: string, desde: number | null): string {
  try {
    return fs.readFileSync(arquivo).subarray(desde ?? 0).toString("utf-8").slice(-500).trim();
  } catch {
    return "";
  }
}

export async function garantirFundo(o: OpcoesFundo): Promise<void> {
  const estado = await estadoDoFundo(o);
  if (estado && estado.versao === o.versao && estado.perfil === o.perfil) return;
  if (estado) {
    if (estado.esperandoLogin) {
      o.log(`o processo de fundo (pid ${estado.pid}) é de outra versão ou perfil, mas espera login; usando ele desta vez`);
      return;
    }
    o.log(`o processo de fundo (pid ${estado.pid}) roda outra versão ou outro perfil; trocando...`);
    await encerrarFundo(o);
  }

  const limite = Date.now() + o.esperaSubidaMs;
  let tamanhoAntes: number | null = null;
  let subiuEm = 0;
  let dono: { pid: number; rotulo: string } | null = null;
  while (Date.now() < limite) {
    dono = lerTrava(o.lock);
    if (dono?.rotulo === "discover") {
      throw new ErroSessao(
        "sessao_indisponivel",
        `o discover está com o perfil do Chrome (pid ${dono.pid}): feche a janela dele e repita.`,
      );
    }
    if (dono?.rotulo === "fundo" && !(comandoDoPid(dono.pid) ?? "").includes(o.main)) {
      o.log(`trava do perfil órfã (pid ${dono.pid} não é o processo de fundo); apagando`);
      fs.rmSync(o.lock, { force: true });
      continue;
    }
    if (!dono && Date.now() - subiuEm >= 2000) {
      tamanhoAntes = subir(o);
      subiuEm = Date.now();
    }
    if (await estadoDoFundo(o)) return;
    await sleep(200);
  }
  const trecho = trechoDoLog(o.caminhos.log, tamanhoAntes);
  throw new ErroSessao(
    "sessao_indisponivel",
    `o processo de fundo não respondeu em ${o.esperaSubidaMs / 1000} s` +
      (trecho ? `: ${trecho}` : "") +
      (dono ? ` (o perfil está com o pid ${dono.pid})` : "") +
      `. Log completo em ${o.caminhos.log}`,
  );
}

export async function encerrarFundo(o: OpcoesFundo): Promise<boolean> {
  const estado = await estadoDoFundo(o);
  if (!estado) return false;
  try {
    await pedir(o.caminhos.socket, "POST", "/encerrar");
  } catch {
    /* pode cair antes de responder */
  }
  const limite = Date.now() + PRAZOS.encerrarMs;
  while (Date.now() < limite) {
    const dono = lerTrava(o.lock);
    if (!dono || dono.pid !== estado.pid) return true;
    await sleep(200);
  }
  throw new ErroSessao(
    "sessao_indisponivel",
    `o processo de fundo (pid ${estado.pid}) não encerrou em ${PRAZOS.encerrarMs / 1000} s`,
  );
}

const CAIU = new Set(["ECONNREFUSED", "ECONNRESET", "ENOENT", "EPIPE"]);

async function pedirAoFundo(rota: string, corpo: unknown, o: OpcoesFundo): Promise<Tokens> {
  let avisou = false; // uma vez por comando, não por tentativa
  for (let tentativa = 0; ; tentativa++) {
    await garantirFundo(o);
    const checar = async (): Promise<void> => {
      if (!avisou && (await estadoDoFundo(o))?.esperandoLogin && !avisou) {
        avisou = true;
        o.log(AVISO_LOGIN);
      }
    };
    const timer = setInterval(() => void checar(), o.avisoMs);
    try {
      const r = await pedir(o.caminhos.socket, "POST", rota, corpo, o.corteMs);
      if (r.status === 200) return r.corpo as Tokens;
      throw new ErroSessao(
        r.corpo?.code === "login_pendente" ? "login_pendente" : "sessao_indisponivel",
        r.corpo?.message ?? `resposta ${r.status} do processo de fundo`,
      );
    } catch (e) {
      if (e instanceof ErroSessao) throw e;
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ETIMEOUT") {
        // vivo e demorou: religar abriria outra captura e estouraria os 600 s do MCP
        if ((await estadoDoFundo(o))?.esperandoLogin) {
          throw new ErroSessao(
            "login_pendente",
            "o GHL pediu login e a janela do Chrome continua esperando: entre nela e repita.",
          );
        }
        throw new ErroSessao(
          "sessao_indisponivel",
          `o processo de fundo não respondeu em ${o.corteMs / 1000} s. Veja ${o.caminhos.log}`,
        );
      }
      if (CAIU.has(err.code ?? "") || err.message === "socket hang up") {
        if (tentativa === 0) {
          o.log("o processo de fundo caiu; religando uma vez...");
          continue;
        }
        throw new ErroSessao(
          "sessao_indisponivel",
          `o processo de fundo caiu duas vezes durante o pedido: ${err.message}. Veja ${o.caminhos.log}`,
        );
      }
      throw new ErroSessao("sessao_indisponivel", err.message);
    } finally {
      clearInterval(timer);
    }
  }
}

export function tokensDoFundo(subconta: string, o: OpcoesFundo): Promise<Tokens> {
  return pedirAoFundo("/tokens", { subconta }, o);
}

export function renovarNoFundo(subconta: string, falho: Tokens, o: OpcoesFundo): Promise<Tokens> {
  return pedirAoFundo("/renovar", { subconta, bearer: falho.bearer, tokenId: falho.tokenId }, o);
}
