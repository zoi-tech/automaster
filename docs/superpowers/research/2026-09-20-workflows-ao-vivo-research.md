# Pesquisa — workflows ao vivo

Spec: `docs/superpowers/specs/2026-09-20-workflows-ao-vivo-design.md`

Três frentes: dois agentes internos (reuso/padrão, blast radius/testes) e um externo
(bundle público do app + documentação oficial).

## Achados

### A1 — Todas as cinco rotas existem na API interna
- Fonte: bundle `client-app-automation-workflows.leadconnectorhq.com/assets/index-DITnh-HL.js`
  e `appcdn.leadconnectorhq.com/crm/contacts-highrise/2559/…`
- Contradiz a spec: não
- Inscritos num workflow: `GET backend…/workflows/status/search/workflow-with-filter`
  (prefixo **plural**, diferente do `/workflow/` singular que a extração usa).
  Workflows de um contato: `GET backend…/workflow/<loc>/contact/<cid>/statuses_v2`.
  Inscrever: `POST backend…/workflow/<loc>/<wid>/start-workflow`.
  Remover: `POST backend…/workflow/<loc>/contact/<cid>/stop-execution` ou
  `POST backend…/workflow/<loc>/<statusId>/stop-execution`.
  Publicar: `PUT backend…/workflow/<loc>/change-status/<wid>`.
- Pergunta que levanta: nenhuma — a fatia inteira é viável.

### A2 — O passo corrente vem junto da inscrição
- Fonte: `wf/assets/WorkflowStatus-86WguMJ7.js`, colunas da tabela
- Contradiz a spec: não (resolve uma das duas perguntas abertas, a favor)
- Cada linha traz `currentStepType`, `currentStepName`, `createdAt` (entrada),
  `status`, `nextExecutionOn` e `meta.addedSource` — que diz **por que** o contato entrou
  (`trigger`, `bulk_action`, inscrição manual pela interface).
- Nome e e-mail do contato **não** vêm; a interface busca à parte.
- Pergunta que levanta: a lista por workflow deve buscar o nome de cada contato (uma
  chamada por contato, caro em workflow com centenas dentro) ou devolver só o id?

### A3 — Despublicar não expulsa ninguém: pausa e retoma
- Fonte: bundle, estado de inscrição `paused_due_to_draft_mode`; documentação oficial do
  GHL concorda
- Contradiz a spec: parcial
- Contato que estava num passo de espera fica onde está e volta a andar quando o workflow
  for republicado. A spec desenhou a guarda de despublicar como aviso de perigo ("desligar
  com gente no meio do fluxo é o erro caro"). O perigo real é outro: não é perda, é **fila
  represada** que dispara toda de uma vez na republicação.
- Pergunta que levanta: a guarda deve dizer quantos contatos vão ficar congelados e que
  eles voltam a andar quando você republicar, em vez de sugerir que se perdem?

### A4 — Toda escrita exige um `userId` que hoje não temos
- Fonte: corpos no bundle — `{status, updatedBy: "<userId>"}`,
  `{contactId, actionFrom: {userId, source, channel}}`,
  `{workflowId, removedFrom: {userId, channel, source}}`
- Contradiz a spec: parcial (a spec não menciona `userId` em nenhum lugar)
- O extractor captura dois tokens de auth, não a identidade do usuário logado. O dump tem
  `users.json`, mas saber *qual* deles é a sessão aberta é outro problema.
- Pergunta que levanta: de onde sai esse `userId`? Extrair do JWT do Bearer, pedir como
  flag obrigatória, ou testar se o servidor aceita o corpo sem ele? Cada escrita da
  subconta fica carimbada com esse nome no histórico do GHL.

### A5 — Remover contato tem duas rotas, com alvos diferentes
- Fonte: bundle; `stopWorkflowExecutionManually` em `WorkflowStatus-86WguMJ7.js`
- Contradiz a spec: parcial (a spec fala em uma ação `remover`)
- Por contato (`/contact/<cid>/stop-execution` com `workflowId` no corpo) tira o contato
  daquele workflow. Por inscrição (`/<statusId>/stop-execution`) tira **uma inscrição
  específica** — e `statusId` é o `_id` da linha, não o id do contato.
- Existe o inverso, `POST /workflow/<loc>/<statusId>/force-resume`, que retoma uma
  inscrição parada.
- Pergunta que levanta: quando um contato está duas vezes no mesmo workflow (o GHL permite,
  é a flag `allowMultiple`), a rota por contato tira as duas? Vale expor `retomar` junto,
  já que é a contrapartida direta de remover?

### A6 — A inscrição é enfileirada, não imediata
- Fonte: documentação oficial da API v1 — "will add contact in queue to be added in workflow"
- Contradiz a spec: parcial (o roteiro de prova ao vivo lê logo depois de inscrever)
- Ler o estado imediatamente após inscrever pode devolver "não está lá" sem que nada tenha
  falhado.
- Pergunta que levanta: o roteiro de validação precisa de uma espera entre inscrever e
  conferir. Quanto, e o que fazer se depois da espera continuar vazio?

### A7 — Publicar falha por motivos que não são de autenticação
- Fonte: bundle — workflow sem ações é recusado; workflow com gatilho de Agente não pode
  virar rascunho
- Contradiz a spec: não (enriquece o tratamento de erro)
- Pergunta que levanta: o `4xx` da publicação precisa repassar a mensagem do servidor em
  vez de traduzir, porque o motivo é de negócio e varia.

### A8 — O status tem quatro valores, não dois
- Fonte: bundle — `draft | published | locked | paused`
- Contradiz a spec: parcial (a spec fala em publicado/rascunho)
- Pergunta que levanta: a ação `publicar` deve recusar alvo em `locked` ou `paused` em vez
  de sobrescrever às cegas? O que é `locked` na prática não está claro.

### A9 — A API pública faz inscrever e remover, e nada mais
- Fonte: `marketplace.gohighlevel.com/docs/ghl/contacts/{add,delete}-contact-to-workflow`;
  skill local `ghl-api-docs` confirma três rotas de workflow em 529
- Contradiz a spec: não
- `POST`/`DELETE services…/contacts/<cid>/workflow/<wid>`, escopo `contacts.write`, autentica
  com token de integração privada. Ler quem está dentro e publicar **não existem** na API
  pública — publicar é pedido aberto no fórum desde 2024.
- Pergunta que levanta: duas das cinco operações teriam um caminho oficial e estável, mas
  exigiriam um segundo esquema de autenticação no projeto. Vale a mistura, ou fica tudo na
  API interna pela coerência?

### A10 — A busca de inscritos declara sozinha quando a subconta está estrangulada
- Fonte: resposta `{statuses, isLocationRateLimited}`
- Contradiz a spec: não
- É um estrangulamento por subconta, diferente do limite documentado de 100 requisições por
  10 segundos.
- Pergunta que levanta: a leitura deve repassar essa bandeira ao usuário? Lista curta com a
  bandeira ligada não é lista curta, é lista cortada.

### A11 — A paginação dos inscritos é por cursor, não por deslocamento
- Fonte: parâmetros `action=first|next|previous` mais `referenceId`, `referenceCreatedAt`,
  `referenceSid` da linha da borda
- Contradiz a spec: não (a spec não fala de paginação)
- O `listWorkflows` que já existe pagina por `offset`; esta rota não.
- Pergunta que levanta: workflow com muitos inscritos precisa de teto de páginas, como o
  `PATHS_MAX_CHARS` faz com caminhos. Qual teto, e a resposta declara que cortou?

### A12 — O rastro em disco tem um nível a mais do que a spec escreveu
- Fonte: `extractor/src/cli.ts:152-160` (`registroEscrita`)
- Contradiz a spec: parcial
- O layout real é `<dumps>/<pasta>/<loc>/<chave>/<ts>.json`. A spec escreveu
  `<dumps>/_workflows/<loc>/<ts>.json`, sem a `<chave>`.
- Pergunta que levanta: o que é a chave aqui — o id do workflow ou o id do contato? Ela
  decide se o histórico fica agrupado por automação ou por pessoa.

### A13 — O comando precisa imprimir `snapshot: <caminho>` no stderr
- Fonte: `auditor/src/automaster_audit/mcp_server.py:220-235` (`_head_tail`) e
  `extractor/src/cli.ts:841`
- Contradiz a spec: não
- O servidor MCP trunca o stderr preservando, por conteúdo, as linhas que contenham
  `snapshot:`. Comando novo que não imprima isso perde o caminho do rastro quando a saída
  for longa.

### A14 — A guarda de confirmação não é testada no extractor, e sim no auditor
- Fonte: `auditor/tests/test_mcp_formularios_escrita.py`; `grep confirmo extractor/test/`
  não devolve nada
- Contradiz a spec: parcial (a spec diz "teste automatizado cobre a recusa sem `--confirmo`")
- O molde é a fixture `espiao`, que substitui o invocador do extractor e prova que ele nem
  foi chamado.
- Pergunta que levanta: seguimos o precedente e testamos a recusa só do lado Python, ou
  extraímos as guardas do `cli.ts` para funções puras testáveis no extractor também?

### A15 — A tool nova precisa de dump existente, igual às outras tools ao vivo
- Fonte: `mcp_server.py:659-679` (`oportunidades` chama `_load` antes de ir à rede)
- Contradiz a spec: não, mas é consequência que a spec não declarou
- Toda tool ao vivo hoje exige que a subconta já tenha sido extraída ao menos uma vez.
- Pergunta que levanta: workflow ao vivo numa subconta nunca extraída deveria funcionar, já
  que não precisa de nada do dump?

### A16 — A tool `workflow` do dump não se declara como tal
- Fonte: `mcp_server.py:877`; as tools ao vivo abrem a descrição com "AO VIVO:"
- Contradiz a spec: parcial (a spec diz "fica intocada")
- Com `workflow` e `workflows_ao_vivo` lado a lado devolvendo ambos um campo `status`, um
  velho e um corrente, a única diferença no nome é o plural.
- Pergunta que levanta: mexer na descrição da tool antiga para dizer "do dump" conta como
  tocá-la? Sem isso, a chance de ler o status errado é real.

### A17 — Existe rota de publicação em lote, e de desentupir passo travado
- Fonte: bundle — `PUT /workflow/<loc>/change-status` com `workflowIds`;
  `POST /workflow/<loc>/<wid>/{requeue,remove}-stuck-statuses/<stepId>`
- Contradiz a spec: não (lote está fora de escopo por decisão)
- Registro para depois: "contato travado num passo" é uma categoria que o próprio GHL
  reconhece e tem botão para resolver.

### A18 — O jeito de achar o bundle mudou
- Fonte: `app.gohighlevel.com/` não lista mais script; o app carrega de
  `production.app-manifest.leadconnectorhq.com/latest/manifest.json`
- Contradiz a spec: não (contradiz `docs/endpoints.md`)
- A técnica documentada no projeto não funciona mais como está escrita. O editor de workflow,
  além disso, é uma aplicação separada, em host próprio.

### A19 — `workflows.ts` tem um consumidor só
- Fonte: `extractor/src/cli.ts:23,126,131`, dentro de `runExtract`
- Contradiz a spec: não (confirma)
- Nenhum teste importa o módulo. O módulo novo ao lado não arrisca nada.

### A20 — Remover contato não dispara automação de saída (não verificado)
- Fonte: ausência — o GHL não tem gatilho de saída, e o corpo de `stop-execution` só carrega
  metadado de auditoria. Relatos de comunidade concordam; declaração oficial não existe.
- Contradiz a spec: não
- Fica como inferência. A afirmação repetida de que uma mensagem já enfileirada ainda sai
  depois da remoção não tem fonte.

## Fila do grill

Ordenada por dependência.

1. A4 — de onde sai o `userId` que toda escrita exige? (trava as três ações)
2. A12 — o rastro agrupa por workflow ou por contato? (trava o desenho das três ações)
3. A3 — a guarda de despublicar avisa de congelamento e represamento, não de perda?
4. A5 — remover por contato ou por inscrição, e entra `retomar` junto?
5. A2 — a lista por workflow resolve o nome de cada contato ou devolve só o id?
6. A11 — teto de páginas para workflow com muitos inscritos, e como declarar o corte
7. A8 — `publicar` recusa alvo em `locked`/`paused`?
8. A16 — marcar a tool `workflow` antiga como "do dump" conta como tocá-la?
9. A15 — a tool ao vivo deve funcionar em subconta sem dump?
10. A14 — guardas puras testáveis no extractor, ou só o teste Python do precedente?
11. A9 — usar a API pública para inscrever e remover, ou tudo pela interna?
12. A6 — quanto esperar entre inscrever e conferir, no roteiro ao vivo
