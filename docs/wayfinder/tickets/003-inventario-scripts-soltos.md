# 003 — Inventário dos scripts soltos do extractor

Map: [Automaster como plugin do Claude Code](../map-plugin-claude-code.md)
Type: `wayfinder:measure`
Status: fechado (2026-09-18)
Assignee: claude
Blocked by: —

## Pergunta

`extractor/` tem cerca de 35 arquivos `.ts` não versionados (`step2.ts`, `patch.ts`,
`walber.ts`, `timeline`…), nascidos do trabalho de timeline do contato. Quais deles são o
produto "diagnosticar um contato" e quais são rascunho descartável?

Contar: quantos arquivos, quantos são alcançáveis por algum `npm run`, quantos duplicam uns
aos outros, e qual é o caminho mínimo que produz a timeline de um contato hoje.

A premissa não olhada: que "diagnosticar um contato" é uma funcionalidade pronta a envolver.
Se for rascunho, ela é construção, não empacotamento — e sai da fase de spec.

## Resolução

Inventário completo em
[medicao-003-inventario-scripts-soltos.md](../medicao-003-inventario-scripts-soltos.md).

38 arquivos, 1.021 linhas, **zero versionados e zero alcançáveis por `npm run`** — os cinco
scripts do `package.json` apontam todos para `src/cli.ts`. 37 dos 38 têm a mesma subconta
hardcoded (`citQs4acsN1StzOEDuvj`, Cliente B), 16 giram em torno de um único
workflow, e 8 dependem de caminhos absolutos de outro repositório (`nick_observacao_ia`).
19 clicam na interface do GHL, ou seja, escrevem em produção.

**A premissa do ticket estava errada.** Nenhum dos soltos é timeline de contato: nenhum
chama `audit/search/v2`. Eles são o resíduo de um trabalho de reparo manual de workflows do
clienteb, não o embrião de um produto.

A timeline do contato não é rascunho **nem** é produto a envolver: já está pronta,
versionada e documentada — `src/cli.ts` (comando `timeline`) e `src/timeline_html.ts`, com
o endpoint descrito em `docs/endpoints.md` desde 2026-06-11. O que falta nela é só o que o
001 mediu: ela não persiste nada, escreve HTML em `/tmp`. Isso é o 006, e é uma decisão de
destino, não uma construção do zero.

Dois endpoints valem resgate antes de os arquivos irem embora, ambos ausentes de
`docs/endpoints.md` e ambos leitura pura:

- **Execuções de um workflow** (`logs.ts`, `lastlog.ts`):
  `GET backend.leadconnectorhq.com/workflows/logs/v2?locationId=&workflowId=&limit=&action=first&dateType=custom&fromDate=&toDate=`,
  com `createdAt`, `status`, `type`, `stepName`, `contactName` por execução.
- **Versões de um workflow** (`hist.ts`, `recover.ts`):
  `GET backend.leadconnectorhq.com/workflow/<loc>/<wfId>/history` e `/revisions`, com
  `version`, `name` e `fileUrl` (o mesmo Firebase pré-assinado, baixado sem auth).

O resto é descartável. Apagar não entra neste ticket.

## Verificação

Na seção `## Verificação` do documento de medição.
