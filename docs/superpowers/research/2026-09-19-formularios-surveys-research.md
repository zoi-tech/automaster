# Pesquisa — formulários e surveys (leitura, submissões, auditoria)

Spec: `docs/superpowers/specs/2026-09-19-formularios-surveys-leitura-design.md`

Todos os achados de API foram medidos ao vivo na Instaltech (`Xb9gDxwxYhdqtprGcb5E`)
com os tokens da sessão, em 2026-09-19, por um probe descartável já apagado.

## Achados de API

### A1 — As quatro rotas existem e respondem com os tokens da sessão
- Fonte: probe ao vivo. `GET backend.leadconnectorhq.com/forms/?locationId=&limit=&skip=`,
  `/surveys/?…`, `/forms/submissions?locationId=&limit=&page=`, `/surveys/submissions?…`.
  O host `services` responde idêntico; o header `version` tanto faz (`2021-07-28` e `v3`
  devolvem o mesmo 200).
- Contradiz a spec: não. Confirma que não é preciso PIT nem OAuth.
- Registro: a doc pública v3 descreve as mesmas quatro rotas
  (`~/Documents/ghl-docs/ghl/forms`, `ghl/surveys`), mas devolvendo `id`/`name` só; a
  interna devolve o documento inteiro com `_id`.

### A2 — Existe detalhe, e é onde vivem os campos do formulário
- Fonte: `GET /forms/<id>` → `{form:{…, formData:{form:{…campos…}, parentFolderId,
  parentFolderName}}}`; `GET /surveys/<id>?locationId=` → `{survey:{…}}`. Sem `/fields`
  (404).
- Contradiz a spec: não, confirma a operação `detalhe`.
- Consequência: o survey traz CSS embutido (`fieldCSS` com `@import` de Google Fonts) —
  a personalização visual que a segunda spec vai mexer já está visível aqui.

### A3 — O limite por página é 50 e o servidor recusa mais
- Fonte: `limit=200` → `422 limit must not be greater than 50`. `skip` funciona.
  Instaltech: 10 formulários, 29 surveys.
- Contradiz a spec: parcial. A spec não falava de paginação na extração.
- Pergunta: a extração precisa varrer todas as páginas, senão a subconta com mais de 50
  surveys ganha achado falso de "formulário não existe" — exatamente o falso positivo que
  o projeto já pagou três vezes.

### A4 — Pasta não polui a lista de formulários, mas o filtro `type=folder` mente
- Fonte: `/surveys/?type=folder` devolve 6 pastas (`type: "folder"`), e a lista sem filtro
  devolve 29 itens, nenhum com `type`. Já `/forms/?type=folder` devolve os mesmos 10
  formulários normais — o parâmetro é ignorado.
- Contradiz a spec: não, mas fecha um risco: a lista padrão já é só formulário e survey de
  verdade, então a regra não vai acusar pasta.

### A5 — Há uma referência quebrada real esperando na Instaltech
- Fonte: o trigger "Formulário Enviado" cita `form.id = bblZYCoXk6rf3xl7ehyO`;
  `GET /forms/bblZYCoXk6rf3xl7ehyO` → `404 Form not found!`. Os outros 3 `form.id` e os
  10 `survey.id` dos triggers existem.
- Contradiz a spec: não. É a prova de que a regra encontra algo real no primeiro dia.

### A6 — O formulário do Facebook usa um id que não existe na lista
- Fonte: as 50 submissões de formulário da Instaltech têm todas
  `formId: "fb-Xb9gDxwxYhdqtprGcb5E"` — pseudo-id do lead gen do Facebook, ausente da
  lista de formulários.
- Contradiz a spec: parcial.
- Pergunta: a regra de órfãos e a de referência quebrada precisam ignorar id que começa
  com `fb-`, senão toda subconta com lead de Facebook ganha um erro que não é erro. E o
  filtro `formId` da tool de submissões tem de aceitar esse valor.

### A7 — O calendário aponta para formulário, e na Instaltech aponta certo
- Fonte: 2 calendários com `formId: YXq1IfzcSStJYrY2ffeH`, que existe. 14 calendários com
  `formId` no conjunto dos dumps.
- Contradiz a spec: não, confirma o segundo braço da regra ERROR.

### A8 — Filtrar submissão por formulário com zero envio devolve total 0, sem erro
- Fonte: `/forms/submissions?formId=<id sem envio>` → `{submissions:[], meta:{total:0}}`.
  Paginação vem em `meta` (`total`, `currentPage`, `nextPage`, `prevPage`).
- Contradiz a spec: não.
- Registro: id inexistente não dá 404 aqui — a tool não pode concluir "formulário não
  existe" a partir de submissão vazia.

## Fila do grill

1. A3 — varrer todas as páginas na extração, ou aceitar teto de 50 e arriscar falso
   positivo em subconta grande? (trava A5, A6)
2. A6 — como tratar o pseudo-formulário do Facebook nas duas regras e no filtro
   de submissões?
3. A2 — o dump guarda só a lista (id, nome) ou o detalhe inteiro de cada formulário,
   com campos e CSS? O detalhe é uma chamada por formulário e é o que a segunda spec vai
   precisar.

## Achados internos (repo)

### A9 — O molde de cada peça já existe, arquivo por arquivo
- Fonte: leitura ao vivo em `extractor/src/api/opportunities.ts:1-9,52-66`; runner de CLI em
  `extractor/src/cli.ts:859-899` e registro em `:1532-1565`; script npm em
  `extractor/package.json:27-31`; entidade opcional no extract em `extractor/src/cli.ts:136-149`;
  carga opcional em `auditor/src/automaster_audit/loader.py:176-203` (`_load_templates`);
  regra em `rules/broken_template_ref.py:32-53`; regra INFO em `rules/workflow_unreachable.py:12-40`;
  fixture em `auditor/tests/conftest.py:31-54`; tool ao vivo em
  `auditor/src/automaster_audit/mcp_server.py:549-569` e registro em `:879-891`.
- Contradiz a spec: não. Nada precisa ser inventado.

### A10 — A regra não pode usar o helper de steps
- Fonte: `rules/_helpers.py:9-15` (`steps_of_type`) varre steps; a referência de formulário
  está em trigger (`loader.py:51-53`) e no `formId` do calendário (`loader.py:161`).
- Contradiz a spec: parcial. Falta um `triggers_of_type` ao lado do de steps, ou o loop
  escrito na própria regra.
- Pergunta: helper novo compartilhado, ou loop local? Só uma regra precisa dele hoje.

### A11 — O union de nomes de arquivo do dump rejeita nomes novos
- Fonte: `extractor/src/dump/writer.ts:61-67`. Sem acrescentar `"forms" | "surveys"` o
  `tsc --noEmit` falha, e ele é critério de aceite.
- Contradiz a spec: não, é item de implementação esquecido.

### A12 — Testes que contam achados quebram se a regra falar em dump sintético
- Fonte: `auditor/tests/test_loader_and_report.py:25-34` e `tests/test_mcp_tools.py:141-150`
  esperam exatamente 3 ERROR. `test_validation.py` e `test_dashboard.py` também contam
  severidade.
- Contradiz a spec: não, reforça: sem lista no dump, regra muda. Nenhum teste conta o número
  de tools nem o de regras.

### A13 — Seis textos ficam mentindo depois desta feature
- Fonte: `CLAUDE.md:18` ("8 entidades"), `CLAUDE.md:30` ("vinte e quatro tools"),
  `.claude-plugin/plugin.json:3` (diz 23 tools, já errado hoje),
  `skills/automaster-leitura/SKILL.md:3`, `loader.py:5-13`, `CHANGELOG.md`.
- Contradiz a spec: parcial — a spec não lista atualização de documentação nos critérios.
- Registro: o `plugin.json` já está desatualizado antes desta feature.

### A14 — Nada sobre formulário existe hoje no repo
- Fonte: `docs/endpoints.md` vai até Agenda (`:484`); as duas ocorrências de "form" são a
  opção "None - Free form message" (`docs/endpoints.md:661`, `CHANGELOG.md:19`).
- Contradiz a spec: não.

## Fila do grill (atualizada)

1. A3 — varrer todas as páginas na extração (teto de 50 por chamada), ou aceitar o teto e
   arriscar falso positivo em subconta grande? (trava A5, A6)
2. A6 — como tratar o pseudo-formulário do Facebook (`fb-<locationId>`) nas duas regras e no
   filtro de submissões?
3. A2 — o dump guarda só a lista, ou o detalhe inteiro de cada formulário (campos e CSS)?
4. A10 — helper `triggers_of_type` compartilhado, ou loop dentro da regra?
5. A13 — atualizar os seis textos entra nos critérios de aceite desta feature?
