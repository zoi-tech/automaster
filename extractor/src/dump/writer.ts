import fs from "node:fs/promises";
import path from "node:path";
import type { FullWorkflow } from "../api/workflows.js";

export const SCHEMA_VERSION = 1;

export interface Manifest {
  schemaVersion: number;
  locationId: string;
  locationName?: string;
  extractedAt: string;
  extractorVersion: string;
  counts: Record<string, number>;
  warnings: string[];
}

/** Pasta timestampada do dump: dumps/<loc>/<YYYY-MM-DD_HHmm>/ */
export function dumpDir(baseDir: string, locationId: string, timestamp: string): string {
  return path.join(baseDir, locationId, timestamp);
}

/** Timestamp `YYYY-MM-DD_HHmm` a partir de uma Date. */
export function stampNow(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}`;
}

async function writeJson(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf-8");
}

export class DumpWriter {
  readonly dir: string;
  private warnings: string[] = [];
  constructor(baseDir: string, private locationId: string, timestamp: string) {
    this.dir = dumpDir(baseDir, locationId, timestamp);
  }

  warn(msg: string): void {
    this.warnings.push(msg);
  }

  async writeWorkflow(full: FullWorkflow): Promise<void> {
    const e = full.list_entry;
    await writeJson(path.join(this.dir, "workflows", `${e.id}.json`), {
      id: e.id,
      name: e.name,
      status: e.status,
      fetchedAt: new Date().toISOString(),
      raw: {
        list_entry: full.list_entry,
        detail: full.detail,
        steps: full.steps,
        triggers: full.triggers,
      },
    });
  }

  /** Entidade no envelope {fetchedAt, raw: <resposta API intocada>}. */
  async writeEntity(
    name: "pipelines" | "tags" | "custom_fields" | "users" | "calendars" | "custom_values",
    raw: unknown,
  ): Promise<void> {
    await writeJson(path.join(this.dir, `${name}.json`), { fetchedAt: new Date().toISOString(), raw });
  }

  async writeManifest(counts: Record<string, number>, locationName?: string): Promise<void> {
    const manifest: Manifest = {
      schemaVersion: SCHEMA_VERSION,
      locationId: this.locationId,
      locationName,
      extractedAt: new Date().toISOString(),
      extractorVersion: "0.1.0",
      counts,
      warnings: this.warnings,
    };
    await writeJson(path.join(this.dir, "manifest.json"), manifest);
  }
}
