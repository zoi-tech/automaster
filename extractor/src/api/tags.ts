import type { GhlClient } from "./client.js";
import { deuCerto } from "./annotations.js";

/**
 * CRUD de tag da SUBCONTA. Host `services.leadconnectorhq.com`.
 * Rotas em docs/endpoints.md, seção `## Notas, tarefas e tags da subconta`.
 *
 * Tag do CONTATO (pôr e tirar tag de uma pessoa) é outra coisa, em `api/contacts.ts`.
 *
 * O que torna esta área segura: renomear propaga. Workflow guarda o NOME da tag, nunca o id
 * — em step, em trigger e em condição — mas o servidor reescreve a referência nos três
 * lugares quando o nome muda. Provado ao vivo em 2026-09-21. Sem isso, renomear quebraria
 * em silêncio todo workflow que cita a tag.
 */
const BASE = "https://services.leadconnectorhq.com";

export interface Tag {
  id: string;
  name: string;
}

/** A resposta mistura `id` e `_id` conforme a rota; aqui sai sempre `id`. */
const normalizar = (t: Record<string, any>): Tag => ({ id: t.id ?? t._id, name: t.name });

export async function listarTags(client: GhlClient, loc: string): Promise<Tag[]> {
  const qs = new URLSearchParams({ skip: "0", limit: "10000", query: "", getCount: "true" });
  const r = await client.getJson<{ tags?: Record<string, any>[] }>(
    `${BASE}/locations/${loc}/tags/search?${qs}`,
  );
  return (r?.tags ?? []).map(normalizar);
}

/** Responde 200, não 201. Devolve também `categoryId`/`description`/`color`, que aqui se ignoram. */
export async function criarTag(client: GhlClient, loc: string, name: string): Promise<Tag> {
  const r = await client.postJson<{ tag?: Record<string, any> }>(`${BASE}/locations/${loc}/tags`, { name });
  return normalizar(r?.tag ?? {});
}

export async function renomearTag(
  client: GhlClient, loc: string, tagId: string, name: string,
): Promise<Tag> {
  const r = await client.putJson<{ tag?: Record<string, any> }>(
    `${BASE}/locations/${loc}/tags/${tagId}`, { name },
  );
  return normalizar(r?.tag ?? {});
}

/**
 * Apaga a tag da subconta, o que a arranca de todos os contatos que a têm. Se isso dispara os
 * workflows com trigger de "tag removida" NÃO há prova — a guarda está na CLI, não aqui.
 */
export async function apagarTag(client: GhlClient, loc: string, tagId: string): Promise<boolean> {
  return deuCerto(await client.deleteJson(`${BASE}/locations/${loc}/tags/${tagId}`));
}

/** Aceita o id ou o nome. Nome casa sem ligar para maiúscula nem espaço nas pontas. */
export function acharTag(tags: Tag[], nomeOuId: string): Tag | undefined {
  const alvo = nomeOuId.trim().toLowerCase();
  return tags.find((t) => t.id === nomeOuId) ?? tags.find((t) => t.name.trim().toLowerCase() === alvo);
}
