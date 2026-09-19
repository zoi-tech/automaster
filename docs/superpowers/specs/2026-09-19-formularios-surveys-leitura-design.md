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

As rotas ainda são hipótese. Confirmação pelo método já usado duas vezes no projeto:
chamar rota candidata com os tokens da sessão e ler o 422, que devolve enum e campo
obrigatório. Alternativas se falhar: `npm run discover`, bundle público do app com UA
de Chrome.

Comando de CLI novo, leitura apenas:

```
npm run formularios -- -l <loc> -o lista|detalhe|submissoes|buscar --json
```

com `--tipo formulario|survey` para escolher a entidade e `--id` no detalhe.

### Dump

`extract` passa a gravar dois arquivos opcionais na pasta do snapshot:

- `forms.json` — `{fetchedAt, raw:<resposta da API>}`
- `surveys.json` — idem

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
- `pytest -q` verde em `auditor/`, `npx tsc --noEmit` limpo em `extractor/`.
- Plugin sobe de versão no `plugin.json` e entra no `CHANGELOG.md`.
