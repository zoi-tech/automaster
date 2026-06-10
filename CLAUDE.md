# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## O que é este projeto

Automaster v2: ferramenta de backup e auditoria de automações GoHighLevel (GHL). Extrai todos os workflows de uma subconta usando a API interna (`backend.leadconnectorhq.com`) — a mesma observada na aba Network do Chrome — com autenticação capturada via Playwright.

Spec completa e aprovada: `docs/superpowers/specs/2026-06-10-automaster-extractor-design.md`. Leia antes de qualquer mudança estrutural.

## Arquitetura (big picture)

Duas partes independentes que se comunicam **exclusivamente por arquivos JSON** em `dumps/`:

- **`extractor/`** — TypeScript + Playwright. Abre Chrome com perfil persistente (`~/.automaster/chrome-profile`, login manual 1x), intercepta headers de auth (`token-id` JWT Firebase + `channel: APP` + `source: WEB_USER` + `version`) dos requests reais do app, e então chama a API interna diretamente via HTTP. Em `401`, recarrega a página para recapturar token (a página fica aberta durante toda a extração). Token nunca vai para disco.
- **`auditor/`** — Python. Lê um dump, roda regras de auditoria (`auditor/automaster_audit/rules/`, 1 arquivo por regra, severidade ERROR/WARN/INFO) e gera `report.md` + `report.json` na pasta do dump.

O contrato entre as partes é o formato do dump (`dumps/<locationId>/<YYYY-MM-DD_HHmm>/`): `manifest.json` com `schemaVersion` + envelopes finos com o campo `raw` contendo a resposta da API **intocada**. Nunca transformar/limpar o `raw` — ele é o backup fiel. Mudou o formato do dump? Incremente `schemaVersion` e atualize o loader do auditor.

## Comandos

```bash
# Extractor (em extractor/)
npm install
npx playwright install chromium
npm run extract -- --location <locationId>    # extração completa
npm run discover -- --location <locationId>   # mapear endpoints da API interna
npm test                                       # unit tests (fixtures em extractor/fixtures/)

# Auditor (em auditor/)
pip install -e .
automaster-audit dumps/<locationId>/<timestamp>/   # gera report.md + report.json
pytest                                              # roda 1 fixture quebrada + 1 limpa por regra
pytest tests/test_rules/test_broken_tag_ref.py     # teste de uma regra só
```

## Pontos críticos

- **API interna é não-documentada e muda sem aviso.** Endpoints ficam hardcoded em `extractor/src/api/*.ts`. Quando o GHL mudar algo (validação de shape falhando), rode `discover` para re-mapear e atualize `docs/endpoints.md` + fixtures.
- **Rate limit conservador:** ~5 req/s, backoff exponencial em 429. Não aumentar sem motivo — é API de produção de terceiros.
- **Falha em workflow individual não aborta a extração** — registra em `warnings` do manifest e segue.
- **Sem testes E2E contra GHL real.** Validação real = rodar `extract` em subconta de teste. Unit tests usam fixtures anonimizadas capturadas pelo `discover`.
- Nomenclatura ZOI para workflows: `[Produto] Gatilho → Ação` (a regra de auditoria `naming_convention` verifica isso).

## Fora de escopo

Migração/clonagem entre subcontas, extração em lote multi-subconta, execução agendada/diff automático, e entidades além de workflows + pipelines/tags/custom fields/templates.
