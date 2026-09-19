# Formulários e surveys: leitura, submissões e auditoria

Data: 2026-09-19
Estado: aprovado em chat, pendente de pesquisa (rotas) e grill.

## Problema

Os triggers dos dumps citam 38 `form.id` e 13 `survey.id`, e 14 calendários citam
`formId`. Nenhuma dessas referências tem lista contra a qual ser cruzada: um
formulário apagado deixa o workflow mudo e a auditoria não percebe. Além disso não há
nenhuma forma de ler formulários nem submissões pela ferramenta — o operador precisa
abrir o app.

## Recorte

Esta spec cobre só leitura, submissões e auditoria. Criação, edição e personalização
visual de formulário ficam para uma segunda spec, que herda as rotas mapeadas aqui.

## Superfície

### Extractor

Módulo novo `extractor/src/api/forms.ts`:

- lista de formulários da subconta
- lista de surveys da subconta
- submissões, paginadas, com filtro por formulário e por período

As rotas foram confirmadas ao vivo na Instaltech em 2026-09-19 (dossiê de pesquisa, A1
a A8), com os tokens da sessão — nem PIT nem OAuth:

- `GET backend.leadconnectorhq.com/forms/?locationId=&limit=&skip=`
- `GET backend.leadconnectorhq.com/surveys/?locationId=&limit=&skip=`
- `GET backend.leadconnectorhq.com/forms/<id>` e `/surveys/<id>?locationId=` (detalhe,
  com os campos em `formData`)
- `GET backend.leadconnectorhq.com/forms/submissions?locationId=&limit=&page=&formId=&q=&startAt=&endAt=`
- `GET backend.leadconnectorhq.com/surveys/submissions?…&surveyId=`

O limite por página é 50 nas listas e o servidor recusa mais (`422 limit must not be
greater than 50`); as duas listas são varridas até o fim com `skip`, senão subconta com
mais de 50 surveys ganharia achado falso. Submissões paginam por `page` e trazem
`meta.total`/`nextPage`. Pastas não aparecem na lista padrão.

Comando de CLI novo, leitura apenas:

```
npm run formularios -- -l <loc> -o lista|detalhe|submissoes|buscar --json
```

com `--tipo formulario|survey` para escolher a entidade e `--id` no detalhe.

### Dump

`extract` passa a gravar dois arquivos opcionais na pasta do snapshot:

- `forms.json` — `{fetchedAt, raw:{forms:[...]}}`, a lista inteira já paginada
- `surveys.json` — idem

Só a lista: id, nome e datas. O detalhe de cada formulário (campos, CSS) fica na tool ao
vivo — guardá-lo custaria uma chamada por formulário e serve à spec de personalização,
não a esta.

`schemaVersion` segue **1**. O loader exige igualdade e incrementar invalidaria os 12
dumps em disco; arquivo opcional novo é aditivo, como users, calendars e os templates.
Falha na busca vira warning no manifest e a extração segue.

Submissões **nunca** entram no dump: são dado de contato, crescem sem limite,
envelhecem rápido e deixariam o `diff` barulhento.

### Loader

`DumpContext` ganha `form_ids`, `survey_ids` e o nome de cada um para as mensagens de
achado. Lista ausente (subconta sem formulário, dump anterior a esta versão) é lista
vazia, e toda regra que depende dela vira no-op.

### Regras

`broken_form_ref` (ERROR) — trigger `form_submission` ou `survey_submission` cujo
`conditions[].value` cita id fora da lista, e calendário cujo `formId` não existe mais.
Molde do `broken_template_ref`: sem lista, sem achado.

Id começado por `fb-` nunca vira achado, em nenhuma das duas regras: é o pseudo-formulário
do lead gen do Facebook, que não existe na lista e responderia por toda subconta que
anuncia no Facebook.

`unused_form` (INFO) — formulário ou survey que existe na subconta e que nenhum
trigger, calendário ou step referencia. A mensagem diz explicitamente que um
formulário embutido em site externo não aparece no dump, e por isso o achado é INFO e
não ERROR. Regra separada de propósito: o histórico do projeto tem três regras removidas
por falso positivo, e misturar as duas contaminaria a ERROR.

### MCP

Tool nova `formularios`, a 25ª. Lê **sempre ao vivo**, como `oportunidades` e `agenda`;
o dump serve só à auditoria. Operações:

- `lista` — formulários ou surveys da subconta
- `detalhe` — um, por id, com os campos
- `submissoes` — paginadas, por formulário e período
- `buscar` — por nome

Parâmetro `tipo` escolhe formulário ou survey.

## Fora de escopo

Criar, editar ou apagar formulário. Personalização visual. Mexer em `dashboard.html`,
`inventario` ou `journey.html` para exibir formulário. Regra sobre conteúdo de
submissão.

## Critérios de aceite

- `forms.json` e `surveys.json` presentes num snapshot novo da Instaltech.
- Dump antigo continua carregando, sem erro e sem achado novo.
- `broken_form_ref` verde nos dumps atuais, e vermelho numa fixture com id inventado.
- Tool `formularios` devolve as quatro operações ao vivo na Instaltech.
- `plugin.json`, `CLAUDE.md`, `skills/automaster-leitura/SKILL.md`, `loader.py` e
  `docs/endpoints.md` atualizados com a entidade, a tool e as rotas novas — o `plugin.json`
  já diz 23 tools e está errado desde antes desta feature.
- `pytest -q` verde em `auditor/`, `npx tsc --noEmit` limpo em `extractor/`.
- Plugin sobe de versão no `plugin.json` e entra no `CHANGELOG.md`.

## Decisões do grill

- **A3** — a extração pagina até o fim das duas listas. Motivo: o servidor corta em 50 e
  lista truncada viraria ERROR falso em subconta grande.
- **A6** — id `fb-<locationId>` é ignorado pelas duas regras e aceito no filtro de
  submissões. Motivo: é o formulário do Facebook, não existe na lista e todas as 50
  submissões da Instaltech vêm dele.
- **A2** — o dump guarda só a lista. Motivo: é o que a auditoria consome; o detalhe é uma
  chamada por formulário e pertence à spec de personalização visual.
- **A10** — o cruzamento roda em loop dentro da própria regra, sem helper novo. Motivo: o
  helper de steps não serve para trigger e só uma regra precisa disso hoje.
- **A13** — atualizar os textos desatualizados entrou nos critérios de aceite.
- **A5** — registrado: o trigger "Formulário Enviado" da Instaltech cita um formulário
  apagado (`bblZYCoXk6rf3xl7ehyO`, 404). É o primeiro achado real esperado da regra.
