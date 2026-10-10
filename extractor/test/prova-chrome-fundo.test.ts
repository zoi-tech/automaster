import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Etapa 11 do plano docs/vesta/plans/2026-10-09-sessao-de-fundo.md: nenhum comando passa a
// depender do Chrome de fundo sem a prova ao vivo pela CLI `sessao` registrada em
// docs/sessao-de-fundo.md.
const DOC = path.join(import.meta.dirname, "..", "..", "docs", "sessao-de-fundo.md");
const ESTE = "test/prova-chrome-fundo.test.ts";
const SECAO = "## Prova ao vivo do Chrome de fundo";

const RE_TEMPO = /^- Captura invisível no perfil real \(sessao --acao tokens, partida fria\): (\d+(?:,\d+)?) s$/m;

const LINHAS: Array<[string, RegExp]> = [
  ["data", /^- Data: \d{4}-\d{2}-\d{2}$/m],
  ["tempo da captura", /^- Captura invisível no perfil real \(sessao --acao tokens, partida fria\): \d+(,\d+)? s$/m],
  ["headless", /^- Chrome do perfil com --headless: sim$/m],
  ["System Events", /^- Chrome invisível registrado como app no macOS \(System Events\): 0$/m],
  ["user-agent", /^- Pedidos do Chrome invisível sem Headless \(user-agent e sec-ch-ua\): ok$/m],
  ["perfil de outro Chrome", /^- Perfil aberto por outro Chrome vira erro com pid: ok$/m],
  ["login", /^- Login com janela e volta ao invisível: ok$/m],
  ["SIGTERM", /^- SIGTERM fecha limpo \(exit_type Normal, trava e socket removidos\): ok$/m],
  ["Chrome morto", /^- Chrome morto com o processo de fundo vivo: o pedido seguinte reabre: ok$/m],
  ["kill -9", /^- kill -9 no processo de fundo: o pedido seguinte sai ok: ok$/m],
];

/** Texto da seção da prova (até o próximo `## `), ou null se ela não existe. */
function secao(texto: string): string | null {
  const i = texto.indexOf(`${SECAO}\n`);
  if (i < 0) return null;
  const resto = texto.slice(i + SECAO.length + 1);
  const fim = resto.search(/^## /m);
  return fim < 0 ? resto : resto.slice(0, fim);
}

/** Tempo da captura em segundos (vírgula decimal), ou null se a linha não casa. */
function tempo(s: string): number | null {
  const m = RE_TEMPO.exec(s);
  return m ? Number(m[1].replace(",", ".")) : null;
}

/** O que falta para o registro valer; vazio quando a prova está completa. */
function faltas(texto: string): string[] {
  const s = secao(texto);
  if (s === null) return [`seção "${SECAO}"`];
  const f = LINHAS.filter(([, re]) => !re.test(s)).map(([nome, re]) => `linha ${nome} (${re.source})`);
  const t = tempo(s);
  if (t !== null && !(t > 0)) f.push(`tempo da captura maior que zero (está ${t} s)`);
  return f;
}

function lerDoc(): string {
  assert.ok(
    fs.existsSync(DOC),
    `${ESTE}: docs/sessao-de-fundo.md não existe — a prova ao vivo do Chrome de fundo (etapa 11) ainda não foi registrada`,
  );
  return fs.readFileSync(DOC, "utf-8");
}

// --- O registro de verdade ---

test("docs/sessao-de-fundo.md tem a seção da prova do Chrome de fundo", () => {
  assert.notEqual(secao(lerDoc()), null, `${ESTE}: falta a seção "${SECAO}" em docs/sessao-de-fundo.md`);
});

for (const [nome, re] of LINHAS) {
  test(`prova do Chrome de fundo registra a linha: ${nome}`, () => {
    const s = secao(lerDoc());
    assert.ok(s !== null && re.test(s), `${ESTE}: falta em "${SECAO}" a linha ${nome}, no formato ${re}`);
  });
}

test("prova do Chrome de fundo: tempo da captura é um número maior que zero", () => {
  const s = secao(lerDoc());
  const t = s === null ? null : tempo(s);
  assert.ok(t !== null && t > 0, `${ESTE}: o tempo da captura invisível precisa ser > 0 s com vírgula decimal (achei ${t})`);
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
  "- Captura invisível no perfil real (sessao --acao tokens, partida fria): 6,2 s",
  "- Chrome do perfil com --headless: sim",
  "- Chrome invisível registrado como app no macOS (System Events): 0",
  "- Pedidos do Chrome invisível sem Headless (user-agent e sec-ch-ua): ok",
  "- Perfil aberto por outro Chrome vira erro com pid: ok",
  "- Login com janela e volta ao invisível: ok",
  "- SIGTERM fecha limpo (exit_type Normal, trava e socket removidos): ok",
  "- Chrome morto com o processo de fundo vivo: o pedido seguinte reabre: ok",
  "- kill -9 no processo de fundo: o pedido seguinte sai ok: ok",
  "",
  "No passo 9 o Chrome sobreviveu ao kill -9 e o pedido seguinte o recolheu.",
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
  ["Chrome do perfil sem --headless", "--headless: sim", "--headless: não"],
  ["registrado como app no System Events", "(System Events): 0", "(System Events): 1"],
  ["tempo zero", "): 6,2 s", "): 0 s"],
  ["tempo zero com decimal", "): 6,2 s", "): 0,0 s"],
  ["tempo com ponto decimal", "): 6,2 s", "): 6.2 s"],
  ["user-agent que falhou", "(user-agent e sec-ch-ua): ok", "(user-agent e sec-ch-ua): falhou"],
  ["perfil de outro Chrome que falhou", "vira erro com pid: ok", "vira erro com pid: falhou"],
  ["login que falhou", "volta ao invisível: ok", "volta ao invisível: falhou"],
  ["SIGTERM que falhou", "socket removidos): ok", "socket removidos): falhou"],
  ["Chrome morto que falhou", "o pedido seguinte reabre: ok", "o pedido seguinte reabre: falhou"],
  ["kill -9 que falhou", "o pedido seguinte sai ok: ok", "o pedido seguinte sai ok: falhou"],
];

for (const [caso, de, para] of RUINS) {
  test(`verificador reprova: ${caso}`, () => {
    const f = faltas(trocar(de, para));
    assert.ok(f.length > 0, `${ESTE}: registro com ${caso} passou e não devia`);
  });
}
