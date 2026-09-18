# Automaster como plugin do Claude Code — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plugin interno `automaster` com sete tools MCP, dois comandos e uma skill de leitura, sobre as CLIs que já existem.

**Spec:** `docs/superpowers/specs/2026-09-18-automaster-plugin-design.md` — oito decisões aprovadas pelo mapa. **NÃO rediscutir.** Decisão nova é ticket no mapa, não parágrafo do plano.

**Tech Stack:** Python 3.12+ (auditor, src-layout, stdlib pura), TypeScript (extractor), MCP stdio.

**Comandos-base (de `auditor/`):**
- Testes: `.venv/bin/python -m pytest -q` (hoje: **114 verdes**; cada task termina verde)
- Dump de referência: `../dumps/Xb9gDxwxYhdqtprGcb5E/2026-07-30_1221/` (Instaltech, 94 workflows)

**Regras do projeto (CLAUDE.md — invioláveis):**
- `raw` intocado. Mudou o formato do dump? Incremente `schemaVersion` e atualize o loader.
- O MCP importa o auditor como biblioteca; nunca lê os JSON do dump por conta própria.
- Regra de auditoria nova = arquivo em `rules/` com `check(ctx)->list[Finding]`.
- HTML auto-contido e XSS-safe; nome de CRM sempre escapado.

---

## Estrutura de arquivos

| Arquivo | Papel |
|---|---|
| Modify `auditor/src/automaster_audit/dashboard.py` | `_wf_refs` passa a varrer triggers e marcar papel |
| Create `auditor/src/automaster_audit/mcp_server.py` | Servidor stdio, sete tools |
| Create `auditor/tests/test_refs_papel.py` | Índice reverso com papel (inclui as 6 tags-gatilho) |
| Create `auditor/tests/test_mcp_tools.py` | Contrato e teto de cada tool |
| Modify `extractor/src/cli.ts` | Flag `--json` no `timeline`; raiz de dumps por env |
| Create `.claude-plugin/plugin.json` | Manifesto |
| Create `.mcp.json` | Declaração do servidor |
| Create `bin/automaster-python.sh` | Shim que descobre o interpretador |
| Create `hooks/hooks.json` + `hooks/scripts/check-setup.sh` | SessionStart de diagnóstico |
| Create `commands/automaster-extract.md`, `commands/automaster-audit.md` | Comandos |
| Create `skills/automaster-leitura/SKILL.md` | Leitura do domínio |

---

## Fase 1 — Consertar o índice reverso

Primeiro porque é o único código novo de verdade, conserta um erro que já está em produção
no `dashboard.html`, e as tools `buscar` e `workflow` dependem dele.

### Task 1.1: papel nas referências

- [x] **Step 1: teste falhando.** Em `auditor/tests/test_refs_papel.py`, fixture com um
  workflow cujo trigger `contact_tag` tem condição `tagsAdded == "x"` e nenhum step que use
  `"x"`. Espera-se `papel == "dispara"` e **não** `orphan`.
- [x] **Step 2:** `_wf_refs` passa a devolver, por entidade, uma lista de papéis:
  `dispara` (trigger), `adiciona` (`add_contact_tag`), `remove` (`remove_contact_tag`),
  `condicao` (condição de trigger ou de branch). Tag só citada em trigger deixa de ser órfã.
- [x] **Step 3: verificar no dump real.** As seis tags-gatilho param de aparecer como
  órfãs: `form-custom-site`, `gestor de follow up`, `ia manual`, `ia-teste`,
  `indicacao-rodrigo`, `recuperacao-reativacao`. O total de órfãs cai de 59 para 53.
  **Medido: caiu para 48** — as condições de branch (`contact_detail/tags`) e de trigger
  (`contact.tags`) recuperam mais 5 além das 6 tags-gatilho.
- [x] **Step 4:** `dashboard.html` regenerado mostra o papel. Testes verdes.

---

## Fase 2 — As seis tools offline

### Task 2.1: servidor e `dumps`

- [x] **Step 1:** `mcp_server.py` com transporte stdio e a raiz vinda de
  `AUTOMASTER_DUMPS`. Falha ao subir escreve em stderr e sai com código 1 — o servidor que
  falha calado é o modo de erro que o 002 mediu.
- [x] **Step 2:** `dumps()` lista subcontas, nome, snapshots e `extractedAt`.
- [x] **Step 3:** helper `_snapshot(loc, snapshot?)` que resolve o mais recente e devolve o
  bloco `{"extractedAt", "idade_dias"}` **anexado a toda resposta de toda tool**.

### Task 2.2: `inventario`, `workflow`, `achados`, `buscar`

- [x] **Step 1: testes de contrato.** Cada tool tem um teste que fixa a forma da resposta e
  um que fixa o teto.
- [x] **Step 2:** `inventario(loc, fatia?)` — `summary` por default (82 tok), fatias
  (`workflows`, `tags`, `fields`, …) sob demanda.
- [x] **Step 3:** `workflow(loc, id)` — meta (155 tok), achados do workflow, e a árvore de
  caminhos **com teto**; acima do teto, resumo mais flag de truncagem.
- [x] **Step 4:** `achados(loc, severidade?)` — agrupa por `(rule, workflow, detail)` com
  contagem, e devolve `counts` completo mesmo com filtro.
- [x] **Step 5:** `buscar(loc, termo)` — usa o papel da Fase 1; procura em tags, campos,
  pipelines, usuários, custom values e nomes de workflow.

### Task 2.3: `jornada`

- [x] **Step 1: teste** de que a resposta de um nível nunca traz a subárvore inteira.
- [x] **Step 2:** `jornada(loc, caminho?, profundidade=1)` com endereço por **caminho
  posicional** (`[0,3,1]`), sem tocar em `journey.py`. Cada nó devolve `kind`, `label`,
  `detail`, `flags`, `conds` e `n_filhos` — nunca `children` cheio.
- [x] **Step 3: verificar no dump real** que a raiz custa ~61 tokens por nó, contra os
  215.372 da árvore inteira.
  **Medido:** raiz 805 tok para 18 nós (44/nó); `inventario` summary 133; `achados` ERROR
  1.007; maior workflow 1.793 com truncagem; `dumps` 740 para 11 subcontas.

---

## Fase 3 — A tool ao vivo

### Task 3.1: `--json` no extractor

- [x] **Step 1:** flag `--json` em `timeline` que imprime os eventos em stdout em vez de
  renderizar HTML. O array já existe montado antes da renderização.
- [x] **Step 2:** resolver `sourceId` para nome de workflow na saída, usando o dump mais
  recente — é o campo que costura esta tool às outras seis.
- [x] **Step 3:** `npx tsc --noEmit` limpo.

### Task 3.2: `contato`

- [ ] **Step 1: medir primeiro.** Rodar `timeline --json` num contato real e anotar tokens
  e segundos. **É a lacuna que o mapa fechou sem preencher**; sem esse número o teto da tool
  é chute. Anotar no plano antes de seguir.
- [x] **Step 2:** `contato(loc, id, days?)` chama o extractor como subprocesso e devolve o
  JSON, com teto e paginação por janela de tempo.
- [x] **Step 3:** quando o setup do extractor falta, a tool devolve erro que **ensina** o
  comando de setup, em vez de falhar seco.

---

## Fase 4 — A casa dos dumps

- [x] **Step 1:** raiz de dumps por env no extractor, substituindo o `path.resolve(process.cwd(), "..", "dumps")` de `extractor/src/cli.ts:27`. `dump/writer.ts` já recebe `baseDir` por parâmetro e não muda.
- [x] **Step 2:** mover `dumps/` para `~/.automaster/dumps/`. **Atenção ao symlink**
  `dumps/6ICT3KsGLmamzMUI7VQS` → `dumps/clientec Odontologia/`, que existe porque o comando
  `timeline` procura por locationId: ele precisa sobreviver.
- [x] **Step 3:** conferir que `timeline` e `automaster-audit` acham os dumps no lugar novo.

---

## Fase 5 — O plugin

- [x] **Step 1:** `bin/automaster-python.sh` — testa `python3.14`, `python3.13`,
  `python3.12`, `python3`; confere `sys.version_info >= (3,12)`; `exec`. Falhando todos,
  escreve em stderr a linha que ensina. O piso importa: `/usr/bin/python3` do macOS é 3.9.6
  e quebra no `str | None` de `finding.py`.
- [x] **Step 2:** `.claude-plugin/plugin.json` e `.mcp.json` com
  `command: ${CLAUDE_PLUGIN_ROOT}/bin/automaster-python.sh` e `env.AUTOMASTER_DUMPS`.
  **Não usar caminho relativo puro** e **não usar `cwd`** — nenhum dos dois é suportado.
- [x] **Step 3:** `hooks/hooks.json` com `SessionStart` barato (`timeout: 5`) que só confere
  o Python e aponta para o setup quando falta.
- [x] **Step 4:** comandos `/automaster-extract` e `/automaster-audit`. O extract provisiona
  `npm ci` e `npx playwright install chromium` (~410 MB) na primeira chamada, avisando antes.
- [x] **Step 5: instalar numa máquina limpa** e confirmar que as sete tools sobem. É o único
  teste que pega o modo de falha mudo.
  **Feito nesta máquina** (`claude plugin marketplace add ./` + `install automaster@zoi`): `claude mcp list`
  mostra `plugin:automaster:automaster ✔ Connected` e as 7 tools respondem. Atenção: a instalação
  copia a árvore inteira do repo para `~/.claude/plugins/cache/zoi/automaster/<versão>/`, inclusive
  arquivos não versionados (`node_modules`, `_temp`, screenshots). Máquina limpa de verdade ainda
  não testada.

---

## Fase 6 — A skill de leitura

- [x] **Step 1:** `skills/automaster-leitura/SKILL.md` com o que a spec lista: draft é o
  estado normal (66 de 94), `naming_convention` é ruído (94 de 152), tag órfã quase nunca
  importa (53 de 95 após a Fase 1), ciclo de `add_to_workflow` pode ser desenho, referência
  quebrada é sempre erro, jornada de criação vazia é informação.
- [x] **Step 2:** descrições das tools ficam **secas** — o que devolve e quanto custa. A
  interpretação é da skill, porque descrição de tool é lida sempre, mesmo sem a tool ser
  chamada.

---

## Verificação final

- [ ] 114 testes do auditor verdes, mais os novos das fases 1 e 2.
- [ ] `npx tsc --noEmit` limpo no extractor.
- [ ] As quatro perguntas do mapa respondidas numa sessão real, comparadas com os
  transcripts de `docs/wayfinder/prototipo-007-a-sessao-ideal.md`.
- [ ] `dashboard.html` regenerado sem as seis tags-gatilho na lista de órfãs.
