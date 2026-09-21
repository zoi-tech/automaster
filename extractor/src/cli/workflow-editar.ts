import type { Command } from "commander";
import fs from "node:fs";
import { withClient, registroEscrita, todosOsInscritos, WF_TETO_PADRAO } from "../cli.js";
import { decodeUserId } from "../auth/token.js";
import type { GhlClient } from "../api/client.js";
import { getWorkflowMeta, contarNaoTerminados } from "../api/workflows-live.js";
import {
  criarWorkflow, duplicarWorkflow, renomearWorkflow, moverWorkflow, apagarWorkflow,
  salvarWorkflow, salvarSomenteTriggers, historicoVersoes, WF_WRITE,
} from "../api/workflows-write.js";
import {
  trocarReferencia, trocarTag, removerStepsInalcancaveis, alterarAtributo,
  editarTriggers, renomear, montarCorpo, checarPublicavel, diffWorkflow,
  type Documento,
} from "../api/workflow-edit.js";

export const WF_EDITAR_ACOES = [
  "criar", "renomear", "mover", "duplicar", "apagar",
  "trocar-ref", "trocar-tag", "limpar-orfaos", "atributo", "trigger", "historico",
] as const;

interface Opts {
  location: string; acao: string; id?: string; nome?: string; pasta?: string;
  de?: string; para?: string; step?: string; caminho?: string; valor?: string;
  trigger?: string; triggerAcao?: string; triggerId?: string;
  usuario?: string; confirmo?: boolean; publicado?: boolean; json?: boolean;
}

/** As ações que não tocam no corpo do workflow e por isso pulam diff e validação. */
const SEM_CORPO = new Set(["criar", "renomear", "mover", "duplicar", "apagar", "historico"]);

export async function runWorkflowEditar(o: Opts): Promise<void> {
  if (!WF_EDITAR_ACOES.includes(o.acao as never)) {
    throw new Error(`--acao inválida: ${o.acao}. Use uma de: ${WF_EDITAR_ACOES.join(" | ")}`);
  }
  const log = (m: string) => (o.json ? console.error(m) : console.log(m));
  const precisaId = o.acao !== "criar";
  if (precisaId && !o.id) throw new Error(`--acao ${o.acao} exige -i/--id (id do workflow)`);

  await withClient(o.location, log, async (client, _page, tokens) => {
    const usuarioId = o.usuario ?? decodeUserId(tokens.bearer, tokens.tokenId);
    const saida: Record<string, unknown> = { aplicado: false, acao: o.acao, id: o.id };

    if (o.acao === "historico") {
      saida.historico = await historicoVersoes(client, o.location, o.id!);
      saida.aplicado = true;
      return imprimir(saida, o, log);
    }

    if (SEM_CORPO.has(o.acao)) {
      if (!o.confirmo) throw new Error(exigeConfirmo(o.acao));
      if (o.acao === "apagar") {
        const meta = (await getWorkflowMeta(client, o.location, o.id!)) as { status?: string };
        if (meta?.status === "published") {
          const { cruas, cortou, estrangulado } = await todosOsInscritos(client, o.location, o.id!, WF_TETO_PADRAO);
          const aviso = avisoPublicado(contarNaoTerminados(cruas), cortou || estrangulado);
          saida.aviso = aviso;
          log(aviso);
          if (!o.publicado) {
            throw new Error(`${aviso} Para apagar mesmo assim, repita com --publicado junto de --confirmo.`);
          }
        }
      }
      const registro = registroEscrita(o.location, "_workflows", o.id ?? "novo", { acao: o.acao, opts: semSegredo(o) });
      const resposta = await escritaSemCorpo(client, o, usuarioId);
      fs.writeFileSync(registro, JSON.stringify({ em: new Date().toISOString(), acao: o.acao, aplicado: true, resposta }, null, 2));
      Object.assign(saida, { aplicado: true, resposta, registro });
      return imprimir(saida, o, log);
    }

    // ---- ações que mexem no corpo ----
    const doc = (await client.getJson(`${WF_WRITE}/${o.location}/${o.id}`)) as Documento;
    const versaoLida = doc.version;
    const { doc: editado, mudancas } = aplicarOperacao(doc, o);
    if (!mudancas.length) {
      Object.assign(saida, { aplicado: false, motivo: "nada a mudar: a operação não encontrou alvo neste workflow" });
      return imprimir(saida, o, log);
    }

    const problemas = checarPublicavel(editado);
    if (problemas.length) {
      throw new Error(
        "a edição deixaria o workflow num estado que o app recusa salvar, e o cliente ficaria travado no editor:\n  - " +
        problemas.join("\n  - "),
      );
    }

    const diff = diffWorkflow(doc, editado);
    saida.diff = diff;
    saida.mudancas = mudancas;

    if (!o.confirmo) {
      Object.assign(saida, {
        aplicado: false,
        motivo: "prévia: rode de novo com --confirmo para gravar",
        documento: editado,
      });
      return imprimir(saida, o, log);
    }

    if (doc.status === "published") {
      const { cruas, cortou, estrangulado } = await todosOsInscritos(client, o.location, o.id!, WF_TETO_PADRAO);
      const aviso = avisoPublicado(contarNaoTerminados(cruas), cortou || estrangulado);
      saida.aviso = aviso;
      log(aviso);
      if (!o.publicado) {
        throw new Error(`${aviso} Para gravar mesmo assim, repita com --publicado junto de --confirmo.`);
      }
    }

    const metaAgora = (await getWorkflowMeta(client, o.location, o.id!)) as { version?: number };
    if (metaAgora?.version !== versaoLida) {
      throw new Error(
        `o workflow mudou enquanto você revisava (versão ${versaoLida} → ${metaAgora?.version}). ` +
        "Alguém salvou pelo app. Nada foi gravado: rode de novo para ver o estado atual.",
      );
    }

    const registro = registroEscrita(o.location, "_workflows", o.id!, {
      acao: o.acao, versao: versaoLida, antes: doc, diff, mudancas,
    });
    const corpo = montarCorpo(doc, editado, usuarioId);
    const soTriggers = o.acao === "trigger";
    const resposta = soTriggers
      ? await salvarSomenteTriggers(client, o.location, o.id!, corpo)
      : await salvarWorkflow(client, o.location, o.id!, corpo);
    const depois = await client.getJson(`${WF_WRITE}/${o.location}/${o.id}`);
    fs.writeFileSync(registro, JSON.stringify(
      { em: new Date().toISOString(), acao: o.acao, aplicado: true, versao: versaoLida, antes: doc, depois, diff, mudancas, resposta },
      null, 2,
    ));
    Object.assign(saida, { aplicado: true, resposta, registro });
    imprimir(saida, o, log);
  });
}

function aplicarOperacao(doc: Documento, o: Opts) {
  switch (o.acao) {
    case "trocar-ref":
      if (!o.de || !o.para) throw new Error("--acao trocar-ref exige --de e --para (ids)");
      return trocarReferencia(doc, o.de, o.para);
    case "trocar-tag":
      if (!o.de || !o.para) throw new Error("--acao trocar-tag exige --de e --para (nomes de tag)");
      return trocarTag(doc, o.de, o.para);
    case "limpar-orfaos":
      return removerStepsInalcancaveis(doc);
    case "atributo":
      if (!o.step || !o.caminho || o.valor === undefined) {
        throw new Error("--acao atributo exige --step, --caminho e --valor");
      }
      return alterarAtributo(doc, o.step, o.caminho, parseValor(o.valor));
    case "trigger": {
      const acao = o.triggerAcao ?? "";
      if (acao === "remover") {
        if (!o.triggerId) throw new Error("--trigger-acao remover exige --trigger-id");
        return editarTriggers(doc, { acao: "remover", id: o.triggerId });
      }
      if (!o.trigger) throw new Error(`--trigger-acao ${acao || "(vazio)"} exige --trigger com o JSON do trigger`);
      const trigger = JSON.parse(o.trigger) as Record<string, unknown>;
      if (acao === "adicionar") return editarTriggers(doc, { acao: "adicionar", trigger });
      if (acao === "substituir") {
        if (!o.triggerId) throw new Error("--trigger-acao substituir exige --trigger-id");
        return editarTriggers(doc, { acao: "substituir", id: o.triggerId, trigger });
      }
      throw new Error("--trigger-acao deve ser adicionar | remover | substituir");
    }
    default:
      throw new Error(`ação sem corpo tratada no caminho errado: ${o.acao}`);
  }
}

/** `--valor` chega como texto; JSON válido vira valor JSON, o resto fica texto. */
function parseValor(v: string): unknown {
  try { return JSON.parse(v); } catch { return v; }
}

async function escritaSemCorpo(client: GhlClient, o: Opts, usuarioId: string) {
  switch (o.acao) {
    case "criar":
      if (!o.nome) throw new Error("--acao criar exige --nome");
      return criarWorkflow(client, o.location, { name: o.nome, parentId: o.pasta ?? null });
    case "renomear":
      if (!o.nome) throw new Error("--acao renomear exige --nome");
      return renomearWorkflow(client, o.location, o.id!, renomear({ workflowData: { templates: [] } } as Documento, o.nome).doc.name!);
    case "mover":
      return moverWorkflow(client, o.location, o.id!, o.pasta ?? null);
    case "duplicar":
      if (!o.nome) throw new Error("--acao duplicar exige --nome (nome da cópia)");
      return duplicarWorkflow(client, o.location, { workflowId: o.id!, novoNome: o.nome, parentId: o.pasta });
    case "apagar":
      return apagarWorkflow(client, o.location, o.id!, usuarioId);
    default:
      throw new Error(`ação sem corpo desconhecida: ${o.acao}`);
  }
}

/**
 * Mensagem da guarda de publicado, usada tanto para editar o corpo quanto para apagar.
 * `aoMenos` vem de `cortou || estrangulado` de `todosOsInscritos`: quando a paginação
 * corta ou o servidor estrangula, `n` é um piso, nunca o total — a mensagem tem que
 * dizer "pelo menos N", nunca apresentar o número cortado como se fosse total.
 */
function avisoPublicado(n: number, aoMenos: boolean): string {
  const quantos = aoMenos ? `pelo menos ${n}` : `${n}`;
  return `workflow PUBLICADO com ${quantos} contato(s) dentro agora. Quem está no meio termina o passo ` +
    `atual na versão antiga e segue pela nova daí em diante.`;
}

const exigeConfirmo = (acao: string) =>
  `--acao ${acao} muda dado real na subconta e não tem desfazer. Repita com --confirmo.`;

const semSegredo = (o: Opts) => ({ ...o, json: undefined, confirmo: undefined });

function imprimir(saida: Record<string, unknown>, o: Opts, log: (m: string) => void): void {
  if (o.json) console.log(JSON.stringify(saida));
  else log(`${saida.aplicado ? "ok" : "sem gravar"} — ${o.acao}${saida.registro ? `; registro em ${saida.registro}` : ""}`);
}

export function registrarWorkflowEditar(program: Command): void {
  program
    .command("workflow-editar")
    .description("ESCREVE: cria, renomeia, move, duplica, apaga workflow e edita corpo/triggers")
    .requiredOption("-l, --location <id>", "locationId da subconta")
    .requiredOption("--acao <a>", WF_EDITAR_ACOES.join(" | "))
    .option("-i, --id <id>", "id do workflow (tudo menos criar)")
    .option("--nome <n>", "nome (criar, renomear, duplicar)")
    .option("--pasta <id>", "id da pasta (criar, mover, duplicar); vazio = raiz")
    .option("--de <v>", "id ou nome de tag a substituir (trocar-ref, trocar-tag)")
    .option("--para <v>", "id ou nome de tag novo (trocar-ref, trocar-tag)")
    .option("--step <id>", "id do step (atributo)")
    .option("--caminho <c>", "campo dentro de attributes, aninhado com ponto (atributo)")
    .option("--valor <v>", "valor novo; JSON válido vira JSON, o resto é texto (atributo)")
    .option("--trigger <json>", "JSON do trigger (trigger: adicionar, substituir)")
    .option("--trigger-acao <a>", "adicionar | remover | substituir")
    .option("--trigger-id <id>", "id do trigger (trigger: remover, substituir)")
    .option("--usuario <id>", "autor da edição; sem ele, sai do token")
    .option("--confirmo", "obrigatório para gravar: muda dado real e não tem desfazer")
    .option("--publicado", "obrigatório junto de --confirmo quando o workflow está publicado")
    .option("--json", "imprime o resultado em JSON no stdout")
    .action((o) => runWorkflowEditar(o).catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    }));
}
