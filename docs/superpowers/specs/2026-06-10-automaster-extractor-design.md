# Automaster v2 — Extrator e Auditor de Workflows GHL

**Data:** 2026-06-10
**Status:** Aprovado
**Objetivo:** Backup versionável (A) + Auditoria (D) de automações de subcontas GoHighLevel via API interna (`backend.leadconnectorhq.com`), com autenticação capturada por Playwright.

## Visão geral

Duas partes independentes que se comunicam exclusivamente por arquivos JSON em disco:

1. **Extractor** (TypeScript + Playwright) — captura autenticação da sessão do browser, chama a API interna do GHL diretamente e grava um snapshot completo dos workflows e entidades referenciadas de uma subconta.
2. **Auditor** (Python) — lê o snapshot, roda regras de auditoria e gera relatório.

CLI one-shot: roda quando o usuário quiser. Cada execução gera um snapshot novo em pasta timestampada (base para diffs futuros).

## Estrutura de pastas

```
automaster_v2/
├── extractor/                  # TypeScript + Playwright
│   ├── src/
│   │   ├── cli.ts              # entrada: extract --location <id> | discover --location <id>
│   │   ├── auth/
│   │   │   ├── session.ts      # Chrome perfil persistente (login 1x)
│   │   │   └── token.ts        # captura token-id/headers via interception
│   │   ├── api/
│   │   │   ├── client.ts       # cliente HTTP da API interna
│   │   │   ├── workflows.ts    # lista + detalhe de cada workflow
│   │   │   ├── pipelines.ts
│   │   │   ├── tags.ts
│   │   │   ├── customFields.ts
│   │   │   └── templates.ts
│   │   └── dump/
│   │       └── writer.ts       # grava dumps JSON estruturados
│   ├── fixtures/               # respostas anonimizadas capturadas pelo discover
│   └── package.json
├── auditor/                    # Python
│   ├── automaster_audit/
│   │   ├── cli.py              # entrada: audit dumps/<location>/<data>
│   │   ├── loader.py           # lê e valida dump (checa schemaVersion)
│   │   ├── rules/              # 1 arquivo por regra de auditoria
│   │   └── report.py           # gera report.md + report.json
│   └── pyproject.toml
├── dumps/                      # contrato entre as duas partes
│   └── <locationId>/<YYYY-MM-DD_HHmm>/
│       ├── manifest.json
│       ├── workflows/<workflowId>.json
│       ├── pipelines.json
│       ├── tags.json
│       ├── custom_fields.json
│       └── templates.json
└── docs/
    └── endpoints.md            # catálogo gerado pelo discover
```

## Fluxo principal

1. `extract --location <id>` abre Chrome via Playwright com perfil persistente em `~/.automaster/chrome-profile`. Primeira vez: login manual; depois a sessão é reaproveitada.
2. Navega para a subconta; interception (`page.on('request')`) captura os headers de autenticação dos requests reais que o app faz ao backend.
3. Com os headers, o cliente HTTP chama a API interna diretamente (sem navegar a UI): lista workflows paginado → busca detalhe completo de cada um → busca entidades referenciadas (pipelines, tags, custom fields, templates).
4. Grava dump em `dumps/<locationId>/<YYYY-MM-DD_HHmm>/`.
5. `audit <pasta-do-dump>` (Python) lê o snapshot, roda as regras e grava `report.md` + `report.json` na própria pasta do dump.

## Autenticação

- Requests ao `backend.leadconnectorhq.com` carregam: `token-id` (JWT Firebase, expira ~1h), `channel: APP`, `source: WEB_USER`, `version` (data da API).
- Captura: primeiro request autenticado interceptado fornece todos os headers.
- **Renovação:** em resposta `401`, o extractor recarrega a página no Chrome (que continua aberto durante toda a extração), recaptura token fresco e repete o request.
- **Segurança:** token vive só em memória do processo; nunca é gravado em disco. Perfil Chrome fica fora do repo (`~/.automaster/chrome-profile`).

## Mapeamento de endpoints

A API interna é não-documentada e pode mudar sem aviso. Dois comandos:

1. **`discover --location <id>`** — modo descoberta: usuário navega manualmente pela aba Automations enquanto a ferramenta loga todo request ao backend (método, URL, query params, shape da resposta). Gera `docs/endpoints.md` e fixtures JSON anonimizadas em `extractor/fixtures/`. Usado no mapeamento inicial e no re-mapeamento quando o GHL mudar a API.
2. **`extract --location <id>`** — usa endpoints já mapeados, hardcoded em `api/*.ts`.

Endpoints esperados (a confirmar no discover):

- `GET /workflow/?locationId=...` — lista paginada de workflows
- `GET /workflow/<id>` — detalhe completo (triggers, actions, branches)
- `GET /opportunities/pipelines?locationId=...`
- `GET /tags/?locationId=...`
- `GET /custom-fields/?locationId=...`
- Templates SMS/email via serviço próprio

### Resiliência

- Rate limit conservador (~5 req/s); retry com backoff exponencial em `429`.
- Validação de shape nas respostas: campo esperado ausente → erro claro ("API mudou, rode discover novamente") em vez de dump corrompido silencioso.
- Workflow individual que falhar não aborta a extração: registra em `warnings` do manifest e segue.

## Contrato do dump

`manifest.json`:

```json
{
  "schemaVersion": 1,
  "locationId": "...",
  "locationName": "...",
  "extractedAt": "2026-06-10T15:30:00-03:00",
  "extractorVersion": "0.1.0",
  "counts": { "workflows": 42, "pipelines": 3, "tags": 117, "customFields": 28, "templates": 15 },
  "warnings": ["workflow abc123: detalhe retornou 404, pulado"]
}
```

`workflows/<id>.json` — envelope fino sobre o payload bruto:

```json
{
  "id": "...",
  "name": "[Produto] Gatilho → Ação",
  "status": "published | draft",
  "fetchedAt": "...",
  "raw": { }
}
```

Princípios:

- **`raw` preserva a resposta da API intocada** (backup fiel). O auditor extrai o que precisa do `raw`; campos novos do GHL são capturados sem mudança de código.
- `schemaVersion` no manifest protege o auditor contra dumps de formato antigo: versão desconhecida → erro claro, sem tentar adivinhar.
- Entidades de apoio (`pipelines.json`, `tags.json`, etc.) seguem o mesmo padrão envelope + `raw`.

## Regras de auditoria

Cada regra é um arquivo em `auditor/rules/` com severidade ERROR/WARN/INFO:

| Regra | Severidade | Detecta |
|---|---|---|
| `broken_pipeline_ref` | ERROR | Action aponta para pipeline/stage inexistente |
| `broken_tag_ref` | ERROR | Action adiciona/remove tag que não existe |
| `broken_field_ref` | ERROR | Referência a custom field deletado |
| `broken_template_ref` | ERROR | Action usa template SMS/email inexistente |
| `broken_workflow_ref` | ERROR | Action "add to workflow" aponta para workflow deletado |
| `no_trigger` | WARN | Workflow publicado sem trigger |
| `empty_branch` | WARN | Branch if/else sem nenhuma action |
| `dead_end_draft` | INFO | Draft sem modificação há mais de 90 dias |
| `naming_convention` | INFO | Nome fora do padrão ZOI `[Produto] Gatilho → Ação` |

Saída na pasta do dump:

- `report.md` — sumário por severidade, tabela de achados (workflow, regra, detalhe), estatísticas da subconta.
- `report.json` — mesmos achados em formato programático.

## Tratamento de erros e testes

**Extractor:**

- Falha em workflow individual → warning no manifest, extração continua.
- Testes unit nos parsers usando fixtures capturadas pelo `discover`.
- Sem teste E2E contra GHL real (frágil e lento); validação real = rodar `extract` em subconta de teste.

**Auditor:**

- pytest com dumps sintéticos por regra: 1 fixture com o problema + 1 fixture limpa.
- Dump malformado ou `schemaVersion` desconhecido → erro claro, sem relatório parcial.

## Fora de escopo (por enquanto)

- Migração/clonagem de workflows entre subcontas.
- Extração multi-subconta em lote.
- Execução agendada e diff automático entre snapshots (estrutura de pastas timestampada já prepara o terreno).
- Contatos, calendários, formulários e surveys.
