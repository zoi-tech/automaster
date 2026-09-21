# Changelog — plugin `automaster`

Versões do `.claude-plugin/plugin.json`. Toda mudança que afete o que o plugin
instalado faz sobe a versão aqui; o time atualiza com
`claude plugin marketplace update zoi && claude plugin install automaster@zoi`.

## 0.18.0 — 2026-09-21

O corpo do workflow passa a se montar pelo MCP: criar, remover e mover step do canvas — e,
com isso, montar um workflow inteiro do zero, trigger e bifurcação inclusive. Continuam 31
tools e 18 regras; 186 testes no extractor, 329 no auditor.

- **Três ações novas no `workflow_editar`: `step-criar`, `step-remover` e `step-mover`.**
  Como mexem no corpo, herdam tudo que a parte A construiu — snapshot antes da escrita,
  guarda de workflow publicado, releitura de `version`, conferência por releitura e a
  validação contra as 18 regras nas duas portas.
- **O step novo vai em JSON cru** (`corpo`). Os `attributes` dos 41 tipos de step não são
  modelados: o comando decide só o encadeamento (`id`, `parentKey`/`parent`, `next`, `order`).
  Copie um step existente do mesmo tipo como molde — schema inventado por tipo geraria caixa
  que o editor do app não abre.
- **`step-criar` sem `depois_de` põe o step no INÍCIO do fluxo.** Era o que faltava para
  nascer do zero: workflow criado pela API vem sem step nenhum, e sem âncora não havia como
  plantar o primeiro. Com steps já existentes, o novo vira a entrada e a antiga pendura nele;
  com mais de uma entrada, recusa e manda escolher.
- **`step-criar` com `ramos` monta um container de N saídas.** Um `if_else` nasce com o
  condition-node, os nós de ramo (`branch-yes`/`branch-no`), o `sibling[]` cruzado e o
  `attributes.branches` com os ids batendo; os outros containers usam `transition`. A cauda da
  âncora vai para o primeiro ramo, com aviso — um container não tem cauda própria.
- **A âncora (`depois_de`) pode ser um nó de ramo**, que é como se põe uma ação dentro do
  "sim" de um `if_else`. Container de N saídas é recusado, com a mensagem dizendo em qual
  ramo ancorar.
- **Nó de ramo não se remove sozinho** — é estrutura do container, indexada por
  `attributes.branches` e pelo `sibling[]` dos irmãos. Container só sai com `com_subarvore`,
  levando os ramos e tudo que pende deles; a recusa diz quantos steps sairiam.
- **A pergunta aberta do canvas fechou ao vivo**: step criado sem
  `advanceCanvasMeta.position` aparece no lugar certo, porque o editor calcula o layout.
  Nenhuma coordenada é inventada.
- **Prévia recusada não diz mais que produção pode ter mudado.** A dica de rastro saía em
  toda falha, inclusive na de uma prévia que não escreveu nada.

## 0.17.0 — 2026-09-21

Os débitos que a 0.15.0 e a 0.16.x deixaram declarados, fechados antes de abrir a escrita de
steps. Continuam 31 tools e 18 regras; 163 testes no extractor, 323 no auditor.

- **A validação contra as 18 regras ganhou uma porta de linha de comando.**
  `automaster-audit workflow-editar` chama a mesma função da tool MCP — prévia sem
  `--confirmo`, validação, gravação —, então a guarda deixa de existir só dentro do MCP. Nada
  foi reimplementado: é um segundo chamador. `npm run workflow-editar` continua sendo a camada
  crua e agora AVISA em stderr, a cada gravação, que passou por fora das regras.
- **Ação nova sem teste próprio quebra a suíte.** Um teste parametrizado cobre as onze ações da
  tool, fixando o que vai na linha de comando e se a validação rodou; outro compara a lista de
  ações com a tabela de casos e falha quando nasce ação sem caso. Foi a falta disso que deixou
  `trigger` rodar sem validação sem ninguém notar.
- **A prévia de trigger não cai mais inteira quando a lista de triggers falha.** Na adição a
  lista só alimenta o diff: perdê-la agora vira `aviso` e a validação usa a do dump. Devolver
  lista vazia seria pior que falhar — faria toda referência quebrada de trigger sair como
  "resolvida". Em `remover`/`substituir`, e em qualquer gravação, a falha continua fatal.
- **O mesmo dump gerava dois relatórios diferentes em duas rodadas.** `workflow_call_cycle`
  ancorava o achado no nó por onde o DFS entrou no anel, que depende da ordem de iteração de um
  `set`: três achados trocavam de workflow a cada execução e o `diff` de snapshots acusava
  mudança onde nada mudou. O ciclo passa a começar sempre pelo menor id. Contagem de achados
  inalterada (Instaltech: 31 ERROR, 19 WARN, 132 INFO).
- **Renomear um step não pode contar como erro novo, seja qual for a regra.** A normalização do
  detalhe cobria só a fraseologia `step '...'`; agora a lista de rótulos é explícita
  (`ROTULOS_DE_NO`) e um teste varre as regras e recusa quem nomeie um nó por fora dela —
  `uncovered_condition` já estava fora, com `if/else '...'`.
- **Array reordenado aparece como reordenado.** No diff e no residual, `["x","y"]` virando
  `["y","x"]` dizia só "attributes.tags", que se lê como "as tags mudaram".
- **Os dois lados leem o mesmo campo de ancestralidade.** `limpar-orfaos` lia só `parentKey`; o
  auditor já lia `parentKey` com o `parent` legado como reserva desde a 0.16.1.
- Corrigidos na documentação: `docs/endpoints.md` ainda dizia que criar e trocar trigger
  recusam no comando (a 0.16.0 implementou os dois) e o `CLAUDE.md` dizia que `parent` nunca
  aparece. O teste da tool que passava só porque a subconta `L1` não tem dump em disco agora
  força o ramo que queria medir.

## 0.16.1 — 2026-09-21

O grafo de execução do auditor passa a ler `parentKey`, o campo que o servidor grava.
Continuam 31 tools e 18 regras; 300 testes no auditor.

- **`parent` não era o campo errado, era o incompleto.** Os dois existem no dump: em 26.393
  steps de 1.027 workflows, `parentKey` cobre mais steps e discorda de `parent` em 1.017.
  Lendo `parent`, `roots()` devolvia 4.864 entradas onde existem ~1.027 — quase cinco vezes
  mais. `parent_of()` lê `parentKey` e cai no `parent` legado, então dump velho continua lendo.
- **Efeito medido na Instaltech**: as entradas de fluxo caem de 229 para 71 (uma por workflow)
  e `paths.md` sai de 4.827 caminhos para 3.364 — 1.463 eram caminhos-fantasma, começando no
  meio do fluxo. Os truncamentos no cap caem de 4 para 1.
- `journey.html` e as camadas 2 e 3 do `validation.html` andam sobre o mesmo grafo e mudam
  junto. Os achados da camada 1 não mudaram na Instaltech: ela não tem step órfão. Em todos os
  dumps em disco `unreachable_step` passa a ver 3 steps de verdade.

## 0.16.0 — 2026-09-21

Os cinco aprendizados da primeira montagem de automação de ponta a ponta viram guarda no
código. Continuam 31 tools e 18 regras; 158 testes no extractor, 299 no auditor.

- **Criar trigger existe.** `POST .../workflow/<loc>/trigger` grava quando o corpo leva
  `workflowId` em **camelCase**; com `workflow_id` — que é como a LEITURA devolve o campo — o
  servidor responde 200 com id e o trigger nasce órfão, sem disparar nada. Era esse falso
  positivo que fazia a rota passar por inexistente. `trigger_acao` agora aceita `adicionar`,
  `remover` e `substituir`, com o trigger novo em `trigger_corpo`; `criarTrigger` força o
  `workflowId` e reaponta as `actions`, e a gravação só é dada por feita quando o id aparece
  na lista autoritativa relida.
- **`criar` e `duplicar` exigem `pasta`.** Workflow fora de pasta não aparece na lista do app
  (a raiz mostra pasta, não workflow) e o editor abre em branco. A recusa vem antes de abrir o
  Chrome e o erro da CLI lista as pastas da subconta.
- **Workflow recém-criado nasce pela metade** — sem `status` e com `parentId` vazio.
  `nascerVisivel` move para a pasta e grava `status: "draft"` depois de criar ou duplicar;
  é idempotente e devolve o estado final em `visivel`.
- **A resposta traz `url`, o link do editor**, com `workflow` no SINGULAR. Com `workflows` (a
  rota da lista) o app devolve 404 e a página fica branca, mesmo em workflow publicado.
- **Ciclo provado ao vivo na Instaltech** (workflow descartável criado e apagado, sem resíduo):
  `criar` sem pasta recusa listando as pastas; `criar` com pasta devolve `visivel` com
  `parentId` e `status: "draft"`; `trigger adicionar` mostra a prévia e depois grava
  (`fsB5qsEsiksivnnqwE7b`); `substituir` troca o trigger e confere que o antigo saiu;
  `remover` esvazia a lista; `apagar` fecha. Sete de sete.
- **Documentado como armadilha**: `400 "action has a corrupted type"` é o servidor validando o
  corpo do step, e navegar no app pelo Playwright desloga o perfil persistente do Chrome.

## 0.15.0 — 2026-09-21

Escrita de ESTRUTURA de workflow. Uma tool nova (`workflow_editar`), 31 no total, módulo
`extractor/src/api/workflow-edit.ts`, rotas em `extractor/src/api/workflows-write.ts` e o
comando `npm run workflow-editar`. Continuam 18 regras de auditoria.

- **Cinco operações cirúrgicas** sobre o corpo: `trocar-ref` (um id em qualquer profundidade),
  `trocar-tag` (pelo nome, só onde tag mora — nunca em texto de mensagem), `limpar-orfaos`
  (steps que nunca executam), `atributo` (um campo de um step) e `trigger` (remover).
  Mais `criar`, `renomear`, `mover`, `duplicar`, `apagar` e `historico`.
- **Guardas do COMANDO** (`npm run workflow-editar`, e portanto de tudo que passa por ele):
  snapshot do antes em `<dumps>/_workflows/`, gravado ANTES da escrita em toda ação destrutiva;
  prévia com diff que não grava nada sem `--confirmo`; releitura da `version` antes de gravar
  (alguém salvou pelo app → aborta) e `--versao-esperada` para a janela entre prévia e gravação,
  que são dois processos; `--publicado` obrigatório junto de `--confirmo` em workflow publicado,
  com a contagem de quem está dentro agora; `--de` de `trocar-ref` tem que ter cara de id.
- **Guarda da TOOL MCP `workflow_editar`, e só dela:** a validação do documento editado contra
  as 18 regras, que RECUSA a gravação se a edição introduzir um ERROR novo. Ela mora na tool,
  não no comando — quem roda a CLI com `--confirmo` escreve sem passar por regra nenhuma, de
  propósito (o comando não carrega o auditor). Mover a guarda para a CLI é parte B.
- **200 não é prova nesta API, e bump de `version` também não** — a rota irmã `only-triggers`
  faz os dois e não grava nada. Toda escrita agora CONFERE o efeito relendo: a edição de corpo
  compara o que pediu com o que ficou e responde `aplicado: "duvidoso"` com o diff residual
  quando sobra diferença; a remoção de trigger relê a lista autoritativa e dá erro explícito se
  o id ainda estiver lá. A saída de `trigger` passa a trazer a lista REAL relida.
- **`apagar` guarda cópia do que apagou**: o documento inteiro e a lista de triggers vão para o
  registro antes do DELETE. É a única escrita irreversível daqui — `PUT /<loc>/<wid>/recover`
  aparece no bundle do editor e está no mapa da spec, mas nunca foi exercitada (não se sabe o
  corpo nem se restaura workflow apagado ou versão do histórico), então a função morta saiu do
  código e `apagar` continua sem desfazer até haver prova ao vivo.
- **A tool MCP não devolve mais o documento inteiro do workflow**: ele existe para a validação
  local e só; voltava para o contexto do modelo sem teto nenhum.
- **Achado do servidor:** publicar workflow com referência quebrada dá
  `400 {"message":"Referenced asset(s) missing from this location: Form '…'."}`. O
  `broken_form_ref` do auditor tem eco no próprio GHL.
- **Correções da prova ao vivo** (nove premissas testadas, quatro caíram):
  `adicionar` e `substituir` trigger agora RECUSAM em vez de devolver sucesso falso — não há
  rota para criar nem para trocar trigger, e o `only-triggers` responde 200 sem gravar nada;
  `remover` trigger passou a usar o `DELETE .../trigger/<tid>?workflowId=<wid>`; `limpar-orfaos`
  passou a ler `parentKey` (com `parent` nada era órfão e a operação era no-op); a validação
  pelas regras recebe a lista autoritativa de triggers e, sem ela, usa a do dump e diz isso
  (antes tratava a lista como vazia e dava todo ERROR de trigger como "resolvido"); a tool MCP
  checa o dump ANTES de abrir o Chrome e devolve `validacao.rodou: false` para workflow fora do
  dump, em vez de estourar `ValueError`.
- **A remoção de trigger passa pela validação das 18 regras**, como as ações de corpo: a prévia
  devolve o documento e a lista de triggers de depois, e um ERROR novo (tipicamente
  `workflow_unreachable`, quando o trigger removido era a única entrada) recusa a gravação.
  Quando não há o que validar, a resposta traz `validacao.rodou: false` com o motivo — a chave
  nunca some em silêncio.
- **Fora, declarado:** remover step vivo e recosturar ponteiros, criar step do zero, reordenar
  fluxo, restaurar versão ou workflow apagado (a rota `recover` existe no bundle mas nunca foi
  exercitada), criar/trocar trigger e mover a validação pelas 18 regras para a CLI — tudo parte B.
- **Limitações conhecidas** (deixadas de propósito, com motivo): `trocar-ref` troca o id e o
  rótulo humano (`title`) do step continua o antigo, porque não há de onde tirar o rótulo novo —
  o comando passou a AVISAR quando isso acontece; `renomear` e `mover` não passam pela guarda de
  publicado, porque não alteram execução nenhuma.

## 0.14.0 — 2026-09-20

Templates de e-mail. Uma tool nova (`modelos_email`), 30 no total, módulo
`extractor/src/api/emails.ts` e a entidade `email_templates` no dump.

- **A premissa antiga estava errada.** A doc dizia que e-mail não dava para auditar porque o
  `template_id` do step não casa com o email builder. O campo certo é outro: o id real do
  template está no `previewUrl` do step. Quando o usuário escolhe um template existente, o GHL
  guarda uma cópia dentro do step, e o `template_id` passa a ser o dessa cópia.
- Duas regras novas, 18 no total: `stale_email_template` (WARN) para step cujo template sumiu do
  builder, e `unused_email_template` (INFO) para template que nenhum workflow usa.
- É WARN e não ERROR porque o e-mail continua sendo enviado: o conteúdo vive no Storage. O que
  se perdeu é poder editá-lo pelo app.
- Provado comparando duas subcontas: a Cliente B casa 6 de 6 no mesmo formato que falha 5
  vezes na Instaltech, então template fora da lista é template apagado, não cópia oculta.
- `modelos_email` tem `lista`, `usos` (qual workflow cita cada template) e `conteudo` (texto e
  links, baixados na hora de uma URL pública, sem Chrome e sem token).
- `comparar` e a seção "Regras cegas" do relatório passam a cobrir e-mail.

## 0.13.0 — 2026-09-20

Workflows ao vivo. Duas tools novas (`workflows_ao_vivo`, `workflow_acao`), 29 no total,
módulo `extractor/src/api/workflows-live.ts` e dois comandos de CLI.

- Leitura ao vivo pelos dois lados: quem está dentro de um workflow (com o passo em que
  cada um parou, desde quando e por que entrou) e em que workflows um contato está.
- Escrita: publicar/despublicar, inscrever, remover e retomar. Tudo atrás de `confirmo`,
  com registro em `<dumps>/_workflows/<locationId>/<workflowId>/`.
- **Despublicar não remove ninguém**: quem está dentro congela no passo em que está e volta
  a andar, todo mundo de uma vez, na republicação.
- **Inscrever é enfileirado pelo servidor**: ler o estado logo depois pode não mostrar o
  contato ainda.
- **Toda escrita é carimbada com o usuário logado**, lido do token; sem conseguir ler, a
  escrita recusa e pede `usuario`.
- A tool `workflow` passa a declarar na descrição que lê o dump — o estado corrente é da
  tool nova. Comportamento inalterado.
- Teto de 500 inscritos por leitura, ajustável, com declaração de corte.
- As quatro escritas (publicar/despublicar, inscrever, remover, retomar) foram exercitadas
  ao vivo na Instaltech; quatro comportamentos (retomar inscrição pausada, despublicar com
  gente congelando de verdade, remover contato parado no meio, e efeito sobre inscrição
  dupla) ficaram sem prova — nenhum workflow descartável tinha passo de espera. Detalhe em
  `docs/superpowers/handoffs/2026-09-20-workflows-ao-vivo-prova.md`.

Rotas em `docs/endpoints.md`, seção `## Workflows ao vivo`.

## 0.12.0 — 2026-09-19

Escrita de formulários e surveys. Duas tools novas (`formulario_acao`,
`formulario_estilo`), 27 no total, e a skill `automaster-formulario-visual`.

- Criar, editar, duplicar, apagar e restaurar versão de formulário e survey. A edição
  republica o documento inteiro a partir do que está no servidor, aplicando operações
  declaradas — campo que o automaster não modela atravessa intacto.
- Slide do survey é entidade de primeira classe: criar, remover, renomear, reordenar,
  mover campo entre slides e lógica condicional entre slides (salto). Navegação e barra
  de progresso são atributos de estilo (`form.isProgressBarEnabled` etc.) escritos pela
  op genérica `definir`, não operações próprias.
- Prévia antes de publicar: sem `--confirmo`, o comando mostra campo que entra, campo que
  sai e estilo alterado, sem tocar no servidor. É o primeiro comando do projeto com esse
  comportamento; os outros continuam dando erro seco.
- Identidade visual por cliente: os tokens vão para `fieldStyle` (o painel do builder, que
  sobrevive a edição na interface) e `customStyle` (CSS livre). `fieldCSS` nunca é escrito.
  Screenshot da página pública real para aprovar antes de aplicar em produção.
- Paleta padrão da subconta: leitura sempre, gravação só por comando à parte, e mescla —
  não substitui — as cores que a subconta já tinha.
- Guardas: remover exige nomear o campo; deixar o documento sem botão de envio ou sem
  nenhum campo é recusado sem flag explícita.
- **A leitura de formulários migrou de `backend.` para `services.leadconnectorhq.com`**, o
  host que o app usa — as seis rotas de leitura foram comparadas ao vivo entre os dois
  hosts e devolveram o mesmo conteúdo.
- **Achado de API, sem causa confirmada**: `duplicar` de survey pode devolver `200` com
  documento completo sem gravar nada, e um survey lido com sucesso pode desaparecer antes
  do `apagar` seguinte alcançá-lo. Depois de qualquer escrita de survey, confirme com um
  `GET` antes de assumir que o objeto está lá. Detalhe em `docs/endpoints.md`.
- **Escrita ao vivo é serial por construção**: o perfil persistente do Chrome é único, e
  dois comandos de escrita ao vivo em paralelo travam no `SingletonLock`.

## 0.11.0 — 2026-09-19

Formulários e surveys: leitura ao vivo, submissões, duas listas novas no dump e duas
regras de auditoria.

- **Tool nova `formularios` (25 no total)**: lista (já paginada), detalhe com os campos,
  submissões com filtro de formulário, contato e período, e busca por nome. O parâmetro
  `tipo` escolhe entre formulário e survey. Lê ao vivo, não usa o dump.
- **Regras novas `broken_form_ref` (ERROR) e `unused_form` (INFO), 16 no total**: a
  primeira acusa trigger de formulário/survey e `formId` de calendário apontando para
  algo que não existe mais — na Instaltech é 1 achado real, o trigger "Formulário
  Enviado" citando `bblZYCoXk6rf3xl7ehyO`. A segunda lista o que ninguém referencia, e é
  INFO de propósito: formulário embutido em site externo não aparece no dump.
- **O dump ganha `forms.json` e `surveys.json`**, opcionais como os de template. Dump
  antigo continua carregando (schemaVersion segue 1) e não gera achado novo.
- **Comando de CLI novo** `npm run formularios`. Rotas em `docs/endpoints.md`, seção
  `## Formulários e surveys`.
- O id `fb-<locationId>` das submissões é o lead gen do Facebook e nunca vira achado.
- **Seção "Regras cegas" no `report.md`**: dump anterior a uma lista opcional passa a dizer
  quais regras não rodaram, para que ausência de achado não se confunda com tudo certo.

## 0.10.0 — 2026-09-19

`broken_template_ref`, a última regra de auditoria que faltava, mais as duas listas de
template que ela precisava no dump.

- **Regra nova `broken_template_ref` (ERROR, 14 no total)**: step que manda WhatsApp, SMS
  ou DM citando template que não existe mais. Na Instaltech são 25 achados reais,
  confirmados ao vivo — o app também não acha esses ids.
- **O dump ganha `message_templates.json` e `whatsapp_templates.json`**, cada um opcional:
  canal desligado na subconta vira warning no manifest e a regra fica no-op para ele. Dump
  antigo continua carregando (schemaVersion segue 1, como quando entraram users e
  calendars) e não gera achado de template.
- **`template_id: "0"` não é achado**: é a opção "None - Free form message" do próprio app,
  e o texto vive em `attributes.message`. Sem essa exceção seriam 90 falsos positivos só
  na Instaltech.
- **E-mail ficou fora da regra, de propósito**: nenhum `email.template_id` casa com id do
  email builder, nem varrendo as pastas. Seriam 13 de 13 falsos positivos. Razão em
  `docs/endpoints.md`.
- O `diff` passa a comparar as duas listas de template. Dump sem a lista é tratado como
  "não sei", não como "lista vazia" — senão o primeiro diff depois do upgrade diria
  "81 templates novos" sem nada ter mudado.

## 0.9.0 — 2026-09-19

Diff entre dois snapshots da mesma subconta: "o que mudou desde o dump anterior".
Trabalho só de disco — nenhuma rota nova, nenhum Chrome.

- **Tool nova `comparar`** (24 no total) e subcomando `automaster-audit diff <antigo> <novo>`,
  que escreve `diff.md` na pasta do snapshot mais recente. Sem `antes`/`depois`, a tool
  compara os dois snapshots mais recentes da subconta.
- Workflow conta como alterado quando muda nome, status ou o conteúdo dos steps ou dos
  triggers. A comparação de conteúdo é por impressão digital do JSON canônico, e não por
  `updatedAt`: o `updatedAt` do detail nem sempre acompanha edição de step.
- Entidades entram no diff pelo que apareceu e pelo que sumiu (pipelines, estágios, tags,
  custom fields, usuários, calendários, custom values). Entidade ausente nos dois dumps
  antigos simplesmente não gera linha.
- Comparar dumps de subcontas diferentes não é erro, mas sai um aviso no relatório e no
  stderr — o resultado nesse caso é "tudo trocado" e não significa nada.

## 0.8.0 — 2026-09-19

Bloqueio de horário: capacidade nova na agenda, mais uma mudança de comportamento em
`forcar` e uma rodada de correções de uma revisão sobre a 0.7.0.

- **`agenda_acao` ganha `bloquear` e `bloqueio-editar`** (`POST`/`PUT
  /calendars/events/block-slots`), e `agenda` ganha `o=bloqueios`. Bloqueio não tem contato
  nem situação nem `calendario` — a tool recusa os três — e exige `dono`: com `calendario`
  de um calendário comum o servidor responde `400 The calendar is not an event calendar.`
  Sem tool nova: o plugin continua com 23 tools.
- **Mudança de comportamento: `forcar` agora EXIGE `dono`**, em `marcar` e também em
  `remarcar` (os dois ligam `ignoreFreeSlotValidation`, e sem `dono` o servidor devolve
  `422 A team member needs to be selected`). Quem chamava `forcar` em `remarcar` sem `dono`
  e contava com o servidor resolver sozinho passa a levar o erro da tool em vez do 422 —
  quebra uma chamada que antes "funcionava" por sorte do compromisso já ter responsável.

### Corrigido
- `_tipo`: o discriminante é `status` (`booked`/`unavailable`), não a presença de
  `contactId`.
- Bloqueio **não aparece** em `o=eventos` — só em `o=bloqueios`. Descrição da tool
  `agenda` e o comentário de `listBlockedSlots` diziam o contrário; corrigidos, porque um
  agente lendo a versão errada concluiria "sem bloqueio" e escreveria por cima de um.
- `bloqueio-editar` ganhou a mesma guarda de campos obrigatórios de `bloquear` (`inicio`,
  `fim`, `dono`, além de `id`): o PUT substitui o bloqueio inteiro, e campo ausente era
  perdido em silêncio — `bloqueio-editar -i x --titulo novo --confirmo` sozinho já bastava
  para o bloqueio perder dono e horário.
- `o=bloqueios` recusa `contato`: a rota não filtra por contato, e pedir isso devolvia o
  período inteiro sem avisar que o filtro foi ignorado.
- `--pagina` sem coerção virava offset `NaN`; agora clampada como `--limite`. Mesma
  correção nos dois filtros irmãos de oportunidades (`limite`/`pagina`).
- **`silenciar` provado do lado seguro** (herdado da 0.7.1): em calendário com notificação
  ao contato ligada, compromisso marcado com `silenciar` não gerou nenhuma mensagem na
  conversa do contato. O caso não silenciado segue sem prova, por decisão de segurança.

`bloqueio-editar` com corpo parcial (só `--titulo`, por exemplo) não foi exercitado ao vivo:
a guarda nova recusa esse caso antes de chegar ao servidor, então não há prova de como o
GHL de fato reagiria a um PUT parcial.

## 0.7.0 — 2026-09-19

Agenda: calendários, compromissos e notas, lidos e escritos ao vivo.

- **`agenda`**: calendários, calendário por id, horários livres, lista de eventos (mistura
  compromisso e bloqueio — filtre por `_tipo`), um compromisso por id, notas de um
  compromisso. Só leitura, sempre ao vivo — o dump só guarda nome e id de calendário, para
  resolver referência de workflow; compromisso não está lá.
- **`agenda_acao`**: marca, remarca, muda a situação (`new`/`confirmed`/`cancelled`/
  `showed`/`noshow`/`invalid`/`completed`/`active` — não existe "remarcado"), cancela, e
  cria/edita/apaga nota. Exige `confirmo=true`; registro em `<dumps>/_agenda/`. Compromisso
  que se repete exige `alvo` (`instancia` ou `serie`) — sem ele a tool recusa em vez de
  escolher.

**A escrita fala com o cliente.** Marcar ou remarcar dispara o e-mail ou SMS que o
calendário tem configurado e acorda as automações do compromisso. `--silenciar`/
`silenciar=true` desliga as automações junto, mas **não está provado** que também impede a
mensagem — o calendário de teste não tinha notificação configurada.

Validado ao vivo na Instaltech, num calendário descartável criado e apagado na hora
(`fuqBFE5vmoRDGK6u6Vpj`), com o contato de teste. Cobriu marcar, remarcar (série completa e
uma só ocorrência), mudar situação, cancelar e as três operações de nota. **Não** exercitado
ao vivo: bloqueio de horário (`block-slots`), `--forcar` isolado, e a forma real de um
bloqueio (a Instaltech não tinha nenhum — o discriminante `_tipo` vem da referência, não de
um bloqueio observado). Rotas e armadilhas em `docs/endpoints.md` seção `## Agenda`.

Bug achado e corrigido pela própria validação: a checagem de série lia o envelope errado
(`{event:...}` em vez de `{appointment:...}`), o que fazia a guarda de `--alvo` nunca
disparar. Corrigido; os três casos (`--alvo instancia`, `--alvo serie`, sem `--alvo`)
exercitados ao vivo depois da correção. Essa guarda e o desembrulho do envelope não têm
teste em CI (o extractor não tem runner) — só a prova manual registrada acima.

CLI: agenda, agenda-acao.

## 0.6.0 — 2026-09-19

Oportunidades: os funis e os cards da subconta, lidos e escritos ao vivo.

- **`oportunidades`**: pipelines e seus estágios, cards com filtro de pipeline, estágio,
  status e contato, busca por termo livre, e um card pelo id. Só leitura, sempre ao vivo —
  não usa o dump.
- **`oportunidade_acao`**: cria, edita, move de estágio, muda o status, apaga e restaura um
  card. Exige `confirmo=true`; registro em `<dumps>/_oportunidades/`. O contato de um card
  se define na criação e não se troca depois — a tool recusa a tentativa e explica.
- **`pipeline`**: cria, edita e apaga pipeline. A lista de estágios é substitutiva, então
  estágio omitido é removido junto com os cards dele — a tool conta os cards antes e
  recusa, a menos que `apagar_com_cards=true`. Apagar pipeline não tem restore.

As três foram exercitadas ao vivo na Instaltech, num pipeline descartável criado e apagado
na hora, sem tocar os 4 pipelines reais. Rotas e armadilhas em `docs/endpoints.md`.

Não entrou: apagar cards em lote, e busca de pipeline por nome — a rota que parecia fazer
isso (`pipelines/search`) é listagem de cards de um estágio, não busca de funil.

CLI: oportunidades, oportunidade-acao, pipeline.

## 0.5.0 — 2026-09-19

Fecha as cinco áreas de conversas que a 0.4.0 tinha deixado de fora.

- **`anexar`**: sobe arquivos do disco como anexo de uma conversa e devolve as URLs para
  passar ao `enviar(anexos=[...])`. Não fala com o contato — só cria os arquivos no CRM.
  Teto de 25 MB por arquivo; cada upload deixa registro em `<dumps>/_anexos/`.
- **`whatsapp`**: templates com os componentes inteiros, templates aprovados, flows,
  números e estado da conta. Só leitura.
- **`whatsapp_enviar`**: manda um template aprovado ou um flow interativo. Sai para o
  contato, exige `confirmo=true`.
- **`config`**: configuração de IA e de SLA das conversas, incluindo o que está estourando
  agora na caixa. As escritas valem para a subconta inteira e gravam o estado anterior em
  `<dumps>/_config/`.
- **`grupo`**: group chat e chat interno entre usuários. O corpo de criar grupo não foi
  confirmado ao vivo — a tool aceita o payload cru.
- O cliente HTTP do extractor passou a falar multipart (`postMultipart`), que era o que
  travava o anexo desde a 0.4.0.
- CLI: `conversas-anexar`, `whatsapp`, `whatsapp-enviar`, `config`, `grupo`.

## 0.4.0 — 2026-09-19

Conversas completas: o que faltava da leitura, a gestão da caixa e os rascunhos.

- `conversas` ganhou filtro por tipo, busca dentro da conversa e `email=<id>` para o corpo
  inteiro de um e-mail (cortado em 400 caracteres na listagem).
- **`conversas_buscar`**: procura um texto nas mensagens de toda a subconta e diz quem
  recebeu.
- **`conversa_acao`**: marcar lida/não lida, estrela, cancelar uma mensagem agendada,
  reenviar uma que falhou — e apagar a conversa, que exige `confirmo=true` porque leva o
  histórico inteiro junto (o GHL não apaga mensagem avulsa).
- **`rascunho`**: criar, listar e apagar rascunho do contato. Não sai para ninguém.
- `enviar` aceita `quando` para agendar.

### Cuidado

O cancelamento de mensagem agendada responde **200 mesmo quando não cancelou** — a razão
vem no texto da resposta. E agendamento não funciona em nota interna: ela sai na hora.

## 0.3.0 — 2026-09-19

### Novidade

- **Tool `conversas`**: lê ao vivo as mensagens trocadas com um contato (SMS, e-mail,
  WhatsApp, chat). Cada mensagem traz tipo, direção, autor e `origem`
  (`app`/`workflow`/`campaign`/`api`) — é a `origem` que diz se a mensagem saiu de uma
  automação ou de uma pessoa. Corpo cortado em 400 caracteres; eventos de timeline ficam
  de fora salvo `atividades=true`. Na CLI: `npm run conversas`.
- `discover` ganhou `--rota` (abre qualquer tela) e `--filtro` (mostra também a resposta
  dos GET), que era o que faltava para mapear leitura da API interna.

- **Tool `enviar`**: manda mensagem ao contato (SMS, Email, WhatsApp, nota interna). Tipo
  `InternalComment` fica só na conversa e não sai para o contato; qualquer outro exige
  `confirmo=true`, porque manda mensagem de verdade e não tem desfazer. Cada envio deixa
  registro em `<dumps>/_mensagens/`. Na CLI: `npm run conversas-enviar`.

### Cuidado

Automação não se reconhece pela falta de autor: e-mail disparado por workflow vem com
`userId` preenchido. Use `origem`.

O `type` da mensagem é número na leitura e string no envio. Não são a mesma lista.

## 0.2.1 — 2026-09-18 (`289beb9`)

- **Corrige o servidor MCP não conectar em sessões abertas no próprio repo.** A
  config saiu da raiz para `.claude-plugin/mcp.json`, apontada pelo campo
  `mcpServers` do plugin.json: um `.mcp.json` na raiz o Claude Code carrega
  também como servidor de projeto, contexto em que `${CLAUDE_PLUGIN_ROOT}` não
  expande e o servidor morre com ENOENT.
- `editar` e `contato-editar` recusam custom field `FILE_UPLOAD`: a API forja o
  metadado do anexo a partir da URL sem baixar nada, gravando um anexo que não
  existe.
- `--set` aceita valor JSON (`{...}` / `[...]`), exigido por `TEXTBOX_LIST` —
  string crua respondia 200 e gravava `{}` em silêncio (`819d00b`).
- `serverInfo.version` do MCP sai do plugin.json em vez de fixo em `0.1.0`.

## 0.2.0 — 2026-09-18 (`a303277`)

- Oitava tool: **`editar`**, que escreve campos e tags de um contato pela API
  interna, grava snapshot antes e devolve `dispara` (workflows cujo trigger
  reage à mudança).
- Campo padrão só limpa com `null`; resolvedor de nome aceita camelCase e filtra
  `model: contact` (`00cf466`).

## 0.1.0 — 2026-09-18 (`af3573e`)

- Casca do plugin: manifesto, config MCP, shim de Python ≥ 3.12, hook de
  SessionStart, comandos `/automaster-extract` e `/automaster-audit`, skill
  `automaster-leitura`.
- Sete tools MCP de leitura sobre dumps offline: `dumps`, `inventario`,
  `workflow`, `achados`, `buscar`, `jornada`, `contato`.
