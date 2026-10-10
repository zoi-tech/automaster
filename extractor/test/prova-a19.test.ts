import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Etapa 4 do plano docs/vesta/plans/2026-10-09-sessao-de-fundo.md: a troca do cliente
// HTTP para fetch só segue com a prova ao vivo registrada em docs/sessao-de-fundo.md.
const DOC = path.join(import.meta.dirname, "..", "..", "docs", "sessao-de-fundo.md");
const ESTE = "test/prova-a19.test.ts";
const SECAO = "## Prova A19 — cliente sobre fetch";

const LINHAS: Array<[string, RegExp]> = [
  ["data", /^- Data: \d{4}-\d{2}-\d{2}$/m],
  ["tempo de antes", /^- Tempo de `tags` antes \(Chrome visível, cliente antigo\): \d+(,\d+)? s$/m],
  ["smoke antigo", /^- Smoke com o cliente antigo: \d+ ok, \d+ falhou, \d+ pulado$/m],
  ["smoke fetch", /^- Smoke com fetch: \d+ ok, \d+ falhou, \d+ pulado$/m],
  ["falhas só com fetch", /^- Checagens que falharam só com fetch: nenhuma$/m],
  ["extração", /^- Extração completa com fetch \(download sem auth do Firebase\): \d+ workflows, 0 falhas$/m],
  ["escrita JSON", /^- Escrita JSON \(criar tag e criar nota\): ok$/m],
  ["DELETE com corpo", /^- DELETE com corpo \(remover tag do contato e repor\): ok$/m],
  ["DELETE sem corpo", /^- DELETE sem corpo \(apagar tag e apagar nota\): ok$/m],
  ["multipart", /^- Multipart \(anexo\): ok/m],
  ["cabeçalhos", /^- Cabeçalhos além dos de hoje: .+$/m],
  ["resíduo", /^- Resíduo: .+$/m],
];

/** Texto da seção da prova (até o próximo `## `), ou null se ela não existe. */
function secao(texto: string): string | null {
  const i = texto.indexOf(`${SECAO}\n`);
  if (i < 0) return null;
  const resto = texto.slice(i + SECAO.length + 1);
  const fim = resto.search(/^## /m);
  return fim < 0 ? resto : resto.slice(0, fim);
}

/** Tempo de antes em segundos (vírgula decimal), ou null se a linha não casa. */
function tempoAntes(s: string): number | null {
  const m = /^- Tempo de `tags` antes \(Chrome visível, cliente antigo\): (\d+(?:,\d+)?) s$/m.exec(s);
  return m ? Number(m[1].replace(",", ".")) : null;
}

/** O que falta para o registro valer; vazio quando a prova está completa. */
function faltas(texto: string): string[] {
  const s = secao(texto);
  if (s === null) return [`seção "${SECAO}"`];
  const f = LINHAS.filter(([, re]) => !re.test(s)).map(([nome, re]) => `linha ${nome} (${re.source})`);
  const t = tempoAntes(s);
  if (t !== null && !(t > 0)) f.push(`tempo de antes maior que zero (está ${t} s)`);
  return f;
}

function lerDoc(): string {
  assert.ok(
    fs.existsSync(DOC),
    `${ESTE}: docs/sessao-de-fundo.md não existe — a prova ao vivo A19 (etapa 4) ainda não foi registrada`,
  );
  return fs.readFileSync(DOC, "utf-8");
}

// --- O registro de verdade ---

test("docs/sessao-de-fundo.md tem a seção da prova A19", () => {
  assert.notEqual(secao(lerDoc()), null, `${ESTE}: falta a seção "${SECAO}" em docs/sessao-de-fundo.md`);
});

for (const [nome, re] of LINHAS) {
  test(`prova A19 registra a linha: ${nome}`, () => {
    const s = secao(lerDoc());
    assert.ok(s !== null && re.test(s), `${ESTE}: falta em "${SECAO}" a linha ${nome}, no formato ${re}`);
  });
}

test("prova A19: tempo de antes é um número maior que zero", () => {
  const s = secao(lerDoc());
  const t = s === null ? null : tempoAntes(s);
  assert.ok(t !== null && t > 0, `${ESTE}: o tempo de \`tags\` antes precisa ser > 0 s com vírgula decimal (achei ${t})`);
});

// --- O verificador reprova registro fora do formato ---

const BOM = [
  "# Sessão de fundo",
  "",
  "Contrato do processo de fundo e provas ao vivo.",
  "",
  SECAO,
  "",
  "- Data: 2026-10-09",
  "- Tempo de `tags` antes (Chrome visível, cliente antigo): 7,4 s",
  "- Smoke com o cliente antigo: 30 ok, 1 falhou, 2 pulado",
  "- Smoke com fetch: 30 ok, 1 falhou, 2 pulado",
  "- Checagens que falharam só com fetch: nenhuma",
  "- Extração completa com fetch (download sem auth do Firebase): 72 workflows, 0 falhas",
  "- Escrita JSON (criar tag e criar nota): ok",
  "- DELETE com corpo (remover tag do contato e repor): ok",
  "- DELETE sem corpo (apagar tag e apagar nota): ok",
  "- Multipart (anexo): ok",
  "- Cabeçalhos além dos de hoje: nenhum",
  "- Resíduo: anexo https://exemplo/a19.png; tag e nota apagadas; tag do contato como antes",
  "",
].join("\n");

const trocar = (de: string, para: string) => {
  assert.ok(BOM.includes(de), `${ESTE}: o registro de exemplo não tem "${de}"`);
  return BOM.replace(de, para);
};

test("verificador aceita um registro completo", () => {
  assert.deepEqual(faltas(BOM), []);
});

test("verificador reprova sem a seção", () => {
  assert.deepEqual(faltas(trocar(SECAO, "## Outra prova")), [`seção "${SECAO}"`]);
});

test("verificador reprova linha certa fora da seção", () => {
  const texto = trocar("- Data: 2026-10-09\n", "") + "\n## Depois\n\n- Data: 2026-10-09\n";
  assert.equal(faltas(texto).length, 1);
});

const RUINS: Array<[string, string, string]> = [
  ["checagens que falharam com fetch", "só com fetch: nenhuma", "só com fetch: 2"],
  ["extração com falhas", "72 workflows, 0 falhas", "72 workflows, 3 falhas"],
  ["tempo zero", "): 7,4 s", "): 0 s"],
  ["tempo zero com decimal", "): 7,4 s", "): 0,0 s"],
  ["tempo com ponto decimal", "): 7,4 s", "): 7.4 s"],
  ["data fora do formato", "- Data: 2026-10-09", "- Data: 09/10/2026"],
  ["smoke sem pulado", "Smoke com fetch: 30 ok, 1 falhou, 2 pulado", "Smoke com fetch: 30 ok, 1 falhou"],
  ["escrita que falhou", "(criar tag e criar nota): ok", "(criar tag e criar nota): falhou"],
  ["DELETE com corpo que falhou", "(remover tag do contato e repor): ok", "(remover tag do contato e repor): erro"],
  ["DELETE sem corpo que falhou", "(apagar tag e apagar nota): ok", "(apagar tag e apagar nota): erro"],
  ["multipart que falhou", "- Multipart (anexo): ok", "- Multipart (anexo): erro"],
  ["cabeçalhos vazio", "- Cabeçalhos além dos de hoje: nenhum", "- Cabeçalhos além dos de hoje: "],
  ["resíduo ausente", "- Resíduo: anexo", "Resíduo: anexo"],
];

for (const [caso, de, para] of RUINS) {
  test(`verificador reprova: ${caso}`, () => {
    const f = faltas(trocar(de, para));
    assert.ok(f.length > 0, `${ESTE}: registro com ${caso} passou e não devia`);
  });
}
