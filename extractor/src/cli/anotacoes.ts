import { Command } from "commander";
import {
  listar as listarAnotacao, ler as lerAnotacao, criar as criarAnotacao, editar as editarAnotacao,
  apagar as apagarAnotacao, concluir as concluirTarefa, buscarTarefas, deuCerto,
  type Tipo as TipoAnotacao
} from "../api/annotations.js";
import { listarTags, criarTag, renomearTag, apagarTag, acharTag } from "../api/tags.js";
import { withClient, registroEscrita } from "./shared.js";
import { emitir, falhar } from "../saida.js";

const ANOTACAO_LEITURA = ["lista", "detalhe", "buscar"] as const;

const ANOTACAO_ACOES = ["criar", "editar", "apagar", "concluir", "reabrir"] as const;

const ANOTACAO_TIPOS = ["nota", "tarefa"] as const;

interface OptsAnotacoes {
  location: string; o?: string; tipo?: string; contato?: string; id?: string;
  dono?: string; concluidas?: string; termo?: string; limite?: string; json?: boolean;
}

/**
 * Leitura de nota e tarefa. `-o buscar` é o único que não precisa de contato: varre as
 * tarefas de toda a subconta, que é a pergunta útil ("o que está atrasado aqui").
 */
async function runAnotacoes(o: OptsAnotacoes): Promise<void> {
  const op = o.o ?? "lista";
  const tipo = (o.tipo ?? "nota") as TipoAnotacao;
  if (!ANOTACAO_LEITURA.includes(op as never)) {
    throw new Error(`-o inválido: ${op}. Aceitos: ${ANOTACAO_LEITURA.join(", ")}`);
  }
  if (!ANOTACAO_TIPOS.includes(tipo as never)) {
    throw new Error(`--tipo inválido: ${o.tipo}. Aceitos: ${ANOTACAO_TIPOS.join(", ")}`);
  }
  if (op === "buscar" && tipo !== "tarefa") {
    throw new Error("-o buscar só existe para tarefa: não há busca de nota por subconta");
  }
  if (op !== "buscar" && !o.contato) throw new Error(`-o ${op} exige --contato`);
  if (op === "detalhe" && !o.id) throw new Error("-o detalhe exige -i");

  await withClient(o.location, (m) => { if (!o.json) console.log(m); }, async (client) => {
    let saida: unknown;
    if (op === "lista") saida = await listarAnotacao(client, tipo, o.contato!);
    else if (op === "detalhe") saida = await lerAnotacao(client, tipo, o.contato!, o.id!);
    else {
      saida = await buscarTarefas(client, o.location, {
        contactId: o.contato ? [o.contato] : undefined,
        assignedTo: o.dono ? [o.dono] : undefined,
        completed: o.concluidas === undefined ? undefined : o.concluidas === "true",
        query: o.termo,
        limit: o.limite ? Number(o.limite) : undefined,
      });
    }
    const r = { op, tipo, contato: o.contato ?? null, resultado: saida };
    emitir(o.json, r);
  });
}

interface OptsAnotacaoAcao {
  location: string; acao: string; tipo?: string; contato: string; id?: string;
  texto?: string; titulo?: string; prazo?: string; dono?: string;
  confirmo?: boolean; json?: boolean;
}

/**
 * Escrita de nota e tarefa. Camada crua: a prévia aqui só mostra o corpo que iria para o
 * servidor. Criar tarefa preenche `completed: false` sozinha — o campo é obrigatório no POST
 * e ninguém cria tarefa já concluída.
 */
async function runAnotacaoAcao(o: OptsAnotacaoAcao): Promise<void> {
  const tipo = (o.tipo ?? "nota") as TipoAnotacao;
  if (!ANOTACAO_ACOES.includes(o.acao as never)) {
    throw new Error(`--acao inválida: ${o.acao}. Aceitas: ${ANOTACAO_ACOES.join(", ")}`);
  }
  if (!ANOTACAO_TIPOS.includes(tipo as never)) {
    throw new Error(`--tipo inválido: ${o.tipo}. Aceitos: ${ANOTACAO_TIPOS.join(", ")}`);
  }
  if (!o.contato) throw new Error("--contato é obrigatório");
  if (o.acao !== "criar" && !o.id) throw new Error(`--acao ${o.acao} exige -i`);
  if ((o.acao === "concluir" || o.acao === "reabrir") && tipo !== "tarefa") {
    throw new Error("concluir e reabrir só existem para tarefa");
  }
  if (o.acao === "criar" && tipo === "nota" && !o.texto) {
    throw new Error("criar nota exige --texto");
  }
  if (o.acao === "criar" && tipo === "tarefa" && !(o.titulo && o.prazo)) {
    throw new Error("criar tarefa exige --titulo e --prazo (data ISO, ex. 2026-10-01T10:00:00Z)");
  }

  const corpo: Record<string, unknown> = {};
  if (tipo === "nota") {
    if (o.texto !== undefined) corpo.body = o.texto;
  } else {
    if (o.titulo !== undefined) corpo.title = o.titulo;
    if (o.texto !== undefined) corpo.body = o.texto;
    if (o.prazo !== undefined) corpo.dueDate = o.prazo;
    if (o.dono !== undefined) corpo.assignedTo = o.dono;
    // Obrigatório no POST; sem isto toda criação de tarefa falha.
    if (o.acao === "criar") corpo.completed = false;
  }

  if (!o.confirmo) {
    const previa = {
      previa: true, aplicado: false, acao: o.acao, tipo, contato: o.contato, id: o.id ?? null,
      corpo, aviso: "nada foi gravado. Repita com --confirmo para gravar.",
    };
    emitir(o.json, previa);
    return;
  }

  await withClient(o.location, (m) => { if (!o.json) console.log(m); }, async (client) => {
    const antes = o.id ? await lerAnotacao(client, tipo, o.contato, o.id).catch(() => null) : null;
    let resposta: unknown;
    if (o.acao === "criar") resposta = await criarAnotacao(client, tipo, o.contato, corpo);
    else if (o.acao === "editar") resposta = await editarAnotacao(client, tipo, o.contato, o.id!, corpo);
    else if (o.acao === "apagar") resposta = await apagarAnotacao(client, tipo, o.contato, o.id!);
    else resposta = await concluirTarefa(client, o.contato, o.id!, o.acao === "concluir");

    const registro = registroEscrita(o.location, "_anotacoes", o.contato, {
      acao: o.acao, tipo, id: o.id ?? null, corpo, antes, resposta,
    });
    const r = {
      aplicado: true, acao: o.acao, tipo, contato: o.contato, id: o.id ?? null,
      resposta, apagou: o.acao === "apagar" ? deuCerto(resposta) : undefined, registro,
    };
    emitir(o.json, r);
  }, { escrita: true });
}

const TAG_ACOES = ["criar", "renomear", "apagar"] as const;

/** Lista as tags da subconta, ao vivo. O cruzamento com os workflows é da tool MCP. */
async function runTags(o: { location: string; termo?: string; json?: boolean }): Promise<void> {
  await withClient(o.location, (m) => { if (!o.json) console.log(m); }, async (client) => {
    let tags = await listarTags(client, o.location);
    if (o.termo) {
      const alvo = o.termo.trim().toLowerCase();
      tags = tags.filter((t) => t.name.toLowerCase().includes(alvo));
    }
    const saida = { total: tags.length, tags };
    emitir(o.json, saida);
  });
}

interface OptsTagAcao {
  location: string; acao: string; tag?: string; nome?: string;
  apagarCitada?: boolean; confirmo?: boolean; json?: boolean;
}

/**
 * Escrita de tag da subconta.
 *
 * `renomear` é escrita comum: provado ao vivo que o servidor reescreve a referência nos
 * workflows, inclusive no trigger.
 *
 * `apagar` é a operação perigosa: arranca a tag de todos os contatos que a têm, e não há
 * prova de que isso não dispare os workflows com trigger de "tag removida". A guarda
 * `--apagar-citada` mora na tool MCP, que sabe quais workflows citam a tag; aqui, camada
 * crua, a prévia só declara o risco.
 */
async function runTagAcao(o: OptsTagAcao): Promise<void> {
  if (!TAG_ACOES.includes(o.acao as never)) {
    throw new Error(`--acao inválida: ${o.acao}. Aceitas: ${TAG_ACOES.join(", ")}`);
  }
  if (o.acao === "criar" && !o.nome) throw new Error("criar exige --nome");
  if (o.acao === "renomear" && !(o.tag && o.nome)) throw new Error("renomear exige --tag e --nome");
  if (o.acao === "apagar" && !o.tag) throw new Error("apagar exige --tag");

  await withClient(o.location, (m) => { if (!o.json) console.log(m); }, async (client) => {
    const tags = await listarTags(client, o.location);
    const alvo = o.tag ? acharTag(tags, o.tag) : undefined;
    if (o.acao !== "criar" && !alvo) {
      throw new Error(`tag não encontrada na subconta: ${o.tag}`);
    }
    if (o.acao === "criar" && acharTag(tags, o.nome!)) {
      throw new Error(`já existe uma tag chamada "${o.nome}" — nomes de tag não distinguem maiúscula`);
    }

    if (!o.confirmo) {
      const previa: Record<string, unknown> = {
        previa: true, aplicado: false, acao: o.acao,
        tag: alvo ?? null, nome: o.nome ?? null,
        aviso: "nada foi gravado. Repita com --confirmo para gravar.",
      };
      if (o.acao === "renomear") {
        previa.efeito = "o servidor troca o nome também dentro dos workflows que citam a tag, " +
          "inclusive no trigger (provado ao vivo em 2026-09-21)";
      }
      if (o.acao === "apagar") {
        previa.efeito = "a tag sai de TODOS os contatos que a têm. Não há como saber quantos: o " +
          "GHL não expõe contagem de contatos por tag. Pode disparar os workflows com trigger " +
          "de tag removida — isso não tem prova, nem a favor nem contra.";
      }
      emitir(o.json, previa);
      return;
    }

    let resposta: unknown;
    if (o.acao === "criar") resposta = await criarTag(client, o.location, o.nome!);
    else if (o.acao === "renomear") resposta = await renomearTag(client, o.location, alvo!.id, o.nome!);
    else resposta = await apagarTag(client, o.location, alvo!.id);

    const registro = registroEscrita(o.location, "_tags", alvo?.id ?? "nova", {
      acao: o.acao, antes: alvo ?? null, nome: o.nome ?? null, resposta,
    });
    const feito = { aplicado: true, acao: o.acao, resposta, registro };
    emitir(o.json, feito);
  }, { escrita: !!o.confirmo });
}

export function registrarAnotacoes(program: Command): void {
  program
    .command("anotacoes")
    .description("Leitura ao vivo de notas e tarefas do contato")
    .requiredOption("-l, --location <id>", "locationId da subconta")
    .option("-o, --o <op>", ANOTACAO_LEITURA.join(" | "), "lista")
    .option("--tipo <t>", ANOTACAO_TIPOS.join(" | "), "nota")
    .option("--contato <id>", "contactId (obrigatório, menos em -o buscar)")
    .option("-i, --id <id>", "id da nota ou tarefa (com -o detalhe)")
    .option("--dono <userId>", "filtra as tarefas por responsável (-o buscar)")
    .option("--concluidas <bool>", "true | false: filtra tarefas concluídas (-o buscar)")
    .option("--termo <texto>", "busca no texto das tarefas (-o buscar)")
    .option("--limite <n>", "quantas tarefas trazer; o servidor usa 25 por padrão")
    .option("--json", "imprime o resultado em JSON no stdout")
    .action((o) => runAnotacoes(o).catch(falhar));

  program
    .command("anotacao-acao")
    .description("ESCREVE: cria, edita, apaga nota ou tarefa do contato; conclui ou reabre tarefa")
    .requiredOption("-l, --location <id>", "locationId da subconta")
    .requiredOption("--acao <a>", ANOTACAO_ACOES.join(" | "))
    .requiredOption("--contato <id>", "contactId")
    .option("--tipo <t>", ANOTACAO_TIPOS.join(" | "), "nota")
    .option("-i, --id <id>", "id da nota ou tarefa (tudo menos criar)")
    .option("--texto <texto>", "corpo da nota, ou descrição da tarefa")
    .option("--titulo <texto>", "título da tarefa (obrigatório ao criar tarefa)")
    .option("--prazo <iso>", "vencimento da tarefa em ISO, ex. 2026-10-01T10:00:00Z")
    .option("--dono <userId>", "responsável pela tarefa")
    .option("--confirmo", "obrigatório: grava de verdade. Sem ele, só mostra a prévia")
    .option("--json", "imprime o resultado em JSON no stdout")
    .action((o) => runAnotacaoAcao(o).catch(falhar));

  program
    .command("tags")
    .description("Leitura ao vivo das tags da subconta")
    .requiredOption("-l, --location <id>", "locationId da subconta")
    .option("--termo <texto>", "filtra as tags por parte do nome")
    .option("--json", "imprime o resultado em JSON no stdout")
    .action((o) => runTags(o).catch(falhar));

  program
    .command("tag-acao")
    .description("ESCREVE: cria, renomeia ou apaga uma tag da subconta")
    .requiredOption("-l, --location <id>", "locationId da subconta")
    .requiredOption("--acao <a>", TAG_ACOES.join(" | "))
    .option("--tag <nomeOuId>", "a tag alvo (renomear, apagar)")
    .option("--nome <texto>", "nome novo (criar, renomear)")
    .option("--confirmo", "obrigatório: grava de verdade. Sem ele, só mostra a prévia")
    .option("--json", "imprime o resultado em JSON no stdout")
    .action((o) => runTagAcao(o).catch(falhar));
}
