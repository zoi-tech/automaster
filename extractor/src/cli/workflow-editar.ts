import type { Command } from "commander";
import { emitir, falhar } from "../saida.js";
import fs from "node:fs";
import { withClient, registroEscrita } from "./shared.js";
import { decodeUserId } from "../auth/token.js";
import type { GhlClient } from "../api/client.js";
import { getWorkflowMeta, guardaPublicado } from "../api/workflows-live.js";
import {
  criarWorkflow, duplicarWorkflow, renomearWorkflow, moverWorkflow, apagarWorkflow,
  salvarWorkflow, historicoVersoes, listarTriggers, apagarTrigger, WF_WRITE, criarTrigger,
  nascerVisivel, urlEditor, listarPastas, lerDocumento, listarTriggersPrevia
} from "../api/workflows-write.js";
import {
  trocarReferencia, trocarTag, removerStepsInalcancaveis, alterarAtributo, renomear, montarCorpo,
  checarPublicavel, diffWorkflow, conferirEscrita, conferirVersaoEsperada,
  conferirTriggersEsperados, conferirCamadaCrua, criarStep, removerStep, moverStep,
  configurarWorkflow, CONFIG_CAMPOS,
  type Documento
} from "../api/workflow-edit.js";

export const WF_EDITAR_ACOES = [
  "criar", "renomear", "mover", "duplicar", "apagar",
  "trocar-ref", "trocar-tag", "limpar-orfaos", "atributo", "trigger", "historico", "configuracao",
  "step-criar", "step-remover", "step-mover",
] as const;

export interface Opts {
  location: string; acao: string; id?: string; nome?: string; pasta?: string;
  de?: string; para?: string; step?: string; caminho?: string; valor?: string; campo?: string;
  corpo?: string; depoisDe?: string; ramos?: string; comSubarvore?: boolean;
  triggerAcao?: string; triggerId?: string; triggerCorpo?: string; versaoEsperada?: string;
  triggersEsperados?: string;
  usuario?: string; confirmo?: boolean; publicado?: boolean; semRegras?: boolean; json?: boolean;
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

  conferirCamadaCrua(o);

  await withClient(o.location, log, async (client, _page, tokens) => {
    const usuarioId = o.usuario ?? decodeUserId(tokens.bearer, tokens.tokenId);
    const saida: Record<string, unknown> = {
      aplicado: false, acao: o.acao, id: o.id,
      ...(o.id ? { url: urlEditor(o.location, o.id) } : {}),
    };

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
      // `apagar` é a ÚNICA escrita irreversível daqui (não há rota provada de recover) e
      // por isso é a única que guarda cópia do que apagou. O documento inteiro vem antes
      // do DELETE, e o registro vai para o disco ANTES da escrita: processo morto no meio
      // deixaria produção alterada sem rastro nenhum, justo na ação destrutiva.
      let registroPre: string | null = null;
      let antes: Documento | undefined;
      if (o.acao === "apagar") {
        antes = (await client.getJson(`${WF_WRITE}/${o.location}/${o.id}`)) as Documento;
        if (antes?.status === "published") await guardaPublicado(client, o, saida, log, "apagar");
        registroPre = registroEscrita(o.location, "_workflows", o.id!, {
          acao: o.acao, opts: semSegredo(o), aplicado: false, antes,
          triggers: await listarTriggers(client, o.location, o.id!),
        });
      }
      const resposta = await escritaSemCorpo(client, o, usuarioId);
      // `criar` e `duplicar` arquivam sob o id NOVO: o registro de uma cópia sob o id
      // de origem some no meio do histórico do original (nit da prova ao vivo).
      const chave = String((resposta as { id?: string } | null)?.id ?? o.id ?? "novo");
      let registro: string;
      if (registroPre) {
        const gravado = JSON.parse(fs.readFileSync(registroPre, "utf8"));
        fs.writeFileSync(registroPre, JSON.stringify({ ...gravado, aplicado: true, resposta }, null, 2));
        registro = registroPre;
      } else {
        registro = registroEscrita(o.location, "_workflows", chave, {
          acao: o.acao, opts: semSegredo(o), aplicado: true, origem: o.id, resposta,
        });
      }
      // Workflow recém-criado nasce sem `status` e fora de pasta: a API o lista e a
      // interface não o mostra, com o editor em branco. Consertar aqui é o que impede
      // entregar um workflow que só existe para a API.
      if ((o.acao === "criar" || o.acao === "duplicar") && chave !== "novo") {
        saida.visivel = await nascerVisivel(client, o.location, chave, o.pasta!, usuarioId);
      }
      Object.assign(saida, { aplicado: true, resposta, registro, id: chave, url: urlEditor(o.location, chave) });
      return imprimir(saida, o, log);
    }

    // ---- ações que mexem no corpo ----
    const doc = (await client.getJson(`${WF_WRITE}/${o.location}/${o.id}`)) as Documento;
    const versaoLida = doc.version;
    conferirVersaoEsperada(o, versaoLida);
    saida.versao = versaoLida;
    const { doc: editado, mudancas, avisos } = aplicarOperacao(doc, o);
    if (avisos?.length) { saida.avisos = avisos; avisos.forEach(log); }
    if (!mudancas.length) {
      Object.assign(saida, { aplicado: false, motivo: "nada a mudar: a operação não encontrou alvo neste workflow" });
      return imprimir(saida, o, log);
    }

    const problemas = checarPublicavel(editado).map((p) =>
      o.acao === "configuracao" && p === "o workflow ficaria sem nenhuma ação, e o app recusa salvar workflow vazio"
        ? "o workflow ainda não tem nenhum step, e o app recusa salvar workflow vazio: crie o primeiro step (--acao step-criar) e configure depois"
        : p,
    );
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
    // 200 não é prova e bump de `version` não é prova: a rota irmã `only-triggers` faz os
    // dois e não grava nada. Quem decide é a comparação entre o que se pediu e o que ficou.
    const { ok, residual } = conferirEscrita(editado, depois);
    const aplicado = ok ? true : "duvidoso";
    fs.writeFileSync(registro, JSON.stringify(
      { em: new Date().toISOString(), acao: o.acao, aplicado, versao: versaoLida, antes: doc, depois, diff, mudancas, resposta, residual: ok ? undefined : residual },
      null, 2,
    ));
    Object.assign(saida, { aplicado, resposta, registro, versaoDepois: depois.version });
    if (!ok) {
      saida.residual = residual;
      saida.motivo = "o servidor respondeu 200 mas a releitura NÃO bate com o que foi pedido: " +
        "confira o workflow antes de considerar a edição feita (diff residual em `residual`).";
      log(saida.motivo as string);
    }
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
    case "step-criar": {
      if (!o.corpo) throw new Error("--acao step-criar exige --corpo (JSON do step)");
      const ramos = o.ramos ? parseCorpo(o.ramos, "--ramos") : undefined;
      if (ramos && !Array.isArray(ramos)) throw new Error("--ramos precisa ser uma lista JSON de ramos");
      return criarStep(doc, parseCorpo(o.corpo), o.depoisDe, ramos as any);
    }
    case "step-remover":
      if (!o.step) throw new Error("--acao step-remover exige --step (id do step que sai)");
      return removerStep(doc, o.step, o.comSubarvore);
    case "step-mover":
      if (!o.step || !o.depoisDe) throw new Error("--acao step-mover exige --step e --depois-de");
      return moverStep(doc, o.step, o.depoisDe);
    case "configuracao":
      if (!o.campo || o.valor === undefined) throw new Error("--acao configuracao exige --campo e --valor");
      return configurarWorkflow(doc, o.campo, parseValor(o.valor));
    default:
      throw new Error(`ação sem corpo tratada no caminho errado: ${o.acao}`);
  }
}

/**
 * `--corpo` é o step inteiro: diferente de `--valor`, texto que não é JSON aqui é erro, não
 * um valor de texto. Um step mal-formado só apareceria como caixa que o editor não abre.
 */
function parseCorpo(v: string, flag = "--corpo"): Record<string, unknown> {
  try {
    return JSON.parse(v);
  } catch (e) {
    throw new Error(`${flag} não é JSON válido (${e instanceof Error ? e.message : e})`, { cause: e });
  }
}

/** `--valor` chega como texto; JSON válido vira valor JSON, o resto fica texto. */
function parseValor(v: string): unknown {
  try { return JSON.parse(v); } catch { return v; }
}

/**
 * Workflow fora de pasta não aparece na interface: a lista da raiz mostra PASTA, não
 * workflow. Por isso `criar` e `duplicar` exigem `--pasta`, e o erro traz as que existem.
 */
async function exigePasta(client: GhlClient, o: Opts): Promise<void> {
  if (o.pasta) return;
  const pastas = await listarPastas(client, o.location).catch(() => []);
  throw new Error(
    `--acao ${o.acao} exige --pasta: workflow fora de pasta some da lista do app e o editor abre em branco.\n` +
    (pastas.length
      ? "Pastas desta subconta:\n  - " + pastas.map((p) => `${p.id}  ${p.name}`).join("\n  - ")
      : "Não consegui listar as pastas desta subconta."),
  );
}

async function escritaSemCorpo(client: GhlClient, o: Opts, usuarioId: string) {
  switch (o.acao) {
    case "criar":
      if (!o.nome) throw new Error("--acao criar exige --nome");
      await exigePasta(client, o);
      return criarWorkflow(client, o.location, { name: o.nome, parentId: o.pasta });
    case "renomear":
      if (!o.nome) throw new Error("--acao renomear exige --nome");
      return renomearWorkflow(client, o.location, o.id!, renomear({ workflowData: { templates: [] } } as Documento, o.nome).doc.name!);
    case "mover":
      return moverWorkflow(client, o.location, o.id!, o.pasta ?? null);
    case "duplicar":
      if (!o.nome) throw new Error("--acao duplicar exige --nome (nome da cópia)");
      await exigePasta(client, o);
      return duplicarWorkflow(client, o.location, { workflowId: o.id!, novoNome: o.nome, parentId: o.pasta });
    case "apagar":
      return apagarWorkflow(client, o.location, o.id!, usuarioId);
    default:
      throw new Error(`ação sem corpo desconhecida: ${o.acao}`);
  }
}

/**
 * Trigger: `adicionar` pelo POST dedicado, `remover` pelo DELETE dedicado, `substituir` =
 * os dois em sequência. O documento do workflow NÃO traz a lista (só `triggersFilePath`) e
 * o `only-triggers` responde 200 sem gravar nada — nenhum dos dois serve aqui.
 */
async function acaoTrigger(
  client: GhlClient, o: Opts, saida: Record<string, unknown>, log: (m: string) => void,
): Promise<void> {
  const acao = o.triggerAcao ?? "";
  if (!TRIGGER_ACOES.includes(acao as never)) {
    throw new Error(`--trigger-acao deve ser um de: ${TRIGGER_ACOES.join(" | ")}`);
  }
  if (acao === "adicionar" || acao === "substituir") {
    return await adicionarTrigger(client, o, saida, log, acao === "substituir");
  }
  if (!o.triggerId) throw new Error("--trigger-acao remover exige --trigger-id");

  const triggers = await listarTriggers(client, o.location, o.id!);
  const alvo = triggers.find((t) => t?.id === o.triggerId);
  if (!alvo) {
    throw new Error(
      `trigger ${o.triggerId} não existe neste workflow (${triggers.length} trigger(s) na lista: ` +
      `${triggers.map((t) => t?.id).join(", ") || "nenhum"})`,
    );
  }
  const restantes = triggers.filter((t) => t?.id !== o.triggerId);
  const vazio = { workflowData: { templates: [] } } as unknown as Documento;
  const diff = diffWorkflow({ ...vazio, triggersData: triggers }, { ...vazio, triggersData: restantes });
  // `triggers` na saída é sempre a lista do DEPOIS, igual a `documento`: é ela que quem
  // valida contra as 18 regras precisa. A lista de antes está no `diff`.
  // `triggersAntes` é o que a porta com guarda carrega para a gravação
  // (`--triggers-esperados`): sem version que se mexa, é esta lista que fecha a janela.
  Object.assign(saida, {
    diff, mudancas: [`trigger ${o.triggerId} removido`], triggers: restantes,
    triggersAntes: triggers.map((t) => t?.id).filter(Boolean),
  });

  if (!o.confirmo) {
    // O corpo não muda aqui, mas a prévia devolve o `documento` do mesmo jeito: sem ele
    // quem chama não tem o que validar, e remover trigger é justo o caso que dispara
    // `workflow_unreachable` — a validação não pode sumir aqui.
    const documento = (await lerDocumento(client, o.location, o.id!)) as Documento;
    Object.assign(saida, {
      aplicado: false, motivo: "prévia: rode de novo com --confirmo para gravar", documento,
      versao: documento.version,
    });
    return imprimir(saida, o, log);
  }

  const meta = (await getWorkflowMeta(client, o.location, o.id!)) as { status?: string; version?: number };
  // Limite provado ao vivo (segunda prova): apagar trigger NÃO incrementa o `version` do
  // workflow. A guarda aqui pega save de corpo alheio entre a prévia e a gravação, mas NÃO
  // pega outra remoção de trigger — para essa, quem vale é a lista relida logo abaixo.
  conferirVersaoEsperada(o, meta?.version);
  conferirTriggersEsperados(o, triggers);
  if (meta?.status === "published") await guardaPublicado(client, o, saida, log, "gravar");

  // Registro ANTES da escrita, como no caminho de corpo: remover trigger é destrutivo e
  // morte de processo entre o DELETE e o registro deixaria produção mexida sem rastro.
  const registro = registroEscrita(o.location, "_workflows", o.id!, {
    acao: "trigger", triggerAcao: "remover", aplicado: false, antes: triggers,
  });
  const resposta = await apagarTrigger(client, o.location, o.id!, o.triggerId);
  const depois = await listarTriggers(client, o.location, o.id!);
  // 200 aqui vale ainda menos que em outras rotas: o `only-triggers` irmão responde 200,
  // bumpa `version` e não grava nada. A prova é o id ter sumido da lista autoritativa.
  if (depois.some((t) => t?.id === o.triggerId)) {
    fs.writeFileSync(registro, JSON.stringify(
      { em: new Date().toISOString(), acao: "trigger", triggerAcao: "remover", aplicado: false, antes: triggers, depois, resposta }, null, 2,
    ));
    throw new Error(
      `o servidor respondeu sucesso mas o trigger ${o.triggerId} CONTINUA na lista do workflow. ` +
      `Nada mudou: a remoção não foi aplicada (registro em ${registro}).`,
    );
  }
  fs.writeFileSync(registro, JSON.stringify(
    { em: new Date().toISOString(), acao: "trigger", triggerAcao: "remover", aplicado: true, antes: triggers, depois, resposta }, null, 2,
  ));
  // `triggers` na saída passa a ser a lista REAL relida, não a prevista.
  Object.assign(saida, { aplicado: true, resposta, registro, triggers: depois });
  imprimir(saida, o, log);
}

export const TRIGGER_ACOES = ["adicionar", "remover", "substituir"] as const;


/**
 * Cria o trigger pelo `POST .../trigger`. A guarda que importa está em `criarTrigger`: o
 * `workflowId` vai em CAMELCASE, senão o servidor responde 200 com id e o trigger nasce
 * órfão — o falso positivo de escrita que fez esta rota passar anos por inexistente. Por
 * isso aqui 200 não encerra nada: a prova é o id aparecer na lista autoritativa relida.
 */
async function adicionarTrigger(
  client: GhlClient, o: Opts, saida: Record<string, unknown>, log: (m: string) => void, substituir: boolean,
): Promise<void> {
  if (!o.triggerCorpo) throw new Error(`--trigger-acao ${o.triggerAcao} exige --trigger-corpo (JSON do trigger)`);
  if (substituir && !o.triggerId) throw new Error("--trigger-acao substituir exige --trigger-id (o trigger que sai)");
  let corpo: Record<string, unknown>;
  try { corpo = JSON.parse(o.triggerCorpo); } catch (e) { throw new Error(`--trigger-corpo não é JSON válido: ${e}`, { cause: e }); }
  if (!corpo?.type) throw new Error("--trigger-corpo precisa de `type` (ex.: appointment, contact_tag, form_submission)");

  const { triggers: antes, aviso } = await listarTriggersPrevia(
    client, o.location, o.id!, !substituir && !o.confirmo,
  );
  if (aviso) saida.aviso = aviso;
  if (substituir && antes && !antes.some((t) => t?.id === o.triggerId)) {
    throw new Error(`trigger ${o.triggerId} não existe neste workflow (ids: ${antes.map((t) => t?.id).join(", ") || "nenhum"})`);
  }
  Object.assign(saida, {
    mudancas: [substituir ? `trigger ${o.triggerId} trocado` : "trigger adicionado"],
  });
  if (antes) {
    saida.triggersAntes = antes.map((t) => t?.id).filter(Boolean);
    const previsto = [...(substituir ? antes.filter((t) => t?.id !== o.triggerId) : antes), { ...corpo, id: "(novo)" }];
    const vazio = { workflowData: { templates: [] } } as unknown as Documento;
    Object.assign(saida, {
      diff: diffWorkflow({ ...vazio, triggersData: antes }, { ...vazio, triggersData: previsto }),
      triggers: previsto,
    });
  }

  if (!o.confirmo) {
    const documento = (await lerDocumento(client, o.location, o.id!)) as Documento;
    Object.assign(saida, {
      aplicado: false, motivo: "prévia: rode de novo com --confirmo para gravar",
      documento, versao: documento.version,
    });
    return imprimir(saida, o, log);
  }

  const meta = (await getWorkflowMeta(client, o.location, o.id!)) as { status?: string; version?: number };
  conferirVersaoEsperada(o, meta?.version);
  if (antes) conferirTriggersEsperados(o, antes);
  if (meta?.status === "published") await guardaPublicado(client, o, saida, log, "gravar");

  const registro = registroEscrita(o.location, "_workflows", o.id!, {
    acao: "trigger", triggerAcao: o.triggerAcao, aplicado: false, antes,
  });
  const resposta = await criarTrigger(client, o.location, o.id!, corpo);
  let depois = await listarTriggers(client, o.location, o.id!);
  const criado = depois.find((t) => t?.id === resposta?.id);
  const fechar = (aplicado: boolean | string) => fs.writeFileSync(registro, JSON.stringify(
    { em: new Date().toISOString(), acao: "trigger", triggerAcao: o.triggerAcao, aplicado, antes, depois, resposta }, null, 2,
  ));
  if (!criado) {
    fechar(false);
    throw new Error(
      `o servidor respondeu sucesso (id ${resposta?.id}) mas o trigger NÃO aparece na lista do workflow: ` +
      `ele nasceu órfão e não dispara nada. Nada foi trocado (registro em ${registro}).`,
    );
  }
  if (substituir) {
    await apagarTrigger(client, o.location, o.id!, o.triggerId!);
    depois = await listarTriggers(client, o.location, o.id!);
    if (depois.some((t) => t?.id === o.triggerId)) {
      fechar("duvidoso");
      throw new Error(
        `o trigger novo ${resposta?.id} foi criado, mas o antigo ${o.triggerId} CONTINUA na lista: ` +
        `o workflow tem os dois disparando agora (registro em ${registro}).`,
      );
    }
  }
  fechar(true);
  Object.assign(saida, { aplicado: true, resposta, registro, triggers: depois, triggerId: resposta?.id });
  imprimir(saida, o, log);
}

const exigeConfirmo = (acao: string) =>
  `--acao ${acao} muda dado real na subconta e não tem desfazer. Repita com --confirmo.`;

const semSegredo = (o: Opts) => ({ ...o, json: undefined, confirmo: undefined });

function imprimir(saida: Record<string, unknown>, o: Opts, log: (m: string) => void): void {
  if (o.json) emitir(true, saida);
  else {
    let status: string;
    if (saida.aplicado === true) {
      status = "ok";
    } else if (saida.aplicado === "duvidoso") {
      status = "duvidoso (releitura não confirmou)";
    } else {
      status = "sem gravar";
    }
    log(`${status} — ${o.acao}${saida.registro ? `; registro em ${saida.registro}` : ""}`);
  }
}

export function registrarWorkflowEditar(program: Command): void {
  program
    .command("workflow-editar")
    .description("ESCREVE: cria, renomeia, move, duplica, apaga workflow e edita corpo/triggers")
    .requiredOption("-l, --location <id>", "locationId da subconta")
    .requiredOption("--acao <a>", WF_EDITAR_ACOES.join(" | "))
    .option("-i, --id <id>", "id do workflow (tudo menos criar)")
    .option("--nome <n>", "nome (criar, renomear, duplicar)")
    .option("--pasta <id>", "id da pasta; obrigatório em criar e duplicar (fora de pasta o app não mostra)")
    .option("--de <v>", "id ou nome de tag a substituir (trocar-ref, trocar-tag)")
    .option("--para <v>", "id ou nome de tag novo (trocar-ref, trocar-tag)")
    .option("--step <id>", "id do step (atributo)")
    .option("--caminho <c>", "campo dentro de attributes, aninhado com ponto (atributo)")
    .option("--campo <c>", "configuração geral do workflow (configuracao): " + CONFIG_CAMPOS.join(" | "))
    .option("--valor <v>", "valor novo; JSON válido vira JSON, o resto é texto (atributo, configuracao)")
    .option("--corpo <json>", "JSON do step que entra (step-criar)")
    .option("--depois-de <id>", "id do step que fica logo ANTES; sem ele, step-criar põe o step no início do fluxo")
    .option("--ramos <json>", "lista JSON de ramos: o step nasce container de N saídas (step-criar)")
    .option("--com-subarvore", "step-remover: container sai levando ramos e tudo que pende deles")
    .option("--trigger-acao <a>", TRIGGER_ACOES.join(" | "))
    .option("--trigger-id <id>", "id do trigger que sai (remover, substituir)")
    .option("--trigger-corpo <json>", "JSON do trigger que entra (adicionar, substituir)")
    .option("--versao-esperada <n>", "version que a prévia viu; aborta se o workflow mudou desde então")
    .option("--triggers-esperados <ids>", "ids de trigger que a prévia viu, separados por vírgula; apagar trigger não mexe no version, então é esta lista que guarda a janela entre prévia e gravação")
    .option("--sem-regras", "assume gravar por fora da validação das 18 regras (camada crua)")
    .option("--usuario <id>", "autor da edição; sem ele, sai do token")
    .option("--confirmo", "obrigatório para gravar: muda dado real e não tem desfazer")
    .option("--publicado", "obrigatório junto de --confirmo quando o workflow está publicado")
    .option("--json", "imprime o resultado em JSON no stdout")
    .action((o) => runWorkflowEditar(o).catch(falhar));
}
