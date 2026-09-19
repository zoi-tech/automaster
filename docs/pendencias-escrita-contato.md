# Pendências — escrita de contato (`contato-editar` / tool `editar`)

Estado em 2026-09-18, depois da validação ao vivo na Instaltech
(`Xb9gDxwxYhdqtprGcb5E`). O que funciona está em `docs/endpoints.md` seção
`## Escrita`. Aqui fica só o que ainda não foi feito ou confirmado.

## Validado ao vivo

PUT de custom field `TEXT`, `SINGLE_OPTIONS`, `RADIO`, `NUMERICAL`, `CHECKBOX` e
`DATE`; PUT de campo padrão (`contact.company_name`, `contact.phone`,
`contact.source`); POST de tag; DELETE de tag; `set` + `tagsDel` na mesma
execução. O PUT é **merge**, não replace. Nenhum header de escopo de subconta foi
necessário.

A tool MCP `editar` foi exercitada de dentro do Claude Code em 2026-09-18: o
caminho tool → subprocess → CLI, o snapshot, os `avisos` e o `dispara` (dois
workflows, entre eles um com trigger "Contato Alterado") vieram como a spec
previa. O que não conectou foi o servidor `automaster` declarado no `.mcp.json`
do repo (ENOENT); as tools vieram pelo plugin instalado.

Detalhes que a validação produziu estão em `docs/endpoints.md` seção
`## Escrita`: a normalização por tipo, a regra de limpar campo e o falso positivo
do aviso em telefone.

## Não validado — cada um é uma escrita que pode falhar em silêncio

- **Custom field `MONETORY`, `TEXTBOX_LIST`, `EMAIL` e `PHONE`.** Todo valor de
  `--set` vai como string; o GHL pode aceitar, coagir ou gravar lixo.
- **Os 12 campos padrão restantes do mapa** (`firstName`, `email`, `address1`,
  …). Três dos 15 foram escritos; o resto vem da mesma leitura do bundle JS.

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
  de cada rodada de validação.
- **~38 scripts `.ts` soltos e não versionados em `extractor/`** (`restore.ts`,
  `cv.ts`, `patch.ts`, …). Vários escrevem em produção e estão fora de qualquer
  revisão. A spec do plugin prevê apagá-los; os headers de escrita que eles
  provavam já foram absorvidos por `docs/endpoints.md`.
- Branch `docs/mapa-plugin-claude-code`, já inteira no `master`.

## Minors adiados (nenhum bloqueia uso)

- `extractor/src/api/contacts.ts`: parâmetro `loc` não é usado por nenhuma das
  quatro funções — nenhuma rota de contato leva `locationId`. Falta um
  comentário dizendo isso.
- `auditor/src/automaster_audit/mcp_server.py`: `dispara` deduplica por
  (workflow, nome do workflow, nome do trigger), não pelo id do trigger; dois
  triggers homônimos no mesmo workflow colapsam.
- `_run_extractor` chamado sem argumentos levanta `IndexError` em vez de
  `ToolError`. Hoje inalcançável.
- `_head_tail` descarta do bloco da cauda linhas idênticas às guardadas; só
  afeta a leitura do texto do erro.
- `discover --area contatos` também loga requests `OPTIONS` (preflight).
- `withClient` recebe `tokens` no callback sem um comentário explicando por quê
  (`runExtract` precisa do `tokenId` para o `companyId`).
- Aviso de "escrita possivelmente ignorada" dispara em valor que o GHL
  normaliza (telefone em E.164, data em ISO). É falso positivo esperado,
  confirmado ao vivo com `contact.phone`.
- O resolvedor de nome de campo aceita id, nome, `fieldKey` e agora também a
  forma camelCase (`companyName`). Nome de campo padrão que não esteja no dump
  com `model: contact` segue falhando — é o caso dos campos de `opportunity`
  homônimos.
