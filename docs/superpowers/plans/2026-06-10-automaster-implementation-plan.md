# Plano de implementação — Automaster v2 (extractor + auditor)

**Spec:** `docs/superpowers/specs/2026-06-10-automaster-extractor-design.md`
**Endpoints validados:** `docs/endpoints.md` (spike confirmou os 21 workflows da Instaltech)
**Modelo:** cada fase é auto-contida, executável em chat novo. Antes de cada fase, ler a spec + endpoints + esta Fase 0.

---

## Fase 0 — APIs permitidas (descoberta consolidada)

Fatos extraídos da documentação oficial. **Use só estas APIs. Não invente métodos.**

### Playwright (TypeScript) — fonte: types.d.ts v1.59.x, playwright.dev

| Necessidade | API exata | Notas |
|---|---|---|
| Import | `import { chromium } from 'playwright'` | `chromium: BrowserType` |
| Perfil persistente | `chromium.launchPersistentContext(userDataDir: string, options?): Promise<BrowserContext>` | **retorna context, não page** |
| Login manual visível | opção `{ headless: false, channel: 'chrome' }` | `headless` default `true` |
| Obter page | `context.pages()[0] ?? await context.newPage()` | persistent já abre 1 página |
| **Ler headers (só observar)** | `page.on('request', (req) => ...)` + `await req.allHeaders()` | **NÃO usar `page.route`** (bloqueia). `allHeaders()` é async e completo; `headers()` sync pode omitir |
| Chaves de header | lower-case: `h['authorization']`, `h['token-id']` | Playwright normaliza |
| Esperar request | `page.waitForRequest(r => r.url().includes('/workflow/'), { timeout })` | predicate p/ substring; string usa glob |
| HTTP client | `context.request.get(url, { headers })` → `Promise<APIResponse>` | **usar `context.request`** (herda cookies da sessão). `maxRetries` default 0 |
| Reload (recaptura) | `page.reload({ waitUntil: 'domcontentloaded' })` | evitar `networkidle` (discouraged) |
| CLI | `import { Command } from 'commander'`; `program.command('extract').option('-l, --location <id>', '...').action(fn)` | `<...>` = valor obrigatório |

**Anti-padrões Playwright:** não usar `page.route` para só observar; não usar `headers()` quando precisa de auth completa (use `allHeaders()`); não usar `waitUntil: 'networkidle'`; não assumir que `launchPersistentContext` retorna page.

### Python (auditor) — fonte: packaging.python.org, docs.python.org, docs.pytest.org

| Necessidade | API/estrutura exata | Notas |
|---|---|---|
| Build backend | `[build-system] requires=["hatchling>=1.26"]`, `build-backend="hatchling.build"` | PyPA default; Hatchling autodetecta `src/` |
| Console script | `[project.scripts]` → `automaster-audit = "automaster_audit.cli:main"` | |
| Layout | **src/ layout**: `src/automaster_audit/...` | força import do pacote instalado |
| CLI | `argparse` (stdlib) — `add_subparsers(required=True)` + `set_defaults(func=...)`; `add_argument("dump_path", type=Path)` | suficiente, sem dep extra |
| Registry de regras | `pkgutil.iter_modules(rules.__path__, rules.__name__ + ".")` + `importlib.import_module(name)` | cada regra expõe `check(ctx) -> list[Finding]` |
| Finding | `@dataclass` (stdlib); campos sem default antes dos com default | |
| pytest | `[tool.pytest.ini_options] testpaths=["tests"]`; fixtures via `Path(__file__).parent/"fixtures"` + `json`; `tmp_path` p/ saída isolada | |

**Anti-padrões Python:** não usar flat layout; não adicionar dependências quando stdlib basta (argparse/json/pathlib/dataclasses cobrem tudo); campos de dataclass com default não podem preceder os sem default.

### Fatos da API GHL (do spike — ver `docs/endpoints.md`)

- Auth: enviar **ambos** `authorization: Bearer <jwt>` **e** `token-id: <jwt>` + `channel: APP` + `source: WEB_USER` + `version: 2021-07-28` + UA de browser (UA não-browser → 403; falta token-id → 401 em entidades).
- Listar: `GET backend/workflow/<loc>/list?type=workflow&limit&offset` (plano; `parentId=root` só traz pastas). Paginar por `count`.
- Detalhe: `GET backend/workflow/<loc>/<id>?includeScheduledPauseInfo=true` → traz `fileUrl`.
- **Steps**: `GET <fileUrl>` (Firebase, sem auth) → `{ templates: [...] }` (as actions).
- Triggers: `GET backend/workflow/<loc>/trigger?workflowId=<id>` → array.
- Pipelines: `GET backend/opportunities/pipelines?locationId=<loc>`.
- Custom fields: `GET backend/locations/<loc>/customFields/search?documentType=field&limit=10000&includeStandards=true`.
- Tags: `GET services/locations/<loc>/tags/search?limit=10000&getCount=true` (host `services`).

---

## Fase 1 — Extractor: scaffold + captura de auth

**Objetivo:** projeto TS que abre Chrome persistente, captura os dois tokens, expõe CLI `discover`/`extract`.

### O que implementar
1. `extractor/package.json` — TS + Playwright + commander. `"type": "module"`. Scripts `extract`/`discover`/`test`. Fixar versão do Playwright instalada (`npm i -D playwright` e checar versão real).
2. `extractor/tsconfig.json` — target ES2022, module NodeNext, strict.
3. `extractor/src/cli.ts` — COPIAR padrão commander da Fase 0: dois subcomandos (`extract`, `discover`), flag `-l, --location <id>` obrigatória. Cada um chama um handler stub por enquanto.
4. `extractor/src/auth/session.ts`:
   - `openSession(userDataDir)` → COPIAR padrão Fase 0: `chromium.launchPersistentContext(userDataDir, { headless: false, channel: 'chrome' })`, pegar `context.pages()[0] ?? newPage()`. `userDataDir` = `~/.automaster/chrome-profile` (via `os.homedir()`).
5. `extractor/src/auth/token.ts`:
   - `captureTokens(page, locationId)` → registra `page.on('request', ...)`, navega pra `app.gohighlevel.com/v2/location/<loc>/automation/workflows`, espera com `page.waitForRequest` por um request a `backend.leadconnectorhq.com/workflow/`, lê `await req.allHeaders()`, extrai `authorization` (strip `Bearer `) e `token-id`. Retorna `{ bearer, tokenId }`.
   - Se algum token faltar após timeout → erro claro ("login necessário: complete o login na janela do Chrome").

### Referências de doc
- Commander: Fase 0 tabela TS, linha CLI.
- Persistent context + page: Fase 0, linhas "Perfil persistente"/"Obter page".
- Captura de headers: Fase 0, linha "Ler headers" — `page.on('request')` + `allHeaders()`, chaves lower-case.

### Checklist de verificação
- [ ] `npm run discover -- --location <id>` abre Chrome visível.
- [ ] Após login manual, console loga `bearer` e `tokenId` capturados (truncados).
- [ ] `grep -rn "page.route" extractor/src` → **vazio** (anti-padrão).
- [ ] `grep -rn "\.headers()" extractor/src` → vazio ou só com justificativa (preferir `allHeaders()`).
- [ ] `npx tsc --noEmit` passa.

### Anti-padrão guards
- NÃO usar `page.route`. NÃO gravar tokens em disco. NÃO assumir page do retorno de `launchPersistentContext`.

---

## Fase 2 — Extractor: cliente HTTP, extração e dump

**Objetivo:** com os tokens, baixar os 21 workflows + entidades e gravar o dump conforme contrato.

### O que implementar
1. `extractor/src/api/client.ts`:
   - `makeClient(context, tokens, locationId)` — wrapper sobre `context.request.get(url, { headers })`. Headers fixos: COPIAR da Fase 0 "Fatos da API GHL" (os 5 headers + UA). 
   - Tratamento `401` → callback de renovação (recebe função que faz `page.reload` + `captureTokens` de novo, atualiza tokens, repete 1x). `429` → backoff (sleep 1s, retry).
   - Throttle: `await sleep(200)` entre chamadas (validado no spike).
2. `extractor/src/api/workflows.ts`:
   - `listWorkflows()` — pagina `GET /workflow/<loc>/list?type=workflow&limit=100&offset=N` até `rows.length >= count`. (assinatura exata: `docs/endpoints.md`).
   - `fetchWorkflow(wf)` — 3 chamadas: detalhe (`/workflow/<loc>/<id>?includeScheduledPauseInfo=true`), steps (`GET detail.fileUrl` — **sem headers de auth**, via `context.request.get(fileUrl)`), triggers (`/workflow/<loc>/trigger?workflowId=<id>`). Retorna `{ list_entry, detail, steps, triggers }`.
3. `extractor/src/api/entities.ts` — `fetchPipelines()`, `fetchCustomFields()`, `fetchTags()` (URLs exatas em `docs/endpoints.md`; tags usa host `services`).
4. `extractor/src/dump/writer.ts`:
   - Escreve `dumps/<loc>/<YYYY-MM-DD_HHmm>/` com `manifest.json` (schemaVersion=1, counts, warnings), `workflows/<id>.json` (envelope `{id,name,status,fetchedAt,raw:{list_entry,detail,steps,triggers}}`), `pipelines.json`, `tags.json`, `custom_fields.json`. Formato exato: spec seção "Contrato do dump".
   - Timestamp do nome da pasta: passar via parâmetro (não usar relógio dentro de lógica testável). Falha em 1 workflow → push em `warnings`, segue.
5. Ligar tudo em `cli.ts` no handler `extract`.

### Referências de doc
- `context.request.get`: Fase 0 tabela TS "HTTP client".
- Todas as URLs/params/headers: `docs/endpoints.md`.
- Estrutura do envelope/manifest: spec "Contrato do dump".

### Checklist de verificação
- [ ] `npm run extract -- --location <id-de-teste>` gera `dumps/<loc>/<ts>/` com `manifest.json` + N arquivos em `workflows/`.
- [ ] `manifest.json` tem `counts.workflows` == nº de arquivos em `workflows/`.
- [ ] Um `workflows/<id>.json` tem `raw.steps.templates` não-vazio (actions presentes).
- [ ] `grep -rn "Bearer" extractor/src/dump` → **vazio** (token nunca em disco).
- [ ] `npx tsc --noEmit` passa.

### Anti-padrão guards
- NÃO mandar headers de auth na chamada do `fileUrl` (Firebase é URL assinada). NÃO transformar/limpar o `raw`. NÃO usar `parentId=root` para listar.

---

## Fase 3 — Auditor: scaffold, loader e regras

**Objetivo:** pacote Python que carrega um dump e roda as regras de auditoria.

### O que implementar
1. `auditor/pyproject.toml` — COPIAR da Fase 0 (Hatchling + `[project.scripts]` `automaster-audit` + `[tool.pytest.ini_options]`). `requires-python=">=3.12"`.
2. `auditor/src/automaster_audit/` — src/ layout (Fase 0 estrutura): `__init__.py`, `cli.py`, `finding.py`, `loader.py`, `report.py`, `rules/__init__.py`.
3. `finding.py` — `@dataclass Finding` (Fase 0): `rule: str`, `severity: str`, `workflow_id: str|None=None`, `detail: str=""`.
4. `loader.py` — `load_dump(path: Path) -> DumpContext`. Lê `manifest.json` (valida `schemaVersion==1`, senão erro claro), todos `workflows/*.json`, `pipelines.json`, `tags.json`, `custom_fields.json`. `DumpContext` expõe: lista de workflows (com `raw.steps.templates`), sets de ids/nomes de pipelines+stages, tags, custom fields — para lookup de refs.
5. `rules/__init__.py` + módulos de regra. Registry: COPIAR padrão Fase 0 (`pkgutil.iter_modules` + `importlib.import_module`). Cada regra = arquivo com `check(ctx: DumpContext) -> list[Finding]`.
   - Implementar primeiro as ERROR de refs (varrer `raw.steps.templates` de cada workflow): `broken_tag_ref` (`add_contact_tag`/`remove_contact_tag` → tag existe?), `broken_pipeline_ref` (`transition`/`find_opportunity`/`internal_create_opportunity` → pipeline/stage existe?), `broken_field_ref` (`update_contact_field` → field existe?), `broken_workflow_ref` (`add_to_workflow` → workflow existe?).
   - WARN: `no_trigger` (status published + `raw.triggers` vazio). [`empty_branch` foi REMOVIDA na execução: os dados reais revelaram que nós `if_else` com `branches:[]` são estrutura normal do canvas GHL — detectar ramo vazio exige reconstruir o grafo de nós, fora de escopo. Guard do plano: zero falso positivo.]
   - INFO: `naming_convention` (nome fora de `[Produto] Gatilho → Ação`), `dead_end_draft` (draft, `updatedAt` > 90 dias).
   - `broken_template_ref`: **confirmar no dump real** se SMS referencia template externo (no spike vinha inline). Se inline em todos → não implementar agora, registrar nota.
6. `cli.py` — `main()` com argparse (Fase 0): subcomando `audit` + posicional `dump_path`. Carrega dump, roda registry, passa findings pro report (Fase 4).

### Referências de doc
- Estrutura/registry/dataclass/argparse: Fase 0 tabela Python.
- Tipos de action e onde ficam as refs: `docs/endpoints.md` (lista de tipos) + spec tabela de regras.
- Severidades e o que cada regra detecta: spec "Regras de auditoria".

### Checklist de verificação
- [ ] `pip install -e auditor/` instala e expõe `automaster-audit`.
- [ ] `automaster-audit <pasta-dump-real>` roda sem crash e imprime contagem de findings.
- [ ] `python -c "from automaster_audit import rules; import pkgutil; print([m.name for m in pkgutil.iter_modules(rules.__path__)])"` lista todas as regras.
- [ ] Dump com `schemaVersion` errado → erro claro, sem traceback cru.

### Anti-padrão guards
- NÃO flat layout. NÃO deps externas (stdlib basta). NÃO ler actions do `detail` (estão em `raw.steps.templates`).

---

## Fase 4 — Auditor: relatórios + testes

**Objetivo:** gerar `report.md` + `report.json` e cobrir cada regra com teste.

### O que implementar
1. `report.py` — `write_reports(findings, out_dir)`: 
   - `report.json` — lista de findings serializada (`dataclasses.asdict`).
   - `report.md` — sumário por severidade (contagem ERROR/WARN/INFO) → tabela (workflow, regra, detalhe) → estatísticas (nº workflows, pipelines, tags, fields). Formato: spec "Regras de auditoria" (saída).
   - Grava na própria pasta do dump.
2. `tests/fixtures/` — por regra: 1 dump sintético **quebrado** (dispara a regra) + 1 **limpo** (não dispara). Dump mínimo = `manifest.json` + 1 `workflows/<id>.json` com steps montados à mão + entidades.
3. `tests/test_<regra>.py` — para cada regra: carrega fixture quebrada → `check` retorna ≥1 finding com `severity`/`rule` certos; carrega limpa → retorna `[]`. Padrão de fixture: Fase 0 (`Path(__file__).parent/"fixtures"` + `json`). Usar `tmp_path` p/ testar `write_reports`.

### Referências de doc
- pytest/fixtures/tmp_path: Fase 0 tabela Python.
- `dataclasses.asdict`: stdlib dataclasses.
- Formato do report: spec.

### Checklist de verificação
- [ ] `cd auditor && pytest` → todos verdes.
- [ ] 1 teste quebrado + 1 limpo por regra implementada (contar: `grep -c "def test" tests/*.py`).
- [ ] Rodar `automaster-audit` num dump real gera `report.md` + `report.json` legíveis na pasta do dump.

### Anti-padrão guards
- NÃO testar contra GHL real. NÃO fixtures gigantes — mínimas, focadas numa regra.

---

## Fase 5 — Verificação end-to-end

**Objetivo:** provar que extractor → dump → auditor funciona ponta a ponta.

### Passos
1. `npm run extract -- --location <id-de-teste>` numa subconta real → gera dump.
2. `automaster-audit dumps/<loc>/<ts>/` → gera relatórios.
3. Conferir `report.md`: findings fazem sentido vs workflows reais (ex: validar manualmente 1 ref quebrada apontada, ou confirmar 0 erros numa subconta limpa).
4. Anti-padrões finais (grep):
   - `grep -rn "page.route" extractor/src` → vazio
   - `grep -rn "networkidle" extractor/src` → vazio
   - `grep -rn "Bearer" extractor/src/dump auditor/` → vazio
   - `grep -rn "parentId=root" extractor/src` → vazio (ou só em comentário explicando)
5. `npx tsc --noEmit` (extractor) + `pytest` (auditor) verdes.
6. Confirir `.gitignore` cobre `dumps/` (dados de cliente fora do git).

### Critério de conclusão
Dump real extraído + relatório gerado + todos os greps de anti-padrão vazios + builds/testes verdes.
