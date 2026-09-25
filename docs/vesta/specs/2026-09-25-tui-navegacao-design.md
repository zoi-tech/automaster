# TUI do automaster — navegação do dump (ciclo 1)

## Objetivo

A equipe da ZOI, que não conhece as flags da CLI nem os ids, abre `automaster-audit tui`,
escolhe subconta e snapshot e navega workflows, achados, entidades e diff sem abrir HTML.

Critério de sucesso: quem não conhece a CLI descobre em menos de um minuto por que um
workflow está quebrado.

## Escopo

Dentro: só leitura do dump em disco (`AUTOMASTER_DUMPS`).

Fora, fica para o ciclo 2: qualquer operação ao vivo (extrair, editar, enviar), que abre
Chrome e escreve na subconta.

## Arquitetura

Pacote `auditor/src/automaster_audit/tui/`, subcomando `automaster-audit tui` em `cli.py`.

Textual como dependência opcional: extra `tui` no `pyproject.toml`. Sem o extra, o
subcomando sai com mensagem pedindo `pip install -e .[tui]`. O servidor MCP e o CI
principal não carregam o Textual.

A TUI não lê o dump direto: chama as funções de `mcp/dump.py` (`dumps`, `inventario`,
`workflow`, `achados`, `buscar`, `comparar`), as mesmas que o servidor MCP expõe. Nenhuma
lógica de leitura ou auditoria nova.

## Telas

1. Seleção: subcontas e seus snapshots (`dumps`), mais novo primeiro.
2. Principal, com quatro abas e busca global (`/`, via `buscar`):
   - Workflows: lista com nome, status e contagem de achados; filtro por texto.
   - Achados: tabela filtrável por severidade (ERROR/WARN/INFO).
   - Entidades: tags, campos, funis, usuários, formulários, templates (`inventario`).
   - Diff: comparação com o snapshot anterior da mesma subconta (`comparar`).
3. Detalhe do workflow (`workflow`): triggers, passos em árvore, achados dele. Enter numa
   referência (tag, campo, funil) abre a entidade.
4. Detalhe da entidade: quem a usa e com que papel (`dispara`, `adiciona`, `remove`,
   `condicao`).

Esc volta uma tela; `q` sai.

## Direção visual: cinematográfica

Identidade própria, sem ligação com o "Sala de Controle" dos HTMLs: sala de comando de
ficção científica, fundo escuro, paleta âmbar, ciano e verde fósforo. A paleta exata sai do
mockup.

Quatro elementos, todos obrigatórios:

1. Abertura de impacto: entrada animada de 1 a 2 segundos (marca, varredura, contagem do
   dump carregado).
2. Transições animadas entre telas, e números que sobem até o valor.
3. Visual de sala de comando: bordas, cabeçalhos grandes, barra de status permanente.
4. Momentos dramáticos: achado ERROR com destaque pulsante; o diff se revela como linha do
   tempo.

Travas de uso diário: qualquer tecla pula a animação em andamento; `--sem-animacao`
desliga todas; terminal sem suporte a cor verdadeira cai para a paleta de 256 cores sem
quebrar a leitura. Animação nunca atrasa um dado: a tela já é navegável enquanto anima.

## Erros

Dump recusado pelo schema ou ilegível: aparece na tela de seleção como indisponível, com a
mensagem do `DumpError`; os outros seguem navegáveis. Subconta com um snapshot só: a aba
Diff diz que não há com o que comparar.

## Testes

`App.run_test()` (piloto do Textual) sobre dumps montados por `conftest.make_dump(...)`:
seleção abre a principal, cada aba renderiza, Enter num workflow abre o detalhe, Enter
numa tag abre a entidade. Os testes pulam (`importorskip`) sem o Textual instalado.
