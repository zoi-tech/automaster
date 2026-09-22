import fs from "node:fs";
import path from "node:path";

/**
 * Confere a forma do dump recém-escrito contra o MESMO arquivo que o auditor usa para
 * carregá-lo (`auditor/src/automaster_audit/dump_schema.json`).
 *
 * O contrato entre as duas metades só existia em prosa: mudança de formato aqui só
 * aparecia lá adiante, quando uma regra quebrava. Conferir no fim da extração dá o aviso
 * onde a causa está. Se o schema não estiver ao alcance (extractor rodando fora do repo),
 * a checagem é pulada em vez de falhar — ela é uma rede, não um portão.
 */
export const SCHEMA_JSON = path.resolve(
  new URL("../..", import.meta.url).pathname, "..", "auditor", "src", "automaster_audit", "dump_schema.json",
);

interface Regra {
  campos?: Record<string, string>;
  opcionais?: Record<string, string>;
  facultativo?: boolean;
}

export interface Schema {
  schemaVersion: number;
  arquivos: Record<string, Regra>;
}

export function carregarSchema(arquivo = SCHEMA_JSON): Schema | undefined {
  try {
    return JSON.parse(fs.readFileSync(arquivo, "utf-8")) as Schema;
  } catch {
    return undefined;
  }
}

function tipoDe(v: unknown): string {
  if (Array.isArray(v)) return "array";
  if (v === null) return "null";
  return typeof v === "number" ? "number" : typeof v === "boolean" ? "boolean" : typeof v;
}

/** `raw.list_entry` desce um nível; devolve `undefined` quando o caminho não existe. */
function descer(doc: unknown, caminho: string): unknown {
  let atual = doc;
  for (const parte of caminho.split(".")) {
    if (typeof atual !== "object" || atual === null || !(parte in (atual as object))) return undefined;
    atual = (atual as Record<string, unknown>)[parte];
  }
  return atual;
}

function conferirDoc(doc: unknown, regra: Regra, rotulo: string): string[] {
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    return [`${rotulo}: esperado objeto, veio ${tipoDe(doc)}`];
  }
  const problemas: string[] = [];
  for (const [campos, obrigatorio] of [[regra.campos ?? {}, true], [regra.opcionais ?? {}, false]] as const) {
    for (const [caminho, tipo] of Object.entries(campos)) {
      const valor = descer(doc, caminho);
      if (valor === undefined) {
        if (obrigatorio) problemas.push(`${rotulo}: campo obrigatório ausente: ${caminho}`);
        continue;
      }
      const veio = tipoDe(valor);
      const bate = tipo === "object" ? veio === "object" : veio === tipo;
      if (!bate) problemas.push(`${rotulo}: ${caminho} deveria ser ${tipo}, veio ${veio}`);
    }
  }
  return problemas;
}

function conferirArquivo(arq: string, regra: Regra, rotulo: string): string[] {
  try {
    return conferirDoc(JSON.parse(fs.readFileSync(arq, "utf-8")), regra, rotulo);
  } catch (e) {
    return [`${rotulo}: não deu para ler (${e instanceof Error ? e.message : String(e)})`];
  }
}

/** Lista de problemas de forma; vazia = dump no contrato. Schema fora de alcance também devolve vazia. */
export function conferirDump(dir: string, arquivoSchema = SCHEMA_JSON): string[] {
  const schema = carregarSchema(arquivoSchema);
  if (!schema) return [];
  const problemas: string[] = [];
  for (const [nome, regra] of Object.entries(schema.arquivos)) {
    if (nome.endsWith("/*.json")) {
      const pasta = path.join(dir, nome.split("/")[0]);
      if (!fs.existsSync(pasta)) {
        problemas.push(`pasta ausente no dump: ${nome.split("/")[0]}/`);
        continue;
      }
      for (const f of fs.readdirSync(pasta).filter((f) => f.endsWith(".json")).sort()) {
        problemas.push(...conferirArquivo(path.join(pasta, f), regra, `${path.basename(pasta)}/${f}`));
      }
      continue;
    }
    const arq = path.join(dir, nome);
    if (!fs.existsSync(arq)) {
      if (!regra.facultativo) problemas.push(`arquivo ausente no dump: ${nome}`);
      continue;
    }
    problemas.push(...conferirArquivo(arq, regra, nome));
  }
  return problemas;
}
