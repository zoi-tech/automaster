# Prova ao vivo da escrita de workflows (Task 8)

Executada em 2026-09-21 na subconta **Instaltech `Xb9gDxwxYhdqtprGcb5E`** (72 workflows reais
de cliente em produção). Nenhum dos 72 foi tocado: todo trabalho aconteceu em dois workflows
descartáveis criados aqui e apagados no fim.

- `57f93292-2152-4782-b703-6a4f691f6fe8` — "ZZ TESTE AUTOMASTER escrita" (criado vazio, apagado)
- `e87088fb-1bae-4819-89e7-374e34211b8f` — "ZZ TESTE AUTOMASTER corpo", cópia de `test.cmd`
  (`4ef1ddc1-a03f-4473-a320-a971d150017b`), apagado

Todos os comandos rodaram um de cada vez, com `AUTOMASTER_DUMPS=~/.automaster/dumps`.

---

## 1. O que se confirmou

### A leitura basta para remontar o corpo — a pergunta aberta da spec fecha em SIM

A `atributo` gravou e o documento relido não perdeu **nenhum** campo:

```
SUMIRAM: []
NOVOS: ['meta', 'senderAddress', 'updatedBy']
MUDOU filePath, fileUrl, updatedAt, updatedBy, version, workflowData
```

`montarCorpo` mandando o documento lido de volta é suficiente. O servidor só acrescenta
campos (`meta`, `senderAddress`, `updatedBy`); não apaga o que não foi enviado. Repetido em
três saves (`atributo`, `trocar-tag`, `trocar-ref`), sempre `SUMIRAM: []`.

### As operações que de fato funcionam

| ação | prévia | gravação | diff bateu? |
|---|---|---|---|
| `criar` | n/a | `{"id":"57f93292-…","assetWarnings":[]}` | n/a |
| `duplicar` | n/a | `{"id":"e87088fb-…"}` | n/a; copia steps **e** triggers (ids novos) |
| `renomear` | n/a | 200, `version` 8→9 | n/a |
| `mover` | n/a | `{"msg":"Updated successfully","error":false}` | n/a |
| `apagar` | n/a | `{"success":true}` | n/a |
| `historico` | n/a | lista de versões, `_id` = `<wid>-<n>` | n/a |
| `atributo` | imprime diff + `documento`, não grava | 200, `version` 1→2 | sim |
| `trocar-tag` | idem | 200, `version` 2→3 | sim |
| `trocar-ref` | idem | 200, `version` 3→4 | sim |
| `limpar-orfaos` | "nada a mudar" | — | ver §2.2 |
| `trigger` | ver §2.1 | ver §2.1 | **não** |

A prévia devolve o documento editado sob a chave `documento`, como a Task 7 previu.

### A guarda de concorrência é sólida (provada por substituição — ver §3)

`getWorkflowMeta` traz `version`, e ele bate com o `version` do documento:

```json
{"passo":"leitura","versaoLida":5,"metaVersion":5,"metaTemVersion":true}
{"passo":"meta apos rename","metaVersion":6}
{"guardaDispararia":true}
```

Toda escrita (inclusive `rename-workflow`, que é meta-only) incrementa `version` em 1. A
comparação `metaAgora.version !== versaoLida` é o discriminante certo.

### A guarda de workflow publicado dispara, nas duas ações

Editar corpo, publicado, só com `--confirmo`:

```
workflow PUBLICADO com 0 contato(s) dentro agora. Quem está no meio termina o passo atual
na versão antiga e segue pela nova daí em diante. Para gravar mesmo assim, repita com
--publicado junto de --confirmo.
```
(exit 1, nada gravado). Com `--publicado` junto: `aplicado True version 8 status published`.

`apagar` publicado sem `--publicado`: mesma recusa, com "Para apagar mesmo assim…" (exit 1).
Com `--publicado`: `{"success":true}`.

O "0 contato(s)" estava **correto**: o contato de teste `uWqujqll20tRuglV3mLt` foi inscrito e
o workflow (4 ações instantâneas) o terminou na hora — `workflows-ao-vivo -o dentro` mostrou
`dentro_agora: 0` com uma inscrição `finished`.

### A validação pelas 18 regras recusa a gravação

Tool MCP `workflow_editar`, `trocar-ref` para um id que não existe em lugar nenhum, com
`confirmo=True`:

```json
{"aplicado": false,
 "motivo": "gravação recusada: a validação contra as 18 regras encontrou erro novo — broken_field_ref: step '<...>' usa custom field inexistente: 'Mensagem recente ' (id ZZZidQueNaoExiste999)",
 "validacao": {"rodou": true, "snapshot": "2026-09-20_0856", "pode_gravar": false,
  "erros_novos": ["broken_field_ref: step '<...>' usa custom field inexistente: 'Mensagem recente ' (id ZZZidQueNaoExiste999)"],
  "erros_resolvidos": ["broken_form_ref: trigger 'Formulário Enviado' dispara por formulário inexistente: bblZYCoXk6rf3xl7ehyO"]}}
```

Releitura depois: `version 6`, campo ainda `N6cznmfKOH6YjVyyCSKg`. **Nada foi gravado.**

### O servidor valida referências na PUBLICAÇÃO

Achado bom e novo: publicar recusa com 400 quando o workflow cita asset que sumiu.

```
PUT https://backend.leadconnectorhq.com/workflow/Xb9gDxwxYhdqtprGcb5E/change-status/e87088fb-1bae-4819-89e7-374e34211b8f
→ HTTP 400 {"message":"Referenced asset(s) missing from this location: Form 'bblZYCoXk6rf3xl7ehyO'."}
```

Ou seja: o `broken_form_ref` do auditor tem eco no servidor, e um workflow com ref quebrada
**não publica**. Só publicou depois que a trigger do formulário morto foi removida.

---

## 2. O que caiu

### 2.1 O documento de escrita NÃO tem `triggersData`. A ação `trigger` é inteiramente inoperante.

Premissa da spec/Task 3: o `GET /workflow/<loc>/<wid>` devolve `triggersData`, e `editarTriggers`
mexe nessa lista.

Real: a chave **não existe** na resposta. Chaves de raiz do GET, verbatim:

```
['__v', '_id', 'allowMultiple', 'allowMultipleOpportunity', 'autoMarkAsRead', 'companyAge',
 'companyId', 'createdAt', 'creationSource', 'dataVersion', 'deleted', 'eventStartDate',
 'filePath', 'fileUrl', 'id', 'isTriggerBucketMigrated', 'locationId', 'name', 'originType',
 'parentId', 'permission', 'permissionMeta', 'removeContactFromLastStep', 'status',
 'stopOnResponse', 'timezone', 'triggersFilePath', 'type', 'updatedAt', 'version', 'window',
 'workflowData', 'workflowNote']
```

Conferido também em `test.cmd` (workflow real, com 2 triggers): `tem triggersData? False`.
O que existe é `triggersFilePath`. Os triggers vêm de outra rota, a mesma que o extractor já
usa na leitura: `GET /workflow/<loc>/trigger?workflowId=<wid>`.

Consequências, todas exercitadas:

**a) `--trigger-acao remover` é impossível.** Com um id de trigger real:

```
$ npx tsx src/cli.ts workflow-editar -l Xb9gDxwxYhdqtprGcb5E --acao trigger \
    -i e87088fb-… --trigger-acao remover --trigger-id SzlB2sn2DksWkjAj5aSw --json
trigger SzlB2sn2DksWkjAj5aSw não existe neste workflow
exit=1
```

`substituir` cai no mesmo `findIndex` e falha igual. Nunca vão funcionar.

**b) `--trigger-acao adicionar` mente: devolve sucesso e não faz nada.** O comando reportou

```json
{"aplicado":true,"acao":"trigger",
 "diff":{"triggersAdicionados":[{"id":"ZZTESTEAUTOMASTER01","nome":"ZZ trigger teste"}],
         "triggersRemovidos":[],"triggersAlterados":[]},
 "mudancas":["trigger adicionado"], "resposta":{… "version":5 …}}
```

O `only-triggers` respondeu 200 e bumpou `version` 4→5 e `triggersFilePath` de `…/NaN` para
`…/5`. Mas a lista autoritativa continuou com os 2 originais:

```
2 triggers apos trigger adicionar
  SzlB2sn2DksWkjAj5aSw customer_reply Cliente Respondeu
  rBCe10H7QHJcMg4hLKS8 form_submission Formulário Enviado
```

O trigger novo não apareceu em lugar nenhum. É um falso positivo de escrita — o padrão que
já apareceu na rodada anterior com `inscrever` em `draft`.

**c) O lado bom: o save de corpo NÃO apaga trigger.** Três saves de corpo mandaram o
documento sem `triggersData` e os 2 triggers continuaram lá, intactos. O risco de wipe que
se temia não existe.

**d) A rota certa existe e foi achada na prova:**

```
DELETE https://backend.leadconnectorhq.com/workflow/<loc>/trigger/<triggerId>?workflowId=<wid>
→ {}
```

Apagou de verdade (`rBCe10H7QHJcMg4hLKS8` sumiu da lista). Foi assim que o workflow ficou
publicável. **Esta é a rota que a Task 9 deve usar**; `only-triggers` não serve.

**e) A validação pelas 18 regras herda o defeito.** `validacao_escrita.py` faz
`novo_raw["triggers"] = doc_editado.get("triggersData") or []` — como a chave nunca existe,
a lista de triggers do "depois" é **sempre vazia**. Por isso a saída acima traz
`erros_resolvidos: ["broken_form_ref: trigger 'Formulário Enviado' …"]`: a regra não viu
trigger nenhum e concluiu que o problema sumiu. Nenhum ERROR de trigger é detectável hoje, e
todo ERROR de trigger pré-existente é reportado como resolvido.

### 2.2 O encadeamento é `parentKey`, não `parent`. `limpar-orfaos` é um no-op estrutural.

`alcancaveis()`/`removerStepsInalcancaveis()` leem `s.parent`. Nos documentos reais o campo é
`parentKey`:

```json
{"id":"d56b83ac-…","order":1,"attributes":{…},"name":"Assign to user",
 "type":"assign_user","next":"e350d7f3-…","parentKey":"079d1b81-…"}
```

Nenhum step tem `parent`, então `raizes = steps.filter(s => !s.parent)` devolve **todos**, e
tudo é alcançável por definição. Prova direta: injetei um step órfão de verdade no documento
real e rodei a função:

```
removidos: []
steps restantes: 5
```

Ao vivo, `limpar-orfaos` no workflow real devolveu
`"nada a mudar: a operação não encontrou alvo neste workflow"` — o que é verdade aqui, mas
seria a resposta **mesmo havendo órfão**. A ação nunca removerá nada até trocar `parent` por
`parentKey`.

### 2.3 A tool MCP quebra com exceção crua em workflow fora do dump

Qualquer workflow criado ou duplicado depois da última extração — exatamente o caso de todo
workflow descartável — faz `validar_edicao` levantar `ValueError`, sem `try/except` em
`mcp_server.workflow_editar` (linha 1069):

```
EXCECAO ValueError workflow e87088fb-1bae-4819-89e7-374e34211b8f não está neste dump — extraia a subconta de novo
```

Pior: a prévia (que abre o Chrome inteiro) já rodou antes de estourar. Para exercitar a
recusa de validação tive de fabricar um dump de trabalho em `/tmp` com o workflow dentro.
Deve virar um `validacao: {rodou: false, motivo: …}`, como já acontece quando não há dump
nenhum — não uma exceção.

### 2.4 `trocar-ref` troca o id e deixa o rótulo humano velho

Depois de trocar `AFXirORWBWmtRRdj0baK` → `N6cznmfKOH6YjVyyCSKg`:

```json
{"field":"N6cznmfKOH6YjVyyCSKg","value":"Olá","title":"Mensagem recente ","type":"string","date":""}
```

O `title` continua "Mensagem recente " enquanto o id agora é "consentimento". O app mostra o
rótulo errado. Não é erro de dado (o id manda), mas confunde quem abrir o editor.

### 2.5 Nits confirmados

- A resposta do PUT de save **não traz `workflowData`** (só a meta). Quem quiser conferir o
  resultado tem de reler — o comando já relê, mas nada no código diz isso.
- O aviso da guarda de `apagar` reusa o texto da guarda de edição ("Quem está no meio termina
  o passo atual na versão antiga e segue pela nova daí em diante"), que não faz sentido para
  exclusão.
- `renomear` e `mover` de workflow publicado **não** passam pela guarda de publicado (só
  `apagar` e as ações de corpo passam). É inofensivo, mas é assimetria não declarada.
- Sem `AUTOMASTER_DUMPS` no ambiente, o registro de escrita vai para `<repo>/dumps/_workflows/`,
  não para `~/.automaster`. O primeiro comando desta prova gravou lá.
- O registro da `duplicar` é arquivado sob o id do workflow **de origem**, não o da cópia
  (`_workflows/<loc>/4ef1ddc1-…/…json` para uma cópia `e87088fb-…`).

---

## 3. O que não foi exercitado, e por quê

- **A guarda de concorrência pelo caminho real (alguém salvando pelo app do GHL).** Não há
  como clicar no app daqui. **Substituição:** um script rodou, numa só sessão do Chrome, a
  sequência exata da guarda contra o servidor real — leu o documento (`version 5`), leu
  `getWorkflowMeta` (`version 5`), fez uma escrita independente no mesmo workflow
  (`rename-workflow`, que é o que alguém faria pelo app), releu a meta (`version 6`) e
  comparou. Resultado: `{"guardaDispararia":true}`.
  **Isso prova** que a meta traz `version`, que ele é o mesmo contador do documento, que uma
  escrita alheia o incrementa, e que a comparação do comando abortaria.
  **Isso não prova** que um save feito pela interface do builder incrementa o mesmo contador
  do mesmo jeito (é plausível — `rename-workflow` é uma operação do próprio app), nem que a
  mensagem de erro do comando sai na janela real da corrida, que é de poucos segundos.
- **`--trigger-acao substituir`.** Cai no mesmo `findIndex` de `remover`, que já falhou; testar
  de novo não acrescentaria nada.
- **`recuperarWorkflow`** (restaurar versão do histórico). Fora do escopo da Task 5; o comando
  não a expõe.
- **Editar workflow publicado com contato realmente DENTRO.** O workflow de teste é instantâneo
  (4 ações sem espera) e o contato termina antes de qualquer leitura. Provar isso exigiria um
  step de espera e uma janela de minutos; a guarda em si já foi provada (dispara, e o número
  que ela cita confere com `workflows-ao-vivo -o dentro`).
- **`limpar-orfaos` removendo de verdade.** Impossível hoje: o comando não cria step órfão e a
  função é no-op (§2.2). A prova foi offline, sobre o documento real.

---

## 4. Resíduo deixado na subconta

**Nos workflows: nenhum.** Os dois descartáveis foram apagados e a lista voltou a 72:

```
total 72
residuo: sem residuo
```

**No contato de teste `uWqujqll20tRuglV3mLt`** (lead dummy de formulário do Facebook, já usado
nas rodadas anteriores): a inscrição no workflow publicado rodou as 4 ações nele. Tudo foi
revertido:

| o que a execução fez | estado agora |
|---|---|
| tag `teste-automaster` | removida (`--tag -teste-automaster`) |
| custom field `consentimento` (`N6cznmfKOH6YjVyyCSKg`) = "Olá" | limpo (`--set consentimento=`) |
| `assignedTo` = `3EX1SB4nwZWMjBaP5jei` | limpo (PUT `{"assignedTo": null}`; `""` **não** limpa, devolve 200 e mantém o dono) |

O contato ficou com `tags: ['zoi:ia-ativa', 'follow up - dia 1', 'ia - ativa']` e os 6 custom
fields originais — o mesmo conjunto do snapshot de 2026-09-18, mais a tag `ia - ativa`, que
**não** foi posta por esta prova (o step de tag da cópia já tinha sido trocado para
`teste-automaster` antes da publicação).

Ficou registrado, e é permanente: o `add_to_workflow` da cópia apontava para o workflow real
`dac2e64f-…` ("1C - Início manual"), que está em `draft` — a chamada não criou inscrição
nenhuma. Confirmado por `workflows-ao-vivo -o dentro`: a única inscrição que existiu foi a da
própria cópia, e ela terminou.

Uma inscrição `finished` (`01M3225QZ7NP4TEYW11377Z2WM`) referente a um workflow que já não
existe é o único rastro no histórico, e sumiu junto com o workflow apagado.

---

## 5. O que a Task 9 fez com cada achado (2026-09-21, versão 0.15.0)

| achado | o que mudou no código |
|---|---|
| §2.1 sem `triggersData` | `adicionar`/`substituir` trigger RECUSAM com mensagem explícita (parte B); `remover` usa o `DELETE .../trigger/<tid>?workflowId=<wid>`; `editarTriggers` e `salvarSomenteTriggers` saíram do código |
| §2.2 `parentKey` | `alcancaveis()`/`removerStepsInalcancaveis()` leem `parentKey`; fixtures dos testes corrigidas (passavam por usarem o campo errado dos dois lados) |
| §2.1e validação cega a trigger | `validar_edicao(..., triggers=None)`: com lista, usa a autoritativa; sem ela, mantém a do dump e marca `triggers_do_dump` — nunca mais lista vazia |
| §2.3 `ValueError` crua | a tool MCP lê o dump ANTES da prévia (que abre o Chrome) e devolve `validacao.rodou: false` com o motivo; `ValueError` residual também vira `rodou: false` |
| §2.5 aviso de `apagar` | texto próprio: "Apagar tira todos eles do fluxo agora, no passo em que estiverem, e não há desfazer" |
| §2.5 registro de `duplicar` | `criar` e `duplicar` arquivam sob o id NOVO (o da resposta), com `origem` dentro do registro |
| §2.5 PUT sem `workflowData` | comentado no código e documentado; o comando relê e devolve `versaoDepois` |

### Limitações conhecidas, deixadas de propósito

- **`trocar-ref` deixa o `title` velho** (§2.4). Não há de onde tirar o rótulo novo sem
  resolver o id contra a entidade, e o id é quem manda. O comando passou a **avisar**
  (`avisos` na saída, também impresso) quando o objeto alterado tem `title`.
- **`renomear` e `mover` não passam pela guarda de publicado.** Nenhuma das duas altera o que
  o contato vive; exigir `--publicado` para renomear seria atrito sem risco correspondente. A
  guarda cobre `apagar`, as ações de corpo e a remoção de trigger.
- **`only-triggers` não é mais usado**, e a função foi removida em vez de ficar disponível
  para alguém reencontrar e acreditar que funciona.
