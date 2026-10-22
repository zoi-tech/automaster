# Pesquisa — skill automaster-documentar

Spec: `docs/vesta/specs/2026-10-22-documentar-design.md`

## Achados

### A1 — O repositório é público e a licença das fontes da ZOI proíbe redistribuí-las
- Fonte: `docs/vesta/specs/2026-10-16-autoevolucao-design.md:28` (issues públicas), commit `f2b654c` ("versão pública, sem histórico nem dados de cliente"); licença ITF FFL v2.0, seção 02, no zip oficial `https://api.fontshare.com/v2/fonts/download/satoshi` (`License/FFL.txt`): proíbe distribuir os arquivos por repositório, app ou plataforma a terceiros, e proíbe oferecer a fonte para terceiros gerarem conteúdo; uso interno entre funcionários é permitido; embutir no PDF é permitido.
- Contradiz a spec: sim (spec manda copiar as fontes para `manual/assets/`).
- Pergunta que levanta: as fontes da marca ficam fora do plugin; o gerador baixa da Fontshare na máquina de quem roda (cada um com sua cópia), usa a do MD Converter quando existir, ou cai numa fonte do sistema e o PDF sai sem a tipografia da ZOI?

### A2 — O manual da subconta A e qualquer dado de cliente não podem entrar no plugin
- Fonte: mesmo commit `f2b654c`; teste previsto `auditor/tests/test_sem_ids_reais.py` (`docs/vesta/plans/2026-10-16-autoevolucao.md:383-399`) que falha com id real em arquivo versionado.
- Contradiz a spec: parcial (prova 1 fala em "refazer o manual da subconta A a partir do modelo"; o modelo não pode levar dado da subconta A).
- Pergunta que levanta: o modelo traz um cliente fictício; a prova da subconta A roda fora do repositório, com o conteúdo na pasta de trabalho do Luccas.

### A3 — O extractor abre o Chrome do sistema, não o Chromium do Playwright, e não há Playwright para Python no repo
- Fonte: `extractor/src/tela/perfil.ts:23`, `extractor/src/cli/formularios.ts:290`, `extractor/src/fundo/chrome.ts:103` (`channel: "chrome"`); `extractor/package.json:56` (Playwright Node 1.60); `auditor/pyproject.toml:5-12` (sem Playwright, sem pypdf).
- Contradiz a spec: sim (spec: `gerar_pdf.py` em Python com "o Playwright que o extractor já instala").
- Pergunta que levanta: o gerador vira um comando do extractor em TypeScript, que já tem Playwright e abre o Chrome do sistema, sem dependência nova de Python.

### A4 — O Chrome atual faz rodapé com logo e número de página direto no CSS, numa passada só
- Fonte: teste local em Chrome 155 (`/tmp/mbtest/t.html`): `@page { @bottom-left { content: url(data:...) } @bottom-right { content: counter(page) } }` e `@page :first` sem rodapé geraram capa sem rodapé e corpo numerado a partir de 2, como no MD Converter. Pesquisa externa: `pageRanges` não renumera e o `footerTemplate` não enxerga o CSS nem as fontes da página (https://playwright.dev/docs/api/class-page#page-pdf).
- Contradiz a spec: sim (spec: gerar capa e corpo separados e juntar).
- Pergunta que levanta: sem junção de arquivos e sem pypdf; o gerador fica mais simples e o número da página segue o padrão da ZOI.

### A5 — Medir seção estourada só bate com o viewport na largura útil da página
- Fonte: pesquisa externa, teste com Playwright (`emulate_media('print')` + `getBoundingClientRect`): com viewport 1280px a medida errou de 1,5 para 3 páginas; com a largura útil do A4 em px bateu. Fontes têm que estar carregadas (`document.fonts.ready`).
- Contradiz a spec: não (detalhe de implementação da conferência 2).
- Pergunta que levanta: nenhuma; entra no plano.

### A6 — Nenhuma tool mostra o status de entrega das mensagens
- Fonte: `extractor/src/cli/conversas.ts:54-65` (mapeia id, data, tipo, direção, autor, origem, corpo, sem status); não existe listagem de mensagens recentes da subconta.
- Contradiz a spec: sim (regra "conferir se o canal entrega" sem ferramenta).
- Pergunta que levanta: acrescentar o status e o erro de cada mensagem na tool `conversas` (mudança pequena), e a skill lê as conversas dos últimos contatos que passaram pelos workflows de mensagem?

### A7 — As tools não mostram as configurações de workflow nem os filtros dos gatilhos que a auditoria precisa
- Fonte: `auditor/src/automaster_audit/mcp/dump.py:72-89` (tool `workflow` sem `stopOnResponse`, `allowMultiple`, `allowMultipleOpportunity`, pasta) e `auditor/src/automaster_audit/dashboard.py:175` (gatilho só com nome); o dump tem esses campos em `raw.detail` e `raw.list_entry`; nenhuma das 18 regras cobre os itens da lista de verificação, só vizinhos (`broken_user_ref`, `uncovered_condition`, `dead_end_draft`).
- Contradiz a spec: parcial (spec manda ler essas configurações sem dizer como).
- Pergunta que levanta: a auditoria ganha um comando que gera uma ficha compacta por workflow (gatilhos com filtros, configurações, passos com texto e esperas) a partir do dump, para a skill ler, ou os itens da lista viram regras automáticas do auditor?

### A8 — Texto dos modelos de WhatsApp já existe numa tool, mas depende da conta estar ligada ao GHL
- Fonte: tool `whatsapp` com `o=templates` (`auditor/src/automaster_audit/mcp/conversas.py:152-160`, `extractor/src/api/whatsapp.ts:49-57`), devolve `components` com o texto. Na subconta A, o GHL perdeu acesso ao número quando as linhas foram para a ZOI Hub; o texto veio da Graph API da Meta. O endereço do cabeçalho de localização não fica no modelo, vai no envio (https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/components).
- Contradiz a spec: não.
- Pergunta que levanta: nenhuma; a skill lê pela tool e, se vier vazio, pela Meta; endereço vem do passo do workflow.

### A9 — Teste no CI não pode abrir o Chrome
- Fonte: `.github/workflows/ci.yml:20-23` ("nenhum teste abre Chrome").
- Contradiz a spec: sim (prova 3 gera PDF).
- Pergunta que levanta: no CI só as partes puras (montagem da capa, busca de termos internos, medida a partir de números); a geração real do PDF é prova manual da etapa.

### A10 — `*.png` está no `.gitignore`
- Fonte: `.gitignore:18`.
- Contradiz a spec: sim (logo PNG em assets).
- Pergunta que levanta: nenhuma de produto; o sol já existe em vetor no MD Converter (`md_converter/app/utils/md_to_pdf.py:14`) e o logo vira SVG.

### A11 — Mudança no plugin sobe versão e CHANGELOG, e a 0.32.0 já está reservada
- Fonte: `CLAUDE.md:24`, `auditor/tests/test_versoes.py:29-39`, `docs/vesta/plans/2026-10-16-autoevolucao.md:425`.
- Contradiz a spec: parcial (spec não fala de versão).
- Pergunta que levanta: nenhuma de produto; o plano usa a próxima versão livre no momento do merge.

### A12 — Skill nova segue o padrão das outras e há teste que varre a pasta skills/
- Fonte: `skills/automaster-dashboard/SKILL.md:1-4`, `auditor/tests/test_skill_dashboard.py:41-45`, `:207-208` (exige a skill citada no `CLAUDE.md`), `auditor/tests/test_sessao_de_fundo_docs.py:21-24` (proíbe "abre o navegador" no texto das skills).
- Contradiz a spec: não.
- Pergunta que levanta: nenhuma; entra no plano (teste `test_skill_documentar.py`, citação no `CLAUDE.md`).

### A13 — A raiz do plugin vem de `CLAUDE_PLUGIN_ROOT`; a equipe não tem o repositório clonado
- Fonte: `commands/automaster-audit.md:10-12`, `bin/automaster-python.sh:4-6`, `docs/vesta/specs/2026-10-16-autoevolucao-design.md:11-12`.
- Contradiz a spec: não.
- Pergunta que levanta: nenhuma; o gerador não usa caminho absoluto.

### A14 — As duas pastas de dump já foram unificadas
- Fonte: `extractor/src/cli/shared.ts:13`, `auditor/src/automaster_audit/mcp/base.py:40`, `CHANGELOG.md:57-59`; a `automaster-leitura` ainda descreve o comportamento antigo (`skills/automaster-leitura/SKILL.md:290-294`).
- Contradiz a spec: não.
- Pergunta que levanta: nenhuma; corrigir a frase velha da leitura junto.

### Correção de leitura
O pesquisador leu a paleta antiga no começo do HTML da subconta A; o padrão ZOI vem num bloco que sobrescreve no fim do mesmo arquivo. O visual da subconta A já é ZOI de ponta a ponta.

## Fila do grill

1. A1 — fontes da ZOI fora do plugin: de onde vêm na hora de gerar.
2. A7 — como a auditoria lê configurações e filtros: ficha por workflow ou regras automáticas.
3. A6 — status de entrega na tool `conversas`.
4. A3 + A4 — gerador como comando do extractor em TypeScript, numa passada só.
5. A2 + A9 — exemplo fictício no repositório; prova da subconta A fora do repositório; CI só com as partes puras.
