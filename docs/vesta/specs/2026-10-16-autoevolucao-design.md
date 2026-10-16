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
- Detecção pelas duas portas (na hora e na revisão da conversa depois), com cuidado contra duplicação.

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
   `handle` passa também a capturar qualquer outra exceção da tool: hoje ela derruba o
   servidor e todas as tools somem da sessão (pesquisa A5). Agora vira erro só daquela
   chamada, o servidor segue de pé, e o relato sai como `falha` com o tipo da exceção e o
   `arquivo:linha` do último quadro dentro de `automaster_audit`, sem a mensagem nem os
   valores (podem conter dado de cliente).
2. **Tool `relatar`.** Tool MCP nova, no módulo `mcp/aprendizado.py`. O Claude a chama quando
   o usuário corrige o que o automaster fez, quando ele próprio empaca (tenta de novo,
   contorna, a skill não cobria o caso) ou quando pedem algo que nenhuma tool faz. A skill
   `automaster-leitura` ganha a seção que manda chamar e diz quando.
3. **Revisão das conversas anteriores.** No `SessionStart`, o hook dispara em segundo plano,
   destacado (`nohup`), a revisão e sai na hora. A revisão procura, em
   `~/.claude/projects/*/*.jsonl`, as conversas ainda não revisadas que chamaram alguma tool
   `mcp__plugin_automaster_automaster__*`, têm `entrypoint: cli` e estão paradas há mais de
   30 minutos (sessão encerrada; a atual e as paralelas vivas ficam para depois). No máximo
   3 por rodada, as mais recentes primeiro. De cada uma extrai os trechos relevantes e chama
   `claude -p --model haiku` pedindo os pontos, já genéricos, junto da lista das issues
   automáticas abertas para o modelo marcar repetição. Cada ponto entra pelo mesmo módulo.
   A chamada filha vai com `--settings '{"disableAllHooks": true}'`,
   `--no-session-persistence`, `--output-format json` e a variável `AUTOMASTER_REVISAO=1`,
   que faz os hooks do plugin saírem na hora (sem isso a chamada filha rodaria o próprio
   hook de início e entraria em laço, pesquisa A2). O ambiente segue como está: com
   `ANTHROPIC_API_KEY` presente, o Claude Code cobra na chave (decisão do usuário, A3).
   As revisadas ficam anotadas em `revisadas.json` (id da sessão + tamanho do arquivo; se o
   arquivo crescer, a conversa foi retomada e é revisada de novo só na parte nova).
   Motivo: o `SessionEnd` tem 1,5 s, é morto ao estourar e nem roda quando o terminal é
   fechado (pesquisa A1).

As lições entram no começo de cada sessão pelo hook `SessionStart` que o plugin já tem
(`hooks/scripts/check-setup.sh`): ele imprime as lições ativas, e o que o hook imprime vira
contexto da sessão.

## O relato

Campos: `tipo` (`erro_tool` | `correcao` | `dificuldade` | `pedido_sem_tool`), `tool`
(opcional), `codigo` (código de erro, quando houver), `resumo` (uma frase genérica),
`detalhe` (o que aconteceu, genérico), `sugestao` (conserto proposto), `licao` (uma linha
imperativa, opcional), `duplicata_de` (número de issue, opcional), `nova` (bool, opcional).

`ToolError` ganha um código (`ToolError(msg, codigo=...)`), e todo `raise ToolError` em
`mcp/` passa a declarar o seu. Um teste lê os módulos pela árvore sintática e falha se algum
`raise ToolError` vier sem `codigo=`. Os códigos:

- `guarda` — a tool recusou de propósito: pede `confirmo`, `apagar_citada`, versão
  esperada, prévia que precisa ser repetida.
- `argumento` — valor inválido ou faltando no que o Claude mandou.
- `nao_encontrado` — subconta, dump, snapshot ou item que não existe.
- `extractor:<code>` — falha vinda do envelope do extractor, com o código dele
  (`login_pendente`, `sessao_indisponivel`, `http_NNN`, `erro`). `_run_extractor` preenche.
- `falha` — defeito do próprio automaster.

O registro automático relata só `falha`, `extractor:http_*`, `extractor:erro` e a exceção
inesperada (abaixo). `guarda`, `argumento`, `nao_encontrado`, `extractor:login_pendente` e
`extractor:sessao_indisponivel` não viram relato automático; se forem sinal de problema
(guarda que trava o uso certo, argumento confuso), a revisão da conversa pega com contexto.
`TypeError` (o Claude mandou argumento que a tool não conhece) vira `dificuldade`, porque
costuma indicar descrição de tool confusa. Pesquisa A4.

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
- A revisão da conversa não relata o que a sessão já relatou pela tool ou pelo erro automático
  (o módulo guarda as assinaturas da sessão corrente em `fila.jsonl`/`publicadas.json`).

## Publicação

Pelo `gh` (`gh issue create`, `gh issue edit`, `gh issue list --label auto-relato`). Antes
de criar, `gh label create --force` garante os labels (label ausente faz a issue inteira
falhar, A10). A publicação roda sob `fcntl.flock` num arquivo da pasta de aprendizados, para
duas sessões paralelas não abrirem a mesma issue (A14). A pasta vem de
`AUTOMASTER_APRENDIZADOS`, com `~/.automaster/aprendizados` como padrão (A8). Sem `gh`,
sem login ou com falha: o relato fica em `fila.jsonl` e a fila é drenada na próxima
publicação bem-sucedida e na revisão em segundo plano. Nada disso bloqueia nem atrasa a tool que errou:
o registro automático só grava na fila; quem publica é a tool `relatar` e a revisão em segundo plano.

## Vida da lição

Lição = uma linha imperativa + número da issue + versão do plugin em que nasceu. O
`SessionStart` imprime as ativas, até 15 linhas, as mais recentes primeiro. O matcher do hook
passa a `startup|clear|resume|compact`, para as lições voltarem ao contexto depois de
compactar ou retomar (A15); a revisão em segundo plano só dispara em `startup` e `clear`.

Aposentadoria, na revisão em segundo plano (o hook de início em si só lê arquivo): issue fechada como resolvida
(`stateReason: COMPLETED`) e versão instalada do plugin maior que a versão em que a lição
nasceu. Fechada como `NOT_PLANNED`: a lição fica.

## Testes

pytest, sem rede, com `gh` e `claude` falsos. Um fixture `autouse` no `conftest.py` aponta
`AUTOMASTER_APRENDIZADOS` para pasta temporária e desliga a publicação real (A8).

- `limpar` tira id do GHL, e-mail, telefone e URL com id.
- assinatura estável para o mesmo erro e diferente para tool diferente.
- erro esperado não vira relato; `TypeError` vira `dificuldade`.
- todo `raise ToolError` em `mcp/` declara `codigo=` (leitura pela árvore sintática).
- exceção inesperada numa tool vira erro da chamada, o servidor responde à chamada seguinte
  e o relato não leva a mensagem da exceção.
- sem `gh`, o relato vai para a fila e sai na próxima publicação.
- trava diária segura a sexta issue.
- repetição edita a issue existente em vez de abrir outra.
- `relatar` com issue parecida devolve candidatas e não publica.
- aposentadoria: só com `COMPLETED` e versão nova.
- `mcp_server.handle` registra o erro e a resposta da tool não muda, mesmo com o registro
  falhando.
- revisão: conversa sem tool automaster não chama o modelo; com tool, chama e publica;
  conversa já revisada não é lida de novo; conversa parada há menos de 30 min fica para depois.
- `SessionStart` imprime as lições ativas.

Mudança de comportamento do plugin: sobe as três versões, entra no `CHANGELOG.md`, a contagem
de tools vai para 37 no `CLAUDE.md`, na descrição da skill `automaster-leitura` e onde mais
a lista aparecer.

## Limpeza dos ids já publicados

Os docs versionados do repositório público já têm ids reais de subconta e de workflow de
clientes (`docs/backlog-arquitetura.md:55`, `:86`;
`docs/vesta/research/2026-10-09-sessao-de-fundo-research.md:228`, pesquisa A13). Uma etapa
própria troca esses ids, e qualquer outro id real de cliente achado em `docs/`, `CLAUDE.md`,
`skills/` e `CHANGELOG.md`, por marcadores (`<loc-cliente>`, `<workflow>`). A subconta de
teste `idTeste0000000000004` fica. O histórico do git continua com os ids; reescrever
histórico está fora.

## Fora de escopo

Reescrever o histórico do git. Abrir PR sozinho. Ler conversa de sessão que não usou o automaster. Relatar problema de outro
plugin ou do Claude Code.

## Decisões do grill

- **A1** — a revisão da conversa saiu do `SessionEnd` e foi para o começo da sessão
  seguinte, em segundo plano, sobre as conversas anteriores ainda não revisadas. Motivo: o
  `SessionEnd` tem 1,5 s, é morto ao estourar e não roda quando o terminal é fechado.
- **A2** — chamada filha com `disableAllHooks` e `AUTOMASTER_REVISAO=1`. Motivo: sem isso o
  `claude -p` roda o hook de início do plugin e entra em laço.
- **A3** — o ambiente da chamada filha não é mexido; com chave de API presente, cobra na
  chave. Motivo: decisão do usuário.
- **A4** — `ToolError` ganha código obrigatório, marcado em todo `raise`, travado por teste.
  Motivo: o erro era só frase, e a maioria dos 131 erros é guarda funcionando; relatar tudo
  seria barulho, e casar frase quebra quando o texto muda.
- **A5** — exceção inesperada passa a ser capturada em `handle`, vira erro da chamada e é
  relatada como `falha`. Motivo: hoje derruba o servidor e todas as tools somem da sessão.
- **A6** — mantido: recusas e prévias voltam como sucesso e não são relatadas. Motivo: não
  são defeito.
- **A7** — mantido: erros que as tools engolem (`tags`, `workflow_editar`) ficam para a
  revisão e para `relatar`. Motivo: mudar essas tools é outro trabalho.
- **A8** — caminho em `AUTOMASTER_APRENDIZADOS` e fixture `autouse` que aponta para pasta
  temporária e desliga a publicação. Motivo: a suíte gravaria e publicaria no `~` real.
- **A9** — `test_release_0_31_0.py`, já vermelho, é consertado na etapa de versão.
- **A10** — `gh label create --force` antes de criar issue. Motivo: label ausente faz a issue
  inteira falhar.
- **A11, A12** — mantido: filtro antes de publicar, mascarando a mais; assinatura em hex
  curto que o filtro não toca. Motivo: edição não apaga o histórico da issue.
- **A13** — limpeza dos ids de cliente já publicados entra nesta feature, numa etapa
  própria, sem reescrever histórico. Motivo: decisão do usuário.
- **A14** — `fcntl.flock` em volta da publicação. Motivo: sessões paralelas abririam a
  mesma issue duas vezes.
- **A15** — matcher do `SessionStart` passa a `startup|clear|resume|compact`. Motivo: depois
  de compactar ou retomar, as lições sumiriam do contexto.
- **A16** — o leitor de conversa tolera linha estranha e ignora sessão que não seja `cli`.
- **A17** — mantido: publicação sem confirmação. Motivo: decisão do usuário; o freio é a
  trava diária e a deduplicação.
