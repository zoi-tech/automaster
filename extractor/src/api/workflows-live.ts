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
  type?: string;
}

/**
 * Uma inscrição, como o servidor manda. Campos opcionais porque a rota é interna e
 * não documentada: tudo que a gente lê daqui pode sumir numa atualização do app.
 */
export interface InscricaoCrua {
  _id?: string;
  id?: string;
  /** Campo que o cursor de paginação exige (`referenceSid`) — é DIFERENTE de `contactId`
   * (achado ao vivo, item 8 da prova de leitura). Mandar `contactId` no lugar dele estoura
   * com erro HTTP na segunda página. */
  sid?: string;
  contactId?: string;
  workflowId?: string;
  status?: string;
  createdAt?: string;
  currentStepName?: string;
  currentStepType?: string;
  /** Nome real na resposta. `nextExecutionOn` é o nome que veio do bundle público — pode voltar. */
  executeOn?: string;
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
 * Lista plana de workflows da subconta. Mesma rota que a extração usa (`workflows.ts`),
 * paginada por offset; aqui só interessam id, nome e status correntes. `?type=workflow`
 * já filtra no servidor, mas a extração original filtra de novo por `type` na resposta —
 * mantido aqui para as duas não divergirem.
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
    if (!rows.length || todos.length >= (d.count ?? 0)) return todos.filter((r) => r.type === "workflow");
  }
}

/**
 * Uma página de inscritos. Sem `cursor`, traz a primeira; com `cursor`, a seguinte.
 * `isLocationRateLimited` é uma bandeira do próprio servidor dizendo que estrangulou a
 * subconta — resposta curta com ela ligada é resposta cortada, não lista curta.
 *
 * O cursor é `referenceId`/`referenceCreatedAt`/`referenceSid`, e `referenceSid` é o campo
 * `sid` da linha — NÃO `contactId` (achado ao vivo, item 8): mandar `contactId` faz o
 * servidor devolver erro HTTP na segunda página. `action=prev`, `skip`, `offset` e `page`
 * não existem, também dão erro HTTP.
 *
 * Se a última linha não tiver `sid`, não dá para montar o próximo cursor: a página sai
 * sem `cursor`, e quem chama para de paginar. Melhor parar do que estourar.
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
    cursor: ultima?.sid
      ? {
          referenceId: String(ultima._id ?? ultima.id ?? ""),
          referenceCreatedAt: String(ultima.createdAt ?? ""),
          referenceSid: String(ultima.sid),
        }
      : undefined,
    estrangulado: d.isLocationRateLimited === true,
  };
}

/**
 * Junta uma nova página ao acumulado, descartando a repetição: o cursor é INCLUSIVO e a
 * página seguinte traz de novo a linha de referência na frente (achado ao vivo, item 8).
 * Função pura — a fiação de paginação não tinha teste, e foi lá que os defeitos desta
 * feature se esconderam.
 */
export function juntarPaginas(acumulado: InscricaoCrua[], novas: InscricaoCrua[]): InscricaoCrua[] {
  const ultimoId = acumulado.at(-1)?._id;
  const repete = ultimoId !== undefined && novas[0]?._id === ultimoId;
  return [...acumulado, ...(repete ? novas.slice(1) : novas)];
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
    proximaExecucao: String(c.executeOn ?? c.nextExecutionOn ?? ""),
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
 * `apenasTerminadas` é o terceiro caso: a busca trouxe linhas, mas todas `finished` —
 * achado ao vivo (item 7 da prova de leitura) — e dizer só "nenhum contato" seria omitir
 * que houve gente ali.
 */
export function porqueVazio(estrangulado: boolean, apenasTerminadas = false): string {
  if (estrangulado) {
    return "o servidor estrangulou a subconta (isLocationRateLimited) e devolveu a busca cortada; " +
      "não dá para afirmar que não há ninguém dentro. Tente de novo em alguns minutos.";
  }
  if (apenasTerminadas) {
    return "há inscrição(ões) neste workflow, mas todas já terminaram; nenhum contato está dentro agora.";
  }
  return "nenhum contato está dentro deste workflow agora.";
}

/**
 * Um status `finished` é inscrição terminada; qualquer outro conta como "dentro agora".
 * Único critério observado ao vivo — não supor outros status terminais. Usado dos dois
 * lados (`resumoPorWorkflow` e `resumoPorContato`) e por `runWorkflowAcao` no aviso de
 * despublicar, que usava o tamanho cru da lista e mentia contando quem já tinha saído.
 */
export function contarNaoTerminados(linhas: { status?: string }[]): number {
  return linhas.filter((l) => l.status !== "finished").length;
}

export interface SaidaPorWorkflow {
  workflow: { id: string; name?: string; status?: string };
  dentro_agora: number;
  cortou: boolean;
  estrangulado: boolean;
  inscricoes: Inscricao[];
  vazio_porque?: string;
}

/**
 * O lado "quem está dentro deste workflow". `total_historico`/`terminados` saíram:
 * `enroll-stats` é 404 em todas as variantes testadas ao vivo, e não há substituto —
 * `count` da busca paginada é o tamanho da página, não o total (confirmado ao vivo).
 * `workflow-with-filter` devolve as linhas `finished` junto das vivas (achado ao vivo,
 * item 7) — `dentro_agora` conta só quem não terminou; as linhas `finished` continuam
 * em `inscricoes`, com o status delas, para quem quiser ver que passou por ali.
 */
export function resumoPorWorkflow(a: {
  workflow: WorkflowLinha;
  cruas: InscricaoCrua[];
  cortou: boolean;
  estrangulado: boolean;
  nomes: Record<string, string>;
}): SaidaPorWorkflow {
  const inscricoes = a.cruas.map((c) => {
    const i = normalizarInscricao(c);
    const nome = a.nomes[i.contactId];
    return nome ? { ...i, contato: nome } : i;
  });
  const dentroAgora = contarNaoTerminados(inscricoes);
  return {
    workflow: { id: a.workflow.id, name: a.workflow.name, status: a.workflow.status },
    dentro_agora: dentroAgora,
    cortou: a.cortou,
    estrangulado: a.estrangulado,
    inscricoes,
    ...(dentroAgora
      ? {}
      : { vazio_porque: porqueVazio(a.estrangulado, inscricoes.length > 0) }),
  };
}

export interface SaidaPorContato {
  contactId: string;
  dentro_agora: number;
  inscricoes: (Partial<Inscricao> & { workflowId: string; status: string; workflow?: string })[];
  vazio_porque?: string;
}

/**
 * O lado "em que workflows este contato está". A rota (`statuses_v2`) devolve só
 * `{workflowId, status}` (achado ao vivo, item 5 da prova de leitura) — os outros seis
 * campos de `Inscricao` vêm sempre vazios daqui, então a linha só leva o que de fato veio:
 * campo ausente não entra na chave, para quem lê (inclusive o MCP) não confundir "a rota
 * não manda isso" com "o campo está vazio". `workflowId` e `status` sempre saem, mesmo
 * vazios, porque são a identidade da linha.
 *
 * `dentro_agora` conta só quem NÃO terminou (`status !== "finished"`) — o lado do contato
 * costuma trazer um histórico cheio de `finished` (visto ao vivo: 9 de 10 linhas), e contar
 * a lista inteira mentia que o contato estava dentro de workflows que já acabou de percorrer.
 * As linhas `finished` continuam na lista, com o status delas, para quem quiser o histórico.
 */
export function resumoPorContato(a: {
  contactId: string;
  cruas: InscricaoCrua[];
  nomesWorkflow: Record<string, string>;
}): SaidaPorContato {
  const inscricoes = a.cruas.map((c) => {
    const wid = String(c.workflowId ?? "");
    const nome = a.nomesWorkflow[wid];
    const i = normalizarInscricao(c);
    const { status, ...resto } = i;
    const preenchidos = Object.fromEntries(
      Object.entries(resto).filter(([, v]) => v !== ""),
    );
    return { ...preenchidos, workflowId: wid, status, ...(nome ? { workflow: nome } : {}) };
  });
  const dentroAgora = contarNaoTerminados(inscricoes);
  const vazioPorque = inscricoes.length
    ? "este contato já terminou todos os workflows por onde passou; nenhum está com ele dentro agora."
    : "nenhum workflow tem este contato dentro agora.";
  return {
    contactId: a.contactId,
    dentro_agora: dentroAgora,
    inscricoes,
    ...(dentroAgora ? {} : { vazio_porque: vazioPorque }),
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
 *
 * `cruas` vem da busca de inscritos DO WORKFLOW (não da rota `statuses_v2` do contato: essa
 * devolve só `{workflowId, status}`, sem `_id`, e nunca dá para resolver nada com ela —
 * achado ao vivo). Por isso filtra pelos DOIS campos, workflowId e contactId.
 */
export function resolverInscricao(
  cruas: InscricaoCrua[], wid: string, contactId: string,
): { id: string } | { erro: string } {
  const minhas = cruas
    .filter((c) => String(c.workflowId ?? "") === wid && String(c.contactId ?? "") === contactId)
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

/**
 * Nome do contato para exibição, na ordem: `contactName`, `name`, `firstName`+`lastName`
 * aparados, `email`. `getContact` NÃO devolve `contact.name` nem `contactName` (achado ao
 * vivo) — só `firstName`/`lastName`/`fullNameLowerCase`/`email` — mas a rota é interna e
 * pode voltar a mandar qualquer um desses campos, daí a ordem inteira.
 */
export function nomeContato(c: {
  contactName?: string; name?: string; firstName?: string; lastName?: string; email?: string;
}): string {
  if (c.contactName) return c.contactName;
  if (c.name) return c.name;
  const junto = [c.firstName, c.lastName].filter(Boolean).map((s) => s!.trim()).join(" ").trim();
  if (junto) return junto;
  return c.email ?? "";
}
