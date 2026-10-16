/**
 * Etapa 6 do plano de dashboards: conferência de contatos novos (crm-contacts) e conversas
 * (crm-conversations). Contrato que o implementador deve cumprir.
 *
 * Rotas descobertas ao vivo na Xb9gDxwxYhdqtprGcb5E (só leitura; o bundle do app de contatos
 * mostra que a tela usa POST /contacts/search/2, mas a rota abaixo já devolve o total):
 *
 *   CONTATOS  POST https://services.leadconnectorhq.com/contacts/search
 *     corpo { locationId, pageLimit: 1, page: 1,
 *             filters: [ {field:"date_added", operator:"range", value:{gte:<ms>, lte:<ms>}},
 *                        {field:"assigned_to", operator:"eq", value:"<userId>"} ] }
 *     resposta { contacts:[...], total, traceId }. `total` é o do filtro INTEIRO e não depende de
 *     pageLimit nem de page: uma chamada basta. `range` vale em ms (ISO também) e é INCLUSIVO nos
 *     dois lados; gte == lte dá 422; campo "dateAdded" dá 422 ("Invalid field"), o nome certo é
 *     `date_added`. Campo de data de atualização: `date_updated`. Medido: 29 contatos criados em
 *     01-15/10/2026, igual ao widget numérico do mesmo período.
 *   CONVERSAS GET https://services.leadconnectorhq.com/conversations/search
 *     ?locationId=<loc>&limit=1&startDate=<ms>&endDate=<ms>[&assignedTo=<userId>]
 *     resposta { conversations:[...], total }. startDate/endDate filtram a CRIAÇÃO da conversa
 *     (dateAdded), inclusivo, em ms; só startDate / só endDate também valem. `lastMessageType`
 *     (TYPE_WHATSAPP...) e `lastMessageDirection` também filtram. Medido: dia 15/10 => widget 4 e
 *     rota 4 (bate); 01/10-15/10 => widget 456 e rota 94: o widget conta como "Atividade" (id 100)
 *     362 conversas cuja última mensagem é atividade, e a rota NUNCA as devolve
 *     (lastMessageType=TYPE_ACTIVITY_* dá 0). Isso é divergência real, a causa vai para a doc;
 *     NÃO é para esconder como bate. `messages/export` dá 401 com os tokens da sessão.
 *
 * src/api/dashboards-conferir.ts (exports novos)
 *   recontarContatos(client, loc, filtro): Promise<Medida>
 *     UM POST em /contacts/search (corpo acima), range em filtro.inicio/filtro.fim (ms, já no
 *     fuso da subconta: quem converte é filtroDoWidget). campoData date_added -> "date_added";
 *     updated_at -> "date_updated". Cada Cond de grupos[0] com campo assigned_to vira
 *     {field:"assigned_to", operator:"eq", value}. total = resposta.total (NÃO contacts.length).
 *     Medida sem `grupos`. LANÇA Error com o motivo (a mensagem cita o campo) quando a rota não
 *     reproduz: filtro.agrupar != null ("agrupamento sem recontagem..."), condição fora de
 *     assigned_to (status, pipeline_id, appointmentStatus), campoData last_status_change_at,
 *     ou grupos com mais de uma alternativa OR / mais de um valor.
 *   recontarConversas(client, loc, filtro): Promise<Medida>
 *     UM GET em /conversations/search com startDate/endDate = inicio/fim em ms (limit=1);
 *     assigned_to -> assignedTo=<id>. total = resposta.total. LANÇA Error quando: agrupar != null,
 *     campoData != date_added (a rota só filtra criação; mensagem cita updated_at), ou condição
 *     fora de assigned_to.
 *   conferirWidget (despachante): crm-contacts -> recontarContatos, crm-conversations ->
 *     recontarConversas. Mesmo fluxo dos outros módulos: filtroDoWidget, dadosWidget com options
 *     materializadas na mesma janela, comparar. Se filtroDoWidget falha OU a recontagem lança,
 *     o item sai sem_conferencia com motivo = mensagem do erro (nunca "fonte entra numa etapa
 *     seguinte" para esses dois módulos, e nunca bate/diverge).
 *
 * Fora do contrato por falta de prova ao vivo: operador `in` com vários valores na busca de
 * contatos e o corpo exato para vários OR. O implementador valida os widgets do painel real.
 * Nota: o teste "módulo sem fonte" de dashboards-conferir.test.ts lista "crm-contacts"; sai de lá.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { conferirWidget, conferirPainel, recontarContatos, recontarConversas } from "../src/api/dashboards-conferir.js";

const SP = "America/Sao_Paulo";
const DIA = { inicio: Date.parse("2026-10-15T00:00:00-03:00"), fim: Date.parse("2026-10-15T23:59:59.999-03:00") };
const JANELA = { inicio: Date.parse("2026-10-01T00:00:00-03:00"), fim: Date.parse("2026-10-07T23:59:59.999-03:00") };
const R = "https://backend.leadconnectorhq.com/reporting";
const S = "https://services.leadconnectorhq.com";

interface Chamada { metodo: string; url: string; corpo?: any }
function clienteRota(rota: (metodo: string, url: string, corpo?: any) => unknown) {
  const chamadas: Chamada[] = [];
  const reg = (metodo: string) => (url: string, corpo?: unknown) => {
    chamadas.push({ metodo, url, corpo });
    return Promise.resolve(rota(metodo, url, corpo));
  };
  return { chamadas, client: { getJson: reg("get"), postJson: reg("post") } as never };
}

const filtro = (extra: Record<string, unknown> = {}) => ({
  campoData: "date_added", inicio: JANELA.inicio, fim: JANELA.fim, fuso: SP, grupos: [], agrupar: null, soma: false, ...extra,
}) as never;

/** Servidor falso: contatos e conversas devolvem UM item e o `total` verdadeiro (quem contar o array erra). */
function servidor(totalCt = 29, totalCv = 4, ghlCt = totalCt, ghlCv = totalCv) {
  const num = (n: number) => ({ data: [{ metricKey: "count::id", data: { label: "total", value: n } }] });
  return clienteRota((m, url, corpo) => {
    if (m === "post" && url.startsWith(`${R}/dashboards/crm/contacts`)) return num(ghlCt);
    if (m === "post" && url.startsWith(`${R}/dashboards/crm/conversations`)) return num(ghlCv);
    if (m === "post" && url === `${S}/contacts/search`) {
      if ((corpo?.page ?? 1) > 1) throw new Error("paginou: o total já vem na primeira resposta");
      return { contacts: totalCt ? [{ id: "c1" }] : [], total: totalCt };
    }
    if (m === "get" && url.startsWith(`${S}/conversations/search?`)) return { conversations: totalCv ? [{ id: "v1" }] : [], total: totalCv };
    throw new Error(`rota inesperada ${m} ${url}`);
  });
}
const buscas = (c: Chamada[]) => c.filter((x) => x.url === `${S}/contacts/search` || x.url.startsWith(`${S}/conversations/search`));

// ---------- recontarContatos ----------

test("recontarContatos: um POST em /contacts/search com range em ms (gte/lte inclusivos) e total lido da resposta", async () => {
  const a = servidor(29);
  const r = await recontarContatos(a.client, "L1", filtro());
  assert.equal(r.total, 29); // a resposta traz 1 contato e total 29: contar o array dá 1
  assert.equal(r.grupos, undefined);
  assert.equal(a.chamadas.length, 1);
  const c = a.chamadas[0];
  assert.deepEqual([c.metodo, c.url], ["post", `${S}/contacts/search`]);
  assert.equal(c.corpo.locationId, "L1");
  assert.equal(c.corpo.page, 1);
  assert.deepEqual(c.corpo.filters, [{ field: "date_added", operator: "range", value: { gte: JANELA.inicio, lte: JANELA.fim } }]);
});

test("recontarContatos: total zero é zero, não cai no tamanho do array nem em undefined", async () => {
  const a = servidor(0);
  assert.equal((await recontarContatos(a.client, "L1", filtro())).total, 0);
});

test("recontarContatos: campo de atualização usa date_updated; o nome dateAdded não existe na rota", async () => {
  const a = servidor(5);
  await recontarContatos(a.client, "L1", filtro({ campoData: "updated_at" }));
  assert.equal(a.chamadas[0].corpo.filters[0].field, "date_updated");
  assert.deepEqual(a.chamadas[0].corpo.filters[0].value, { gte: JANELA.inicio, lte: JANELA.fim });
});

test("recontarContatos: assigned_to vira filtro eq ao lado do range", async () => {
  const a = servidor(41);
  await recontarContatos(a.client, "L1", filtro({ grupos: [[{ campo: "assigned_to", valores: ["U1"] }]] }));
  const f = a.chamadas[0].corpo.filters as { field: string; operator: string; value: unknown }[];
  assert.equal(f.length, 2);
  assert.deepEqual(f.find((x) => x.field === "assigned_to"), { field: "assigned_to", operator: "eq", value: "U1" });
  assert.ok(f.some((x) => x.field === "date_added" && x.operator === "range"));
});

test("recontarContatos: o que a rota não reproduz lança com o motivo e não consulta nada", async () => {
  const casos: [Record<string, unknown>, RegExp][] = [
    [{ agrupar: "assigned_to" }, /agrupamento/i],
    [{ grupos: [[{ campo: "pipeline_id", valores: ["P1"] }]] }, /pipeline_id/],
    [{ grupos: [[{ campo: "status", valores: ["open"] }]] }, /status/],
    [{ campoData: "last_status_change_at" }, /last_status_change_at/],
  ];
  for (const [extra, motivo] of casos) {
    const a = servidor();
    await assert.rejects(() => recontarContatos(a.client, "L1", filtro(extra)), motivo);
    assert.equal(a.chamadas.length, 0, JSON.stringify(extra));
  }
});

// ---------- recontarConversas ----------

test("recontarConversas: um GET em /conversations/search com startDate/endDate em ms e total lido da resposta", async () => {
  const a = servidor(0, 94);
  const r = await recontarConversas(a.client, "L1", filtro());
  assert.equal(r.total, 94); // 1 conversa no array, total 94
  assert.equal(r.grupos, undefined);
  assert.equal(a.chamadas.length, 1);
  const c = a.chamadas[0];
  assert.equal(c.metodo, "get");
  assert.ok(c.url.startsWith(`${S}/conversations/search?`), c.url);
  const p = new URL(c.url).searchParams;
  assert.equal(p.get("locationId"), "L1");
  assert.equal(p.get("startDate"), String(JANELA.inicio));
  assert.equal(p.get("endDate"), String(JANELA.fim));
  assert.equal(p.get("limit"), "1");
  assert.equal(p.get("assignedTo"), null);
  assert.equal(p.get("lastMessageId"), null);
});

test("recontarConversas: assigned_to vira o parâmetro assignedTo", async () => {
  const a = servidor(0, 41);
  await recontarConversas(a.client, "L1", filtro({ grupos: [[{ campo: "assigned_to", valores: ["U1"] }]] }));
  const p = new URL(a.chamadas[0].url).searchParams;
  assert.equal(p.get("assignedTo"), "U1");
  assert.equal(p.get("startDate"), String(JANELA.inicio));
});

test("recontarConversas: a rota só filtra criação; atualização, agrupamento e outras condições lançam com o motivo", async () => {
  const casos: [Record<string, unknown>, RegExp][] = [
    [{ campoData: "updated_at" }, /updated_at|date_updated|atualiza/i],
    [{ agrupar: "assigned_to" }, /agrupamento/i],
    [{ grupos: [[{ campo: "status", valores: ["open"] }]] }, /status/],
  ];
  for (const [extra, motivo] of casos) {
    const a = servidor();
    await assert.rejects(() => recontarConversas(a.client, "L1", filtro(extra)), motivo);
    assert.equal(a.chamadas.length, 0, JSON.stringify(extra));
  }
});

// ---------- despachante ----------

const opts = (extra: Record<string, unknown> = {}) => ({
  aggregations: [{ operator: "count", field: "id" }], dateProperty: "date_added",
  dateRangeOverride: { operator: "dashboard_date_range" }, filters: [{ group: "OR", filters: [] }], ...extra,
});
const cond = (field: string, operator: string, value: unknown) => ({ field, operator, value, uiMeta: {} });
const ands = (...c: unknown[]) => ({ group: "AND", filters: c });
const ou = (...a: unknown[]) => ({ group: "OR", filters: a });
const CAMINHO: Record<string, string> = { "crm-contacts": "/dashboards/crm/contacts", "crm-conversations": "/dashboards/crm/conversations" };
function widget(widgetId: string, module: string, options: unknown) {
  const apiConfig = { path: CAMINHO[module] };
  const def = { widgetId, title: `T-${widgetId}`, chartType: "numeric", module, options, apiConfig };
  return { widgetId, titulo: def.title, chartType: "numeric", module, layout: {}, options, apiConfig, definicao: def } as never;
}
const confere = (a: ReturnType<typeof servidor>, w: never, dr = DIA) => conferirWidget(a.client, "L1", w, SP, dr);

test("conferirWidget: contatos novos batem; a busca vai com o intervalo do painel em ms e o POST de dados materializado na mesma janela", async () => {
  const a = servidor(29, 0, 29);
  const it = await confere(a, widget("W1", "crm-contacts", opts()));
  assert.equal(it.resultado, "bate");
  assert.deepEqual([it.widgetId, it.modulo], ["W1", "crm-contacts"]);
  assert.equal(it.ghl?.total, 29);
  assert.equal(it.recontagem?.total, 29);
  assert.equal(it.motivo, undefined);
  const busca = buscas(a.chamadas);
  assert.equal(busca.length, 1);
  assert.deepEqual(busca[0].corpo.filters[0].value, { gte: DIA.inicio, lte: DIA.fim });
  const dados = a.chamadas.find((c) => c.url.startsWith(`${R}/dashboards/crm/contacts`));
  assert.ok(dados, "não buscou o número do GHL");
  assert.equal(dados.corpo.options.timezone, SP);
  const ts = (dados.corpo.options.filters as any[]).flatMap((g) => g.filters).find((c) => c.operator === "time_series");
  assert.deepEqual(ts?.value, [DIA.inicio, DIA.fim]);
});

test("conferirWidget: contatos com número diferente do GHL divergem e trazem os dois números", async () => {
  const it = await confere(servidor(29, 0, 31), widget("W1", "crm-contacts", opts()));
  assert.equal(it.resultado, "diverge");
  assert.equal(it.ghl?.total, 31);
  assert.equal(it.recontagem?.total, 29);
});

test("conferirWidget: o período salvo no widget (time_series) vence o do painel, na busca e no POST de dados", async () => {
  const o = opts({ filters: [ands({ field: "date_added", operator: "time_series", value: [JANELA.inicio, JANELA.fim] })] });
  const a = servidor(7, 0, 7);
  const it = await confere(a, widget("W1", "crm-contacts", o));
  assert.equal(it.resultado, "bate");
  assert.deepEqual(buscas(a.chamadas)[0].corpo.filters[0].value, { gte: JANELA.inicio, lte: JANELA.fim });
});

test("conferirWidget: conversas batem pela criação no intervalo em ms; módulo deixa de ser 'fonte entra numa etapa seguinte'", async () => {
  const a = servidor(0, 4, 0, 4);
  const it = await confere(a, widget("W2", "crm-conversations", opts()));
  assert.equal(it.resultado, "bate");
  assert.doesNotMatch(it.motivo ?? "", /etapa seguinte/);
  assert.equal(it.recontagem?.total, 4);
  const busca = buscas(a.chamadas);
  assert.equal(busca.length, 1);
  const p = new URL(busca[0].url).searchParams;
  assert.equal(p.get("startDate"), String(DIA.inicio));
  assert.equal(p.get("endDate"), String(DIA.fim));
  const dados = a.chamadas.find((c) => c.url.startsWith(`${R}/dashboards/crm/conversations`));
  assert.equal(dados?.corpo.options.timezone, SP);
});

test("conferirWidget: conversas com atividade que a rota não enxerga (GHL 456, rota 94) divergem, não somem", async () => {
  const it = await confere(servidor(0, 94, 0, 456), widget("W2", "crm-conversations", opts()));
  assert.equal(it.resultado, "diverge");
  assert.equal(it.ghl?.total, 456);
  assert.equal(it.recontagem?.total, 94);
});

test("conferirWidget: agrupamento que a rota não reproduz sai sem_conferencia com motivo, sem consultar a busca", async () => {
  const casos: [string, string][] = [
    ["crm-contacts", "assigned_to"], ["crm-contacts", "type"],
    ["crm-conversations", "assigned_to"], ["crm-conversations", "last_message_type"],
  ];
  for (const [modulo, campo] of casos) {
    const a = servidor(29, 4, 29, 4);
    const it = await confere(a, widget("W3", modulo, opts({ groupBy: { fields: [campo], limit: 10, orderBy: "desc" } })));
    assert.equal(it.resultado, "sem_conferencia", `${modulo} ${campo}`);
    assert.match(it.motivo ?? "", /agrupamento/i, `${modulo} ${campo}`);
    assert.doesNotMatch(it.motivo ?? "", /etapa seguinte/);
    assert.equal(buscas(a.chamadas).length, 0, `${modulo} ${campo}`);
  }
});

test("conferirWidget: condição que a rota não aplica sai sem_conferencia citando o campo, mesmo com os números iguais", async () => {
  const casos: [string, string, string][] = [
    ["crm-contacts", "pipeline_id", "eq"], ["crm-conversations", "status", "eq"],
    ["crm-conversations", "unread_count", "eq"], ["crm-contacts", "tags.raw", "in"],
  ];
  for (const [modulo, campo, op] of casos) {
    const a = servidor(29, 4, 29, 4); // totais iguais: se a condição fosse ignorada, daria bate
    const it = await confere(a, widget("W4", modulo, opts({ filters: [ou(ands(cond(campo, op, "X")))] })));
    assert.equal(it.resultado, "sem_conferencia", `${modulo} ${campo}`);
    assert.ok((it.motivo ?? "").includes(campo), `${modulo}: ${it.motivo}`);
    assert.equal(buscas(a.chamadas).length, 0, `${modulo} ${campo}`);
  }
});

test("conferirWidget: conversas filtradas por atualização saem sem_conferencia (a rota só filtra criação); contatos por atualização conferem", async () => {
  const a = servidor(5, 4, 5, 4);
  const cv = await confere(a, widget("W5", "crm-conversations", opts({ dateProperty: "date_updated" })));
  assert.equal(cv.resultado, "sem_conferencia");
  assert.match(cv.motivo ?? "", /updated_at|date_updated|atualiza/i);
  assert.equal(buscas(a.chamadas).length, 0);
  const ct = await confere(a, widget("W6", "crm-contacts", opts({ dateProperty: "date_updated" })));
  assert.equal(ct.resultado, "bate");
  assert.equal(buscas(a.chamadas)[0].corpo.filters[0].field, "date_updated");
});

test("conferirWidget: assigned_to em conversa e em contato chega à rota e confere", async () => {
  const o = opts({ filters: [ou(ands(cond("assigned_to", "eq", "U1")))] });
  const a = servidor(41, 41, 41, 41);
  const ct = await confere(a, widget("W7", "crm-contacts", o));
  const cv = await confere(a, widget("W8", "crm-conversations", o));
  assert.deepEqual([ct.resultado, cv.resultado], ["bate", "bate"]);
  const [b1, b2] = buscas(a.chamadas);
  assert.ok(b1.corpo.filters.some((f: any) => f.field === "assigned_to" && f.value === "U1"));
  assert.equal(new URL(b2.url).searchParams.get("assignedTo"), "U1");
});

test("conferirPainel: contatos e conversas entram no resumo ao lado dos sem_conferencia", async () => {
  const a = servidor(29, 4, 29, 4);
  const painel = { id: "D1", titulo: "P", widgets: [
    widget("A", "crm-contacts", opts()), // bate
    widget("B", "crm-conversations", opts()), // bate
    widget("C", "crm-contacts", opts({ groupBy: { fields: ["type"] } })), // sem_conferencia
  ] };
  const r = await conferirPainel(a.client, "L1", painel as never, SP, DIA);
  assert.deepEqual(r.itens.map((i) => [i.widgetId, i.resultado]), [["A", "bate"], ["B", "bate"], ["C", "sem_conferencia"]]);
  assert.deepEqual(r.resumo, { bate: 2, diverge: 0, sem_conferencia: 1 });
});
