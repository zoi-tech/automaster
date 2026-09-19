# Pendências — escrita de contato (`contato-editar` / tool `editar`)

Estado em 2026-09-18, depois da validação ao vivo na Instaltech
(`Xb9gDxwxYhdqtprGcb5E`). O que funciona está em `docs/endpoints.md` seção
`## Escrita`. Aqui fica só o que ainda não foi feito ou confirmado.

## Validado ao vivo

PUT de custom field `TEXT`, `SINGLE_OPTIONS`, `RADIO`, `NUMERICAL`, `CHECKBOX`,
`DATE`, `MONETORY`, `LARGE_TEXT` e `TEXTBOX_LIST`; PUT dos 15 campos padrão do
mapa `STANDARD_FIELD_BODY_KEY`; POST de tag; DELETE de tag; `set` + `tagsDel` na
mesma execução. O PUT é **merge**, não replace. Nenhum header de escopo de subconta foi
necessário.

A tool MCP `editar` foi exercitada de dentro do Claude Code em 2026-09-18: o
caminho tool → subprocess → CLI, o snapshot, os `avisos` e o `dispara` (dois
workflows, entre eles um com trigger "Contato Alterado") vieram como a spec
previa. O servidor `automaster` declarado no `.mcp.json` do repo falhava com ENOENT
(`${CLAUDE_PLUGIN_ROOT}` não expande quando o Claude Code carrega o arquivo como
servidor **de projeto**); corrigido movendo a config para
`.claude-plugin/mcp.json`, apontada pelo campo `mcpServers` do plugin.json —
plugin 0.2.1.

Detalhes que a validação produziu estão em `docs/endpoints.md` seção
`## Escrita`: a normalização por tipo, a regra de limpar campo e o falso positivo
do aviso em telefone.

## Não validado — cada um é uma escrita que pode falhar em silêncio

- **`FORMULA`.** Está no enum de `dataType` mas o POST de criação o rejeita;
  sem campo, não há o que escrever. Único tipo da lista sem prova ao vivo.
  (`EMAIL` não é um tipo válido de custom field — a pendência antiga partia de
  premissa errada.)
- ~~`FILE_UPLOAD` sem guarda~~ — fechado: `buildFieldsBody` recusa o tipo com
  erro explícito, mandando subir o arquivo pela interface do GHL.

## Limites conhecidos do desenho

- **Não existe desfazer.** O snapshot em
  `~/.automaster/dumps/_contatos/<loc>/<contactId>/` permite reconstruir à mão;
  não há comando que reverta. Decisão da spec.
- **O mapa de campo padrão é fechado nos 15 `contact.*` da Instaltech.** Outra
  subconta com campo padrão diferente faz `--set` falhar com erro explícito — de
  propósito, escrita perdida em silêncio é pior. Mas exige manutenção do mapa.
- **`--set` não converte tipo.** O GHL coage; ver `docs/endpoints.md`.
- **Campo padrão só limpa com `null`.** String vazia vira 200 sem efeito. A CLI
  traduz `--set campo=` para `null`, mas isso é uma asimetria da API, não do
  desenho.
- **Dump sem o campo `model`** esvazia a lista de resolução e todo `--set` vira
  "campo não existe". Falha barulhenta, mas confusa.

## Resíduos da validação

- A tag **`teste-automaster`** (id `b6exN50lRXSodrTXKDE0`) foi criada na
  Instaltech e continua lá. Nenhum workflow a referencia. Apagar tag da subconta
  não é coberto por nenhum comando — a tool só tira a tag do contato. O contato
  dummy usado (`uWqujqll20tRuglV3mLt`) foi restaurado ao estado original depois
  de cada rodada de validação. Uma sobra da 3ª rodada: o custom field
  `Redes sociais da empresa` (`rsCP4WVkGKWB732oAEIg`) do contato dummy ficou em
  `{}` em vez de ausente — `TEXTBOX_LIST` não tem como voltar a "nunca escrito".
- **~38 scripts `.ts` soltos e não versionados em `extractor/`** (`restore.ts`,
  `cv.ts`, `patch.ts`, …). Vários escrevem em produção e estão fora de qualquer
  revisão. A spec do plugin prevê apagá-los; os headers de escrita que eles
  provavam já foram absorvidos por `docs/endpoints.md`.
- Branch `docs/mapa-plugin-claude-code`, já inteira no `master`.

## Minors — fechados nesta rodada

Comentário do `loc` em `contacts.ts`, guarda de `_run_extractor` sem argumentos,
filtro de `OPTIONS` no `discover`, comentário do `tokens` em `withClient`, e o
`serverInfo.version` do MCP lido do plugin.json em vez de fixo em `0.1.0`.

`dispara` colapsar dois triggers homônimos do mesmo workflow fica como está: a
saída responde "quais workflows reagem", e nesse recorte o colapso é o
comportamento certo. `_head_tail` descartar linhas repetidas da cauda idem — só
muda a leitura do texto de erro.

## Minors adiados (nenhum bloqueia uso)

- Aviso de "escrita possivelmente ignorada" dispara em valor que o GHL
  normaliza (telefone em E.164, data em ISO). É falso positivo esperado,
  confirmado ao vivo com `contact.phone`.
- O resolvedor de nome de campo aceita id, nome, `fieldKey` e agora também a
  forma camelCase (`companyName`). Nome de campo padrão que não esteja no dump
  com `model: contact` segue falhando — é o caso dos campos de `opportunity`
  homônimos.
