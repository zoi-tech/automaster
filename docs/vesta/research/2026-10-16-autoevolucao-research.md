# Pesquisa — autoevolução do plugin

Spec: `docs/vesta/specs/2026-10-16-autoevolucao-design.md`

## Achados

### A1 — O fim da sessão não é confiável para trabalho pesado
- Fonte: https://code.claude.com/docs/en/hooks#sessionend, https://code.claude.com/docs/en/hooks#timeouts, https://github.com/herdrdev/herdr/issues/4851
- O `SessionEnd` tem 1,5 s para todos os hooks juntos; o `timeout` de hook de plugin não aumenta isso. Hook estourado é morto. Fechar o terminal pode matar o Claude Code antes de o `SessionEnd` rodar.
- Contradiz a spec: parcial (a spec já pede processo destacado, mas assume que o hook roda sempre)
- Pergunta que levanta: sessão fechada pelo X do terminal nunca seria revisada. Vale fazer a revisão no começo da próxima sessão, olhando as conversas anteriores que ainda não foram revisadas, em vez de (ou além de) no fim?

### A2 — `claude -p` dentro do hook dispara os hooks do plugin de novo
- Fonte: https://code.claude.com/docs/en/settings-reference#disableallhooks, https://code.claude.com/docs/en/headless#start-faster-with-bare-mode
- Sem cuidado vira laço: a chamada filha roda o `SessionStart`/`SessionEnd` do plugin. `--settings '{"disableAllHooks": true}'` corta, e funciona com a assinatura; `--bare` exige chave de API.
- Contradiz a spec: parcial (a spec não trata recursão)
- Pergunta que levanta: nenhuma de decisão; entra no plano como `disableAllHooks` + `--no-session-persistence` + variável de trava própria.

### A3 — Com `ANTHROPIC_API_KEY` no ambiente, a revisão cobra na API
- Fonte: https://code.claude.com/docs/en/authentication#authentication-precedence
- No `-p`, a chave sempre vence o login da assinatura.
- Contradiz a spec: parcial
- Pergunta que levanta: a revisão deve tirar a chave do ambiente da chamada filha, para usar sempre a assinatura de quem está logado?

### A4 — O erro de tool não carrega código
- Fonte: `auditor/src/automaster_audit/mcp/base.py:35-36`, `:174-180`; `extractor/src/saida.ts:34-38`; `mcp/tags.py:108-115`
- `ToolError` é só texto. O código do extractor (`login_pendente`, `sessao_indisponivel`, `http_NNN`, `erro`) aparece dentro da frase. As guardas do Python (`apagar_citada`, "repita com confirmo=true") são texto livre, 131 `raise ToolError` no total, a maioria validação de argumento.
- Contradiz a spec: sim (a spec assume `codigo` e uma lista de códigos esperados)
- Pergunta que levanta: para separar "erro de verdade" de "guarda funcionando", ou o registro lê a frase, ou o `ToolError` ganha um código e as guardas passam a marcá-lo. O primeiro é rápido e frágil; o segundo mexe em muitos arquivos.

### A5 — Erro inesperado derruba o servidor e não seria registrado
- Fonte: `auditor/src/automaster_audit/mcp_server.py:123-127`, `:146-149`
- Só `ToolError` e `TypeError` são capturados. Um `KeyError` ou `OSError` de tool mata o servidor MCP inteiro, e todas as tools somem da sessão.
- Contradiz a spec: parcial (é justamente o tipo de erro que mais interessa relatar)
- Pergunta que levanta: capturar qualquer exceção ali, relatar como bug e devolver erro da tool em vez de derrubar o servidor?

### A6 — Recusas e prévias voltam como sucesso
- Fonte: `extractor/src/cli/dashboards.ts:249,392`; `mcp/workflows.py:313-320`
- `aplicado: false`, recusa das 18 regras e prévia sem `--confirmo` chegam como resposta normal. O registro automático não as vê, o que é certo: não são defeito.
- Contradiz a spec: não

### A7 — Alguns erros são engolidos antes de chegar ao servidor
- Fonte: `mcp/tags.py:31-34`; `mcp/workflows.py:227-229`, `:285-291`
- Falha ao carregar o dump em `tags` vira aviso; falha na validação de `workflow_editar` vira `sem_validacao` e grava mesmo assim.
- Contradiz a spec: parcial
- Pergunta que levanta: nenhuma de decisão; esses casos ficam para a revisão de conversa e para a tool `relatar`, sem mudar as tools agora.

### A8 — Os testes não isolam a pasta do usuário
- Fonte: `auditor/tests/conftest.py:146-160`; `auditor/tests/test_mcp_tools.py:247-279`
- Só `AUTOMASTER_DUMPS` é redirecionado. `test_rpc_roundtrip` provoca um erro de propósito; com o registro ligado, a suíte gravaria e tentaria publicar no `~/.automaster` real.
- Contradiz a spec: parcial
- Pergunta que levanta: nenhuma de decisão; o caminho vira variável (`AUTOMASTER_APRENDIZADOS`) e um fixture `autouse` aponta para pasta temporária e desliga a publicação.

### A9 — Um teste de versão já está vermelho antes desta feature
- Fonte: `auditor/tests/test_release_0_31_0.py:9,25-31` (rodado: `1 failed`)
- O teste fixa 0.31.0 e os manifestos estão em 0.31.1.
- Contradiz a spec: não
- Pergunta que levanta: nenhuma; conserta junto na etapa de versão. Os testes que exigem 36 tools (`test_mcp_paineis.py:71-75`, `test_release_0_31_0.py:53-57`) passam a 37.

### A10 — Label que não existe faz a issue não ser criada
- Fonte: https://github.com/cli/cli/blob/trunk/pkg/cmd/pr/shared/params.go; `gh label create --help` (2.83.1)
- `gh issue create --label auto-relato` falha inteira se o label não existir. `gh label create --force` resolve e pode rodar toda vez.
- Contradiz a spec: parcial
- Pergunta que levanta: nenhuma; entra no plano.

### A11 — Dado vazado em issue pública não sai editando
- Fonte: https://docs.github.com/en/communities/moderating-comments-and-conversations/tracking-changes-in-a-comment
- O histórico de edição fica visível. Editar o corpo depois não apaga o que foi publicado.
- Contradiz a spec: não (reforça o filtro antes de publicar)

### A12 — Regex de id pega coisa demais, e isso é aceitável
- Fonte: https://microsoft.github.io/presidio/faq/; inspeção: ids do GHL são 20 alfanuméricos sem prefixo
- O filtro vai mascarar hashes e tokens junto. Para issue pública, mascarar a mais é o erro barato. A assinatura no corpo precisa de formato que o filtro não toque (hex curto).
- Contradiz a spec: não

### A13 — O repositório público já tem ids reais de cliente
- Fonte: `docs/backlog-arquitetura.md:55`, `:86`; `docs/vesta/research/2026-10-09-sessao-de-fundo-research.md:228`
- Ids de subconta e de workflow de clientes estão em docs versionados.
- Contradiz a spec: não (fora do escopo)
- Pergunta que levanta: limpar isso é um trabalho à parte; quer que eu anote como pendência?

### A14 — Sessões paralelas gravam no mesmo lugar
- Fonte: `CLAUDE.md` (MCP serial por sessão, várias sessões ao mesmo tempo); sem lock no Python (`grep`)
- Cada sessão tem seu servidor MCP. Dois podem publicar o mesmo relato ao mesmo tempo e abrir duas issues.
- Contradiz a spec: parcial
- Pergunta que levanta: nenhuma de decisão; trava com `fcntl.flock` em volta da publicação.

### A15 — O começo da sessão aceita até 10 mil caracteres e não roda depois de compactar
- Fonte: https://code.claude.com/docs/en/hooks#sessionstart; `hooks/hooks.json` (matcher `startup|clear`)
- Depois de `/compact` ou ao retomar uma sessão, o hook não roda e as lições podem sumir do contexto.
- Contradiz a spec: parcial
- Pergunta que levanta: nenhuma; o matcher passa a incluir `resume` e `compact`.

### A16 — O transcript muda de formato entre versões e marca sessões headless
- Fonte: https://code.claude.com/docs/en/sessions#where-transcripts-are-stored; inspeção local
- Chamada de tool fica em `assistant.message.content[].type == "tool_use"` com `name`; resultado em `user` com `tool_result` e `is_error`. Cada linha tem `entrypoint` (`cli`, `sdk-cli`).
- Contradiz a spec: não
- Pergunta que levanta: nenhuma; o leitor tolera linha estranha e ignora sessão que não seja `cli`.

### A17 — Quem faz algo parecido pede confirmação humana
- Fonte: https://github.com/BayramAnnakov/claude-reflect; https://www.phoronix.com/news/AI-DoS-Attack-Maintainers
- O claude-reflect não grava nada sem a pessoa aprovar. Relato automático sem freio já virou spam em projeto aberto.
- Contradiz a spec: não (o usuário escolheu publicar sozinho; a trava diária e a deduplicação são o freio)

### Registro: reuso
- Versão do plugin: `mcp_server._version()` (`mcp_server.py:98-106`).
- Caminho do Python e do pacote no hook: o shim `bin/automaster-python.sh` já monta `PYTHONPATH`; o hook chama `-m automaster_audit.<módulo>`.
- Formato de fatia de tool: `mcp/tags.py:126-167`.
- `gh` logado nesta máquina (2.83.1, keyring).

## Fila do grill

Ordenada por dependência.

1. A1 — Revisão de conversa no fim da sessão, no começo da próxima, ou nos dois? (trava A3)
2. A4 — Código de erro lido da frase ou marcado nas guardas? (trava A5)
3. A5 — Capturar qualquer exceção, relatar como bug e manter o servidor de pé?
4. A3 — Tirar a chave de API do ambiente da revisão?
5. A13 — Anotar a limpeza dos ids já publicados como pendência à parte?
