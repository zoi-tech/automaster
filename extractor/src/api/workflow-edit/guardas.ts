/**
 * O que se confere ANTES e DEPOIS de gravar: o diff, a conferência do que o servidor
 * aceitou, e as guardas de concorrência e de camada.
 */
import type { Step, Documento } from "./tipos.js";
import { porId, igual } from "./tipos.js";

export interface DiffWorkflow {
  nome?: { antes?: string; depois?: string };
  stepsAdicionados: { id: string; nome?: string; tipo?: string }[];
  stepsRemovidos: { id: string; nome?: string; tipo?: string }[];
  stepsAlterados: { id: string; nome?: string; tipo?: string; campos: string[] }[];
  triggersAdicionados: { id: string; nome?: string }[];
  triggersRemovidos: { id: string; nome?: string }[];
  triggersAlterados: { id: string; nome?: string }[];
  vazio: boolean;
}

/** Caminhos (com ponto) dos campos que diferem entre dois objetos. */
function camposDiferentes(a: any, b: any, prefixo = ""): string[] {
  if (igual(a, b)) return [];
  const obj = (v: unknown) => v && typeof v === "object" && !Array.isArray(v);
  // Array com os mesmos itens em outra ordem é o caso que mais confunde na leitura do
  // diff: aparecia como o campo inteiro alterado, sem dizer que nada entrou nem saiu.
  // Descer por índice diria menos ainda em lista grande (toda posição a partir da
  // primeira mudança conta como alterada), então o diff só marca a reordenação.
  if (Array.isArray(a) && Array.isArray(b)) {
    const ordenado = (v: unknown[]) => [...v].map((x) => JSON.stringify(x)).sort();
    if (igual(ordenado(a), ordenado(b))) return [`${prefixo || "(valor)"} (reordenado)`];
  }
  if (!obj(a) || !obj(b)) return [prefixo || "(valor)"];
  const chaves = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out: string[] = [];
  for (const k of chaves) out.push(...camposDiferentes(a[k], b[k], prefixo ? `${prefixo}.${k}` : k));
  return out;
}

const rotuloStep = (s: Step) => ({ id: s.id, nome: s.name, tipo: s.type });

export function diffWorkflow(antes: Documento, depois: Documento): DiffWorkflow {
  const a = porId(antes.workflowData?.templates ?? []);
  const d = porId(depois.workflowData?.templates ?? []);
  const stepsAdicionados = [...d.values()].filter((s) => !a.has(s.id)).map(rotuloStep);
  const stepsRemovidos = [...a.values()].filter((s) => !d.has(s.id)).map(rotuloStep);
  const stepsAlterados = [...d.values()]
    .filter((s) => a.has(s.id) && !igual(a.get(s.id), s))
    .map((s) => ({ ...rotuloStep(s), campos: camposDiferentes(a.get(s.id), s) }));

  const ta = new Map((antes.triggersData ?? []).map((t: any) => [t?.id, t]));
  const td = new Map((depois.triggersData ?? []).map((t: any) => [t?.id, t]));
  const rotuloTrigger = (t: any) => ({ id: t?.id, nome: t?.name });
  const triggersAdicionados = [...td.values()].filter((t: any) => !ta.has(t?.id)).map(rotuloTrigger);
  const triggersRemovidos = [...ta.values()].filter((t: any) => !td.has(t?.id)).map(rotuloTrigger);
  const triggersAlterados = [...td.values()]
    .filter((t: any) => ta.has(t?.id) && !igual(ta.get(t?.id), t))
    .map(rotuloTrigger);

  const nome = antes.name === depois.name ? undefined : { antes: antes.name, depois: depois.name };
  const vazio =
    !nome && !stepsAdicionados.length && !stepsRemovidos.length && !stepsAlterados.length &&
    !triggersAdicionados.length && !triggersRemovidos.length && !triggersAlterados.length;
  return {
    nome, stepsAdicionados, stepsRemovidos, stepsAlterados,
    triggersAdicionados, triggersRemovidos, triggersAlterados, vazio,
  };
}

/**
 * 200 não é prova nesta API: a rota irmã `only-triggers` responde 200, incrementa
 * `version` e não grava nada (prova ao vivo, §2.1b). Depois de gravar, o comando relê e
 * compara o que PEDIU (`editado`) com o que o servidor TEM (`depois`). Sobrou diferença,
 * a escrita é duvidosa — não sucesso.
 */
export function conferirEscrita(editado: Documento, depois: Documento): { ok: boolean; residual: DiffWorkflow } {
  const residual = diffWorkflow(editado, depois);
  return { ok: residual.vazio, residual };
}

/**
 * I1: a prévia e a gravação são DOIS processos — na tool MCP, com um Chrome subindo entre
 * elas e dezenas de segundos de janela. A guarda interna (`version` lida x meta) só enxerga
 * o que acontece dentro da segunda invocação. `--versao-esperada` carrega a `version` que a
 * prévia viu e aborta se o workflow mudou entre as duas.
 */
/**
 * Guarda de concorrência para as rotas de TRIGGER, onde `version` não serve.
 *
 * Prova ao vivo (segunda prova): apagar trigger NÃO incrementa o `version` do workflow.
 * Logo `--versao-esperada` não enxerga outra remoção de trigger na janela entre a prévia e
 * a gravação — dois processos, com um Chrome subindo no meio. A lista autoritativa de
 * triggers é o único contador que muda, então é ela que carrega a janela: a prévia devolve
 * os ids que viu, a gravação relê a lista e aborta se o conjunto mudou.
 */
/**
 * Recusa gravar pela camada CRUA (o `npm run workflow-editar`), que passa por fora das 18
 * regras de auditoria. Um aviso em stderr não segurava ninguém — some no meio do log —,
 * então passar por fora virou decisão explícita (`--sem-regras`). As portas com guarda
 * (tool MCP `workflow_editar`, `automaster-audit workflow-editar`) mandam a flag sozinhas.
 */
export function conferirCamadaCrua(o: { confirmo?: boolean; semRegras?: boolean; acao?: string }): void {
  if (!o.confirmo || o.acao === "historico") return;
  if (o.semRegras) {
    console.error(
      "aviso: gravação SEM validação contra as 18 regras — esta rota é a camada crua. " +
      "A guarda está em `automaster-audit workflow-editar` (auditor) e na tool MCP `workflow_editar`.",
    );
    return;
  }
  throw new Error(
    "esta é a camada CRUA: grava sem rodar as 18 regras de auditoria. Entre pela porta com guarda " +
    "(`automaster-audit workflow-editar` ou a tool MCP `workflow_editar`), ou repita com --sem-regras " +
    "para gravar por fora dela de propósito.",
  );
}

export function conferirTriggersEsperados(
  o: { triggersEsperados?: string }, agora: Array<{ id?: string } | null>,
): void {
  if (o.triggersEsperados === undefined) return;
  const esperado = o.triggersEsperados.split(",").map((s) => s.trim()).filter(Boolean).sort();
  const atual = agora.map((t) => t?.id).filter((x): x is string => !!x).sort();
  if (esperado.join(",") === atual.join(",")) return;
  throw new Error(
    `a lista de triggers mudou entre a prévia e a gravação (esperados ${esperado.join(", ") || "nenhum"}, ` +
    `agora ${atual.join(", ") || "nenhum"}). Apagar trigger não mexe no version, então esta é a única ` +
    "guarda deste caminho. Nada foi gravado: rode de novo para ver o estado atual.",
  );
}

export function conferirVersaoEsperada(o: { versaoEsperada?: string }, versaoAgora: number | undefined): void {
  if (o.versaoEsperada === undefined) return;
  if (String(versaoAgora) !== String(o.versaoEsperada)) {
    throw new Error(
      `o workflow mudou entre a prévia e a gravação (versão esperada ${o.versaoEsperada}, agora ${versaoAgora}). ` +
      "Nada foi gravado: rode a prévia de novo para ver o estado atual.",
    );
  }
}


// ---- steps do canvas (parte B) ----
