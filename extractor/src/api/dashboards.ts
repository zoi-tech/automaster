import type { GhlClient } from "./client.js";

/**
 * Painéis (dashboards) nativos do GHL. Host `backend.leadconnectorhq.com/reporting`,
 * dois tokens da sessão. Rotas em docs/endpoints.md, seção `## Dashboards`.
 */
const BASE = "https://backend.leadconnectorhq.com/reporting";

export interface LayoutWidget { x: number; y: number; w: number; h: number; minW: number; minH: number }

export interface WidgetDef {
  widgetId: string;
  title: string;
  chartType: string;
  module: string;
  options: unknown;
  apiConfig: { path: string };
}

export interface WidgetPainel {
  widgetId: string;
  titulo: string | null;
  chartType: string | null;
  module: string | null;
  layout: LayoutWidget;
  options: unknown;
  apiConfig: { path: string } | null;
  definicao: WidgetDef | null;
}

export interface Painel {
  id: string;
  titulo: string;
  isDefault: boolean;
  isPrivate: boolean;
  __v: number;
  themeConfig: unknown;
  widgets: WidgetPainel[];
}

interface Cru { data: Record<string, unknown> }

const enc = encodeURIComponent;

export interface ItemLista { id: string; titulo: string; isDefault: boolean; isFavorite: boolean; compartilhado: boolean }

/** A lista não traz `isPrivate` nem `__v`: isso só o detalhe tem. */
export async function listarPaineis(client: GhlClient, loc: string): Promise<ItemLista[]> {
  const r = await client.getJson<{ data: { dashboard?: Record<string, unknown>[]; sharedDashboards?: Record<string, unknown>[] } }>(
    `${BASE}/dashboards?locationId=${enc(loc)}`);
  const item = (compartilhado: boolean) => (d: Record<string, unknown>): ItemLista => ({
    id: d._id as string, titulo: d.title as string, isDefault: d.isDefault === true,
    isFavorite: d.isFavorite === true, compartilhado,
  });
  return [...(r.data.dashboard ?? []).map(item(false)), ...(r.data.sharedDashboards ?? []).map(item(true))];
}

/** O layout vem em `dashboardWidgets` e a definição em `widgets`; o par se faz pelo widgetId (ao vivo a definição o guarda em `_id`). */
export async function detalhePainel(client: GhlClient, loc: string, id: string): Promise<Painel> {
  const d = (await client.getJson<Cru>(`${BASE}/dashboards/${enc(id)}?locationId=${enc(loc)}`)).data;
  const p = d.dashboard as Record<string, unknown>;
  const defs = new Map(((d.widgets as (WidgetDef & { _id?: string })[]) ?? []).map((w) => [w.widgetId ?? w._id, w]));
  const widgets = ((d.dashboardWidgets as { widgetId: string; layout: LayoutWidget }[]) ?? []).map((dw) => {
    const def = defs.get(dw.widgetId) ?? null;
    return {
      widgetId: dw.widgetId,
      titulo: def?.title ?? null,
      chartType: def?.chartType ?? null,
      module: def?.module ?? null,
      layout: dw.layout,
      options: def?.options ?? null,
      apiConfig: def?.apiConfig ?? null,
      definicao: def,
    };
  });
  return {
    id: p._id as string, titulo: p.title as string, isDefault: p.isDefault as boolean,
    isPrivate: p.isPrivate as boolean, __v: p.__v as number, themeConfig: p.themeConfig, widgets,
  };
}

export async function catalogoWidgets(client: GhlClient, loc: string): Promise<unknown> {
  return (await client.getJson<Cru>(`${BASE}/dashboards/widgets-definitions?locationId=${enc(loc)}`)).data;
}

export async function versoesPainel(client: GhlClient, loc: string, id: string): Promise<unknown> {
  return (await client.getJson<Cru>(`${BASE}/dashboards/${enc(id)}/versions?locationId=${enc(loc)}`)).data;
}

/** O número que o painel mostra sai de um POST; o corpo é só `{chartType, options}`. */
export async function dadosWidget(
  client: GhlClient, loc: string, widget: { chartType: string; options: unknown; apiConfig: { path: string } },
): Promise<unknown> {
  const r = await client.postJson<Cru>(`${BASE}${widget.apiConfig.path}?locationId=${enc(loc)}`, {
    chartType: widget.chartType, options: widget.options,
  });
  return r.data;
}

/** Fuso IANA da subconta (ex.: America/Sao_Paulo). */
export async function fusoDaSubconta(client: GhlClient, loc: string): Promise<string> {
  const r = await client.getJson<{ location: { timezone: string } }>(
    `https://services.leadconnectorhq.com/locations/${enc(loc)}`);
  return r.location.timezone;
}
