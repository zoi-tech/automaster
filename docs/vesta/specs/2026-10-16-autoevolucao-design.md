# Autoevolução do plugin automaster — design

Data: 2026-10-16. Classificação: estrutural.

## Intenção

O plugin automaster percebe os próprios problemas durante o uso, aprende com eles na hora,
na máquina onde aconteceram, e abre issue no repositório `zoi-tech/automaster` sozinho, para
o conserto definitivo chegar a todos numa atualização.

Quem usa: o Luccas e a equipe da ZOI, cada um com o plugin instalado (a cópia instalada é
sobrescrita a cada atualização, e a equipe não tem o repositório clonado).

Sucesso: um problema que aparece numa sessão (1) já muda o comportamento da próxima sessão
naquela máquina e (2) vira uma issue única no GitHub, sem dado de cliente, com contador de
ocorrências quando se repete.

### O que o usuário disse

- Pegar os quatro tipos: erro de tool, correção do usuário, dificuldade do Claude, pedido
  sem tool.
- "Se modificar" = lição local que vale na hora + issue; o conserto definitivo vira PR.
- A issue sai sem perguntar, com dado limpo.
- Detecção pelas duas portas (na hora e no fim da sessão), com cuidado contra duplicação.

### O que foi suposto

- O repositório é público (conferido: `visibility: PUBLIC`), então toda issue é pública.
- As máquinas da equipe têm `claude` no PATH (usam Claude Code) e podem não ter `gh`
  logado.

## Arquitetura

Um lugar só, fora do plugin, sobrevive às atualizações: `~/.automaster/aprendizados/`.

- `licoes.json` — lições ativas desta máquina.
- `fila.jsonl` — relatos que ainda não viraram issue (sem `gh`, falha de rede, trava diária).
- `publicadas.json` — assinatura → número da issue, e o contador diário da trava.

Três portas alimentam esse lugar, e as três passam pelo mesmo módulo do auditor,
`auditor/src/automaster_audit/aprendizado.py`:

1. **Erro automático.** `mcp_server.handle` já é o ponto único por onde todo `ToolError` e
   `TypeError` de tool passa. Ali, depois de montar a resposta de erro, chama
   `aprendizado.registrar_erro(tool, erro)`. Falha no registro nunca muda a resposta da tool.
2. **Tool `relatar`.** Tool MCP nova, no módulo `mcp/aprendizado.py`. O Claude a chama quando
   o usuário corrige o que o automaster fez, quando ele próprio empaca (tenta de novo,
   contorna, a skill não cobria o caso) ou quando pedem algo que nenhuma tool faz. A skill
   `automaster-leitura` ganha a seção que manda chamar e diz quando.
3. **Revisão no fim da sessão.** Hook `SessionEnd` do plugin. Só age se a conversa chamou
   alguma tool `mcp__plugin_automaster_automaster__*`. Roda destacado do processo (para não
   ser morto com a sessão), extrai da conversa os trechos relevantes e chama
   `claude -p --model haiku` pedindo os pontos, já genéricos, junto da lista das issues
   automáticas abertas para o modelo marcar repetição. Cada ponto entra pelo mesmo módulo.

As lições entram no começo de cada sessão pelo hook `SessionStart` que o plugin já tem
(`hooks/scripts/check-setup.sh`): ele imprime as lições ativas, e o que o hook imprime vira
contexto da sessão.

## O relato

Campos: `tipo` (`erro_tool` | `correcao` | `dificuldade` | `pedido_sem_tool`), `tool`
(opcional), `codigo` (código de erro, quando houver), `resumo` (uma frase genérica),
`detalhe` (o que aconteceu, genérico), `sugestao` (conserto proposto), `licao` (uma linha
imperativa, opcional), `duplicata_de` (número de issue, opcional), `nova` (bool, opcional).

Erro esperado não vira relato: `login_pendente`, `sessao_indisponivel` e recusa de guarda
(prévia sem `--confirmo`, `diverge` no painel, `apagar_citada` e as demais guardas que já
devolvem código próprio). A lista desses códigos fica numa constante do módulo. `TypeError`
(argumento errado) vira `dificuldade`, porque costuma indicar descrição de tool confusa.

## A issue

Título `[auto] <tipo>: <resumo>`. Labels `auto-relato` e o tipo. Corpo: tool, código, versão
do plugin, o que aconteceu, sugestão, lição proposta, linha `Ocorrências: N · última:
AAAA-MM-DD · versões: x, y` e a assinatura num comentário HTML
(`<!-- automaster-assinatura: <hash> -->`).

Nunca sai: id de subconta, contato, workflow ou qualquer id do GHL, nome de pessoa, telefone,
e-mail, URL com id, trecho de conversa. Quem escreve já escreve genérico (a descrição da
tool `relatar` e o prompt do hook pedem isso), e o filtro `limpar(texto)` passa por cima
substituindo o que tiver forma desses dados por marcadores (`<id>`, `<email>`, `<telefone>`,
`<url>`). Relato que, depois do filtro, fica sem `resumo` é descartado.

## Duplicação

- `erro_tool`: assinatura = hash de `tipo + tool + codigo`. Igual a uma já publicada e
  aberta: atualiza a contagem da issue existente.
- Texto livre: assinatura = hash de `tipo + tool + resumo normalizado`. Antes de abrir, o
  módulo lista as issues abertas com `auto-relato` e mede a parecença do título com o resumo.
  Na tool `relatar`, havendo parecida e sem `duplicata_de`/`nova`, a tool não publica e
  devolve as candidatas para o Claude chamar de novo com `duplicata_de=<n>` ou `nova=true`.
  No hook, o modelo já recebe as abertas e devolve `duplicata_de` ou `nova`.
- Repetição não comenta: edita o corpo da issue existente (contador, data, versões).
- Trava: no máximo 5 issues novas por dia por máquina; o excedente espera na fila.
- O hook do fim não relata o que a sessão já relatou pela tool ou pelo erro automático
  (o módulo guarda as assinaturas da sessão corrente em `fila.jsonl`/`publicadas.json`).

## Publicação

Pelo `gh` (`gh issue create`, `gh issue edit`, `gh issue list --label auto-relato`). Sem `gh`,
sem login ou com falha: o relato fica em `fila.jsonl` e a fila é drenada na próxima
publicação bem-sucedida e no hook do fim. Nada disso bloqueia nem atrasa a tool que errou:
o registro automático só grava na fila; quem publica é a tool `relatar` e o hook do fim.

## Vida da lição

Lição = uma linha imperativa + número da issue + versão do plugin em que nasceu. O
`SessionStart` imprime as ativas, até 15 linhas, as mais recentes primeiro.

Aposentadoria, no hook do fim (o de início só lê arquivo): issue fechada como resolvida
(`stateReason: COMPLETED`) e versão instalada do plugin maior que a versão em que a lição
nasceu. Fechada como `NOT_PLANNED`: a lição fica.

## Testes

pytest, sem rede, com `gh` e `claude` falsos:

- `limpar` tira id do GHL, e-mail, telefone e URL com id.
- assinatura estável para o mesmo erro e diferente para tool diferente.
- erro esperado não vira relato; `TypeError` vira `dificuldade`.
- sem `gh`, o relato vai para a fila e sai na próxima publicação.
- trava diária segura a sexta issue.
- repetição edita a issue existente em vez de abrir outra.
- `relatar` com issue parecida devolve candidatas e não publica.
- aposentadoria: só com `COMPLETED` e versão nova.
- `mcp_server.handle` registra o erro e a resposta da tool não muda, mesmo com o registro
  falhando.
- hook do fim: conversa sem tool automaster não chama o modelo; com tool, chama e publica.
- `SessionStart` imprime as lições ativas.

Mudança de comportamento do plugin: sobe as três versões, entra no `CHANGELOG.md`, a contagem
de tools vai para 37 no `CLAUDE.md`, na descrição da skill `automaster-leitura` e onde mais
a lista aparecer.

## Fora de escopo

Abrir PR sozinho. Ler conversa de sessão que não usou o automaster. Relatar problema de outro
plugin ou do Claude Code.
