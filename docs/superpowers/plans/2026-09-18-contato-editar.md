# Contato editar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tool MCP `editar` que altera campos e tags de um contato GHL pela API interna, com snapshot em disco antes de escrever.

**Architecture:** O extractor (TypeScript/Playwright) ganha o comando `contato-editar`, que reusa sessão Chrome, tokens e `GhlClient` (agora com PUT/POST/DELETE), resolve nomes pelo dump mais recente, grava snapshot em `<dumps>/_contatos/<loc>/<id>/` e imprime JSON. O auditor (Python) ganha a tool `editar`, que chama o comando por subprocess (via `_run_extractor`, generalização de `_run_timeline`) e anexa `dispara` usando o `TriggerIndex` de `journey.py`.

**Tech Stack:** TypeScript + Playwright + commander (extractor); Python 3.12 + pytest (auditor). Sem dependência nova.

**Spec:** `docs/superpowers/specs/2026-09-18-contato-editar-design.md` (leia; tem `## Decisões do grill`). Endpoints: `docs/endpoints.md`.

## Global Constraints

- `raw` de qualquer resposta da API vai para disco **intocado**.
- Tokens nunca vão para disco nem para stdout.
- Chamada ao Firebase (`fileUrl`) nunca leva auth; não se aplica aqui, mas o `request()` novo não pode mudar `getJsonNoAuth`.
- Tag sempre pelo endpoint granular (POST/DELETE), nunca dentro do PUT de campos.
- Snapshot antes da escrita; falha no snapshot aborta sem escrever.
- Nome de tool: uma palavra (`editar`). Erros são `ToolError` com texto que ensina o próximo passo.
- Nada de escrita real fora da Task 9; testes usam mocks. Subconta de validação: `Xb9gDxwxYhdqtprGcb5E` (Instaltech), num contato de teste criado para isso.
- Comandos: extractor em `extractor/` (`npx tsc --noEmit`); auditor em `auditor/` (`.venv/bin/python -m pytest -q`, hoje 129 testes).
- Commits terminam com as duas linhas de atribuição da sessão.

---

### Task 1: `discover` observa contatos e imprime o corpo das escritas

**Files:**
- Modify: `extractor/src/cli.ts:79-97` (`runDiscover`) e o registro do comando em `:257-260`

**Interfaces:**
- Produces: `npm run discover -- -l <loc> --area contatos` abre a lista de contatos e loga `METHOD URL` + corpo de todo request não-GET a `leadconnectorhq.com`.

- [ ] **Step 1: Alterar `runDiscover`**

```ts
async function runDiscover(opts: { location: string; area: string }): Promise<void> {
  const { context, page } = await openSession();
  const rota = opts.area === "contatos" ? "contacts/smart_list/All" : "automation/workflows";
  console.log(
    `Modo discover: navegue manualmente pela aba ${opts.area} da subconta ${opts.location}.\n` +
      "Os requests ao backend serão observados; escritas (não-GET) mostram o corpo. (Ver docs/endpoints.md.)\n" +
      "Feche a janela do Chrome para encerrar.",
  );
  page.on("request", (req) => {
    const url = req.url();
    if (!url.includes("leadconnectorhq.com") || url.includes("google-analytics")) return;
    console.log(`${req.method()} ${url}`);
    if (req.method() !== "GET") {
      const h = req.headers();
      console.log(`  headers: token-id=${h["token-id"] ? "sim" : "não"} authorization=${h["authorization"] ? "sim" : "não"} version=${h["version"] ?? "-"} channel=${h["channel"] ?? "-"} source=${h["source"] ?? "-"}`);
      console.log(`  body: ${(req.postData() ?? "").slice(0, 2000)}`);
    }
  });
  page.on("response", async (res) => {
    const req = res.request();
    if (req.method() === "GET" || !res.url().includes("leadconnectorhq.com")) return;
    console.log(`  ← ${res.status()} ${(await res.text().catch(() => "")).slice(0, 500)}`);
  });
  await page.goto(`https://app.gohighlevel.com/v2/location/${opts.location}/${rota}`, { waitUntil: "domcontentloaded" });
  await page.waitForEvent("close", { timeout: 0 }).catch(() => {});
  await context.close();
}
```

E no registro do comando:

```ts
  .option("--area <area>", "workflows | contatos", "workflows")
```

- [ ] **Step 2: Typecheck**

Run: `cd extractor && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add extractor/src/cli.ts
git commit -m "feat(extractor): discover --area contatos mostra corpo e headers das escritas"
```

### Task 2: Etapa zero — mapear os endpoints de escrita de contato

**Files:**
- Modify: `docs/endpoints.md` (nova seção `## Escrita`)

**Interfaces:**
- Produces: em `docs/endpoints.md`, para cada operação (GET contato inteiro, PUT campos, adicionar tag, remover tag): host, método, rota, quais headers/tokens foram enviados, corpo observado, resposta observada. Mais os headers de escrita dos scripts soltos (`content-type: application/json`; PUT de workflow manda `version` e `dataVersion` do GET anterior).

- [ ] **Step 1: Rodar o discover na Instaltech**

Run: `cd extractor && npm run discover -- -l Xb9gDxwxYhdqtprGcb5E --area contatos`

No Chrome: criar um contato de teste "Automaster Teste" (anote o id da URL), depois, um de cada vez: mudar o telefone; mudar um custom field de texto; adicionar a tag `teste-automaster` (crie se não existir); remover essa tag. Copie do terminal os blocos `PUT`/`POST`/`DELETE` correspondentes e o GET que a página faz ao abrir o contato.

- [ ] **Step 2: Se o endpoint recusar os tokens do browser** (só acontece ao replicar na Task 5/6, mas prepare aqui)

Ordem de variações a esgotar antes do plano B da spec: host `services` ↔ `backend`; só `authorization`, só `token-id`, os dois; com/sem `channel`/`source`/`version`. Anote no doc o que funcionou.

- [ ] **Step 3: Escrever a seção**

```markdown
## Escrita — validado 2026-09-XX

Headers comuns de escrita (dos scripts soltos, PUT de workflow): os mesmos de leitura +
`content-type: application/json`. PUT de workflow exige `version` e `dataVersion` do GET
anterior (concorrência otimista).

### Contato inteiro (snapshot)
- `GET <host>/contacts/<contactId>` — headers: <observado>. Resposta: `{ contact: {...} }` <ajustar>.

### Campos do contato
- `PUT <host>/contacts/<contactId>` — corpo observado: `{ ... }`. Custom field vai como
  `customFields: [{ id, field_value }]` <ajustar ao observado>. Resposta: <observado>.

### Tags
- adicionar: `<METHOD> <host>/contacts/<contactId>/tags` corpo `{ tags: [...] }` <ajustar>
- remover: `<METHOD> ...` <ajustar>
- ⚠️ `tags` dentro do PUT de campos sobrescreve a lista inteira (comportamento do público;
  confirmar/negar na interna).
```

Substitua todo `<ajustar>`/`<observado>` pelo que o terminal mostrou. Nada fica em aberto.

- [ ] **Step 4: Commit**

```bash
git add docs/endpoints.md
git commit -m "docs(endpoints): escrita de contato mapeada (campos, tags, snapshot)"
```

### Task 3: `GhlClient` ganha PUT/POST/DELETE com o mesmo retry

**Files:**
- Modify: `extractor/src/api/client.ts:37-58`

**Interfaces:**
- Produces: `getJson<T>(url)`, `putJson<T>(url, body)`, `postJson<T>(url, body)`, `deleteJson<T>(url, body?)`, todos `Promise<T>`, com recaptura em 401 e backoff em 429. `getJsonNoAuth` inalterado.

- [ ] **Step 1: Substituir `getJson` por `request` + quatro linhas**

```ts
  /** Chamada autenticada com JSON. Trata 401 (refresh 1x) e 429 (backoff). */
  private async request<T>(method: "get" | "put" | "post" | "delete", url: string, body?: unknown): Promise<T> {
    await sleep(this.throttleMs);
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      const headers = body === undefined ? this.authHeaders() : { ...this.authHeaders(), "content-type": "application/json" };
      const res = await this.context.request[method](url, { headers, data: body });
      if (res.ok()) return (await res.json().catch(() => ({}))) as T;

      const status = res.status();
      if (status === 401 && !refreshed) {
        this.tokens = await this.onRefresh();
        refreshed = true;
        continue;
      }
      if (status === 429 && attempt < 4) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      throw new Error(`${method.toUpperCase()} ${url} → HTTP ${status} ${await safeBody(res)}`);
    }
  }

  getJson<T = unknown>(url: string): Promise<T> { return this.request<T>("get", url); }
  putJson<T = unknown>(url: string, body: unknown): Promise<T> { return this.request<T>("put", url, body); }
  postJson<T = unknown>(url: string, body: unknown): Promise<T> { return this.request<T>("post", url, body); }
  deleteJson<T = unknown>(url: string, body?: unknown): Promise<T> { return this.request<T>("delete", url, body); }
```

`res.json().catch(() => ({}))`: escrita pode devolver corpo vazio com 200.

- [ ] **Step 2: Typecheck**

Run: `cd extractor && npx tsc --noEmit`
Expected: sem erros. Se `this.context.request[method]` reclamar de tipo, use `const call = this.context.request[method].bind(this.context.request)`.

- [ ] **Step 3: Commit**

```bash
git add extractor/src/api/client.ts
git commit -m "refactor(extractor): GhlClient.request unifica retry; put/post/delete"
```

### Task 4: `withClient` e `latestDumpEntity` no CLI

**Files:**
- Modify: `extractor/src/cli.ts:31-44` (bloco de `runExtract`), `:99-155` (três `*FromLatestDump`), `:207-218` (bloco de `runTimeline`)

**Interfaces:**
- Produces:
  - `withClient(locationId, log, fn: (client: GhlClient, page: Page) => Promise<void>)`: abre sessão, captura tokens, monta o client com refresh, roda `fn`, fecha o contexto no `finally`.
  - `latestDumpEntity(locationId, name: "pipelines"|"tags"|"custom_fields"|"users"|"calendars"|"custom_values"): unknown | undefined` — `raw` do arquivo `<name>.json` do snapshot mais recente **com `manifest.json`**; `undefined` se não houver.
  - `latestDumpDir(locationId): string | undefined`.

- [ ] **Step 1: Adicionar os helpers logo após `DUMPS_DIR`**

```ts
/** Snapshot mais recente da subconta: só pastas com manifest.json contam. */
function latestDumpDir(locationId: string): string | undefined {
  try {
    const base = path.join(DUMPS_DIR, locationId);
    const snaps = fs.readdirSync(base).filter((d) => fs.existsSync(path.join(base, d, "manifest.json"))).sort();
    const latest = snaps.at(-1);
    return latest ? path.join(base, latest) : undefined;
  } catch {
    return undefined;
  }
}

/** `raw` de uma entidade do dump mais recente; undefined sem dump ou sem o arquivo. */
function latestDumpEntity(locationId: string, name: string): unknown {
  const dir = latestDumpDir(locationId);
  if (!dir) return undefined;
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), "utf-8"))?.raw;
  } catch {
    return undefined;
  }
}

/** Sessão + tokens + client, com refresh em 401; fecha o Chrome ao sair. */
async function withClient(
  locationId: string,
  log: (msg: string) => void,
  fn: (client: GhlClient, page: Page) => Promise<void>,
): Promise<void> {
  const { context, page } = await openSession();
  try {
    log("Capturando tokens (faça login na janela do Chrome, se pedido)...");
    let tokens = await captureTokens(page, locationId);
    const refresh = async (): Promise<Tokens> => {
      log("401 — recapturando tokens...");
      await page.reload({ waitUntil: "domcontentloaded" });
      tokens = await captureTokens(page, locationId);
      return tokens;
    };
    await fn(new GhlClient(context, tokens, refresh), page);
  } finally {
    await context.close();
  }
}
```

Importe `type Page` de `playwright`.

- [ ] **Step 2: Reescrever as três funções de nome sobre `latestDumpEntity`/`latestDumpDir`**

```ts
function workflowNamesFromLatestDump(locationId: string): Map<string, string> {
  const names = new Map<string, string>();
  const dir = latestDumpDir(locationId);
  if (!dir) return names;
  try {
    const wfDir = path.join(dir, "workflows");
    for (const f of fs.readdirSync(wfDir)) {
      const wf = JSON.parse(fs.readFileSync(path.join(wfDir, f), "utf-8"));
      if (wf.id && wf.name) names.set(wf.id, wf.name);
    }
  } catch { /* sem dump local — timeline mostra o id cru */ }
  return names;
}

function stageNamesFromLatestDump(locationId: string): { pipelines: Map<string, string>; stages: Map<string, string> } {
  const pipelines = new Map<string, string>();
  const stages = new Map<string, string>();
  const raw = latestDumpEntity(locationId, "pipelines") as { pipelines?: any[] } | undefined;
  for (const p of raw?.pipelines ?? []) {
    if (p.id && p.name) pipelines.set(p.id, p.name);
    for (const s of p.stages ?? []) if (s.id && s.name) stages.set(s.id, s.name);
  }
  return { pipelines, stages };
}

function userNamesFromLatestDump(locationId: string): Map<string, string> {
  const names = new Map<string, string>();
  const raw = latestDumpEntity(locationId, "users") as { users?: any[] } | undefined;
  for (const u of raw?.users ?? []) {
    const name = u.name || [u.firstName, u.lastName].filter(Boolean).join(" ");
    if (u.id && name) names.set(u.id, name);
  }
  return names;
}
```

- [ ] **Step 3: `runExtract` e `runTimeline` passam a usar `withClient`**

Em `runExtract`, o corpo vira `await withClient(locationId, console.log, async (client, page) => { ...tudo que hoje vem depois de `const client = ...`, sem o `try/finally` externo... })`. Atenção: `runExtract` hoje espera a janela fechar (`page.waitForEvent("close")`) antes de fechar o contexto; mantenha isso dentro do `fn`. Em `runTimeline`, o mesmo com `log` no lugar de `console.log`.

- [ ] **Step 4: Typecheck e prova manual do timeline**

Run: `cd extractor && npx tsc --noEmit && npm run timeline -- -l Xb9gDxwxYhdqtprGcb5E -i <id do contato de teste da Task 2> --json | tail -c 300`
Expected: typecheck limpo; JSON com `events` no stdout.

- [ ] **Step 5: Commit**

```bash
git add extractor/src/cli.ts
git commit -m "refactor(extractor): withClient e latestDumpEntity (exige manifest.json)"
```

### Task 5: Módulo `contacts.ts` da API

**Files:**
- Create: `extractor/src/api/contacts.ts`

**Interfaces:**
- Produces:
  - `getContact(client, loc, id): Promise<unknown>` — resposta intocada do GET da Task 2.
  - `updateContactFields(client, loc, id, body: Record<string, unknown>): Promise<unknown>`.
  - `addContactTags(client, loc, id, tags: string[]): Promise<unknown>`.
  - `removeContactTags(client, loc, id, tags: string[]): Promise<unknown>`.

- [ ] **Step 1: Escrever o módulo com as rotas da Task 2**

As URLs abaixo são o espelho do público; **troque pelas rotas, métodos e corpos anotados em `docs/endpoints.md` "Escrita"**. Se a Task 2 mostrou que remover tag é `DELETE` com corpo, use `client.deleteJson(url, { tags })`; se for `POST .../tags/remove`, `postJson`.

```ts
import type { GhlClient } from "./client.js";

const SERVICES = "https://services.leadconnectorhq.com";

export function getContact(client: GhlClient, loc: string, id: string): Promise<unknown> {
  return client.getJson(`${SERVICES}/contacts/${id}?locationId=${loc}`);
}

export function updateContactFields(client: GhlClient, loc: string, id: string, body: Record<string, unknown>): Promise<unknown> {
  return client.putJson(`${SERVICES}/contacts/${id}`, { locationId: loc, ...body });
}

export function addContactTags(client: GhlClient, loc: string, id: string, tags: string[]): Promise<unknown> {
  return client.postJson(`${SERVICES}/contacts/${id}/tags`, { tags });
}

export function removeContactTags(client: GhlClient, loc: string, id: string, tags: string[]): Promise<unknown> {
  return client.deleteJson(`${SERVICES}/contacts/${id}/tags`, { tags });
}
```

- [ ] **Step 2: Typecheck**

Run: `cd extractor && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add extractor/src/api/contacts.ts
git commit -m "feat(extractor): api/contacts — GET, PUT campos, tags granulares"
```

### Task 6: Comando `contato-editar`

**Files:**
- Modify: `extractor/src/cli.ts` (nova função `runContatoEditar` + registro), `extractor/package.json:9-15`

**Interfaces:**
- Consumes: `withClient`, `latestDumpEntity` (Task 4); `contacts.ts` (Task 5).
- Produces: `tsx src/cli.ts contato-editar -l <loc> -i <id> [--set nome=valor]... [--tag +x]... [--tag -y]... --json`. Stdout: uma linha JSON `{locationId, id, snapshot, antes, depois, mudancas: {set: {<id>: valor}, tagsAdicionadas: [], tagsRemovidas: []}}`. Stderr: progresso e, **antes do PUT**, a linha `snapshot: <caminho>`. Exit 1 com mensagem em stderr em qualquer erro.

- [ ] **Step 1: Resolução de nomes (função pura, exportada para inspeção)**

```ts
/** nome ou id → id de custom field (a lista do dump mistura padrão e custom). */
export function resolveFieldIds(fields: { id: string; name?: string; fieldKey?: string }[], wanted: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const w of wanted) {
    const key = w.trim().toLowerCase();
    const hits = fields.filter((f) => f.id === w || f.name?.toLowerCase() === key || f.fieldKey?.toLowerCase() === key
      || f.fieldKey?.toLowerCase().replace(/^contact\./, "") === key);
    if (hits.length === 0) throw new Error(`campo ${w!r} não existe no dump; confira em inventario(fatia=fields) ou passe o id`);
    if (new Set(hits.map((h) => h.id)).size > 1) throw new Error(`campo ${w!r} é ambíguo: ${hits.map((h) => h.id).join(", ")}; passe o id`);
    out.set(w, hits[0].id);
  }
  return out;
}
```

(Escreva `${JSON.stringify(w)}` no lugar de `${w!r}`.) Tags: mesma ideia, por `name` case-insensitive na lista `raw.tags`; inexistente é erro "tag X não existe; a tool não cria tags".

- [ ] **Step 2: `runContatoEditar`**

```ts
async function runContatoEditar(opts: { location: string; id: string; set: string[]; tag: string[]; json?: boolean }): Promise<void> {
  const loc = opts.location, id = opts.id;
  const log = opts.json ? console.error : console.log;
  const fieldsRaw = latestDumpEntity(loc, "custom_fields") as { customFields?: any[] } | undefined;
  const tagsRaw = latestDumpEntity(loc, "tags") as { tags?: any[] } | undefined;
  if (!fieldsRaw || !tagsRaw) throw new Error(`sem dump de ${loc} em ${DUMPS_DIR}; rode extract primeiro`);

  const sets = opts.set.map((s) => { const i = s.indexOf("="); if (i < 1) throw new Error(`--set espera nome=valor, veio ${JSON.stringify(s)}`); return [s.slice(0, i), s.slice(i + 1)] as const; });
  const fieldIds = resolveFieldIds(fieldsRaw.customFields ?? [], sets.map(([n]) => n));
  const tagNames = new Map((tagsRaw.tags ?? []).map((t: any) => [String(t.name).toLowerCase(), String(t.name)]));
  const resolveTag = (t: string) => { const n = tagNames.get(t.trim().toLowerCase()); if (!n) throw new Error(`tag ${JSON.stringify(t)} não existe; a tool não cria tags`); return n; };
  const tagsAdd = opts.tag.filter((t) => t.startsWith("+")).map((t) => resolveTag(t.slice(1)));
  const tagsDel = opts.tag.filter((t) => t.startsWith("-")).map((t) => resolveTag(t.slice(1)));
  if (sets.length + tagsAdd.length + tagsDel.length === 0) throw new Error("nada a fazer: passe --set e/ou --tag");

  await withClient(loc, log, async (client) => {
    const antes = await getContact(client, loc, id);
    const snapDir = path.join(DUMPS_DIR, "_contatos", loc, id);
    fs.mkdirSync(snapDir, { recursive: true });
    const snapPath = path.join(snapDir, `${stampNow()}${new Date().getSeconds().toString().padStart(2, "0")}.json`);
    const snap: any = { fetchedAt: new Date().toISOString(), pedido: { set: Object.fromEntries(sets), tagsAdd, tagsDel }, raw: antes, escrito: false, aplicado: [] as string[] };
    fs.writeFileSync(snapPath, JSON.stringify(snap, null, 2));
    log(`snapshot: ${snapPath}`);

    const marca = (o: string) => { snap.escrito = true; snap.aplicado.push(o); fs.writeFileSync(snapPath, JSON.stringify(snap, null, 2)); };
    if (sets.length) {
      const body = buildFieldsBody(sets, fieldIds, fieldsRaw.customFields ?? []);  // ver Step 3
      await updateContactFields(client, loc, id, body); marca("set");
    }
    if (tagsAdd.length) { await addContactTags(client, loc, id, tagsAdd); marca("tagsAdd"); }
    if (tagsDel.length) { await removeContactTags(client, loc, id, tagsDel); marca("tagsDel"); }

    const depois = await getContact(client, loc, id);
    const out = { locationId: loc, id, snapshot: snapPath, antes, depois,
      mudancas: { set: Object.fromEntries(sets.map(([n, v]) => [fieldIds.get(n), v])), tagsAdicionadas: tagsAdd, tagsRemovidas: tagsDel } };
    if (opts.json) process.stdout.write(JSON.stringify(out) + "\n");
    else log(`ok: ${sets.length} campo(s), +${tagsAdd.length}/-${tagsDel.length} tag(s). snapshot em ${snapPath}`);
  });
}
```

- [ ] **Step 3: `buildFieldsBody` conforme a Task 2**

Campo com `dataType: STANDARD_FIELD` entra no corpo pelo nome padrão que o app usa (o `fieldKey` sem o prefixo `contact.`, ex.: `phone`, `email`, `firstName`); custom field entra em `customFields` no formato observado. Escreva exatamente o que `docs/endpoints.md` "Escrita" mostra; o esqueleto:

```ts
function buildFieldsBody(sets: readonly (readonly [string, string])[], ids: Map<string, string>, fields: any[]): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const custom: unknown[] = [];
  for (const [name, value] of sets) {
    const f = fields.find((x) => x.id === ids.get(name));
    if (f?.dataType === "STANDARD_FIELD") body[String(f.fieldKey).replace(/^contact\./, "")] = value;
    else custom.push({ id: ids.get(name), field_value: value });  // ajustar chave ao observado na Task 2
  }
  if (custom.length) body.customFields = custom;
  return body;
}
```

- [ ] **Step 4: Registrar o comando e o script npm**

```ts
program
  .command("contato-editar")
  .description("ESCREVE: altera campos/tags de um contato via API interna, com snapshot antes")
  .requiredOption("-l, --location <id>", "locationId da subconta")
  .requiredOption("-i, --id <id>", "id do contato")
  .option("--set <nome=valor>", "campo (nome, fieldKey ou id) = valor; repetível", (v: string, acc: string[]) => [...acc, v], [])
  .option("--tag <+nome|-nome>", "adiciona (+) ou remove (-) tag; repetível", (v: string, acc: string[]) => [...acc, v], [])
  .option("--json", "imprime o resultado em JSON no stdout")
  .action((o) => runContatoEditar(o).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); }));
```

`package.json`: `"contato-editar": "tsx src/cli.ts contato-editar"`.

- [ ] **Step 5: Typecheck e prova de erro sem tocar no GHL**

Run: `cd extractor && npx tsc --noEmit && npm run contato-editar -- -l Xb9gDxwxYhdqtprGcb5E -i x --set nao_existe=1 --json; echo "exit=$?"`
Expected: typecheck limpo; a segunda linha imprime `campo "nao_existe" não existe no dump...` e `exit=1` **sem abrir o Chrome** (a resolução vem antes do `withClient`).

- [ ] **Step 6: Commit**

```bash
git add extractor/src/cli.ts extractor/package.json
git commit -m "feat(extractor): contato-editar — campos e tags com snapshot prévio"
```

### Task 7: `_run_extractor` no auditor, com teste próprio

**Files:**
- Modify: `auditor/src/automaster_audit/mcp_server.py:217-231`
- Test: `auditor/tests/test_mcp_tools.py`

**Interfaces:**
- Produces: `_run_extractor(*args: str) -> dict` (roda `tsx src/cli.ts <args...>`, devolve a última linha do stdout como JSON; `ToolError` ensina provisionamento e, em falha, inclui os últimos 600 chars do stderr). `_run_timeline(loc, id, days)` continua existindo como uma linha sobre ele (os testes de `contato` mockam `_run_timeline`).

- [ ] **Step 1: Testes**

```python
def test_run_extractor_builds_cmd_and_parses_last_line(monkeypatch, tmp_path):
    tsx = tmp_path / "node_modules" / ".bin" / "tsx"
    tsx.parent.mkdir(parents=True); tsx.write_text("")
    monkeypatch.setattr(srv, "EXTRACTOR_DIR", tmp_path)
    seen = {}
    def fake_run(cmd, **kw):
        seen["cmd"] = cmd; seen["env"] = kw["env"]
        return subprocess.CompletedProcess(cmd, 0, stdout='ruído\n{"ok": 1}\n', stderr="")
    monkeypatch.setattr(srv.subprocess, "run", fake_run)
    assert srv._run_extractor("contato-editar", "-l", "L", "--json") == {"ok": 1}
    assert seen["cmd"][1:] == ["src/cli.ts", "contato-editar", "-l", "L", "--json"]
    assert seen["env"]["AUTOMASTER_DUMPS"]


def test_run_extractor_failure_carries_stderr(monkeypatch, tmp_path):
    tsx = tmp_path / "node_modules" / ".bin" / "tsx"
    tsx.parent.mkdir(parents=True); tsx.write_text("")
    monkeypatch.setattr(srv, "EXTRACTOR_DIR", tmp_path)
    monkeypatch.setattr(srv.subprocess, "run", lambda cmd, **kw: subprocess.CompletedProcess(cmd, 1, stdout="", stderr="snapshot: /x/y.json\nHTTP 403"))
    with pytest.raises(srv.ToolError, match="snapshot: /x/y.json"):
        srv._run_extractor("contato-editar")
```

Adicione `import subprocess` no topo do teste.

- [ ] **Step 2: Rodar para ver falhar**

Run: `cd auditor && .venv/bin/python -m pytest tests/test_mcp_tools.py -k run_extractor -q`
Expected: 2 failed (`_run_extractor` não existe).

- [ ] **Step 3: Implementar**

```python
def _run_extractor(*args: str) -> dict:
    """Roda `tsx src/cli.ts <args>` no extractor (abre Chrome; espera segundos). Só a última linha do stdout é JSON."""
    tsx = EXTRACTOR_DIR / "node_modules" / ".bin" / "tsx"
    if not tsx.is_file():
        raise ToolError("extractor não provisionado: rode /automaster-extract uma vez "
                        f"(npm ci + npx playwright install chromium em {EXTRACTOR_DIR})")
    # o processo MCP pode vir com PATH magro (app GUI): node do Homebrew e do nvm entram aqui
    extra = [str(p) for p in ("/opt/homebrew/bin", "/usr/local/bin", *Path.home().glob(".nvm/versions/node/*/bin"))]
    env = {**os.environ, "AUTOMASTER_DUMPS": str(_root()),
           "PATH": os.pathsep.join([os.environ.get("PATH", ""), *extra])}
    cmd = [str(tsx), "src/cli.ts", *args]
    r = subprocess.run(cmd, cwd=EXTRACTOR_DIR, capture_output=True, text=True, timeout=600, env=env)
    if r.returncode != 0 or not r.stdout.strip():
        raise ToolError(f"{args[0]} falhou (código {r.returncode}): {r.stderr.strip()[-600:]}")
    return json.loads(r.stdout.strip().splitlines()[-1])


def _run_timeline(loc: str, id: str, days: int) -> dict:
    return _run_extractor("timeline", "-l", loc, "-i", id, "-d", str(days), "--json")
```

- [ ] **Step 4: Rodar tudo**

Run: `cd auditor && .venv/bin/python -m pytest -q`
Expected: 131 passed.

- [ ] **Step 5: Commit**

```bash
git add auditor/src/automaster_audit/mcp_server.py auditor/tests/test_mcp_tools.py
git commit -m "refactor(mcp): _run_extractor generaliza a chamada ao extractor"
```

### Task 8: Tool `editar` com `dispara`

**Files:**
- Modify: `auditor/src/automaster_audit/mcp_server.py` (função `editar`, entrada em `TOOLS`), `skills/automaster-leitura/SKILL.md:3,24`, `CLAUDE.md` (sete tools → oito)
- Test: `auditor/tests/test_mcp_tools.py`

**Interfaces:**
- Consumes: `_run_extractor` (Task 7); `journey.TriggerIndex(ctx)` com `for_tag(tag)` e `for_field_change()` (cada item tem `workflow_id`? confira o dict montado em `journey.py:75-83` e use as chaves reais: o teste abaixo assume `{"workflow": <id>, "name": ...}`; ajuste o teste às chaves existentes, não o contrário).
- Produces: `editar(loc, id, set: dict | None = None, tags_adicionar: list | None = None, tags_remover: list | None = None, snapshot=None) -> dict` = saída do comando + `dispara: [{workflow, nome, trigger}]` + `_snapshot`.

- [ ] **Step 1: Testes**

```python
def test_editar_calls_extractor_and_lists_triggered_workflows(root, monkeypatch):
    from conftest import trig, tag_cond
    root(workflows=[wf(id="a", name="Tag quente", triggers=[trig("contact_tag", "a", conditions=[tag_cond("quente")])]),
                    wf(id="b", name="Campo mudou", triggers=[trig("contact_changed", "b")])],
         tags=["quente"])
    seen = {}
    monkeypatch.setattr(srv, "_run_extractor", lambda *a: seen.setdefault("args", a) and {"id": "c1", "snapshot": "/s.json", "antes": {}, "depois": {}, "mudancas": {}})
    out = srv.editar(LOC, "c1", set={"phone": "+55"}, tags_adicionar=["quente"])
    assert seen["args"][:5] == ("contato-editar", "-l", LOC, "-i", "c1")
    assert "--set" in seen["args"] and "phone=+55" in seen["args"] and "+quente" in seen["args"]
    assert {d["workflow"] for d in out["dispara"]} == {"a", "b"}
    assert out["snapshot"] == "/s.json" and "_snapshot" in out


def test_editar_requires_something_to_change(root):
    root(workflows=[wf()])
    with pytest.raises(srv.ToolError, match="set"):
        srv.editar(LOC, "c1")
```

Confira em `auditor/tests/conftest.py` as assinaturas reais de `trig`/`tag_cond`/`make_dump(tags=...)` (usadas em `tests/test_journey.py`) e ajuste os nomes de argumento.

- [ ] **Step 2: Rodar para ver falhar**

Run: `cd auditor && .venv/bin/python -m pytest tests/test_mcp_tools.py -k editar -q`
Expected: 2 failed.

- [ ] **Step 3: Implementar**

```python
def editar(loc: str, id: str, set: dict | None = None, tags_adicionar: list | None = None,
           tags_remover: list | None = None, snapshot: str | None = None) -> dict:
    set, tags_adicionar, tags_remover = set or {}, tags_adicionar or [], tags_remover or []
    if not (set or tags_adicionar or tags_remover):
        raise ToolError("nada a fazer: passe set={campo: valor} e/ou tags_adicionar/tags_remover")
    ctx, meta = _load(loc, snapshot)
    args = ["contato-editar", "-l", loc, "-i", id]
    for k, v in set.items():
        args += ["--set", f"{k}={v}"]
    args += [x for t in tags_adicionar for x in ("--tag", f"+{t}")]
    args += [x for t in tags_remover for x in ("--tag", f"-{t}")]
    out = _run_extractor(*args, "--json")

    from .journey import TriggerIndex
    idx = TriggerIndex(ctx)
    hits = [t for tag in tags_adicionar for t in idx.for_tag(tag)]
    if set:
        hits += idx.for_field_change()
    names = {w.id: w.name for w in ctx.workflows}  # confira o atributo real em loader.py
    out["dispara"] = sorted({(t["workflow"], names.get(t["workflow"], ""), t["name"]) for t in hits})
    out["dispara"] = [{"workflow": w, "nome": n, "trigger": tr} for w, n, tr in out["dispara"]]
    return out | {"_snapshot": meta}
```

Entrada em `TOOLS`, depois de `contato`:

```python
    "editar": (editar, "ESCREVE EM PRODUÇÃO: altera campos e/ou tags de um contato pela API interna (abre Chrome). "
               "Grava snapshot do contato antes; devolve antes/depois, caminho do snapshot e `dispara` = workflows "
               "cujo trigger reage à mudança. Nomes de campo/tag resolvidos pelo dump; não cria tags.",
               {"loc": _LOC, "id": {"type": "string", "description": "id do contato"},
                "set": {"type": "object", "description": "campo (nome, fieldKey ou id) → valor"},
                "tags_adicionar": {"type": "array", "items": {"type": "string"}},
                "tags_remover": {"type": "array", "items": {"type": "string"}}, "snapshot": _SNAP},
               ["loc", "id"]),
```

- [ ] **Step 4: Rodar tudo**

Run: `cd auditor && .venv/bin/python -m pytest -q`
Expected: 133 passed.

- [ ] **Step 5: Skill e CLAUDE.md**

`skills/automaster-leitura/SKILL.md`: na `description` do frontmatter, acrescente `editar` à enumeração; no corpo, após o parágrafo de `contato`, adicione:

```markdown
**`editar` escreve em produção.** Só depois de diagnosticar com `contato` e com o pedido explícito do usuário. Ela grava snapshot antes e devolve `dispara`: cite esses workflows na resposta, porque a mudança pode acendê-los. Não cria tag nem campo; se o nome não existe no dump, extraia de novo ou passe o id.
```

`CLAUDE.md`: "expõe sete tools (`dumps`, ..., `contato`)" → "oito tools (..., `contato`, `editar`)"; na lista de comandos do extractor, adicione `npm run contato-editar -- -l <loc> -i <contactId> --set campo=valor --tag +x --json`.

- [ ] **Step 6: Commit**

```bash
git add auditor/src/automaster_audit/mcp_server.py auditor/tests/test_mcp_tools.py skills/automaster-leitura/SKILL.md CLAUDE.md
git commit -m "feat(mcp): tool editar — escrita de contato com snapshot e dispara"
```

### Task 9: Validação real na Instaltech

**Files:**
- Modify: `docs/endpoints.md` (data de validação na seção "Escrita"), memória do projeto

- [ ] **Step 1: Pelo comando**

Run: `cd extractor && npm run contato-editar -- -l Xb9gDxwxYhdqtprGcb5E -i <contato de teste da Task 2> --set phone=+5511999990000 --tag +teste-automaster --json | tail -c 600`
Expected: JSON com `snapshot` apontando para `~/.automaster/dumps/_contatos/Xb9gDxwxYhdqtprGcb5E/<id>/<stamp>.json`, `depois` com o telefone novo. Abra o arquivo: `escrito: true`, `aplicado: ["set","tagsAdd"]`.

- [ ] **Step 2: Conferir pela timeline**

Run: `npm run timeline -- -l Xb9gDxwxYhdqtprGcb5E -i <id> --json | grep -o '"type":"[A-Z_]*"' | sort | uniq -c`
Expected: aparecem `UPDATED` e `TAG_ADDED` recentes.

- [ ] **Step 3: Pela tool, no Claude Code**

Reinstale o plugin (`claude plugin install automaster@zoi` a partir da raiz, ou o fluxo que a memória do projeto descreve) e, numa sessão nova, peça: "remove a tag teste-automaster do contato <id> da Instaltech". Expected: o gate de permissão aparece; a resposta cita o snapshot e `dispara`.

- [ ] **Step 4: Registrar**

Em `docs/endpoints.md`, troque `validado 2026-09-XX` pela data. Na memória do projeto (`MEMORY.md`), uma linha: contato de teste da Instaltech (id) e onde ficam os snapshots. Commit:

```bash
git add docs/endpoints.md
git commit -m "docs(endpoints): escrita de contato validada ao vivo"
```

---

## Self-review

Cobertura da spec: etapa zero (T1, T2); `GhlClient` com `request()` (T3); `withClient`, `latestDumpEntity` com `manifest.json` (T4); rotas de contato (T5); comando, resolução por lista única, tag granular, snapshot em `_contatos/` com `escrito`, stderr com o caminho (T6); `_run_extractor` com teste próprio (T7); tool `editar`, `dispara` via `TriggerIndex`, aviso na descrição, linha na skill (T8); validação real (T9). Plano B (API pública) fica registrado na spec e só entra se T2/T9 esgotarem as variações. Desfazer: fora de escopo, como na spec.
