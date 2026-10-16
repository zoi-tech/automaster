import type { Command } from "commander";
import {
  listarPaineis, detalhePainel, catalogoWidgets, versoesPainel, dadosWidget, fusoDaSubconta,
} from "../api/dashboards.js";
import { withClient } from "./shared.js";
import { emitir, falhar } from "../saida.js";

/**
 * As opções salvas no widget não valem como corpo: o app as materializa antes de pedir os números
 * (groupBy como objetos, a data do painel como filtro, o fuso). Aqui a janela é os últimos 30 dias.
 */
function materializar(options: unknown, timezone: string): unknown {
  const o = structuredClone(options) as Record<string, any>;
  const fim = Date.now();
  const janela = [fim - 30 * 86_400_000, fim];
  if (o.groupBy?.fields) {
    o.groupBy.fields = o.groupBy.fields.map((f: unknown) => (typeof f === "string" ? { field: f, type: "field" } : f));
  }
  o.filters = [{ group: "AND", filters: [{ field: o.dateProperty ?? "date_added", operator: "time_series", value: janela }, ...(o.filters ?? [])] }];
  o.timezone = timezone;
  return o;
}

async function runDashboards(opts: {
  location: string; o: string; id?: string; widget?: string; json?: boolean;
}): Promise<void> {
  const log = opts.json ? console.error : console.log;
  const op = opts.o;
  if (!["lista", "detalhe", "catalogo", "versoes", "dados", "fuso"].includes(op)) {
    throw new Error(`-o inválido: ${op}. Aceitos: lista, detalhe, catalogo, versoes, dados, fuso`);
  }
  if (["detalhe", "versoes", "dados"].includes(op) && !opts.id) throw new Error(`-o ${op} exige -i <id> do painel (falta o id)`);
  if (op === "dados" && !opts.widget) throw new Error("-o dados exige --widget <widgetId> (falta o widget)");
  await withClient(opts.location, log, async (client) => {
    const loc = opts.location;
    let saida: unknown;
    if (op === "lista") saida = await listarPaineis(client, loc);
    else if (op === "detalhe") saida = await detalhePainel(client, loc, opts.id!);
    else if (op === "catalogo") saida = await catalogoWidgets(client, loc);
    else if (op === "versoes") saida = await versoesPainel(client, loc, opts.id!);
    else if (op === "fuso") saida = await fusoDaSubconta(client, loc);
    else {
      const painel = await detalhePainel(client, loc, opts.id!);
      const w = painel.widgets.find((x) => x.widgetId === opts.widget);
      if (!w) throw new Error(`widget ${opts.widget} não está no painel ${opts.id}`);
      if (!w.definicao) throw new Error(`widget ${opts.widget} não tem definição no painel`);
      const fuso = await fusoDaSubconta(client, loc);
      saida = await dadosWidget(client, loc, { ...w.definicao, options: materializar(w.definicao.options, fuso) });
    }
    emitir(opts.json, saida);
  });
}

export function registrarDashboards(program: Command): void {
  program
    .command("dashboards")
    .description("Leitura ao vivo de painéis nativos do GHL, catálogo de widgets, dados e fuso da subconta")
    .requiredOption("-l, --location <id>", "locationId da subconta")
    .option("-o, --o <op>", "lista | detalhe | catalogo | versoes | dados | fuso", "lista")
    .option("-i, --id <id>", "id do painel (detalhe, versoes, dados)")
    .option("--widget <id>", "widgetId (com -o dados)")
    .option("--json", "imprime o resultado em JSON no stdout")
    .action((o) => runDashboards(o).catch(falhar));
}
