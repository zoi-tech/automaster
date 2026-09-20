# Changelog — plugin `automaster`

Versões do `.claude-plugin/plugin.json`. Toda mudança que afete o que o plugin
instalado faz sobe a versão aqui; o time atualiza com
`claude plugin marketplace update zoi && claude plugin install automaster@zoi`.

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
- Despublicar e inscrever foram exercitados ao vivo na Instaltech; quatro comportamentos
  (retomar inscrição pausada, despublicar com gente congelando de verdade, remover contato
  parado no meio, e efeito sobre inscrição dupla) ficaram sem prova — nenhum workflow
  descartável tinha passo de espera. Detalhe em
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
