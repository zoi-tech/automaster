import type { GhlClient } from "./client.js";

/**
 * API interna do app, achada no bundle público do editor de workflows.
 * Atenção ao prefixo: a busca de inscritos usa `/workflows` (PLURAL), as demais
 * usam `/workflow` (singular). Não é engano de digitação — são serviços diferentes.
 */
const BACKEND = "https://backend.leadconnectorhq.com";
const WF = `${BACKEND}/workflow`;
const WFS = `${BACKEND}/workflows`;

/** O servidor tem quatro status, não dois. `locked` e `paused` aparecem no app. */
export type StatusWorkflow = "published" | "draft" | "locked" | "paused";

export const STATUS_WORKFLOW: StatusWorkflow[] = ["published", "draft", "locked", "paused"];

/** Linha da lista de workflows, como o `/list` devolve. */
export interface WorkflowLinha {
  id: string;
  name?: string;
  status?: string;
  updatedAt?: string;
}

/**
 * Uma inscrição, como o servidor manda. Campos opcionais porque a rota é interna e
 * não documentada: tudo que a gente lê daqui pode sumir numa atualização do app.
 */
export interface InscricaoCrua {
  _id?: string;
  id?: string;
  contactId?: string;
  workflowId?: string;
  status?: string;
  createdAt?: string;
  currentStepName?: string;
  currentStepType?: string;
  nextExecutionOn?: string;
  meta?: { addedSource?: { source?: string; sourceName?: string } };
}

/** Cursor da paginação: os três campos que a próxima página exige. */
export interface Cursor {
  referenceId: string;
  referenceCreatedAt: string;
  referenceSid: string;
}

export interface PaginaInscritos {
  linhas: InscricaoCrua[];
  cursor?: Cursor;
  estrangulado: boolean;
}

/** Metadados de um workflow, sem baixar os steps do Firebase (que é a parte cara). */
export function getWorkflowMeta(client: GhlClient, loc: string, wid: string): Promise<unknown> {
  return client.getJson(`${WF}/${loc}/${wid}?includeScheduledPauseInfo=true`);
}

/**
 * Lista plana de workflows da subconta. Mesma rota que a extração usa, paginada por
 * offset; aqui só interessam id, nome e status correntes.
 */
export async function listarWorkflows(client: GhlClient, loc: string): Promise<WorkflowLinha[]> {
  const limit = 100;
  const todos: WorkflowLinha[] = [];
  for (let offset = 0; ; offset += limit) {
    const d = await client.getJson<{ rows?: WorkflowLinha[]; count?: number }>(
      `${WF}/${loc}/list?type=workflow&limit=${limit}&offset=${offset}&sortBy=name&sortOrder=asc`,
    );
    const rows = d.rows ?? [];
    todos.push(...rows);
    if (!rows.length || todos.length >= (d.count ?? 0)) return todos;
  }
}

/**
 * Uma página de inscritos. Sem `cursor`, traz a primeira; com `cursor`, a seguinte.
 * `isLocationRateLimited` é uma bandeira do próprio servidor dizendo que estrangulou a
 * subconta — resposta curta com ela ligada é resposta cortada, não lista curta.
 */
export async function paginaDeInscritos(
  client: GhlClient, loc: string, wid: string, limite: number, cursor?: Cursor,
): Promise<PaginaInscritos> {
  const p = new URLSearchParams({
    workflowId: wid,
    locationId: loc,
    limit: String(limite),
    action: cursor ? "next" : "first",
  });
  if (cursor) {
    p.set("referenceId", cursor.referenceId);
    p.set("referenceCreatedAt", cursor.referenceCreatedAt);
    p.set("referenceSid", cursor.referenceSid);
  }
  const d = await client.getJson<{ statuses?: InscricaoCrua[]; isLocationRateLimited?: boolean }>(
    `${WFS}/status/search/workflow-with-filter?${p.toString()}`,
  );
  const linhas = d.statuses ?? [];
  const ultima = linhas.at(-1);
  return {
    linhas,
    cursor: ultima
      ? {
          referenceId: String(ultima._id ?? ultima.id ?? ""),
          referenceCreatedAt: String(ultima.createdAt ?? ""),
          referenceSid: String(ultima.contactId ?? ""),
        }
      : undefined,
    estrangulado: d.isLocationRateLimited === true,
  };
}

/** Quantos passaram pelo workflow e quantos já terminaram. Uma chamada, resposta curta. */
export function contarInscritos(
  client: GhlClient, loc: string, wid: string,
): Promise<{ total?: number; finished?: number }> {
  return client.getJson(`${WFS}/status/enroll-stats?workflowId=${wid}&locationId=${loc}`);
}

/** O lado inverso: em que workflows este contato está agora. */
export function inscricoesDoContato(
  client: GhlClient, loc: string, cid: string,
): Promise<{ count?: number; workflowStatuses?: InscricaoCrua[] }> {
  return client.getJson(`${WF}/${loc}/contact/${cid}/statuses_v2`);
}

/** Uma inscrição achatada nos campos que a gente usa nos dois lados da leitura. */
export interface Inscricao {
  inscricaoId: string;
  contactId: string;
  contato?: string;
  status: string;
  entrouEm: string;
  passo: string;
  passoTipo: string;
  proximaExecucao: string;
  origem: string;
  origemNome: string;
}

/** Campo ausente vira string vazia: a rota é interna e pode parar de mandar qualquer um. */
export function normalizarInscricao(c: InscricaoCrua): Inscricao {
  return {
    inscricaoId: String(c._id ?? c.id ?? ""),
    contactId: String(c.contactId ?? ""),
    status: String(c.status ?? ""),
    entrouEm: String(c.createdAt ?? ""),
    passo: String(c.currentStepName ?? ""),
    passoTipo: String(c.currentStepType ?? ""),
    proximaExecucao: String(c.nextExecutionOn ?? ""),
    origem: String(c.meta?.addedSource?.source ?? ""),
    origemNome: String(c.meta?.addedSource?.sourceName ?? ""),
  };
}

/** Apara no teto e diz se aparou. Quem chama precisa declarar o corte na resposta. */
export function cortar<T>(linhas: T[], limite: number): { linhas: T[]; cortou: boolean } {
  if (linhas.length <= limite) return { linhas, cortou: false };
  return { linhas: linhas.slice(0, limite), cortou: true };
}

/**
 * Por que a lista veio vazia. Lista vazia muda vale um bug inteiro: foi assim que a
 * agenda sumiu em silêncio quando a data ia em texto (docs/endpoints.md, seção Agenda).
 */
export function porqueVazio(estrangulado: boolean): string {
  return estrangulado
    ? "o servidor estrangulou a subconta (isLocationRateLimited) e devolveu a busca cortada; " +
      "não dá para afirmar que não há ninguém dentro. Tente de novo em alguns minutos."
    : "nenhum contato está dentro deste workflow agora.";
}

export interface SaidaPorWorkflow {
  workflow: { id: string; name?: string; status?: string };
  total_historico?: number;
  terminados?: number;
  dentro_agora: number;
  cortou: boolean;
  estrangulado: boolean;
  inscricoes: Inscricao[];
  vazio_porque?: string;
}

/** O lado "quem está dentro deste workflow". */
export function resumoPorWorkflow(a: {
  workflow: WorkflowLinha;
  cruas: InscricaoCrua[];
  total?: number;
  finished?: number;
  cortou: boolean;
  estrangulado: boolean;
  nomes: Record<string, string>;
}): SaidaPorWorkflow {
  const inscricoes = a.cruas.map((c) => {
    const i = normalizarInscricao(c);
    const nome = a.nomes[i.contactId];
    return nome ? { ...i, contato: nome } : i;
  });
  return {
    workflow: { id: a.workflow.id, name: a.workflow.name, status: a.workflow.status },
    total_historico: a.total,
    terminados: a.finished,
    dentro_agora: inscricoes.length,
    cortou: a.cortou,
    estrangulado: a.estrangulado,
    inscricoes,
    ...(inscricoes.length ? {} : { vazio_porque: porqueVazio(a.estrangulado) }),
  };
}

export interface SaidaPorContato {
  contactId: string;
  dentro_agora: number;
  inscricoes: (Inscricao & { workflowId: string; workflow?: string })[];
  vazio_porque?: string;
}

/** O lado "em que workflows este contato está". Mesma linha normalizada do outro lado. */
export function resumoPorContato(a: {
  contactId: string;
  cruas: InscricaoCrua[];
  nomesWorkflow: Record<string, string>;
}): SaidaPorContato {
  const inscricoes = a.cruas.map((c) => {
    const wid = String(c.workflowId ?? "");
    const nome = a.nomesWorkflow[wid];
    return { ...normalizarInscricao(c), workflowId: wid, ...(nome ? { workflow: nome } : {}) };
  });
  return {
    contactId: a.contactId,
    dentro_agora: inscricoes.length,
    inscricoes,
    ...(inscricoes.length
      ? {}
      : { vazio_porque: "nenhum workflow tem este contato dentro agora." }),
  };
}

export interface SaidaAcao {
  aplicado: true;
  acao: string;
  workflowId: string;
  resposta: unknown;
  registro: string;
  aviso?: string;
}

/**
 * Saída de `workflow-acao`, pura para que um teste morda se alguém tirar o `aviso` —
 * é exatamente o que já aconteceu com `saidaPaletaGravar` (src/forms/style.ts:151).
 */
export function saidaWorkflowAcao(a: {
  acao: string; workflowId: string; resposta: unknown; registro: string; aviso?: string;
}): SaidaAcao {
  return {
    aplicado: true, acao: a.acao, workflowId: a.workflowId,
    resposta: a.resposta, registro: a.registro,
    ...(a.aviso ? { aviso: a.aviso } : {}),
  };
}

/**
 * O que despublicar faz com quem está dentro. Não é perda: o app tem o estado
 * `paused_due_to_draft_mode` e os contatos retomam de onde pararam na republicação —
 * todos de uma vez, que é o risco de verdade.
 */
export function avisoDespublicar(n: number, aoMenos = false): string {
  if (n <= 0) {
    return aoMenos
      ? "não deu para contar quantos estão dentro (busca cortada ou estrangulada). Quem " +
        "estiver dentro não é removido: congela no passo em que está e volta a andar, " +
        "todos de uma vez, quando o workflow for republicado."
      : "nenhum contato está dentro; despublicar não afeta ninguém agora.";
  }
  const quantos = aoMenos ? `pelo menos ${n}` : `${n}`;
  return `${quantos} contato(s) estão dentro agora. Eles não são removidos: congelam no passo em ` +
    "que estão e voltam a andar, todos de uma vez, quando o workflow for republicado.";
}

/** Origem das escritas. Valores do próprio app: enum desconhecido costuma dar 422. */
const CANAL = "web_app";
const FONTE_CONTATO = "add_to_campaign_modal";
const FONTE_INSCRICAO = "workflow_status_page";

/** ESCREVE: liga ou desliga o workflow. É um campo de status, não duas rotas. */
export function mudarStatus(
  client: GhlClient, loc: string, wid: string, status: StatusWorkflow, userId: string,
): Promise<unknown> {
  return client.putJson(`${WF}/${loc}/change-status/${wid}`, { status, updatedBy: userId });
}

/**
 * ESCREVE: coloca um contato no workflow. A entrada é ENFILEIRADA — ler o estado logo
 * depois pode não mostrar ninguém sem que nada tenha falhado.
 */
export function inscreverContato(
  client: GhlClient, loc: string, wid: string, contactId: string, userId: string,
  eventStartTime?: string,
): Promise<unknown> {
  return client.postJson(`${WF}/${loc}/${wid}/start-workflow`, {
    contactId,
    actionFrom: { userId, source: FONTE_CONTATO, channel: CANAL },
    ...(eventStartTime ? { eventStartTime } : {}),
  });
}

/** ESCREVE: tira o contato do workflow, pela rota por contato (não pela por inscrição). */
export function removerContato(
  client: GhlClient, loc: string, contactId: string, wid: string, userId: string,
): Promise<unknown> {
  return client.postJson(`${WF}/${loc}/contact/${contactId}/stop-execution`, {
    workflowId: wid,
    removedFrom: { userId, channel: CANAL, source: FONTE_CONTATO },
  });
}

/** ESCREVE: religa uma inscrição parada. O alvo é o id da INSCRIÇÃO, não o do contato. */
export function retomarInscricao(
  client: GhlClient, loc: string, inscricaoId: string, userId: string,
): Promise<unknown> {
  return client.postJson(`${WF}/${loc}/${inscricaoId}/force-resume`, {
    actionFrom: { userId, channel: CANAL, source: FONTE_INSCRICAO },
  });
}

/**
 * Qual inscrição deste contato retomar num workflow. Duas inscrições no mesmo workflow é
 * possível (a flag `allowMultiple` do GHL), e aí escolher por conta própria seria adivinhar.
 */
export function resolverInscricao(
  cruas: InscricaoCrua[], wid: string,
): { id: string } | { erro: string } {
  const minhas = cruas
    .filter((c) => String(c.workflowId ?? "") === wid)
    .map((c) => String(c._id ?? c.id ?? ""))
    .filter(Boolean);
  if (!minhas.length) return { erro: `este contato não está no workflow ${wid} agora.` };
  if (minhas.length > 1) {
    return {
      erro: `o contato tem ${minhas.length} inscrições neste workflow (${minhas.join(", ")}). ` +
        "Escolha uma com --inscricao <id>.",
    };
  }
  return { id: minhas[0] };
}
