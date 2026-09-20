# Workflows ao vivo no MCP — spec

Data: 2026-09-20
Estado: revisada pelo grill (fase 3 do spec-flow); pesquisa em
`docs/superpowers/research/2026-09-20-workflows-ao-vivo-research.md`

## Problema

O automaster audita automações a partir de um dump frio. Quando a auditoria aponta um
problema, ou quando alguém pergunta "por que esse lead não recebeu a mensagem", não há
nada a fazer pelo MCP: o estado corrente do workflow e de quem está dentro dele só existe
na interface do GHL.

Workflow é a única área central do produto que ainda não tem leitura ao vivo nem escrita.
Contato, conversa, oportunidade, agenda e formulário já têm.

## Escopo

Leitura ao vivo do estado corrente de workflows e das inscrições de contato, e quatro ações
de escrita: publicar/despublicar, inscrever contato, remover contato e retomar inscrição.

As duas entradas de leitura pesam igual. Por workflow: status (`published`, `draft`, `locked` ou `paused`),
quantos contatos estão dentro, e a lista deles com data de entrada e o passo corrente — que a
API expõe (A2). Por contato: em quais workflows ele está agora, com a mesma
informação por linha. É a mesma resposta vista de dois lados, montada pelo mesmo código
a partir da mesma carga.

Cada inscrição traz também **por que** o contato entrou (gatilho, ação em lote, inscrição
manual) e quando ele volta a andar, campos que a API devolve de graça (A2).

Nome e e-mail do contato não vêm com a inscrição. A flag `--nomes` resolve todos, uma
chamada por contato; sem ela, só o id. Em workflow com centenas de inscritos a diferença é
de um minuto de espera (A2).

### Teto e paginação

A lista de inscritos pagina por cursor, não por deslocamento — página encadeada à anterior,
diferente do `listWorkflows` que já existe (A11). Teto padrão de 500 inscritos, `--limite`
sobe. A resposta declara se cortou e quantos existem no total; o total sai de uma chamada
de contagem à parte.

A resposta da busca traz uma bandeira própria de estrangulamento por subconta
(`isLocationRateLimited`, A10), diferente do limite geral de requisições. Quando ela vier
ligada, a resposta diz isso — lista curta com a bandeira ligada não é lista curta, é lista
cortada pelo servidor.

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

As duas tools novas **não exigem dump** — funcionam em qualquer subconta logada (A15).
Rompem o padrão de `oportunidades` e `agenda`, que chamam o loader só para carimbar a idade
do snapshot; aqui não há nada do dump para usar, e exigir extração prévia seria cerimônia
vazia. A resposta não traz o bloco `_snapshot`.

A tool `workflow` existente, que lê o dump, tem só a descrição alterada, para dizer que o
que ela devolve vem do snapshot e pode estar velho (A16). Comportamento e saída não mudam.
Sem isso, `workflow` e `workflows_ao_vivo` devolvem ambas um campo `status` com semânticas
diferentes e nada no catálogo distingue as duas além do plural.

Decidido contra fundir as duas:
dump e estado ao vivo têm latência e modos de falha diferentes, e esconder isso atrás de
um parâmetro produz surpresa na hora errada.

## Escrita

Quatro ações em `workflow-acao`, todas atrás de `--confirmo` e todas com rastro em
`<dumps>/_workflows/<locationId>/<ts>.json`, como mensagem e oportunidade já fazem.

O rastro é agrupado por automação: `<dumps>/_workflows/<locationId>/<workflowId>/<ts>.json`
(A12). Abrir a pasta de um workflow mostra tudo que foi feito nele — publicações, quem
entrou, quem saiu. As três ações sempre têm workflow; nem todas têm contato.

`publicar` liga e desliga — é um campo de status, não duas rotas. Antes de despublicar,
conta quantos contatos estão dentro naquele momento e informa: eles **congelam no passo em
que estão e retomam quando o workflow for republicado** (A3). Não há perda, então basta o
`--confirmo` de sempre, sem guarda adicional.

O status tem quatro valores, não dois: além de `published` e `draft` existem `locked` e
`paused`, cujo significado a pesquisa não descobriu (A8). Decidido: `publicar` age sobre
qualquer um deles sem recusar. O status anterior fica no rastro, que já grava o antes.

`inscrever` coloca um contato num workflow. `remover` tira o contato daquele workflow —
pela rota por contato, não pela rota por inscrição (A5). `retomar` religa uma inscrição
parada; é o desfazer natural de `remover` e usa a rota irmã.

Contato inscrito duas vezes no mesmo workflow (o GHL permite, é a flag `allowMultiple`)
fica coberto pelo que a rota por contato fizer. O que ela faz nesse caso é pergunta da
prova ao vivo.

## Autoria da escrita (A4)

As três ações mandam ao servidor o id do usuário que as fez — é esse nome que aparece no
histórico do GHL para o cliente. O extractor hoje só captura os dois tokens.

O id sai do próprio token, pelo mesmo caminho que `decodeCompanyId` já usa
(`extractor/src/auth/token.ts:9`). A flag `--usuario <id>` sobrescreve.

Se o token não trouxer o campo e a flag não vier, a escrita **recusa** e pede a flag. Nada
é escrito sem autoria. O id está no `users.json` do dump.

## Erro

`401` recarrega a página e recaptura os dois tokens, como no resto do extractor.

Rota que não existir vira falha explícita nomeando a rota. Nunca lista vazia: foi a
armadilha da agenda, onde data em texto devolvia `200` com corpo vazio e a agenda sumia em
silêncio. Toda leitura que voltar sem linhas declara se veio vazia de verdade ou se a rota
recusou.

## Teste

Automatizado cobre o que é lógica nossa, nos dois lados, seguindo o precedente mais recente
(A14).

No extractor: montar a resposta pelos dois lados a partir da mesma carga, o corte do teto
de inscritos e a declaração de que cortou, a leitura do id do usuário no token, e a função
pura que monta a saída da escrita — extraída como `saidaPaletaGravar` foi, porque naquele
caso um campo sumiu em silêncio com a suíte inteira passando
(`extractor/src/forms/style.ts:151-156`).

No auditor: a recusa sem `confirmo`, provada com o invocador do extractor sabotado para
falhar se for chamado, e os argumentos montados por cada tool. Molde:
`auditor/tests/test_mcp_formularios_escrita.py`.

A guarda de `--confirmo` que mora inline no `cli.ts` não é testável em TypeScript hoje, e
nenhuma das existentes é testada lá — o teste dela fica no lado Python, como no precedente.

Rota de API não vira teste automatizado — vira prova ao vivo.

## Prova ao vivo

Na Instaltech (`Xb9gDxwxYhdqtprGcb5E`), serial, um comando por vez. O perfil persistente do
Chrome é único: dois comandos de escrita em paralelo disputam o `SingletonLock` e um deles
corrompe o resultado do outro. Isso já aconteceu uma vez, na validação de formulários.

Roteiro: workflow descartável (criado pela interface — não há rota de criação no escopo),
inscrever o contato de teste, ler dos dois lados, remover, retomar, despublicar, publicar
de novo, apagar. Sem resíduo.

**A inscrição é enfileirada, não imediata** (A6): a documentação oficial diz que o contato
entra numa fila. Ler logo depois de inscrever pode devolver lista vazia sem que nada tenha
falhado. O roteiro espera e repete a leitura; se continuar vazio depois da espera, isso é o
achado, não um erro a contornar.

Perguntas que só a prova ao vivo responde: o que a remoção por contato faz quando a pessoa
está inscrita duas vezes no mesmo workflow; e se remover dispara alguma automação de saída
— o GHL não tem gatilho de saída e o corpo da chamada só carrega metadado de auditoria, mas
não há declaração oficial (A20).

## Rotas

Todas na API interna, host `backend.leadconnectorhq.com`, achadas no bundle público do app
(A1). Decidido contra usar a API oficial nas duas operações em que ela existe: um esquema de
autenticação só, nada a configurar por subconta (A9).

Inscritos num workflow usa o prefixo **plural** `/workflows/`, diferente do `/workflow/`
singular que a extração já usa. As rotas exatas estão no dossiê de pesquisa e entram em
`docs/endpoints.md` depois da prova ao vivo.

Achado que não é desta fatia mas vale registrar: existe publicação em lote, e o GHL
reconhece "contato travado num passo" como categoria, com rota para desentupir (A17).

## Decisões do grill

- **A4** — as três escritas carimbam autoria. O id sai do token pelo caminho que
  `decodeCompanyId` já usa; `--usuario` sobrescreve; sem nenhum dos dois, recusa. Motivo:
  ação sem dono aparece no histórico do cliente.
- **A12** — rastro agrupado por workflow, não plano como a spec dizia. Motivo: as quatro
  ações sempre têm workflow, nem todas têm contato, e `registroEscrita` já tem esse nível.
- **A3** — guarda de despublicar reescrita: avisa que os contatos congelam e retomam na
  republicação, sem exigir flag extra. Motivo: o bundle tem o estado
  `paused_due_to_draft_mode`; não há perda, o risco é represa.
- **A5** — remover pela rota por contato, e `retomar` entra junto. Motivo: é a pergunta da
  vida real, e retomar é o desfazer natural, pela rota irmã.
- **A2** — nome do contato sob demanda, pela flag `--nomes`. Motivo: uma chamada por
  contato; em lista grande é um minuto de espera que nem sempre se quer pagar.
- **A11** — teto de 500 inscritos, ajustável, com declaração de corte. Motivo: paginação por
  cursor e automação com milhares dentro.
- **A8** — `publicar` age sobre `locked` e `paused` sem recusar. Motivo: decisão do usuário;
  o status anterior fica no rastro. Contra a recomendação de recusar o que não entendemos.
- **A16** — a descrição da tool `workflow` muda para dizer que vem do dump. Motivo: as duas
  tools devolvem `status` com sentidos diferentes e só o plural as distinguia.
- **A15** — as tools novas dispensam dump, rompendo o padrão das outras ao vivo. Motivo: não
  usam nada do snapshot; exigir extração prévia seria cerimônia vazia.
- **A14** — teste da recusa de confirmação fica no lado Python, e a saída da escrita vira
  função pura testada no extractor. Motivo: é o precedente, e a função pura existe
  justamente porque um campo já sumiu em silêncio.
- **A9** — tudo pela API interna. Motivo: evitar um segundo esquema de autenticação e uma
  credencial por subconta.
- **A6** — o roteiro ao vivo espera entre inscrever e conferir. Motivo: a inscrição é
  enfileirada.
- **A18** — descartado desta fatia: a técnica de achar o bundle mudou (o app agora carrega
  de um manifesto) e a nota em `docs/endpoints.md` está velha. Vira correção de documentação
  junto com a seção nova, não decisão de desenho.
- **A7, A10, A13, A19, A20** — não mudam o desenho; entraram como restrição de
  implementação nas seções acima.
