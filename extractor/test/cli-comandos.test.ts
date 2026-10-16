/**
 * Rede do refactor da CLI: nenhum outro teste toca nos handlers de comando, e a
 * quebra do `cli.ts` em módulos por domínio tem exatamente um jeito de dar
 * errado sem ninguém ver — um comando que deixa de ser registrado.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const COMANDOS = [
  "agenda", "agenda-acao", "anotacao-acao", "anotacoes", "config", "contato-editar",
  "conversas", "conversas-anexar", "conversas-buscar", "conversas-enviar", "conversas-marcar",
  "conversas-mensagem", "conversas-rascunho", "dashboard-ver", "dashboards", "discover", "extract", "formulario-acao",
  "formulario-estilo", "formularios", "grupo", "oportunidade-acao", "oportunidades",
  "pipeline", "sessao", "smoke", "tag-acao", "tags", "timeline", "whatsapp", "whatsapp-enviar",
  "workflow-acao", "workflow-editar", "workflows-ao-vivo",
];

/** Os nomes que o `--help` lista na seção Commands. */
function registrados(): string[] {
  const saida = execFileSync("npx", ["tsx", "src/cli.ts", "--help"], {
    cwd: RAIZ, encoding: "utf-8",
  });
  const corpo = saida.slice(saida.indexOf("Commands:"));
  const nomes = new Set<string>();
  for (const linha of corpo.split("\n").slice(1)) {
    const m = /^ {2}(\S+)/.exec(linha);
    if (m && m[1] !== "help") nomes.add(m[1]);
  }
  return [...nomes].sort();
}

test("todos os comandos continuam registrados, nem um a menos nem um a mais", () => {
  assert.deepEqual(registrados(), [...COMANDOS].sort());
});

test("a CLI roda por `node --import tsx`, o comando que o servidor MCP monta", () => {
  // carregador no mesmo processo: o SIGKILL do timeout do MCP acerta quem escreve, sem neto órfão
  const r = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", "--help"], {
    cwd: RAIZ, encoding: "utf-8",
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Commands:/);
});
