# Workflows ao vivo no MCP — spec

Data: 2026-09-20
Estado: aprovada em conversa, pendente de pesquisa (fase 2 do spec-flow)

## Problema

O automaster audita automações a partir de um dump frio. Quando a auditoria aponta um
problema, ou quando alguém pergunta "por que esse lead não recebeu a mensagem", não há
nada a fazer pelo MCP: o estado corrente do workflow e de quem está dentro dele só existe
na interface do GHL.

Workflow é a única área central do produto que ainda não tem leitura ao vivo nem escrita.
Contato, conversa, oportunidade, agenda e formulário já têm.

## Escopo

Leitura ao vivo do estado corrente de workflows e das inscrições de contato, e três ações
de escrita: publicar/despublicar, inscrever contato e remover contato.

As duas entradas de leitura pesam igual. Por workflow: status (`published`/`draft`),
quantos contatos estão dentro, e a lista deles com data de entrada e o passo corrente
quando a API expuser. Por contato: em quais workflows ele está agora, com a mesma
informação por linha. É a mesma resposta vista de dois lados, montada pelo mesmo código
a partir da mesma carga.

### Fora de escopo

Editar a estrutura do workflow (steps, triggers, ramificações), criar workflow, mexer em
pastas, qualquer ação em lote, e qualquer regra de auditoria nova sobre inscrição.

A estrutura fica de fora por decisão: o editor do GHL é um grafo grande e escrever nele
às cegas quebra a operação inteira de um cliente.

## Arquitetura

Módulo novo `extractor/src/api/workflows-live.ts`, ao lado de `workflows.ts` — que segue
servindo só à extração e não muda.

Dois comandos de CLI, `npm run workflows-ao-vivo` (leitura) e `npm run workflow-acao`
(escrita), no `cli.ts` existente.

Duas tools MCP novas, `workflows_ao_vivo` e `workflow_acao`, 29 no total. Elas não leem o
dump e não passam pelo loader — o padrão já estabelecido por `oportunidades`, `agenda` e
`formularios`.

A tool `workflow` existente, que lê o dump, fica intocada. Decidido contra fundir as duas:
dump e estado ao vivo têm latência e modos de falha diferentes, e esconder isso atrás de
um parâmetro produz surpresa na hora errada.

## Escrita

Três ações em `workflow-acao`, todas atrás de `--confirmo` e todas com rastro em
`<dumps>/_workflows/<locationId>/<ts>.json`, como mensagem e oportunidade já fazem.

`publicar` liga e desliga — é um campo de status, não duas rotas. Antes de despublicar,
conta quantos contatos estão dentro naquele momento e informa. Desligar com gente no meio
do fluxo é o erro caro desta área.

`inscrever` coloca um contato num workflow. `remover` tira.

## Erro

`401` recarrega a página e recaptura os dois tokens, como no resto do extractor.

Rota que não existir vira falha explícita nomeando a rota. Nunca lista vazia: foi a
armadilha da agenda, onde data em texto devolvia `200` com corpo vazio e a agenda sumia em
silêncio. Toda leitura que voltar sem linhas declara se veio vazia de verdade ou se a rota
recusou.

## Teste

Automatizado cobre o que é lógica nossa: montar a resposta pelos dois lados a partir da
mesma carga, a guarda de contagem antes de despublicar, e a recusa sem `--confirmo`.

Rota de API não vira teste automatizado — vira prova ao vivo.

## Prova ao vivo

Na Instaltech (`Xb9gDxwxYhdqtprGcb5E`), serial, um comando por vez. O perfil persistente do
Chrome é único: dois comandos de escrita em paralelo disputam o `SingletonLock` e um deles
corrompe o resultado do outro. Isso já aconteceu uma vez, na validação de formulários.

Roteiro: workflow descartável (criado pela interface, se não houver rota de criação),
inscrever o contato de teste, ler dos dois lados, remover, despublicar, apagar. Sem
resíduo.

Se a rota de inscrição não existir, a spec registra isso em vez de contornar.

## Aberto até a pesquisa

Se existe rota de inscrição manual de contato em workflow na API interna.

Se o passo corrente do contato vem junto da inscrição. Decidido: se não vier, a fatia ainda
vale — quem está dentro, desde quando e com que status já responde a maior parte das
perguntas. Deduzir o passo cruzando com o `timeline` foi recusado: é dedução que erra.
