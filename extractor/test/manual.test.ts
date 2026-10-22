/**
 * Etapa 7: o motor do `manual-pdf` sem navegador nem rede. Capa ZOI, injeção do CSS e
 * da capa no modelo, conferências de termos internos e de seções que estouram a página,
 * fontes em data URI e o registro do comando. Cliente de exemplo fictício: Ribeira Seminovos.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { montarCapa, injetar } from "../src/manual/capa.js";
import { TERMOS_INTERNOS, termosInternos, secoesEstouradas } from "../src/manual/conferencias.js";
import { caminhoFontes, fontesFaces } from "../src/manual/fontes.js";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANUAL = path.resolve(RAIZ, "..", "skills", "automaster-documentar", "manual");
const tmp = (prefixo = "ammanual-"): string => fs.mkdtempSync(path.join(os.tmpdir(), prefixo));

const DADOS = {
  subtitulo: "Automações da Ribeira Seminovos",
  descricao: "O que o CRM faz sozinho, do primeiro contato até depois da visita na loja.",
  preparado: "Paula Andrade",
  email: "paula@exemplo.com",
  telefone: "+55 (47) 9 0000-1234",
  data: "2026-10-22",
};

/** Abertura do elemento que tem a classe pedida (a tag inteira, com atributos). */
function tagDaClasse(html: string, classe: string): string {
  const m = new RegExp(`<[a-z0-9]+[^>]*class="[^"]*\\b${classe}\\b[^"]*"[^>]*>`, "i").exec(html);
  assert.ok(m, `sem elemento com a classe ${classe}`);
  return m[0];
}

/** Texto logo depois da abertura do elemento com a classe (até a próxima tag). */
function textoDaClasse(html: string, classe: string): string {
  const abertura = tagDaClasse(html, classe);
  const resto = html.slice(html.indexOf(abertura) + abertura.length);
  return resto.slice(0, resto.indexOf("<")).trim();
}

/** O número do `font-size:NNpt` do título da capa. */
function tamanhoTitulo(html: string): number {
  const m = /font-size:\s*([\d.]+)pt/.exec(tagDaClasse(html, "capa-marca"));
  assert.ok(m, "capa-marca sem font-size em pt");
  return Number(m[1]);
}

// ---------- capa ----------

test("capa: usa as classes da capa ZOI e os contatos fixos da ZOI", () => {
  const html = montarCapa(DADOS);
  assert.match(html, /class="folha capa"/);
  for (const classe of ["capa-regua", "capa-contatos", "capa-centro", "capa-sol", "capa-marca",
    "capa-bloco", "capa-sub", "capa-desc", "capa-faixa", "nome"]) {
    tagDaClasse(html, classe);
  }
  for (const fixo of ["ZOI", "Benjamin Constant 2839", "Joinville — SC, Brasil", "contato@zoi.tech",
    "www.zoitech.com.br", "Representante Técnico"]) {
    assert.ok(html.includes(fixo), `falta o contato fixo: ${fixo}`);
  }
});

test("capa: o sol é o SVG da ZOI, dentro de capa-sol", () => {
  const html = montarCapa(DADOS);
  const sol = html.indexOf(tagDaClasse(html, "capa-sol"));
  const svg = html.indexOf("<svg");
  assert.ok(svg > sol, "o <svg> não está depois de capa-sol");
  assert.match(html.slice(svg), /^<svg[^>]*viewBox="0 0 796 801"/);
});

test("capa: sem título, o título é \"Manual\"", () => {
  assert.equal(textoDaClasse(montarCapa(DADOS), "capa-marca"), "Manual");
});

test("capa: título informado vai no lugar de \"Manual\"", () => {
  assert.equal(textoDaClasse(montarCapa({ ...DADOS, titulo: "Guia" }), "capa-marca"), "Guia");
});

test("capa: subtítulo, descrição, preparado por, e-mail e telefone aparecem nos lugares deles", () => {
  const html = montarCapa(DADOS);
  assert.equal(textoDaClasse(html, "capa-sub"), DADOS.subtitulo);
  assert.equal(textoDaClasse(html, "capa-desc"), DADOS.descricao);
  assert.equal(textoDaClasse(html, "nome"), DADOS.preparado);
  const faixa = html.slice(html.indexOf(tagDaClasse(html, "capa-faixa")));
  assert.ok(faixa.includes(DADOS.email), "e-mail fora da faixa");
  assert.ok(faixa.includes(DADOS.telefone), "telefone fora da faixa");
});

test("capa: data AAAA-MM-DD vira DD/MM/AAAA", () => {
  const html = montarCapa({ ...DADOS, data: "2026-10-22" });
  const faixa = html.slice(html.indexOf(tagDaClasse(html, "capa-faixa")));
  assert.ok(faixa.includes("22/10/2026"));
  assert.ok(!html.includes("2026-10-22"));
});

test("capa: data já em DD/MM/AAAA fica igual", () => {
  const html = montarCapa({ ...DADOS, data: "05/03/2027" });
  const faixa = html.slice(html.indexOf(tagDaClasse(html, "capa-faixa")));
  assert.ok(faixa.includes("05/03/2027"));
});

test("capa: <script> e & em qualquer campo saem escapados", () => {
  const ataque = "<script>alert(1)</script>";
  for (const campo of ["titulo", "subtitulo", "descricao", "preparado", "email", "telefone", "data"]) {
    const html = montarCapa({ ...DADOS, [campo]: ataque });
    assert.ok(!/<script/i.test(html), `${campo}: <script> passou cru`);
    assert.ok(html.includes("&lt;script&gt;"), `${campo}: não escapou`);
  }
  const html = montarCapa({ ...DADOS, subtitulo: "Ribeira & Filhos" });
  assert.equal(textoDaClasse(html, "capa-sub"), "Ribeira &amp; Filhos");
});

test("capa: título longo encolhe, sempre entre 34pt e 65pt", () => {
  const curto = tamanhoTitulo(montarCapa(DADOS));
  const titulo30 = "Automações da Ribeira Seminovo";
  assert.equal(titulo30.length, 30);
  const longo = tamanhoTitulo(montarCapa({ ...DADOS, titulo: titulo30 }));
  const enorme = tamanhoTitulo(montarCapa({ ...DADOS, titulo: "Manual completo ".repeat(8) }));
  for (const t of [curto, longo, enorme]) {
    assert.ok(t >= 34 && t <= 65, `fora de 34–65pt: ${t}`);
  }
  assert.ok(longo < curto, `título longo não encolheu (${longo} >= ${curto})`);
  assert.ok(enorme <= longo);
});

// ---------- injetar ----------

test("injetar: no modelo real, troca o marcador e o {{CAPA}}, com um <style> só no head", () => {
  const modelo = fs.readFileSync(path.join(MANUAL, "modelo.html"), "utf-8");
  const css = fs.readFileSync(path.join(MANUAL, "zoi.css"), "utf-8");
  const capa = montarCapa(DADOS);
  const fontes = "@font-face { font-family: 'Satoshi'; src: url(data:font/woff2;base64,AAAA); }";
  const html = injetar(modelo, css, capa, fontes);

  assert.ok(!html.includes("{{CAPA}}"), "sobrou {{CAPA}}");
  assert.ok(!html.includes("<!-- CSS DA ZOI -->"), "sobrou o marcador do CSS");
  assert.equal(html.match(/<style\b/g)?.length, 1);
  const estilo = html.indexOf("<style");
  assert.ok(estilo < html.indexOf("</head>"), "<style> fora do head");
  const fimEstilo = html.indexOf("</style>");
  assert.ok(html.indexOf(fontes) > estilo && html.indexOf(fontes) < fimEstilo, "fontes fora do <style>");
  assert.ok(html.indexOf(".capa-marca") > estilo && html.indexOf(".capa-marca") < fimEstilo, "CSS fora do <style>");
  assert.ok(html.indexOf(fontes) < html.indexOf(".capa-marca"), "fontes depois do CSS");

  const posCapa = html.indexOf(capa);
  assert.ok(posCapa > 0, "a capa não entrou");
  assert.ok(posCapa < html.indexOf('class="folha"'), "a capa não vem antes da primeira folha");
});

test("injetar: $ no CSS ou na capa sai literal (não vira padrão de replace)", () => {
  const html = "<head><!-- CSS DA ZOI --></head><body>{{CAPA}}</body>";
  const css = ".x::after { content: '$& $1 $` $\\''; }";
  const capa = "<section class=\"folha capa\">R$ 1.000 $&</section>";
  const saida = injetar(html, css, capa, "");
  assert.ok(saida.includes(css), "CSS alterado");
  assert.ok(saida.includes(capa), "capa alterada");
});

test("injetar: HTML sem o marcador do CSS dá erro que cita CSS DA ZOI", () => {
  assert.throws(() => injetar("<head></head><body>{{CAPA}}</body>", "a{}", "<section></section>", ""),
    (e: unknown) => e instanceof Error && e.message.includes("CSS DA ZOI"));
});

test("injetar: HTML sem {{CAPA}} dá erro que cita {{CAPA}}", () => {
  assert.throws(() => injetar("<head><!-- CSS DA ZOI --></head><body></body>", "a{}", "<section></section>", ""),
    (e: unknown) => e instanceof Error && e.message.includes("{{CAPA}}"));
});

// ---------- termos internos ----------

const posicoes = (texto: string): number[] => termosInternos(texto).map((a) => a.posicao);

/** Confere que há um achado na posição do trecho `alvo` dentro de `texto`. */
function achaEm(texto: string, alvo: string): void {
  const pos = texto.indexOf(alvo);
  assert.ok(pos >= 0, `teste mal montado: ${alvo}`);
  const achados = termosInternos(texto);
  const achado = achados.find((a) => a.posicao === pos);
  assert.ok(achado, `não achou "${alvo}" na posição ${pos} em "${texto}" (achou ${JSON.stringify(achados)})`);
  assert.equal(typeof achado.termo, "string");
  assert.ok(achado.trecho.toLowerCase().includes(alvo.trim().toLowerCase()),
    `trecho "${achado.trecho}" não mostra "${alvo}"`);
}

test("termos: a lista de termos é uma constante exportada e não vazia", () => {
  assert.ok(Array.isArray(TERMOS_INTERNOS) || typeof TERMOS_INTERNOS === "object");
  assert.ok(Object.keys(TERMOS_INTERNOS).length > 0);
});

test("termos: workflow, gatilho, webhook, dump e automaster acham sem ligar para maiúscula", () => {
  achaEm("Esse workflow manda a mensagem.", "workflow");
  achaEm("O Workflow manda a mensagem.", "Workflow");
  achaEm("Quando o GATILHO dispara, sai o aviso.", "GATILHO");
  achaEm("Chega pelo webhook do site.", "webhook");
  achaEm("Chega pelo Webhook do site.", "Webhook");
  achaEm("Segundo o dump de ontem.", "dump");
  achaEm("Segundo o Dump de ontem.", "Dump");
  achaEm("Gerado pelo automaster.", "automaster");
  achaEm("Gerado pelo AutoMaster.", "AutoMaster");
});

test("termos: trigger acha", () => {
  achaEm("O trigger é a mensagem nova.", "trigger");
});

test("termos: \"tag \" e \"tags \" acham como palavra; etiquetagem e etapa não", () => {
  achaEm("Recebe a tag quente no cadastro.", "tag ");
  achaEm("As tags ficam no contato.", "tags ");
  assert.deepEqual(termosInternos("A etiquetagem dos carros vem antes da etapa de venda."), []);
});

test("termos: Hub acha só com H maiúsculo e como palavra", () => {
  achaEm("Abra o Hub para ver.", "Hub");
  assert.deepEqual(termosInternos("Os hubs de entrega da cidade."), []);
  assert.deepEqual(termosInternos("O código fica no GitHub da loja."), []);
});

test("termos: \"→ \" com 4 dígitos e ]] acha na posição da seta", () => {
  achaEm("Depois vai para a etapa → 4024]] no funil.", "→ 4024]]");
});

test("termos: {{ e }} de campo personalizado acham os dois", () => {
  const texto = "Oi {{contact.first_name}}, tudo bem?";
  const ps = posicoes(texto);
  assert.ok(ps.includes(texto.indexOf("{{")), "não achou {{");
  assert.ok(ps.includes(texto.indexOf("}}")), "não achou }}");
});

test("termos: id de 20+ letras e dígitos acha; palavra longa só de letras não", () => {
  achaEm("Veja o id abcdefghij1234567890 no cadastro.", "abcdefghij1234567890");
  achaEm("Card Xy7Qp2LmN8rT4vW1zK9bC3dF criado.", "Xy7Qp2LmN8rT4vW1zK9bC3dF");
  assert.deepEqual(termosInternos("Isso é inconstitucionalmente proibido."), []);
  assert.deepEqual(termosInternos("Código abcdefghij123456789 curto."), [], "19 caracteres não é id");
  assert.deepEqual(termosInternos("Protocolo 12345678901234567890 da loja."), [], "só dígitos não é id");
});

test("termos: texto limpo de cliente devolve lista vazia", () => {
  assert.deepEqual(termosInternos("O card vai para Em follow-up e o vendedor recebe um aviso."), []);
  assert.deepEqual(termosInternos(""), []);
});

test("termos: vários termos no mesmo texto voltam todos, cada um com a sua posição", () => {
  const texto = "O workflow usa o webhook e o gatilho.";
  const ps = posicoes(texto);
  for (const alvo of ["workflow", "webhook", "gatilho"]) {
    assert.ok(ps.includes(texto.indexOf(alvo)), `faltou ${alvo}`);
  }
});

// ---------- seções estouradas ----------

test("seções: devolve só as que passam da altura útil, na ordem", () => {
  const medidas = [
    { titulo: "Sobre este manual", altura: 900 },
    { titulo: "WhatsApp de atendimento", altura: 1200 },
    { titulo: "Funil e follow-up", altura: 1000 },
    { titulo: "Visitas na loja", altura: 1500 },
  ];
  assert.deepEqual(secoesEstouradas(medidas, 1000), [
    { titulo: "WhatsApp de atendimento", altura: 1200 },
    { titulo: "Visitas na loja", altura: 1500 },
  ]);
});

test("seções: altura igual ao limite não estoura; lista vazia devolve vazio", () => {
  assert.deepEqual(secoesEstouradas([{ titulo: "Funil", altura: 1000 }], 1000), []);
  assert.deepEqual(secoesEstouradas([], 1000), []);
});

// ---------- fontes ----------

test("fontes: caminhoFontes usa AUTOMASTER_FONTES; sem ela, ~/.automaster/fontes", () => {
  const antes = process.env.AUTOMASTER_FONTES;
  const semBarra = (p: string): string => p.replace(/[\\/]+$/, "");
  try {
    delete process.env.AUTOMASTER_FONTES;
    assert.equal(semBarra(caminhoFontes()), path.join(os.homedir(), ".automaster", "fontes"));
    process.env.AUTOMASTER_FONTES = "/tmp/fontes-outra";
    assert.equal(semBarra(caminhoFontes()), "/tmp/fontes-outra");
  } finally {
    if (antes === undefined) delete process.env.AUTOMASTER_FONTES;
    else process.env.AUTOMASTER_FONTES = antes;
  }
});

test("fontes: pasta vazia ou inexistente devolve string vazia", () => {
  assert.equal(fontesFaces(tmp()), "");
  assert.equal(fontesFaces(path.join(tmp(), "nao-existe")), "");
});

test("fontes: cada arquivo vira um @font-face com família, peso e data URI do conteúdo", () => {
  const dir = tmp();
  const arquivos = {
    "ClashDisplay-Semibold.otf": { conteudo: "clash-semibold-bytes", familia: "Clash Display", peso: "600", tipo: "otf" },
    "ClashDisplay-Bold.otf": { conteudo: "clash-bold-bytes", familia: "Clash Display", peso: "700", tipo: "otf" },
    "Satoshi-Regular.woff2": { conteudo: "satoshi-regular-bytes", familia: "Satoshi", peso: "400", tipo: "woff2" },
  };
  for (const [nome, a] of Object.entries(arquivos)) fs.writeFileSync(path.join(dir, nome), a.conteudo);
  fs.writeFileSync(path.join(dir, "leia-me.txt"), "isto nao e fonte");

  const css = fontesFaces(dir);
  const blocos = css.split("@font-face").slice(1);
  assert.equal(blocos.length, 3, "um @font-face por arquivo de fonte, o .txt fica de fora");
  assert.ok(!css.includes(Buffer.from("isto nao e fonte").toString("base64")), "o .txt entrou");

  for (const a of Object.values(arquivos)) {
    const b64 = Buffer.from(a.conteudo).toString("base64");
    const bloco = blocos.find((b) => b.includes(b64));
    assert.ok(bloco, `sem @font-face com o conteúdo de ${a.familia} ${a.peso}`);
    assert.match(bloco, new RegExp(`font-family:\\s*['"]${a.familia}['"]`));
    assert.match(bloco, new RegExp(`font-weight:\\s*${a.peso}\\b`));
    assert.match(bloco, new RegExp(`url\\(["']?data:font/${a.tipo};base64,${b64.replace(/[+/=]/g, "\\$&")}["']?\\)`));
  }
});

// ---------- CLI ----------

test("o comando manual-pdf aparece no --help com as nove opções", () => {
  const saida = execFileSync("npx", ["tsx", "src/cli.ts", "manual-pdf", "--help"], {
    cwd: RAIZ, encoding: "utf-8",
  });
  for (const opcao of ["--html", "--saida", "--titulo", "--subtitulo", "--descricao", "--preparado",
    "--email", "--telefone", "--data"]) {
    assert.match(saida, new RegExp(`(^|\\s)${opcao}\\b`), `falta ${opcao}`);
  }
});
