---
name: automaster-dashboard
description: Monta o painel (dashboard) de uma subconta do GoHighLevel a partir do que a subconta tem e do que o dono quer saber, com dois loops de validação antes de publicar. Use ao montar ou refazer um painel do GHL, ou quando o pedido for "um painel de vendas", "quero ver quantos faltaram" ou qualquer visão de números do negócio dentro do GHL.
---

# Painel do GHL, do pedido à publicação

Não existe modelo fixo. O método: ler a subconta a fundo, entrevistar, mostrar o plano, montar
privado, conferir o visual, conferir os números, publicar. As tools fazem a escrita
(`dashboards`, `dashboard_acao`, `dashboard_ver`, `dashboard_conferir`); esta skill decide
o que escrever. O resultado é um painel completo e com cara profissional, nunca um punhado de
quadros soltos.

## 1. Leitura da subconta

Antes de perguntar qualquer coisa, leia tudo o que a subconta opera. O que ela tem vira
pergunta e widget; o que não tem não é oferecido.

- Funis e estágios: `pipeline` e `oportunidades -o pipelines`, com quantos cards há em cada
  estágio e quais funis estão parados.
- Calendários: `agenda`, com os profissionais de cada um e o volume de compromissos.
- Workflows: `inventario` e `workflow`, os gatilhos de cada um e o que disparam (tag, mudança de
  estágio, mensagem, agendamento). Mostram o que o negócio considera evento importante.
- Formulários e surveys: `formularios`, com as submissões recentes (de onde vem o lead).
- Canais de conversa em uso: `config` e `conversas` (WhatsApp, Instagram, SMS, e-mail, ligação).
- Campos personalizados de valor: `inventario` (valor do contrato, ticket, procedimento), que
  viram soma ou média.
- Usuários: quem atende, quem vende, quem é dono de card e de agenda.
- Anúncios conectados: módulos de anúncio do Meta no catálogo (`dashboards -o catalogo`).
- Painéis que já existem e o catálogo de widgets: `dashboards` e `dashboards -o catalogo` (o
  existente é só lido, nunca regravado).

Feche a leitura com um retrato escrito do que o cliente opera, em poucas linhas: de onde vem o
lead, por onde ele conversa, como é atendido, como vira venda e quem faz cada parte. A
entrevista parte desse retrato.

Exemplo (clínica Sorriso Pleno): 2 funis ("Avaliação → Tratamento" com 6 estágios e
"Retorno"), 3 calendários (Avaliação, Limpeza, Retorno) com 3 profissionais, 14 workflows
(confirmação de consulta, recuperação de falta, pós-tratamento), formulário do site e 1 survey
de satisfação, WhatsApp e Instagram em uso, campo "valor do tratamento", 4 usuários, conta Meta
ligada. Retrato: o lead chega por anúncio e formulário, conversa no WhatsApp, marca avaliação,
recebe orçamento e fecha tratamento; a recepção cuida da agenda e duas dentistas fecham.

## 2. Entrevista

É um grill: entreviste sem pressa até o painel estar decidido de ponta a ponta. Use
`AskUserQuestion`, uma pergunta por vez. Cada pergunta cita o que a leitura achou ("vi 2 funis,
o Avaliação tem 6 estágios e 40 cards parados em Orçamento enviado; esse gargalo entra?") e
traz a opção recomendada primeiro, com o motivo.

- Siga cada resposta até fechar o ramo antes de abrir outro: se o dono quer "vendas", pergunte
  qual funil, qual estágio conta como venda, por valor ou por quantidade, e por qual data.
- O que a leitura já responde não vira pergunta: confira na subconta e só confirme.
- Ramos a fechar, nesta ordem: quem olha o painel; o que ele decide com ele; a pergunta
  principal (vai para o topo); as atividades que a leitura achou (funil, agenda, origem,
  vendedores, conversas, formulários, anúncios), uma por uma, entra ou não e com qual corte;
  período padrão e comparação (últimos 30 dias contra os 30 anteriores, este mês, esta semana);
  cor da marca (o hex, ou leia do site do cliente).
- Não pergunte o dispositivo: o painel é sempre para computador.
- Termine com um resumo das decisões e peça o aval antes do plano.

## 3. Plano do painel

Mostre a tabela antes de gravar: seção, pergunta, tipo de pergunta, widget, módulo e filtro,
data, posição na grade (x, y, w, h). Só grave depois do aval.

Mapa do tipo de pergunta para o widget:

- quanto: número
- como evolui: linha (tendência)
- quem é maior: barra horizontal (ranking, top N)
- parte de um todo: donut até 5 fatias; com mais de 5 fatias, barra
- em que etapa: funil
- quais são: tabela

Regras de composição:

- Painel completo: pelo menos 12 widgets, cobrindo cada atividade que a leitura achou, com
  mistura de número, tendência, funil, tabela e ranking. Seis quadros não são um painel.
- No máximo 4 números no topo; números do topo baixos, altura 3, no máximo 4.
- Widget de oportunidade usa data de criação por padrão. Outra data só quando a pergunta
  exige, e o título diz qual.
- O título diz a pergunta e o período ("Quem faltou nos últimos 30 dias"), não o nome técnico.
- A principal fica em cima à esquerda; a ordem da entrevista vira a posição.
- Altura proporcional ao conteúdo: número baixo, gráfico médio, tabela alta. Grade sem buraco.
- Tema: o painel nasce com fundo branco (`backgroundColor` `#FFFFFF`), títulos escuros e a cor da
  marca nos números, linhas e barras, com contraste conferido.

Cara profissional:

- Cabeçalho: o painel abre com o título do painel e o período, num `object-title` de largura 12.
- Seções por tema (Resumo, Evolução, Funil e origem, Agenda, Equipe, Detalhe), cada uma aberta
  por um título de seção. Os objetos de layout do GHL têm `chartType` `objectWidget`:
  `object-title`, `object-textbox`, `object-image` e `object-embed`. Não há divisor próprio: o
  `object-title` de largura 12 e altura 1 é o separador entre seções.
- Grade alinhada, com larguras repetidas por linha: 4 de 3, 2 de 6, 8 + 4, ou 12.
- Hierarquia: resumo no topo, detalhe embaixo; dentro da seção, o bloco mais importante à esquerda.

Molde de layout profissional (x, y, w, h; ajuste as seções ao que a entrevista decidiu):

| Bloco | Widget | Grade |
|---|---|---|
| Cabeçalho: título do painel e período | `object-title` | x 0, y 0, w 12, h 1 |
| Título de seção: Resumo | `object-title` | x 0, y 1, w 12, h 1 |
| 4 números do topo | número | x 0, 3, 6 e 9, y 2, w 3, h 3 |
| Título de seção: Evolução | `object-title` | x 0, y 5, w 12, h 1 |
| Tendência principal | linha | x 0, y 6, w 8, h 7 |
| Parte de um todo | donut | x 8, y 6, w 4, h 7 |
| Título de seção: Funil e origem | `object-title` | x 0, y 13, w 12, h 1 |
| Em que etapa | funil | x 0, y 14, w 6, h 7 |
| De onde vem | barra (ranking) | x 6, y 14, w 6, h 7 |
| Título de seção: Agenda | `object-title` | x 0, y 21, w 12, h 1 |
| Marcados por semana | linha | x 0, y 22, w 6, h 7 |
| Status dos compromissos | donut | x 6, y 22, w 6, h 7 |
| Título de seção: Equipe | `object-title` | x 0, y 29, w 12, h 1 |
| Quem vende mais | barra (ranking) | x 0, y 30, w 6, h 7 |
| Quem atende mais | barra (ranking) | x 6, y 30, w 6, h 7 |
| Título de seção: Detalhe | `object-title` | x 0, y 37, w 12, h 1 |
| Quais são | tabela | x 0, y 38, w 12, h 6 |

Exemplo trabalhado, clínica Sorriso Pleno (a principal é "quem faltou"; período: últimos 30
dias contra os 30 anteriores):

| Seção | Pergunta | Tipo | Widget | Módulo e filtro | Data | Grade (x,y,w,h) |
|---|---|---|---|---|---|---|
| Cabeçalho | — | — | título: "Clínica Sorriso Pleno · últimos 30 dias" | `object-title` | — | 0,0,12,1 |
| Resumo | — | — | título de seção: Resumo | `object-title` | — | 0,1,12,1 |
| Resumo | Quem faltou? | quanto | número: Faltas | agenda, status = faltou | data da consulta | 0,2,3,3 |
| Resumo | Quem faltou? | quanto | número: Comparecimento | agenda, compareceu ÷ (compareceu + faltou) | data da consulta | 3,2,3,3 |
| Resumo | Quantas consultas marquei? | quanto | número: Consultas marcadas | agenda, todos os calendários | data da consulta | 6,2,3,3 |
| Resumo | Orçamento vira tratamento? | quanto | número: Tratamentos fechados | oportunidades, funil Avaliação, ganho | criação | 9,2,3,3 |
| Evolução | — | — | título de seção: Evolução | `object-title` | — | 0,5,12,1 |
| Evolução | Quantas consultas marquei? | como evolui | linha: marcadas × comparecidas por semana | agenda | data da consulta | 0,6,8,7 |
| Evolução | Quem faltou? | parte de um todo (4) | donut: status das consultas | agenda | data da consulta | 8,6,4,7 |
| Funil e origem | — | — | título de seção: Funil e origem | `object-title` | — | 0,13,12,1 |
| Funil e origem | Orçamento vira tratamento? | em que etapa | funil: Avaliação → Tratamento | oportunidades, funil Avaliação | criação | 0,14,6,7 |
| Funil e origem | De onde vêm os pacientes? | quem é maior (5) | barra: pacientes por origem | contatos, origem | criação | 6,14,6,7 |
| Agenda e conversas | — | — | título de seção: Agenda e conversas | `object-title` | — | 0,21,12,1 |
| Agenda e conversas | Qual calendário enche mais? | quem é maior (3) | barra: consultas por calendário | agenda | data da consulta | 0,22,6,7 |
| Agenda e conversas | Por onde conversam? | parte de um todo (3) | donut: conversas por canal | conversas | criação | 6,22,6,7 |
| Equipe | — | — | título de seção: Equipe | `object-title` | — | 0,29,12,1 |
| Equipe | Quem fecha mais? | quem é maior (2) | barra: tratamentos por dentista | oportunidades, ganho, por dono | criação | 0,30,6,7 |
| Equipe | Quanto vale cada fechamento? | quanto | linha: valor do tratamento por semana | oportunidades, soma do valor | criação | 6,30,6,7 |
| Detalhe | — | — | título de seção: Detalhe | `object-title` | — | 0,37,12,1 |
| Detalhe | Quem faltou? | quais são | tabela: faltas da semana | agenda, faltou, 7 dias | data da consulta | 0,38,12,6 |

São 13 widgets de dado em 6 seções, mais o cabeçalho. Tema: fundo `#FFFFFF`, títulos
`#101828`, a cor da marca da clínica nos números, linhas e barras.

## 4. Montagem

Tudo com `dashboard_acao`, e o painel nasce privado:

1. `criar`: painel vazio, privado, com título que diz o propósito. Já nasce com o tema branco
   (fundo `#FFFFFF`, títulos escuros, verde `#1F7A3A` nos números, linhas e barras); na CLI,
   `--cor-marca #RRGGBB` troca o verde pela cor da marca.
2. `editar`: layout e widgets do plano. Widget novo copia o molde do mesmo tipo, inclusive os
   títulos de seção (`object-title` do catálogo). Sobreposição ou widget fora da grade é recusado
   antes do request; os avisos de composição (painel simplório, número alto demais, sem seções)
   voltam na prévia.
3. `tema`: só se a cor da marca não entrou no `criar` (`metricColor`, `baseColor`, `linkColor`);
   troca só o que vier.

Sem `confirmo`, cada ação devolve só a prévia.

## 5. Loop visual

Chame `dashboard_ver`, leia o PNG e passe o checklist. Falhou, corrija por `dashboard_acao`
e rode de novo, em até 3 voltas; passou disso, entregue e diga o que não fechou.

- [ ] Nenhum widget vazio ou com "sem dados" onde deveria haver dado
- [ ] Nenhum título ou número cortado
- [ ] Números do topo alinhados na mesma linha
- [ ] No máximo 4 números no topo, baixos (altura 3, no máximo 4)
- [ ] A tendência é o maior bloco da sua seção
- [ ] Contraste de texto de pelo menos 4.5:1 sobre o fundo branco
- [ ] Séries distinguíveis entre si, sem depender só de cor
- [ ] Sem rolagem interna em widget e sem rolagem lateral
- [ ] A pergunta principal no topo à esquerda
- [ ] Pelo menos 12 widgets, cobrindo cada atividade que a leitura achou
- [ ] Espaçamento uniforme, widgets alinhados na grade, sem buraco
- [ ] Cabeçalho no topo com o título do painel e o período
- [ ] Cada seção abre com um título de seção (`object-title` de largura 12)
- [ ] Grade alinhada, com larguras repetidas por linha
- [ ] Hierarquia clara: resumo no topo, detalhe embaixo

## 6. Loop de dados

Chame `dashboard_conferir`. Para cada widget ele compara o número do GHL com o recalculado
pela fonte, e devolve `bate`, `diverge` (com os dois números) ou `sem_conferencia`.

- `diverge` quase sempre é filtro errado: período, funil, usuário, fuso ou a data usada.
  Corrija o filtro do widget e confira de novo; nunca ajuste o número para bater.
- A conferência reproduz a data que o widget tem, não a padrão.
- `sem_conferencia` entra no relatório final; não é aprovação.
- Repita até não sobrar `diverge` sem causa explicada.

## 7. Publicação

Só com os dois loops limpos. Painel privado vira acessível por `dashboard_acao publicar`,
com `confirmo` e depois do aval de quem pediu. Para editar um painel já publicado: duplique
privado, valide nos dois loops e só então troque, também com `confirmo`.

## 8. Escada

Nesta ordem, sobe só quando o degrau anterior não atende:

1. Widget nativo do GHL.
2. Métrica personalizada (estatística personalizada).
3. Página externa (Embed) com HTML próprio: o GHL não aceita HTML no painel, então isso é
   outro projeto.

Pedido que só o degrau 3 atende é atendido até o degrau 2, e o resultado diz o que ficou de fora e por quê. Nunca entregue um número aproximado como se fosse o pedido.
