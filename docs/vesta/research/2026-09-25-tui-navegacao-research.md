# Pesquisa — TUI navegação do dump

Spec: `docs/vesta/specs/2026-09-25-tui-navegacao-design.md`

## Achados

### A1 — A lista de workflows não traz contagem de achados
- Fonte: `auditor/src/automaster_audit/dashboard.py:131-147`, `mcp/dump.py:96-111`
- Contradiz a spec: parcial
- Pergunta que levanta: a TUI conta os achados por workflow cruzando com `achados()` (lógica pequena na tela) ou a contagem entra no `inventario` e o MCP ganha junto?

### A2 — Papéis por workflow só existem em `dashboard._wf_refs`, e só para tags
- Fonte: `dashboard.py:36`, `dashboard.py:109-120`, `dashboard.py:159-186`
- Contradiz a spec: sim
- Pergunta que levanta: a tela de entidade mostra "quem usa e com que papel" só para tags, ou expomos `_wf_refs` para campos, funis e usuários também, mudando o auditor?

### A3 — Formulários e templates não estão no `inventario`
- Fonte: `mcp/base.py:32`
- Contradiz a spec: sim
- Pergunta que levanta: a aba Entidades fica com tags, campos, funis e usuários, ou acrescentamos formulários e templates ao `inventario` (o MCP ganha também)?

### A4 — O detalhe do workflow devolve os caminhos como texto cortado, não árvore
- Fonte: `mcp/dump.py:78-81`, `flow.py:94`
- Contradiz a spec: sim
- Pergunta que levanta: para ter árvore navegável com Enter nas referências, a TUI precisa ler `flow` direto, quebrando a regra "só pelo `mcp/dump.py`". Aceita essa exceção?

### A5 — `comparar` sempre compara os dois snapshots mais novos
- Fonte: `mcp/dump.py:160-170`
- Contradiz a spec: parcial
- Pergunta que levanta: nenhuma de decisão; a TUI passa `antes`/`depois` explícitos quando o snapshot escolhido não é o mais novo.

### A6 — Dump recusado só aparece ao abrir, como `ToolError`
- Fonte: `mcp/base.py:43-47`, `mcp/base.py:75-80`
- Contradiz a spec: parcial
- Pergunta que levanta: marcar "indisponível" na seleção exige abrir todos os snapshots de antemão (lento, e estoura o cache de 8). Aceita que o erro apareça só ao escolher o snapshot?

### A7 — Os testes da TUI nunca rodariam no CI
- Fonte: `.github/workflows/ci.yml` (instala só `.[dev]`)
- Contradiz a spec: sim
- Pergunta que levanta: o CI instala o extra `tui` junto (os testes rodam, CI um pouco mais pesado) ou os testes ficam pulados em silêncio?

### A8 — Subcomando novo sobe a versão do plugin
- Fonte: `CLAUDE.md:30`, `auditor/tests/test_versoes.py`, `cli.py:327-345`
- Contradiz a spec: não (a spec só omite). Entram: versão nas três, `CHANGELOG.md`, `tui` na lista de subcomandos do `main`, módulo no `CLAUDE.md`.

### A9 — Textual não tem transição nativa entre telas
- Fonte: https://github.com/Textualize/textual/discussions/2611
- Contradiz a spec: não. Transições saem de `styles.animate` em `opacity`/`offset` na montagem da tela; em 256 cores o fade vira degraus.

### A10 — Textual já tem o desliga-animação oficial
- Fonte: https://textual.textualize.io/api/constants/ (`TEXTUAL_ANIMATIONS=none|basic|full`, `App.animation_level`)
- Contradiz a spec: parcial
- Pergunta que levanta: `--sem-animacao` vira só um atalho para `animation_level="none"`, e a abertura respeita a mesma chave. Sem decisão, só registro.

### A11 — Abertura pronta: `textualeffects` (TTE dentro do Textual)
- Fonte: https://pypi.org/project/textualeffects
- Contradiz a spec: não
- Pergunta que levanta: usar essa segunda dependência para a abertura (efeitos prontos, compatibilidade com Textual 8 não confirmada) ou fazer a abertura à mão com `animate`?

### A12 — Testes com animação são instáveis
- Fonte: https://textual.textualize.io/guide/testing/
- Contradiz a spec: não. Testes rodam com `TEXTUAL_ANIMATIONS=none` ou `pilot.wait_for_animation()`.

### A13 — Referências visuais
- Fonte: Posting, Harlequin, Dolphie, Toolong (repos no GitHub); inspo `recommend` (warp.dev) pouco útil, é web.
- Contradiz a spec: não. Alimentam o mockup.

## Fila do grill

1. A4 — exceção à regra de leitura só pelo `mcp/dump.py` (trava A2, A3)
2. A2 — papéis para todas as entidades ou só tags
3. A3 — formulários e templates na aba Entidades
4. A1 — onde nasce a contagem de achados por workflow
5. A6 — erro de dump na seleção ou ao abrir
6. A7 — testes da TUI no CI
7. A11 — abertura com `textualeffects` ou à mão
