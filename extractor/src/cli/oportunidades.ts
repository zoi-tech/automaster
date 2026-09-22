import { Command } from "commander";
import { GhlClient } from "../api/client.js";
import {
  listPipelines, listOpportunities, searchOpportunities, getOpportunity, createOpportunity,
  updateOpportunity, deleteOpportunity, restoreOpportunity, createPipeline, updatePipeline,
  deletePipeline
} from "../api/opportunities.js";
import fs from "node:fs";
import { withClient, registroEscrita, numeroOpcional } from "./shared.js";
import { emitir, falhar } from "../saida.js";

const OPP_ACOES = ["criar", "editar", "mover", "status", "apagar", "restaurar"];

const PIPE_ACOES = ["criar", "editar", "apagar"];

async function runOportunidades(opts: {
  location: string; o: string; id?: string; pipeline?: string; estagio?: string;
  status?: string; contato?: string; termo?: string; limite?: string; pagina?: string;
  json?: boolean;
}): Promise<void> {
  const log = opts.json ? console.error : console.log;
  await withClient(opts.location, log, async (client) => {
    const filtro = {
      pipeline_id: opts.pipeline,
      pipeline_stage_id: opts.estagio,
      status: opts.status,
      contact_id: opts.contato,
      limit: numeroOpcional(opts.limite, "limite", log),
      page: numeroOpcional(opts.pagina, "pagina", log),
    };
    let out: unknown;
    switch (opts.o) {
      case "pipelines": out = await listPipelines(client, opts.location); break;
      case "listar": out = await listOpportunities(client, opts.location, filtro); break;
      case "buscar":
        if (!opts.termo) throw new Error("-o buscar exige --termo");
        out = await searchOpportunities(client, opts.location, opts.termo, filtro);
        break;
      case "ver":
        if (!opts.id) throw new Error("-o ver exige --id");
        out = await getOpportunity(client, opts.id);
        break;
      default:
        throw new Error(
          `-o inválido: ${opts.o}. Aceitos: pipelines, listar, buscar, ver`,
        );
    }
    emitir(opts.json, out);
  });
}

async function runOportunidadeAcao(opts: {
  location: string; acao: string; id?: string; pipeline?: string; estagio?: string;
  nome?: string; valor?: string; status?: string; contato?: string; dono?: string;
  fechamento?: string; probabilidade?: string; campos?: string;
  confirmo?: boolean; json?: boolean;
}): Promise<void> {
  const log = opts.json ? console.error : console.log;
  if (!OPP_ACOES.includes(opts.acao)) {
    throw new Error(`--acao inválida: ${opts.acao}. Aceitas: ${OPP_ACOES.join(", ")}`);
  }
  if (!opts.confirmo) {
    throw new Error("Isto muda dado real da subconta e não tem desfazer. Repita com --confirmo.");
  }
  if (opts.acao === "criar") {
    if (!opts.pipeline || !opts.nome || !opts.contato) {
      throw new Error("criar exige --pipeline, --nome e --contato");
    }
  } else if (!opts.id) {
    throw new Error(`${opts.acao} exige --id da oportunidade`);
  }
  if (opts.acao !== "criar" && opts.contato) {
    throw new Error(
      "não dá para trocar o contato de uma oportunidade: o vínculo se define quando o card " +
      "nasce. Crie outro card para a pessoa certa.",
    );
  }

  let campos: { id: string; fieldValue: unknown }[] | undefined;
  if (opts.campos) {
    try {
      campos = JSON.parse(opts.campos);
    } catch {
      throw new Error('--campos precisa ser JSON: [{"id":"...","fieldValue":"..."}]');
    }
    if (!Array.isArray(campos)) throw new Error("--campos precisa ser uma lista JSON");
  }

  await withClient(opts.location, log, async (client) => {
    const corpo = {
      ...(opts.nome ? { name: opts.nome } : {}),
      // o servidor exige `status` na criação; `open` é o estado natural de um card novo
      ...(opts.status ? { status: opts.status } : opts.acao === "criar" ? { status: "open" } : {}),
      ...(opts.pipeline ? { pipelineId: opts.pipeline } : {}),
      ...(opts.estagio ? { pipelineStageId: opts.estagio } : {}),
      ...(opts.contato ? { contactId: opts.contato } : {}),
      ...(opts.valor ? { monetaryValue: Number(opts.valor) } : {}),
      ...(opts.dono ? { assignedTo: opts.dono } : {}),
      ...(opts.fechamento ? { forecastExpectedCloseDate: opts.fechamento } : {}),
      ...(opts.probabilidade ? { forecastProbability: Number(opts.probabilidade) } : {}),
      ...(campos ? { customFields: campos } : {}),
    };
    const antes = opts.id ? await getOpportunity(client, opts.id).catch(() => null) : null;
    const registro = registroEscrita(opts.location, "_oportunidades", opts.id ?? "novo", {
      acao: opts.acao, corpo, antes, aplicado: false,
    });

    let r: unknown;
    try {
      switch (opts.acao) {
        case "criar": r = await createOpportunity(client, opts.location, corpo); break;
        case "editar":
        case "mover":
        case "status": r = await updateOpportunity(client, opts.id!, corpo); break;
        case "apagar": r = await deleteOpportunity(client, opts.id!); break;
        case "restaurar": r = await restoreOpportunity(client, opts.id!); break;
      }
    } catch (e) {
      fs.writeFileSync(registro, JSON.stringify({
        em: new Date().toISOString(), acao: opts.acao, corpo, antes, aplicado: false, erro: String(e),
      }, null, 2));
      throw e;
    }
    fs.writeFileSync(registro, JSON.stringify({
      em: new Date().toISOString(), acao: opts.acao, corpo, antes, aplicado: true, resposta: r,
    }, null, 2));
    const out = { aplicado: true, acao: opts.acao, resposta: r, registro };
    if (opts.json) emitir(true, out);
    else log(`ok — ${opts.acao}; registro em ${registro}`);
  });
}

/** Estágios que sumiriam com a nova lista, e quantos cards vivem em cada um. */
async function estagiosQueSomem(
  client: GhlClient, locationId: string, pipelineId: string, novos: { id?: string; name: string }[],
): Promise<{ id: string; name: string; cards: number }[]> {
  const atual = await listPipelines(client, locationId);
  const p = (atual.pipelines ?? []).find((x) => x.id === pipelineId);
  if (!p) throw new Error(`pipeline ${pipelineId} não existe na subconta`);
  const mantidos = new Set(novos.map((s) => s.id).filter(Boolean));
  const somem = (p.stages ?? []).filter((s) => !mantidos.has(s.id));
  const out: { id: string; name: string; cards: number }[] = [];
  for (const s of somem) {
    const r = await listOpportunities(client, locationId, {
      pipeline_id: pipelineId, pipeline_stage_id: s.id, status: "all", limit: 1,
    }) as { total?: number; opportunities?: unknown[] };
    out.push({ id: s.id, name: s.name, cards: r.total ?? (r.opportunities?.length ?? 0) });
  }
  return out.filter((s) => s.cards > 0);
}

async function runPipeline(opts: {
  location: string; acao: string; id?: string; nome?: string; estagios?: string;
  confirmo?: boolean; apagarComCards?: boolean; json?: boolean;
}): Promise<void> {
  const log = opts.json ? console.error : console.log;
  if (!PIPE_ACOES.includes(opts.acao)) {
    throw new Error(`--acao inválida: ${opts.acao}. Aceitas: ${PIPE_ACOES.join(", ")}`);
  }
  if (!opts.confirmo) {
    throw new Error("Isto muda a estrutura do funil e não tem desfazer. Repita com --confirmo.");
  }
  if (opts.acao !== "criar" && !opts.id) throw new Error(`${opts.acao} exige --id do pipeline`);
  if (opts.acao === "criar" && !opts.nome) throw new Error("criar exige --nome");

  let estagios: { id?: string; name: string; position?: number }[] = [];
  if (opts.estagios) {
    try {
      estagios = JSON.parse(opts.estagios);
    } catch {
      throw new Error('--estagios precisa ser JSON: [{"id":"...","name":"..."}]');
    }
    if (!Array.isArray(estagios)) throw new Error("--estagios precisa ser uma lista JSON");
  }
  if (opts.acao !== "apagar" && estagios.length === 0) {
    throw new Error(`${opts.acao} exige --estagios com a lista completa dos estágios que devem existir`);
  }

  await withClient(opts.location, log, async (client) => {
    if (opts.acao === "editar") {
      const somem = await estagiosQueSomem(client, opts.location, opts.id!, estagios);
      if (somem.length > 0 && !opts.apagarComCards) {
        const linhas = somem.map((s) => `  ${s.name} (${s.cards} card${s.cards > 1 ? "s" : ""})`).join("\n");
        throw new Error(
          `esta edição remove estágio que tem card dentro:\n${linhas}\n` +
          "Os cards não somem: o servidor joga todos para um estágio que sobrou, de uma vez. " +
          "Isso muda o estágio de cada um sem aviso e acorda toda automação que reage a " +
          "transição. Esvazie os estágios antes, ou repita com --apagar-com-cards.",
        );
      }
    }
    const registro = registroEscrita(opts.location, "_oportunidades", `pipeline-${opts.id ?? "novo"}`, {
      acao: opts.acao, nome: opts.nome, estagios,
      antes: await listPipelines(client, opts.location).catch(() => null),
      aplicado: false,
    });
    let r: unknown;
    switch (opts.acao) {
      case "criar": r = await createPipeline(client, opts.location, opts.nome!, estagios); break;
      case "editar": r = await updatePipeline(client, opts.location, opts.id!, opts.nome ?? "", estagios); break;
      case "apagar": r = await deletePipeline(client, opts.location, opts.id!); break;
    }
    fs.writeFileSync(registro, JSON.stringify({
      em: new Date().toISOString(), acao: opts.acao, aplicado: true, resposta: r,
    }, null, 2));
    const out = { aplicado: true, acao: opts.acao, resposta: r, registro };
    if (opts.json) emitir(true, out);
    else log(`ok — ${opts.acao}; registro em ${registro}`);
  });
}

export function registrarOportunidades(program: Command): void {
  program
    .command("oportunidades")
    .description("Leitura ao vivo de pipelines e oportunidades da subconta")
    .requiredOption("-l, --location <id>", "locationId da subconta")
    .option("-o, --o <op>", "pipelines | listar | buscar | ver", "pipelines")
    .option("-i, --id <id>", "id da oportunidade (com -o ver)")
    .option("--pipeline <id>", "filtra por pipeline")
    .option("--estagio <id>", "filtra por estágio")
    .option("--status <s>", "open | won | lost | abandoned | all")
    .option("--contato <id>", "filtra pelas oportunidades de um contato")
    .option("--termo <texto>", "termo de busca (com -o buscar)")
    .option("--limite <n>", "quantos cards trazer")
    .option("--pagina <n>", "página da listagem, a partir de 1")
    .option("--json", "imprime o resultado em JSON no stdout")
    .action((o) => runOportunidades(o).catch(falhar));

  program
    .command("oportunidade-acao")
    .description("ESCREVE: cria, edita, move, apaga ou restaura uma oportunidade")
    .requiredOption("-l, --location <id>", "locationId da subconta")
    .requiredOption("--acao <a>", "criar | editar | mover | status | apagar | restaurar")
    .option("-i, --id <id>", "id da oportunidade (tudo menos criar)")
    .option("--pipeline <id>", "pipeline do card")
    .option("--estagio <id>", "estágio do card")
    .option("--nome <texto>", "nome do card")
    .option("--valor <n>", "valor monetário")
    .option("--status <s>", "open | won | lost | abandoned")
    .option("--contato <id>", "só na criação; o vínculo não se troca depois")
    .option("--dono <id>", "usuário responsável")
    .option("--fechamento <data>", "previsão de fechamento, AAAA-MM-DD")
    .option("--probabilidade <n>", "probabilidade de ganhar, 0 a 100")
    .option("--campos <json>", 'campos personalizados: [{"id":"...","fieldValue":"..."}]')
    .option("--confirmo", "obrigatório: muda dado real e não tem desfazer")
    .option("--json", "imprime o resultado em JSON no stdout")
    .action((o) => runOportunidadeAcao(o).catch(falhar));

  program
    .command("pipeline")
    .description("ESCREVE: cria, edita ou apaga um pipeline e seus estágios")
    .requiredOption("-l, --location <id>", "locationId da subconta")
    .requiredOption("--acao <a>", "criar | editar | apagar")
    .option("-i, --id <id>", "id do pipeline (editar e apagar)")
    .option("--nome <texto>", "nome do pipeline")
    .option("--estagios <json>", 'lista COMPLETA dos estágios: [{"id":"...","name":"..."}]')
    .option("--apagar-com-cards", "libera remover estágio com card dentro; os cards migram para outro estágio")
    .option("--confirmo", "obrigatório: muda a estrutura do funil e não tem desfazer")
    .option("--json", "imprime o resultado em JSON no stdout")
    .action((o) => runPipeline(o).catch(falhar));
}
