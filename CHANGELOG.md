# Changelog — plugin `automaster`

Versões do `.claude-plugin/plugin.json`. Toda mudança que afete o que o plugin
instalado faz sobe a versão aqui; o time atualiza com
`claude plugin marketplace update zoi && claude plugin install automaster@zoi`.

## 0.31.0 — painéis nativos (dashboards) do GHL

- **Quatro comandos e quatro tools MCP** (36 no total): `dashboards` (leitura ao vivo: lista, detalhe,
  catálogo, versões, dados de widget, fuso), `dashboard-acao` (ESCREVE: criar, editar, tema, renomear,
  apagar, restaurar e publicar; prévia sem `--confirmo`), `dashboard-ver` (PNG do painel num perfil de
  tela próprio, com `--login` uma vez) e `dashboard-conferir` (recontagem de cada widget: `bate`,
  `diverge`, `sem_conferencia`). Skill nova `automaster-dashboard` com o método (leitura, entrevista,
  plano, montagem, loop visual, loop de dados, publicação).
- Painel nasce privado. `publicar` exige `--confirmo` e recusa se a última conferência divergiu.
- Header `x-reporting-api-version: 3` em todo `/reporting/`; sem ele o PUT dá 409.
- O histórico de versões está desligado na subconta, então `restaurar` não tem para onde voltar.
- **Conferência, fontes e limites:** oportunidades, contatos, conversas e agenda recontam pelas rotas de
  leitura; ligações recontam pelo GHL contra o GHL (não é independente). Conversas de atividade
  divergem: o widget as conta e a busca nunca as devolve.
- **Pendência, e-mail:** rota de relatório de e-mail da conta não encontrada; widgets `crm-emails`
  saem `sem_conferencia`.
- **Pendência, Meta:** a conferência dos anúncios exige `AUTOMASTER_META_TOKEN`; sem token vira
  `sem_conferencia` e não foi exercitada com token real.
- Dois endurecimentos de segurança: conta de anúncio só aceita dígitos antes de entrar na URL do Graph,
  e o GHL deslogado cai em `/?url=` (o `--login` espera `/v2/`).

## 0.30.0 — sem interfaces: só funcionamento

- **Removidas as interfaces do auditor**: a TUI (`automaster-audit tui`, extra `[tui]`) e os HTMLs
  (`graph`, `dashboard`, `validation`, `journey`). Saem junto o design system, as fontes embutidas e
  os módulos de render. O que sobra é texto e dado: `audit` (report.md/json), `paths`, `diff`,
  `verify-contracts` e todas as tools MCP. As tools `inventario` e `jornada` seguem funcionando, só
  que sem a página.
- **`contato timeline` não grava mais HTML**: sempre devolve JSON, sem abrir navegador.
- O extra `[tui]` some do `pyproject.toml`, e a CI instala só `[dev]`.

## 0.29.0 — extração grava onde o MCP lê; perfil configurável; login Google na janela

- **Extração grava em `~/.automaster/dumps`** quando `AUTOMASTER_DUMPS` não está definido, o mesmo
  default do MCP. Antes, a CLI gravava em `<repo>/dumps` quando rodada de dentro de `extractor/`,
  e as tools liam um snapshot antigo (issue #4).
- **`AUTOMASTER_PERFIL`** troca o caminho do perfil do Chrome também para o `discover` e para o
  `sessao status` (antes só o cliente do processo de fundo lia a variável).
- **Sessão do GHL exportada** para `~/.automaster/sessao/estado-ghl.json` (0600) depois de cada captura
  bem-sucedida: só cookies e localStorage dos domínios do GHL, para o Playwright MCP importar com
  `storageState`. Não é o perfil compartilhado, porque dois Chromes não abrem o mesmo perfil ao mesmo
  tempo. Isto grava cookies de sessão em disco; o CLAUDE.md foi ajustado para dizer isso (issue #3).
- **Janela de login sem a marca de automação** (`--enable-automation` removida, `AutomationControlled`
  desligado), para o Google aceitar "Sign in with Google". Não verificado contra o Google ainda
  (issue #2). A mensagem de `login_pendente` agora manda usar e-mail e senha.
- Erro de perfil aberto por outro Chrome já existe desde a 0.28.0; a issue #1 segue esse caminho.

## 0.28.0 — sessão de fundo: um Chrome invisível para todos os comandos ao vivo

- **Processo de fundo dono do perfil** `~/.automaster/chrome-profile`: mantém um Chrome
  invisível logado; a janela só aparece quando o GHL pede login.
- **Tokens por socket Unix** em `~/.automaster/sessao/`; cada comando chama o GHL direto por
  `fetch`, com corte de 30 s, e a renovação sai pelo `exp` a cada pedido.
- **Tempo de um comando ao vivo**: 4,60 s antes (Chrome visível a cada comando); 1,73 s com o
  processo de fundo de pé; 7,36 s na primeira chamada, que sobe o processo.
- **Leitura em paralelo** entre sessões e processos. Dentro de uma sessão do Claude Code o
  servidor MCP segue serial: as tools esperam a vez.
- **Reverte a 0.12.0** (escrita ao vivo em série por convenção) **e a recusa da trava da
  0.22.0**: a trava do perfil passa a ser do processo de fundo, e a escrita espera a vez numa
  fila da máquina (`escrita.lock`, até 2 min) em vez de falhar.
- **Códigos `login_pendente` e `sessao_indisponivel`** no envelope `--json`.
- **Comando `sessao`** (`status`, `subir`, `encerrar`, `tokens`, `renovar`).
- **Fechamento limpo**: o Chrome de fundo fecha as páginas antes do contexto e desliga os
  tratadores de sinal do Playwright; fechar o contexto direto perpetuava `exit_type: Crashed`
  no perfil, e o caminho antigo fechava sujo — candidata a causa de parte dos logins perdidos.
  O Chrome invisível parado leva 20 a 26 s para fechar; o prazo de encerramento é 45 s.
- Prévia visual no Chrome do sistema sem perfil; o discover encerra o processo de fundo; erro
  claro de perfil aberto por outro Chrome (C5); registro de pedidos de login
  (`logins.jsonl`); o MCP roda a CLI com `node --import tsx`, sem processo intermediário.
- **Contrato do socket para outros projetos** em `docs/sessao-de-fundo.md`: quem precisa de
  token pede ao processo de fundo; quem precisa de tela usa perfil próprio (A45).
- Atualizar o plugin: `claude plugin marketplace update zoi && claude plugin install automaster@zoi`.

## 0.27.0 — TUI de navegação do dump

- **TUI `automaster-audit tui`** (Textual + textualeffects, extra opcional `tui`:
  `pip install -e '.[tui]'`). Só leitura do dump: seleção de subconta e snapshot, tela
  principal com 4 abas (workflows, achados, entidades, diff) e busca, detalhe do workflow em
  árvore com o passo quebrado marcado e `n` para o próximo erro, entidade com o papel em cada
  workflow.
- **Camada cinematográfica**: abertura animada, transições, contadores e pulso; desliga com
  `--sem-animacao` ou `TEXTUAL_ANIMATIONS=none`.
- **Inventário (também na tool MCP `inventario`)**: `achados` por workflow; `usos` com o papel
  por workflow em tags, campos, funis e usuários (escreve, cria, busca, atribui, notifica);
  fatias novas `forms` e `templates`.
- CI instala `.[dev,tui]`. Spec em `docs/vesta/specs/2026-09-25-tui-navegacao-design.md`.

## 0.26.0 — configuração do workflow e validação ao vivo

- **Ação `configuracao`** em `workflow-editar` (só `allowMultiple` por enquanto): recusa
  workflow sem step, não passa pelas 18 regras — configuração geral não é referência.
- **Aviso de reentrada**: adicionar gatilho de tag no workflow com `allowMultiple` desligado
  avisa em vez de gravar em silêncio; remover tag não avisa.
- **Prévia devolve o documento de antes e as entidades ao vivo** (tags, usuários, funis,
  campos, custom values, lista de workflows); rota que falha cai para o dump e o aviso nomeia
  qual.
- **As 18 regras validam workflow que ainda não está no dump** (montado do documento) e usam
  as entidades lidas ao vivo em vez das do dump quando disponíveis — fecha o falso positivo de
  tag criada depois da extração.
- Documento e entidades ao vivo nunca voltam na resposta da tool MCP `workflow_editar`.

## 0.25.0 — linter dos dois lados, e o typecheck que finalmente vê os testes

Nenhuma tool nova, nenhuma regra nova, nenhum comportamento alterado: as 32 tools
respondem exatamente como na 0.24.0, e as sete saídas do auditor sobre o dump da
subconta de teste saem byte a byte iguais. O que muda é o que o CI barra daqui em diante.

- **Não havia linter nem formatter em nenhuma das duas metades.** Agora há `ruff` no
  auditor e `eslint` + `typescript-eslint` no extractor, e os dois barram no CI. Do
  lado Python, 110 achados fechados e 82 arquivos formatados — o commit de formatação
  está sozinho e listado no `.git-blame-ignore-revs`, para o blame continuar apontando
  para quem escreveu o código.
- **O `tsc` rodava só sobre `src`**: os 225 testes do extractor nunca haviam sido
  verificados. O `tsconfig.check.json` novo cobre `src` e `test`, e achou 9 acessos a
  `attributes` sem checagem em `workflow-edit.test.ts`.
- **Dois bugs de verdade saíram do lint**, não de um relatório de estilo: o
  `program.parseAsync` da CLI não tinha `.catch`, então uma rejeição que escapasse de
  um comando virava `unhandledRejection` — sem envelope JSON e sem mensagem —, e 8
  `throw new Error(...)` engoliam o erro original, que agora vai em `cause`.
- **As três versões do repo andam juntas.** Os manifestos do extractor e do auditor
  estavam parados em `0.1.0` desde sempre. Alinhados aqui, e travados por
  `auditor/tests/test_versoes.py`, que falha se divergirem ou se a versão não tiver
  seção neste arquivo.
- A descrição do plugin dizia 35 tools; são 32 desde a 0.24.0.

## 0.24.0 — três tools a menos, a guarda de escrita provada, um monolito quebrado

**Trinta e duas tools, não trinta e cinco.** As regras seguem 18. A5 a A8 de
`docs/backlog-arquitetura.md`, que fecha a lista.

- **Conversas cabem em três tools.** `conversas_buscar`, `rascunho` e `anexar` sumiram, e o
  que faziam entrou onde já havia porta: a busca na subconta inteira é `conversas` sem
  `id` e com `busca`, e rascunho e anexo viraram ações de `conversa_acao`
  (`rascunho-listar`, `rascunho-criar`, `rascunho-apagar`, `anexar`). Era o domínio com
  seis tools onde oportunidades resolve o mesmo com três; menos escolha, menos erro de
  escolha. Nenhuma capacidade saiu.
- **A guarda das 18 regras agora é provada, não combinada** (`test_politica_escrita.py`):
  uma varredura do pacote falha se `--sem-regras` aparecer fora da única porta que roda
  `validar_edicao`, ou se outro módulo chamar o comando de escrita de workflow. A flag
  também não é parâmetro de tool nenhuma — o agente não tem como pedir para passar por fora.
- **`workflow-edit.ts`**: 708 linhas viram uma fachada de 9, mais `workflow-edit/` com um
  arquivo por assunto (`tipos`, `documento`, `guardas`, `canvas`). Quem importa continua
  importando do mesmo lugar, e nenhuma declaração pública sumiu.
- Os dois spikes de junho saíram do git: o extractor os substituiu, e o histórico guarda.

## 0.23.0 — o formato do dump virou contrato, e o CI passou a defender o parsing

Nenhuma tool nova, nenhuma regra nova: seguem 35 e 18. A3 e A4 de
`docs/backlog-arquitetura.md`.

- **`dump_schema.json`** (em `auditor/src/automaster_audit/`): a forma do dump — arquivos
  obrigatórios, opcionais, campos e tipos — num arquivo só, lido pelas duas metades. O
  extractor confere ao terminar a extração (`src/dump/schema.ts`) e o auditor ao carregar,
  que agora recusa dump fora do contrato dizendo qual campo e em qual arquivo. Antes o
  formato só existia em prosa, e uma mudança aparecia três camadas adiante como regra
  quebrada sem explicação. Conferido contra os 34 dumps em disco: todos passam.
- **Cassete do smoke** (`npm run smoke -- -l <loc> --gravar <arquivo>`): grava a FORMA das
  respostas da API interna, e o CI roda as mesmas 23 checagens contra ela sem abrir Chrome.
  É o que faltava para uma regressão nossa de parsing em `src/api/*` aparecer no CI; o
  smoke ao vivo continua sendo o que avisa que a API do GHL mudou.
- **O cassete não carrega dado de cliente.** Toda string vira `"x"`, todo número `0`, array
  guarda um item. Escapam só as chaves de `VOCABULARIO` — `type`, `status`, `dataType` e
  mais dez —, cujo valor é palavra do protocolo do GHL e de que o parsing depende para
  ramificar (`type: "workflow"` separa workflow de pasta na mesma lista). Um teste varre o
  arquivo e falha se sobrar qualquer outro valor.
- A fixture de teste do auditor (`conftest.make_dump`) passou a gravar `fetchedAt` e
  `extractorVersion`, que o dump real sempre teve: testava uma forma que não existia.

## 0.22.0 — trava do Chrome e envelope JSON da CLI

Nenhuma tool nova, nenhuma regra nova: seguem 35 e 18. Os dois primeiros itens de
`docs/backlog-arquitetura.md`, que é o resto da lista.

- **Trava do perfil do Chrome** (`extractor/src/auth/lock.ts`): `~/.automaster/chrome.lock`
  com o PID de quem está segurando. Dois comandos de escrita ao vivo em paralelo já
  geraram, na 0.12.0, uma exclusão que ninguém pediu; a serialização era convenção
  escrita na documentação e agora é erro na hora, com o PID no texto. Lock de processo
  morto é roubado (`process.kill(pid, 0)` só pergunta se o PID existe).
- **Envelope JSON** (`extractor/src/saida.ts`): com `--json` toda saída da CLI vira uma
  linha `{ok, data}` ou `{ok:false, error:{code, message}}`, mais `escrita:{tentada,
  rastros}` quando um PUT/POST/DELETE chegou a sair. Sem `--json` nada muda.
- **O lado Python parou de adivinhar.** `mcp/base.py` lia o objeto solto do comando e,
  quando dava errado, deduzia o tipo do erro pelo prefixo do nome do comando e a escrita
  parcial de `--confirmo` estar nos argumentos — o que acusava produção alterada até numa
  prévia recusada, que não grava nada. Agora lê `code` e `escrita.tentada`, e cita o
  arquivo do estado anterior. Sem envelope (processo morto antes de imprimir) vale o
  palpite conservador de antes.

## 0.21.0 — consolidação: CI, smoke da API e dois monolitos quebrados

Nenhuma tool nova, nenhuma regra nova: seguem 35 e 18. O que muda é a sustentação.

- **CI** (`.github/workflows/ci.yml`): typecheck do TypeScript e as duas suítes (212 no
  extractor, 347 no auditor) rodam em todo push e PR. Antes só rodavam à mão. O `pytest`
  passou a ser declarado como extra `dev` do auditor e o extractor declara Node ≥ 22.
- **`npm run smoke -- -l <loc>`**: chama, uma vez cada, as mesmas funções de `src/api/*` que
  as tools usam, e confere a forma da resposta. É o aviso de que a API interna do GHL mudou,
  antes de o cliente avisar. Só leitura; falha sai com código 1. Não roda em CI — o extractor
  abre Chrome com perfil persistente e login manual. Ao vivo na subconta de teste: 23 de 23 ok.
- **`extractor/src/cli.ts`**: 2.604 linhas viram 35, mais um módulo por domínio em `src/cli/`.
- **`auditor/.../mcp_server.py`**: 1.853 linhas viram 114, mais o pacote `mcp/` com um módulo
  por domínio. O `tools/list` do servidor continua byte a byte igual ao da 0.20.0.

Os dois refactors são movimentação de código: nenhuma assinatura, nenhum texto de `--help` e
nenhum schema de tool mudou. A única edição nos testes do auditor foi o alvo do monkeypatch,
que acompanhou a função para o novo módulo.

## 0.20.0 — notas e tarefas do contato, tags da subconta

Quatro tools novas (35 no total): `anotacoes`, `anotacao_acao`, `tags`, `tag_acao`. 18 regras
de auditoria, sem mudança; 200 testes no extractor, 347 no auditor. Dois módulos novos no
extractor (`api/annotations.ts`, `api/tags.ts`) e quatro comandos de CLI.

Nada entra no dump: as quatro áreas são ao vivo. A tool `tags` é a única que também lê o
dump, para dizer quais workflows citam cada tag e em que papel; sem dump ela degrada, com
aviso, em vez de falhar. Na subconta de teste, 42 das 126 tags são citadas por workflow.

O que a pesquisa e a prova ao vivo mudaram no desenho:

- **Tag em workflow é o nome, nunca o id** — em step, em trigger e em condição.
- **Renomear pela API propaga** para os três lugares, provado ao vivo. Por isso `renomear` é
  escrita comum, sem guarda extra e sem propagação própria.
- **Apagar é a operação perigosa**: tira a tag de todos os contatos e pode disparar os
  workflows com trigger de "tag removida" — isso não tem prova nem a favor nem contra. Apagar
  tag citada por workflow exige `apagar_citada`.
- **Não existe contagem de contatos por tag** no GHL. A prévia do apagar declara que não sabe
  esse número em vez de estimá-lo.
- **Criar tarefa exige `completed`**, e a data é texto ISO.
- **Tarefa criada sem dono fica sem responsável** — o servidor não atribui ninguém. E a busca
  de tarefa por subconta usa índice: logo depois de apagar, a tarefa ainda aparece lá. A
  leitura por contato é a fonte confiável.

Dívidas declaradas, nenhuma bloqueia esta entrega:

- `workflow-editar --acao trocar-tag` continua sem tocar trigger nem `attributes.customTags`.
  Quem o usar para trocar tag deixa o trigger com o nome velho.
- Quando um step escolhe a tag em tempo de execução por merge field (`customTags`), a coluna
  de impacto de `tags` é incompleta — a resposta avisa, e nenhuma ferramenta consegue fechar
  essa contagem.
- O código HTTP do POST de nota não foi medido: o cliente devolve o corpo já decodificado e
  descarta o status. Não afeta nada, porque qualquer 2xx é tratado igual.

## 0.19.0 — 2026-09-21

Os três débitos que a 0.18.0 deixou declarados. Continuam 31 tools e 18 regras; 189 testes no
extractor, 331 no auditor.

- **A camada crua deixa de gravar por acidente.** `npm run workflow-editar --confirmo` avisava
  em stderr que passava por fora das 18 regras — e o aviso sumia no meio do log. Agora a
  gravação é RECUSADA sem `--sem-regras`, e a mensagem diz por onde entrar com guarda. As duas
  portas validadas (`automaster-audit workflow-editar` e a tool MCP `workflow_editar`) mandam
  a flag sozinhas, então nada muda para quem já entrava por elas.
- **A janela entre prévia e gravação do caminho de TRIGGER ganhou guarda.** Apagar trigger não
  incrementa o `version` do workflow, então `--versao-esperada` nunca enxergou outra remoção
  de trigger nessa janela. A prévia agora devolve `triggersAntes` e a gravação confere a lista
  relida contra `--triggers-esperados`: conjunto diferente aborta antes de escrever.
- **O `if_else` criado por `step-criar` sai com o nome certo no canvas.** O app rotula a caixa
  por `attributes.conditionName`, não pelo `name` do step: o nome do step agora vai para os
  dois, e `conditionName` escrito à mão no corpo continua vencendo.

## 0.18.0 — 2026-09-21

O corpo do workflow passa a se montar pelo MCP: criar, remover e mover step do canvas — e,
com isso, montar um workflow inteiro do zero, trigger e bifurcação inclusive. Continuam 31
tools e 18 regras; 186 testes no extractor, 329 no auditor.

- **Três ações novas no `workflow_editar`: `step-criar`, `step-remover` e `step-mover`.**
  Como mexem no corpo, herdam tudo que a parte A construiu — snapshot antes da escrita,
  guarda de workflow publicado, releitura de `version`, conferência por releitura e a
  validação contra as 18 regras nas duas portas.
- **O step novo vai em JSON cru** (`corpo`). Os `attributes` dos 41 tipos de step não são
  modelados: o comando decide só o encadeamento (`id`, `parentKey`/`parent`, `next`, `order`).
  Copie um step existente do mesmo tipo como molde — schema inventado por tipo geraria caixa
  que o editor do app não abre.
- **`step-criar` sem `depois_de` põe o step no INÍCIO do fluxo.** Era o que faltava para
  nascer do zero: workflow criado pela API vem sem step nenhum, e sem âncora não havia como
  plantar o primeiro. Com steps já existentes, o novo vira a entrada e a antiga pendura nele;
  com mais de uma entrada, recusa e manda escolher.
- **`step-criar` com `ramos` monta um container de N saídas.** Um `if_else` nasce com o
  condition-node, os nós de ramo (`branch-yes`/`branch-no`), o `sibling[]` cruzado e o
  `attributes.branches` com os ids batendo; os outros containers usam `transition`. A cauda da
  âncora vai para o primeiro ramo, com aviso — um container não tem cauda própria.
- **A âncora (`depois_de`) pode ser um nó de ramo**, que é como se põe uma ação dentro do
  "sim" de um `if_else`. Container de N saídas é recusado, com a mensagem dizendo em qual
  ramo ancorar.
- **Nó de ramo não se remove sozinho** — é estrutura do container, indexada por
  `attributes.branches` e pelo `sibling[]` dos irmãos. Container só sai com `com_subarvore`,
  levando os ramos e tudo que pende deles; a recusa diz quantos steps sairiam.
- **A pergunta aberta do canvas fechou ao vivo**: step criado sem
  `advanceCanvasMeta.position` aparece no lugar certo, porque o editor calcula o layout.
  Nenhuma coordenada é inventada.
- **Prévia recusada não diz mais que produção pode ter mudado.** A dica de rastro saía em
  toda falha, inclusive na de uma prévia que não escreveu nada.

## 0.17.0 — 2026-09-21

Os débitos que a 0.15.0 e a 0.16.x deixaram declarados, fechados antes de abrir a escrita de
steps. Continuam 31 tools e 18 regras; 163 testes no extractor, 323 no auditor.

- **A validação contra as 18 regras ganhou uma porta de linha de comando.**
  `automaster-audit workflow-editar` chama a mesma função da tool MCP — prévia sem
  `--confirmo`, validação, gravação —, então a guarda deixa de existir só dentro do MCP. Nada
  foi reimplementado: é um segundo chamador. `npm run workflow-editar` continua sendo a camada
  crua e agora AVISA em stderr, a cada gravação, que passou por fora das regras.
- **Ação nova sem teste próprio quebra a suíte.** Um teste parametrizado cobre as onze ações da
  tool, fixando o que vai na linha de comando e se a validação rodou; outro compara a lista de
  ações com a tabela de casos e falha quando nasce ação sem caso. Foi a falta disso que deixou
  `trigger` rodar sem validação sem ninguém notar.
- **A prévia de trigger não cai mais inteira quando a lista de triggers falha.** Na adição a
  lista só alimenta o diff: perdê-la agora vira `aviso` e a validação usa a do dump. Devolver
  lista vazia seria pior que falhar — faria toda referência quebrada de trigger sair como
  "resolvida". Em `remover`/`substituir`, e em qualquer gravação, a falha continua fatal.
- **O mesmo dump gerava dois relatórios diferentes em duas rodadas.** `workflow_call_cycle`
  ancorava o achado no nó por onde o DFS entrou no anel, que depende da ordem de iteração de um
  `set`: três achados trocavam de workflow a cada execução e o `diff` de snapshots acusava
  mudança onde nada mudou. O ciclo passa a começar sempre pelo menor id. Contagem de achados
  inalterada (subconta de teste: 31 ERROR, 19 WARN, 132 INFO).
- **Renomear um step não pode contar como erro novo, seja qual for a regra.** A normalização do
  detalhe cobria só a fraseologia `step '...'`; agora a lista de rótulos é explícita
  (`ROTULOS_DE_NO`) e um teste varre as regras e recusa quem nomeie um nó por fora dela —
  `uncovered_condition` já estava fora, com `if/else '...'`.
- **Array reordenado aparece como reordenado.** No diff e no residual, `["x","y"]` virando
  `["y","x"]` dizia só "attributes.tags", que se lê como "as tags mudaram".
- **Os dois lados leem o mesmo campo de ancestralidade.** `limpar-orfaos` lia só `parentKey`; o
  auditor já lia `parentKey` com o `parent` legado como reserva desde a 0.16.1.
- Corrigidos na documentação: `docs/endpoints.md` ainda dizia que criar e trocar trigger
  recusam no comando (a 0.16.0 implementou os dois) e o `CLAUDE.md` dizia que `parent` nunca
  aparece. O teste da tool que passava só porque a subconta `L1` não tem dump em disco agora
  força o ramo que queria medir.

## 0.16.1 — 2026-09-21

O grafo de execução do auditor passa a ler `parentKey`, o campo que o servidor grava.
Continuam 31 tools e 18 regras; 300 testes no auditor.

- **`parent` não era o campo errado, era o incompleto.** Os dois existem no dump: em 26.393
  steps de 1.027 workflows, `parentKey` cobre mais steps e discorda de `parent` em 1.017.
  Lendo `parent`, `roots()` devolvia 4.864 entradas onde existem ~1.027 — quase cinco vezes
  mais. `parent_of()` lê `parentKey` e cai no `parent` legado, então dump velho continua lendo.
- **Efeito medido na subconta de teste**: as entradas de fluxo caem de 229 para 71 (uma por workflow)
  e `paths.md` sai de 4.827 caminhos para 3.364 — 1.463 eram caminhos-fantasma, começando no
  meio do fluxo. Os truncamentos no cap caem de 4 para 1.
- `journey.html` e as camadas 2 e 3 do `validation.html` andam sobre o mesmo grafo e mudam
  junto. Os achados da camada 1 não mudaram na subconta de teste: ela não tem step órfão. Em todos os
  dumps em disco `unreachable_step` passa a ver 3 steps de verdade.

## 0.16.0 — 2026-09-21

Os cinco aprendizados da primeira montagem de automação de ponta a ponta viram guarda no
código. Continuam 31 tools e 18 regras; 158 testes no extractor, 299 no auditor.

- **Criar trigger existe.** `POST .../workflow/<loc>/trigger` grava quando o corpo leva
  `workflowId` em **camelCase**; com `workflow_id` — que é como a LEITURA devolve o campo — o
  servidor responde 200 com id e o trigger nasce órfão, sem disparar nada. Era esse falso
  positivo que fazia a rota passar por inexistente. `trigger_acao` agora aceita `adicionar`,
  `remover` e `substituir`, com o trigger novo em `trigger_corpo`; `criarTrigger` força o
  `workflowId` e reaponta as `actions`, e a gravação só é dada por feita quando o id aparece
  na lista autoritativa relida.
- **`criar` e `duplicar` exigem `pasta`.** Workflow fora de pasta não aparece na lista do app
  (a raiz mostra pasta, não workflow) e o editor abre em branco. A recusa vem antes de abrir o
  Chrome e o erro da CLI lista as pastas da subconta.
- **Workflow recém-criado nasce pela metade** — sem `status` e com `parentId` vazio.
  `nascerVisivel` move para a pasta e grava `status: "draft"` depois de criar ou duplicar;
  é idempotente e devolve o estado final em `visivel`.
- **A resposta traz `url`, o link do editor**, com `workflow` no SINGULAR. Com `workflows` (a
  rota da lista) o app devolve 404 e a página fica branca, mesmo em workflow publicado.
- **Ciclo provado ao vivo na subconta de teste** (workflow descartável criado e apagado, sem resíduo):
  `criar` sem pasta recusa listando as pastas; `criar` com pasta devolve `visivel` com
  `parentId` e `status: "draft"`; `trigger adicionar` mostra a prévia e depois grava
  (`idTeste0000000000001`); `substituir` troca o trigger e confere que o antigo saiu;
  `remover` esvazia a lista; `apagar` fecha. Sete de sete.
- **Documentado como armadilha**: `400 "action has a corrupted type"` é o servidor validando o
  corpo do step, e navegar no app pelo Playwright desloga o perfil persistente do Chrome.

## 0.15.0 — 2026-09-21

Escrita de ESTRUTURA de workflow. Uma tool nova (`workflow_editar`), 31 no total, módulo
`extractor/src/api/workflow-edit.ts`, rotas em `extractor/src/api/workflows-write.ts` e o
comando `npm run workflow-editar`. Continuam 18 regras de auditoria.

- **Cinco operações cirúrgicas** sobre o corpo: `trocar-ref` (um id em qualquer profundidade),
  `trocar-tag` (pelo nome, só onde tag mora — nunca em texto de mensagem), `limpar-orfaos`
  (steps que nunca executam), `atributo` (um campo de um step) e `trigger` (remover).
  Mais `criar`, `renomear`, `mover`, `duplicar`, `apagar` e `historico`.
- **Guardas do COMANDO** (`npm run workflow-editar`, e portanto de tudo que passa por ele):
  snapshot do antes em `<dumps>/_workflows/`, gravado ANTES da escrita em toda ação destrutiva;
  prévia com diff que não grava nada sem `--confirmo`; releitura da `version` antes de gravar
  (alguém salvou pelo app → aborta) e `--versao-esperada` para a janela entre prévia e gravação,
  que são dois processos; `--publicado` obrigatório junto de `--confirmo` em workflow publicado,
  com a contagem de quem está dentro agora; `--de` de `trocar-ref` tem que ter cara de id.
- **Guarda da TOOL MCP `workflow_editar`, e só dela:** a validação do documento editado contra
  as 18 regras, que RECUSA a gravação se a edição introduzir um ERROR novo. Ela mora na tool,
  não no comando — quem roda a CLI com `--confirmo` escreve sem passar por regra nenhuma, de
  propósito (o comando não carrega o auditor). Mover a guarda para a CLI é parte B.
- **200 não é prova nesta API, e bump de `version` também não** — a rota irmã `only-triggers`
  faz os dois e não grava nada. Toda escrita agora CONFERE o efeito relendo: a edição de corpo
  compara o que pediu com o que ficou e responde `aplicado: "duvidoso"` com o diff residual
  quando sobra diferença; a remoção de trigger relê a lista autoritativa e dá erro explícito se
  o id ainda estiver lá. A saída de `trigger` passa a trazer a lista REAL relida.
- **`apagar` guarda cópia do que apagou**: o documento inteiro e a lista de triggers vão para o
  registro antes do DELETE. É a única escrita irreversível daqui — `PUT /<loc>/<wid>/recover`
  aparece no bundle do editor e está no mapa da spec, mas nunca foi exercitada (não se sabe o
  corpo nem se restaura workflow apagado ou versão do histórico), então a função morta saiu do
  código e `apagar` continua sem desfazer até haver prova ao vivo.
- **A tool MCP não devolve mais o documento inteiro do workflow**: ele existe para a validação
  local e só; voltava para o contexto do modelo sem teto nenhum.
- **Achado do servidor:** publicar workflow com referência quebrada dá
  `400 {"message":"Referenced asset(s) missing from this location: Form '…'."}`. O
  `broken_form_ref` do auditor tem eco no próprio GHL.
- **Correções da prova ao vivo** (nove premissas testadas, quatro caíram):
  `adicionar` e `substituir` trigger agora RECUSAM em vez de devolver sucesso falso — não há
  rota para criar nem para trocar trigger, e o `only-triggers` responde 200 sem gravar nada;
  `remover` trigger passou a usar o `DELETE .../trigger/<tid>?workflowId=<wid>`; `limpar-orfaos`
  passou a ler `parentKey` (com `parent` nada era órfão e a operação era no-op); a validação
  pelas regras recebe a lista autoritativa de triggers e, sem ela, usa a do dump e diz isso
  (antes tratava a lista como vazia e dava todo ERROR de trigger como "resolvido"); a tool MCP
  checa o dump ANTES de abrir o Chrome e devolve `validacao.rodou: false` para workflow fora do
  dump, em vez de estourar `ValueError`.
- **A remoção de trigger passa pela validação das 18 regras**, como as ações de corpo: a prévia
  devolve o documento e a lista de triggers de depois, e um ERROR novo (tipicamente
  `workflow_unreachable`, quando o trigger removido era a única entrada) recusa a gravação.
  Quando não há o que validar, a resposta traz `validacao.rodou: false` com o motivo — a chave
  nunca some em silêncio.
- **Fora, declarado:** remover step vivo e recosturar ponteiros, criar step do zero, reordenar
  fluxo, restaurar versão ou workflow apagado (a rota `recover` existe no bundle mas nunca foi
  exercitada), criar/trocar trigger e mover a validação pelas 18 regras para a CLI — tudo parte B.
- **Limitações conhecidas** (deixadas de propósito, com motivo): `trocar-ref` troca o id e o
  rótulo humano (`title`) do step continua o antigo, porque não há de onde tirar o rótulo novo —
  o comando passou a AVISAR quando isso acontece; `renomear` e `mover` não passam pela guarda de
  publicado, porque não alteram execução nenhuma.

## 0.14.0 — 2026-09-20

Templates de e-mail. Uma tool nova (`modelos_email`), 30 no total, módulo
`extractor/src/api/emails.ts` e a entidade `email_templates` no dump.

- **A premissa antiga estava errada.** A doc dizia que e-mail não dava para auditar porque o
  `template_id` do step não casa com o email builder. O campo certo é outro: o id real do
  template está no `previewUrl` do step. Quando o usuário escolhe um template existente, o GHL
  guarda uma cópia dentro do step, e o `template_id` passa a ser o dessa cópia.
- Duas regras novas, 18 no total: `stale_email_template` (WARN) para step cujo template sumiu do
  builder, e `unused_email_template` (INFO) para template que nenhum workflow usa.
- É WARN e não ERROR porque o e-mail continua sendo enviado: o conteúdo vive no Storage. O que
  se perdeu é poder editá-lo pelo app.
- Provado comparando duas subcontas: a Cliente B casa 6 de 6 no mesmo formato que falha 5
  vezes na subconta de teste, então template fora da lista é template apagado, não cópia oculta.
- `modelos_email` tem `lista`, `usos` (qual workflow cita cada template) e `conteudo` (texto e
  links, baixados na hora de uma URL pública, sem Chrome e sem token).
- `comparar` e a seção "Regras cegas" do relatório passam a cobrir e-mail.

## 0.13.0 — 2026-09-20

Workflows ao vivo. Duas tools novas (`workflows_ao_vivo`, `workflow_acao`), 29 no total,
módulo `extractor/src/api/workflows-live.ts` e dois comandos de CLI.

- Leitura ao vivo pelos dois lados: quem está dentro de um workflow (com o passo em que
  cada um parou, desde quando e por que entrou) e em que workflows um contato está.
- Escrita: publicar/despublicar, inscrever, remover e retomar. Tudo atrás de `confirmo`,
  com registro em `<dumps>/_workflows/<locationId>/<workflowId>/`.
- **Despublicar não remove ninguém**: quem está dentro congela no passo em que está e volta
  a andar, todo mundo de uma vez, na republicação.
- **Inscrever é enfileirado pelo servidor**: ler o estado logo depois pode não mostrar o
  contato ainda.
- **Toda escrita é carimbada com o usuário logado**, lido do token; sem conseguir ler, a
  escrita recusa e pede `usuario`.
- A tool `workflow` passa a declarar na descrição que lê o dump — o estado corrente é da
  tool nova. Comportamento inalterado.
- Teto de 500 inscritos por leitura, ajustável, com declaração de corte.
- As quatro escritas (publicar/despublicar, inscrever, remover, retomar) foram exercitadas
  ao vivo na subconta de teste; quatro comportamentos (retomar inscrição pausada, despublicar com
  gente congelando de verdade, remover contato parado no meio, e efeito sobre inscrição
  dupla) ficaram sem prova — nenhum workflow descartável tinha passo de espera. Detalhe em
  `docs/superpowers/handoffs/2026-09-20-workflows-ao-vivo-prova.md`.

Rotas em `docs/endpoints.md`, seção `## Workflows ao vivo`.

## 0.12.0 — 2026-09-19

Escrita de formulários e surveys. Duas tools novas (`formulario_acao`,
`formulario_estilo`), 27 no total, e a skill `automaster-formulario-visual`.

- Criar, editar, duplicar, apagar e restaurar versão de formulário e survey. A edição
  republica o documento inteiro a partir do que está no servidor, aplicando operações
  declaradas — campo que o automaster não modela atravessa intacto.
- Slide do survey é entidade de primeira classe: criar, remover, renomear, reordenar,
  mover campo entre slides e lógica condicional entre slides (salto). Navegação e barra
  de progresso são atributos de estilo (`form.isProgressBarEnabled` etc.) escritos pela
  op genérica `definir`, não operações próprias.
- Prévia antes de publicar: sem `--confirmo`, o comando mostra campo que entra, campo que
  sai e estilo alterado, sem tocar no servidor. É o primeiro comando do projeto com esse
  comportamento; os outros continuam dando erro seco.
- Identidade visual por cliente: os tokens vão para `fieldStyle` (o painel do builder, que
  sobrevive a edição na interface) e `customStyle` (CSS livre). `fieldCSS` nunca é escrito.
  Screenshot da página pública real para aprovar antes de aplicar em produção.
- Paleta padrão da subconta: leitura sempre, gravação só por comando à parte, e mescla —
  não substitui — as cores que a subconta já tinha.
- Guardas: remover exige nomear o campo; deixar o documento sem botão de envio ou sem
  nenhum campo é recusado sem flag explícita.
- **A leitura de formulários migrou de `backend.` para `services.leadconnectorhq.com`**, o
  host que o app usa — as seis rotas de leitura foram comparadas ao vivo entre os dois
  hosts e devolveram o mesmo conteúdo.
- **Achado de API, sem causa confirmada**: `duplicar` de survey pode devolver `200` com
  documento completo sem gravar nada, e um survey lido com sucesso pode desaparecer antes
  do `apagar` seguinte alcançá-lo. Depois de qualquer escrita de survey, confirme com um
  `GET` antes de assumir que o objeto está lá. Detalhe em `docs/endpoints.md`.
- **Escrita ao vivo é serial por construção**: o perfil persistente do Chrome é único, e
  dois comandos de escrita ao vivo em paralelo travam no `SingletonLock`.

## 0.11.0 — 2026-09-19

Formulários e surveys: leitura ao vivo, submissões, duas listas novas no dump e duas
regras de auditoria.

- **Tool nova `formularios` (25 no total)**: lista (já paginada), detalhe com os campos,
  submissões com filtro de formulário, contato e período, e busca por nome. O parâmetro
  `tipo` escolhe entre formulário e survey. Lê ao vivo, não usa o dump.
- **Regras novas `broken_form_ref` (ERROR) e `unused_form` (INFO), 16 no total**: a
  primeira acusa trigger de formulário/survey e `formId` de calendário apontando para
  algo que não existe mais — na subconta de teste é 1 achado real, o trigger "Formulário
  Enviado" citando `idTeste0000000000002`. A segunda lista o que ninguém referencia, e é
  INFO de propósito: formulário embutido em site externo não aparece no dump.
- **O dump ganha `forms.json` e `surveys.json`**, opcionais como os de template. Dump
  antigo continua carregando (schemaVersion segue 1) e não gera achado novo.
- **Comando de CLI novo** `npm run formularios`. Rotas em `docs/endpoints.md`, seção
  `## Formulários e surveys`.
- O id `fb-<locationId>` das submissões é o lead gen do Facebook e nunca vira achado.
- **Seção "Regras cegas" no `report.md`**: dump anterior a uma lista opcional passa a dizer
  quais regras não rodaram, para que ausência de achado não se confunda com tudo certo.

## 0.10.0 — 2026-09-19

`broken_template_ref`, a última regra de auditoria que faltava, mais as duas listas de
template que ela precisava no dump.

- **Regra nova `broken_template_ref` (ERROR, 14 no total)**: step que manda WhatsApp, SMS
  ou DM citando template que não existe mais. Na subconta de teste são 25 achados reais,
  confirmados ao vivo — o app também não acha esses ids.
- **O dump ganha `message_templates.json` e `whatsapp_templates.json`**, cada um opcional:
  canal desligado na subconta vira warning no manifest e a regra fica no-op para ele. Dump
  antigo continua carregando (schemaVersion segue 1, como quando entraram users e
  calendars) e não gera achado de template.
- **`template_id: "0"` não é achado**: é a opção "None - Free form message" do próprio app,
  e o texto vive em `attributes.message`. Sem essa exceção seriam 90 falsos positivos só
  na subconta de teste.
- **E-mail ficou fora da regra, de propósito**: nenhum `email.template_id` casa com id do
  email builder, nem varrendo as pastas. Seriam 13 de 13 falsos positivos. Razão em
  `docs/endpoints.md`.
- O `diff` passa a comparar as duas listas de template. Dump sem a lista é tratado como
  "não sei", não como "lista vazia" — senão o primeiro diff depois do upgrade diria
  "81 templates novos" sem nada ter mudado.

## 0.9.0 — 2026-09-19

Diff entre dois snapshots da mesma subconta: "o que mudou desde o dump anterior".
Trabalho só de disco — nenhuma rota nova, nenhum Chrome.

- **Tool nova `comparar`** (24 no total) e subcomando `automaster-audit diff <antigo> <novo>`,
  que escreve `diff.md` na pasta do snapshot mais recente. Sem `antes`/`depois`, a tool
  compara os dois snapshots mais recentes da subconta.
- Workflow conta como alterado quando muda nome, status ou o conteúdo dos steps ou dos
  triggers. A comparação de conteúdo é por impressão digital do JSON canônico, e não por
  `updatedAt`: o `updatedAt` do detail nem sempre acompanha edição de step.
- Entidades entram no diff pelo que apareceu e pelo que sumiu (pipelines, estágios, tags,
  custom fields, usuários, calendários, custom values). Entidade ausente nos dois dumps
  antigos simplesmente não gera linha.
- Comparar dumps de subcontas diferentes não é erro, mas sai um aviso no relatório e no
  stderr — o resultado nesse caso é "tudo trocado" e não significa nada.

## 0.8.0 — 2026-09-19

Bloqueio de horário: capacidade nova na agenda, mais uma mudança de comportamento em
`forcar` e uma rodada de correções de uma revisão sobre a 0.7.0.

- **`agenda_acao` ganha `bloquear` e `bloqueio-editar`** (`POST`/`PUT
  /calendars/events/block-slots`), e `agenda` ganha `o=bloqueios`. Bloqueio não tem contato
  nem situação nem `calendario` — a tool recusa os três — e exige `dono`: com `calendario`
  de um calendário comum o servidor responde `400 The calendar is not an event calendar.`
  Sem tool nova: o plugin continua com 23 tools.
- **Mudança de comportamento: `forcar` agora EXIGE `dono`**, em `marcar` e também em
  `remarcar` (os dois ligam `ignoreFreeSlotValidation`, e sem `dono` o servidor devolve
  `422 A team member needs to be selected`). Quem chamava `forcar` em `remarcar` sem `dono`
  e contava com o servidor resolver sozinho passa a levar o erro da tool em vez do 422 —
  quebra uma chamada que antes "funcionava" por sorte do compromisso já ter responsável.

### Corrigido
- `_tipo`: o discriminante é `status` (`booked`/`unavailable`), não a presença de
  `contactId`.
- Bloqueio **não aparece** em `o=eventos` — só em `o=bloqueios`. Descrição da tool
  `agenda` e o comentário de `listBlockedSlots` diziam o contrário; corrigidos, porque um
  agente lendo a versão errada concluiria "sem bloqueio" e escreveria por cima de um.
- `bloqueio-editar` ganhou a mesma guarda de campos obrigatórios de `bloquear` (`inicio`,
  `fim`, `dono`, além de `id`): o PUT substitui o bloqueio inteiro, e campo ausente era
  perdido em silêncio — `bloqueio-editar -i x --titulo novo --confirmo` sozinho já bastava
  para o bloqueio perder dono e horário.
- `o=bloqueios` recusa `contato`: a rota não filtra por contato, e pedir isso devolvia o
  período inteiro sem avisar que o filtro foi ignorado.
- `--pagina` sem coerção virava offset `NaN`; agora clampada como `--limite`. Mesma
  correção nos dois filtros irmãos de oportunidades (`limite`/`pagina`).
- **`silenciar` provado do lado seguro** (herdado da 0.7.1): em calendário com notificação
  ao contato ligada, compromisso marcado com `silenciar` não gerou nenhuma mensagem na
  conversa do contato. O caso não silenciado segue sem prova, por decisão de segurança.

`bloqueio-editar` com corpo parcial (só `--titulo`, por exemplo) não foi exercitado ao vivo:
a guarda nova recusa esse caso antes de chegar ao servidor, então não há prova de como o
GHL de fato reagiria a um PUT parcial.

## 0.7.0 — 2026-09-19

Agenda: calendários, compromissos e notas, lidos e escritos ao vivo.

- **`agenda`**: calendários, calendário por id, horários livres, lista de eventos (mistura
  compromisso e bloqueio — filtre por `_tipo`), um compromisso por id, notas de um
  compromisso. Só leitura, sempre ao vivo — o dump só guarda nome e id de calendário, para
  resolver referência de workflow; compromisso não está lá.
- **`agenda_acao`**: marca, remarca, muda a situação (`new`/`confirmed`/`cancelled`/
  `showed`/`noshow`/`invalid`/`completed`/`active` — não existe "remarcado"), cancela, e
  cria/edita/apaga nota. Exige `confirmo=true`; registro em `<dumps>/_agenda/`. Compromisso
  que se repete exige `alvo` (`instancia` ou `serie`) — sem ele a tool recusa em vez de
  escolher.

**A escrita fala com o cliente.** Marcar ou remarcar dispara o e-mail ou SMS que o
calendário tem configurado e acorda as automações do compromisso. `--silenciar`/
`silenciar=true` desliga as automações junto, mas **não está provado** que também impede a
mensagem — o calendário de teste não tinha notificação configurada.

Validado ao vivo na subconta de teste, num calendário descartável criado e apagado na hora
(`idTeste0000000000003`), com o contato de teste. Cobriu marcar, remarcar (série completa e
uma só ocorrência), mudar situação, cancelar e as três operações de nota. **Não** exercitado
ao vivo: bloqueio de horário (`block-slots`), `--forcar` isolado, e a forma real de um
bloqueio (a subconta de teste não tinha nenhum — o discriminante `_tipo` vem da referência, não de
um bloqueio observado). Rotas e armadilhas em `docs/endpoints.md` seção `## Agenda`.

Bug achado e corrigido pela própria validação: a checagem de série lia o envelope errado
(`{event:...}` em vez de `{appointment:...}`), o que fazia a guarda de `--alvo` nunca
disparar. Corrigido; os três casos (`--alvo instancia`, `--alvo serie`, sem `--alvo`)
exercitados ao vivo depois da correção. Essa guarda e o desembrulho do envelope não têm
teste em CI (o extractor não tem runner) — só a prova manual registrada acima.

CLI: agenda, agenda-acao.

## 0.6.0 — 2026-09-19

Oportunidades: os funis e os cards da subconta, lidos e escritos ao vivo.

- **`oportunidades`**: pipelines e seus estágios, cards com filtro de pipeline, estágio,
  status e contato, busca por termo livre, e um card pelo id. Só leitura, sempre ao vivo —
  não usa o dump.
- **`oportunidade_acao`**: cria, edita, move de estágio, muda o status, apaga e restaura um
  card. Exige `confirmo=true`; registro em `<dumps>/_oportunidades/`. O contato de um card
  se define na criação e não se troca depois — a tool recusa a tentativa e explica.
- **`pipeline`**: cria, edita e apaga pipeline. A lista de estágios é substitutiva, então
  estágio omitido é removido junto com os cards dele — a tool conta os cards antes e
  recusa, a menos que `apagar_com_cards=true`. Apagar pipeline não tem restore.

As três foram exercitadas ao vivo na subconta de teste, num pipeline descartável criado e apagado
na hora, sem tocar os 4 pipelines reais. Rotas e armadilhas em `docs/endpoints.md`.

Não entrou: apagar cards em lote, e busca de pipeline por nome — a rota que parecia fazer
isso (`pipelines/search`) é listagem de cards de um estágio, não busca de funil.

CLI: oportunidades, oportunidade-acao, pipeline.

## 0.5.0 — 2026-09-19

Fecha as cinco áreas de conversas que a 0.4.0 tinha deixado de fora.

- **`anexar`**: sobe arquivos do disco como anexo de uma conversa e devolve as URLs para
  passar ao `enviar(anexos=[...])`. Não fala com o contato — só cria os arquivos no CRM.
  Teto de 25 MB por arquivo; cada upload deixa registro em `<dumps>/_anexos/`.
- **`whatsapp`**: templates com os componentes inteiros, templates aprovados, flows,
  números e estado da conta. Só leitura.
- **`whatsapp_enviar`**: manda um template aprovado ou um flow interativo. Sai para o
  contato, exige `confirmo=true`.
- **`config`**: configuração de IA e de SLA das conversas, incluindo o que está estourando
  agora na caixa. As escritas valem para a subconta inteira e gravam o estado anterior em
  `<dumps>/_config/`.
- **`grupo`**: group chat e chat interno entre usuários. O corpo de criar grupo não foi
  confirmado ao vivo — a tool aceita o payload cru.
- O cliente HTTP do extractor passou a falar multipart (`postMultipart`), que era o que
  travava o anexo desde a 0.4.0.
- CLI: `conversas-anexar`, `whatsapp`, `whatsapp-enviar`, `config`, `grupo`.

## 0.4.0 — 2026-09-19

Conversas completas: o que faltava da leitura, a gestão da caixa e os rascunhos.

- `conversas` ganhou filtro por tipo, busca dentro da conversa e `email=<id>` para o corpo
  inteiro de um e-mail (cortado em 400 caracteres na listagem).
- **`conversas_buscar`**: procura um texto nas mensagens de toda a subconta e diz quem
  recebeu.
- **`conversa_acao`**: marcar lida/não lida, estrela, cancelar uma mensagem agendada,
  reenviar uma que falhou — e apagar a conversa, que exige `confirmo=true` porque leva o
  histórico inteiro junto (o GHL não apaga mensagem avulsa).
- **`rascunho`**: criar, listar e apagar rascunho do contato. Não sai para ninguém.
- `enviar` aceita `quando` para agendar.

### Cuidado

O cancelamento de mensagem agendada responde **200 mesmo quando não cancelou** — a razão
vem no texto da resposta. E agendamento não funciona em nota interna: ela sai na hora.

## 0.3.0 — 2026-09-19

### Novidade

- **Tool `conversas`**: lê ao vivo as mensagens trocadas com um contato (SMS, e-mail,
  WhatsApp, chat). Cada mensagem traz tipo, direção, autor e `origem`
  (`app`/`workflow`/`campaign`/`api`) — é a `origem` que diz se a mensagem saiu de uma
  automação ou de uma pessoa. Corpo cortado em 400 caracteres; eventos de timeline ficam
  de fora salvo `atividades=true`. Na CLI: `npm run conversas`.
- `discover` ganhou `--rota` (abre qualquer tela) e `--filtro` (mostra também a resposta
  dos GET), que era o que faltava para mapear leitura da API interna.

- **Tool `enviar`**: manda mensagem ao contato (SMS, Email, WhatsApp, nota interna). Tipo
  `InternalComment` fica só na conversa e não sai para o contato; qualquer outro exige
  `confirmo=true`, porque manda mensagem de verdade e não tem desfazer. Cada envio deixa
  registro em `<dumps>/_mensagens/`. Na CLI: `npm run conversas-enviar`.

### Cuidado

Automação não se reconhece pela falta de autor: e-mail disparado por workflow vem com
`userId` preenchido. Use `origem`.

O `type` da mensagem é número na leitura e string no envio. Não são a mesma lista.

## 0.2.1 — 2026-09-18 (`289beb9`)

- **Corrige o servidor MCP não conectar em sessões abertas no próprio repo.** A
  config saiu da raiz para `.claude-plugin/mcp.json`, apontada pelo campo
  `mcpServers` do plugin.json: um `.mcp.json` na raiz o Claude Code carrega
  também como servidor de projeto, contexto em que `${CLAUDE_PLUGIN_ROOT}` não
  expande e o servidor morre com ENOENT.
- `editar` e `contato-editar` recusam custom field `FILE_UPLOAD`: a API forja o
  metadado do anexo a partir da URL sem baixar nada, gravando um anexo que não
  existe.
- `--set` aceita valor JSON (`{...}` / `[...]`), exigido por `TEXTBOX_LIST` —
  string crua respondia 200 e gravava `{}` em silêncio (`819d00b`).
- `serverInfo.version` do MCP sai do plugin.json em vez de fixo em `0.1.0`.

## 0.2.0 — 2026-09-18 (`a303277`)

- Oitava tool: **`editar`**, que escreve campos e tags de um contato pela API
  interna, grava snapshot antes e devolve `dispara` (workflows cujo trigger
  reage à mudança).
- Campo padrão só limpa com `null`; resolvedor de nome aceita camelCase e filtra
  `model: contact` (`00cf466`).

## 0.1.0 — 2026-09-18 (`af3573e`)

- Casca do plugin: manifesto, config MCP, shim de Python ≥ 3.12, hook de
  SessionStart, comandos `/automaster-extract` e `/automaster-audit`, skill
  `automaster-leitura`.
- Sete tools MCP de leitura sobre dumps offline: `dumps`, `inventario`,
  `workflow`, `achados`, `buscar`, `jornada`, `contato`.
