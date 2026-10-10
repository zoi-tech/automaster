import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Etapa 14 do plano docs/vesta/plans/2026-10-09-sessao-de-fundo.md: os comandos só
// valem pelo processo de fundo com a prova ao vivo registrada em docs/sessao-de-fundo.md.
const DOC = path.join(import.meta.dirname, "..", "..", "docs", "sessao-de-fundo.md");
const ESTE = "test/prova-fundo.test.ts";
const SECAO = "## Prova ao vivo dos comandos pelo processo de fundo";

const RE_MEDIANA = /^- Chamadas seguintes \(mediana de 3\): (\d+(?:,\d+)?) s$/m;

const LINHAS: Array<[string, RegExp]> = [
  ["data", /^- Data: \d{4}-\d{2}-\d{2}$/m],
  ["primeira chamada", /^- Primeira chamada \(sobe o processo de fundo\): \d+(,\d+)? s$/m],
  ["chamadas seguintes", /^- Chamadas seguintes \(mediana de 3\): \d+(,\d+)? s$/m],
  ["System Events", /^- Chrome invisível registrado como app no macOS durante os comandos \(System Events\): 0$/m],
  ["duas leituras", /^- Duas leituras ao mesmo tempo: ok$/m],
  [
    "escrita descartável",
    /^- Escrita descartável pelo processo de fundo \(tag criada e apagada, tag do contato removida e reposta, nota\): ok, desfeita$/m,
  ],
  ["smoke depois", /^- Smoke depois: \d+ ok, \d+ falhou, \d+ pulado$/m],
  ["falhas só depois da troca", /^- Checagens que falharam só depois da troca: nenhuma$/m],
  ["discover", /^- Discover encerra o processo de fundo e os comandos falham na hora: ok$/m],
  ["renovação", /^- Renovação pelo exp depois de 61 min parado: ok$/m],
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

/** Mediana das chamadas seguintes em segundos (vírgula decimal), ou null se a linha não casa. */
function mediana(s: string): number | null {
  const m = RE_MEDIANA.exec(s);
  return m ? Number(m[1].replace(",", ".")) : null;
}

/** O que falta para o registro valer; vazio quando a prova está completa. */
function faltas(texto: string): string[] {
  const s = secao(texto);
  if (s === null) return [`seção "${SECAO}"`];
  const f = LINHAS.filter(([, re]) => !re.test(s)).map(([nome, re]) => `linha ${nome} (${re.source})`);
  const m = mediana(s);
  if (m !== null && !(m < 3)) f.push(`mediana das chamadas seguintes menor que 3 s (está ${m} s)`);
  return f;
}

function lerDoc(): string {
  assert.ok(
    fs.existsSync(DOC),
    `${ESTE}: docs/sessao-de-fundo.md não existe — a prova ao vivo dos comandos pelo processo de fundo (etapa 14) ainda não foi registrada`,
  );
  return fs.readFileSync(DOC, "utf-8");
}

// --- O registro de verdade ---

test("docs/sessao-de-fundo.md tem a seção da prova dos comandos pelo processo de fundo", () => {
  assert.notEqual(secao(lerDoc()), null, `${ESTE}: falta a seção "${SECAO}" em docs/sessao-de-fundo.md`);
});

for (const [nome, re] of LINHAS) {
  test(`prova dos comandos pelo processo de fundo registra a linha: ${nome}`, () => {
    const s = secao(lerDoc());
    assert.ok(s !== null && re.test(s), `${ESTE}: falta em "${SECAO}" a linha ${nome}, no formato ${re}`);
  });
}

test("prova dos comandos pelo processo de fundo: mediana das chamadas seguintes abaixo de 3 s", () => {
  const s = secao(lerDoc());
  const m = s === null ? null : mediana(s);
  assert.ok(
    m !== null && m < 3,
    `${ESTE}: a mediana das chamadas seguintes precisa ser < 3 s com vírgula decimal (achei ${m})`,
  );
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
  "- Primeira chamada (sobe o processo de fundo): 6,8 s",
  "- Chamadas seguintes (mediana de 3): 1,2 s",
  "- Chrome invisível registrado como app no macOS durante os comandos (System Events): 0",
  "- Duas leituras ao mesmo tempo: ok",
  "- Escrita descartável pelo processo de fundo (tag criada e apagada, tag do contato removida e reposta, nota): ok, desfeita",
  "- Smoke depois: 30 ok, 1 falhou, 2 pulado",
  "- Checagens que falharam só depois da troca: nenhuma",
  "- Discover encerra o processo de fundo e os comandos falham na hora: ok",
  "- Renovação pelo exp depois de 61 min parado: ok",
  "- Resíduo: nenhum",
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
  ["data fora do formato", "- Data: 2026-10-09", "- Data: 09/10/2026"],
  ["mediana de exatamente 3 s", "(mediana de 3): 1,2 s", "(mediana de 3): 3,0 s"],
  ["mediana de 3 s sem decimal", "(mediana de 3): 1,2 s", "(mediana de 3): 3 s"],
  ["mediana acima de 3 s", "(mediana de 3): 1,2 s", "(mediana de 3): 4,5 s"],
  ["mediana com ponto decimal", "(mediana de 3): 1,2 s", "(mediana de 3): 1.2 s"],
  ["primeira chamada com ponto decimal", "(sobe o processo de fundo): 6,8 s", "(sobe o processo de fundo): 6.8 s"],
  ["registrado como app no System Events", "(System Events): 0", "(System Events): 1"],
  ["duas leituras que falharam", "Duas leituras ao mesmo tempo: ok", "Duas leituras ao mesmo tempo: falhou"],
  ["escrita que falhou", "nota): ok, desfeita", "nota): falhou"],
  ["escrita sem desfeita", "nota): ok, desfeita", "nota): ok"],
  ["smoke sem pulado", "Smoke depois: 30 ok, 1 falhou, 2 pulado", "Smoke depois: 30 ok, 1 falhou"],
  ["checagens que falharam depois da troca", "só depois da troca: nenhuma", "só depois da troca: 2"],
  ["discover que falhou", "falham na hora: ok", "falham na hora: falhou"],
  ["renovação que falhou", "61 min parado: ok", "61 min parado: falhou"],
  ["resíduo vazio", "- Resíduo: nenhum", "- Resíduo: "],
];

for (const [caso, de, para] of RUINS) {
  test(`verificador reprova: ${caso}`, () => {
    const f = faltas(trocar(de, para));
    assert.ok(f.length > 0, `${ESTE}: registro com ${caso} passou e não devia`);
  });
}
