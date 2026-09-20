# Pesquisa — escrita de workflows, parte A

Spec: `docs/superpowers/specs/2026-09-20-workflows-escrita-transporte-design.md`

Fontes: três varreduras do repo, uma mineração do bundle do editor
(`client-app-automation-workflows.leadconnectorhq.com/assets/index-DITnh-HL.js`, 2,3 MB) e
uma busca externa. Trechos do bundle citados verbatim onde provam o fato.

## Achados

### A1 — `version` não é trava de concorrência do servidor: quem incrementa é o cliente
- Fonte: bundle, `this.version?...:this.version++:this.version=1` executado **depois** do
  save; nenhum `409` nem mensagem de conflito em todo o caminho de erro (`FWe` lê só
  `errorMessage|message|msg`).
- Contradiz a spec: **sim**. A spec deixou em aberto se o PUT usa `version` como trava. Não
  usa. A única proteção do app é local: comparar `autoSaveSessionId` e mostrar *"Another
  user is editing the workflow with auto save. Please wait for them to finish."*
- Pergunta que levanta: sem trava no servidor, duas pessoas (ou você e o app aberto numa
  aba) gravando o mesmo workflow se sobrescrevem em silêncio e o perdedor não descobre.
  Vale o comando reler o workflow imediatamente antes de gravar e abortar se o número de
  versão mudou desde a leitura?

### A2 — `only-triggers` manda o workflow inteiro, não só os triggers
- Fonte: bundle — a mesma variável `n` (com `workflowData` completo) vai para
  `updateOnlyTriggers`; a rota só muda quando `$.triggerChange` é true e
  `$.unsavedChanges` é false.
- Contradiz a spec: **parcial**. A spec trata "editar só os triggers" como operação mais
  barata e mais segura. O corpo é idêntico; o risco de reescrever os steps é o mesmo.
- Pergunta que levanta: se a rota não protege os steps, ela ainda merece ser uma operação
  separada, ou vira só um detalhe interno de qual URL usar?

### A3 — duplicar na mesma subconta não é `copy-workflow`
- Fonte: bundle — `copyWorkflow` faz `POST ${endpoint}` com
  `{new_workflow_name, workflow_id, parentId, company_id, company_age}`. `copy-workflow` é
  outro método (`copyToSubAccount(e,t)`), com corpo montado pela tela, não pelo modelo.
- Contradiz a spec: **sim**. A spec lista `POST /<loc>/<wid>/copy-workflow` como a rota de
  duplicar. Duplicar na mesma subconta é o POST de criação com `workflow_id` preenchido.
- Pergunta que levanta: o nome do outro método é `copyToSubAccount` — a cópia entre
  subcontas pode já existir pronta no servidor. Se existir, o sub-projeto C (clonagem) muda
  de tamanho: em vez de traduzir referências à mão, seria uma chamada e depois um conserto
  do que o servidor não soube mapear. Vale sondar essa rota antes de planejar C?

### A4 — restaurar versão não tem rota própria
- Fonte: bundle — enumeradas todas as chamadas HTTP. Há quatro rotas de leitura de
  histórico (`/history`, `/history/v2`, `/history/<id>`, `/history-by-number/<n>`) e
  nenhuma de restaurar. As telas de versão são somente leitura
  (`"This Version is in View Only Mode"`).
- Contradiz a spec: **parcial**. A spec chama restaurar versão de "saída de emergência".
  Existe leitura da versão antiga, e restaurar é regravá-la pelo PUT normal — inferência,
  não prova: o handler não aparece no bundle.
- Pergunta que levanta: a saída de emergência passa a ser o nosso próprio snapshot em
  disco, e o histórico do GHL vira só uma segunda cópia. Isso basta, ou a restauração pelo
  PUT precisa ser provada ao vivo antes de a spec prometê-la?

### A5 — o app proíbe restaurar versão com gente dentro; pela API nada proíbe
- Fonte: documentação oficial do GHL sobre version history
  (help.gohighlevel.com/support/solutions/articles/155000006656) — restaurar exige o
  workflow em Draft e **sem contatos inscritos**; e a mensagem do próprio bundle,
  `"Draft this workflow before restoring a version."`
- Contradiz a spec: **parcial**. A spec permite editar workflow publicado com aviso, e não
  distingue editar de restaurar.
- Pergunta que levanta: o app impõe uma regra que a API não impõe. Quando nossa guarda
  deve copiar a regra do app e quando deve deixar passar com aviso? Restaurar uma versão
  antiga sobre gente que está no meio do fluxo é o caso mais perigoso da spec inteira.

### A6 — o app valida antes de salvar, e o servidor provavelmente não
- Fonte: bundle, classe `F8(...).validate()`, que **aborta o save** quando o status não é
  `draft`: `checkEmptyPublish`, `checkDanglingGoto` (*"There are some Goto Steps without
  connection"*), `checkMultipleGoal`, `checkSenderAddress`, `checkLoopHasBody`,
  `checkUnsupportedActionsInsideLoop`, `createUpdateContactValidator`,
  `validateRouterConditions`, entre outras. Em `draft` os erros são engolidos e o save segue.
- Contradiz a spec: **parcial**. A spec valida pelas 18 regras da auditoria, que cobrem
  referência quebrada e alcançabilidade, mas não cobrem essas checagens de publicação.
- Pergunta que levanta: escrevendo direto pela API dá para gravar um workflow que o app
  depois se recusa a salvar — o cliente abre o editor, mexe em qualquer coisa e não
  consegue mais publicar. Nossa validação deve replicar as checagens de publicação do app,
  ou basta recusar quando o workflow estiver publicado?

### A7 — salvar um workflow publicado que ficou sem ações o rebaixa para `draft` sozinho
- Fonte: bundle — `Z.workflow?.status==='published' && !pGe() && (Z.workflow.status='draft')`,
  onde `pGe()` é falso quando `templates` está vazio.
- Contradiz a spec: **não**. É comportamento do cliente, e como mandamos `status` no corpo,
  ele é nosso para decidir.
- Pergunta que levanta: se uma operação de remoção esvaziar o workflow, replicamos o
  rebaixamento ou recusamos a operação?

### A8 — auto-save só existe em rascunho, e não é o caminho que queremos
- Fonte: bundle — `shouldAllowAutoSave` exige `status === 'draft'`; debounce de 1500 ms;
  publicado imprime `Auto-save not allowed`. Há ainda um
  `POST /<loc>/<wid>/commit-auto-save` com `{userId, workflowId, locationId, version,
  autoSaveSessionId}`, disparado inclusive no fechamento da aba (`?source=beacon`).
- Contradiz a spec: **não**. Confirma a hipótese da spec de usar `update`.
- Pergunta que levanta: nenhuma. Registro.

### A9 — o corpo do PUT é o workflow inteiro, com 45 campos, e três listas de auditoria
- Fonte: bundle — o payload é clone profundo de `_data`. Campos identificados: `allowMultiple,
  allowMultipleOpportunity, autoMarkAsRead, autoSaveSessionId, autoSavedBy, campaignId,
  contactRemovedDueToSnapshotRefresh, createdAt, createdSteps, creationSource,
  customObjectType, dataVersion, deleted, deletedAt, deletedSteps, eventStartDate,
  locationId, loopIdentified, meta, modifiedSteps, name, originId, originType, parentId,
  paused, permission, permissionMeta, removeContactFromLastStep, restoredAt,
  scheduledPauseDates, senderAddress, status, stopOnResponse, templateCategories,
  templateDescription, templateId, timezone, type, updatedAt, updatedBy, version, window,
  workflowData, workflowNote, workflowType`, mais `triggersData` e `id`. Antes de enviar, o
  cliente recalcula `updatedBy`, `createdSteps`, `modifiedSteps`, `deletedSteps` e apara o
  `name`. `location_id`/`company_id`/`company_age` vão **só no POST de criação**, nunca no PUT.
- Contradiz a spec: **parcial**. A spec fala em "gravar o documento inteiro" sem dizer de
  onde vem o documento. A leitura que temos hoje (`GET .../<wid>` + Firebase) não devolve
  necessariamente os 45 campos com os mesmos nomes.
- Pergunta que levanta: precisamos confirmar ao vivo que o que lemos basta para remontar um
  corpo que o servidor aceite sem perder campo. Um campo que existe no modelo do app e não
  vem na nossa leitura é um campo que zeramos em toda escrita.

### A10 — as três listas de steps (`createdSteps`, `modifiedSteps`, `deletedSteps`) são
calculadas pelo cliente
- Fonte: bundle, mesmo trecho do A9.
- Contradiz a spec: **sim, por omissão**. A spec não as menciona. Se o servidor usa essas
  listas para montar o histórico de versões ou para decidir o que revalidar, mandá-las
  vazias pode produzir um histórico mentiroso.
- Pergunta que levanta: nossa operação cirúrgica sabe exatamente o que mudou — vale
  preencher essas listas honestamente, ou é campo decorativo?

### A11 — encadeamento de steps é por ponteiro, não por lista
- Fonte: `auditor/src/automaster_audit/flow.py:4-8` (`next` = id ou lista de ids de ramos;
  sem `parent` = entrada) e o bundle (`insertNode` cria
  `{id, parentKey, parent, type, name, attributes, order, cat, currentStepEnd}`; não existe
  `childIds` nem `position`). Medido nos dumps: 4.017 steps na Instaltech têm as chaves
  `id, order, attributes, name, type` sempre, e `next` em 3.039, `parent` em 3.788,
  `parentKey` em 3.946, `sibling` em 569.
- Contradiz a spec: **parcial**. A spec fala em "remover um step por id" como se fosse tirar
  de uma lista. É costurar ponteiro: o `next` de quem apontava para ele precisa passar a
  apontar para o seguinte, e ramos de `if_else` (`attributes.branches`) e de router
  (`attributes.transitions`) têm caminhos próprios.
- Pergunta que levanta: remover step com segurança é a operação mais difícil das cinco. Ela
  fica em A, ou A começa só com as operações que não mexem na topologia (trocar referência,
  alterar atributo, trigger, renomear) e a remoção vai para B junto com o resto da edição
  estrutural?

### A12 — quase tudo que a spec descreve já existe pronto no repo
- Fonte: `extractor/src/cli.ts:550` (`registroEscrita`, já usada por nove comandos, grava em
  `<dumps>/<pasta>/<loc>/<chave>/<ts>.json`); `extractor/src/cli.ts:2296-2334`
  (`runWorkflowAcao`, o par snapshot-antes/regrava-depois que a spec pede);
  `extractor/src/api/client.ts:26-35` (headers e dois tokens, iguais para todas as rotas);
  `auditor/src/automaster_audit/dashboard.py:35-92` (`_wf_refs`, varre step e trigger
  mapeando onde mora cada tipo de id); as oito regras `broken_*_ref`, que são o catálogo de
  qual `attributes.<campo>` carrega qual referência; `auditor/.../loader.py:98` +
  `rules/__init__.py:25` (dá para trocar um `Workflow` dentro do `DumpContext` em memória e
  rodar as 18 regras sem gravar dump nenhum).
- Contradiz a spec: **não**. Reduz o tamanho dela.
- Pergunta que levanta: nenhuma. Registro — o plano deve reusar, não reescrever.

### A13 — o comando novo precisa que três helpers deixem de ser privados
- Fonte: `extractor/src/cli.ts` — `withClient` (`:105`), `registroEscrita` (`:550`) e as
  constantes de workflow (`:560-561`) são privadas do módulo. O roteamento é uma cadeia de
  `program.command(...)`, sem despachante central (`:1807-2371`).
- Contradiz a spec: **parcial**. A spec diz que nenhum comando existente é movido. Exportar
  três helpers é mexer no `cli.ts` de qualquer jeito — pouco, mas é.
- Pergunta que levanta: exportar os três e importar do arquivo novo, ou duplicar 30 linhas
  para não tocar no arquivo grande?

### A14 — não existe API oficial para isto, e já há prior art da API interna
- Fonte: doc oficial do GHL (só leitura de workflow e inscrição de contato) e o pedido
  aberto da própria comunidade por "Workflow Draft and Publishing API"
  (ideas.gohighlevel.com/apis/p/workflow-draft-and-publishing-api). Prior art:
  `github.com/drleadflow/ghl-automation-builder`, que reverteu a mesma API interna e
  cataloga 95 tipos de ação, 93 triggers e 22 operadores de condição — mas o próprio autor
  registra que só 17 a 21 dos tipos foram verificados ao vivo; o resto é esquema não testado.
- Contradiz a spec: **não**.
- Pergunta que levanta: o catálogo desse repo economizaria muito trabalho no sub-projeto B.
  Vale conferi-lo contra nossos 55 tipos medidos em 1.041 workflows, lembrando que a maior
  parte dele não tem prova ao vivo?

### A15 — editar e republicar não é retroativo para quem está no passo atual
- Fonte: documentação oficial de version history do GHL. O contato termina o passo em que
  está na versão antiga; os passos seguintes usam a nova. Nada confiável encontrado sobre
  contato pular ou repetir passo após edição.
- Contradiz a spec: **não**. Torna a edição de workflow publicado menos assustadora do que
  a spec sugere, sem torná-la segura.
- Pergunta que levanta: o aviso do comando deve dizer isso ao usuário em vez de só contar
  quantos contatos estão dentro?

### A16 — divergência entre dois documentos nossos
- Fonte: `docs/superpowers/handoffs/2026-09-20-workflows-ao-vivo-prova.md:63` diz "As oito
  premissas"; a memória do projeto diz nove.
- Contradiz a spec: **não**. Erro de registro a corrigir de passagem.

## Fila do grill

Ordenada por dependência.

1. **A11** — remover step é costura de ponteiro, não remoção de lista. Fica em A ou vai para
   B? (trava A6, e define o tamanho do plano)
2. **A1** — sem trava no servidor, como evitar que duas escritas se sobrescrevam em silêncio?
   (trava a guarda inteira)
3. **A9** — o que lemos hoje basta para remontar o corpo sem zerar campo? (trava tudo; é a
   primeira coisa a provar ao vivo)
4. **A6** — replicar as validações de publicação do app, ou recusar escrita em publicado?
5. **A5** — restaurar versão sobre workflow com gente dentro: copiamos a proibição do app?
6. **A4** — restaurar versão sem rota própria: promessa da spec vira o quê?
7. **A3** — duplicar é outra rota, e `copyToSubAccount` pode encurtar o sub-projeto C.
8. **A10** — preencher `createdSteps`/`modifiedSteps`/`deletedSteps` honestamente?
9. **A2** — `only-triggers` merece ser operação separada?
10. **A13** — exportar os helpers do `cli.ts` ou duplicá-los?
11. **A7** — operação que esvazia o workflow: rebaixa para draft ou recusa?
12. **A15** — o aviso de workflow publicado deve explicar o efeito real da edição?
