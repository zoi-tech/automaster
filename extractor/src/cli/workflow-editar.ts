import type { Command } from "commander";
import fs from "node:fs";
import { withClient, registroEscrita, todosOsInscritos, WF_TETO_PADRAO } from "../cli.js";
import { decodeUserId } from "../auth/token.js";
import type { GhlClient } from "../api/client.js";
import { getWorkflowMeta, contarNaoTerminados } from "../api/workflows-live.js";
import {
  criarWorkflow, duplicarWorkflow, renomearWorkflow, moverWorkflow, apagarWorkflow,
  salvarWorkflow, historicoVersoes, listarTriggers, apagarTrigger, WF_WRITE,
} from "../api/workflows-write.js";
import {
  trocarReferencia, trocarTag, removerStepsInalcancaveis, alterarAtributo,
  renomear, montarCorpo, checarPublicavel, diffWorkflow,
  type Documento,
} from "../api/workflow-edit.js";

export const WF_EDITAR_ACOES = [
  "criar", "renomear", "mover", "duplicar", "apagar",
  "trocar-ref", "trocar-tag", "limpar-orfaos", "atributo", "trigger", "historico",
] as const;

interface Opts {
  location: string; acao: string; id?: string; nome?: string; pasta?: string;
  de?: string; para?: string; step?: string; caminho?: string; valor?: string;
  triggerAcao?: string; triggerId?: string;
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

    if (o.acao === "trigger") {
      return await acaoTrigger(client, o, saida, log);
    }

    if (SEM_CORPO.has(o.acao)) {
      if (!o.confirmo) throw new Error(exigeConfirmo(o.acao));
      if (o.acao === "apagar") {
        const meta = (await getWorkflowMeta(client, o.location, o.id!)) as { status?: string };
        if (meta?.status === "published") await guardaPublicado(client, o, saida, log, "apagar");
      }
      const resposta = await escritaSemCorpo(client, o, usuarioId);
      // `criar` e `duplicar` arquivam sob o id NOVO: o registro de uma cópia sob o id
      // de origem some no meio do histórico do original (nit da prova ao vivo).
      const chave = String((resposta as { id?: string } | null)?.id ?? o.id ?? "novo");
      const registro = registroEscrita(o.location, "_workflows", chave, {
        acao: o.acao, opts: semSegredo(o), aplicado: true, origem: o.id, resposta,
      });
      Object.assign(saida, { aplicado: true, resposta, registro, id: chave });
      return imprimir(saida, o, log);
    }

    // ---- ações que mexem no corpo ----
    const doc = (await client.getJson(`${WF_WRITE}/${o.location}/${o.id}`)) as Documento;
    const versaoLida = doc.version;
    const { doc: editado, mudancas, avisos } = aplicarOperacao(doc, o);
    if (avisos?.length) { saida.avisos = avisos; avisos.forEach(log); }
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
        // lista AUTORITATIVA de triggers: o documento não a traz. Quem valida contra
        // as 18 regras precisa dela, senão conclui que o workflow não tem trigger.
        triggers: await listarTriggers(client, o.location, o.id!),
      });
      return imprimir(saida, o, log);
    }

    if (doc.status === "published") {
      await guardaPublicado(client, o, saida, log, "gravar");
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
    // A resposta do PUT traz só a meta — nada de `workflowData`. Conferir o resultado
    // exige reler, e é por isso que `depois` existe.
    const resposta = await salvarWorkflow(client, o.location, o.id!, corpo);
    const depois = (await client.getJson(`${WF_WRITE}/${o.location}/${o.id}`)) as Documento;
    fs.writeFileSync(registro, JSON.stringify(
      { em: new Date().toISOString(), acao: o.acao, aplicado: true, versao: versaoLida, antes: doc, depois, diff, mudancas, resposta },
      null, 2,
    ));
    Object.assign(saida, { aplicado: true, resposta, registro, versaoDepois: depois.version });
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
 * Mensagem da guarda de publicado. `aoMenos` vem de `cortou || estrangulado` de
 * `todosOsInscritos`: quando a paginação corta ou o servidor estrangula, `n` é um piso,
 * nunca o total — a mensagem tem que dizer "pelo menos N", nunca apresentar o número
 * cortado como se fosse total. O efeito é diferente em cada ação: gravar troca a versão
 * debaixo de quem está andando; apagar tira todo mundo do fluxo.
 */
function avisoPublicado(n: number, aoMenos: boolean, modo: "gravar" | "apagar"): string {
  const quantos = aoMenos ? `pelo menos ${n}` : `${n}`;
  const efeito = modo === "apagar"
    ? "Apagar tira todos eles do fluxo agora, no passo em que estiverem, e não há desfazer."
    : "Quem está no meio termina o passo atual na versão antiga e segue pela nova daí em diante.";
  return `workflow PUBLICADO com ${quantos} contato(s) dentro agora. ${efeito}`;
}

/**
 * Guarda de workflow publicado. Vale para `apagar` e para as ações que mexem no corpo
 * ou nos triggers — tudo que muda o que o contato vive. `renomear` e `mover` ficam de
 * fora de propósito: não alteram execução nenhuma (limite declarado, ver CHANGELOG).
 */
async function guardaPublicado(
  client: GhlClient, o: Opts, saida: Record<string, unknown>,
  log: (m: string) => void, modo: "gravar" | "apagar",
): Promise<void> {
  const { cruas, cortou, estrangulado } = await todosOsInscritos(client, o.location, o.id!, WF_TETO_PADRAO);
  const aviso = avisoPublicado(contarNaoTerminados(cruas), cortou || estrangulado, modo);
  saida.aviso = aviso;
  log(aviso);
  if (!o.publicado) {
    const verbo = modo === "apagar" ? "apagar" : "gravar";
    throw new Error(`${aviso} Para ${verbo} mesmo assim, repita com --publicado junto de --confirmo.`);
  }
}

/**
 * Trigger: só `remover`, e pelo DELETE dedicado. O documento do workflow NÃO traz a
 * lista (só `triggersFilePath`) e o `only-triggers` responde 200 sem criar nada — então
 * `adicionar` e `substituir` recusam em vez de devolver sucesso falso.
 */
async function acaoTrigger(
  client: GhlClient, o: Opts, saida: Record<string, unknown>, log: (m: string) => void,
): Promise<void> {
  const acao = o.triggerAcao ?? "";
  if (acao === "adicionar" || acao === "substituir") {
    throw new Error(
      `--trigger-acao ${acao} não existe: não há rota conhecida para criar nem para trocar trigger. ` +
      "O documento do workflow não traz a lista de triggers e o `only-triggers` responde 200 sem gravar " +
      "nada (provado ao vivo). Criar e trocar trigger ficaram para a parte B. Só `remover` funciona.",
    );
  }
  if (acao !== "remover") throw new Error("--trigger-acao deve ser remover (adicionar e substituir ficaram para a parte B)");
  if (!o.triggerId) throw new Error("--trigger-acao remover exige --trigger-id");

  const triggers = await listarTriggers(client, o.location, o.id!);
  const alvo = triggers.find((t) => t?.id === o.triggerId);
  if (!alvo) {
    throw new Error(
      `trigger ${o.triggerId} não existe neste workflow (${triggers.length} trigger(s) na lista: ` +
      `${triggers.map((t) => t?.id).join(", ") || "nenhum"})`,
    );
  }
  const vazio = { workflowData: { templates: [] } } as unknown as Documento;
  const diff = diffWorkflow(
    { ...vazio, triggersData: triggers },
    { ...vazio, triggersData: triggers.filter((t) => t?.id !== o.triggerId) },
  );
  Object.assign(saida, { diff, mudancas: [`trigger ${o.triggerId} removido`], triggers });

  if (!o.confirmo) {
    Object.assign(saida, { aplicado: false, motivo: "prévia: rode de novo com --confirmo para gravar" });
    return imprimir(saida, o, log);
  }

  const meta = (await getWorkflowMeta(client, o.location, o.id!)) as { status?: string };
  if (meta?.status === "published") await guardaPublicado(client, o, saida, log, "gravar");

  const resposta = await apagarTrigger(client, o.location, o.id!, o.triggerId);
  const depois = await listarTriggers(client, o.location, o.id!);
  const registro = registroEscrita(o.location, "_workflows", o.id!, {
    acao: "trigger", triggerAcao: "remover", aplicado: true, antes: triggers, depois, resposta,
  });
  Object.assign(saida, { aplicado: true, resposta, registro });
  imprimir(saida, o, log);
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
    .option("--trigger-acao <a>", "remover (só; criar e trocar não têm rota conhecida)")
    .option("--trigger-id <id>", "id do trigger a remover")
    .option("--usuario <id>", "autor da edição; sem ele, sai do token")
    .option("--confirmo", "obrigatório para gravar: muda dado real e não tem desfazer")
    .option("--publicado", "obrigatório junto de --confirmo quando o workflow está publicado")
    .option("--json", "imprime o resultado em JSON no stdout")
    .action((o) => runWorkflowEditar(o).catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    }));
}
