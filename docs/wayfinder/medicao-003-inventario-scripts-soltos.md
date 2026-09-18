# Medição 003 — Inventário dos scripts soltos do extractor

Método: varredura dos arquivos `.ts`/`.js` na raiz de `extractor/` em 2026-09-18, cruzada
com `git ls-files`, com os `scripts` do `package.json` e com os endpoints citados em cada
arquivo. Nenhum script foi executado — todos abrem sessão autenticada no GHL de produção.

## A contagem

38 arquivos na raiz de `extractor/`: 37 `.ts` e um `.js`. 60.984 bytes, 1.021 linhas no
total — média de 27 linhas por arquivo. O maior tem 3.584 bytes.

**Zero estão versionados.** `git ls-files extractor/` devolve 12 arquivos, todos sob
`src/`, mais `package.json`, `package-lock.json` e `tsconfig.json`.

**Zero são alcançáveis por `npm run`.** Os cinco scripts do `package.json` — `build`,
`typecheck`, `extract`, `discover`, `timeline` — apontam todos para `src/cli.ts`. Os soltos
só rodam por `npx tsx <arquivo>.ts` digitado à mão.

**37 dos 38 têm a mesma subconta hardcoded**, `citQs4acsN1StzOEDuvj` — Cliente B.
Nenhum aceita a subconta por argumento, e nenhum aponta para a Instaltech.

16 dos 38 citam o mesmo workflow, `c70ec269-9013-4f93-9334-2bc3af7f6466`. Os `step2`…`step9`,
`step4b`, `step8b`, `edit1`…`edit3`, `fix2`, `patch`, `patch2` são iterações sucessivas
sobre esse único workflow, não módulos que se compõem.

Oito arquivos leem ou escrevem caminhos absolutos de **outro repositório**,
`~/Desktop/ZOI/Projetos_ZOI/nick_observacao_ia/`: `backup.ts`, `edit1.ts`, `edit3.ts`,
`patch2.ts`, `step4b.ts`, `step6.ts`, `step8.ts`, `step8b.ts`. Fora daquela máquina e
daquele repo, eles não rodam.

## O que eles fazem, de verdade

19 dirigem a interface do GHL com `page.click()` e afins — abrem
`app.gohighlevel.com/v2/location/<loc>/automation/workflows` e mexem no editor. Isso é
**escrita em produção**, exatamente o que o `CLAUDE.md` do projeto lista como fora de
escopo.

18 só leem a API interna. Um, `cv.ts`, é o único que usa um método de escrita do
`GhlClient`.

`patch.ts` e `patch2.ts` não escrevem no GHL: editam um JSON de workflow em `/tmp` e
deixam o resultado para alguém colar pela interface. São ferramenta de bancada, não
pipeline.

## A premissa do ticket estava errada

O ticket supõe que os soltos nasceram do trabalho de timeline do contato. **Nenhum deles
toca a timeline.** Nenhum chama `services.leadconnectorhq.com/audit/search/v2`, que é o
endpoint da timeline. Todos giram em torno de editar, consertar e conferir workflows do
Cliente B — é o resíduo de um trabalho de reparo manual, não de um produto.

A timeline do contato já está **versionada e documentada**: `src/cli.ts` (comando
`timeline`) e `src/timeline_html.ts`, ambos em `git ls-files`, com o endpoint e o formato
descritos em `docs/endpoints.md` na seção "Audit logs", validada em 2026-06-11. Ela não
está entre os soltos porque nunca esteve — foi feita direito desde o começo.

## O que vale resgatar antes de apagar

Dois endpoints aparecem só aqui e não estão em `docs/endpoints.md`:

**Execuções de um workflow.** `logs.ts` e `lastlog.ts` chamam
`GET backend.leadconnectorhq.com/workflows/logs/v2?locationId=&workflowId=&limit=&action=first&dateType=custom&fromDate=&toDate=`,
e leem `createdAt`, `status`, `type`, `stepName`, `contactName` por execução. É o histórico
de execução real — quem passou pelo workflow e onde parou. É a única fonte de "este
workflow está rodando?" que o projeto já tocou.

**Versões de um workflow.** `hist.ts` e `recover.ts` chamam
`GET backend.leadconnectorhq.com/workflow/<loc>/<wfId>/history` (e `/revisions`), que
devolve linhas com `version`, `name` e `fileUrl` — a mesma URL pré-assinada do Firebase que
o extractor já baixa sem auth. Dá para reconstruir o workflow em qualquer versão anterior.

Os dois são leitura pura e cabem no padrão atual do extractor. O resto — os 19 que clicam
na UI, os 16 que giram em torno de um workflow do clienteb, os 8 amarrados a outro repositório
— não tem nada a resgatar.

## Verificação

```
cd extractor
ls *.ts *.js | wc -l                      # 38
git ls-files . | wc -l                    # 12, nenhum na raiz
grep -c 'tsx \(step\|patch\|edit\)' package.json          # 0
grep -hoE 'LOC="[A-Za-z0-9]+"' *.ts | sort | uniq -c      # 37x citQs4acsN1StzOEDuvj
grep -lE '\.click\(' *.ts | wc -l         # 19
grep -l 'audit/search' *.ts | wc -l       # 0
```
