# Pesquisa — e-mail no automaster

Spec: `docs/superpowers/specs/2026-09-20-emails-design.md`

Três frentes: sondagem ao vivo na Instaltech (probe descartável, já apagado), duas varreduras
do repo, uma busca web. Os números de dump vêm de todos os 12 snapshots em `~/.automaster/dumps`.

## Achados da sondagem ao vivo

### A1 — O cruzamento pelo `previewUrl` funciona, e acusa 5 casos reais na Instaltech
- Fonte: probe contra `GET backend/emails/builder` em `Xb9gDxwxYhdqtprGcb5E`, cruzado com
  `~/.automaster/dumps/Xb9gDxwxYhdqtprGcb5E/2026-09-19_1909`
- Contradiz a spec: não — confirma
- Builder: 43 itens, 37 não-pasta, 6 pastas. Dos 13 steps de e-mail, os 8 de
  `templateCreationMode: "existing"` têm o id do `previewUrl` **presente** no builder; os 5
  restantes não estão. Nenhum dos 13 `template_id` está no builder.
- Os 5 não são ruído: quatro apontam para assuntos "Confirmação de Reunião", "Faltam 24
  horas", "Falta 1 hora" e o builder tem esses mesmos nomes com id criado dois dias depois
  (`669c…` no step, `669e…` no builder); o quinto aponta para "Contrato ZOI" e o builder tem
  "CONTRATO" (`671bcd87…`). São templates refeitos com os workflows presos na versão velha.
- Consequência: quem editar o template no builder não muda o e-mail que o workflow envia, e
  hoje nada avisa. É exatamente o achado que a regra deve produzir.

### A2 — Todo step de e-mail tem `previewUrl`: 99 de 99, nos 12 dumps
- Fonte: varredura de `~/.automaster/dumps/*/*/workflows/*.json`
- Contradiz a spec: não
- 99 steps de e-mail no total (Instaltech e Cliente B; as outras 10 subcontas não têm
  nenhum). 70 com `previewUrl` igual ao `template_id`, 29 diferentes. Zero sem `previewUrl`.
- Consequência: a regra nunca fica cega por campo ausente. O `template_id` sozinho erraria em
  29 casos.

### A3 — O HTML do e-mail baixa sem token nenhum, e id inexistente dá 404
- Fonte: `firebasestorage.googleapis.com/v0/b/highlevel-backend.appspot.com/o/location%2F<loc>%2Femails%2F<id>%2Findex.html?alt=media`
  testado em `Xb9gDxwxYhdqtprGcb5E` e `citQs4acsN1StzOEDuvj`
- Contradiz a spec: parcial — a spec chama a URL de "pública"; `docs/endpoints.md:25` e `:49`
  chamam o mesmo Storage de "URL pré-assinada"
- O parâmetro `token=` do `previewUrl` é dispensável: `?alt=media` sozinho responde 200 nas
  duas subcontas. Id inexistente responde 404 limpo. Uma das respostas foi redirecionada para
  `storage.googleapis.com` com assinatura e `Expires` de um dia — assinatura gerada na hora,
  não no `previewUrl`.
- Consequência: a operação `conteudo` não precisa de token nem de Chrome. E os 5 e-mails do
  A1 continuam respondendo 200, ou seja, ainda enviam — o que sustenta WARN em vez de ERROR.
- Pergunta que levanta: o `?cb=` colado no fim do `previewUrl` produz um segundo `?` na query
  (`token=<uuid>?cb=<ms>`) e mesmo assim responde 200. Vale gravar a URL crua ou reconstruí-la
  a partir do id?

### A4 — Os itens do builder já trazem `previewUrl` próprio
- Fonte: probe; chaves de um item: `name, updatedBy, isPlainText, lastUpdated, dateAdded,
  previewUrl, id, version, templateType, parentId`
- Contradiz a spec: não
- Não existe `updatedAt`: as datas são `lastUpdated` e `dateAdded`.
- Consequência: a operação `conteudo` serve tanto para template do builder quanto para step.

## Achados do repo — reuso

### A5 — O enxerto da entidade opcional é uma linha num loop que já existe
- Fonte: `extractor/src/cli.ts:157-172`, `extractor/src/dump/writer.ts:40-42`, `:61-67`, `:69-80`
- Contradiz a spec: não
- `writeEntity` tipa o nome da entidade como union literal (`writer.ts:62-63`): sem acrescentar
  `"email_templates"` ali, não compila.

### A6 — Não existe varredura recursiva por `parentId` no extractor
- Fonte: `extractor/src/api/forms.ts:24-39` (`listarTudo`, preso ao shape `{[rota]:[], total:N}`),
  `extractor/src/api/workflows.ts:30-44`
- Contradiz a spec: parcial — a spec fala em "seguir o padrão", e o padrão de paginação existe,
  mas a recursão de pastas é código novo
- `emails/builder` devolve `{builders:[...], total:[{total:N}]}` (`docs/endpoints.md:765`), um
  terceiro shape. Nenhum dos dois loops serve sem adaptação.

### A7 — Baixar do Firebase sem auth já existe, mas só devolve JSON
- Fonte: `extractor/src/api/client.ts:93-98` (`getJsonNoAuth`), usado em
  `extractor/src/api/workflows.ts:62-65` e `extractor/src/api/forms-write.ts:70-76`
- Contradiz a spec: parcial
- Os três consumidores esperam JSON. HTML precisa de um `res.text()` que a classe não tem.
- Pergunta que levanta: a operação `conteudo` fica no Python do MCP (que hoje **não faz rede
  nenhuma** — `mcp_server.py:237-268` delega tudo ao extractor, abrindo Chrome) ou vira mais um
  comando de CLI? A primeira opção dispensa Chrome e é muito mais rápida, mas quebra a regra
  "o servidor MCP não vai à rede".

### A8 — O índice reverso não guarda template de canal nenhum
- Fonte: `auditor/src/automaster_audit/dashboard.py:35-92` (`_wf_refs`), `:97-120`
- Contradiz a spec: parcial — a spec diz "pelo índice reverso", que ainda não indexa templates
- `dashboard.py:16` já tem `"email"` em `CHANNEL_TYPES` e `:62-64` já conta steps de e-mail,
  mas nenhum id de template é coletado, nem para SMS nem para WhatsApp. `usos` exige entrada
  nova no retorno de `_wf_refs`.
- O molde de tool de leitura curta é `mcp_server.py:125-133` (`inventario`); `_dash()` é
  cacheado (`mcp_server.py:88-91`).

## Achados do repo — blast radius e documentação

### A9 — A afirmação errada sobre e-mail está em quatro lugares, não um
- Fonte: `docs/endpoints.md:782-787`, `auditor/src/automaster_audit/rules/broken_template_ref.py:9-12`,
  `extractor/src/api/entities.ts:57-60`, `CLAUDE.md:110` (e a ressalva em `CLAUDE.md:38`)
- Contradiz a spec: parcial — a spec só prevê corrigir o `endpoints.md`
- `auditor/tests/test_broken_template_ref.py:53-60` tem um teste cujo docstring afirma a mesma
  coisa; o teste continua passando, o texto vira mentira.

### A10 — A seção "Regras cegas" é hardcoded e dois testes a travam
- Fonte: `auditor/src/automaster_audit/report.py:34-39` (`_CEGAS`),
  `auditor/tests/test_report_regras_cegas.py:21-33`
- Contradiz a spec: sim — a spec não menciona `_CEGAS`
- Sem entrada nova, um dump sem `email_templates.json` não avisa que as duas regras novas
  ficaram no-op. Com entrada nova, os dois testes quebram até ganharem `email_templates=[]`.
- Pergunta que levanta: o relatório deve avisar que a auditoria de e-mail está cega num dump
  antigo, ou silêncio é aceitável?

### A11 — `comparar` não veria template de e-mail
- Fonte: `auditor/src/automaster_audit/diff.py:30-31`, `:48-49`
- Contradiz a spec: sim — por omissão
- As duas linhas de template são hardcoded (`message`, `whatsapp`). Template de e-mail criado,
  renomeado ou apagado entre dois snapshots não apareceria no `diff.md`.
- Pergunta que levanta: entra nesta rodada ou vira débito registrado?

### A12 — Achado INFO sem workflow não aparece no dashboard
- Fonte: `auditor/src/automaster_audit/dashboard_html.py:304`, `dashboard.py:83-84`
- Contradiz a spec: não — a spec já tira o dashboard de escopo
- `unused_email_template` seguiria `unused_form.py:44-45` (`workflow_id=""`), e o drawer por
  workflow filtra INFO. Aparece no `report.md` e na tool `achados`, não no dashboard.
- As legendas dos tiles (`dashboard_html.py:141-146`) já estão desatualizadas desde
  `broken_form_ref`/`unused_form` e ficariam mais.

### A13 — A spec não fixa sob que chave o dump guarda a lista
- Fonte: spec `:47-50` vs `auditor/tests/conftest.py:46-59` e `docs/endpoints.md:765`
- Contradiz a spec: sim — ambiguidade
- Cada entidade opcional tem envelope próprio (`{raw:{templates:[]}}`, `{raw:[]}`,
  `{raw:{forms:[],total:n}}`). A spec diz "lista achatada" sem dizer a chave. `conftest` e
  `_load_templates` precisam concordar.

### A14 — O nome `emails` colide com dois conceitos já existentes
- Fonte: `skills/automaster-leitura/SKILL.md:39-41`, `mcp_server.py:518`
- Contradiz a spec: parcial
- Já existem `conversas(email=<emailMessageId>)` (corpo de e-mail enviado a um contato) e
  `enviar(tipo="Email")`. Uma tool chamada `emails` que devolve templates de automação divide
  a palavra com duas coisas diferentes.
- Pergunta que levanta: `emails` ou um nome que diga template?

### A15 — Superfície de versionamento de uma tool nova
- Fonte: `.claude-plugin/plugin.json:3-4`, `CHANGELOG.md:1-9`, `CLAUDE.md:18,30,38`,
  `skills/automaster-leitura/SKILL.md:3`
- Contradiz a spec: não — a spec simplesmente não fala disso
- Versão atual 0.13.0, 29 tools, 16 regras, 10 entidades: todos os três números aparecem
  escritos por extenso em mais de um arquivo. Checklist pronto em
  `docs/superpowers/plans/2026-09-19-formularios-surveys-leitura.md:866-880`.

### A16 — A contagem de 67 usos de `email.template_id` na doc não bate com a medição
- Fonte: `docs/endpoints.md:788-792` vs varredura dos 12 dumps (99 steps de e-mail)
- Contradiz a spec: não, mas corrige a doc
- Seja qual for o critério antigo, o número corrente é 99 steps `email` em 12 dumps, de duas
  subcontas.

## Achados da web, checados contra a sondagem

### A17 — A HighLevel documenta que o template do step é uma cópia oculta da lista
- Fonte: https://help.gohighlevel.com/support/solutions/articles/155000005856-snapshot-workflow-email-action-enhanced-flow
  ("email action templates … remain hidden from users … will not appear in the template list") e
  https://help.gohighlevel.com/support/solutions/articles/155000005553-managing-email-templates-in-workflow-steps
  ("HighLevel creates a copy for that workflow step")
- Contradiz a spec: parcial — é a explicação oficial de por que o `template_id` nunca casa, e
  levanta uma hipótese concorrente ao A1
- A leitura do A1 é que os 5 sem correspondência são templates apagados e recriados. A leitura
  desta fonte permite outra: seriam "email action templates", registros reais escondidos da
  lista, e a regra daria 5 falsos positivos.
- Evidência a favor do A1: os 8 steps que a própria HighLevel chama de cópia
  (`templateCreationMode: "existing"`) são justamente os que **casam** pelo `previewUrl`. A
  ocultação afeta o `template_id`, não o id do arquivo renderizado. E os 5 restantes têm nome e
  assunto batendo com templates do builder criados dois dias depois.
- **Prova que falta, e que só a escrita ao vivo dá:** criar um template no builder, usá-lo num
  step de workflow descartável, apagar o template e ver se o id some da lista mantendo o
  `previewUrl`. Tarefa da implementação, na Instaltech.

### A18 — "Sync Edits to Template" é o `syncEnabled` do payload
- Fonte: https://help.gohighlevel.com/support/solutions/articles/155000006141-how-to-use-the-sync-edit-checkbox-for-email-actions-in-workflows-continuous-sync-
- Contradiz a spec: não
- Com sync ligado a edição é bidirecional entre step e template; desligado, o step fica
  congelado. Os literais `syncEnabled`, `templateCreationMode` e `templatesource` não têm
  registro público nenhum — só captura.
- Na Instaltech, os 4 steps com `syncEnabled: true` são justamente 4 dos 5 que não casam.
- Consequência: o achado é mais grave nesses, não menos — o usuário acha que está sincronizado
  com um template que não existe mais.

### A19 — As rotas v3 de template de e-mail não existem para os tokens da sessão
- Fonte: probe ao vivo; `GET /emails/locations/<loc>/templates[/<id>]` responde
  `404 Cannot GET` em `services.` e em `backend.`, inclusive para um template que está na lista
  do builder. Documentadas em https://marketplace.gohighlevel.com/docs/ghl/emails/get-email-template
  e .../list-email-templates
- Contradiz a spec: não — confirma que `emails/builder` é o caminho
- São rotas de app do marketplace (OAuth/PIT), não do token do app web. Adotá-las significaria
  um segundo esquema de autenticação, fora do que o extractor faz.

### A20 — `originId` não serve de junção, e `?templateId=`/`deleted=true` são ignorados
- Fonte: probe ao vivo
- Contradiz a spec: não
- `GET /locations/<loc>/templates?originId=<workflowId|locationId>[&type=email]` responde 200
  com `{templates:[], totalCount:0}` em todas as combinações, nos dois hosts. Em
  `emails/builder`, `?templateId=` e `deleted=true` devolvem a lista inteira, byte a byte igual
  à chamada sem eles.
- Consequência: não existe rota que resolva um template de e-mail por id. O `previewUrl` é a
  única junção disponível.

### A21 — Token do Firebase não expira, mas troca quando o arquivo é reescrito
- Fonte: https://www.sentinelstand.com/article/guide-to-firebase-storage-download-urls-tokens
- Contradiz a spec: parcial — o segundo risco da spec estava mal formulado
- O token é metadado persistente, não assinatura com prazo. O que o invalida é sobrescrever o
  arquivo: editar o e-mail gera token novo, e um `previewUrl` guardado de um dump antigo passa
  a falhar. A fonte diz que sem token dá 403; no bucket da HighLevel não é o caso — o A3 mediu
  200 com `?alt=media` sozinho, em duas subcontas.
- Consequência: `conteudo` deve montar a URL a partir do id do snapshot corrente e dispensar o
  token, em vez de guardar o `previewUrl` inteiro.

### A22 — `emails/builder` está marcada como removida na v3
- Fonte: https://marketplace.gohighlevel.com/docs/Changelog (seção Emails)
- Contradiz a spec: não, mas é risco de prazo
- A rota continua respondendo ao app web hoje (43 itens na Instaltech). A depreciação é da API
  pública; quando cair do backend interno, a substituta exige o outro esquema de auth (A19).

## Fila do grill

Ordenada por dependência.

1. A17 — os 5 achados da Instaltech são templates apagados ou "email action templates" ocultos?
   A regra só nasce se for o primeiro. (trava A10, A11, e a severidade)
2. A7 — a operação `conteudo` faz rede a partir do Python do MCP, quebrando a regra de que o
   servidor não vai à rede, ou vira comando de CLI com Chrome? (trava A14)
3. A13 — sob que chave o `email_templates.json` guarda a lista, já que a resposta é
   `{builders, total:[{total:N}]}` e a varredura agrega várias chamadas?
4. A10 — o relatório deve avisar que a auditoria de e-mail está cega num dump antigo?
5. A11 — template de e-mail entra no `comparar` nesta rodada ou vira débito?
6. A9 — corrigir a afirmação errada nos quatro lugares entra nesta rodada?
7. A14 — o nome da tool: `emails` divide a palavra com `conversas(email=)` e `enviar(tipo=Email)`.
8. A21 — guardar o `previewUrl` cru ou remontar a URL a partir do id?
