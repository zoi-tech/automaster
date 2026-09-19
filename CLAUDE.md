# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## O que é este projeto

Automaster v2: ferramenta de backup e auditoria de automações GoHighLevel (GHL). Extrai todos os workflows de uma subconta usando a API interna (`backend.leadconnectorhq.com`) — a mesma observada na aba Network do Chrome — com autenticação capturada via Playwright.

Docs-chave (leia antes de mudança estrutural):
- Spec: `docs/superpowers/specs/2026-06-10-automaster-extractor-design.md`
- Endpoints da API interna mapeados: `docs/endpoints.md`
- **Próximo trabalho (Camadas 2 e 3 de validação): `docs/superpowers/plans/2026-06-10-validation-layers-2-3-plan.md`** — contém o modelo do grafo de execução já reverso-engenheirado. NÃO re-derivar.

## Arquitetura (big picture)

Duas partes independentes que se comunicam **exclusivamente por arquivos JSON** em `~/.automaster/dumps/` (raiz configurável por `AUTOMASTER_DUMPS`; o extractor cai em `../dumps` sem a env):

- **`extractor/`** — TypeScript + Playwright. Abre Chrome com perfil persistente (`~/.automaster/chrome-profile`, login manual 1x), intercepta **dois tokens** de auth (`authorization: Bearer` + `token-id` Firebase) dos requests reais do app, e então chama a API interna diretamente via HTTP. Em `401`, recarrega a página para recapturar (página fica aberta durante a extração). Tokens nunca vão para disco. Extrai workflows + 6 entidades: pipelines, tags, custom_fields, **users, calendars, custom_values**.
- **`auditor/`** — Python (src/ layout, `src/automaster_audit/`). Lê um dump e produz 6 saídas na pasta do dump:
  - `report.md`/`report.json` — auditoria (`automaster-audit audit`)
  - `graph.html` — grafo interativo de conexões (`automaster-audit graph`)
  - `dashboard.html` — inventário navegável (`automaster-audit dashboard`)
  - `paths.md` — árvore de caminhos de execução por workflow, camada 2 (`automaster-audit paths`)
  - `validation.html` — painel visual das 3 camadas de validação (`automaster-audit validation`)
  - `journey.html` — árvore de jornada do contato: tudo que pode acontecer desde a criação (`automaster-audit journey`)

  As 4 saídas HTML compartilham o design system **"Sala de Controle"** (IBM Carbon): tema claro `#f4f4f4`/painéis brancos, IBM Plex Sans/Mono embutidas como data-URI, radius zero, shell unificado (topbar escura 48px + sidebar 256px com links relativos entre `dashboard.html`/`graph.html`/`validation.html`/`journey.html`). Acento azul `#0f62fe` só em link/ativo; severidade só em status (`#da1e28`/`#f1c21b`/`#24a148`); vermelho reservado a referência quebrada.

Plugin do Claude Code (raiz do repo): `.claude-plugin/plugin.json`, `.claude-plugin/mcp.json` (servidor `automaster` via `bin/automaster-python.sh`, shim que exige Python ≥ 3.12), `hooks/` (SessionStart de diagnóstico), `commands/automaster-{extract,audit}.md`, `skills/automaster-leitura/`. A config MCP fica **fora da raiz de propósito**, apontada pelo campo `mcpServers` do plugin.json: um `.mcp.json` na raiz o Claude Code também carrega como servidor de projeto, e nesse contexto `${CLAUDE_PLUGIN_ROOT}` não expande — o servidor falha com ENOENT em toda sessão aberta no repo. O servidor `mcp_server.py` expõe vinte e três tools (`dumps`, `inventario`, `workflow`, `achados`, `buscar`, `jornada`, `contato`, `conversas`, `conversas_buscar`, `conversa_acao`, `rascunho`, `anexar`, `enviar`, `whatsapp`, `whatsapp_enviar`, `config`, `grupo`, `editar`, `oportunidades`, `oportunidade_acao`, `pipeline`, `agenda`, `agenda_acao`) e **importa o auditor como biblioteca**, nunca lê o dump direto. Spec: `docs/superpowers/specs/2026-09-18-automaster-plugin-design.md`. **Versões do plugin em `CHANGELOG.md`** — mudança que altere o comportamento do plugin instalado sobe a versão no plugin.json e entra lá.

Módulos do auditor: `loader.py` (monta `DumpContext`), `flow.py` (grafo de execução dos steps), `rules/` (registry via `pkgutil`, 1 arquivo por regra, severidade ERROR/WARN/INFO, função `check(ctx)->list[Finding]`), `report.py`, `graph.py`+`graph_html.py`, `dashboard.py`+`dashboard_html.py`, `journey.py`+`journey_html.py` (árvore de jornada do contato), `theme.py` (tokens Carbon + `topbar()`/`sidebar()`/`shell_meta()` compartilhados + fontes embutidas em `assets/`).

**Índice reverso com papel:** `dashboard._wf_refs` varre steps **e** triggers; cada tag tem `papeis` (`dispara`/`adiciona`/`remove`/`condicao`). Tag só citada em trigger ou condição não é órfã.

**Regras de auditoria (13):** refs quebradas `broken_{tag,pipeline,field,workflow,user,custom_value}_ref` (ERROR); `workflow_unreachable` (sem entrada; cruza `add_to_workflow`); camada 1 lógica `unreachable_step`/`broken_goto`/`workflow_call_cycle`/`uncovered_condition`; `naming_convention`/`dead_end_draft` (INFO).

O contrato entre as partes é o formato do dump (`<raiz>/<locationId>/<YYYY-MM-DD_HHmm>/`): `manifest.json` com `schemaVersion` + envelopes com `raw` = resposta da API **intocada**. Workflows: `raw` mescla 4 fontes (`list_entry`, `detail`, `steps` [do Firebase], `triggers`). As **actions vivem em `raw.steps.templates`**, não no `detail`. Entidades: `{fetchedAt, raw:<resposta API>}`. Nunca transformar/limpar o `raw`. Mudou o formato? Incremente `schemaVersion` e atualize o loader.

## Comandos

```bash
# Extractor (em extractor/)
npm install && npx playwright install chromium
npm run extract -- --location <locationId>    # extração completa (abre Chrome p/ login 1x)
npm run timeline -- -l <loc> -i <contactId> --json  # eventos do contato em JSON (stdout)
npm run contato-editar -- -l <loc> -i <contactId> --set campo=valor --tag +x --json  # edita campos/tags do contato
npm run conversas -- -l <loc> -i <contactId> --json  # mensagens trocadas com o contato (leitura)
npm run conversas-enviar -- -l <loc> -i <contactId> --tipo InternalComment --texto "..." --json  # ESCREVE: envia mensagem
npm run conversas-buscar -- -l <loc> --termo "texto" --json          # busca em todas as conversas da subconta
npm run conversas-anexar -- -l <loc> -i <contactId> --arquivo ./foto.png --json  # sobe anexo, devolve URLs
npm run whatsapp -- -l <loc> -o templates --json          # templates/flows/números do WhatsApp (leitura)
npm run whatsapp-enviar -- -l <loc> -i <id> --template <tid> --confirmo --json  # ESCREVE: template aprovado
npm run config -- -l <loc> -o sla --json                  # IA e SLA das conversas (ia|sla|sla-status|sla-permissao)
npm run grupo -- -l <loc> -o interno-checar --corpo '{}'  # group chat e chat interno
npm run conversas-marcar -- -l <loc> -i <contactId> --acao lida      # lida/nao-lida/estrela/sem-estrela/apagar
npm run conversas-rascunho -- -l <loc> -i <contactId> --acao listar  # criar/listar/apagar rascunho
npm run conversas-mensagem -- -l <loc> --acao cancelar --id <msgId>  # cancela agendada / reenvia
npm run oportunidades -- -l <loc> -o pipelines --json     # funis, cards, busca (leitura ao vivo)
npm run oportunidade-acao -- -l <loc> --acao mover -i <id> --estagio <sid> --confirmo --json  # ESCREVE: card
npm run pipeline -- -l <loc> --acao editar -i <id> --estagios '[...]' --confirmo --json       # ESCREVE: estrutura do funil
npm run agenda -- -l <loc> -o eventos --calendario <id> --inicio <isoComFuso> --fim <isoComFuso> --json  # calendários, livres, eventos, notas (leitura ao vivo)
npm run agenda-acao -- -l <loc> --acao marcar --calendario <id> --contato <contactId> --inicio <isoComFuso> --fim <isoComFuso> --confirmo --json  # ESCREVE: marca/remarca/situacao/cancela/notas
npm run discover -- --location <locationId>   # observar requests ao backend
npx tsc --noEmit                               # typecheck (não há unit tests no extractor)

# Auditor (em auditor/) — usa venv: .venv/bin/...
python -m venv .venv && .venv/bin/pip install -e .
.venv/bin/automaster-audit audit dumps/<loc>/<ts>/        # report.md + report.json
.venv/bin/automaster-audit graph dumps/<loc>/<ts>/        # graph.html
.venv/bin/automaster-audit dashboard dumps/<loc>/<ts>/    # dashboard.html
.venv/bin/automaster-audit paths dumps/<loc>/<ts>/        # paths.md (árvore de caminhos)
.venv/bin/automaster-audit verify-contracts dumps/<loc>/<ts>/ --contracts contracts/  # contratos PASS/FAIL/AMBIGUOUS
.venv/bin/automaster-audit validation dumps/<loc>/<ts>/ --contracts contracts/        # validation.html (3 camadas)
.venv/bin/automaster-audit journey dumps/<loc>/<ts>/      # journey.html (árvore de jornada)
.venv/bin/python -m pytest -q                             # suíte (177 testes)
AUTOMASTER_DUMPS=~/.automaster/dumps .venv/bin/python -m automaster_audit.mcp_server  # servidor MCP (stdio)

# Plugin (raiz do repo)
claude plugin marketplace add .   # registra o marketplace local 'zoi'
claude plugin install automaster@zoi
.venv/bin/python -m pytest tests/test_broken_tag_ref.py   # uma regra só
```

Subconta de validação: `Xb9gDxwxYhdqtprGcb5E` (Instaltech, 94 workflows). A sessão Chrome persistente costuma já estar logada → `extract` reusa sem novo login.

## Pontos críticos

- **API interna não-documentada, muda sem aviso.** Endpoints hardcoded em `extractor/src/api/*.ts` (catálogo em `docs/endpoints.md`). Quebrou? Rode `discover`, re-mapeie, atualize o doc.
- **Dois esquemas de auth:** workflows aceitam só `Bearer`; entidades `locations/*` e `opportunities/*` exigem `token-id`. UA de browser obrigatório (UA não-browser → 403).
- **Steps vêm do Firebase** (`detail.fileUrl`, URL pré-assinada, baixada **sem** headers de auth). Nunca mandar auth nessa chamada.
- **Lista de workflows:** `?type=workflow` (lista plana); `parentId=root` só traz pastas.
- **Rate limit conservador** (~0,2s entre chamadas, backoff em 429). Falha em workflow individual → warning no manifest, segue.
- **Nova regra de auditoria** = novo arquivo em `auditor/src/automaster_audit/rules/` com `check(ctx)->list[Finding]`; o registry pkgutil descobre sozinho. Adicione fixture quebrada + limpa em `tests/` (use `conftest.make_dump(...)`).
- **Regras devem evitar falso positivo.** Histórico: `empty_branch` removida (estrutura normal do GHL); `no_trigger` → `workflow_unreachable` (cruza `add_to_workflow` + execução manual). Regra que dependa de entidade não extraída deve ser no-op.
- **HTML auto-contido + XSS-safe.** Nomes vêm do CRM (input externo): escapar (`_safe_json`/`html.escape`). Fonte via data-URI; só o grafo usa vis-network via CDN (com SRI).

## Fora de escopo (por enquanto)

Desfazer uma edição de contato, um envio de mensagem ou um upload de anexo, clonagem/migração entre subcontas, multi-subconta em lote, diff entre snapshots, `broken_template_ref` (templates internos existem — `internal_notification.template_id` — falta puxar a lista).

Oportunidades **saíram** desta lista na 0.6.0: leitura, CRUD de card e gestão de pipeline estão implementados e validados ao vivo (`docs/endpoints.md` seção `## Oportunidades`). Segue fora: apagar cards em lote (`POST /bulk/delete`, destrutivo em lote sem guarda boa) e qualquer regra de auditoria sobre oportunidade.

Escrita de contato **saiu** desta lista: está implementada e validada ao vivo (`docs/endpoints.md` seção `## Escrita`). O que ainda não foi confirmado está em `docs/pendencias-escrita-contato.md`.
