import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "cli");

const LEITURA = [
  "runSmoke", "runOportunidades", "runFormularios", "runWorkflowsAoVivo", "runAgenda", "runWhatsapp",
  "runAnotacoes", "runTags", "runTimeline", "runConversas", "runConversasBuscar", "runDashboards",
];

/** Função de escrita → valor exato de `escrita` passado ao withClient (tabela da etapa 2 do plano). */
const ESCRITA: Record<string, string> = {
  runExtract: "true",
  runOportunidadeAcao: "true",
  runPipeline: "true",
  runFormularioAcao: "!!opts.confirmo",
  runFormularioEstilo: "!!opts.confirmo",
  runWorkflowAcao: "true",
  runAgendaAcao: "true",
  runWorkflowEditar: "!!o.confirmo",
  runWhatsappEnviar: "true",
  runConfig: "escritas.includes(opts.o)",
  runGrupo: 'opts.o !== "interno-checar"',
  runAnotacaoAcao: "true",
  runTagAcao: "!!o.confirmo",
  runContatoEditar: "true",
  runConversasAnexar: "true",
  runConversasEnviar: "true",
  runConversasMarcar: "true",
  runConversasRascunho: 'opts.acao !== "listar"',
  runConversasMensagem: "true",
};

/** Cada função de topo de `src/cli/*.ts` com o trecho até a próxima função de topo. */
function funcoesDaCli(): Map<string, string> {
  const funcoes = new Map<string, string>();
  for (const arq of fs.readdirSync(CLI).filter((f) => f.endsWith(".ts"))) {
    const texto = fs.readFileSync(path.join(CLI, arq), "utf-8");
    const inicios = [...texto.matchAll(/^(?:export )?(?:async )?function (\w+)/gm)];
    inicios.forEach((m, i) => {
      const fim = i + 1 < inicios.length ? inicios[i + 1].index : texto.length;
      funcoes.set(m[1], texto.slice(m.index, fim));
    });
  }
  return funcoes;
}

test("as listas de leitura e escrita somam as 31 chamadas, sem repetição", () => {
  assert.equal(LEITURA.length, 12);
  assert.equal(Object.keys(ESCRITA).length, 19);
  assert.equal(new Set([...LEITURA, ...Object.keys(ESCRITA)]).size, 31);
});

test("toda função da CLI que chama withClient está classificada como leitura ou escrita", () => {
  const comWithClient = [...funcoesDaCli()]
    .filter(([n, t]) => n !== "withClient" && t.includes("withClient(")) // a própria definição em shared.ts não conta
    .map(([n]) => n);
  assert.deepEqual(comWithClient.sort(), [...LEITURA, ...Object.keys(ESCRITA)].sort());
});

test("as 19 de escrita entram na fila: passam { escrita: <valor da tabela> } ao withClient", () => {
  const funcoes = funcoesDaCli();
  const erradas = Object.entries(ESCRITA)
    .filter(([n, valor]) => !(funcoes.get(n) ?? "").replace(/\s+/g, " ").includes(`{ escrita: ${valor} }`))
    .map(([n, valor]) => `${n}: esperava { escrita: ${valor} }`);
  assert.deepEqual(erradas, []);
});

test("as 12 de leitura não entram na fila: não passam escrita ao withClient", () => {
  const funcoes = funcoesDaCli();
  const naFila = LEITURA.filter((n) => funcoes.get(n)?.includes("escrita:"));
  assert.deepEqual(naFila, []);
});
