import { Command } from "commander";
import {
  isConfigured as waIsConfigured, fetchPhoneNumbers as waPhoneNumbers,
  fetchTemplates as waTemplates, fetchApprovedTemplateOptions as waApproved,
  fetchFlows as waFlows, sendTemplate as waSendTemplate, sendFlow as waSendFlow
} from "../api/whatsapp.js";
import {
  fetchAiSettings, updateAiSettings, fetchSlaSettings, fetchSlaInboxStatus,
  fetchSlaClearPermission, updateSlaSettings, clearSla
} from "../api/settings.js";
import {
  createGroup, sendGroupMessage, checkInternalChat, updateInternalChatParticipants
} from "../api/group.js";
import fs from "node:fs";
import { withClient, registroEscrita } from "./shared.js";

async function runWhatsapp(opts: {
  location: string; o: string; template?: string; json?: boolean;
}): Promise<void> {
  const log = opts.json ? console.error : console.log;
  await withClient(opts.location, log, async (client) => {
    let out: unknown;
    switch (opts.o) {
      case "configurado": out = await waIsConfigured(client, opts.location); break;
      case "numeros": out = await waPhoneNumbers(client, opts.location); break;
      case "templates": out = await waTemplates(client, opts.location, opts.template); break;
      case "aprovados": out = await waApproved(client, opts.location); break;
      case "flows": out = await waFlows(client, opts.location); break;
      default: throw new Error(`-o inválido: ${opts.o}. Aceitos: configurado, numeros, templates, aprovados, flows`);
    }
    if (opts.json) console.log(JSON.stringify(out));
    else console.log(JSON.stringify(out, null, 2));
  });
}

async function runWhatsappEnviar(opts: {
  location: string; id: string; template?: string; flow?: string; corpo?: string; cta?: string;
  cabecalho?: string; rodape?: string; de?: string; para?: string; conversa?: string;
  quando?: string; confirmo?: boolean; json?: boolean;
}): Promise<void> {
  const log = opts.json ? console.error : console.log;
  if (!opts.confirmo) throw new Error("WhatsApp sai para uma pessoa de verdade e não tem desfazer. Repita com --confirmo.");
  if (!opts.template && !opts.flow) throw new Error("use --template <id> ou --flow <id>");
  if (opts.template && opts.flow) throw new Error("--template e --flow são exclusivos");
  const quando = opts.quando ? Math.floor(new Date(opts.quando).getTime() / 1000) : undefined;
  if (opts.quando && Number.isNaN(quando)) throw new Error(`--quando inválido: ${opts.quando}`);

  await withClient(opts.location, log, async (client) => {
    const comum = {
      contactId: opts.id,
      ...(opts.conversa ? { conversationId: opts.conversa } : {}),
      ...(opts.de ? { fromNumberId: opts.de } : {}),
      ...(opts.para ? { toNumber: opts.para } : {}),
      ...(quando ? { scheduledTimestamp: quando } : {}),
    };
    let r: { conversationId?: string; messageId?: string };
    let registro: string;
    if (opts.template) {
      const achados = await waTemplates(client, opts.location, opts.template);
      const t = achados[0];
      if (!t) throw new Error(`template ${opts.template} não encontrado na subconta`);
      registro = registroEscrita(opts.location, "_mensagens", opts.id, { canal: "whatsapp-template", template: t.name, comum, enviado: false });
      r = await waSendTemplate(client, t, comum);
    } else {
      if (!opts.corpo || !opts.cta) throw new Error("--flow exige --corpo e --cta");
      const flow = { id: opts.flow!, header: opts.cabecalho, body: opts.corpo, footer: opts.rodape, cta: opts.cta };
      registro = registroEscrita(opts.location, "_mensagens", opts.id, { canal: "whatsapp-flow", flow, comum, enviado: false });
      r = await waSendFlow(client, flow, comum);
    }
    fs.writeFileSync(registro, JSON.stringify({ em: new Date().toISOString(), enviado: true, resposta: r }, null, 2));
    const out = { enviado: true, contactId: opts.id, conversationId: r.conversationId ?? null, messageId: r.messageId ?? null, registro };
    if (opts.json) console.log(JSON.stringify(out));
    else log(`ok — messageId ${out.messageId}; registro em ${registro}`);
  });
}

async function runConfig(opts: {
  location: string; o: string; conversa?: string; corpo?: string; confirmo?: boolean; json?: boolean;
}): Promise<void> {
  const log = opts.json ? console.error : console.log;
  const escritas = ["ia-gravar", "sla-gravar", "sla-zerar"];
  if (escritas.includes(opts.o) && !opts.confirmo) {
    throw new Error(`${opts.o} muda a configuração da subconta inteira e não tem desfazer. Repita com --confirmo.`);
  }
  const corpo = opts.corpo ? JSON.parse(opts.corpo) : undefined;
  await withClient(opts.location, log, async (client) => {
    let out: unknown;
    switch (opts.o) {
      case "ia": out = await fetchAiSettings(client, opts.location); break;
      case "sla": out = await fetchSlaSettings(client, opts.location); break;
      case "sla-status": out = await fetchSlaInboxStatus(client, opts.location); break;
      case "sla-permissao": out = await fetchSlaClearPermission(client, opts.location); break;
      case "ia-gravar":
        if (!corpo) throw new Error("ia-gravar exige --corpo <json>");
        registroEscrita(opts.location, "_config", "ia", { antes: await fetchAiSettings(client, opts.location), pedido: corpo });
        out = await updateAiSettings(client, opts.location, corpo);
        break;
      case "sla-gravar":
        if (!corpo) throw new Error("sla-gravar exige --corpo <json>");
        registroEscrita(opts.location, "_config", "sla", { antes: await fetchSlaSettings(client, opts.location), pedido: corpo });
        out = await updateSlaSettings(client, opts.location, corpo);
        break;
      case "sla-zerar":
        if (!opts.conversa) throw new Error("sla-zerar exige --conversa <id>");
        out = await clearSla(client, opts.conversa, corpo ?? {});
        break;
      default: throw new Error(`-o inválido: ${opts.o}`);
    }
    if (opts.json) console.log(JSON.stringify(out));
    else console.log(JSON.stringify(out, null, 2));
  });
}

async function runGrupo(opts: {
  location: string; o: string; corpo?: string; conversa?: string; usuario: string[];
  desde?: string; confirmo?: boolean; json?: boolean;
}): Promise<void> {
  const log = opts.json ? console.error : console.log;
  const saiParaFora = ["criar", "mensagem"];
  if (saiParaFora.includes(opts.o) && !opts.confirmo) {
    throw new Error(`${opts.o} fala com pessoas de verdade e não tem desfazer. Repita com --confirmo.`);
  }
  const corpo = opts.corpo ? JSON.parse(opts.corpo) : undefined;
  await withClient(opts.location, log, async (client) => {
    let out: unknown;
    switch (opts.o) {
      case "criar":
        if (!corpo) throw new Error("criar exige --corpo <json> (contrato não confirmado ao vivo)");
        registroEscrita(opts.location, "_grupos", "criar", { pedido: corpo });
        out = await createGroup(client, corpo);
        break;
      case "mensagem":
        if (!corpo) throw new Error("mensagem exige --corpo <json> com o payload de envio");
        registroEscrita(opts.location, "_grupos", "mensagem", { pedido: corpo });
        out = await sendGroupMessage(client, corpo);
        break;
      case "interno-checar":
        if (!corpo) throw new Error("interno-checar exige --corpo <json>");
        out = await checkInternalChat(client, corpo);
        break;
      case "interno-participantes":
        if (!opts.conversa) throw new Error("interno-participantes exige --conversa <id>");
        out = await updateInternalChatParticipants(client, {
          conversationId: opts.conversa, userIds: opts.usuario, locationId: opts.location,
          ...(opts.desde ? { startAfter: opts.desde } : {}),
        });
        break;
      default: throw new Error(`-o inválido: ${opts.o}`);
    }
    if (opts.json) console.log(JSON.stringify(out));
    else console.log(JSON.stringify(out, null, 2));
  });
}

export function registrarMensageria(program: Command): void {
  program
    .command("whatsapp")
    .description("Leitura do WhatsApp da subconta: templates, flows, números, estado")
    .requiredOption("-l, --location <id>", "locationId da subconta")
    .requiredOption("-o <op>", "configurado | numeros | templates | aprovados | flows")
    .option("--template <id>", "um template só (com -o templates)")
    .option("--json", "imprime o resultado em JSON no stdout")
    .action((o) => runWhatsapp(o).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); }));

  program
    .command("whatsapp-enviar")
    .description("ESCREVE: manda template aprovado ou flow interativo por WhatsApp")
    .requiredOption("-l, --location <id>", "locationId da subconta")
    .requiredOption("-i, --id <id>", "id do contato")
    .option("--template <id>", "id do template aprovado")
    .option("--flow <id>", "id do flow")
    .option("--corpo <txt>", "corpo (flow)")
    .option("--cta <txt>", "texto do botão (flow)")
    .option("--cabecalho <txt>", "cabeçalho (flow)")
    .option("--rodape <txt>", "rodapé (flow)")
    .option("--de <fromNumberId>", "número de origem")
    .option("--para <numero>", "número de destino")
    .option("--conversa <id>", "conversationId")
    .option("--quando <iso>", "agenda o envio (ISO)")
    .option("--confirmo", "obrigatório: a mensagem sai para o contato")
    .option("--json", "imprime o resultado em JSON no stdout")
    .action((o) => runWhatsappEnviar(o).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); }));

  program
    .command("config")
    .description("Configuração de IA e SLA das conversas da subconta")
    .requiredOption("-l, --location <id>", "locationId da subconta")
    .requiredOption("-o <op>", "ia | sla | sla-status | sla-permissao | ia-gravar | sla-gravar | sla-zerar")
    .option("--corpo <json>", "corpo da escrita, em JSON")
    .option("--conversa <id>", "conversationId (sla-zerar)")
    .option("--confirmo", "obrigatório nas escritas")
    .option("--json", "imprime o resultado em JSON no stdout")
    .action((o) => runConfig(o).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); }));

  program
    .command("grupo")
    .description("Group chat e chat interno entre usuários")
    .requiredOption("-l, --location <id>", "locationId da subconta")
    .requiredOption("-o <op>", "criar | mensagem | interno-checar | interno-participantes")
    .option("--corpo <json>", "payload cru, em JSON")
    .option("--conversa <id>", "conversationId")
    .option("--usuario <id>", "userId; repetível", (v: string, acc: string[]) => [...acc, v], [])
    .option("--desde <data>", "histórico visível: -1 tudo, 0 nada, YYYY-MM-DD a partir de")
    .option("--confirmo", "obrigatório em criar e mensagem")
    .option("--json", "imprime o resultado em JSON no stdout")
    .action((o) => runGrupo(o).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); }));
}
