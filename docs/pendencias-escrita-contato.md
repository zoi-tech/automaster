# Pendências — escrita de contato (`contato-editar` / tool `editar`)

Estado em 2026-09-18, depois da validação ao vivo na Instaltech
(`Xb9gDxwxYhdqtprGcb5E`). O que funciona está em `docs/endpoints.md` seção
`## Escrita`. Aqui fica só o que ainda não foi feito ou confirmado.

## Validado ao vivo

PUT de custom field `TEXT`, POST de tag, DELETE de tag, e `set` + `tagsDel` na
mesma execução. O PUT é **merge**, não replace. Nenhum header de escopo de
subconta foi necessário.

## Não validado — cada um é uma escrita que pode falhar em silêncio

- **Campo padrão.** `firstName`, `lastName`, `phone`, `email`, `companyName` e os
  outros 10 do mapa `STANDARD_FIELD_BODY_KEY` (`extractor/src/cli.ts`) nunca
  foram escritos de verdade. O mapa vem da leitura do bundle JS do app e das
  chaves do GET; o diff antes/depois avisa se não pegar, mas ninguém testou.
- **Custom field que não seja TEXT.** `SINGLE_OPTIONS`, `RADIO`, `NUMERICAL`,
  `DATE`, `CHECKBOX`. Todo valor de `--set` vai como string; o GHL pode aceitar,
  coagir ou gravar lixo.
- **`contact.source`.** Removido do mapa de propósito: `source` é a única chave
  que não aparece nas chaves de topo do GET. `--set` nesse campo falha explícito
  hoje. Repor só depois de confirmar ao vivo.
- **A tool `editar` pelo Claude Code.** Só a CLI foi exercitada. O servidor MCP
  `automaster` não conectava na sessão da validação (ENOENT em
  `bin/automaster-python.sh`), então o caminho tool → subprocess → CLI, o gate de
  permissão e o `dispara` na resposta seguem sem prova de ponta a ponta.

## Limites conhecidos do desenho

- **Não existe desfazer.** O snapshot em
  `~/.automaster/dumps/_contatos/<loc>/<contactId>/` permite reconstruir à mão;
  não há comando que reverta. Decisão da spec.
- **O mapa de campo padrão é fechado nos 15 `contact.*` da Instaltech.** Outra
  subconta com campo padrão diferente faz `--set` falhar com erro explícito — de
  propósito, escrita perdida em silêncio é pior. Mas exige manutenção do mapa.
- **`--set` não converte tipo.** Ver acima.
- **Dump sem o campo `model`** esvazia a lista de resolução e todo `--set` vira
  "campo não existe". Falha barulhenta, mas confusa.

## Resíduos da validação

- A tag **`teste-automaster`** (id `b6exN50lRXSodrTXKDE0`) foi criada na
  Instaltech e continua lá. Nenhum workflow a referencia. O contato dummy usado
  (`uWqujqll20tRuglV3mLt`) foi restaurado ao estado original.
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
  normaliza (telefone em E.164, data em ISO). É falso positivo esperado.
