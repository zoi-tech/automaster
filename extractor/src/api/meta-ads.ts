/**
 * Graph API da Meta (insights de uma conta de anúncio). O token vem só do ambiente
 * (`AUTOMASTER_META_TOKEN`) e nunca é gravado: este módulo não toca em disco nem repete o token em motivo.
 */
export interface LinhaMeta { dia?: string; spend: number; impressions: number; clicks: number; leads: number }
export type ResultadoMeta = { ok: true; linhas: LinhaMeta[] } | { ok: false; motivo: string };

export function tokenMeta(env: Record<string, string | undefined> = process.env): string | null {
  return env.AUTOMASTER_META_TOKEN?.trim() || null;
}

/** AAAA-MM-DD do instante no fuso da subconta (en-CA formata assim). */
const diaLocal = (ms: number, fuso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: fuso }).format(new Date(ms));

export async function insightsMeta(
  o: { conta: string; token: string; inicio: number; fim: number; fuso: string; porDia?: boolean },
  fetchFn: typeof fetch = fetch,
): Promise<ResultadoMeta> {
  const conta = o.conta.startsWith("act_") ? o.conta : `act_${o.conta}`;
  const q = new URLSearchParams({
    fields: "spend,impressions,clicks,actions",
    time_range: JSON.stringify({ since: diaLocal(o.inicio, o.fuso), until: diaLocal(o.fim, o.fuso) }),
    access_token: o.token,
  });
  if (o.porDia) q.set("time_increment", "1");
  try {
    const r = await fetchFn(`https://graph.facebook.com/v21.0/${conta}/insights?${q}`);
    const corpo = (await r.json()) as {
      error?: { code?: number }; data?: { spend?: string; impressions?: string; clicks?: string; date_start?: string; actions?: { action_type: string; value: string }[] }[];
    };
    if (corpo.error?.code === 100 || corpo.error?.code === 200) return { ok: false, motivo: `token sem acesso à conta ${conta}` };
    if (!r.ok || corpo.error) return { ok: false, motivo: `Graph respondeu HTTP ${r.status} para ${conta}` };
    return {
      ok: true,
      linhas: (corpo.data ?? []).map((l) => ({
        ...(o.porDia ? { dia: l.date_start } : {}),
        spend: Number(l.spend ?? 0), impressions: Number(l.impressions ?? 0), clicks: Number(l.clicks ?? 0),
        leads: (l.actions ?? []).filter((a) => a.action_type === "lead").reduce((s, a) => s + Number(a.value), 0),
      })),
    };
  } catch {
    // a mensagem do erro de rede pode trazer a URL com o token: não repete
    return { ok: false, motivo: `falha de rede ao consultar o Graph para ${conta}` };
  }
}
