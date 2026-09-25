# Plano — TUI do automaster, navegação do dump (0.27.0)

- Objetivo: `automaster-audit tui` navega workflows, achados, entidades e diff de um dump, com visual cinematográfico.
- Spec: `docs/vesta/specs/2026-09-25-tui-navegacao-design.md` (ler as "Decisões do grill").
- Comando de teste: `cd auditor && TEXTUAL_ANIMATIONS=none .venv/bin/python -m pytest -q`
- Pastas de tela: `auditor/src/automaster_audit/tui/`
- Mockup: `docs/vesta/mockups/2026-09-25-tui-navegacao/index.html`

Convenções para todas as etapas: código em português como o resto do auditor; `ruff check src tests` e
`ruff format --check src tests` passam (linha até 120); fixtures de dump saem de `conftest.make_dump(...)`
(`auditor/tests/conftest.py:26-75`) e a árvore `<root>/<loc>/<snapshot>/` da fixture `root` de
`auditor/tests/test_mcp_tools.py:85-98` — copie a fixture para `auditor/tests/conftest.py` na primeira etapa que
precisar dela e faça o `test_mcp_tools.py` usar a do conftest. Nada de reescrever o `raw` do dump.

## Etapa 1 — Dependências da TUI e prova de convivência

- Tela: não.
- Arquivos: `auditor/pyproject.toml`, `.github/workflows/ci.yml`, novo `auditor/tests/test_tui_deps.py`.
- O que prova: com o extra instalado, um App mínimo do Textual contendo um `EffectLabel` do `textualeffects`
  monta e fecha dentro de `App.run_test()` sem erro; o teste pula (`pytest.importorskip("textual")`) sem o extra.
- Como fazer: em `[project.optional-dependencies]` acrescente `tui = ["textual>=8,<9", "textualeffects==<versão>"]`
  com a versão mais nova do `textualeffects` que instalar junto do Textual 8 (`.venv/bin/pip install -e '.[dev,tui]'`).
  Se nenhuma versão conviver com o Textual 8, PARE e reporte: a spec manda voltar ao usuário (decisão A11).
  No `ci.yml`, job `auditor`, troque `pip install -e '.[dev]'` por `pip install -e '.[dev,tui]'` e acrescente
  `env: TEXTUAL_ANIMATIONS: none` no passo do pytest.

## Etapa 2 — Contagem de achados por workflow no inventário

- Tela: não.
- Arquivos: `auditor/src/automaster_audit/mcp/dump.py`, `auditor/tests/test_mcp_tools.py`.
- O que prova: `inventario(loc, "workflows")` traz em cada workflow `achados: {"ERROR": n, "WARN": n, "INFO": n}`
  (zeros presentes); um dump com uma tag quebrada num workflow dá `ERROR: 1` só nele; outro workflow limpo dá
  zeros; achado sem `workflow_id` não quebra a contagem.
- Como fazer: em `inventario` (`mcp/dump.py:36-43`), quando `fatia == "workflows"`, conte `base._findings(str(ctx.path))`
  por `workflow_id` e severidade (ver `_finding_dict`, `mcp/dump.py:86-93`, e `achados`, `mcp/dump.py:96-111`) e
  devolva cópias dos dicts de `dash["workflows"]` com a chave nova. Não mexa em `dashboard.py` (o HTML não roda regras).

## Etapa 3 — Papel por workflow para tags, campos, funis e usuários

- Tela: não.
- Arquivos: `auditor/src/automaster_audit/dashboard.py`, `auditor/tests/test_dashboard.py` (ou o teste de dashboard existente).
- O que prova: cada item das fatias `tags`, `fields`, `pipelines` e `users` ganha `usos: [{"workflow_id", "workflow",
  "papeis": [...]}]`, ordenado pelo nome do workflow. Tag adicionada num workflow e usada em condição em outro dá dois
  usos com papéis diferentes. Campo escrito por `update_contact_field` tem papel `escreve`. Funil de
  `internal_create_opportunity` tem `cria`; de `find_opportunity`, `busca`. Usuário de `assign_user` tem `atribui`;
  de `internal_notification`, `notifica`. Os campos antigos (`used_by`, `papeis`, `orphan`) seguem iguais — o
  `dashboard.html` e os testes existentes não mudam.
- Como fazer: em `_wf_refs` (`dashboard.py:36-97`) troque `fields`, `pipelines` e `users` de `set` para
  `dict[str, set[str]]` (id -> papéis), como já é com `tags`, e ajuste os consumidores em `build_dashboard`
  (`dashboard.py:100-190`), que hoje iteram os sets. Monte `usos` no mesmo laço do índice reverso.

## Etapa 4 — Formulários e templates no inventário

- Tela: não.
- Arquivos: `auditor/src/automaster_audit/dashboard.py`, `auditor/src/automaster_audit/mcp/base.py`, testes de dashboard e de MCP.
- O que prova: `inventario(loc, "forms")` lista formulários e surveys com `tipo` (`form`/`survey`), `name`, `usos`
  (workflow cujo trigger cita o id, papel `dispara`) e `orphan`; `inventario(loc, "templates")` lista templates com
  `canal` (`message`/`whatsapp`/`email`), `name`, `usos` (papel `envia`) e `orphan`. Dump sem `forms.json` ou sem
  templates devolve lista vazia, sem erro. `template_id: "0"` não conta como uso.
- Como fazer: reuse a extração de ids das regras — `_citados` em `rules/broken_form_ref.py:25-30` para formulários e a
  leitura de `template_id`/`templateId` em `rules/broken_template_ref.py:34-50` (e-mail sai do `previewUrl`, ver o
  comentário do topo desse arquivo). Nomes vêm de `ctx.form_names` e `ctx.template_names` (`loader.py:89-93`).
  Acrescente `"forms"` e `"templates"` a `FATIAS` (`mcp/base.py:32`) e as chaves em `build_dashboard`.

## Etapa 5 — Esqueleto da TUI: subcomando e tela de seleção

- Tela: sim — tela "1 · seleção" e "erro de dump" do mockup.
- Arquivos: novo pacote `auditor/src/automaster_audit/tui/` (`__init__.py`, `app.py`, `telas.py`, `tema.tcss`),
  `auditor/src/automaster_audit/cli.py`, novo `auditor/tests/test_tui.py`.
- O que prova: `automaster-audit tui` sem o Textual instalado sai com código 1 e a mensagem
  `pip install -e '.[tui]'`; a tela de seleção lista as subcontas de `dumps()` (nome, id, nº de snapshots, mais
  recente) e, ao mover para a direita, os snapshots da subconta; Enter num snapshot válido abre a tela principal
  (nesta etapa, um placeholder com o título da subconta); Enter num snapshot com dump recusado mostra o erro com a
  mensagem do `ToolError` e Enter volta à seleção; `q` sai. Diretório de dumps vazio mostra "nenhum dump em <raiz>".
- Como fazer: registre `tui` em `build_parser` (`cli.py:230-324`) com `--sem-animacao`, e em `main` acrescente `"tui"`
  à lista de subcomandos (`cli.py:333-345`). Importe o Textual só dentro da função do subcomando (precedente de import
  tardio em `cli.py:191`), capturando `ImportError`. `--sem-animacao` define `App.animation_level = "none"`. Dados
  sempre por `automaster_audit.mcp.dump` (`dumps`), nunca lendo arquivo. Cores e bordas só no `tema.tcss`, com os
  tokens do mockup (`--bg #050706`, `--panel #0a0e0c`, `--rule #1d2a24`, `--dim #5d6f66`, `--text #c9d6cf`,
  `--amber #ffb000`, `--cyan #3fd6e6`, `--green #39ff88`, `--err #ff4d4d`) registrados como tema do Textual
  (`App.register_theme`). Rodapé com os atalhos da tela, como no mockup.

## Etapa 6 — Tela principal: quatro abas, contadores e busca

- Tela: sim — telas "2 · workflows/achados/entidades/diff" do mockup.
- Arquivos: `auditor/src/automaster_audit/tui/telas.py` (ou `tui/principal.py`), `tui/tema.tcss`, `auditor/tests/test_tui.py`.
- O que prova: a tela principal mostra os quatro contadores (erro, aviso, info, workflows) e as abas trocadas por
  `1`–`4`. Workflows: tabela com nome, status, passos, erros, avisos e trigger, ordenada por erros; `f` filtra por
  texto. Achados: `e`/`w`/`i` alternam as severidades mostradas. Entidades: `←`/`→` trocam entre tags, campos,
  funis, usuários, formulários e templates; `o` mostra só órfãs. Diff: compara o snapshot aberto com o anterior a ele
  (não os dois mais novos); com um snapshot só, diz "não há snapshot anterior para comparar". `/` abre a busca
  (`buscar`) e Enter num resultado abre o workflow. Esc volta à seleção.
- Como fazer: dados por `inventario` (fatias `workflows`, `tags`, `fields`, `pipelines`, `users`, `forms`,
  `templates`), `achados`, `buscar` e `comparar(loc, antes=<anterior>, depois=<aberto>)` de `mcp/dump.py`; o
  anterior é o snapshot seguinte na lista de `dumps()` (ordem decrescente). Enter em workflow e em entidade chama
  telas que a etapa 7 cria — aqui deixe o Enter emitindo uma mensagem que a etapa 7 conecta, e teste só a troca de aba.

## Etapa 7 — Detalhe do workflow e da entidade

- Tela: sim — telas "3 · detalhe do workflow" e "4 · entidade" do mockup.
- Arquivos: `auditor/src/automaster_audit/tui/detalhe.py`, `tui/telas.py`, `tui/tema.tcss`, `auditor/tests/test_tui.py`.
- O que prova: Enter num workflow (da lista, dos achados ou da busca) abre o detalhe com cabeçalho (nome, status, nº
  de passos), triggers e os passos numa árvore recolhível; o passo que tem achado aparece em vermelho com `✗`;
  `n` pula para o próximo passo com erro; o painel lateral lista os achados do workflow e as referências (campos,
  tags, notificados, quem o chama). Enter numa referência (tag, campo, funil, usuário, formulário, template) abre a
  entidade, que lista cada workflow com seu papel; Enter num deles abre aquele workflow. Esc volta uma tela. Workflow
  sem passos mostra "sem passos". Workflow com mais caminhos que o limite mostra o aviso de corte.
- Como fazer: a árvore vem de `flow.enumerate_paths` (`flow.py:94-136`) agrupada por prefixo como faz
  `path_report._trie` (`path_report.py:80-87`), com rótulos de `path_report.describe_step` (`path_report.py:26-70`) —
  exceção aprovada (decisão A4); use o widget `Tree` do Textual. Achados e referências por `workflow()` e `achados()`
  de `mcp/dump.py`; papéis pelos `usos` das etapas 3 e 4.

## Etapa 8 — Camada cinematográfica

- Tela: sim — tela "0 · abertura", transições, contadores que sobem e pulso de erro do mockup.
- Arquivos: `auditor/src/automaster_audit/tui/app.py`, `tui/abertura.py`, `tui/tema.tcss`, `auditor/tests/test_tui.py`.
- O que prova: com animação `full`, o app abre pela abertura (marca AUTOMASTER com efeito do `textualeffects` e a
  contagem de subcontas, snapshots e workflows) e segue sozinho para a seleção; qualquer tecla pula a abertura; com
  `--sem-animacao` ou `TEXTUAL_ANIMATIONS=none` o app começa direto na seleção. Os contadores da tela principal
  terminam no valor certo. A tela é navegável durante a animação: uma tecla de aba pressionada logo após abrir surte
  efeito. O pulso de ERROR é uma classe CSS alternada, desligada com a animação.
- Como fazer: abertura como `Screen` com `EffectLabel` (ou a `SplashScreen` do `textualeffects`), pulada em
  qualquer `on_key`; checar `self.app.animation_level != "full"` antes de montar. Transição entre telas: `on_mount`
  da tela anima `styles.opacity` de 0 a 1 e `styles.offset` de (4, 0) a (0, 0) em 0,3 s. Contadores: `reactive` int
  animado com `self.animate("valor", alvo, duration=0.9, easing="out_cubic")`. Nos testes, `pilot.wait_for_animation()`
  antes de conferir valores e um teste com `animation_level="full"` para a abertura.

## Etapa 9 — Versão 0.27.0 e documentação

- Tela: não.
- Arquivos: `.claude-plugin/plugin.json`, `extractor/package.json`, `extractor/package-lock.json` (campo version),
  `auditor/pyproject.toml`, `CHANGELOG.md`, `CLAUDE.md`.
- O que prova: `auditor/tests/test_versoes.py` passa com as três versões em 0.27.0 e a seção `## 0.27.0` no changelog.
- Como fazer: seção nova no topo do `CHANGELOG.md` no formato das anteriores (TUI, fatias novas `forms`/`templates`,
  `usos` e `achados` no inventário). No `CLAUDE.md`: o `tui/` na lista de módulos do auditor, a linha
  `.venv/bin/automaster-audit tui` nos comandos com `pip install -e '.[tui]'`, e a nova contagem de testes.

## Etapa 10 — Workflow com id real do GHL abre o detalhe

- Tela: não (conserto; a tela não muda).
- Arquivos: `auditor/src/automaster_audit/tui/detalhe.py`, `auditor/tests/test_tui.py`.
- O que prova: abrir o detalhe de um workflow cujo id é um UUID que começa com número
  (`88bf986f-4905-4582-8369-2874b963b398`, formato real do GHL) mostra o cabeçalho, sem erro; o mesmo para a
  entidade cujo id começa com número. Achado no teste com a Instaltech: `DetalheWorkflow.__init__` grava o id do
  workflow em `self.id`, que no Textual é o id do widget e recusa identificador começado por número.
- Como fazer: renomeie o atributo para `self.wid` (e o equivalente na entidade), sem tocar no `id` do widget.
