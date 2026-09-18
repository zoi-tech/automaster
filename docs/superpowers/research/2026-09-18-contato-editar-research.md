# Pesquisa — contato_editar

Spec: `docs/superpowers/specs/2026-09-18-contato-editar-design.md`

## Achados

### A1 — A spec do plugin, do mesmo dia, coloca "escrita no GHL pelo plugin" fora de escopo por decisão explícita
- Fonte: `docs/superpowers/specs/2026-09-18-automaster-plugin-design.md:164-165`
- Contradiz a spec: sim
- Pergunta que levanta: ficam duas specs do mesmo dia se contradizendo; a nova precisa revogar a linha antiga no próprio doc, ou quem ler o design do plugin vai achar que escrita é proibida.

### A2 — Pasta `contatos/` dentro de `<loc>/` quebra a resolução de "dump mais recente" do extractor
- Fonte: `extractor/src/cli.ts:104,127,145` (`readdirSync(base).sort().at(-1)`, sem exigir `manifest.json`); o auditor filtra por manifest e não é afetado (`mcp_server.py:48-49`)
- Contradiz a spec: sim
- Pergunta que levanta: "contatos" ordena depois de qualquer timestamp, então viraria sempre "o dump mais recente" e o `timeline` de hoje pararia de resolver nomes de workflow. Snapshot vai para fora de `<loc>/`, ou as três funções passam a exigir `manifest.json`?

### A3 — Nenhum endpoint interno de contato está mapeado, nem no repo nem publicamente
- Fonte: `docs/endpoints.md:23-113`; grep nos scripts soltos de `extractor/` (zero chamadas a rota de contato); busca GitHub/web 2026-09-18 só acha reverse engineering de workflows
- Contradiz a spec: não (confirma a etapa zero)
- Pergunta que levanta: a etapa zero é obrigatória e não tem atalho. A doc já registra um endpoint de leitura (agendamentos) que recusou os tokens internos (`docs/endpoints.md:110-113`); sem plano B, se o PUT de contato recusar, o trabalho para.

### A4 — Na API pública, `tags` no PUT do contato sobrescreve a lista inteira; tag granular é POST/DELETE `/contacts/{id}/tags` com `{"tags": [...]}`
- Fonte: https://marketplace.gohighlevel.com/docs/2021-07-28/ghl/contacts/update-contact/ ; https://marketplace.gohighlevel.com/docs/ghl/contacts/add-tags/
- Contradiz a spec: parcial
- Pergunta que levanta: se a interna espelhar, `--tag +x` feito via PUT apaga as outras tags do contato. Na descoberta, gravar separadamente o request de adicionar tag e o de remover, e preferir o endpoint granular.

### A5 — Formato de custom field no público é `{id, key, fieldValue}`; semântica de merge por campo não é documentada
- Fonte: https://marketplace.gohighlevel.com/docs/2021-07-28/ghl/contacts/update-contact/
- Contradiz a spec: não
- Pergunta que levanta: nada garante que campos omitidos sejam preservados. O snapshot já cobre o risco; o GET pós-escrita da spec vira a verificação de que nada além do pedido mudou.

### A6 — Editar campo, custom field ou tag dispara os triggers "Contact Changed" e "Contact Tag" de workflows publicados
- Fonte: https://help.gohighlevel.com/support/solutions/articles/155000002477-workflow-trigger-contact-changed ; …/155000002482-workflow-trigger-contact-tag
- Contradiz a spec: parcial
- Pergunta que levanta: a tool pode acender automações em cascata no cliente. O Claude já tem o dump: antes de escrever, dá para listar os workflows cujo trigger reage ao campo/tag pedido e mostrar isso no resultado (ou no aviso da descrição da tool).

### A7 — Prior art confirma que a API interna quebra sem aviso: em 2026-07 endpoints de workflow passaram a exigir Bearer e rejeitar `token-id`
- Fonte: https://github.com/gojc31/gohighlevel-cli (seção "Auth for the internal API"); https://github.com/drleadflow/ghl-automation-builder
- Contradiz a spec: não
- Pergunta que levanta: o erro de 401/403 persistente precisa dizer "endpoint pode ter mudado, rode discover", não só "token expirou".

### A8 — Dump de `custom_fields` já mistura campo padrão e custom field na mesma lista (`dataType: STANDARD_FIELD`)
- Fonte: `docs/endpoints.md:69-74`; `extractor/src/dump/writer.ts:61-66`
- Contradiz a spec: parcial
- Pergunta que levanta: a spec separa "campo padrão" de "custom field" em dois caminhos; uma lista só resolve tudo. Falta saber, na descoberta, se o payload do PUT trata os dois igual.

### A9 — Já existem três `*FromLatestDump` no extractor, todas com falha silenciosa; a spec exige erro duro para nome inexistente
- Fonte: `extractor/src/cli.ts:100-155`
- Contradiz a spec: parcial
- Pergunta que levanta: uma função genérica `latestDumpEntity(loc, nome)` cobre as quatro; a de contato precisa lançar em vez de engolir, e a mensagem precisa dizer "rode extract" quando não há dump.

### A10 — `_run_timeline` já faz tudo que o subprocess novo precisa; só o `cmd` muda
- Fonte: `auditor/src/automaster_audit/mcp_server.py:217-231`
- Contradiz a spec: não
- Pergunta que levanta: parametrizar (`_run_extractor(*args)`) em vez de copiar. Se parametrizar, passa a merecer um teste próprio, hoje inexistente.

### A11 — Padrão de teste da casa mocka a função wrapper (`_run_timeline`), não `subprocess`
- Fonte: `auditor/tests/test_mcp_tools.py:154-187`
- Contradiz a spec: parcial
- Pergunta que levanta: a spec diz "subprocess mockado"; seguir o padrão existente é mais barato.

### A12 — Exceção inesperada no `handle()` sobe crua; numa escrita, o usuário precisa saber se escreveu ou não
- Fonte: `auditor/src/automaster_audit/mcp_server.py:302`
- Contradiz a spec: parcial
- Pergunta que levanta: o comando imprime o resultado só no fim; se o processo morrer entre o PUT e o stdout, o Claude não sabe o estado. O snapshot em disco é a única trilha; o erro deve apontar para ele.

### A13 — Nomes de tool são um substantivo só; `contato_editar` seria o primeiro nome composto. A skill chama-se `automaster-leitura` e enumera as tools no `description`
- Fonte: `mcp_server.py:245-280`; `skills/automaster-leitura/SKILL.md:2-3,24`
- Contradiz a spec: parcial
- Pergunta que levanta: nome da tool, e se o aviso "ESCREVE em produção" vai na descrição da tool (lida sempre) ou numa skill separada de escrita (lida às vezes).

### A14 — A spec do plugin manda apagar os scripts soltos de `extractor/` que a spec nova usa como prova
- Fonte: `docs/superpowers/specs/2026-09-18-automaster-plugin-design.md:170-175`; os scripts não são versionados (`git ls-files extractor`)
- Contradiz a spec: parcial
- Pergunta que levanta: os headers exatos de escrita (`content-type`, `version`/`dataVersion` no PUT de workflow) só existem lá. Copiar para `docs/endpoints.md` na etapa zero, antes do apagamento previsto.

### A15 — `GhlClient` só tem GET; o laço de retry 401/429 vive dentro de `getJson`. O bloco sessão+tokens+client está copiado em `runExtract` e `runTimeline`
- Fonte: `extractor/src/api/client.ts:25-64`; `extractor/src/cli.ts:31-44,160-171,212-218`
- Contradiz a spec: não
- Pergunta que levanta: extrair `request(method,url,body)` e `withClient(loc, fn)` agora que são três usos, em vez de terceira cópia.

### A16 — Default de `DUMPS_DIR` difere entre extractor (`../dumps`) e auditor (`~/.automaster/dumps`); só coincide porque o MCP injeta a env
- Fonte: `extractor/src/cli.ts:27`; `mcp_server.py:38,225`
- Contradiz a spec: não
- Pergunta que levanta: rodar o comando na mão sem a env grava o snapshot em outro lugar. Registro; não trava.

## Fila do grill

Ordenada por dependência.

1. A3 — Sem plano B se a interna recusar o PUT de contato. Aceita cair na API pública com PIT nesse caso, ou para e reavalia? (trava tudo)
2. A1 — Revogar a linha "escrita fora de escopo" na spec do plugin? (trava A13, A14)
3. A2 — Snapshot fora de `<loc>/` ou exigir `manifest.json` nas três funções do extractor? (trava A9)
4. A4 + A8 — Descoberta grava tag granular separada do PUT; campo padrão e custom field via lista única? (trava o desenho do comando)
5. A6 — Listar workflows que o pedido vai disparar antes de escrever?
6. A13 — Nome da tool e onde vai o aviso de escrita.
7. A12 — Contrato de erro quando morre entre PUT e resposta.
8. A9, A10, A11, A15 — Reuso: função genérica de dump, `_run_extractor`, mock do wrapper, `withClient`.
9. A14 — Copiar headers de escrita para `docs/endpoints.md` antes de apagar os scripts.
