import { Command } from "commander";
import { chromium, type Browser } from "playwright";
import path from "node:path";
import { GhlClient } from "../api/client.js";
import {
  listForms, listSurveys, getForm, getSurvey, listFormSubmissions, listSurveySubmissions
} from "../api/forms.js";
import {
  criar, publicar, apagar, duplicar, restaurarVersao, baixarVersao, paletaPadrao,
  gravarPaletaPadrao, temas
} from "../api/forms-write.js";
import { aplicar, type Op } from "../forms/doc.js";
import { diferenca } from "../forms/diff.js";
import {
  opsDeEstilo, resolverPaleta, saidaPaletaGravar, type Tokens as TokensEstilo, type CorNomeada
} from "../forms/style.js";
import fs from "node:fs";
import os from "node:os";
import { sleep, withClient, registroEscrita, numeroOpcional } from "./shared.js";
import { emitir, falhar } from "../saida.js";

async function runFormularios(opts: {
  location: string; o: string; tipo: string; id?: string; formulario?: string;
  termo?: string; inicio?: string; fim?: string; limite?: string; pagina?: string;
  json?: boolean;
}): Promise<void> {
  const log = opts.json ? console.error : console.log;
  if (opts.tipo !== "formulario" && opts.tipo !== "survey") {
    throw new Error(`--tipo inválido: ${opts.tipo}. Aceitos: formulario, survey`);
  }
  const survey = opts.tipo === "survey";
  await withClient(opts.location, log, async (client) => {
    const filtro = {
      [survey ? "surveyId" : "formId"]: opts.formulario,
      q: opts.termo,
      startAt: opts.inicio,
      endAt: opts.fim,
      limit: numeroOpcional(opts.limite, "limite", log),
      page: numeroOpcional(opts.pagina, "pagina", log),
    };
    let out: unknown;
    switch (opts.o) {
      case "lista":
        out = survey ? await listSurveys(client, opts.location) : await listForms(client, opts.location);
        break;
      case "detalhe":
        if (!opts.id) throw new Error("-o detalhe exige --id");
        out = survey ? await getSurvey(client, opts.location, opts.id) : await getForm(client, opts.id);
        break;
      case "submissoes":
        out = survey
          ? await listSurveySubmissions(client, opts.location, filtro)
          : await listFormSubmissions(client, opts.location, filtro);
        break;
      case "buscar": {
        if (!opts.termo) throw new Error("-o buscar exige --termo");
        // não existe busca por nome no servidor: a lista inteira é curta e vem numa varredura
        const alvo = opts.termo.toLowerCase();
        const todos = survey
          ? ((await listSurveys(client, opts.location)) as { surveys: { name?: string }[] }).surveys
          : ((await listForms(client, opts.location)) as { forms: { name?: string }[] }).forms;
        out = { itens: todos.filter((x) => (x.name ?? "").toLowerCase().includes(alvo)) };
        break;
      }
      default:
        throw new Error(`-o inválido: ${opts.o}. Aceitos: lista, detalhe, submissoes, buscar`);
    }
    emitir(opts.json, out);
  });
}

const FORM_ACOES = [
  "criar", "apagar", "duplicar", "editar", "versoes", "restaurar",
];

/**
 * O documento vivo de um formulário ou survey, mais o nome atual.
 * O objeto da API às vezes já traz `formData`/`surveyData` embutido; quando
 * não traz, cai para a última entrada do `versionHistory` — a URL dela é
 * pública no Cloud Storage e baixa sem header de auth, igual aos steps de
 * workflow (por isso `baixarVersao` usa `getJsonNoAuth`).
 */
async function carregarRaw(
  client: GhlClient, tipo: "formulario" | "survey", loc: string, id: string,
): Promise<any> {
  return tipo === "survey" ? await getSurvey(client, loc, id) : await getForm(client, id);
}

async function carregarDoc(
  client: GhlClient, tipo: "formulario" | "survey", loc: string, id: string,
): Promise<{ nome: string; doc: Record<string, unknown>; raw: any }> {
  const raw: any = await carregarRaw(client, tipo, loc, id);
  const obj = raw.form ?? raw.survey ?? raw;
  let doc = obj.formData ?? obj.surveyData;
  if (!doc) {
    const ultima = (obj.versionHistory ?? []).at(-1);
    const url = ultima?.formDataDownloadUrl ?? ultima?.surveyDataDownloadUrl;
    if (url) doc = await baixarVersao(client, url);
  }
  if (!doc) {
    throw new Error(
      `o servidor não devolveu formData/surveyData nem uma URL de versionHistory para ${id}`,
    );
  }
  return { nome: obj.name ?? "", doc, raw };
}

async function runFormularioAcao(opts: {
  location: string; acao: string; tipo?: string; id?: string; nome?: string;
  ops?: string; versao?: string; pasta?: string;
  permitirSemBotao?: boolean; permitirVazio?: boolean;
  confirmo?: boolean; json?: boolean;
}): Promise<void> {
  const log = opts.json ? console.error : console.log;
  if (!FORM_ACOES.includes(opts.acao)) {
    throw new Error(`--acao inválida: ${opts.acao}. Aceitas: ${FORM_ACOES.join(", ")}`);
  }
  const tipo = (opts.tipo ?? "formulario") as "formulario" | "survey";
  if (tipo !== "formulario" && tipo !== "survey") {
    throw new Error("--tipo aceita formulario ou survey");
  }
  if (opts.acao !== "criar" && !opts.id) throw new Error(`${opts.acao} exige --id`);
  if (opts.acao === "criar" && !opts.nome) throw new Error("criar exige --nome");
  if (opts.acao === "restaurar" && !opts.versao) throw new Error("restaurar exige --versao");

  let ops: Op[] = [];
  if (opts.ops) {
    try {
      ops = JSON.parse(opts.ops);
    } catch {
      throw new Error('--ops precisa ser JSON: [{"op":"adicionar-campo","campo":{...}}]');
    }
    if (!Array.isArray(ops)) throw new Error("--ops precisa ser uma lista JSON");
  }
  if (opts.acao === "editar" && ops.length === 0) {
    throw new Error("editar exige --ops com ao menos uma operação");
  }

  await withClient(opts.location, log, async (client) => {
    // `versoes` é leitura: sai antes de qualquer guarda de escrita
    if (opts.acao === "versoes") {
      // só precisa de `raw.versionHistory` — usar carregarDoc aqui faria um
      // documento novo (sem formData nem versão) estourar em vez de listar
      // zero versões, e baixaria o documento do Cloud Storage só para
      // descartá-lo.
      const raw = await carregarRaw(client, tipo, opts.location, opts.id!);
      const obj = raw.form ?? raw.survey ?? raw;
      const versoes = (obj.versionHistory ?? []).map((v: any) => ({
        versionId: v.versionId, em: v.updatedAt, por: v.updatedByUser,
        documento: v.formDataDownloadUrl ?? v.surveyDataDownloadUrl,
      }));
      if (opts.json) emitir(true, { versoes });
      else versoes.forEach((v: any) => log(`${v.em}  ${v.versionId}  ${v.por ?? ""}`));
      return;
    }

    // prévia: monta o documento novo e mostra a diferença, sem tocar no servidor
    if (opts.acao === "editar" && !opts.confirmo) {
      const { doc } = await carregarDoc(client, tipo, opts.location, opts.id!);
      const novo = aplicar(doc, ops, {
        permitirSemBotao: opts.permitirSemBotao, permitirVazio: opts.permitirVazio,
      });
      const previa = diferenca(doc, novo);
      if (opts.json) emitir(true, { aplicado: false, previa });
      else {
        log(previa.length ? previa.join("\n") : "nada mudaria");
        log("\nnada foi gravado. Repita com --confirmo para publicar.");
      }
      return;
    }

    if (!opts.confirmo) {
      throw new Error("Isto muda dado real da subconta e não tem desfazer. Repita com --confirmo.");
    }

    // `editar` PRECISA do doc de `antes` para montar `novo` (linha abaixo,
    // `antes!.doc`) — engolir a falha em `null` troca o erro real da API por
    // um TypeError enganoso mais adiante. As outras ações (apagar/duplicar/
    // restaurar) só usam `antes` como registro de auditoria opcional, daí a
    // tolerância continuar valendo pra elas.
    const antes = opts.acao === "criar"
      ? null
      : opts.acao === "editar"
        ? await carregarDoc(client, tipo, opts.location, opts.id!)
        : await carregarDoc(client, tipo, opts.location, opts.id!).catch(() => null);
    const registro = registroEscrita(opts.location, "_formularios", opts.id ?? "novo", {
      acao: opts.acao, tipo, ops, antes, aplicado: false,
    });
    log(`snapshot: ${registro}`);

    // fora do try: se `criar` já respondeu mas a segunda chamada falhar, o catch
    // externo ainda precisa saber qual id ficou órfão no servidor.
    let novoId: string | undefined;
    let criado: unknown;
    let r: unknown;
    let falhouNoRetry = false;
    const TENTATIVAS = 3;
    try {
      switch (opts.acao) {
        case "criar": {
          criado = await criar(client, tipo, {
            locationId: opts.location,
            productType: tipo === "survey" ? "Survey" : "Form",
            parentId: opts.pasta,
          });
          novoId = (criado as any)?.form?._id ?? (criado as any)?.survey?._id ?? (criado as any)?._id;
          if (!novoId) throw new Error(`o servidor não devolveu o id do novo ${tipo}`);
          // grava o id do órfão AGORA: se a etapa seguinte falhar, o rastro já
          // sabe o que limpar, em vez de só o horário do arquivo.
          fs.writeFileSync(registro, JSON.stringify({
            em: new Date().toISOString(), acao: opts.acao, tipo, ops, antes,
            aplicado: false, criadoId: novoId, criado,
          }, null, 2));
          try {
            // o objeto nasce vazio e sem nome; publicar de novo grava nome e campos.
            // O servidor às vezes aceita o POST antes de o id ficar visível para
            // leitura (janela de eventual consistency, medida ao vivo na subconta de teste,
            // Tarefa 9): um GET imediato pode devolver 400 "Form does not exist".
            // Tenta de novo algumas vezes, com um pequeno atraso, antes de desistir.
            const ATRASO_MS = 1500;
            let doc: Record<string, unknown> | undefined;
            let ultimoErro: unknown;
            for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
              try {
                doc = (await carregarDoc(client, tipo, opts.location, novoId)).doc;
                ultimoErro = undefined;
                break;
              } catch (e) {
                ultimoErro = e;
                if (tentativa < TENTATIVAS) await sleep(ATRASO_MS);
              }
            }
            if (ultimoErro || !doc) {
              falhouNoRetry = true;
              throw ultimoErro ?? new Error("carregarDoc não devolveu documento");
            }
            const corpo = ops.length
              ? aplicar(doc, ops, { permitirSemBotao: true, permitirVazio: true })
              : doc;
            // se falhar daqui pra baixo (aplicar/publicar), não passou pelo laço de
            // retry acima — `falhouNoRetry` continua false, e a mensagem abaixo não
            // diz "mesmo após 3 tentativas" para um erro que não tentou 3 vezes.
            r = { criado, publicado: await publicar(client, tipo, novoId, opts.nome!, corpo), id: novoId };
          } catch (e2) {
            const contagem = falhouNoRetry ? ` mesmo após ${TENTATIVAS} tentativas` : "";
            throw new Error(
              `o ${tipo} ${novoId} foi criado no servidor, mas a etapa de publicar falhou` +
              `${contagem}: ele ficou órfão, sem nome e sem campos, na ` +
              `subconta. Rode "formulario-acao --acao apagar -i ${novoId} --confirmo" ` +
              `para removê-lo. Erro original: ${e2 instanceof Error ? e2.message : String(e2)}`,
              { cause: e2 },
            );
          }
          break;
        }
        case "editar": {
          const novo = aplicar(antes!.doc, ops, {
            permitirSemBotao: opts.permitirSemBotao, permitirVazio: opts.permitirVazio,
          });
          r = await publicar(client, tipo, opts.id!, opts.nome ?? antes!.nome, novo);
          break;
        }
        case "apagar": r = await apagar(client, tipo, opts.id!); break;
        case "duplicar": r = await duplicar(client, tipo, opts.id!, opts.nome ?? "cópia", opts.pasta); break;
        case "restaurar": r = await restaurarVersao(client, tipo, opts.id!, opts.versao!); break;
      }
    } catch (e) {
      fs.writeFileSync(registro, JSON.stringify({
        em: new Date().toISOString(), acao: opts.acao, tipo, ops, antes, aplicado: false,
        ...(novoId ? { criadoId: novoId, criado } : {}),
        erro: String(e),
      }, null, 2));
      throw e;
    }
    fs.writeFileSync(registro, JSON.stringify({
      em: new Date().toISOString(), acao: opts.acao, tipo, ops, antes, aplicado: true, resposta: r,
    }, null, 2));
    const out = { aplicado: true, acao: opts.acao, resposta: r, registro };
    if (opts.json) emitir(true, out);
    else log(`ok — ${opts.acao}; registro em ${registro}`);
  }, { escrita: !!opts.confirmo });
}

/**
 * Fotografa a página pública do widget num Chrome do sistema sem perfil, sem trava e sem
 * processo de fundo: a página não exige login.
 */
export async function fotografarWidget(
  url: string, destino: string,
  abrir: () => Promise<Browser> = () => chromium.launch({ channel: "chrome", headless: true }),
): Promise<void> {
  const navegador = await abrir();
  try {
    const aba = await navegador.newPage({ viewport: { width: 480, height: 900 } });
    // não é `networkidle`: medido nesta página, ele nunca resolve — o
    // widget mantém alguma conexão de fundo aberta (analytics/chat)
    await aba.goto(url, { waitUntil: "domcontentloaded" });
    try {
      await aba.waitForSelector("form, input, button", { timeout: 15000 });
    } catch {
      throw new Error(
        `a página pública não renderizou nenhum campo em 15s — o formulário/survey ` +
        `pode estar despublicado ou o --id errado. URL: ${url}`,
      );
    }
    await aba.waitForTimeout(1500); // espera curta p/ fonte e CSS assentarem
    await aba.screenshot({ path: destino, fullPage: true });
  } finally {
    await navegador.close();
  }
}

const ESTILO_ACOES = ["aplicar", "paleta-ver", "paleta-gravar", "temas", "previa-visual"];

/**
 * Aplica tokens de identidade visual a um formulário/survey, ou lê/grava a
 * paleta padrão da subconta (`GET`/`POST /forms/default-colors`).
 * `paleta-gravar` não tem prévia: a guarda de `--confirmo` é um erro seco, não
 * um "mostra e não grava", porque o alvo é a subconta inteira, não um documento.
 */
async function runFormularioEstilo(opts: {
  location: string; acao: string; tipo?: string; id?: string; tokens?: string;
  versao?: string; saida?: string;
  confirmo?: boolean; json?: boolean;
}): Promise<void> {
  const log = opts.json ? console.error : console.log;
  if (!ESTILO_ACOES.includes(opts.acao)) {
    throw new Error(`--acao inválida: ${opts.acao}. Aceitas: ${ESTILO_ACOES.join(", ")}`);
  }
  const tipo = (opts.tipo ?? "formulario") as "formulario" | "survey";
  if (tipo !== "formulario" && tipo !== "survey") {
    throw new Error("--tipo aceita formulario ou survey");
  }

  let tokens: TokensEstilo | undefined;
  if (opts.tokens) {
    const texto = fs.existsSync(opts.tokens) ? fs.readFileSync(opts.tokens, "utf-8") : opts.tokens;
    try {
      tokens = JSON.parse(texto);
    } catch {
      throw new Error("--tokens precisa ser JSON, ou o caminho de um arquivo JSON");
    }
  }
  if ((opts.acao === "aplicar" || opts.acao === "paleta-gravar") && !tokens) {
    throw new Error(`${opts.acao} exige --tokens`);
  }
  if (opts.acao === "aplicar" && !opts.id) throw new Error("aplicar exige --id");

  if (opts.acao === "previa-visual") {
    if (!opts.id) throw new Error("previa-visual exige --id");
    const widget = tipo === "survey" ? "survey" : "form";
    const versao = opts.versao ? `&versionId=${encodeURIComponent(opts.versao)}&nocache=true` : "";
    // `notrack=true`: o preview não conta como visita na estatística do cliente
    const url = `https://link.msgsndr.com/widget/${widget}/${encodeURIComponent(opts.id)}?notrack=true${versao}`;
    const destino = opts.saida ?? path.join(os.tmpdir(), `formulario-${opts.id}.png`);
    await fotografarWidget(url, destino);
    if (opts.json) emitir(true, { url, arquivo: destino });
    else log(`${url}\n${destino}`);
    return;
  }

  await withClient(opts.location, log, async (client) => {
    if (opts.acao === "temas" || opts.acao === "paleta-ver") {
      const r = opts.acao === "temas"
        ? await temas(client, tipo, opts.location)
        : await paletaPadrao(client, opts.location);
      if (opts.json) emitir(true, { resultado: r });
      else log(JSON.stringify(r, null, 2));
      return;
    }

    if (opts.acao === "aplicar") {
      const { nome, doc } = await carregarDoc(client, tipo, opts.location, opts.id!);
      // opsDeEstilo só gera "definir" em caminhos de estilo — nunca toca
      // campo nem botão — então as guardas de "documento sem campo" e "sem
      // botão de envio" não fazem sentido aqui: elas checariam um estado que
      // já existia antes desta operação, e bloqueariam estilo por um
      // problema que estilo não causou nem pode resolver.
      const novo = aplicar(doc, opsDeEstilo(doc, tokens!), { permitirSemBotao: true, permitirVazio: true });
      if (!opts.confirmo) {
        const previa = diferenca(doc, novo);
        if (opts.json) emitir(true, { aplicado: false, previa });
        else { log(previa.length ? previa.join("\n") : "nada mudaria"); log("\nnada foi gravado. Repita com --confirmo."); }
        return;
      }
      const registro = registroEscrita(opts.location, "_formularios", opts.id!, {
        acao: "estilo", tipo, tokens, antes: doc, aplicado: false,
      });
      log(`snapshot: ${registro}`);
      let r: unknown;
      try {
        r = await publicar(client, tipo, opts.id!, nome, novo);
      } catch (e) {
        fs.writeFileSync(registro, JSON.stringify({
          em: new Date().toISOString(), acao: "estilo", tipo, tokens, antes: doc, aplicado: false, erro: String(e),
        }, null, 2));
        throw e;
      }
      fs.writeFileSync(registro, JSON.stringify({
        em: new Date().toISOString(), acao: "estilo", tipo, tokens, antes: doc, aplicado: true, resposta: r,
      }, null, 2));
      const out = { aplicado: true, acao: "estilo", resposta: r, registro };
      if (opts.json) emitir(true, out);
      else log(`ok — estilo aplicado; registro em ${registro}`);
      return;
    }

    // paleta-gravar: muda TODA a subconta, não um formulário — sem prévia
    if (!opts.confirmo) {
      throw new Error(
        "gravar a paleta muda a cor padrão de todo formulário novo desta subconta, " +
        "inclusive os que o cliente criar na interface. As cores já existentes na subconta " +
        "são preservadas: só os cinco papéis da identidade (Primary/Text/Background/" +
        "Border/Error) são sobrescritos. Repita com --confirmo.",
      );
    }
    const antes = await paletaPadrao(client, opts.location).catch(() => null);
    // `aviso`, quando presente, vai no JSON de saída — não só no stderr do
    // `log` — porque o servidor MCP (`_run_extractor`) só parseia a última
    // linha do stdout e descarta o stderr inteiro no caminho de sucesso: sem
    // isso, quem chama pela tool MCP nunca vê que a paleta foi SUBSTITUÍDA
    // em vez de mesclada.
    const { colors, aviso } = resolverPaleta(antes as { colors?: CorNomeada[] } | null, tokens!);
    if (aviso) log(`aviso: ${aviso}`);
    const registro = registroEscrita(opts.location, "_formularios", "paleta", {
      acao: "paleta-gravar", tokens, antes, colors, aviso, aplicado: false,
    });
    log(`snapshot: ${registro}`);
    let r: unknown;
    try {
      r = await gravarPaletaPadrao(client, opts.location, colors);
    } catch (e) {
      fs.writeFileSync(registro, JSON.stringify({
        em: new Date().toISOString(), acao: "paleta-gravar", tokens, antes, colors, aviso, aplicado: false, erro: String(e),
      }, null, 2));
      throw e;
    }
    fs.writeFileSync(registro, JSON.stringify({
      em: new Date().toISOString(), acao: "paleta-gravar", tokens, antes, colors, aviso, aplicado: true, resposta: r,
    }, null, 2));
    const out = saidaPaletaGravar({ resposta: r, registro, aviso });
    if (opts.json) emitir(true, out);
    else log(`ok — paleta gravada; registro em ${registro}`);
  }, { escrita: !!opts.confirmo });
}

export function registrarFormularios(program: Command): void {
  program
    .command("formularios")
    .description("Leitura ao vivo de formulários, surveys e suas submissões")
    .requiredOption("-l, --location <id>", "locationId da subconta")
    .option("-o, --o <op>", "lista | detalhe | submissoes | buscar", "lista")
    .option("--tipo <t>", "formulario | survey", "formulario")
    .option("-i, --id <id>", "id do formulário ou survey (com -o detalhe)")
    .option("--formulario <id>", "filtra as submissões por formulário ou survey")
    .option("--termo <texto>", "busca por nome (-o buscar) ou por contato/e-mail/telefone (-o submissoes)")
    .option("--inicio <data>", "primeira data das submissões, YYYY-MM-DD")
    .option("--fim <data>", "última data das submissões, YYYY-MM-DD")
    .option("--limite <n>", "quantas submissões trazer, até 100")
    .option("--pagina <n>", "página das submissões, a partir de 1")
    .option("--json", "imprime o resultado em JSON no stdout")
    .action((o) => runFormularios(o).catch(falhar));

  program
    .command("formulario-acao")
    .description("ESCREVE: cria, edita, duplica, apaga ou restaura formulário e survey")
    .requiredOption("-l, --location <id>", "locationId da subconta")
    .requiredOption("--acao <a>", FORM_ACOES.join(" | "))
    .option("--tipo <t>", "formulario | survey", "formulario")
    .option("-i, --id <id>", "id do formulário ou survey")
    .option("--nome <texto>", "nome do formulário (criar, duplicar, editar)")
    .option("--ops <json>", 'operações: [{"op":"remover-campo","alvo":"email"}]. Em --acao criar, ' +
      "publica com as duas guardas (--permitir-sem-botao/--permitir-vazio) sempre liberadas — " +
      "o documento nasce vazio, então bloquear não ajudaria — e pode publicar sem botão de envio")
    .option("--versao <versionId>", "versão a restaurar")
    .option("--pasta <id>", "pasta de destino (survey)")
    .option("--permitir-sem-botao", "libera deixar o documento sem botão de envio")
    .option("--permitir-vazio", "libera deixar o documento sem nenhum campo")
    .option("--confirmo", "obrigatório: publica de verdade. Sem ele, só mostra a prévia")
    .option("--json", "imprime o resultado em JSON no stdout")
    .action((o) => runFormularioAcao(o).catch(falhar));

  program
    .command("formulario-estilo")
    .description("ESCREVE: aplica tokens visuais a um formulário, ou grava a paleta padrão da subconta")
    .requiredOption("-l, --location <id>", "locationId da subconta")
    .requiredOption("--acao <a>", ESTILO_ACOES.join(" | "))
    .option("--tipo <t>", "formulario | survey", "formulario")
    .option("-i, --id <id>", "id do formulário ou survey")
    .option("--tokens <json|arquivo>", "tokens de identidade visual")
    .option("--versao <versionId>", "previa-visual: versão específica do documento")
    .option("--saida <arquivo>", "previa-visual: caminho do PNG (padrão: temp)")
    .option("--confirmo", "obrigatório para gravar. Sem ele, só mostra a prévia (exceto paleta-gravar)")
    .option("--json", "imprime o resultado em JSON no stdout")
    .action((o) => runFormularioEstilo(o).catch(falhar));
}
