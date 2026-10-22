---
name: automaster-documentar
description: Audita as automações de uma subconta do GoHighLevel e escreve o manual do cliente no padrão ZOI, só lendo a subconta. Duas entregas, na ordem — o relatório interno com problemas, riscos e plano de correção, e depois das correções o manual em PDF que explica em linguagem de cliente o que as automações fazem. Use ao auditar as automações de um cliente, ao preparar uma reestruturação, ao montar o manual das automações para entregar ao cliente, ou quando o pedido for "documenta as automações", "faz o manual do cliente" ou "o que está quebrado nessa conta".
---

# Auditoria e manual do cliente

O processo que a ZOI fez numa concessionária, transformado em passo a passo: ler a subconta
inteira, entregar um relatório interno que só propõe, deixar o Luccas corrigir item a item fora
da skill e, sobre o que ficou publicado, escrever o manual que o cliente lê. A skill não grava
nada no GHL. O método de cada parte está num arquivo próprio: `auditoria.md` e `manual.md`.

## 1. Quando usar

- **Parte 1 sozinha:** cliente novo na ZOI, reclamação de lead perdido ou mensagem errada, antes
  de reestruturar as automações.
- **Parte 2 sozinha:** depois das correções, ou quando o cliente pede para entender o que roda.
  O manual descreve o estado publicado no dia em que é escrito.
- **As duas, nesta ordem:** auditoria, correção feita pelo Luccas a partir do relatório, manual.
  Nunca o manual antes da auditoria numa conta que nunca foi auditada: ele descreveria defeito
  como se fosse desenho.
- **Fora da skill:** corrigir automação, relatório interno em PDF, enviar o manual ao cliente.

Precisa do `locationId`. Sem ele, chame `dumps()` e pergunte qual subconta.

## 2. Regras comuns

Valem para as duas partes.

- **Só leitura no GHL.** Nenhuma tool que escreve é chamada, nem para "testar rapidinho". O que
  precisa de conserto vira item do relatório. A tool `pipeline` escreve: o funil se lê pela
  `oportunidades` (`o=pipelines`). A `config` só nos modos de leitura (`ia`, `sla`).
- **Extrair de novo antes de ler.** Rode `/automaster-extract <locationId>` e confira com
  `dumps()` que o snapshot mais recente é desta hora. Dump antigo não descreve o que está no ar.
  Se a extração pedir login, pare e peça o login, como nas outras skills do automaster.
- **O que muda a toda hora é lido ao vivo.** Status corrente e quem está dentro de cada workflow:
  `workflows_ao_vivo` (`o=lista`, `o=dentro`). Entrega das mensagens: `conversas`. Funil:
  `oportunidades`. Agenda: `agenda`. Formulários: `formularios`. Texto dos modelos de WhatsApp:
  `whatsapp` (`o=templates`). Tarefas: `anotacoes` (`o=buscar`, `tipo=tarefa`). `workflow`,
  `inventario`, `achados` e `buscar` são do dump: servem para o desenho, não para o estado.
- **Conferir se o canal entrega antes de opinar sobre fluxo de mensagem.** Pegue de 5 a 10
  contatos que passaram pelos workflows de mensagem (`workflows_ao_vivo` `o=dentro`), leia as
  últimas mensagens de cada um pela `conversas` e olhe `origem`, `status` e `erro`. Mensagem com
  `origem: workflow` em `failed`, ou parada em `pending`/`sent` há horas, é canal que não entrega:
  vira urgente no relatório e aviso curto no manual, e ninguém ajusta texto ou espera até o canal
  voltar. Numa subconta de concessionária, uma tarde inteira de ajustes foi feita numa linha que
  não enviava nada.
- **Leitura estrangulada não é resposta.** `estrangulado: true` na `workflows_ao_vivo` quer dizer
  que o servidor cortou a busca: repita depois. Nunca conclua "ninguém dentro" com ele.
- **Número e texto só de leitura desta rodada.** Tudo o que vai para o relatório ou o manual
  (contagem, nome de etapa, texto de modelo, horário) vem de uma chamada feita nesta rodada, com
  a fonte anotada (dump de DD/MM HH:MM, ao vivo em DD/MM). Nada de memória, relatório anterior
  ou print do cliente.
- A leitura de cada resposta segue a skill `automaster-leitura` (o que é ruído, o que é erro).

## 3. Parte 1: auditoria

Siga `auditoria.md`. Em resumo:

1. Extrair, rodar `/automaster-audit` e ler `inventario` e `achados` por severidade.
2. Gerar a ficha de todos os workflows publicados com o comando `ficha` do auditor e ler cada
   uma: configurações, gatilhos com filtros, passos na ordem.
3. Ler ao vivo: quem está dentro de cada workflow, rascunhos com inscritos congelados, funil por
   etapa, agendas, formulários com submissões, entrega do canal, modelos de mensagem, usuários e
   rodízios.
4. Passar a lista de verificação de `auditoria.md`, item por item, com evidência.
5. Escrever o relatório no modelo de `auditoria.md` e salvar em
   `docs/<cliente>-auditoria-AAAA-MM-DD.md`.

O relatório só propõe. Item "sem uso" entra como pergunta, e regra por aproximação também.

## 4. Parte 2: manual do cliente

Siga `manual.md`. Em resumo:

1. Extrair de novo (o estado mudou com as correções) e ler ao vivo os publicados, os modelos de
   WhatsApp pela `whatsapp` (`o=templates`), as etapas do funil, as agendas e os usuários.
2. Copiar o `manual/modelo.html` desta skill para `docs/<cliente>-manual-automacoes.html` e
   escrever as seções na estrutura de `manual.md`, com as peças visuais do modelo.
3. Gerar o PDF com o comando `manual-pdf` do extractor e corrigir o que ele acusar em
   `secoesEstouradas` e `termosInternos`.
4. Conferir o PDF página a página, lendo cada página como imagem, antes de entregar.

## 5. Exemplo trabalhado: Ribeira Seminovos

Revenda de seminovos inventada. A subconta tem 22 workflows (15 publicados, 7 em rascunho), dois
funis ("Vendas" com 6 etapas e "Financiamento" com 4), WhatsApp de atendimento, uma agenda de
visitas e o formulário do site.

**Parte 1.** Extração das 09:10. `achados`: 1 ERROR (`exposed_secret`, chave escrita num custom
value), 4 WARN, 3 INFO. Canal: 8 contatos do "Boas-vindas WhatsApp" com mensagens `read` e
`delivered`, nenhum `erro`, então o fluxo pode ser avaliado. Achados que entram no relatório:

- `create_opportunity_without_lookup` no "Lead do site": ao vivo, 31 dos 220 contatos com card
  aberto têm dois cards no funil Vendas. Urgente.
- `loss_keeps_cadence` (por aproximação): a `conversas` de 3 cards perdidos mostra a mensagem do
  dia 3 do follow-up chegando depois da perda. Confirmado, sai de pergunta e vira diagnóstico.
- "Simulação de financiamento" em rascunho com 46 inscritos congelados na espera de 2 dias:
  se for republicado, os 46 recebem a mensagem de uma vez. Pergunta: republicar ou limpar?
- Formulário "Avaliação de troca" sem submissão em 30 dias e sem gatilho: entra como pergunta.

Relatório em `docs/ribeira-auditoria-2026-10-22.md`, com a ordem em três semanas.

**Parte 2**, depois das correções. Modelos pela `whatsapp` (`o=templates`): 5 aprovados, texto
copiado inteiro para os balões. Manual com abertura, caminho do cliente, WhatsApp, funil e
follow-up, visitas, o que fica com a equipe, organização e perguntas rápidas. Primeira geração:
11 páginas, `secoesEstouradas` com "Funil e follow-up" (dividida em duas folhas, cadência numa e
perda na outra) e `termosInternos` com "tag" na folha da equipe (reescrito como "etiqueta").
Segunda geração limpa, 12 páginas, conferidas uma a uma.

## 6. Entrega

Tudo sai em `docs/` da pasta onde a skill roda (crie a pasta se não existir), com o nome curto
do cliente em minúsculas, sem acento:

- Parte 1: `docs/<cliente>-auditoria-AAAA-MM-DD.md`.
- Parte 2: `docs/<cliente>-manual-automacoes.html` e `docs/<cliente>-manual-automacoes.pdf`.

A resposta final ao usuário diz o caminho de cada arquivo, os urgentes em uma linha cada, as
perguntas que ficaram para o Luccas e o que não deu para conferir nesta rodada (leitura
estrangulada, modelo sem texto, canal sem amostra). O manual não é enviado ao cliente pela skill.
