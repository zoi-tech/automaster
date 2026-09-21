# Notas e tarefas do contato + tags da subconta (0.20.0)

Data: 2026-09-21. Estado: spec aprovada em chat, pendente de pesquisa (fase 2) e grill (fase 3).

## Objetivo

Fechar o painel do contato (notas e tarefas, hoje invisíveis para o plugin) e dar à tag da
subconta um ciclo de vida próprio — criar, renomear, apagar — com prévia do impacto nos
workflows que a citam.

## Escopo

Dentro: leitura e escrita de nota do contato, tarefa do contato e tag da subconta.

Fora: funis/sites, campanhas de e-mail em massa, custom fields, custom values, trigger
links. Fora também: reescrever as referências de tag nos workflows durante o renomear
(existe `workflow-editar --acao trocar-tag`, e encadear os dois é candidato a 0.21.0).

## Estrutura

Dois módulos novos no extractor:

- `extractor/src/api/annotations.ts` — notas e tarefas, rotas irmãs do contato.
- `extractor/src/api/tags.ts` — CRUD de tag da subconta.

Quatro comandos de CLI (`anotacoes`, `anotacao-acao`, `tags`, `tag-acao`) e quatro tools
MCP de mesmo nome com underscore, indo de 31 para 35 tools.

Nota e tarefa **não entram no dump**. São dados por contato, mudam toda hora e não fazem
parte da auditoria de automação; entrariam ao custo de varrer todos os contatos da
subconta na extração, sem uso claro. Consequência: nenhuma mudança em `loader.py`, nenhum
incremento de `schemaVersion`, nenhuma regra de auditoria nova. Tag sem uso já não é
achado, por decisão anterior.

## Leitura

`anotacoes -l <loc> -i <contactId> --tipo nota|tarefa --json`

Uma tool para os dois, distinguidos por `--tipo`, como `formularios` faz com
`formulario|survey`. Tarefa devolve também prazo, dono e se está concluída.

`tags -l <loc> --json`

Lista as tags da subconta e, para cada uma, quantos workflows a citam e em que papel
(`dispara`/`adiciona`/`remove`/`condicao`), cruzando o índice reverso `dashboard._wf_refs`.
A tag é lida ao vivo e o índice vem do dump mais recente, então a resposta declara de qual
snapshot o cruzamento veio. Subconta sem dump: a lista sai sem a coluna de impacto, com
aviso.

## Escrita

Padrão obrigatório da casa: sem `--confirmo` é prévia, com `--confirmo` grava. A CLI crua é
a camada sem regras; a guarda mora na tool MCP.

`anotacao-acao --tipo nota|tarefa --acao criar|editar|apagar`

`tag-acao --acao criar|renomear|apagar`

Apagar tag citada por workflow exige uma segunda flag explícita (`--apagar-citada`), no
molde do `--apagar-com-cards` do pipeline. Renomear mostra na prévia a lista de workflows
afetados.

Cada escrita deixa rastro em `<dumps>/_anotacoes/<loc>/<contactId>/<ts>.json` e
`<dumps>/_tags/<loc>/<ts>.json`, como as áreas anteriores.

## A pergunta que a pesquisa tem que responder

**O step `add_contact_tag` guarda o nome da tag ou o id?**

Se guarda o id, renomear é seguro e a prévia é informativa.

Se guarda o nome, renomear pela subconta quebra em silêncio todo workflow que cita a tag, e
`renomear` deixa de ser uma escrita comum: passa a exigir flag explícita de consentimento
e a apontar `workflow-editar --acao trocar-tag` como o passo seguinte. O desenho final de
`renomear` depende dessa resposta.

Pontos quentes secundários para a fase 2:

1. Rotas reais de nota e tarefa do contato na API interna (`GET/POST/PUT/DELETE
   contacts/<id>/notes` e `.../tasks` são a hipótese, não o fato). Atenção: nota de
   *compromisso* já está mapeada (`/calendars/appointments/<id>/notes`) e é outra coisa.
2. Rotas de escrita de tag da subconta. A leitura existe e é no host `services`
   (`GET services.../locations/<loc>/tags/search`); POST/PUT/DELETE a confirmar, inclusive
   qual host e qual esquema de auth.
3. Se apagar tag da subconta remove a tag dos contatos que a têm, e se isso dispara
   automação de `TAG_REMOVED` em massa — o mesmo perigo já visto ao remover estágio de
   pipeline.
4. Se tarefa tem campo de dono obrigatório e o que o servidor faz sem ele.

## Validação

Subconta Instaltech (`Xb9gDxwxYhdqtprGcb5E`), contato de teste `uWqujqll20tRuglV3mLt`.
Tag descartável criada e apagada na hora; nenhuma das tags reais tocada. Escrita ao vivo é
serial — perfil Chrome único, dois comandos em paralelo travam no `SingletonLock`. Zero
resíduo ao fim.

## Entrega

`CHANGELOG.md`, `CLAUDE.md` e `.claude-plugin/plugin.json` em 0.20.0; rotas em
`docs/endpoints.md` antes de qualquer código.
