# Prova ao vivo de workflows — Instaltech (2026-09-20)

Subconta `Xb9gDxwxYhdqtprGcb5E` (Instaltech). Contato de teste `uWqujqll20tRuglV3mLt`.
Workflow usado, reaproveitado em vez de criado do zero: `test.cmd [review]`
(`457e3101-9aa4-4733-acaa-9f7a90bf6f90`), estado original `draft`, `allowMultiple: true`,
zero contatos dentro no começo.

Antes de tocar em qualquer workflow, os steps de `delete.cmd` (`33f5ba6f-...`) foram lidos e
descartados: é um único passo `internal-delete-contact` que apaga o contato. Nunca usar esse
workflow para teste.

## O que foi provado, passo a passo

**Leitura, lista e detalhe vazio**

    npx tsx src/cli.ts workflows-ao-vivo -l Xb9gDxwxYhdqtprGcb5E -o lista --json

Devolveu 200 com 72 workflows (48 `published`, 24 `draft`).

    npx tsx src/cli.ts workflows-ao-vivo -l Xb9gDxwxYhdqtprGcb5E -o dentro -i <WID> --json

Rodou contra os três workflows candidatos e devolveu `vazio_porque` nos três — nenhum tinha
inscrito.

**Inscrever num workflow em `draft`**

    POST /workflow/<loc>/<wid>/start-workflow

Devolveu `200 {"msg":"ADD To WF:... PubSub StartWorker:...","error":false}` com o workflow
ainda em `draft`. Repetido duas vezes, nenhuma inscrição apareceu depois. Só depois de
publicar o workflow a inscrição foi criada de fato.

**Publicar e despublicar**

    PUT /workflow/<loc>/change-status/<wid>

Devolveu o workflow inteiro com o `status` novo. O `updatedBy` mudou de `OvPQsxKKffcLSOGL90wN`
para `GYFy8jJyy0KRNliM8ejy` — o id do usuário do token, confirmando a autoria de ponta a
ponta.

**Inscrição com o workflow publicado, origem gravada**

Com o workflow em `published`, a inscrição criada veio com `meta.addedSource.source =
add_to_campaign_modal`, o valor que o código manda por padrão — o campo é persistido de
verdade.

**Remover (stop-execution)**

    POST /workflow/<loc>/contact/<cid>/stop-execution

Devolveu `200 {"msg":"successfully queued contact to end workflow execution"}`. A inscrição
já estava `finished` no momento da chamada e continuou `finished` — a rota não fez nada
porque não havia o que encerrar.

**force-resume sobre inscrição terminada**

    POST /workflow/<loc>/<inscricaoId>/force-resume

Devolveu `404 {"msg":"Invalid workflow status id"}` sobre a inscrição `finished`
(`01M2YHZ7QX25D70MZ3B5MHMS2X`). O resolvedor local achou a inscrição certa pelo contato — o
conserto do item 5 abaixo funciona. Quem recusou foi o servidor, não o código.

## As oito premissas do plano que caíram

### 1. `getWorkflowMeta` devolve o workflow na raiz, não sob `meta.workflow`

Resposta real de `GET /workflow/<loc>/<wid>?includeScheduledPauseInfo=true`:

    {"_id":"457e3101-...","deleted":false,"locationId":"...","name":"test.cmd [review]",
     "status":"draft","updatedBy":"OvPQsxKKffcLSOGL90wN","type":"workflow","allowMultiple":true,
     "removeContactFromLastStep":true,"fileUrl":"https://firebasestorage...","version":10, ...}

O código lia `meta?.workflow ?? {}`, então `name` e `status` saíam vazios em toda leitura
`-o dentro`. O id fica em `_id`, não em `id`.

### 2. `enroll-stats` não existe: 404 em todas as variantes

    GET /workflows/status/enroll-stats?workflowId=..&locationId=..  → 404 Cannot GET
    GET /workflow/status/enroll-stats?...                           → 401
    GET /workflows/<loc>/status/enroll-stats?workflowId=..          → 404
    GET /workflows/status/stats?...                                 → 404

A rota do dossiê de pesquisa não responde nada, em nenhuma forma tentada.

### 3. O campo da próxima execução é `executeOn`, não `nextExecutionOn`

Chaves reais de uma linha de inscrição:

    _id, id, sid, contactId, workflowId, locationId, enrollType, currentStepId,
    currentStepName, currentStepType, status, executeOn, meta, waitingFor,
    taskRequest, sequence, sourceId, createdAt, updatedAt

`nextExecutionOn` — o nome que veio do bundle público — não existe na resposta real.

### 4. `getContact` não devolve `contact.name`

O envelope `{"contact": {...}}` está certo, mas dentro não há `name` nem `contactName`. Há
`firstName`, `lastName`, `fullNameLowerCase`, `email`. A flag `--nomes` nunca preencheu nome
nenhum com a suposição antiga.

### 5. A rota do lado do contato devolve linhas mínimas

    GET /workflow/<loc>/contact/<cid>/statuses_v2
    {"msg":"Success","count":10,"workflowStatuses":[
      {"workflowId":"c8b1be59-...","status":"wait_time"},
      {"workflowId":"60e95435-...","status":"finished"}, ... ]}

Só `workflowId` e `status`. Sem `_id`, sem `contactId`, sem passo, sem `createdAt`, sem
`meta.addedSource`. O resolvedor de inscrição que mapeava `_id ?? id` dessa rota sempre
ficava com lista vazia, e `workflow-acao --acao retomar --contato <id>` recusava dizendo
"este contato não está no workflow" mesmo quando estava — ação estruturalmente quebrada até
o conserto (resolver pela busca de inscritos do workflow, filtrando por `workflowId` e
`contactId`, não pela rota do contato).

### 6. `dentro_agora` do lado do contato contava quem já tinha terminado

Das 10 linhas do contato de teste, 9 eram `finished` e 1 `wait_time`. O contato estava dentro
de um workflow, não de dez. A contagem ingênua do tamanho da lista mentia.

### 7. A busca de inscritos do workflow devolve `finished` junto com as vivas

Com uma única inscrição `finished`, a leitura acusou `dentro_agora: 1` e o aviso de
despublicar disse "1 contato(s) estão dentro agora... congelam". Ninguém ia congelar — o
mesmo defeito do item 6, do outro lado.

### 8. Inscrever num workflow em `draft` devolve sucesso e não cria nada

Ver "O que foi provado" acima: `200` idêntico ao caso que funciona, sem nenhuma inscrição
criada. O comando não tem como distinguir os dois casos pela resposta.

## O que NÃO foi provado, e por quê

Nenhum dos três workflows descartáveis da Instaltech tem passo de espera: o contato entra e
termina na hora. Sem um contato PARADO dentro de um workflow, ficaram sem prova:

- `retomar` sobre uma inscrição genuinamente pausada (só se provou a recusa sobre uma
  inscrição já terminada);
- despublicar com gente de verdade congelando ali, e a retomada de todos na republicação;
- remover um contato que está parado no meio do workflow (só se provou remover sobre uma
  inscrição já `finished`, que não fez nada);
- o que a remoção por contato faz com inscrição dupla (`allowMultiple` é `true` nos três
  workflows candidatos, mas nenhuma inscrição dupla chegou a existir).

Provar qualquer um desses exigiria inscrever o contato num workflow real do cliente, com
passo de espera — o que dispara automação de verdade contra a base. Não foi feito por
decisão de segurança.

## A pergunta que ficou aberta

Com a constante `FONTE_CONTATO` trocada para `"automaster"`, o `POST start-workflow` devolveu
`200`, sem `422` — o enum de `source` não é fechado no servidor. Mas o teste rodou com o
workflow em `draft`, onde nenhuma inscrição é criada (item 8), então não deu para ver o valor
persistido. Provar exigiria publicar o workflow e inscrever de novo, disparando os passos
contra um contato real. A constante segue no valor do app, `add_to_campaign_modal`.

## Resíduo na Instaltech

- Workflow `test.cmd [review]` (`457e3101-9aa4-4733-acaa-9f7a90bf6f90`): devolvido a `draft`,
  estado original. Sobrou uma linha de inscrição `finished`
  (`01M2YHZ7QX25D70MZ3B5MHMS2X`), que não tem rota de apagar.
- Contato de teste `uWqujqll20tRuglV3mLt`: a execução do workflow rodou os passos dele e
  deixou a tag `ia - ativa` nova e o contato atribuído ao usuário `3EX1SB4nwZWMjBaP5jei`.
- O passo `whatsapp_v2` do workflow não produziu mensagem: a conversa do contato segue com
  as 5 mensagens antigas (3 notas internas, 2 e-mails). Nada saiu para ninguém.
- Rastro de todas as escritas em
  `~/.automaster/dumps/_workflows/Xb9gDxwxYhdqtprGcb5E/457e3101-9aa4-4733-acaa-9f7a90bf6f90/`.
