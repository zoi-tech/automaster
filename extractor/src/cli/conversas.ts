import { Command } from "commander";
import path from "node:path";
import {
  searchConversations, fetchMessages, sendMessage, typeName, isActivity, SEND_TYPES,
  type SendType, searchInConversation, searchMessages, fetchEmail, fetchTranscription,
  recordingUrl, updateConversation, deleteConversation, saveDraft, fetchDrafts, deleteDraft,
  cancelScheduled, resend, uploadAttachments
} from "../api/conversations.js";
import { stampNow } from "../dump/writer.js";
import fs from "node:fs";
import { DUMPS_DIR, withClient } from "./shared.js";

async function runConversas(opts: {
  location: string; id: string; max: string; atividades?: boolean; tipo?: string;
  busca?: string; email?: string; transcricao?: string; json?: boolean;
}): Promise<void> {
  const log = opts.json ? console.error : console.log;
  await withClient(opts.location, log, async (client) => {
    const convs = await searchConversations(client, opts.location, opts.id);
    if (!convs.length) {
      const vazio = { contactId: opts.id, conversas: [], mensagens: [], maisPaginas: false, proximo: null };
      if (opts.json) console.log(JSON.stringify(vazio));
      else log("Nenhuma conversa para este contato.");
      return;
    }
    const conv = convs[0];

    // atalhos que não precisam listar a conversa inteira
    if (opts.email) {
      const em = await fetchEmail(client, opts.email);
      console.log(opts.json ? JSON.stringify(em) : JSON.stringify(em, null, 2));
      return;
    }
    if (opts.transcricao) {
      const tr = await fetchTranscription(client, opts.location, opts.transcricao);
      console.log(opts.json ? JSON.stringify(tr) : JSON.stringify(tr, null, 2));
      return;
    }

    let filtroIds: Set<string> | null = null;
    if (opts.busca) {
      const hits = await searchInConversation(client, opts.location, conv.id, opts.busca);
      filtroIds = new Set(hits.map((h) => h.messageId));
      log(`Busca "${opts.busca}": ${filtroIds.size} mensagens.`);
    }

    log(`Conversa ${conv.id} — lendo mensagens...`);
    const { mensagens, maisPaginas, proximo } = await fetchMessages(
      client, conv.id, Number(opts.max) || 100, 50, opts.tipo);
    const itens = mensagens
      .filter((m) => (filtroIds ? filtroIds.has(m.id) : true))
      .filter((m) => opts.atividades || !isActivity(m.type))
      .map((m) => ({
        id: m.id,
        data: m.dateAdded,
        tipo: typeName(m.type),
        direcao: m.direction,
        autor: m.userId ?? null,
        // campo da API: app | workflow | campaign | api | bulk_actions. Nem toda mensagem traz.
        origem: (m as { source?: string }).source ?? null,
        corpo: m.body ?? m.activity?.title ?? "",
        // o e-mail completo se pede com este id, não com o da mensagem
        emailMessageId: (m as { altId?: string }).altId ?? null,
        temGravacao: Boolean((m as { meta?: unknown }).meta),
      }));
    const payload = {
      contactId: opts.id,
      conversationId: conv.id,
      conversas: convs.map((c) => ({ id: c.id, ultimoTipo: c.lastMessageType, naoLidas: c.unreadCount })),
      gravacaoUrlBase: recordingUrl(opts.location, "<messageId>"),
      n: itens.length,
      mensagens: itens,
      maisPaginas,
      proximo,
    };
    if (opts.json) { console.log(JSON.stringify(payload)); return; }
    for (const m of itens.slice().reverse()) {
      const quem = m.direcao === "inbound" ? "contato" : (m.origem ?? "saída");
      console.log(`${m.data}  ${m.tipo.padEnd(10)} ${quem.padEnd(9)} ${m.corpo.replace(/\s+/g, " ").slice(0, 120)}`);
    }
    console.log(`\n${itens.length} mensagens${maisPaginas ? " (há mais páginas)" : ""}`);
  });
}

const MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".pdf": "application/pdf", ".mp4": "video/mp4", ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg", ".txt": "text/plain", ".csv": "text/csv",
};

async function runConversasAnexar(opts: {
  location: string; id: string; arquivo: string[]; conversa?: string; grupo?: boolean; v4?: boolean; json?: boolean;
}): Promise<void> {
  const log = opts.json ? console.error : console.log;
  if (!opts.arquivo.length) throw new Error("--arquivo é obrigatório (repetível)");
  const files = opts.arquivo.map((p) => {
    const abs = path.resolve(p);
    const st = fs.statSync(abs);
    if (!st.isFile()) throw new Error(`não é arquivo: ${abs}`);
    return {
      name: path.basename(abs),
      mimeType: MIME[path.extname(abs).toLowerCase()] ?? "application/octet-stream",
      buffer: fs.readFileSync(abs),
      caminho: abs,
      bytes: st.size,
    };
  });

  await withClient(opts.location, log, async (client) => {
    let conversationId = opts.conversa;
    if (!conversationId) {
      const convs = await searchConversations(client, opts.location, opts.id, 20);
      if (!convs.length) throw new Error(`contato ${opts.id} não tem conversa; use --conversa`);
      conversationId = convs[0].id;
    }

    const dir = path.join(DUMPS_DIR, "_anexos", opts.location, opts.id);
    fs.mkdirSync(dir, { recursive: true });
    const now = new Date();
    const registro = path.join(dir, `${stampNow(now)}${now.getSeconds().toString().padStart(2, "0")}.json`);
    const arquivos = files.map((f) => ({ caminho: f.caminho, nome: f.name, bytes: f.bytes, mimeType: f.mimeType }));
    fs.writeFileSync(registro, JSON.stringify({ subidoEm: now.toISOString(), conversationId, arquivos, subido: false }, null, 2));

    log(`Subindo ${files.length} arquivo(s) na conversa ${conversationId}...`);
    const r = await uploadAttachments(client, {
      conversationId,
      files: files.map((f) => ({ name: f.name, mimeType: f.mimeType, buffer: f.buffer })),
      isGroupSms: opts.grupo,
      v4: opts.v4,
    });
    fs.writeFileSync(registro, JSON.stringify({ subidoEm: now.toISOString(), conversationId, arquivos, subido: true, resposta: r }, null, 2));

    const out = { subido: true, conversationId, contactId: opts.id, urls: r.urls, uploadedFiles: r.uploadedFiles, mediaSids: r.mediaSids, registro };
    if (opts.json) console.log(JSON.stringify(out));
    else { log(`ok — ${r.urls.length} URL(s); registro em ${registro}`); r.urls.forEach((u) => log(u)); }
  });
}

async function runConversasEnviar(opts: {
  location: string; id: string; tipo: string; texto?: string; assunto?: string;
  de?: string; anexo: string[]; quando?: string; json?: boolean;
}): Promise<void> {
  const log = opts.json ? console.error : console.log;
  const tipo = SEND_TYPES.find((t) => t.toLowerCase() === opts.tipo.toLowerCase());
  if (!tipo) throw new Error(`--tipo inválido: ${opts.tipo}. Aceitos: ${SEND_TYPES.join(", ")}`);
  if (!opts.texto) throw new Error("--texto é obrigatório");
  if (tipo === "Email" && !opts.assunto) throw new Error("Email exige --assunto");

  const payload = {
    type: tipo as SendType,
    contactId: opts.id,
    message: opts.texto,
    ...(opts.assunto ? { subject: opts.assunto } : {}),
    ...(opts.de ? { emailFrom: opts.de } : {}),
    ...(opts.anexo.length ? { attachments: opts.anexo } : {}),
    ...(opts.quando ? { scheduledTimestamp: Math.floor(new Date(opts.quando).getTime() / 1000) } : {}),
  };
  if (opts.quando && Number.isNaN(new Date(opts.quando).getTime())) throw new Error(`--quando inválido: ${opts.quando}`);
  if (opts.quando && tipo === "InternalComment") throw new Error("InternalComment ignora agendamento: a nota sai na hora");

  await withClient(opts.location, log, async (client) => {
    // registro da ação: envio não tem desfazer, mas tem que ficar rastro
    const dir = path.join(DUMPS_DIR, "_mensagens", opts.location, opts.id);
    fs.mkdirSync(dir, { recursive: true });
    const now = new Date();
    const registro = path.join(dir, `${stampNow(now)}${now.getSeconds().toString().padStart(2, "0")}.json`);
    fs.writeFileSync(registro, JSON.stringify({ enviadoEm: now.toISOString(), payload, enviado: false }, null, 2));

    log(`Enviando ${tipo} para ${opts.id}...`);
    const r = await sendMessage(client, payload);
    fs.writeFileSync(registro, JSON.stringify({ enviadoEm: now.toISOString(), payload, enviado: true, resposta: r }, null, 2));

    const out = {
      enviado: true, tipo, contactId: opts.id,
      conversationId: r.conversationId ?? null, messageId: r.messageId ?? null,
      registro,
      interno: tipo === "InternalComment",
    };
    if (opts.json) console.log(JSON.stringify(out));
    else log(`ok — messageId ${out.messageId}; registro em ${registro}`);
  });
}

async function runConversasMarcar(opts: {
  location: string; id: string; acao: string; confirmo?: boolean; json?: boolean;
}): Promise<void> {
  const log = opts.json ? console.error : console.log;
  const acoes = ["lida", "nao-lida", "estrela", "sem-estrela", "apagar"];
  if (!acoes.includes(opts.acao)) throw new Error(`--acao inválida: ${opts.acao}. Aceitas: ${acoes.join(", ")}`);
  if (opts.acao === "apagar" && !opts.confirmo) {
    throw new Error("apagar remove a conversa INTEIRA e não tem desfazer; repita com --confirmo");
  }
  await withClient(opts.location, log, async (client) => {
    const convs = await searchConversations(client, opts.location, opts.id);
    if (!convs.length) throw new Error("contato sem conversa");
    const conv = convs[0];
    let r: unknown;
    if (opts.acao === "apagar") r = await deleteConversation(client, conv.id);
    else if (opts.acao === "lida") r = await updateConversation(client, opts.location, conv.id, { unreadCount: 0 });
    else if (opts.acao === "nao-lida") r = await updateConversation(client, opts.location, conv.id, { unreadCount: 1 });
    else r = await updateConversation(client, opts.location, conv.id, { starred: opts.acao === "estrela" });
    const out = { acao: opts.acao, conversationId: conv.id, ok: true, resposta: r };
    console.log(opts.json ? JSON.stringify(out) : `ok — ${opts.acao} em ${conv.id}`);
  });
}

async function runConversasRascunho(opts: {
  location: string; id: string; acao: string; texto?: string; canal: string;
  rascunho?: string; json?: boolean;
}): Promise<void> {
  const log = opts.json ? console.error : console.log;
  await withClient(opts.location, log, async (client) => {
    let out: unknown;
    if (opts.acao === "criar") {
      if (!opts.texto) throw new Error("criar exige --texto");
      out = { criado: await saveDraft(client, opts.location, opts.id, opts.texto, opts.canal) };
    } else if (opts.acao === "listar") {
      out = { rascunhos: await fetchDrafts(client, opts.location, opts.id) };
    } else if (opts.acao === "apagar") {
      if (!opts.rascunho) throw new Error("apagar exige --rascunho <id>");
      out = { apagado: await deleteDraft(client, opts.rascunho) };
    } else throw new Error(`--acao inválida: ${opts.acao}. Aceitas: criar, listar, apagar`);
    console.log(JSON.stringify(out, opts.json ? undefined : null, opts.json ? undefined : 2));
  });
}

async function runConversasMensagem(opts: {
  location: string; acao: string; id: string; email?: boolean; json?: boolean;
}): Promise<void> {
  const log = opts.json ? console.error : console.log;
  await withClient(opts.location, log, async (client) => {
    const r = opts.acao === "cancelar"
      ? await cancelScheduled(client, opts.id, opts.email)
      : opts.acao === "reenviar"
        ? await resend(client, opts.location, opts.id, opts.email)
        : (() => { throw new Error(`--acao inválida: ${opts.acao}. Aceitas: cancelar, reenviar`); })();
    console.log(JSON.stringify({ acao: opts.acao, id: opts.id, resposta: r }));
  });
}

async function runConversasBuscar(opts: {
  location: string; termo: string; max: string; json?: boolean;
}): Promise<void> {
  const log = opts.json ? console.error : console.log;
  await withClient(opts.location, log, async (client) => {
    const convs = await searchMessages(client, opts.location, opts.termo, Number(opts.max) || 20);
    const itens = convs.map((c: any) => ({
      conversationId: c.conversationId,
      contato: c.fullName ?? c.contactName ?? null,
      contactId: c.contactId ?? null,
      messageId: c.firstMatchedMessageId ?? c.matchedMessage?.id ?? null,
      tipo: c.matchedMessage?.type != null ? typeName(c.matchedMessage.type) : null,
      trecho: (c.matchedMessage?.body ?? "").slice(0, 200),
    }));
    if (opts.json) console.log(JSON.stringify({ termo: opts.termo, n: itens.length, resultados: itens }));
    else for (const i of itens) console.log(`${i.contato ?? i.contactId}  ${i.tipo ?? "?"}  ${i.trecho.replace(/\s+/g, " ")}`);
  });
}


export function registrarConversas(program: Command): void {
  program
    .command("conversas")
    .description("Mensagens trocadas com um contato (leitura ao vivo pela API interna)")
    .requiredOption("-l, --location <id>", "locationId da subconta")
    .requiredOption("-i, --id <id>", "id do contato")
    .option("--max <n>", "máximo de mensagens", "100")
    .option("--atividades", "inclui eventos de timeline (ACTIVITY_*), que não são mensagem")
    .option("--tipo <TYPE_X>", "filtra por tipo (string da API pública, ex. TYPE_EMAIL)")
    .option("--busca <termo>", "só as mensagens desta conversa que casam com o termo")
    .option("--email <emailMessageId>", "e-mail completo (id vem de emailMessageId, não do id da mensagem)")
    .option("--transcricao <messageId>", "transcrição de uma chamada")
    .option("--json", "imprime o resultado em JSON no stdout")
    .action((o) => runConversas(o).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); }));

  program
    .command("conversas-enviar")
    .description("ESCREVE: envia mensagem ao contato (InternalComment é nota interna, não sai)")
    .requiredOption("-l, --location <id>", "locationId da subconta")
    .requiredOption("-i, --id <id>", "id do contato")
    .requiredOption("--tipo <tipo>", `canal: ${SEND_TYPES.join(" | ")}`)
    .requiredOption("--texto <txt>", "corpo da mensagem")
    .option("--assunto <s>", "assunto (obrigatório em Email)")
    .option("--de <email>", "remetente (Email)")
    .option("--anexo <url>", "URL de anexo; repetível", (v: string, acc: string[]) => [...acc, v], [])
    .option("--quando <iso>", "agenda o envio (ISO); InternalComment não aceita")
    .option("--json", "imprime o resultado em JSON no stdout")
    .action((o) => runConversasEnviar(o).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); }));

  program
    .command("conversas-anexar")
    .description("Sobe arquivos como anexo da conversa e devolve as URLs (não envia nada ao contato)")
    .requiredOption("-l, --location <id>", "locationId da subconta")
    .requiredOption("-i, --id <id>", "id do contato")
    .option("--arquivo <path>", "caminho do arquivo; repetível", (v: string, acc: string[]) => [...acc, v], [])
    .option("--conversa <id>", "conversationId (default: a primeira do contato)")
    .option("--grupo", "anexo de group chat (isGroupSms)")
    .option("--v4", "manda o header version: v4")
    .option("--json", "imprime o resultado em JSON no stdout")
    .action((o) => runConversasAnexar(o).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); }));

  program
    .command("conversas-marcar")
    .description("ESCREVE: lida/não lida, estrela, ou APAGA a conversa do contato")
    .requiredOption("-l, --location <id>", "locationId da subconta")
    .requiredOption("-i, --id <id>", "id do contato")
    .requiredOption("--acao <acao>", "lida | nao-lida | estrela | sem-estrela | apagar")
    .option("--confirmo", "obrigatório em apagar")
    .option("--json", "imprime o resultado em JSON no stdout")
    .action((o) => runConversasMarcar(o).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); }));

  program
    .command("conversas-rascunho")
    .description("Rascunho de mensagem do contato: criar, listar, apagar")
    .requiredOption("-l, --location <id>", "locationId da subconta")
    .requiredOption("-i, --id <id>", "id do contato")
    .requiredOption("--acao <acao>", "criar | listar | apagar")
    .option("--texto <txt>", "corpo (criar)")
    .option("--canal <canal>", "sms | email", "sms")
    .option("--rascunho <id>", "id do rascunho (apagar)")
    .option("--json", "imprime o resultado em JSON no stdout")
    .action((o) => runConversasRascunho(o).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); }));

  program
    .command("conversas-mensagem")
    .description("ESCREVE: cancela uma mensagem agendada ou reenvia uma que falhou")
    .requiredOption("-l, --location <id>", "locationId da subconta")
    .requiredOption("--acao <acao>", "cancelar | reenviar")
    .requiredOption("--id <messageId>", "id da mensagem (ou emailMessageId com --email)")
    .option("--email", "trata o id como e-mail")
    .option("--json", "imprime o resultado em JSON no stdout")
    .action((o) => runConversasMensagem(o).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); }));

  program
    .command("conversas-buscar")
    .description("Busca texto nas mensagens de toda a subconta")
    .requiredOption("-l, --location <id>", "locationId da subconta")
    .requiredOption("--termo <txt>", "texto a procurar")
    .option("--max <n>", "máximo de conversas", "20")
    .option("--json", "imprime o resultado em JSON no stdout")
    .action((o) => runConversasBuscar(o).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); }));
}
