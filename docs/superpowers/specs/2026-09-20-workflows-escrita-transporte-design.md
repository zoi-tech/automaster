# Escrita de workflows — Parte A: transporte e edição cirúrgica

Data: 2026-09-20
Status: spec aprovada no brainstorming, pendente de pesquisa e grill

## Contexto

O projeto lê workflows desde a primeira versão e, na 0.13.0, passou a escrever o que
cerca um workflow: publicar, despublicar, inscrever, remover e retomar contato. Nunca
escreveu o workflow em si — nome, pasta, triggers ou steps.

O bundle do editor (`client-app-automation-workflows.leadconnectorhq.com`, arquivo
`assets/index-*.js`) expõe um CRUD completo sobre `.../workflow/<locationId>`:

    POST   /<loc>                       criar — e também duplicar, com `workflow_id` preenchido
    PUT    /<loc>/<wid>                 salvar o workflow inteiro
    PUT    /<loc>/<wid>/auto-save       salvar rascunho automático
    PUT    /<loc>/only-triggers/<wid>   salvar só os triggers
    PUT    /<loc>/rename-workflow/<wid> renomear
    PUT    /<loc>/move-directory/<wid>  mover de pasta
    POST   /<loc>/<wid>/copy-workflow   copiar para outra subconta (`copyToSubAccount`)
    DELETE /<loc>/<wid>?userId=         apagar
    PUT    /<loc>/<wid>/recover         restaurar apagado
    GET    /<loc>/<wid>/history         histórico de versões
    GET    /<loc>/<wid>/history-by-number/<n>

O corpo do PUT de salvar carrega `workflowData`, e dentro dele `templates` — exatamente o
array de steps que hoje só lemos do Firebase. **O Firebase é cache de leitura, não a fonte
de escrita.** Isso derruba a premissa antiga de que escrever steps exigiria gravar no
Cloud Storage.

## Decomposição

A escrita de workflow foi dividida em três sub-projetos com dependência linear. Cada um
roda o ciclo spec → pesquisa → grill → plano por conta própria.

- **A (esta spec) — transporte e edição cirúrgica.** Rotas, guardas, e edição por operação
  sobre o JSON que veio do servidor. Fecha sozinha o caso de uso "corrigir achado da
  auditoria".
- **B — DSL.** YAML legível que compila para `workflowData` e decompila de volta, com os
  15 tipos de ação mais usados em primeira classe e passthrough verbatim no resto. Fecha
  "construir automação do zero por comando".
- **C — clonagem entre subcontas.** Resolver referência por nome no destino e criar o que
  faltar. Depende de A e B. **A primeira coisa que C investiga é a rota
  `POST /<loc>/<wid>/copy-workflow`**: o método do app se chama `copyToSubAccount`, então o
  servidor pode já copiar entre subcontas. Se copiar, C vira "mandar copiar e consertar o
  que o servidor não mapeou", não "traduzir cada referência à mão".

## Escopo de A

Oito operações de escrita e uma de leitura:

1. criar workflow vazio (nome, pasta opcional)
2. renomear
3. mover de pasta
4. duplicar na mesma subconta (`POST /<loc>` com `{new_workflow_name, workflow_id, parentId}`)
5. apagar
6. restaurar apagado
7. editar só os triggers — rota separada, **não é operação mais leve**: o corpo é o
   workflow inteiro, com os steps todos junto. Usada quando só triggers mudaram, para
   espelhar o que o app faz, não por ser mais segura
8. editar o corpo (`workflowData` inteiro, gerado por operação cirúrgica)
9. ler histórico de versões — só leitura: quem mexeu, quando, e comparar com o estado atual

**Restaurar versão antiga fica fora de A.** Não existe rota de restaurar; no app é uma tela
que exige workflow em rascunho e sem nenhum contato inscrito. Pela API nada disso é
verificado, e empurrar uma versão antiga sobre um workflow publicado deixa contatos parados
num passo que deixou de existir. Desfazer uma escrita nossa se faz pelo snapshot em disco,
que é o mesmo documento e cobre o caso real. Se restaurar versão entrar algum dia, entra
copiando a regra do app: só em rascunho, só sem ninguém dentro.

### Edição cirúrgica

A não traduz workflow para formato nenhum. Ela lê o JSON do servidor, aplica uma operação
sobre ele e regrava o documento inteiro. As operações são:

- **trocar referência** — substitui um id por outro em todo o workflow, em qualquer step ou
  trigger: tag, custom field, pipeline, estágio, usuário, workflow, custom value, template
- **remover step inalcançável** — só o bloco que a auditoria já marcou como nunca
  executado. Ninguém que executa aponta para ele, então não há ponteiro para recosturar.
  Remover step vivo do meio do fluxo exige costura de `next` e fica em B
- **alterar atributo de step** por caminho (`<stepId>.attributes.<campo>`)
- **adicionar, remover ou editar trigger**
- **renomear workflow**

Essas cinco cobrem as 18 regras de auditoria: as sete `broken_*_ref` e `stale_email_template`
saem por troca de referência, `unreachable_step` por remoção (`dead_end_draft` é step vivo e cai em B),
`uncovered_condition` e `broken_goto` por alteração de atributo, `workflow_unreachable` por
trigger, `naming_convention` por renomeação.

## Arquitetura

A divisão do projeto se mantém: o extractor é transporte burro, o auditor decide.

**`extractor/src/api/workflows-write.ts`** — uma função por rota, sem lógica de negócio.
Recebe o corpo pronto, devolve a resposta crua.

**`extractor/src/cli/workflow-editar.ts`** — comando novo em arquivo próprio. O `cli.ts`
já está com 2.371 linhas; ele passa a despachar para esse arquivo em vez de crescer de
novo. Nenhum comando existente é movido, mas três helpers privados do `cli.ts` passam a ser
exportados para o arquivo novo usar: `withClient` (`cli.ts:105`), `registroEscrita`
(`cli.ts:550`) e as constantes de workflow (`cli.ts:560-561`). Uma palavra `export` em cada,
em vez de trinta linhas duplicadas que divergem depois — snapshot duplicado viraria dois
formatos de arquivo na mesma pasta.

**Tool MCP `workflow_editar`** (auditor) — o cérebro. Lê o workflow ao vivo pelo comando
do extractor, aplica a operação, roda as regras, monta o diff e só então manda gravar.
Importa o auditor como biblioteca, nunca lê o dump direto, como as outras 30 tools.

## Como o corpo da escrita é montado

Medido nos 1.041 workflows em disco, de todas as subcontas: os steps que vêm em
`detail.workflowData.templates` são **byte a byte idênticos** aos baixados do Firebase, em
100% dos casos, inclusive no maior workflow (579 steps). O `GET .../workflow/<loc>/<wid>`
devolve o workflow inteiro; o Firebase não é necessário para escrever.

Por isso a regra é: **ler, alterar o mínimo, devolver o resto intocado.** O corpo do PUT é
a própria resposta que o servidor acabou de dar, com o campo alvo trocado. Nenhum corpo é
montado do zero — campo que não estamos mudando nunca é digitado, e por isso não pode ser
zerado por esquecimento.

Três campos são exceção à regra de não digitar nada: `createdSteps`, `modifiedSteps` e
`deletedSteps`, as listas que o app recalcula a cada save dizendo o que mudou naquela
edição. A operação cirúrgica sabe exatamente o que mudou, então são preenchidas
honestamente. Se o servidor as usa para montar o histórico de versões, o registro do GHL
fica correto sobre o que fizemos; se forem decorativas, não custou nada.

Os demais campos que o modelo do app mantém não vêm na leitura (`paused`, `workflowType`,
`templateId`, `campaignId`, `autoSavedBy`, `createdSteps`, `modifiedSteps`, `deletedSteps`,
`customObjectType`, `deletedAt`, `restoredAt`, `loopIdentified`, `templateCategories`,
`templateDescription`, `contactRemovedDueToSnapshotRefresh`). Como não os recebemos, não os
mandamos. A hipótese é que o servidor preserva o que não vem no corpo; **a primeira escrita
ao vivo existe para testar exatamente isso** — uma alteração boba num workflow descartável
da Instaltech, comparando o detalhe antes e depois campo a campo. Se algum campo sumir,
some num workflow de teste.

## Guardas

Na ordem, antes de cada escrita que toque corpo ou triggers:

1. **Snapshot.** O workflow inteiro vai para `<dumps>/_workflows/<loc>/<wid>/<ts>-antes.json`
   e `-depois.json`, no mesmo molde já usado em contato e mensagem. Permite desfazer à mão.
2. **Diff.** Steps e triggers somados, removidos e alterados, campo a campo, impressos antes
   de qualquer escrita.
3. **Validação.** As 18 regras rodam sobre o dump mais recente da subconta com o workflow
   editado no lugar do antigo. A escrita é recusada se **introduzir** um ERROR novo. ERROR
   que já existia não bloqueia — senão nenhum workflow com achado poderia ser corrigido. A
   idade do dump é impressa junto, porque a validação vale o que o dump vale.
4. **Duas checagens de publicabilidade.** O app roda, antes de salvar, uma bateria de
   validações próprias que cancelam o salvamento (workflow sem ações, `goto` sem destino,
   múltiplos goals, remetente de e-mail incompleto, loop sem corpo, entre outras). Pela API
   essas checagens não existem, e um workflow gravado fora delas trava o cliente: ele abre
   o editor, mexe em qualquer coisa e não consegue mais salvar. Replicamos as duas baratas
   — recusar escrita que deixe o workflow sem nenhuma ação, e `goto` sem destino válido,
   que a regra `broken_goto` já cobre. As demais dependem de entender cada tipo de ação e
   ficam para B; é limite conhecido, declarado, não coberto.
5. **Releitura antes de gravar.** Imediatamente antes do PUT, o comando relê a meta do
   workflow e aborta se `version` mudou desde a leitura que gerou o diff. O servidor não
   tem trava de concorrência — `version` é incrementado pelo cliente depois do save e não
   existe resposta de conflito —, então esta é a única proteção contra sobrescrever, em
   silêncio, uma edição feita pelo app com a aba aberta. Não cobre escrita simultânea no
   mesmo instante; cobre a janela real, que é o tempo entre montar o diff e confirmar.
6. **`--confirmo`.**

### Workflow publicado

Workflow publicado é editável, por decisão explícita. A guarda é informativa e redobrada:
o comando conta quantos contatos estão dentro agora (reusando a busca de inscritos da
0.13.0, descartando as linhas `finished`), avisa, e exige `--publicado` junto do `--confirmo`.
Só `--confirmo` não basta.

O aviso diz o que de fato acontece, não só o número: quem está no meio termina o passo
atual pela versão antiga e segue pela nova daí em diante — comportamento documentado pelo
GHL. Um aviso que informa vale mais que um que só assusta.

Operação que esvaziaria o workflow é **recusada**, não aplicada. O app, nesse caso,
rebaixa o workflow para rascunho sozinho; nós preferimos não mudar o estado de produção de
lado. Como a checagem de "sem nenhuma ação" já recusa antes, o rebaixamento nunca chega a
acontecer.

## O dump depois da escrita

O comando **não mexe no dump**. Um dump é o retrato de um momento; gravar dentro dele o
workflow recém-editado criaria um retrato que nunca existiu, misturando dois momentos — e o
contrato do projeto é `raw` intocado, resposta da API como ela veio. Reextrair a subconta
inteira a cada escrita é caro demais para o ganho.

O que muda: toda saída que dependa do dump (validação, diff contra o estado auditado)
imprime a idade do dump usado. Quem quiser o retrato novo roda `extract` de novo, como
sempre. `schemaVersion` não muda: o formato do dump é o mesmo.

## Testes

Unitários no extractor: montagem de cada corpo, e a aplicação de cada operação cirúrgica
sobre fixtures de workflow reais tirados dos dumps em disco.

Unitários no auditor: o diff, a comparação de achados antes/depois, e a recusa por ERROR
novo.

Ao vivo na Instaltech (`Xb9gDxwxYhdqtprGcb5E`), sobre workflow descartável criado e apagado
na hora. Os 72 workflows reais não são tocados.

## Pergunta aberta para a pesquisa

A meta do workflow traz `version` (um inteiro; `version: 10` no workflow de teste da
0.13.0). Não se sabe se o PUT exige esse número de volta como trava de concorrência. Se
exigir, gravar sobre um workflow que outra pessoa alterou falha — o desejável. Se não
exigir, duas edições simultâneas se sobrescrevem em silêncio, e o comando precisa comparar
`version` por conta própria antes de gravar.

Também sem resposta: se `auto-save` e `update` têm efeitos diferentes sobre o histórico de
versões, e qual dos dois o comando deve usar. A hipótese é `update`, que é o salvamento
explícito do botão.

## Fora de escopo em A

Reordenar o fluxo, remover step vivo do meio do fluxo, criar step do zero, e qualquer tradução entre o JSON do GHL e um formato
legível — tudo isso é B. Resolver referência entre subcontas é C. Escrita em lote sobre
vários workflows fica fora das três.

A regra de escrita serial do projeto continua valendo: o perfil persistente do Chrome é
único, e dois comandos de escrita ao vivo em paralelo travam no `SingletonLock`.

## Decisões do grill

- **A11** — A remove só step inalcançável; remover step vivo foi para B. Motivo: o
  encadeamento é por ponteiro (`auditor/src/automaster_audit/flow.py:4-8`), e tirar um step
  do meio exige recosturar `next`, ramo de `if_else` e transição de roteador. Step
  inalcançável não tem ninguém apontando para ele (`rules/unreachable_step.py`), então sai
  sem costura. Custo: `dead_end_draft`, que é step vivo, deixa de ser corrigível em A.
- **A1** — releitura de `version` imediatamente antes de gravar, abortando se mudou.
  Motivo: o bundle incrementa `version` no cliente depois do save e não trata 409; sem essa
  checagem, editar enquanto o app está aberto apaga o trabalho do outro sem erro. Não é
  trava e não pretende ser.
- **A9** — o corpo do PUT é a resposta da leitura com o campo alvo trocado, nunca um corpo
  montado do zero. Motivo: nos 1.041 workflows em disco, `detail.workflowData.templates` é
  idêntico ao arquivo do Firebase em 100% dos casos, então uma leitura basta; e devolver o
  documento inteiro evita zerar campo por esquecimento. Os 15 campos que a leitura não
  devolve ficam fora do corpo, e a primeira escrita ao vivo é uma alteração boba num
  workflow descartável só para verificar se o servidor os preserva.
- **A6** — replicadas só duas das validações de publicação do app: workflow sem ações e
  `goto` sem destino. Motivo: medido nos dumps, `goto` pendurado e goal não existem em
  1.041 workflows, e workflow vazio aparece 14 vezes; as demais validações exigem entender
  cada tipo de ação, que é B. O limite fica declarado na spec em vez de fingido.
- **A4/A5** — A lê o histórico de versões mas não restaura nenhuma. Motivo: o bundle não
  tem rota de restaurar (telas de versão são somente leitura) e a documentação do GHL exige
  rascunho e zero inscritos para restaurar; pela API essa proteção não existe. Desfazer
  usa o snapshot em disco, que cobre o caso real de errar a própria escrita.
- **A3** — corrigida a rota de duplicar: é o POST de criação com `workflow_id`, não
  `copy-workflow`. `copy-workflow` (método `copyToSubAccount` no app) ficou registrado como
  a primeira sondagem de C, sem ser testada agora: não muda nada em A.
- **A10** — `createdSteps`/`modifiedSteps`/`deletedSteps` são preenchidas honestamente.
  Motivo: a operação cirúrgica já sabe o que mudou; se o servidor monta o histórico com
  elas, o registro fica correto, e se não usa, o custo foi zero.
- **A2** — `only-triggers` continua sendo usada quando só triggers mudam, para espelhar o
  app, mas a spec deixou de descrevê-la como mais segura. Motivo: o bundle manda o mesmo
  corpo completo nas duas rotas; o risco sobre os steps é idêntico.
- **A13** — `withClient`, `registroEscrita` e as constantes de workflow passam a ser
  exportadas do `cli.ts`. Motivo: uma palavra por helper contra trinta linhas duplicadas
  que divergem; snapshot duplicado viraria dois formatos na mesma pasta.
- **A7** — operação que esvazia o workflow é recusada, não rebaixada para rascunho. Motivo:
  rebaixar publicado sem o usuário pedir muda o estado de produção de lado, e a checagem de
  "sem ações" já impede o caso antes.
- **A15** — o aviso de workflow publicado explica o efeito real da edição (termina o passo
  atual na versão antiga, segue na nova), além de contar os inscritos. Motivo: documentado
  pelo GHL; aviso que informa vale mais que aviso que assusta.
- **A12/A14/A16** — registro, sem mudança na spec: o repo já tem o snapshot, o catálogo de
  onde mora cada referência e o jeito de rodar as 18 regras em memória (reusar, não
  reescrever); não existe API oficial para isto e há prior art da API interna
  (`github.com/drleadflow/ghl-automation-builder`, útil para B, com a ressalva de que a
  maior parte do catálogo dele não tem prova ao vivo); e o handoff da 0.13.0 fala em oito
  premissas enquanto a memória do projeto fala em nove — corrigir de passagem.
- **Galho aberto (sem achado)** — o comando não atualiza o dump após escrever; passa a
  imprimir a idade do dump que usou para validar. Motivo: gravar o workflow novo num dump
  antigo produz um retrato que nunca existiu, e reextrair a cada escrita é caro.
  `schemaVersion` fica em 1 — o formato não muda.
