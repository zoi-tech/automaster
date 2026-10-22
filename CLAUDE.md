# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## O que é este projeto

Automaster v2: ferramenta de backup e auditoria de automações GoHighLevel (GHL). Extrai todos os workflows de uma subconta usando a API interna (`backend.leadconnectorhq.com`) — a mesma observada na aba Network do Chrome — com autenticação capturada via Playwright.

Docs-chave (leia antes de mudança estrutural):
- Spec: `docs/superpowers/specs/2026-06-10-automaster-extractor-design.md`
- Endpoints da API interna mapeados: `docs/endpoints.md`
- **Próximo trabalho (Camadas 2 e 3 de validação): `docs/superpowers/plans/2026-06-10-validation-layers-2-3-plan.md`** — contém o modelo do grafo de execução já reverso-engenheirado. NÃO re-derivar.

## Arquitetura (big picture)

Duas partes independentes que se comunicam **exclusivamente por arquivos JSON** em `~/.automaster/dumps/` (raiz configurável por `AUTOMASTER_DUMPS`; o extractor também cai em `~/.automaster/dumps` sem a env):

- **`extractor/`** — TypeScript + Playwright. Um processo de fundo (`src/fundo/`: `comum.ts`, `servidor.ts`, `chrome.ts`, `cliente.ts`, `processo.ts`, `main.ts`) é o único dono do perfil `~/.automaster/chrome-profile`, mantém um Chrome invisível logado e entrega os tokens por um socket Unix em `~/.automaster/sessao/sock` (contrato em `docs/sessao-de-fundo.md`); a janela só aparece quando o GHL pede login. Está dividido em `src/api/` (uma função por rota) e `src/cli/` (um módulo por domínio, cada um exportando `registrarX(program)`; `cli.ts` só junta e `cli/shared.ts` guarda sessão, raiz dos dumps e rastro de escrita — importar o `cli.ts` executa o programa, então módulo de comando nunca importa de lá). O processo de fundo intercepta **dois tokens** de auth (`authorization: Bearer` + `token-id` Firebase) dos requests reais do app; cada comando os pede pelo socket e chama a API interna direto por `fetch`. Em `401`, pede `/renovar`. Comando ao vivo: 1,7 s com o processo de pé (era 4,6 s com o Chrome visível a cada comando); a primeira chamada depois de 4 h paradas sobe o processo (7,4 s). Tokens nunca vão para disco; a sessão do GHL (só cookies e localStorage dos domínios do GHL) vai para `~/.automaster/sessao/estado-ghl.json`, 0600, para o Playwright MCP importar. Extrai workflows + 11 entidades: pipelines, tags, custom_fields, users, calendars, custom_values, **message_templates, whatsapp_templates, email_templates, forms, surveys** (as cinco últimas opcionais: canal desligado ou busca que falha vira warning no manifest).
- **`auditor/`** — Python (src/ layout, `src/automaster_audit/`). Lê um dump e produz saídas de texto na pasta do dump (sem interface):
  - `report.md`/`report.json` — auditoria (`automaster-audit audit`)
  - `paths.md` — árvore de caminhos de execução por workflow, camada 2 (`automaster-audit paths`)
  - `diff.md` — o que mudou entre dois snapshots da mesma subconta (`automaster-audit diff <antigo> <novo>`)
  - ficha por workflow em Markdown: configurações, gatilhos com filtros e passos na ordem (`automaster-audit ficha <dump> [--workflow ID] [-o arquivo]`, stdout sem `-o`)

Plugin do Claude Code (raiz do repo): `.claude-plugin/plugin.json`, `.claude-plugin/mcp.json` (servidor `automaster` via `bin/automaster-python.sh`, shim que exige Python ≥ 3.12), `hooks/` (SessionStart de diagnóstico), `commands/automaster-{extract,audit}.md`, `skills/automaster-leitura/`, `skills/automaster-formulario-visual/` (identidade visual de formulário/survey — tokens que a tool `formulario_estilo` aplica), `skills/automaster-dashboard/` (método do painel do GHL: leitura, entrevista, plano, montagem, loops visual e de dados, publicação), `skills/automaster-documentar/` (auditoria das automações em relatório interno e manual do cliente em PDF no padrão ZOI, só leitura; o PDF sai pelo comando `manual-pdf` do extractor, a partir do `manual/modelo.html` da skill). A config MCP fica **fora da raiz de propósito**, apontada pelo campo `mcpServers` do plugin.json: um `.mcp.json` na raiz o Claude Code também carrega como servidor de projeto, e nesse contexto `${CLAUDE_PLUGIN_ROOT}` não expande — o servidor falha com ENOENT em toda sessão aberta no repo. O servidor `mcp_server.py` tem só o protocolo: as tools moram em `auditor/src/automaster_audit/mcp/`, um módulo por domínio (`base` com o que todos usam, mais `dump`, `contato`, `conversas`, `tags`, `oportunidades`, `agenda`, `formularios`, `workflows`, `emails`, `paineis`), cada um com a própria fatia do dict `TOOLS`; o `mcp_server` junta as fatias e re-exporta as funções. Tool nova entra no módulo do domínio, não no `mcp_server`. São trinta e seis tools (`dumps`, `comparar`, `inventario`, `workflow`, `achados`, `buscar`, `jornada`, `contato`, `conversas`, `conversa_acao`, `enviar`, `whatsapp`, `whatsapp_enviar`, `config`, `grupo`, `editar`, `oportunidades`, `oportunidade_acao`, `pipeline`, `agenda`, `agenda_acao`, `formularios`, `formulario_acao`, `formulario_estilo`, `workflows_ao_vivo`, `workflow_acao`, `workflow_editar`, `modelos_email`, `anotacoes`, `anotacao_acao`, `tags`, `tag_acao`, `dashboards`, `dashboard_acao`, `dashboard_ver`, `dashboard_conferir`) e **importa o auditor como biblioteca**, nunca lê o dump direto. Spec: `docs/superpowers/specs/2026-09-18-automaster-plugin-design.md`. **Versões do plugin em `CHANGELOG.md`** — mudança que altere o comportamento do plugin instalado sobe a versão no plugin.json e entra lá. As TRÊS versões andam juntas (`plugin.json`, `extractor/package.json`, `auditor/pyproject.toml`) e a seção correspondente precisa existir no `CHANGELOG.md`: `auditor/tests/test_versoes.py` falha se divergirem.

**Um processo de fundo, uma fila de escrita.** O processo de fundo trava `~/.automaster/chrome.lock` (`src/auth/lock.ts`) e é o único que abre o perfil: nenhum outro Chrome nem outro projeto o abre (quem precisa de token pede pelo socket; quem precisa de tela usa perfil próprio, decisão A45). Leitura roda em paralelo entre sessões e processos; escrita espera a vez numa fila da máquina (`~/.automaster/sessao/escrita.lock`, até 2 min) que cobre o comando inteiro — até a 0.27.0 duas escritas disputavam o perfil, e na validação de formulários isso gerou uma cópia e uma exclusão que ninguém pediu (`docs/endpoints.md`). Dentro de uma sessão do Claude Code o servidor MCP é serial: as tools esperam a vez. Erros do envelope: `login_pendente` (alguém precisa entrar na janela do Chrome) e `sessao_indisponivel` (`npm run sessao -- --acao status`).

**A saída `--json` da CLI é um envelope** (`extractor/src/saida.ts`): `{ok, data}` ou `{ok:false, error:{code, message}}`, mais `escrita:{tentada, rastros}` quando um PUT/POST/DELETE saiu de verdade. É o contrato que o servidor MCP lê (`mcp/base.py:_run_extractor`, que desembrulha `data`); comando novo emite por `emitir(opts.json, dado)` e erra por `.catch(falhar)`, nunca por `console.log(JSON.stringify(...))`. Sem `--json` a saída segue pretty, para gente.

Módulos do auditor: `mcp/` (as tools do servidor MCP), `loader.py` (monta `DumpContext`), `flow.py` (grafo de execução dos steps), `rules/` (registry via `pkgutil`, 1 arquivo por regra, severidade ERROR/WARN/INFO, função `check(ctx)->list[Finding]`), `report.py`, `dashboard.py` (inventário, usado pelas tools MCP) e `journey.py` (árvore de jornada do contato, usada pelas tools MCP).

**Índice reverso com papel:** `dashboard._wf_refs` varre steps **e** triggers; cada tag tem `papeis` (`dispara`/`adiciona`/`remove`/`condicao`). Tag só citada em trigger ou condição não é órfã.

**Regras de auditoria (29):** refs quebradas `broken_{tag,pipeline,field,workflow,user,custom_value,template}_ref` (ERROR; `template` cobre WhatsApp e SMS — e-mail tem regra própria); `workflow_unreachable` (sem entrada; cruza `add_to_workflow`); camada 1 lógica `unreachable_step`/`broken_goto`/`workflow_call_cycle`/`uncovered_condition`; `broken_form_ref` (ERROR; formulário/survey citado por trigger ou por `formId` de calendário que não existe mais — id `fb-` é o lead gen do Facebook e nunca acusa); `stale_email_template` (WARN; step de e-mail cujo template sumiu do builder — o id sai do `previewUrl`, nunca do `template_id`, e o e-mail continua sendo enviado, só não dá mais para editá-lo pelo app); `naming_convention`/`dead_end_draft`/`unused_form`/`unused_email_template` (INFO).
- `exposed_secret` (ERROR): chave de API ou token escrito direto em custom value, custom code ou webhook.
- `published_outside_folder` (WARN): workflow publicado fora de qualquer pasta.
- `opportunity_trigger_no_pipeline` (WARN): gatilho de oportunidade sem filtro de pipeline numa subconta com 2+ pipelines.
- `duplicate_reply_responders` (WARN): dois ou mais workflows publicados respondem à mesma resposta do cliente.
- `impossible_time_condition` (WARN): ramo de if/else com condições de horário em E que nunca são verdade juntas.
- `appointment_waits_out_of_order` (WARN): espera "antes do compromisso" maior ou igual a uma anterior do mesmo caminho.
- `create_opportunity_without_lookup` (WARN): cria oportunidade sem antes procurar uma no mesmo pipeline.
- `notify_owner_after_unassign` (WARN): notifica o dono do contato depois de tirar o dono sem atribuir outro.
- `loss_keeps_cadence` (INFO, a conferir): cadência que nenhum workflow de oportunidade perdida (`lost`) remove.
- `cadence_without_exit` (INFO, a conferir): cadência entrada pela oportunidade sem saída na mudança de etapa ou na venda (`won`).
- `ai_leftover_published` (INFO, a conferir): passo de IA, ou webhook/custom code que cita provedor de IA, em workflow publicado.

O contrato entre as partes é o formato do dump (`<raiz>/<locationId>/<YYYY-MM-DD_HHmm>/`), descrito em **`auditor/src/automaster_audit/dump_schema.json`** e conferido pelos dois lados — o extractor no fim da extração (`src/dump/schema.ts`, aviso) e o auditor ao carregar (`dump_schema.py`, recusa). Mudou a forma? Muda o schema junto, senão o dump novo é recusado: `manifest.json` com `schemaVersion` + envelopes com `raw` = resposta da API **intocada**. Workflows: `raw` mescla 4 fontes (`list_entry`, `detail`, `steps` [do Firebase], `triggers`). As **actions vivem em `raw.steps.templates`**, não no `detail`. Entidades: `{fetchedAt, raw:<resposta API>}`. Nunca transformar/limpar o `raw`. Mudou o formato? Incremente `schemaVersion` e atualize o loader.

## Comandos

```bash
# Extractor (em extractor/)
npm install && npx playwright install chromium
npm run extract -- --location <locationId>    # extração completa
npm run sessao -- --acao status --json        # processo de fundo: status | subir | encerrar | tokens | renovar
npm run timeline -- -l <loc> -i <contactId> --json  # eventos do contato em JSON (stdout)
npm run contato-editar -- -l <loc> -i <contactId> --set campo=valor --tag +x --json  # edita campos/tags do contato
npm run conversas -- -l <loc> -i <contactId> --json  # mensagens trocadas com o contato (leitura)
npm run conversas-enviar -- -l <loc> -i <contactId> --tipo InternalComment --texto "..." --json  # ESCREVE: envia mensagem
npm run conversas-buscar -- -l <loc> --termo "texto" --json          # busca em todas as conversas da subconta
npm run conversas-anexar -- -l <loc> -i <contactId> --arquivo ./foto.png --json  # sobe anexo, devolve URLs
npm run whatsapp -- -l <loc> -o templates --json          # templates/flows/números do WhatsApp (leitura)
npm run whatsapp-enviar -- -l <loc> -i <id> --template <tid> --confirmo --json  # ESCREVE: template aprovado
npm run config -- -l <loc> -o sla --json                  # IA e SLA das conversas (ia|sla|sla-status|sla-permissao)
npm run grupo -- -l <loc> -o interno-checar --corpo '{}'  # group chat e chat interno
npm run conversas-marcar -- -l <loc> -i <contactId> --acao lida      # lida/nao-lida/estrela/sem-estrela/apagar
npm run conversas-rascunho -- -l <loc> -i <contactId> --acao listar  # criar/listar/apagar rascunho
npm run conversas-mensagem -- -l <loc> --acao cancelar --id <msgId>  # cancela agendada / reenvia
npm run oportunidades -- -l <loc> -o pipelines --json     # funis, cards, busca (leitura ao vivo)
npm run oportunidade-acao -- -l <loc> --acao mover -i <id> --estagio <sid> --confirmo --json  # ESCREVE: card
npm run pipeline -- -l <loc> --acao editar -i <id> --estagios '[...]' --confirmo --json       # ESCREVE: estrutura do funil
npm run formularios -- -l <loc> -o lista --json           # formulários, surveys e submissões (leitura ao vivo)
npm run formulario-acao -- -l <loc> --acao criar --tipo formulario --nome "..." --confirmo --json  # ESCREVE: criar/editar/duplicar/apagar/restaurar formulário ou survey
npm run formulario-estilo -- -l <loc> --acao aplicar --tipo formulario -i <id> --tokens '{...}' --confirmo --json  # ESCREVE: identidade visual (fieldStyle/customStyle) e paleta padrão
npm run agenda -- -l <loc> -o eventos --calendario <id> --inicio <isoComFuso> --fim <isoComFuso> --json  # calendários, livres, eventos, bloqueios, notas (leitura ao vivo)
npm run agenda-acao -- -l <loc> --acao marcar --calendario <id> --contato <contactId> --inicio <isoComFuso> --fim <isoComFuso> --situacao new --confirmo --json  # ESCREVE: marca/remarca/situacao/cancela/notas
npm run agenda-acao -- -l <loc> --acao bloquear --dono <userId> --inicio <isoComFuso> --fim <isoComFuso> --confirmo --json  # ESCREVE: bloqueia horário na agenda de um usuário
npm run workflows-ao-vivo -- -l <loc> -o dentro -i <workflowId> --json    # quem está dentro de um workflow, ao vivo
npm run workflow-acao -- -l <loc> --acao inscrever -i <workflowId> --contato <contactId> --confirmo --json  # ESCREVE: publica/despublica, inscreve, remove ou retoma
npm run workflow-editar -- -l <loc> --acao trocar-ref -i <workflowId> --de <idVelho> --para <idNovo> --confirmo --json  # ESCREVE: estrutura (criar/renomear/mover/duplicar/apagar/trocar-ref/trocar-tag/limpar-orfaos/atributo/trigger/historico/configuracao/step-criar/step-remover/step-mover); sem --confirmo é prévia; camada CRUA, grava sem as 29 regras
npm run workflow-editar -- -l <loc> --acao step-criar -i <wid> --depois-de <stepId> --corpo '{"type":"sms",...}' --confirmo --json  # ESCREVE: monta o canvas (step-criar/step-remover/step-mover)
npm run anotacoes -- -l <loc> --contato <contactId> --tipo nota --json   # notas e tarefas do contato (leitura ao vivo)
npm run anotacao-acao -- -l <loc> --contato <id> --tipo tarefa --acao criar --titulo "..." --prazo <iso> --confirmo --json  # ESCREVE: nota/tarefa
npm run tags -- -l <loc> --json                                          # tags da subconta (leitura ao vivo)
npm run tag-acao -- -l <loc> --acao renomear --tag <nomeOuId> --nome <novo> --confirmo --json  # ESCREVE: tag da subconta
npm run dashboards -- -l <loc> -o lista --json            # painéis nativos do GHL: lista|detalhe|catalogo|versoes|dados|fuso (leitura ao vivo)
npm run dashboard-acao -- -l <loc> --acao criar --titulo "..." --confirmo --json  # ESCREVE: criar|editar|tema|renomear|apagar|restaurar|publicar; sem --confirmo é prévia
npm run dashboard-ver -- -l <loc> -i <id> --json          # PNG do painel no perfil de tela (usa a sessão salva; --login só sem ela)
npm run dashboard-conferir -- -l <loc> -i <id> --dias 30 --json  # recontagem de cada widget: bate | diverge | sem_conferencia
npm run smoke -- -l <loc> [--contato <id>] --json         # confere se as rotas de leitura ainda respondem na forma esperada
npm run smoke -- -l <loc> --contato <id> --gravar test/fixtures/api-forma.json  # regrava o cassete que o CI reproduz
npm run discover -- --location <locationId>   # observar requests ao backend
npm run typecheck                              # tsc sobre src E test (tsconfig.check.json)
npm run lint                                   # eslint + typescript-eslint
npm test                                       # suíte (772 testes)

# Auditor (em auditor/) — usa venv: .venv/bin/...
python -m venv .venv && .venv/bin/pip install -e .
.venv/bin/automaster-audit audit dumps/<loc>/<ts>/        # report.md + report.json
.venv/bin/automaster-audit paths dumps/<loc>/<ts>/        # paths.md (árvore de caminhos)
.venv/bin/automaster-audit verify-contracts dumps/<loc>/<ts>/ --contracts contracts/  # contratos PASS/FAIL/AMBIGUOUS
.venv/bin/automaster-audit diff dumps/<loc>/<ts-antigo>/ dumps/<loc>/<ts-novo>/  # diff.md (o que mudou)
.venv/bin/automaster-audit workflow-editar -l <loc> --acao trocar-tag -i <wid> --de x --para y --confirmo  # ESCREVE workflow COM a validação das 29 regras
.venv/bin/python -m pytest -q                             # suíte (660 testes)
.venv/bin/ruff check src tests && .venv/bin/ruff format --check src tests  # lint + formatação
AUTOMASTER_DUMPS=~/.automaster/dumps .venv/bin/python -m automaster_audit.mcp_server  # servidor MCP (stdio)

# Plugin (raiz do repo)
claude plugin marketplace add .   # registra o marketplace local 'zoi'
claude plugin install automaster@zoi
.venv/bin/python -m pytest tests/test_broken_tag_ref.py   # uma regra só
```

Subconta de validação: `idTeste0000000000004` (subconta de teste, 72 workflows). O perfil do processo de fundo costuma já estar logado → `extract` reusa sem novo login.

## Pontos críticos

- **API interna não-documentada, muda sem aviso.** Endpoints hardcoded em `extractor/src/api/*.ts` (catálogo em `docs/endpoints.md`). Quebrou? Rode `discover`, re-mapeie, atualize o doc.
- **Dois esquemas de auth:** workflows aceitam só `Bearer`; entidades `locations/*` e `opportunities/*` exigem `token-id`. UA de browser obrigatório (UA não-browser → 403).
- **Steps vêm do Firebase no extrator de hoje** (`detail.fileUrl`, URL pré-assinada, baixada **sem** headers de auth — nunca mandar auth nessa chamada). Mas o detalhe da API **já traz os steps completos** em `workflowData` (medido em 1.041 workflows, zero divergência), e é de lá que a ESCRITA os lê: `workflow-editar` nunca toca no Firebase.
- **Trigger não se edita pelo documento.** O `GET` do workflow não traz a lista (só `triggersFilePath`); ela vem de `GET /workflow/<loc>/trigger?workflowId=<wid>`. Escreve-se por rota dedicada: `POST .../trigger` cria e `DELETE .../trigger/<tid>?workflowId=<wid>` apaga. Apagar trigger NÃO incrementa o `version` do workflow, então a guarda de concorrência desse
  caminho é a lista de ids (`--triggers-esperados`), não a versão. **No POST o corpo leva `workflowId` em camelCase** — com `workflow_id`, que é como a leitura devolve o campo, o servidor responde 200 com id e o trigger nasce órfão. `only-triggers` responde 200 sem criar nada, com ou sem `newTriggers`. Encadeamento de step é `parentKey`; `parent` é o campo legado, ainda presente em parte dos steps e às vezes o único — os dois lados leem os dois (`flow.parent_of`, `workflow-edit.paiDe`).
- **Workflow criado por API nasce invisível**: sem `status` e, sem pasta, com `parentId` vazio — a API o lista, a interface não. `criar`/`duplicar` exigem `--pasta` e rodam `nascerVisivel` depois. A URL do editor é `workflow` no SINGULAR (`/automation/workflow/<wid>`); com o plural o app dá 404 e a página fica branca.
- **Lista de workflows:** `?type=workflow` (lista plana); `parentId=root` só traz pastas.
- **Tag em workflow é o NOME, nunca o id** — em step, em trigger e em condição (34 de 34 no
  dump da subconta de teste). Renomear pela API **propaga**: o servidor reescreve a referência nos
  três lugares, provado ao vivo em 2026-09-21. Quem quebra é apagar, que arranca a tag de
  todos os contatos — daí a guarda `apagar_citada`. Não existe contagem de contatos por tag
  em lugar nenhum do GHL, então nenhuma prévia estima esse número.
- **Criar tarefa exige `completed`** além de `title` e `dueDate`; a CLI manda `false` sozinha.
  A data é texto ISO, o inverso da agenda, onde ISO devolve lista vazia em silêncio. Tarefa
  criada sem dono fica mesmo sem responsável, e a busca por subconta ainda mostra por um tempo
  a tarefa já apagada — a leitura por contato é a fonte confiável.
- **CI em `.github/workflows/ci.yml`**: typecheck, lint (`eslint` no extractor, `ruff check` + `ruff format --check` no auditor) e as duas suítes em todo push e PR. O smoke das rotas ao vivo NÃO roda lá — o extractor precisa do processo de fundo logado —, é `npm run smoke -- -l <loc>` na máquina de quem já está logado, e é o que avisa que a API interna mudou antes de o cliente avisar.
- **Painéis (dashboards) nativos:** nascem privados e só `publicar` os abre, com `--confirmo`, depois do loop visual (`dashboard-ver`) e do loop de dados (`dashboard-conferir`); `publicar` recusa se a última conferência tem `diverge` (salvo `--forcar`). Todo `/reporting/` leva o header `x-reporting-api-version: 3`, senão o PUT dá 409. Widget novo exige `_id` ObjectId de 24 hex e `editar` faz 2 PUTs (cria, depois posiciona). Layout acha o item só pelo `_id` da linha de `dashboardWidgets`, nunca por `widgetId`. Tema vai aninhado (`dashboardTheme`/`widgetTheme`); plano é ignorado. `criar` já grava o tema branco (fundo `#FFFFFF`, a cor da marca de `--cor-marca`, padrão `#1F7A3A`, em números, linhas e barras); `tema` troca só o que vier. A composição avisa `painel_simploria` (menos de 12 widgets), `numero_alto_demais` (número com altura acima de 4) e `sem_secoes` (mais de 8 widgets sem `object-title`). O histórico de versões está desligado na subconta, então `restaurar` não tem para onde voltar. O perfil de tela do `dashboard-ver` é separado do perfil de fundo (decisão A45) e importa a sessão salva em `estado-ghl.json`, então não pede login; `--login` é a reserva. Método completo na skill `automaster-dashboard`; rotas em `docs/endpoints.md` seção `## Dashboards`.
- **Rate limit conservador** (~0,2s entre chamadas, backoff em 429). Falha em workflow individual → warning no manifest, segue.
- **Os steps do canvas se montam por `step-criar`/`step-remover`/`step-mover`**, e nenhuma
  estreia rota: as três mandam o corpo pelo mesmo save. O step novo vai em JSON cru (`--corpo`)
  porque os `attributes` dos 41 tipos não são modelados — copie um step do mesmo tipo como
  molde. A âncora (`--depois-de`) pode ser um nó de ramo (é assim que se põe ação dentro do
  "sim"), nunca um container; **sem `--depois-de` o step entra no início do fluxo**, que é a
  única porta num workflow recém-criado (ele nasce sem step nenhum). Com `--ramos` o step
  nasce container, e o `name` do step vai também para `attributes.conditionName`, que é o
  rótulo que o app desenha: `if_else` ganha condition-node, `branch-yes`/`branch-no`, `sibling` e
  `attributes.branches` com os ids batendo; os outros containers usam `transition`. Nó de ramo (`transition`, `branch-yes`, `branch-no`) não se
  remove sozinho: é estrutura do container, indexada por `attributes.branches` e pelo
  `sibling[]`. Container só sai com `--com-subarvore`. Step criado sem
  `advanceCanvasMeta.position` aparece no lugar certo — o editor calcula o layout (provado ao
  vivo em 2026-09-21).
- **A validação pelas 29 regras mora acima do comando.** `npm run workflow-editar` é a camada crua e
  RECUSA gravar sem `--sem-regras` (o aviso em stderr não segurava ninguém). As duas portas com guarda são a tool MCP
  `workflow_editar` e `automaster-audit workflow-editar`, que chamam o mesmo caminho: prévia sem
  `--confirmo` → `validar_edicao` → gravação. Ação nova entra nas três, e com teste próprio.
  `configuracao` entra nas três portas mas não nas regras, que não leem configuração geral. A
  validação usa as entidades lidas ao vivo pela prévia (tags, usuários, funis, campos, custom
  values, lista de workflows) e valida também workflow mais novo que o dump, montado do
  documento; templates e formulários seguem do dump.
- **Nova regra de auditoria** = novo arquivo em `auditor/src/automaster_audit/rules/` com `check(ctx)->list[Finding]`; o registry pkgutil descobre sozinho. Adicione fixture quebrada + limpa em `tests/` (use `conftest.make_dump(...)`).
- **Regras devem evitar falso positivo.** Histórico: `empty_branch` removida (estrutura normal do GHL); `no_trigger` → `workflow_unreachable` (cruza `add_to_workflow` + execução manual). Regra que dependa de entidade não extraída deve ser no-op.
- **Workflows ao vivo enganam de duas formas, provadas ao vivo na subconta de teste.** Despublicar não remove quem está dentro: congela no passo em que está e volta a andar, todo mundo de uma vez, na republicação. Inscrever um contato num workflow em `draft` devolve `200` de sucesso e não cria inscrição nenhuma — a resposta é idêntica à de uma inscrição que funcionou.

## Fora de escopo (por enquanto)

Desfazer uma edição de contato, um envio de mensagem ou um upload de anexo, clonagem/migração entre subcontas, multi-subconta em lote. No canvas: mover um container (a cauda pende dos ramos, não dele) e remover um ramo isolado.

Oportunidades **saíram** desta lista na 0.6.0: leitura, CRUD de card e gestão de pipeline estão implementados e validados ao vivo (`docs/endpoints.md` seção `## Oportunidades`). Segue fora: apagar cards em lote (`POST /bulk/delete`, destrutivo em lote sem guarda boa) e qualquer regra de auditoria sobre oportunidade.

Escrita de contato **saiu** desta lista: está implementada e validada ao vivo (`docs/endpoints.md` seção `## Escrita`). O que ainda não foi confirmado está em `docs/pendencias-escrita-contato.md`.

Escrita de formulário e survey **saiu** desta lista na 0.12.0: criar, editar, duplicar, apagar, restaurar versão e identidade visual estão implementados e validados ao vivo (`docs/endpoints.md` seção `## Formulários e surveys`). Pergunta aberta sem humano na tela: se o builder do GHL preserva `customStyle`/`fieldStyle` depois de alguém salvar o formulário pela interface.
