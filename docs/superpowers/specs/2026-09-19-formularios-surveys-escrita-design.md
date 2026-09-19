# Escrita e personalização visual de formulários e surveys — design

Data: 2026-09-19. Ciclo seguinte ao da leitura (plugin 0.11.0).

## Objetivo

Criar e editar formulários e surveys da subconta GHL pelo automaster, incluindo a
identidade visual de cada um — formulário sob medida por cliente, esteticamente
resolvido, não só funcional.

## Estado de partida

A leitura está no ar: módulo `extractor/src/api/forms.ts`, comando `npm run formularios`,
tool MCP `formularios`, `forms.json`/`surveys.json` no dump, regras `broken_form_ref` e
`unused_form`. Rotas de leitura em `docs/endpoints.md`, seção `## Formulários e surveys`.

Fato descoberto no brainstorming: a lista de formulários **não** traz o `formData`. O
documento vive num arquivo do Google Cloud Storage apontado por
`versionHistory[].formDataDownloadUrl`, com `versionId` e `version` incremental — o mesmo
arranjo dos steps de workflow. Editar um campo é, muito provavelmente, publicar uma
versão nova do documento inteiro, não um PATCH de campo. A pesquisa confirma.

## Recorte

Dentro: criar formulário e survey, editar estrutura (campos) e editar o visual, nos dois.

Fora: pastas de survey, migração entre subcontas, regra de auditoria nova sobre
formulário. Apagar formulário/survey entra, porque o teste ao vivo cria e apaga o objeto
descartável (`DELETE /forms/<id>`).

## Arquitetura

Abordagem escolhida: **documento inteiro, editado por patch declarativo**.

O automaster baixa o `formData` da versão atual, aplica uma lista de operações declaradas
(`adicionar campo`, `remover campo`, `renomear`, `reordenar`, `definir estilo`), valida o
documento resultante e republica o documento completo. A CLI e a tool MCP falam em
operações; nunca pedem JSON cru ao usuário. Campo que o automaster não modela sobrevive
intacto, porque o ponto de partida é sempre o documento real do servidor.

Descartadas: um schema próprio compilado para `formData` (perde tudo que não modela na
hora de republicar um formulário existente) e o cano cru que recebe `formData` pronto
(sem guarda contra documento inválido, e empurra o trabalho da feature para o usuário).

### Formulário e survey: um motor, dois documentos

O ciclo de publicação é o mesmo nos dois. O que muda é onde os campos moram: o formulário
tem uma lista plana em `formData.form.fields`; o survey tem uma sequência de slides em
`formData.slides[]`, cada um com `id`, `slideName`, `button` próprio e a sua lista de
campos em `slideData[]`.

As operações de campo (`adicionar`, `remover`, `renomear`, `reordenar`) são escritas uma
vez e valem nos dois; uma camada fina responde "onde mora a lista de campos deste
documento". O usuário não informa o tipo: o automaster descobre pelo id.

**Slide é entidade de primeira classe, sem exceção.** O survey ganha um conjunto próprio
de operações: criar slide, remover, renomear, reordenar, mover campo entre slides, e
montar a sequência inteira de uma vez ao criar um survey do zero. Sem limite de
quantidade. Toda operação de campo num survey diz em qual slide age. Em formulário, as
operações de slide recusam com erro claro.

Entram no mesmo recorte, porque sem elas o survey fica pela metade: a navegação
(`form.footerStyle` — texto e cor de "Anterior", "Próximo" e "Enviar", posição dos
botões), a barra de progresso (`form.isProgressBarEnabled`), o botão de voltar
(`form.isBackButtonEnable`) e a lógica condicional entre slides. O formato exato da lógica
condicional não apareceu no documento examinado, que não usa nenhuma; mapeá-lo é tarefa da
implementação, e é a única peça do survey cujo formato ainda não está em mãos.

O estilo do survey segue as mesmas regras do formulário, mais o rodapé de navegação e o
botão de cada slide, que entram nos tokens do `impeccable`. Survey bonito nos campos e cru
na navegação não conta como pronto.

### Guardas do motor de operações

A lista de campos não tem só campos: o botão de enviar (`tag:"button"`), os blocos de
texto (`tag:"header"`) e o aceite de termos moram nela. Duas travas, no espírito da guarda
de estágio do pipeline (`extractor/src/cli.ts:1035+`):

- Remover exige nomear o alvo, nunca a posição.
- Remover o botão de enviar, ou deixar o documento sem nenhum campo, é recusado sem uma
  flag explícita. Formulário sem botão continua no ar recebendo visita e não gera lead.

Adicionar um campo de contato resolve o custom field na subconta e copia os dados dele
para dentro do documento — `id`, `fieldKey`, `dataType`, `picklistOptions`, `model` —,
porque é assim que o GHL guarda. Custom field inexistente é erro antes de qualquer
escrita.

### Host e autenticação

Leitura e escrita passam a falar com `https://services.leadconnectorhq.com`. Hoje a
leitura usa `https://backend.leadconnectorhq.com` (`extractor/src/api/forms.ts:8`); ela
migra neste ciclo, para o projeto ter um canal só nesta área.

A migração é verificada antes de valer: as seis rotas de leitura já validadas rodam contra
o host novo e a resposta é comparada com a do host antigo. Divergência em qualquer uma
cancela a unificação e a leitura fica onde está — a extração roda em onze subcontas e não
se quebra por arrumação.

A escrita manda só o header `token-id`, sem `authorization: Bearer`, mais os headers fixos
`channel: APP`, `source: WEB_USER` e `version: 2021-07-28`, que o cliente atual não envia.

### Superfície

- `extractor/src/api/forms-write.ts` — módulo novo ao lado do `forms.ts` de leitura, que
  não muda.
- CLI: `npm run formulario-acao` (criar, editar estrutura, publicar) e
  `npm run formulario-estilo` (aplicar tokens visuais).
- MCP: tools `formulario_acao` e `formulario_estilo`, chegando a 27.
- Versão do plugin: 0.12.0, com entrada no `CHANGELOG.md`.

### Ciclo de edição

1. Baixa a versão atual do `formData`.
2. Aplica as operações declaradas.
3. Valida o documento resultante.
4. Grava o documento antigo em `<dumps>/_formularios/<loc>/<formId>/<ts>.json`.
5. Publica, exigindo `--confirmo` / `confirmo=true`.

Sem `--confirmo`, o comando monta o documento novo, compara com o atual e imprime a
diferença — campo que entra, campo que sai, estilo alterado — sem tocar no servidor.

Essa prévia é padrão novo: hoje todo comando de escrita do projeto dá erro seco sem
confirmação (`extractor/src/cli.ts:964`, `:1062`, `:672`). Aqui ela se justifica porque a
publicação substitui o documento inteiro, e sem ver a diferença antes não há como saber
que só o pedido mudou. Vale só para formulário e survey; os outros comandos não mudam.

### Histórico e restauração

O GHL guarda todas as versões de cada formulário, e a restauração é uma rota pronta
(`POST /forms/restore-version {formId, versionId}`, idem para survey). Entra no ciclo:
listar as versões (com data e autor, que o `versionHistory` já traz) e restaurar uma.

Vale também para estrago que o automaster não causou — o cliente mexendo na interface
também gera versão. Restaurar é escrita: exige `--confirmo`, e o estado atual vai para o
snapshot antes.

Uma versão pode ser inspecionada antes de restaurar, sem publicar nada: o documento dela
baixa direto do Cloud Storage sem autenticação, e a página pública aceita
`?versionId=<id>&notrack=true&nocache=true`.

## Personalização visual

Uma skill nova e enxuta do plugin, `automaster-formulario-visual`, conduz a estética.
Ela conhece o que o painel de estilo do GHL aceita e o que precisa ir como CSS livre, e
chama o `impeccable` só na etapa de decidir a estética — não no processo inteiro, que é
caro e produziria coisas que o GHL não consegue aplicar. Entra a marca do cliente, sai um
conjunto de tokens — cor, tipografia, escala de espaçamento, radius, estados de foco e de erro. O
`impeccable` não produz o `formData`; a geração de design fica separada da mecânica de
publicação.

O documento do formulário tem três lugares de estilo com papéis diferentes, e o automaster
escreve em dois deles:

- `form.fieldStyle` — o painel de estilo do builder, fonte de verdade do visual dos campos.
  Recebe tudo que couber nos tokens. Sobrevive a edição do cliente na interface. Cores em
  hex de 8 dígitos sem `#` (`"2c3345FF"`).
- `form.customStyle` — CSS livre. Recebe o que o painel não modela.
- `form.fieldCSS` / `form.mobileFieldCSS` — **o automaster nunca escreve aqui.** É CSS
  gerado pelo builder a partir do `fieldStyle`; qualquer coisa escrita ali é apagada assim
  que alguém abre o formulário na interface.

O container (`form.style`) e a mensagem de envio (`form.submitMessageStyle`) seguem o
mesmo conjunto de tokens.

Piso não negociável, porque formulário é a porta de entrada do lead: contraste WCAG AA,
alvo de toque mínimo, foco visível de teclado, estado de erro legível sem depender de cor.

### Paleta e temas da subconta

Antes de gerar identidade nova, o automaster lê o que a subconta já tem: a paleta padrão
(`GET /forms/default-colors?locationId=`) e os temas disponíveis (`GET /forms/themes`,
`GET /forms/theme-style/<themeId>`). Se o cliente já tem cor definida, ela é o ponto de
partida do `impeccable`, não algo a ser descoberto do zero — e o resultado sai coerente
com o que o cliente já usa nos outros formulários.

Gravar a paleta padrão da subconta (`POST /forms/default-colors`) é um comando à parte,
nunca efeito colateral de estilizar um formulário. Quando você pede, todo formulário
criado dali em diante nasce com a cara do cliente, inclusive os que ele montar sozinho na
interface. A paleta anterior vai para o snapshot antes de ser substituída.

### Antes de criar o formulário de teste

Um gatilho "Formulário Enviado" sem filtro dispara para qualquer formulário da subconta.
O dump já tem os triggers: antes de criar o objeto descartável, o comando confere e avisa
quais workflows reagiriam. O formulário de teste não recebe submissão, e o screenshot usa
`?notrack=true`, que não registra visita.

### Aprovação visual

Publica num formulário descartável da subconta de validação, abre a URL pública real pelo
Playwright e tira screenshot. Itera ali. Aprovado, o mesmo conjunto de tokens é aplicado
no formulário de produção. Não há render local: a fidelidade do render próprio ao do GHL
não é verificável, e a página pública é.

## Verificação

- Toda operação validada ao vivo num formulário e num survey criados e apagados na hora,
  na Instaltech (`Xb9gDxwxYhdqtprGcb5E`), sem resíduo na subconta.
- Testes no auditor para o motor de operações e para a tradução de tokens em CSS:
  `.venv/bin/python -m pytest -q`.
- `npx tsc --noEmit` no extractor.
- A subconta `WPIUKW3L4lDyMhLhKYKG` devolve 401 e não serve de cobaia.

## Resolvido pela pesquisa

Dossiê: `docs/superpowers/research/2026-09-19-formularios-surveys-escrita-research.md`.

Rotas de escrita, transmissão do `formData` inline no corpo, os três lugares de estilo, a
estrutura de campo e de slide, a URL pública e a rota de apagar: tudo mapeado e registrado
no dossiê. Vai para `docs/endpoints.md` na implementação.

Segue sem formato conhecido: a lógica condicional entre slides do survey.

## Decisões do grill

- **A5** — o automaster escreve em `fieldStyle` (painel do builder, sobrevive a edição do
  cliente) e em `customStyle` (CSS livre), nunca em `fieldCSS`, que o builder regenera e
  apagaria o trabalho.
- **A9** — motor único, com uma camada que localiza a lista de campos nos dois formatos.
  Slide virou entidade de primeira classe: conjunto próprio de operações, navegação,
  progresso e lógica condicional dentro do recorte. Sem isso o survey ficaria pela metade.
- **A13** — a prévia sem `--confirmo` entra, contra o padrão atual do projeto. Motivo: a
  publicação substitui o documento inteiro, e sem ver a diferença não há como saber que só
  o pedido mudou. Vale só nesta área.
- **A2** — a leitura migra para `services.` junto com a escrita, com comparação de
  resposta antes de valer. Divergência cancela a migração.
- **A17** — a paleta padrão da subconta é lida antes de gerar identidade, e gravá-la é um
  comando à parte, nunca efeito colateral.
- **A4** — `restore-version` entra: listar versões e restaurar, com `--confirmo`.
- **A8** — remover exige nomear o alvo; remover o botão de envio ou esvaziar o documento é
  recusado sem flag explícita.
- **A18** — o comando confere os gatilhos sem filtro antes de criar o formulário de teste,
  e o screenshot usa `?notrack=true`.
- **A1, A3, A6, A7, A10, A11, A12, A14, A15, A16, A19** — incorporados ao texto sem
  disputa: host e headers, formato de cor, cópia do custom field, ausência de API pública
  de escrita, limitação de iframe, URL pública, `registroEscrita`, o prefixo `snapshot:` no
  stderr, e os três riscos sem fonte pública, que o teste ao vivo resolve.

## Ficou em aberto para a implementação

1. O formato da lógica condicional entre slides do survey.
2. Se o POST de atualização aceita corpo parcial. O app sempre manda o documento inteiro;
   presuma substituição total até provar o contrário.
3. Se o `DELETE` é apagamento de verdade ou marcação — a lista tem campo `deleted`.
4. Se o CSS livre sobrevive a uma edição pelo builder, e se há limite de tamanho.
5. O que acontece com a submissão histórica quando um campo é removido ou renomeado.

Os três últimos não têm fonte pública e só se resolvem no formulário descartável.

Técnica disponível: baixar o bundle público do app
(`appcdn.leadconnectorhq.com/crm/<app>/<build>/static/js/*.js`) com `curl -A` de browser.
Foi assim que saíram os mapas de conversas e de oportunidades.
