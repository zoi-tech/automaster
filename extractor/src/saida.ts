/**
 * Envelope único da saída `--json` da CLI.
 *
 * O servidor MCP roda esta CLI por subprocess e lê a ÚLTIMA linha do stdout. Antes deste
 * envelope o formato era o objeto solto de cada comando, e o lado Python tinha que
 * adivinhar duas coisas quando dava errado: que tipo de erro foi (pelo prefixo do nome do
 * comando) e se a escrita chegou a sair (por `--confirmo` estar nos argumentos). As duas
 * respostas moram aqui, onde elas são sabidas de verdade.
 */

let escritaTentada = false;
const rastros: string[] = [];

/** Chamado pelo cliente HTTP quando um PUT/POST/DELETE sai de verdade. */
export function marcarEscrita(): void {
  escritaTentada = true;
}

/** Caminho de um registro de escrita (o "antes", gravado para quem precisar desfazer à mão). */
export function marcarRastro(caminho: string): void {
  rastros.push(caminho);
}

function escritaInfo(): Record<string, unknown> {
  return escritaTentada || rastros.length ? { escrita: { tentada: escritaTentada, rastros } } : {};
}

/** Saída de sucesso. Com `--json`, uma linha de envelope; sem, o dado pretty para leitura humana. */
export function emitir(json: boolean | undefined, data: unknown): void {
  if (json) console.log(JSON.stringify({ ok: true, data, ...escritaInfo() }));
  else console.log(JSON.stringify(data, null, 2));
}

/** `HTTP 422` na mensagem vira `http_422`; o resto é `erro`. É o que o lado Python ramifica. */
function codigo(msg: string): string {
  const m = /HTTP (\d{3})/.exec(msg);
  return m ? `http_${m[1]}` : "erro";
}

/**
 * Handler único dos `.catch(...)` da CLI: envelope de erro no stdout, texto no stderr, código 1.
 * Erro com `codigo` em texto (`login_pendente`, `sessao_indisponivel`) leva esse código ao envelope.
 */
export function falhar(e: unknown): never {
  const message = e instanceof Error ? e.message : String(e);
  console.error(message);
  const c = (e as { codigo?: unknown } | null)?.codigo;
  const code = typeof c === "string" ? c : codigo(message);
  console.log(JSON.stringify({ ok: false, error: { code, message }, ...escritaInfo() }));
  process.exit(1);
}
