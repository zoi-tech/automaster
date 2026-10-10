import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Etapa 16 do plano docs/vesta/plans/2026-10-09-sessao-de-fundo.md: a entrega só fecha com a
// prova final pelo caminho do MCP e a semana de medição de logins registradas em
// docs/sessao-de-fundo.md.
const DOC = path.join(import.meta.dirname, "..", "..", "docs", "sessao-de-fundo.md");
const ESTE = "test/prova-final.test.ts";
const FINAL = "## Prova final pelo MCP";
const SEMANA = "## Semana de medição de logins";
const A19 = "## Prova A19 — cliente sobre fetch";

const RE_PRIMEIRA =
  /^- Primeira chamada pelo caminho do MCP \(_run_extractor\), subindo o processo de fundo: (\d+(?:,\d+)?) s$/m;
const RE_DEPOIS = /^- Tempo de `tags` depois \(mediana de 3\): (\d+(?:,\d+)?) s$/m;
const RE_ANTES = /^- Tempo de `tags` antes[^:\n]*: (\d+(?:,\d+)?) s$/m;

const LINHAS_FINAL: Array<[string, RegExp]> = [
  ["data", /^- Data: \d{4}-\d{2}-\d{2}$/m],
  ["plugin em uso", /^- Plugin em uso \(CLAUDE_PLUGIN_ROOT dos servidores MCP\): .+$/m],
  ["primeira chamada", RE_PRIMEIRA],
  ["processo de fundo vivo", /^- Processo de fundo vivo depois do fim do Python: sim$/m],
  ["tool numa sessão", /^- Tool chamada numa sessão do Claude Code: ok$/m],
  [
    "duas tools ao mesmo tempo",
    /^- Duas tools ao mesmo tempo, em dois processos pelo caminho do MCP \(sobreposição medida\): ok$/m,
  ],
  ["System Events", /^- Chrome invisível registrado como app no macOS: 0$/m],
  ["tempo depois", RE_DEPOIS],
];

const LINHAS_SEMANA: Array<[string, RegExp]> = [
  ["início", /^- Início: \d{4}-\d{2}-\d{2}$/m],
  ["como conferir", /^- Como conferir:/m],
  ["resultado", /^- Resultado:/m],
];

/** Texto da seção (até o próximo `## `), ou null se ela não existe. */
function secao(texto: string, titulo: string): string | null {
  const i = texto.indexOf(`${titulo}\n`);
  if (i < 0) return null;
  const resto = texto.slice(i + titulo.length + 1);
  const fim = resto.search(/^## /m);
  return fim < 0 ? resto : resto.slice(0, fim);
}

/** Segundos de uma linha (vírgula decimal), ou null se a seção não existe ou a linha não casa. */
function segundos(s: string | null, re: RegExp): number | null {
  const m = s === null ? null : re.exec(s);
  return m ? Number(m[1].replace(",", ".")) : null;
}

/** O que falta para o registro valer; vazio quando as duas seções estão completas. */
function faltas(texto: string): string[] {
  const f: string[] = [];
  const fin = secao(texto, FINAL);
  if (fin === null) f.push(`seção "${FINAL}"`);
  else {
    for (const [nome, re] of LINHAS_FINAL) if (!re.test(fin)) f.push(`linha ${nome} (${re.source})`);
    const p = segundos(fin, RE_PRIMEIRA);
    if (p !== null && !(p < 15)) f.push(`primeira chamada abaixo de 15 s (está ${p} s)`);
    const depois = segundos(fin, RE_DEPOIS);
    const antes = segundos(secao(texto, A19), RE_ANTES);
    if (depois !== null && (antes === null || !(depois < antes)))
      f.push(`tempo de \`tags\` depois menor que o antes da "${A19}" (depois ${depois} s, antes ${antes} s)`);
  }
  const sem = secao(texto, SEMANA);
  if (sem === null) f.push(`seção "${SEMANA}"`);
  else for (const [nome, re] of LINHAS_SEMANA) if (!re.test(sem)) f.push(`linha ${nome} (${re.source})`);
  return f;
}

function lerDoc(): string {
  assert.ok(
    fs.existsSync(DOC),
    `${ESTE}: docs/sessao-de-fundo.md não existe — a prova final pelo MCP (etapa 16) ainda não foi registrada`,
  );
  return fs.readFileSync(DOC, "utf-8");
}

// --- O registro de verdade ---

test("docs/sessao-de-fundo.md tem a seção da prova final pelo MCP", () => {
  assert.notEqual(secao(lerDoc(), FINAL), null, `${ESTE}: falta a seção "${FINAL}" em docs/sessao-de-fundo.md`);
});

for (const [nome, re] of LINHAS_FINAL) {
  test(`prova final pelo MCP registra a linha: ${nome}`, () => {
    const s = secao(lerDoc(), FINAL);
    assert.ok(s !== null && re.test(s), `${ESTE}: falta em "${FINAL}" a linha ${nome}, no formato ${re}`);
  });
}

test("prova final pelo MCP: primeira chamada abaixo de 15 s", () => {
  const p = segundos(secao(lerDoc(), FINAL), RE_PRIMEIRA);
  assert.ok(
    p !== null && p < 15,
    `${ESTE}: a primeira chamada pelo caminho do MCP precisa ser < 15 s com vírgula decimal (achei ${p})`,
  );
});

test("prova final pelo MCP: tempo de `tags` depois menor que o antes da prova A19", () => {
  const texto = lerDoc();
  const depois = segundos(secao(texto, FINAL), RE_DEPOIS);
  const antes = segundos(secao(texto, A19), RE_ANTES);
  assert.ok(antes !== null, `${ESTE}: falta a linha "Tempo de \`tags\` antes" na seção "${A19}"`);
  assert.ok(
    depois !== null && depois < antes,
    `${ESTE}: o tempo de \`tags\` depois precisa ser menor que o antes (${antes} s), com vírgula decimal (achei ${depois})`,
  );
});

test("docs/sessao-de-fundo.md tem a seção da semana de medição de logins", () => {
  assert.notEqual(secao(lerDoc(), SEMANA), null, `${ESTE}: falta a seção "${SEMANA}" em docs/sessao-de-fundo.md`);
});

for (const [nome, re] of LINHAS_SEMANA) {
  test(`semana de medição de logins registra a linha: ${nome}`, () => {
    const s = secao(lerDoc(), SEMANA);
    assert.ok(s !== null && re.test(s), `${ESTE}: falta em "${SEMANA}" a linha ${nome}, no formato ${re}`);
  });
}

// --- O verificador reprova registro fora do formato ---

const BOM = [
  "# Sessão de fundo",
  "",
  A19,
  "",
  "- Data: 2026-10-09",
  "- Tempo de `tags` antes (Chrome visível, cliente antigo): 4,60 s",
  "",
  FINAL,
  "",
  "- Data: 2026-10-10",
  "- Plugin em uso (CLAUDE_PLUGIN_ROOT dos servidores MCP): /Users/x/automaster_v2",
  "- Primeira chamada pelo caminho do MCP (_run_extractor), subindo o processo de fundo: 8,3 s",
  "- Processo de fundo vivo depois do fim do Python: sim",
  "- Tool chamada numa sessão do Claude Code: ok",
  "- Duas tools ao mesmo tempo, em dois processos pelo caminho do MCP (sobreposição medida): ok",
  "- Chrome invisível registrado como app no macOS: 0",
  "- Tempo de `tags` depois (mediana de 3): 1,9 s",
  "",
  SEMANA,
  "",
  "- Início: 2026-10-10",
  "- Como conferir: `grep -F '\"via\":\"fundo\"' ~/.automaster/sessao/logins.jsonl`",
  "- Resultado: em andamento",
  "",
].join("\n");

const trocar = (de: string, para: string) => {
  assert.ok(BOM.includes(de), `${ESTE}: o registro de exemplo não tem "${de}"`);
  return BOM.replace(de, para);
};

test("verificador aceita um registro completo", () => {
  assert.deepEqual(faltas(BOM), []);
});

test("verificador reprova sem a seção da prova final", () => {
  assert.deepEqual(faltas(trocar(FINAL, "## Outra prova")), [`seção "${FINAL}"`]);
});

test("verificador reprova sem a seção da semana", () => {
  assert.deepEqual(faltas(trocar(SEMANA, "## Outra semana")), [`seção "${SEMANA}"`]);
});

test("verificador reprova linha certa fora da seção", () => {
  const texto = trocar("- Processo de fundo vivo depois do fim do Python: sim\n", "") +
    "\n## Depois\n\n- Processo de fundo vivo depois do fim do Python: sim\n";
  assert.equal(faltas(texto).length, 1);
});

test("verificador reprova tempo depois quando a prova A19 não tem o antes", () => {
  const f = faltas(trocar("- Tempo de `tags` antes (Chrome visível, cliente antigo): 4,60 s\n", ""));
  assert.equal(f.length, 1);
});

const RUINS: Array<[string, string, string]> = [
  ["data fora do formato", "- Data: 2026-10-10", "- Data: 10/10/2026"],
  ["plugin em uso vazio", "servidores MCP): /Users/x/automaster_v2", "servidores MCP): "],
  ["primeira chamada de exatamente 15 s", "processo de fundo: 8,3 s", "processo de fundo: 15 s"],
  ["primeira chamada acima de 15 s", "processo de fundo: 8,3 s", "processo de fundo: 31,2 s"],
  ["primeira chamada com ponto decimal", "processo de fundo: 8,3 s", "processo de fundo: 8.3 s"],
  ["processo de fundo morto", "fim do Python: sim", "fim do Python: não"],
  ["tool numa sessão que falhou", "sessão do Claude Code: ok", "sessão do Claude Code: falhou"],
  ["duas tools sem sobreposição", "(sobreposição medida): ok", "(sobreposição medida): falhou"],
  ["registrado como app no System Events", "como app no macOS: 0", "como app no macOS: 1"],
  ["tempo depois igual ao antes", "(mediana de 3): 1,9 s", "(mediana de 3): 4,60 s"],
  ["tempo depois maior que o antes", "(mediana de 3): 1,9 s", "(mediana de 3): 5,2 s"],
  ["tempo depois com ponto decimal", "(mediana de 3): 1,9 s", "(mediana de 3): 1.9 s"],
  ["início fora do formato", "- Início: 2026-10-10", "- Início: amanhã"],
  ["semana sem como conferir", "- Como conferir:", "- Conferir:"],
  ["semana sem resultado", "- Resultado: em andamento", "- Situação: em andamento"],
];

for (const [caso, de, para] of RUINS) {
  test(`verificador reprova: ${caso}`, () => {
    const f = faltas(trocar(de, para));
    assert.ok(f.length > 0, `${ESTE}: registro com ${caso} passou e não devia`);
  });
}
