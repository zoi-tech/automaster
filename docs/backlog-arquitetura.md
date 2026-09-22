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
- [x] **A3 — Schema do dump.** JSON Schema do `manifest.json` + envelopes, validado no
  fim da extração e na entrada do `loader.py`. Hoje o contrato entre as duas metades
  está só em prosa no CLAUDE.md; mudança de formato só aparece três camadas adiante.
- [x] **A4 — Fixtures da API interna.** Gravar uma vez as respostas reais das rotas do
  smoke e rodar o parsing contra elas no CI. Pega regressão de formato sem Chrome, que
  é o que o smoke ao vivo não pode fazer no CI.
- [x] **A5 — Política de escrita de um lado só.** Teste que prove que nenhuma tool MCP
  alcança a camada crua do extractor, e que `--sem-regras` só é aceito vindo do auditor.
  Hoje o que segura as 18 regras junto do efeito é disciplina mais uma flag.
- [x] **A6 — Consolidar as tools de conversas.** Seis tools (`conversas`,
  `conversas_buscar`, `conversa_acao`, `rascunho`, `anexar`, `enviar`) para o que
  oportunidades resolve em três com o padrão `*_acao`. Reduz erro de escolha do agente.
- [x] **A7 — Quebrar `workflow-edit.ts`** (708 linhas, lógica de escrita). Os monolitos
  de HTML (`journey_html.py`, 1397) ficam: são gerador de string, quebrar custa mais
  do que rende.
- [x] **A8 — Higiene de raiz.** Os dois spikes de junho saíram do git (o extractor os
  substituiu; o git guarda o histórico) e `spike/` inteiro entrou no `.gitignore`. O resto
  já estava ignorado. `AGENTS.md` e `GEMINI.md` FICAM: não são cópia do CLAUDE.md, são o
  bloco do graft para outros agentes.

Fechados em 0.22.0 (A1, A2), 0.23.0 (A3, A4) e 0.24.0 (A5–A8).
