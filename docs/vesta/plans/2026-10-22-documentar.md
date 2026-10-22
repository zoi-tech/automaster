# Plano — skill automaster-documentar

**Objetivo:** dar ao plugin uma skill que audita uma subconta e gera o manual do cliente em PDF
no padrão ZOI, com as peças de leitura que ela precisa (status de entrega, ficha por workflow,
11 regras novas) e o gerador de PDF.

- Spec: `docs/vesta/specs/2026-10-22-documentar-design.md` (com as decisões do grill)
- Dossiê: `docs/vesta/research/2026-10-22-documentar-research.md`
- Comando de teste (da raiz): `(cd extractor && npm test) && (cd auditor && .venv/bin/python -m pytest -q)`
- Pastas de tela: `skills/automaster-documentar/manual`
- Mockup: `docs/vesta/mockups/2026-10-22-documentar/index.html`
- Versão desta entrega: 0.33.0 (a 0.32.0 está reservada para a autoevolução).

Regra para todas as etapas: o repositório é público. Nenhum arquivo versionado leva nome de
cliente real, id de subconta, telefone pessoal ou token. Exemplos usam a cliente inventada
"Ribeira Seminovos".

---

## Etapa 0 — Base verde

**Tela:** não.

**Arquivos:** mudar `auditor/tests/test_release_0_31_0.py`.

**O que prova a etapa:** o comando de teste sai verde no estado atual. O teste dos manifestos
continua exigindo que os três manifestos (`.claude-plugin/plugin.json`, `extractor/package.json`,
`auditor/pyproject.toml`) tenham a mesma versão e que ela seja maior ou igual a 0.31.0; falha se
algum manifesto tiver versão menor que 0.31.0 ou se as três forem diferentes entre si.

**Como fazer:** hoje `test_os_tres_manifestos_estao_em_0_31_0` (`auditor/tests/test_release_0_31_0.py:25-31`)
compara cada versão com `ALVO = "0.31.0"` e quebra com a 0.31.1 já publicada. Troque a igualdade
por: as três iguais entre si e `tuple(map(int, v.split("."))) >= (0, 31, 0)`. Mantenha os demais
testes do arquivo como estão.

---

## Etapa 1 — Status de entrega na leitura de conversa

**Tela:** não.

**Arquivos:** mudar `extractor/src/cli/conversas.ts`; criar `extractor/test/conversas-status.test.ts`;
mudar `auditor/src/automaster_audit/mcp/conversas.py` só se a descrição da tool `conversas` citar
os campos devolvidos (acrescente `status` e `erro` na descrição).

**O que prova a etapa:**
- Uma mensagem de saída com `status: "delivered"` sai com `status: "delivered"` e `erro: null`.
- Uma mensagem com `status: "failed"` e erro no campo `error` (texto) sai com `status: "failed"` e
  `erro` com esse texto.
- Erro vindo como objeto (`error: {message: "..."}`) ou em `errorMessage` vira o texto da mensagem.
- Mensagem sem `status` sai com `status: null`.
- Os campos que já existiam (`id`, `data`, `tipo`, `direcao`, `autor`, `origem`, `corpo`,
  `emailMessageId`, `temGravacao`) continuam iguais.

**Como fazer:** o mapeamento está inline em `extractor/src/cli/conversas.ts:52-65`. Extraia para uma
função exportada `resumirMensagem(m)` no mesmo arquivo (ou num `extractor/src/api/conversas-resumo.ts`
se o arquivo da CLI não puder ser importado sem executar nada: `cli/conversas.ts` só registra
comando, então pode) e acrescente `status: m.status ?? null` e `erro`, que é o primeiro de
`m.error` (string), `m.error.message`, `m.errorMessage`, ou `null`. Use a função no `.map`. Testes no
padrão `node:test` + `assert/strict`, como `extractor/test/comum.test.ts`.

---

## Etapa 2 — Ficha por workflow

**Tela:** não.

**Arquivos:** criar `auditor/src/automaster_audit/ficha.py`; mudar `auditor/src/automaster_audit/cli.py`
(subcomando `ficha`); criar `auditor/tests/test_ficha.py`.

**O que prova a etapa:**
- `automaster-audit ficha <dump>` escreve em Markdown uma ficha por workflow, na ordem de pasta e nome.
- Cada ficha traz: nome, status, pasta (nome da pasta ou "fora de pasta"), reentrada
  (`allowMultiple`), parar quando responder (`stopOnResponse`), várias oportunidades
  (`allowMultipleOpportunity`), cada gatilho com tipo, se está ativo e todos os filtros
  (`campo operador valor`), e os passos em ordem de execução.
- Passo de mensagem (`sms`, `whatsapp_v2`, `email`, `internal_notification`) mostra o texto
  (`attributes.body`, `attributes.message`, `attributes.notification.body`), cortado em 300 caracteres.
- Espera mostra a regra (tempo: "1 dia depois"; compromisso: "120 min antes do compromisso").
- `if_else` mostra cada ramo com as condições e os passos dentro do ramo, indentados.
- `find_opportunity` mostra os filtros e os ramos "Opportunity Found"/"Not Found".
- Id de pipeline, estágio, usuário, workflow e tag aparece com o nome ao lado quando o dump tem o nome.
- `--workflow <id>` limita a um workflow; id inexistente sai com erro e código diferente de zero.
- Dump sem workflows gera "nenhum workflow".

**Como fazer:** carregue com `load_dump` (`auditor/src/automaster_audit/loader.py:101`). Configurações em
`wf.raw["detail"]`, pasta em `wf.raw["list_entry"]["parentId"]` (nome da pasta: o dump não guarda;
mostre o id e, quando `parentId` for vazio, "fora de pasta"). Gatilhos em `wf.triggers` (cada um com
`type`, `active`, `conditions: [{field, operator, value}]`). Ordem dos passos: use `flow.roots`,
`flow.successors` e `flow.index_steps` (`auditor/src/automaster_audit/flow.py:19-60`) e
`flow.is_branch_node` para os ramos. Nomes: `ctx.pipeline_names`, `ctx.stage_names`,
`ctx.user_names`, `ctx.workflow_names`. Subcomando no padrão de `paths` (`cli.py:152-155`), com `-o`
opcional (default: stdout). Testes com a fixture `make_dump` (`auditor/tests/conftest.py:26`).

---

## Etapa 3 — Cinco regras diretas

**Tela:** não.

**Arquivos:** criar em `auditor/src/automaster_audit/rules/`: `opportunity_trigger_no_pipeline.py`,
`impossible_time_condition.py`, `appointment_waits_out_of_order.py`, `published_outside_folder.py`,
`exposed_secret.py`; criar `auditor/tests/test_regras_diretas.py`.

**O que prova a etapa** (cada regra só olha workflows `published`, salvo dito):
- `opportunity_trigger_no_pipeline` (WARN): gatilho ativo de tipo `opportunity_created`,
  `opportunity_status_changed`, `pipeline_stage_updated`, `opportunity_decay` ou `opportunity_changed`
  sem condição com `field == "opportunity.pipelineId"`, numa subconta com 2 ou mais pipelines. Com 1
  pipeline não acusa. Com filtro de pipeline não acusa. Gatilho inativo não acusa.
- `impossible_time_condition` (WARN): ramo de `if_else` cujo segmento (condições em E) tem condições
  `conditionType == "date_time"` e `conditionSubType == "time"` que não podem ser verdade juntas
  (ex.: `< 9` e `> 21`; `>= 19` e `< 8`). Segmento em OU não acusa. Intervalo possível (`>= 8` e
  `< 19`) não acusa.
- `appointment_waits_out_of_order` (WARN): num mesmo caminho, uma espera
  `attributes.type == "appointment"` com `appointmentStartAfter.when == "before"` cujo
  `value` é maior ou igual ao de uma espera "before" anterior no mesmo caminho (a de depois nunca
  chega e o passo seguinte é pulado). Esperas em ordem decrescente (4320, 1440, 120, 30) não acusam.
- `published_outside_folder` (WARN): workflow publicado com `list_entry.parentId` vazio. Rascunho fora
  de pasta não acusa.
- `exposed_secret` (ERROR, olha todos os workflows e os custom values): texto em custom value
  (`ctx.custom_values`, campo `value`), em `custom_code` (`attributes.code`), em cabeçalho ou corpo de
  `webhook`/`custom_webhook` que case com chave privada do GHL (`pit-` seguido de 8 hex, hífen e mais
  hex), `sk-` com 20+ caracteres, JWT (`eyJ` + 20 caracteres + ponto) ou `Bearer ` + 20 caracteres. O
  detalhe mostra só os 6 primeiros e os 4 últimos caracteres da chave. `{{custom_values.x}}` não acusa.

**Como fazer:** padrão de regra: módulo com `check(ctx) -> list[Finding]`, descoberto sozinho por
`rules/__init__.py:16-23`; molde `rules/broken_goto.py`. Severidades em `finding.py` (`ERROR`, `WARN`,
`INFO`). Caminho de execução: ancestrais por `flow.parent_of` (`flow.py:38`) ou os caminhos de
`flow.enumerate_paths` (`flow.py:94`). Número de pipelines: `len(ctx.pipeline_ids)`. Teste com
`make_dump`, um caso que acusa e um que não acusa por regra, no estilo de
`auditor/tests/test_warn_info_rules.py`.

---

## Etapa 4 — Três regras de caminho

**Tela:** não.

**Arquivos:** criar em `auditor/src/automaster_audit/rules/`: `create_opportunity_without_lookup.py`,
`notify_owner_after_unassign.py`, `duplicate_reply_responders.py`; criar
`auditor/tests/test_regras_caminho.py`.

**O que prova a etapa** (só workflows `published`):
- `create_opportunity_without_lookup` (WARN): passo `internal_create_opportunity` com
  `attributes.pipelineId = P` sem, entre os ancestrais, um `find_opportunity` filtrado pelo mesmo
  pipeline P (em `attributes.__customInputFields__`, item `filterField == "pipeline_id"` e
  `secondValue == P`) cujo ramo que leva ao passo seja "Opportunity Not Found". Com o
  `find_opportunity` certo antes não acusa; com `find_opportunity` de outro pipeline acusa.
- `notify_owner_after_unassign` (WARN): passo `internal_notification` com
  `attributes.notification.userType == "assign"` que tenha entre os ancestrais um
  `remove_assigned_user` sem `assign_user` entre os dois. Com `assign_user` no meio não acusa.
- `duplicate_reply_responders` (WARN): dois ou mais workflows publicados com gatilho ativo
  `customer_reply` de condições iguais (mesmo conjunto de `field/operator/value`, incluindo nenhum
  filtro) em que cada um tem pelo menos um passo de mensagem ao cliente (`sms`, `whatsapp_v2`,
  `email`). Um finding por grupo, listando os workflows. Condições diferentes não acusam; um dos dois
  sem passo de mensagem não acusa.

**Como fazer:** ancestrais pela cadeia `parentKey` (`flow.parent_of`, `flow.py:38`); para saber o ramo
de um `find_opportunity`, o filho direto é um nó `transition` com `name` "Opportunity Found" ou
"Opportunity Not Found". Gatilhos em `wf.triggers`. Molde e testes como na etapa 3.

---

## Etapa 5 — Três regras por aproximação e a contagem nos textos

**Tela:** não.

**Arquivos:** criar em `auditor/src/automaster_audit/rules/`: `loss_keeps_cadence.py`,
`cadence_without_exit.py`, `ai_leftover_published.py`; mudar `auditor/src/automaster_audit/rules/_helpers.py`
(função de cadência); criar `auditor/tests/test_regras_aproximacao.py`; mudar o número de regras
(de 18 para 29) em `CLAUDE.md`, `skills/automaster-leitura/SKILL.md`, nas descrições de tools em
`auditor/src/automaster_audit/mcp/*.py` e no `help` do `workflow-editar` em `auditor/src/automaster_audit/cli.py:170-172`.

**O que prova a etapa:**
- `cadencias(ctx)` devolve os workflows publicados que têm 2 ou mais passos de mensagem ao cliente
  (`sms`, `whatsapp_v2`, `email`) com pelo menos uma espera de tempo entre eles.
- `loss_keeps_cadence` (INFO): para cada cadência C, nenhum workflow publicado com gatilho
  `opportunity_status_changed` de valor `lost` tem passo `remove_from_workflow` que inclua C
  (`attributes.workflow_id` lista contendo C, ou `allWorkflows: true`). Com a limpeza certa não acusa.
- `cadence_without_exit` (INFO): para cada cadência C entrada por gatilho de oportunidade ou chamada por
  workflow com gatilho de oportunidade, nenhum workflow publicado com gatilho `pipeline_stage_updated`
  ou `opportunity_status_changed` de valor `won` remove o contato de C. Com essa saída não acusa.
- `ai_leftover_published` (INFO): workflow publicado com passo de tipo que contém `ai` como palavra
  (`ai_agent`, `ai_*`), ou `webhook`/`custom_code` cuja URL ou código cite `openai`, `anthropic`,
  `gemini` ou `chatgpt`. Workflow em rascunho não acusa.
- O teste `test_skill_dashboard`/`test_sessao_de_fundo_docs` e o restante da suíte seguem verdes; um
  teste novo confere que `CLAUDE.md` e `skills/automaster-leitura/SKILL.md` não citam mais "18 regras"
  e citam "29 regras".

**Como fazer:** os gatilhos de oportunidade têm a condição de status em
`{"field": "opportunity.status", "value": "lost"|"won"}`. As três regras são INFO e o detalhe diz
"a conferir": podem acusar falso positivo. Molde e testes como na etapa 3.

---

## Etapa 6 — Peças visuais do manual

**Tela:** sim. Implementa o mockup inteiro (`docs/vesta/mockups/2026-10-22-documentar/index.html`)
como modelo reutilizável.

**Arquivos:** criar `skills/automaster-documentar/manual/zoi.css`,
`skills/automaster-documentar/manual/modelo.html`, `skills/automaster-documentar/manual/assets/sol.svg`,
`skills/automaster-documentar/manual/assets/logo-zoi.svg`; criar `auditor/tests/test_manual_pecas.py`.

**O que prova a etapa:**
- `zoi.css` declara no `:root` os tokens do `docs/design/sistema.md` (verde 400/500/900, neutros,
  magenta, fontes, escala de espaço, raios) e as classes de todas as peças: `capa-*`, `cab`, `quadro`,
  `quadro.alerta`, `aviso`, `indice`, `jornada`, `fluxo`, `no`, `no.gatilho`, `no.pergunta`, `no.acao`,
  `no.perda`, `seta`, `ramos`, `ramo`, `rot`, `semana`, `funil`, `tempo`, `zap`, `bolha`, `botoes`,
  `mapa`, `pilula`, `faq`, `folha`.
- `zoi.css` tem a regra de página A4 com margem 20mm 22mm 22mm, capa sem margem e sem rodapé,
  rodapé com o logo à esquerda e `counter(page)` à direita, e `break-before: page` por folha.
- Toda classe usada em `modelo.html` existe em `zoi.css`.
- `modelo.html` não tem `<style>` próprio além de um marcador de onde o gerador injeta o CSS, e
  tem comentários curtos dizendo o que cada peça é e quando usar.
- Nenhum arquivo da pasta tem nome de cliente real, id de 20 caracteres, telefone pessoal ou token;
  o cliente de exemplo é "Ribeira Seminovos".
- Os SVGs abrem como XML válido; o sol usa o caminho vetorial da ZOI.

**Como fazer:** parta do mockup aprovado: o CSS vai do `<style>` do mockup para `zoi.css` (tokens,
peças, `@media print`, `@page` com `@bottom-left` e `@bottom-right`), o corpo vira `modelo.html` com o
marcador `<!-- CSS DA ZOI -->` no `<head>` e `{{CAPA}}` no lugar da seção da capa. Fontes: o CSS usa
`'Clash Display'` e `'Satoshi'` com reserva Helvetica/Arial; o `@font-face` é injetado pelo gerador
(etapa 7), não fica no CSS. `sol.svg`: o caminho do sol está no MD Converter
(`md_converter/app/utils/md_to_pdf.py:14`, constante `_SUN_PATH`, viewBox `0 0 796 801`), já copiado no
mockup. `logo-zoi.svg`: quadrado verde arredondado com o sol em `#364c26` e "ZOI" em `#141414`. O
`.gitignore` ignora `*.png`; não use PNG. Depois do verde, a sessão principal roda a verificação da
vesta-interface no `modelo.html` servido por HTTP local e grava as provas em
`docs/vesta/mockups/2026-10-22-documentar/etapa-6/`.

---

## Etapa 7 — Gerador `manual-pdf`

**Tela:** não (a parte visível é da etapa 6; aqui é o motor).

**Arquivos:** criar `extractor/src/manual/capa.ts`, `extractor/src/manual/fontes.ts`,
`extractor/src/manual/conferencias.ts`, `extractor/src/cli/manual.ts`; mudar `extractor/src/cli.ts`
(registrar); mudar `extractor/test/cli-comandos.test.ts` (lista de comandos ganha `manual-pdf`); criar
`extractor/test/manual.test.ts`.

**O que prova a etapa** (sem abrir navegador; o CI não tem):
- `montarCapa(dados)` devolve o HTML da capa ZOI com título (padrão "Manual"), subtítulo, descrição,
  preparado por, e-mail, telefone e data em DD/MM/AAAA (aceita AAAA-MM-DD); escapa HTML; tamanho do
  título encolhe para título longo (entre 34pt e 65pt).
- `injetar(html, css, capa, fontes)` troca o marcador do CSS e o `{{CAPA}}`; HTML sem marcador gera erro
  que diz o que falta.
- `termosInternos(texto)` acha, com a posição: id de 20+ caracteres alfanuméricos, "workflow", "tag ",
  "trigger", "gatilho", "webhook", "automaster", "Hub", "dump", "→ " seguido de 4 dígitos e "]]",
  `{{` e `}}`. Texto limpo devolve lista vazia. A lista de termos é uma constante exportada.
- `secoesEstouradas(medidas, alturaUtil)` recebe `[{titulo, altura}]` e devolve as que passam da
  altura útil de uma página.
- `caminhoFontes()` aponta para `~/.automaster/fontes/` (ou `AUTOMASTER_FONTES`); `fontesFaces(dir)`
  gera os `@font-face` em data URI a partir dos arquivos que existirem; pasta vazia devolve `""`.
- O comando `manual-pdf` aparece no `--help` com as opções `--html`, `--saida`, `--titulo`,
  `--subtitulo`, `--descricao`, `--preparado`, `--email`, `--telefone`, `--data`.

**Como fazer:**
- Comando no padrão de `extractor/src/cli/dashboards.ts` (função `registrarManual(program)`),
  registrado em `extractor/src/cli.ts`.
- Navegador: `chromium.launch({ channel: "chrome", headless: true })`, como
  `extractor/src/cli/formularios.ts:290` (Chrome do sistema; sem ele, mensagem clara e saída 1).
- Ordem no comando: lê o HTML e o `zoi.css`, que fica em
  `../skills/automaster-documentar/manual/zoi.css` a partir da pasta do extractor (use o caminho do
  próprio módulo, nunca absoluto). Monta a capa a partir do HTML e do CSS da capa do MD Converter
  (`md_converter/app/utils/md_to_pdf.py:17-95` e `:123-184`), já porteados no mockup.
- Fontes: se a pasta de fontes estiver vazia, baixa da Fontshare. Satoshi vem de
  `https://api.fontshare.com/v2/fonts/download/satoshi` e Clash Display de
  `https://api.fontshare.com/v2/fonts/download/clash-display`; os dois são zip, e só os `.otf`/`.woff2`
  dos pesos usados vão para `~/.automaster/fontes/`. Falha de rede: segue sem as fontes e avisa no
  resumo. Depois injeta tudo.
- Renderização e medição: carrega no Chrome com o viewport na largura útil do A4 (210mm − 44mm,
  convertidos a 96 dpi) e `emulateMedia({ media: "print" })`, espera `document.fonts.ready`, mede cada
  `.folha` (altura e o texto do `h2`) e lê o `innerText` para os termos.
- Saída: `page.pdf({ path, printBackground: true, preferCSSPageSize: true })`, conta as páginas pelo
  número de `/Type /Page` do arquivo e imprime um JSON com `pdf`, `paginas`, `secoesEstouradas`,
  `termosInternos` e `avisos`.
- O `@page` com rodapé vem do CSS (decisão A4 da spec): nada de `footerTemplate` nem de juntar PDFs.
- Testes no padrão `node:test`, como `extractor/test/comum.test.ts`.

---

## Etapa 8 — A skill

**Tela:** não.

**Arquivos:** criar `skills/automaster-documentar/SKILL.md`, `skills/automaster-documentar/auditoria.md`,
`skills/automaster-documentar/manual.md`; mudar `CLAUDE.md` (citar a skill onde as outras são citadas,
`CLAUDE.md:24`); mudar `skills/automaster-leitura/SKILL.md:290-294` (a extração pela linha de comando
grava em `~/.automaster/dumps`, como as tools); mudar `.claude-plugin/plugin.json`,
`extractor/package.json`, `extractor/package-lock.json` (as duas ocorrências da versão),
`auditor/pyproject.toml` para 0.33.0; mudar `CHANGELOG.md` (seção 0.33.0); criar
`auditor/tests/test_skill_documentar.py`.

**O que prova a etapa:**
- Frontmatter da skill com `name: automaster-documentar` e `description` em português com "Use ao…",
  no formato que `auditor/tests/test_skill_dashboard.py:41-45` cobra.
- `SKILL.md` cita `auditoria.md` e `manual.md`, diz a ordem (auditoria, depois manual) e as regras
  comuns da spec: só leitura no GHL; extrair de novo antes de ler; ler ao vivo o que muda; conferir a
  entrega do canal pela `conversas` antes de opinar sobre fluxo de mensagem; número e texto só de
  leitura desta rodada.
- `auditoria.md` cita o comando `ficha`, as 11 regras novas pelo nome, a lista de verificação da spec
  e o modelo do relatório com as seções: resumo, urgente, diagnóstico por área, proposta de
  estrutura, ordem sugerida, números de referência. Diz que item "sem uso" entra como pergunta.
- `manual.md` cita o `manual-pdf` pelo caminho `${CLAUDE_PLUGIN_ROOT}`, o `modelo.html`, a estrutura
  de seções, as regras de linguagem e a conferência página a página; ensina a tirar o texto dos
  modelos pela tool `whatsapp` e, vazia, pela Meta com o token pedido a quem administra o Hub, sem
  citar endereço, IP ou credencial.
- Nenhum arquivo da skill tem "abre o navegador" (regex de `auditor/tests/test_sessao_de_fundo_docs.py:21-24`),
  nome de cliente real, id de 20 caracteres ou IP.
- `CLAUDE.md` cita `automaster-documentar`; `skills/automaster-leitura/SKILL.md` não diz mais que a
  CLI grava em `automaster_v2/dumps/`.
- Os três manifestos e o lock em 0.33.0, com seção `## 0.33.0` no `CHANGELOG.md`
  (`auditor/tests/test_versoes.py:29-39`).

**Como fazer:** estilo das skills do repositório: português, seções `## N. Título`, exemplo trabalhado
dentro da skill com a cliente inventada (molde: `skills/automaster-dashboard/SKILL.md`). Conteúdo:
a spec, seções "Regras comuns", "Parte 1" e "Parte 2". No `auditoria.md`, as lições da subconta A entram
sem nome de cliente ("numa subconta de concessionária"). O relatório e o manual saem em `docs/` da
pasta onde a skill roda, com o nome do cliente e a data no arquivo.

---

## Etapa 9 — Prova em duas subcontas

**Tela:** não (as saídas ficam fora do repositório, na pasta do Luccas).

**Arquivos:** criar `docs/vesta/provas/2026-10-22-documentar.md`; criar
`auditor/tests/test_prova_documentar.py`.

**O que prova a etapa:**
- O registro existe e tem duas linhas de prova, "subconta A (concessionária, já reestruturada)" e
  "subconta B (concessionária)", cada uma com: páginas do PDF, seções estouradas = 0, termos internos
  = 0, regras novas que acusaram (contagem por regra), data, e "conferido página a página: sim".
- O registro não tem nome de cliente, id de subconta, telefone nem caminho da pasta do Luccas.

**Como fazer:** a sessão principal roda a skill de ponta a ponta, só lendo:
- Subconta A: refaz o manual da subconta já reestruturada a partir do conteúdo que está na pasta do
  Luccas, agora pelo `manual-pdf`, e compara com o PDF entregue antes (capa, peças, rodapé).
- Subconta B: extração nova, auditoria com relatório, manual com PDF. As duas saídas ficam em
  `docs/` da pasta de trabalho do Luccas, fora do repositório.
- Em ambas, cada página do PDF é lida como imagem antes de registrar.
- O teste lê o registro e cobra os campos. O escritor de teste escreve o teste antes; a sessão
  principal escreve o registro com os números medidos.
