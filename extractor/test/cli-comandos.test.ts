/**
 * Rede do refactor da CLI: nenhum outro teste toca nos handlers de comando, e a
 * quebra do `cli.ts` em módulos por domínio tem exatamente um jeito de dar
 * errado sem ninguém ver — um comando que deixa de ser registrado.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const COMANDOS = [
  "agenda", "agenda-acao", "anotacao-acao", "anotacoes", "config", "contato-editar",
  "conversas", "conversas-anexar", "conversas-buscar", "conversas-enviar", "conversas-marcar",
  "conversas-mensagem", "conversas-rascunho", "discover", "extract", "formulario-acao",
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
