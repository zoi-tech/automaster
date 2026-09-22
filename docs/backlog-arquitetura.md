# Backlog de arquitetura

Levantado em 2026-09-21 a partir da revisão de estrutura do repo. Ordem = risco,
não esforço. Marque `[x]` ao fechar e registre o commit.

- [x] **A1 — Lock do Chrome.** `~/.automaster/chrome.lock` no arranque de `openSession`.
  Hoje a serialização da escrita ao vivo é convenção documentada e já falhou ao vivo
  (0.12.0: dois agentes no mesmo formulário, uma exclusão que ninguém pediu).
- [x] **A2 — Envelope JSON da CLI.** Toda saída `--json` vira `{ok, data}` / `{ok:false,
  error:{code, message, gravou, snapshot}}`. Tira do Python a classificação de erro por
  prefixo do comando (`args[0].startswith("formulario-")`) e o palpite de escrita
  parcial (`"--confirmo" in args`), que hoje moram em `mcp/base.py:_run_extractor`.
- [ ] **A3 — Schema do dump.** JSON Schema do `manifest.json` + envelopes, validado no
  fim da extração e na entrada do `loader.py`. Hoje o contrato entre as duas metades
  está só em prosa no CLAUDE.md; mudança de formato só aparece três camadas adiante.
- [ ] **A4 — Fixtures da API interna.** Gravar uma vez as respostas reais das rotas do
  smoke e rodar o parsing contra elas no CI. Pega regressão de formato sem Chrome, que
  é o que o smoke ao vivo não pode fazer no CI.
- [ ] **A5 — Política de escrita de um lado só.** Teste que prove que nenhuma tool MCP
  alcança a camada crua do extractor, e que `--sem-regras` só é aceito vindo do auditor.
  Hoje o que segura as 18 regras junto do efeito é disciplina mais uma flag.
- [ ] **A6 — Consolidar as tools de conversas.** Seis tools (`conversas`,
  `conversas_buscar`, `conversa_acao`, `rascunho`, `anexar`, `enviar`) para o que
  oportunidades resolve em três com o padrão `*_acao`. Reduz erro de escolha do agente.
- [ ] **A7 — Quebrar `workflow-edit.ts`** (708 linhas, lógica de escrita). Os monolitos
  de HTML (`journey_html.py`, 1397) ficam: são gerador de string, quebrar custa mais
  do que rende.
- [ ] **A8 — Higiene de raiz.** `_temp/`, `spike/`, `entities.json`, `shot-*.png`,
  `AGENTS.md`/`GEMINI.md`/`CLAUDE.md` triplicados. Ruído, não dívida.
