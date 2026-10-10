import type { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { withClient } from "./shared.js";
import { decodeCompanyId } from "../auth/token.js";
import type { GhlClient } from "../api/client.js";
import { listWorkflows, fetchWorkflow, type ListEntry } from "../api/workflows.js";
import {
  fetchPipelines, fetchCustomFields, fetchTags, fetchUsers, fetchCalendars, fetchCustomValues,
  fetchMessageTemplates
} from "../api/entities.js";
import { listForms, listSurveys } from "../api/forms.js";
import { fetchEmailTemplates } from "../api/emails.js";
import { listCalendars, listEvents } from "../api/calendars.js";
import { listPipelines } from "../api/opportunities.js";
import { listarWorkflows } from "../api/workflows-live.js";
import { listarTags } from "../api/tags.js";
import { listar as listarAnotacao } from "../api/annotations.js";
import { searchConversations } from "../api/conversations.js";
import { fetchTemplates as waTemplates } from "../api/whatsapp.js";
import { fetchSlaSettings } from "../api/settings.js";
import { getContact } from "../api/contacts.js";
import { fetchAuditLogs } from "../api/audit.js";
import { emitir, falhar } from "../saida.js";
import { forma, type Cassete } from "./cassete.js";

// --------------------------------------------------------------- conferidores

/** Descreve o que veio, para a mensagem de falha dizer algo útil. */
function tipo(v: unknown): string {
  if (Array.isArray(v)) return "array";
  if (v === null) return "null";
  return typeof v;
}

/** A resposta é um array com pelo menos `min` itens. */
export function lista(min = 1) {
  return (r: unknown): string | null => {
    if (!Array.isArray(r)) return `esperado array, veio ${tipo(r)}`;
    return r.length >= min ? null : `array com ${r.length} item(ns), esperado ao menos ${min}`;
  };
}

/** A resposta é um objeto e `campo` dentro dele é um array com `min` itens. */
export function listaEm(campo: string, min = 1) {
  return (r: unknown): string | null => {
    if (typeof r !== "object" || r === null || Array.isArray(r)) {
      return `esperado objeto com "${campo}", veio ${tipo(r)}`;
    }
    const v = (r as Record<string, unknown>)[campo];
    if (v === undefined) {
      return `campo "${campo}" sumiu da resposta (veio: ${Object.keys(r).slice(0, 8).join(", ") || "nada"})`;
    }
    return lista(min)(v);
  };
}

/** A resposta é um objeto com todos os campos pedidos preenchidos. */
export function objetoCom(...campos: string[]) {
  return (r: unknown): string | null => {
    if (typeof r !== "object" || r === null || Array.isArray(r)) {
      return `esperado objeto, veio ${tipo(r)}`;
    }
    const faltam = campos.filter((c) => (r as Record<string, unknown>)[c] === undefined);
    return faltam.length === 0 ? null : `campos ausentes: ${faltam.join(", ")}`;
  };
}

/** A resposta é um objeto com alguma chave — para rota de configuração, que pode vir vazia de conteúdo. */
export function objeto() {
  return (r: unknown): string | null => {
    if (typeof r !== "object" || r === null || Array.isArray(r)) return `esperado objeto, veio ${tipo(r)}`;
    return Object.keys(r).length > 0 ? null : "objeto sem nenhuma chave";
  };
}

// --------------------------------------------------------------- as checagens

/** O que uma checagem descobriu e as seguintes podem usar. */
export interface Contexto {
  loc: string;
  companyId: string;
  contato?: string;
  workflow?: ListEntry;
  calendario?: string;
}

export interface Checagem {
  nome: string;
  /** Sai como `pulado` quando o dado de que depende não existe. */
  precisa?: (c: Contexto) => boolean;
  chamar: (client: GhlClient, c: Contexto) => Promise<unknown>;
  conferir: (r: unknown) => string | null;
  /** O que esta resposta ensina às checagens seguintes. */
  colher?: (r: unknown, c: Contexto) => void;
}

const temContato = (c: Contexto): boolean => Boolean(c.contato);

/** Janela de 7 dias a partir de agora, no formato que a agenda aceita (sem milissegundos). */
export function janela(agora = new Date()): { inicio: string; fim: string } {
  const semMs = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, "Z");
  return {
    inicio: semMs(agora),
    fim: semMs(new Date(agora.getTime() + 7 * 86_400_000)),
  };
}

export const CHECAGENS: Checagem[] = [
  {
    nome: "workflows/lista",
    chamar: (cl, c) => listWorkflows(cl, c.loc),
    conferir: lista(1),
    colher: (r, c) => { c.workflow = (r as ListEntry[])[0]; },
  },
  {
    nome: "workflows/detalhe",
    precisa: (c) => Boolean(c.workflow),
    chamar: (cl, c) => fetchWorkflow(cl, c.loc, c.workflow!),
    // As actions vivem em steps.templates; o detalhe traz o documento em workflowData.
    conferir: objetoCom("detail", "steps", "triggers"),
  },
  { nome: "entidades/pipelines", chamar: (cl, c) => fetchPipelines(cl, c.loc), conferir: listaEm("pipelines") },
  { nome: "entidades/custom_fields", chamar: (cl, c) => fetchCustomFields(cl, c.loc), conferir: listaEm("customFields") },
  { nome: "entidades/tags", chamar: (cl, c) => fetchTags(cl, c.loc), conferir: listaEm("tags") },
  { nome: "entidades/users", chamar: (cl, c) => fetchUsers(cl, c.loc, c.companyId), conferir: listaEm("users") },
  {
    nome: "entidades/calendars",
    chamar: (cl, c) => fetchCalendars(cl, c.loc),
    conferir: listaEm("calendars", 0),
  },
  { nome: "entidades/custom_values", chamar: (cl, c) => fetchCustomValues(cl, c.loc), conferir: listaEm("customValues", 0) },
  { nome: "entidades/message_templates", chamar: (cl, c) => fetchMessageTemplates(cl, c.loc), conferir: listaEm("templates", 0) },
  { nome: "formularios/lista", chamar: (cl, c) => listForms(cl, c.loc), conferir: listaEm("forms", 0) },
  { nome: "surveys/lista", chamar: (cl, c) => listSurveys(cl, c.loc), conferir: listaEm("surveys", 0) },
  { nome: "emails/builder", chamar: (cl, c) => fetchEmailTemplates(cl, c.loc), conferir: listaEm("builders", 0) },
  {
    nome: "agenda/calendarios",
    chamar: (cl, c) => listCalendars(cl, c.loc),
    conferir: listaEm("calendars", 0),
    colher: (r, c) => {
      const cs = (r as { calendars?: { id?: string }[] }).calendars ?? [];
      c.calendario = cs[0]?.id;
    },
  },
  {
    nome: "agenda/eventos",
    precisa: (c) => Boolean(c.calendario),
    chamar: (cl, c) => listEvents(cl, c.loc, { ...janela(), calendario: c.calendario }),
    // A query só aceita milissegundos: com ISO a resposta vem 200 e vazia, em silêncio.
    conferir: listaEm("events", 0),
  },
  { nome: "oportunidades/pipelines", chamar: (cl, c) => listPipelines(cl, c.loc), conferir: listaEm("pipelines", 0) },
  { nome: "workflows-ao-vivo/lista", chamar: (cl, c) => listarWorkflows(cl, c.loc), conferir: lista(1) },
  { nome: "tags/lista", chamar: (cl, c) => listarTags(cl, c.loc), conferir: lista(0) },
  { nome: "whatsapp/templates", chamar: (cl, c) => waTemplates(cl, c.loc), conferir: lista(0) },
  { nome: "conversas/sla", chamar: (cl, c) => fetchSlaSettings(cl, c.loc), conferir: objeto() },
  {
    nome: "contato/detalhe",
    precisa: temContato,
    chamar: (cl, c) => getContact(cl, c.loc, c.contato!),
    conferir: objeto(),
  },
  {
    nome: "conversas/busca",
    precisa: temContato,
    chamar: (cl, c) => searchConversations(cl, c.loc, c.contato!),
    conferir: lista(0),
  },
  {
    nome: "anotacoes/notas",
    precisa: temContato,
    chamar: (cl, c) => listarAnotacao(cl, "nota", c.contato!),
    conferir: objeto(),
  },
  {
    nome: "contato/timeline",
    precisa: temContato,
    chamar: (cl, c) => fetchAuditLogs(cl, c.loc, c.contato!, 30),
    conferir: lista(0),
  },
];

// ------------------------------------------------------------------- execução

export interface Resultado {
  nome: string;
  estado: "ok" | "falhou" | "pulado";
  motivo?: string;
}

/** Roda as checagens em ordem; uma falha não interrompe as seguintes. */
export async function executar(
  client: GhlClient,
  ctx: Contexto,
  checagens: Checagem[],
  log: (msg: string) => void,
  /** `antes` prepara a checagem (o cassete usa para escolher a fila); `depois` recebe o que ela consumiu. */
  ganchos?: { antes?: (checagem: string) => void; depois?: (checagem: string, respostas: unknown[]) => void },
): Promise<Resultado[]> {
  const out: Resultado[] = [];
  for (const ch of checagens) {
    if (ch.precisa && !ch.precisa(ctx)) {
      out.push({ nome: ch.nome, estado: "pulado", motivo: "falta o dado de que depende (use --contato)" });
      log(`pulado  ${ch.nome}`);
      continue;
    }
    try {
      if (ganchos) {
        ganchos.antes?.(ch.nome);
        client.coletar(); // descarta o que sobrou da checagem anterior
      }
      const r = await ch.chamar(client, ctx);
      ganchos?.depois?.(ch.nome, client.coletar());
      const erro = ch.conferir(r);
      if (erro) {
        out.push({ nome: ch.nome, estado: "falhou", motivo: erro });
        log(`FALHOU  ${ch.nome}: ${erro}`);
      } else {
        ch.colher?.(r, ctx);
        out.push({ nome: ch.nome, estado: "ok" });
        log(`ok      ${ch.nome}`);
      }
    } catch (e) {
      const motivo = e instanceof Error ? e.message : String(e);
      out.push({ nome: ch.nome, estado: "falhou", motivo });
      log(`FALHOU  ${ch.nome}: ${motivo}`);
    }
  }
  return out;
}

export function resumo(rs: Resultado[]): { ok: number; falhou: number; pulado: number } {
  return {
    ok: rs.filter((r) => r.estado === "ok").length,
    falhou: rs.filter((r) => r.estado === "falhou").length,
    pulado: rs.filter((r) => r.estado === "pulado").length,
  };
}

async function runSmoke(o: { location: string; contato?: string; json?: boolean; gravar?: string }): Promise<void> {
  const log = o.json ? (): void => {} : console.log;
  let rs: Resultado[] = [];
  const cassete: Cassete = { gravadoEm: new Date().toISOString(), respostas: {} };
  await withClient(o.location, log, async (client, tokens) => {
    const ctx: Contexto = {
      loc: o.location,
      companyId: decodeCompanyId(tokens.tokenId) ?? "",
      contato: o.contato,
    };
    if (o.gravar) client.espiar();
    rs = await executar(client, ctx, CHECAGENS, log, o.gravar
      ? { depois: (nome, respostas) => { cassete.respostas[nome] = respostas.map((r) => forma(r)); } }
      : undefined);
  });
  if (o.gravar) {
    fs.mkdirSync(path.dirname(o.gravar), { recursive: true });
    fs.writeFileSync(o.gravar, JSON.stringify(cassete, null, 2));
    log(`cassete gravado em ${o.gravar} (só a forma das respostas)`);
  }
  const r = resumo(rs);
  if (o.json) emitir(true, { checagens: rs, resumo: r });
  else console.log(`\n${r.ok} ok, ${r.falhou} falhou, ${r.pulado} pulado`);
  if (r.falhou > 0) process.exit(1);
}

export function registrarSmoke(program: Command): void {
  program
    .command("smoke")
    .description("confere, uma chamada por rota, se a API interna ainda responde na forma esperada (só leitura)")
    .requiredOption("-l, --location <id>", "locationId da subconta")
    .option("--contato <id>", "id de um contato; sem ele as rotas por contato saem como pulado")
    .option("--json", "imprime o resultado em JSON no stdout")
    .option("--gravar <arquivo>", "grava a forma das respostas como cassete para o CI reproduzir")
    .action((o) => runSmoke(o).catch(falhar));
}
