# Pesquisa — escrita e personalização visual de formulários e surveys

Spec: `docs/superpowers/specs/2026-09-19-formularios-surveys-escrita-design.md`

Nenhuma chamada de escrita foi executada contra a API. Tudo veio de bundle público, do
documento público no Cloud Storage e de leitura do repo.

## Achados

### A1 — O `formData` vai inline no corpo do POST; não há upload para o Cloud Storage
- Fonte: bundle do builder `https://leadgen-apps-form-survey-builder.leadconnectorhq.com/assets/index.66e9e80a.js` — `updateFormById:(e,n)=>Cn(to).post(\`/forms/${e}\`,n)`, corpo `{name, formData:{form:{...}}}`
- Contradiz a spec: parcial
- Pergunta que levanta: a spec deixou em aberto se publicar um formulário exigiria subir
  arquivo e referenciar uma versão. Não exige: o documento inteiro vai no corpo de um
  POST, e o servidor grava a versão sozinho e devolve o histórico. Isso simplifica o
  ciclo de publicação e elimina um passo de risco.

### A2 — O host da escrita é `services.leadconnectorhq.com`, não `backend.`
- Fonte: bundle, `FORM_SERVER_URL:"https://services.leadconnectorhq.com"`,
  `SURVEY_SERVER_URL` idem. A leitura atual usa `backend.` (`extractor/src/api/forms.ts:8`)
- Contradiz a spec: parcial
- Pergunta que levanta: o projeto passa a falar com dois hosts para a mesma entidade.
  Vale mudar também a leitura para o host novo, ou conviver com os dois?

### A3 — A escrita manda só `token-id`, sem `authorization: Bearer`
- Fonte: bundle, interceptor `r.headers["token-id"]=i.tokenId`, mais headers fixos
  `{channel:"APP", source:"WEB_USER", version:"2021-07-28"}`
- Contradiz a spec: não
- Pergunta que levanta: os headers fixos `channel`/`source`/`version` não existem no
  cliente atual. Sem eles a chamada pode ser recusada; é a primeira coisa a testar.

### A4 — Rotas de escrita, todas por POST (não PUT/PATCH)
- Fonte: bundle. `POST /forms/` e `POST /surveys/` com `{locationId, parentId?, productType, source:"landing_page"}` para criar; `POST /forms/<id>` e `POST /surveys/<id>` com `{name, formData}` para atualizar; `DELETE /forms/<id>` e `DELETE /surveys/<id>` para apagar; `POST /forms/duplicate/<id>`; `POST /forms/restore-version {formId, versionId}`
- Contradiz a spec: não
- Pergunta que levanta: existe `restore-version` pronto no servidor. A spec tinha
  descartado restaurar versão deste ciclo; agora restaurar custa quase nada.

### A5 — O estilo do formulário é derivado: `fieldCSS` é gerado a partir de `fieldStyle`
- Fonte: documento real do formulário "Form 8" da Instaltech, baixado sem auth de
  `storage.googleapis.com`. No save o builder faz
  `fieldCSS: No(ne,isGDPRCompliant)+Cr(i.fieldStyle, i.builderConfig.inputStyleType)`
- Contradiz a spec: sim
- Pergunta que levanta: a spec falava em "o bloco de estilo" como se houvesse um só. São
  quatro camadas com papéis diferentes: `fieldStyle` é a fonte de verdade dos campos
  (cor, borda, fonte, espaçamento), `fieldCSS`/`mobileFieldCSS` é CSS gerado a partir
  dela, `style` é o container e `customStyle` é CSS livre do usuário. Escrever CSS
  direto em `fieldCSS` funciona até alguém abrir o builder, que regenera o campo a
  partir do `fieldStyle` e apaga o trabalho. A decisão que muda o resultado: o
  `impeccable` produz tokens que viram `fieldStyle` (sobrevive ao builder, mas limitado
  ao que o GHL modela), ou CSS livre em `customStyle` (liberdade total, risco menor de
  ser sobrescrito que o `fieldCSS`), ou os dois.

### A6 — Cor no `fieldStyle` é hex de 8 dígitos sem `#`
- Fonte: documento real, `bgColor: "2c3345FF"`
- Contradiz a spec: não
- Pergunta que levanta: a tradução de tokens para o formato do GHL tem conversão própria
  de cor; é ponto de teste unitário.

### A7 — Campo custom carrega o custom field inteiro embutido, e o vínculo é o id
- Fonte: documento real, `form.fields[]`: campo custom traz
  `{id, tag:<mesmo id>, fieldKey:"contact.segmento", dataType, model:"contact", picklistOptions[], name, standard:false, label, required, type, fieldWidthPercentage}`
- Contradiz a spec: não
- Pergunta que levanta: adicionar um campo de contato ao formulário exige resolver o
  custom field na subconta e copiar seus dados para dentro do documento. Se o custom
  field mudar depois, a cópia no formulário envelhece. Existe candidato a regra de
  auditoria aí, mas está fora do recorte.

### A8 — A lista de campos mistura campo e elemento visual
- Fonte: documento real — a mesma lista `form.fields[]` tem `tag:"button"`,
  `tag:"header"` (HTML dentro de `label`) e `tag:"terms_and_conditions"`
- Contradiz a spec: parcial
- Pergunta que levanta: "remover campo" precisa saber que botão e cabeçalho estão na
  mesma lista. Remover o botão por engano deixa o formulário sem como enviar.

### A9 — Survey guarda os campos noutro lugar: `formData.slides[].slideData[]`
- Fonte: bundle + estrutura do documento
- Contradiz a spec: parcial
- Pergunta que levanta: a spec tratava formulário e survey como o mesmo ciclo. O ciclo
  de publicação é o mesmo, mas o motor de operações precisa de dois caminhos para achar
  e mexer nos campos. Survey tem slides; formulário, não.

### A10 — A API pública do GHL não escreve formulário; só lê
- Fonte: catálogo oficial v3 (5 rotas: `GET /forms`, `GET /forms/submissions`,
  `POST /forms/upload-custom-files`, `GET /surveys`, `GET /surveys/submissions`).
  https://marketplace.gohighlevel.com/docs/ghl/forms/forms-api/
- Contradiz a spec: não
- Pergunta que levanta: confirma que a API interna é o único caminho, e que esta feature
  não tem rede de segurança pública. Nenhum projeto público mapeou forms na API interna;
  o único precedente é de workflows (github.com/drleadflow/ghl-automation-builder).

### A11 — O formulário só é estilizável por dentro: CSS do site host não entra
- Fonte: doc oficial de Custom CSS,
  https://help.gohighlevel.com/support/solutions/articles/155000006727-how-to-add-custom-css-to-forms-surveys-and-quizzes-
- Contradiz a spec: não
- Pergunta que levanta: reforça que o estilo tem que ir no documento do formulário.
  A mesma doc diz que o CSS persiste "a menos que você modifique o form pelo builder de
  novo" — redação ambígua, e é exatamente o risco do A5. Precisa de prova ao vivo.

### A12 — URL pública do formulário confirmada, e existe preview de versão específica
- Fonte: bundle + GET de teste (200, 91 KB).
  `https://link.msgsndr.com/widget/form/<id>`, `/widget/survey/<id>`, `/widget/quiz/<id>`.
  `?notrack=true` não registra visualização; `?versionId=<id>&notrack=true&nocache=true`
  abre uma versão específica
- Contradiz a spec: não
- Pergunta que levanta: o screenshot de aprovação sai daí, e o `notrack` evita sujar a
  estatística do cliente. O domínio whitelabel da conta devolveu 404; use `link.msgsndr.com`.

### A13 — O "dry-run" que a spec descreve não existe em nenhum comando do projeto
- Fonte: `extractor/src/cli.ts:964`, `:1062`, `:672`, `:1139` — sem `--confirmo` é erro
  seco, não prévia
- Contradiz a spec: sim
- Pergunta que levanta: a spec inventou um comportamento novo ("imprime o que mudaria e
  para"). Ou vira padrão do projeto, ou o formulário segue a regra de todo mundo.

### A14 — Já existe `registroEscrita`, mas metade dos comandos a ignora
- Fonte: `extractor/src/cli.ts:531-537`; duplicações à mão em `:416-422` (contato),
  `:1279-1283` (anexo), `:1325-1328` (envio)
- Contradiz a spec: não
- Pergunta que levanta: o snapshot do formulário usa a função que já existe. O padrão de
  duas fases (grava `aplicado:false`, chama, reescreve com `aplicado:true` ou com o erro)
  está em `:1005-1031` e é o que preserva rastro quando o servidor recusa.

### A15 — O prefixo `snapshot:` no stderr é contrato com o MCP
- Fonte: `extractor/src/cli.ts:422`, `:833`; `auditor/src/automaster_audit/mcp_server.py:220-234`
  preserva essas linhas ao truncar erro
- Contradiz a spec: não
- Pergunta que levanta: o comando novo tem que imprimir `snapshot: <path>` nesse formato,
  ou o caminho do snapshot se perde no stack trace quando algo dá errado. A dica de
  conferência do timeout (`:261-262`) está hard-coded para `contato-editar` e precisa de
  um ramo para formulário.

### A16 — Não existe motor de patch declarativo no repo
- Fonte: o mais próximo é `--set chave=valor` do contato
  (`extractor/src/cli.ts:397`, `:351-370`) e a substituição de lista inteira do pipeline
  (`:1692`, com `estagiosQueSomem()` em `:1035+` avisando a consequência antes)
- Contradiz a spec: não
- Pergunta que levanta: o motor de operações é código novo. O precedente mais útil é o
  do pipeline: documento inteiro republicado, com uma guarda que conta o que some e
  recusa sem flag explícita.

### A17 — Existem temas e cores padrão de subconta prontos no servidor
- Fonte: bundle — `GET /forms/themes?locationId=`, `GET /forms/theme-style/<themeId>`,
  `GET/POST/DELETE /forms/default-colors`
- Contradiz a spec: parcial
- Pergunta que levanta: o GHL já tem tema e paleta por subconta. A identidade gerada pelo
  `impeccable` pode virar a paleta padrão da subconta, valendo para todo formulário novo,
  em vez de ficar presa a um formulário.

### A18 — Trigger "Form Submitted" sem filtro dispara para todo formulário da subconta
- Fonte: https://hlgrowthpartner.com/post/gohighlevel-forms-surveys-setup-guide-2026
- Contradiz a spec: não
- Pergunta que levanta: criar um formulário descartável na Instaltech pode acordar
  workflows que ninguém lembrava estarem sem filtro. O dump já tem os triggers: dá para
  conferir antes de criar, e o formulário de teste não deve receber submissão.

### A19 — Sem fonte pública sobre três riscos
- Fonte: ausência de resultado nas buscas
- Contradiz a spec: não
- Pergunta que levanta: ninguém documentou se editar pelo builder preserva o CSS
  customizado, se há limite de tamanho para ele, e o que acontece com a submissão
  histórica quando um campo é removido ou renomeado. Os três só se resolvem em
  formulário descartável.

## Fila do grill

Ordenada por dependência.

1. A5 — o `impeccable` escreve tokens de `fieldStyle`, CSS livre em `customStyle`, ou os
   dois? (trava A6, A11, A17, A19)
2. A9 — survey tem slides e formulário não: um motor com dois caminhos, ou dois motores?
   (trava A8, A16)
3. A13 — prévia sem `--confirmo` vira padrão novo do projeto, ou o formulário segue a
   regra seca de todo mundo?
4. A2 — mudar a leitura para `services.` também, ou conviver com dois hosts?
5. A17 — a identidade do cliente vira paleta padrão da subconta, ou fica por formulário?
6. A4 — `restore-version` está de graça no servidor; entra neste ciclo?
7. A8 — como a remoção de campo protege o botão de envio e o cabeçalho?
