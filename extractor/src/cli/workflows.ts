import { Command } from "commander";
import { decodeUserId } from "../auth/token.js";
import { GhlClient } from "../api/client.js";
import { getContact } from "../api/contacts.js";
import {
  todosOsInscritos, WF_TETO_PADRAO, listarWorkflows, getWorkflowMeta, inscricoesDoContato,
  resumoPorWorkflow, resumoPorContato, saidaWorkflowAcao, avisoDespublicar, contarNaoTerminados,
  mudarStatus, inscreverContato, removerContato, retomarInscricao, resolverInscricao,
  nomeContato, STATUS_WORKFLOW, type StatusWorkflow
} from "../api/workflows-live.js";
import fs from "node:fs";
import { withClient, registroEscrita, numeroOpcional } from "./shared.js";
import { emitir, falhar } from "../saida.js";

const WF_LEITURA = ["lista", "dentro", "contato"];

const WF_ACOES = ["publicar", "inscrever", "remover", "retomar"];

/** Nome de cada contato, uma chamada por id. Falha em um não derruba a lista. */
async function nomesDeContatos(
  client: GhlClient, loc: string, ids: string[],
): Promise<Record<string, string>> {
  const nomes: Record<string, string> = {};
  for (const id of [...new Set(ids)].filter(Boolean)) {
    try {
      const c = await getContact(client, loc, id) as {
        contact?: { contactName?: string; name?: string; firstName?: string; lastName?: string; email?: string };
      };
      const nome = c?.contact ? nomeContato(c.contact) : "";
      if (nome) nomes[id] = nome;
    } catch {
      // contato apagado depois de entrar no workflow: segue sem o nome
    }
  }
  return nomes;
}

async function runWorkflowsAoVivo(opts: {
  location: string; o: string; id?: string; contato?: string;
  limite?: string; nomes?: boolean; json?: boolean;
}): Promise<void> {
  const log = opts.json ? console.error : console.log;
  if (!WF_LEITURA.includes(opts.o)) {
    throw new Error(`-o inválido: ${opts.o}. Aceitos: ${WF_LEITURA.join(", ")}`);
  }
  if (opts.o === "dentro" && !opts.id) throw new Error("-o dentro exige --id do workflow");
  if (opts.o === "contato" && !opts.contato) throw new Error("-o contato exige --contato");

  // teto <= 0 faria o laço de busca não rodar nenhuma iteração e a resposta mentir
  // "nenhum contato" sem ter perguntado nada ao servidor — piso de 1.
  const teto = Math.max(1, numeroOpcional(opts.limite, "limite", log) ?? WF_TETO_PADRAO);

  await withClient(opts.location, log, async (client) => {
    let out: unknown;
    switch (opts.o) {
      case "lista": {
        const linhas = await listarWorkflows(client, opts.location);
        out = {
          quantos: linhas.length,
          workflows: linhas.map((w) => ({
            id: w.id, name: w.name, status: w.status, updatedAt: w.updatedAt,
          })),
          ...(linhas.length ? {} : { vazio_porque: "a subconta não tem nenhum workflow." }),
        };
        break;
      }
      case "dentro": {
        const wid = opts.id!;
        // `getWorkflowMeta` devolve o workflow na RAIZ da resposta, não sob `meta.workflow`
        // (achado ao vivo: `{_id, name, status, ...}` direto).
        const w = await getWorkflowMeta(client, opts.location, wid) as
          { _id?: string; id?: string; name?: string; status?: string };
        const { cruas, cortou, estrangulado } = await todosOsInscritos(client, opts.location, wid, teto);
        const nomes = opts.nomes
          ? await nomesDeContatos(client, opts.location, cruas.map((c) => String(c.contactId ?? "")))
          : {};
        out = resumoPorWorkflow({
          workflow: { id: String(w?._id ?? w?.id ?? wid), name: w?.name, status: w?.status },
          cruas, cortou, estrangulado, nomes,
        });
        break;
      }
      case "contato": {
        const cid = opts.contato!;
        const d = await inscricoesDoContato(client, opts.location, cid);
        const cruas = d.workflowStatuses ?? [];
        const nomesWorkflow: Record<string, string> = {};
        if (cruas.length) {
          for (const w of await listarWorkflows(client, opts.location)) {
            if (w.name) nomesWorkflow[w.id] = w.name;
          }
        }
        out = resumoPorContato({ contactId: cid, cruas, nomesWorkflow });
        break;
      }
    }
    emitir(opts.json, out);
  });
}

async function runWorkflowAcao(opts: {
  location: string; acao: string; id?: string; contato?: string; inscricao?: string;
  status?: string; usuario?: string; inicio?: string; confirmo?: boolean; json?: boolean;
}): Promise<void> {
  const log = opts.json ? console.error : console.log;
  if (!WF_ACOES.includes(opts.acao)) {
    throw new Error(`--acao inválida: ${opts.acao}. Aceitas: ${WF_ACOES.join(", ")}`);
  }
  if (!opts.confirmo) {
    throw new Error("Isto muda dado real da subconta e não tem desfazer. Repita com --confirmo.");
  }
  if (!opts.id) throw new Error(`${opts.acao} exige --id do workflow`);
  if (opts.acao === "publicar") {
    if (!opts.status) throw new Error("publicar exige --status: " + STATUS_WORKFLOW.join(" | "));
    if (!STATUS_WORKFLOW.includes(opts.status as StatusWorkflow)) {
      throw new Error(`--status inválido: ${opts.status}. Aceitos: ${STATUS_WORKFLOW.join(", ")}`);
    }
  } else if (opts.acao !== "retomar" && !opts.contato) {
    throw new Error(`${opts.acao} exige --contato`);
  } else if (opts.acao === "retomar" && !opts.contato && !opts.inscricao) {
    throw new Error("retomar exige --inscricao <id> ou --contato <id>");
  }

  await withClient(opts.location, log, async (client, _page, tokens) => {
    const userId = opts.usuario || decodeUserId(tokens.bearer, tokens.tokenId);
    if (!userId) {
      throw new Error(
        "não deu para descobrir o usuário logado a partir dos tokens, e toda escrita de " +
        "workflow é carimbada com o autor no histórico do GHL. Repita com --usuario <id>; " +
        "o id está no users.json do dump.",
      );
    }

    const wid = opts.id!;
    let aviso: string | undefined;
    let alvoInscricao = opts.inscricao;

    // despublicar: conta quem está dentro ANTES, porque depois a busca reflete o novo estado
    if (opts.acao === "publicar" && opts.status !== "published") {
      const contagem = await todosOsInscritos(client, opts.location, wid, WF_TETO_PADRAO).catch(() => null);
      aviso = contagem
        ? avisoDespublicar(contarNaoTerminados(contagem.cruas), contagem.cortou || contagem.estrangulado)
        : "não deu para contar quem está dentro porque a busca de inscritos falhou. Quem " +
          "estiver dentro não é removido: congela no passo em que está e volta a andar, " +
          "todos de uma vez, quando o workflow for republicado.";
      log(`aviso: ${aviso}`);
    }

    if (opts.acao === "retomar" && !alvoInscricao) {
      // A rota do lado do contato (`statuses_v2`) devolve só `{workflowId, status}`, sem
      // `_id` — nunca dá para resolver a inscrição por ela (achado ao vivo). Busca pelo
      // lado do workflow, que traz `_id` e `contactId`, e filtra pelos dois.
      const { cruas } = await todosOsInscritos(client, opts.location, wid, WF_TETO_PADRAO);
      const r = resolverInscricao(cruas, wid, opts.contato!);
      if ("erro" in r) throw new Error(r.erro);
      alvoInscricao = r.id;
    }

    const corpo = {
      acao: opts.acao,
      workflowId: wid,
      ...(opts.contato ? { contactId: opts.contato } : {}),
      ...(alvoInscricao ? { inscricaoId: alvoInscricao } : {}),
      ...(opts.status ? { status: opts.status } : {}),
      usuario: userId,
    };
    const antes = await getWorkflowMeta(client, opts.location, wid).catch(() => null);
    const registro = registroEscrita(opts.location, "_workflows", wid, {
      ...corpo, antes, aplicado: false,
    });
    log(`snapshot: ${registro}`);

    let r: unknown;
    try {
      switch (opts.acao) {
        case "publicar":
          r = await mudarStatus(client, opts.location, wid, opts.status as StatusWorkflow, userId);
          break;
        case "inscrever":
          r = await inscreverContato(client, opts.location, wid, opts.contato!, userId, opts.inicio);
          break;
        case "remover":
          r = await removerContato(client, opts.location, opts.contato!, wid, userId);
          break;
        case "retomar":
          r = await retomarInscricao(client, opts.location, alvoInscricao!, userId);
          break;
      }
    } catch (e) {
      fs.writeFileSync(registro, JSON.stringify({
        em: new Date().toISOString(), ...corpo, antes, aplicado: false, erro: String(e),
      }, null, 2));
      throw e;
    }
    fs.writeFileSync(registro, JSON.stringify({
      em: new Date().toISOString(), ...corpo, antes, aplicado: true, resposta: r,
    }, null, 2));

    if (opts.acao === "inscrever") {
      // `antes` já foi lido para o snapshot: dá para saber o status sem chamada nova.
      // Achado ao vivo: inscrever num workflow que não está `published` devolve 200
      // idêntico ao caso que funciona, e NENHUMA inscrição é criada — sucesso mudo.
      const statusAntes = (antes as { status?: string } | null)?.status;
      const naoPublicado = statusAntes && statusAntes !== "published"
        ? ` O workflow está com status "${statusAntes}": o servidor aceita a chamada, ` +
          "mas não cria inscrição nenhuma enquanto ele não estiver publicado."
        : "";
      aviso = "a entrada no workflow é enfileirada pelo servidor: ler o estado agora pode " +
        "não mostrar o contato ainda, sem que nada tenha falhado." + naoPublicado;
      log(`aviso: ${aviso}`);
    }

    const out = saidaWorkflowAcao({ acao: opts.acao, workflowId: wid, resposta: r, registro, aviso });
    if (opts.json) emitir(true, out);
    else log(`ok — ${opts.acao}; registro em ${registro}`);
  });
}

export function registrarWorkflows(program: Command): void {
  program
    .command("workflows-ao-vivo")
    .description("Leitura ao vivo de workflows, de quem está dentro deles e de onde um contato está")
    .requiredOption("-l, --location <id>", "locationId da subconta")
    .option("-o, --o <op>", "lista | dentro | contato", "lista")
    .option("-i, --id <id>", "id do workflow (com -o dentro)")
    .option("--contato <id>", "id do contato (com -o contato)")
    .option("--limite <n>", `teto de inscritos trazidos (padrão ${WF_TETO_PADRAO})`)
    .option("--nomes", "resolve o nome de cada contato: uma chamada por contato, é lento em lista grande")
    .option("--json", "imprime o resultado em JSON no stdout")
    .action((o) => runWorkflowsAoVivo(o).catch(falhar));

  program
    .command("workflow-acao")
    .description("ESCREVE: publica/despublica workflow, inscreve, remove ou retoma um contato")
    .requiredOption("-l, --location <id>", "locationId da subconta")
    .requiredOption("--acao <a>", WF_ACOES.join(" | "))
    .requiredOption("-i, --id <id>", "id do workflow")
    .option("--contato <id>", "id do contato (inscrever, remover, retomar)")
    .option("--inscricao <id>", "id da inscrição (retomar); sem ele, resolve pelo contato")
    .option("--status <s>", STATUS_WORKFLOW.join(" | ") + " (com --acao publicar)")
    .option("--usuario <id>", "autor da ação; sem ele, sai do token")
    .option("--inicio <iso>", "início programado da execução (inscrever), ISO com fuso")
    .option("--confirmo", "obrigatório: muda dado real e não tem desfazer")
    .option("--json", "imprime o resultado em JSON no stdout")
    .action((o) => runWorkflowAcao(o).catch(falhar));
}
