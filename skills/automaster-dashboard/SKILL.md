---
name: automaster-dashboard
description: Monta o painel (dashboard) de uma subconta do GoHighLevel a partir do que a subconta tem e do que o dono quer saber, com dois loops de validação antes de publicar. Use ao montar ou refazer um painel do GHL, ou quando o pedido for "um painel de vendas", "quero ver quantos faltaram" ou qualquer visão de números do negócio dentro do GHL.
---

# Painel do GHL, do pedido à publicação

Não existe modelo fixo. O método: ler a subconta, entrevistar, mostrar o plano, montar
privado, conferir o visual, conferir os números, publicar. As tools fazem a escrita
(`dashboards`, `dashboard_acao`, `dashboard_ver`, `dashboard_conferir`); esta skill decide
o que escrever.

## 1. Leitura da subconta

Antes de perguntar qualquer coisa, leia o que existe. O que a subconta tem vira opção na
entrevista; o que não tem não é oferecido.

- `pipeline` e `oportunidades -o pipelines`: funis e estágios.
- `agenda`: calendários e profissionais.
- `config`: canais ativos, IA, SLA das conversas.
- `dashboards -o catalogo`: widgets que o GHL oferece e painéis que já existem (o existente é
  só lido, nunca regravado).
- Usuários e fontes de lead das oportunidades, para filtros e legendas.

Exemplo (clínica Sorriso Pleno): 2 funis ("Avaliação → Tratamento" e "Retorno"), 3
calendários (Avaliação, Limpeza, Retorno) com 3 profissionais, WhatsApp, Instagram e
formulário do site, 5 fontes de lead, conta Meta ligada.

## 2. Entrevista

Use `AskUserQuestion`, uma pergunta por vez, com opções tiradas da leitura. Cinco perguntas:

1. Quem vai olhar (dono, recepção, gerente comercial).
2. Quando e onde (todo dia no celular, toda semana no computador).
3. Que perguntas o painel responde (múltipla escolha, sugeridas pelo que a subconta tem).
4. Qual é a principal (ela vai para o topo à esquerda).
5. Período padrão e comparação (últimos 30 dias contra os 30 anteriores, este mês, esta semana).

Cores da marca: pergunte o hex ou leia do site do cliente. Sem marca, use a paleta padrão.

## 3. Plano do painel

Mostre a tabela antes de gravar: pergunta, tipo de pergunta, widget, módulo e filtro, data,
posição na grade (x, y, largura, altura). Só grave depois do aval.

Mapa do tipo de pergunta para o widget:

- quanto: número
- como evolui: linha
- quem é maior: barra horizontal (top N)
- parte de um todo: donut até 5 fatias; com mais de 5 fatias, barra
- em que etapa: funil
- quais são: tabela

Regras de composição:

- No máximo 4 números no topo; tendência é o maior bloco; no máximo 8 blocos.
- Widget de oportunidade usa data de criação por padrão. Outra data só quando a pergunta
  exige, e o título diz qual.
- O título diz a pergunta e o período ("Quem faltou nos últimos 30 dias"), não o nome técnico.
- A principal fica em cima à esquerda; a ordem da entrevista vira a posição.
- Altura proporcional ao conteúdo: número baixo, gráfico médio, tabela alta. Grade sem buraco.
- Cores da marca pelo tema do painel, com contraste conferido.

Exemplo trabalhado, clínica Sorriso Pleno (a principal é "quem faltou"):

| Pergunta | Tipo | Widget | Módulo e filtro | Data | Grade (x,y,l,a) |
|---|---|---|---|---|---|
| Quem faltou? | quanto | número: Faltas | agenda, status = faltou | data da consulta | 0,1,3,4 |
| Quem faltou? | quanto | número: Comparecimento | agenda, compareceu ÷ (compareceu + faltou) | data da consulta | 3,1,3,4 |
| Quantas consultas marquei? | quanto | número: Consultas marcadas | agenda, todos os calendários | data da consulta | 6,1,3,4 |
| Orçamento vira tratamento? | quanto | número: Tratamentos fechados | oportunidades, funil Avaliação, ganho | criação | 9,1,3,4 |
| Quantas consultas marquei? | como evolui | linha: marcadas × comparecidas por semana | agenda | data da consulta | 0,6,8,7 |
| Quem faltou? | parte de um todo (4) | donut: status das consultas | agenda | data da consulta | 8,6,4,7 |
| Orçamento vira tratamento? | em que etapa | funil: Avaliação → Tratamento | oportunidades, funil Avaliação | criação | 0,14,7,7 |
| De onde vêm os pacientes? | quem é maior (5) | barra: pacientes por origem | contatos, origem | criação | 7,14,5,7 |
| Quem faltou? | quais são | tabela: faltas da semana | agenda, faltou, 7 dias | data da consulta | 0,21,12,6 |

## 4. Montagem

Tudo com `dashboard_acao`, e o painel nasce privado:

1. `criar`: painel vazio, privado, com título que diz o propósito.
2. `editar`: layout e widgets do plano. Widget novo copia o molde do mesmo tipo. Sobreposição
   ou widget fora da grade é recusado antes do request.
3. `tema`: cores da marca (`titleColor`, `backgroundColor`, `baseColor`, `metricColor`,
   `linkColor`).

Sem `confirmo`, cada ação devolve só a prévia.

## 5. Loop visual

Chame `dashboard_ver`, leia o PNG e passe o checklist. Falhou, corrija por `dashboard_acao`
e rode de novo, em até 3 voltas; passou disso, entregue e diga o que não fechou.

- [ ] Nenhum widget vazio ou com "sem dados" onde deveria haver dado
- [ ] Nenhum título ou número cortado
- [ ] Números do topo alinhados na mesma linha
- [ ] No máximo 4 números no topo
- [ ] A tendência é o maior bloco
- [ ] Contraste de texto de pelo menos 4.5:1 sobre o fundo
- [ ] Séries distinguíveis entre si, sem depender só de cor
- [ ] Sem rolagem interna em widget e sem rolagem lateral
- [ ] Hierarquia: a pergunta principal no topo à esquerda
- [ ] No máximo 8 blocos
- [ ] Espaçamento uniforme, widgets alinhados na grade, sem buraco

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
