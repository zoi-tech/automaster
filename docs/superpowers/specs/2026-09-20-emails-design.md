# E-mail no automaster: templates do builder, auditoria e leitura

Data: 2026-09-20
Estado: spec aprovada em chat, pendente de pesquisa (fase 2 do spec-flow)

## Problema

A regra `broken_template_ref` cobre WhatsApp e SMS e deixa e-mail de fora. A razão
registrada em `docs/endpoints.md` era que nenhum dos 13 `email.template_id` da Instaltech
casava com id do email builder, nem varrendo pastas, nem com `deleted=true`.

**A razão registrada estava olhando o campo errado.** Inspeção dos 13 steps de e-mail do
snapshot `Xb9gDxwxYhdqtprGcb5E/2026-09-19_1909`:

| `templateCreationMode` | quantos | `template_id` | id dentro de `previewUrl` |
|---|---|---|---|
| `existing` | 8 | prefixo comum `6aac33b0`, mesmo segundo de criação | ids distintos (`682c…`, `68dc…`) |
| `template-gallery` / ausente | 5 | — | **igual** ao `template_id` |

Os 8 `existing` carregam uma cópia interna do template: o `template_id` é dessa cópia, não
do original. O id do original está no `previewUrl`, que aponta para
`location/<loc>/emails/<id>/index.html` no Firebase Storage (URL pública, sem auth — o
mesmo padrão já usado pelos documentos de survey).

Portanto o cruzamento é possível: **pelo id embutido no `previewUrl`, não pelo
`template_id`.** Falta confirmar ao vivo que esses ids existem em `emails/builder`; é o
primeiro item da pesquisa.

## Escopo

Dentro: lista de templates do email builder no dump, duas regras de auditoria, uma tool MCP
de leitura.

Fora, por decisão: e-mail no `dashboard.html`; campanhas de e-mail e disparos em massa (coleção separada, nenhum step de
workflow as cita); qualquer escrita de e-mail (criar, editar, disparar — validar ao vivo
significa mandar e-mail real para a base de um cliente); HTML de todos os e-mails dentro do
dump (fica sob demanda); listagem ao vivo sem dump.

## Prova ao vivo, antes de tudo

A HighLevel documenta que o template escolhido dentro de um workflow vira uma cópia que
"não aparece na lista de templates". Isso permite uma leitura concorrente dos 5 steps que não
casam na Instaltech: seriam cópias ocultas, e as regras dariam 5 falsos positivos.

Primeira tarefa da implementação, antes de escrever regra nenhuma: criar um template no email
builder da Instaltech, usá-lo num step de um workflow descartável, apagar o template e
observar se o id some da lista e se o `previewUrl` continua respondendo.

Se confirmar que template apagado some da lista, as duas regras nascem. Se mostrar que a lista
esconde template vivo, só a extração e a tool de leitura ficam de pé, e a auditoria de e-mail
é registrada como impossível com a razão certa.

## Extração

Módulo novo `extractor/src/api/emails.ts`.

`GET backend/emails/builder?locationId=&limit=&offset=&parentId=` lista uma pasta por vez:
item com `templateType: "folder"` esconde os seus, que só aparecem com `parentId=<id>`. A
varredura é recursiva a partir da raiz. Na Instaltech a raiz tem 8 itens, 6 deles pastas, e
a varredura completa dá 43.

Saída: `email_templates.json` na pasta do dump, no formato das outras entidades
(`{fetchedAt, raw: {builders: [...]}}` — a mesma chave da resposta da API), com a lista
achatada e o `parentId` de cada item preservado. É
agregação de várias chamadas, como já acontece com `workflows` (4 fontes) — nenhum campo da
resposta é transformado ou limpo.

Entra em `extract` como entidade opcional: falha vira warning no manifest e a extração
segue, como `message_templates` e `forms`.

`schemaVersion` continua 1. Arquivo opcional novo é aditivo; o loader trata ausência, e
incrementar invalidaria os 12 dumps em disco.

## Auditoria

`loader._load_templates` ganha o canal `email`, a partir de `email_templates.json`,
descartando os itens com `templateType: "folder"`. Canal ausente do dump continua
significando no-op, não lista vazia.

Helper novo para resolver o id do e-mail de um step: decodifica o `previewUrl`
(percent-encoded) e casa `emails/<id>/index.html`. É a única fonte do id; `template_id` é
ignorado para e-mail.

Duas regras novas, um arquivo cada, descobertas pelo registry pkgutil:

`stale_email_template` — WARN. Step `email` cujo id resolvido não está na lista do builder.
Severidade WARN e não ERROR porque os steps `existing` carregam cópia própria do conteúdo: o
e-mail provavelmente continua enviando, e o que se perdeu foi a possibilidade de editar o
original pelo app. Se a pesquisa provar que o envio quebra, vira ERROR.

`unused_email_template` — INFO. Template do builder que nenhum step cita, espelhando
`unused_form`.

`broken_template_ref` não muda. E-mail fica fora dela de propósito: a severidade é outra, e
embutir duas severidades numa regra só esconde a distinção de quem lê o relatório.

Fixtures quebrada e limpa em `tests/`, via `conftest.make_dump`, que ganha o parâmetro
`email_templates`.

O relatório avisa quando a auditoria de e-mail está cega: `report._CEGAS` ganha entrada para
`email_templates.json`, senão um dump antigo passa a impressão de que não há nada a apontar.
Os dois testes de "Regras cegas" acompanham.

O `diff.md` passa a comparar template de e-mail, ao lado de mensagem e WhatsApp — sem isso
quem compara dois snapshots vê a lista inteira menos e-mail, sem saber que falta.

A afirmação errada sobre e-mail está em quatro lugares, não um: `docs/endpoints.md`, a
docstring de `broken_template_ref`, um comentário em `extractor/src/api/entities.ts` e o
`CLAUDE.md`. Os quatro são corrigidos.

## Tool MCP `modelos_email`

O nome evita colisão: `conversas(email=...)` devolve o corpo de um e-mail enviado a um
contato e `enviar(tipo="Email")` manda um; nenhum dos dois tem a ver com template de
automação.

Leitura, três operações:

`lista` — templates do dump, com nome, pasta e datas.

`usos` — quais workflows e steps citam cada template, pelo índice reverso, e quais não são
citados por ninguém.

`conteudo` — baixa o HTML e devolve o texto. A URL é remontada a partir do id do snapshot
corrente (`.../emails/<id>/index.html?alt=media`), sem o `token` do `previewUrl`: medido ao
vivo, o parâmetro é dispensável, e o token guardado num dump antigo deixa de valer assim que
alguém edita o e-mail, porque o Storage gera um token novo a cada sobrescrita.

A requisição sai do próprio servidor MCP, pela biblioteca padrão do Python. É a primeira vez
que o servidor vai à rede, e a exceção se justifica por ser URL pública sem credencial
nenhuma: passar pelo extractor custaria abrir o Chrome e disputar o perfil persistente para
buscar um arquivo que não pede token.

Nenhuma das três abre Chrome ou usa os tokens da sessão.

A tool importa o auditor como biblioteca, nunca lê o dump direto — como as outras 29.

## Riscos

O cruzamento pelo `previewUrl` ainda não foi confirmado contra `emails/builder` ao vivo. Se
os ids também não casarem, a regra `stale_email_template` não nasce e a conclusão passa a
ser que a auditoria de e-mail é impossível — resultado válido, a ser registrado em
`docs/endpoints.md` no lugar da explicação atual, que já se sabe errada.

Segundo risco: a URL pública do preview pode expirar ou exigir token em alguma subconta. Nesse
caso `conteudo` perde a operação e a tool fica com duas.

## Decisões do grill

- **Prova primeiro.** A HighLevel documenta que o template escolhido dentro de um workflow
  vira cópia oculta da lista, o que permitiria ler os 5 achados da Instaltech como falso
  positivo. A prova ao vivo com template descartável vem antes das regras. Motivo: o histórico
  do projeto é de regra ERROR nascida com falso positivo.
- **`conteudo` faz rede do próprio servidor MCP.** Motivo: a URL é pública e sem credencial;
  passar pelo extractor custaria Chrome e o perfil único para baixar um arquivo aberto.
- **A URL do conteúdo é remontada a partir do id, sem o `token`.** Motivo: medido 200 com
  `?alt=media` sozinho em duas subcontas, e o token do Storage troca a cada sobrescrita do
  arquivo, então guardá-lo envelhece o dump.
- **A lista fica sob `raw.builders`.** Motivo: é a chave da resposta da API, e o contrato do
  dump manda não transformar o `raw`.
- **O relatório avisa quando a lista de e-mail falta.** Motivo: silêncio em dump antigo vira
  conclusão errada de que não há achado.
- **`comparar` cobre template de e-mail nesta rodada.** Motivo: são duas linhas no lugar onde
  mensagem e WhatsApp já estão.
- **A tool se chama `modelos_email`.** Motivo: `emails` dividiria a palavra com
  `conversas(email=)` e `enviar(tipo="Email")`.
- **A correção da doc cobre os quatro lugares.** Motivo: a afirmação errada foi copiada para
  código e para o `CLAUDE.md`, não só para o `endpoints.md`.
- **Rotas v3 de template de e-mail ficam fora.** Motivo: respondem `404 Cannot GET` com os
  tokens da sessão — são de app do marketplace, e adotá-las significaria um segundo esquema de
  autenticação.
