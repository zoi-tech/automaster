# Parte 1: auditoria das automações

A auditoria lê a subconta inteira e entrega um relatório interno em markdown: problemas,
riscos e um plano de correção em ordem. Só propõe. Nenhuma tool que escreve é chamada, e cada
número do relatório vem de uma leitura desta rodada (regras comuns do `SKILL.md`).

Saída: `docs/<cliente>-auditoria-AAAA-MM-DD.md`, na pasta onde a skill roda.

## 1. Método de leitura

Nesta ordem. Anote a fonte de cada número enquanto lê: é ela que vai para o cabeçalho do
relatório.

**1.1 Extrair.** `/automaster-extract <locationId>`, depois `dumps()`: o snapshot mais recente
tem que ser desta hora. Guarde a pasta: `D=~/.automaster/dumps/<locationId>/<snapshot>`.

**1.2 Inventário e achados por severidade.**

- `inventario` (resumo): quantos workflows, publicados e em rascunho, funis, usuários, agendas.
- `inventario` com `fatia=workflows`: nome, status e pasta de cada um. É a lista que a ficha e a
  leitura ao vivo vão percorrer.
- `achados` com `severidade=ERROR`, depois `WARN`, depois `INFO`. Cada grupo traz `rule`,
  workflow, detalhe e `n`. ERROR é defeito; WARN é defeito provável; INFO é revisão.
- `/automaster-audit <locationId>` grava o `report.md` na pasta do dump, com as 29 regras: é a
  lista completa para consultar enquanto escreve.

**1.3 Ficha de todos os publicados.** O comando `ficha` do auditor escreve, para cada workflow,
status, pasta, configurações (reentrada, parar quando responder, várias oportunidades),
gatilhos com todos os filtros e os passos na ordem, com o texto das mensagens, as esperas, as
condições dos ramos e para onde cada ramo vai.

```bash
PY="${CLAUDE_PLUGIN_ROOT}/bin/automaster-python.sh"; export PYTHONPATH="${CLAUDE_PLUGIN_ROOT}/auditor/src"
D=~/.automaster/dumps/<locationId>/<snapshot>
"$PY" -m automaster_audit.cli ficha "$D" -o "$D/fichas.md"     # todas, num arquivo
"$PY" -m automaster_audit.cli ficha "$D" --workflow <id>       # uma só, na tela
```

A ficha fica na pasta do dump, não em `docs/`: ela tem ids. Leia a de cada publicado e anote,
por workflow: o que dispara (e se o filtro de funil, formulário ou etiqueta está lá), o que ele
manda e para quem, quanto espera, o que tira o contato dele, quem ele chama ou de quem é chamado.
É a ficha que responde os itens da lista de verificação que nenhuma regra cobre. Para os
caminhos e os achados de um workflow só, use a tool `workflow` com o `id`.

**1.4 Ao vivo.**

- **Status corrente:** `workflows_ao_vivo` (`o=lista`). Status diferente do dump quer dizer que
  alguém mexeu depois da extração: extraia de novo.
- **Quem está dentro e há quanto tempo:** `workflows_ao_vivo` (`o=dentro`, `id=<workflow>`) em
  cada publicado com espera ou cadência. Olhe `dentro_agora`, o passo em que cada um parou e
  desde quando. Gente parada há semanas num passo de espera curta é espera que não anda.
  `inscricoes` traz também quem já terminou: as entradas dos últimos 30 dias são o número de
  execuções do relatório. Com `cortou: true`, suba o `limite`; com `estrangulado: true`, repita
  depois.
- **Rascunhos com inscritos congelados:** o mesmo `o=dentro` em cada rascunho. Quem estava
  dentro quando o workflow saiu do ar fica congelado no passo e volta a andar, todos de uma vez,
  se ele for republicado. Conte e registre como pergunta: republicar, limpar ou deixar.
- **Funil com volume por etapa:** `oportunidades` (`o=pipelines`) para funis e etapas;
  `oportunidades` (`o=listar`, `pipeline=<id>`, `estagio=<id>`, `status=open`) para contar os
  cards de cada etapa; `status=won`, `lost` e `abandoned` para os totais. Etapa do meio vazia,
  abandonados aos milhares ou contato com mais de um card aberto (`contato=<id>`) são sinais.
- **Agendas:** `agenda` (`o=calendarios`) para as agendas e quem atende; `agenda` (`o=eventos`,
  `calendario=<id>`, `inicio`, `fim` dos últimos 30 dias) para volume e status dos compromissos.
  Cruze com as fichas: cada agenda tem lembrete? O lembrete chega antes do horário?
- **Formulários com submissões:** `formularios` (`o=lista`, e `tipo=survey` para as surveys);
  `formularios` (`o=submissoes`, `formulario=<id>`, `inicio`, `fim`) para os últimos 30 dias.
  Formulário que recebe e nenhum gatilho escuta é lead sem aviso. Lembre do `fb-<locationId>`:
  é o lead gen do Facebook, não um formulário da subconta.
- **Entrega do canal pelas últimas mensagens:** `whatsapp` (`o=configurado`, `o=numeros`) para a
  linha; depois `conversas` (`id=<contato>`, `max=20`) em 5 a 10 contatos que passaram pelos
  workflows de mensagem. Para cada mensagem com `origem: workflow`, veja `status` (`delivered` e
  `read` entregaram; `failed` falhou; `pending` ou `sent` por horas não saiu) e `erro`. Canal que
  não entrega vai para o Urgente e trava qualquer opinião sobre texto ou espera.

**1.5 Modelos de mensagem.** `whatsapp` (`o=templates`): nome, status de aprovação e texto de
cada modelo. Cruze com as fichas: passo que manda modelo reprovado, pausado ou apagado não sai.
`modelos_email` (`o=usos`) mostra qual e-mail cada workflow manda e quais ninguém usa. Se a
`whatsapp` vier vazia com a linha ligada, o cliente usa a integração da ZOI: o texto sai pela
Meta, como `manual.md` explica, e a auditoria registra só o que as fichas citam.

**1.6 Usuários e rodízios.** `inventario` (`fatia=users`) para quem existe. Nas fichas, os
passos de atribuição (rodízio, usuário fixo, atribuição por linha de WhatsApp) e as notificações
(para quem vão). Na `agenda` (`o=calendarios`), quem atende cada agenda. Procure usuário
desativado num rodízio, aviso para um dono fixo que saiu da empresa e linha secundária que
atribui o lead sem condição. Feche com `anotacoes` (`o=buscar`, `tipo=tarefa`,
`concluidas=false`): quantas tarefas abertas, de quem, e a mais antiga.

## 2. Regras novas do auditor

Onze das 29 regras nasceram desta auditoria e aparecem também no `/automaster-audit`. As três
INFO são por aproximação: entram no relatório como pergunta até a leitura confirmar.

| Regra | Sev. | O que significa | Como confirmar |
|---|---|---|---|
| `create_opportunity_without_lookup` | WARN | cria card sem antes procurar card aberto no mesmo funil | `oportunidades` (`contato=<id>`) em contatos que passaram pelo workflow: dois cards abertos no mesmo funil |
| `opportunity_trigger_no_pipeline` | WARN | gatilho de oportunidade sem filtro de funil, com mais de um funil na subconta | ficha: o gatilho não cita funil; `workflows_ao_vivo` (`o=dentro`) mostra card de outro funil entrando |
| `impossible_time_condition` | WARN | ramo com condições de horário em E que nunca são verdade juntas | ficha: o ramo exige, por exemplo, antes das 9 e depois das 21; ninguém passou por ele |
| `appointment_waits_out_of_order` | WARN | espera "antes do compromisso" maior que uma anterior no mesmo caminho: o horário já passou | ficha: as esperas em ordem; `conversas` de quem tem visita marcada não traz o lembrete |
| `notify_owner_after_unassign` | WARN | avisa o dono do contato depois de um passo que tirou o dono | ficha: o passo que remove o dono vem antes do aviso, sem atribuir outro no meio |
| `duplicate_reply_responders` | WARN | dois ou mais publicados respondem à mesma resposta do cliente | `conversas` de quem respondeu: duas mensagens automáticas seguidas |
| `published_outside_folder` | WARN | publicado fora de pasta, que não aparece no app do GHL | `inventario` (`fatia=workflows`): sem pasta |
| `exposed_secret` | ERROR | chave de API ou token escrito em custom value, código ou webhook | o detalhe traz a chave mascarada e onde está; vai para o Urgente (revogar e mover) |
| `loss_keeps_cadence` | INFO | cadência que nenhum workflow de card perdido remove | `oportunidades` (`status=lost`) e `conversas` de 2 ou 3 perdidos: chegou mensagem da cadência depois da perda? |
| `cadence_without_exit` | INFO | cadência que entra pela oportunidade e não sai quando o card anda ou é ganho | `workflows_ao_vivo` (`o=dentro`) na cadência: há card ganho ou em etapa adiante ainda dentro? |
| `ai_leftover_published` | INFO | passo de IA, ou webhook e código que chamam provedor de IA, em workflow publicado | pergunta ao Luccas: a IA está em uso? `o=dentro` mostra se ainda entra gente |

## 3. Lista de verificação

Cada item achado entra no relatório com a evidência (workflow, passo, contagem) e o efeito para
o cliente. Os sinais citam onde olhar: ficha, regra ou leitura ao vivo.

- **Card duplicado.** Sinal: `create_opportunity_without_lookup`; mais de um caminho cria card
  (formulário, webhook, menu do WhatsApp); contato com dois cards abertos na `oportunidades`.
  Efeito: dois vendedores atendem o mesmo cliente, e o card esquecido entra no follow-up.
- **Mensagem depois de perdido.** Sinal: `loss_keeps_cadence`; o workflow de perda remove de
  alguns workflows e não de outros; `conversas` de um perdido com mensagem automática depois da
  perda. Efeito: o cliente que desistiu continua recebendo cobrança de resposta.
- **Cadência que não para quando o cliente responde.** Sinal: ficha com "parar quando responder"
  ligado como única saída e a resposta chegando por provedor próprio de SMS; `conversas` com
  resposta do cliente e mensagem da cadência depois. Efeito: o cliente responde e o CRM segue
  mandando "ainda tem interesse?".
- **Cadência sem saída quando o card anda ou é ganho.** Sinal: `cadence_without_exit`; card
  ganho ou adiante ainda dentro na `workflows_ao_vivo`. Efeito: quem já comprou recebe follow-up
  de quem ainda não comprou.
- **Duas respostas para a mesma mensagem.** Sinal: `duplicate_reply_responders`; vários
  workflows com o mesmo gatilho de resposta nas fichas. Efeito: o cliente recebe duas ou três
  mensagens automáticas de uma vez.
- **Linha secundária que rouba lead.** Sinal: ficha de atribuição por linha de WhatsApp sem
  condição de dono ("se já tem dono, não troca"). Efeito: o lead de um vendedor passa para outro
  porque mandou mensagem no número errado.
- **Gatilho de oportunidade sem filtro de funil.** Sinal: `opportunity_trigger_no_pipeline`.
  Efeito: a mensagem de um funil (venda) sai para card de outro (financiamento, pós-venda).
- **Condição impossível.** Sinal: `impossible_time_condition`; data "mesmo dia" sempre falsa na
  ficha; ramo sem ninguém passando no `o=dentro`. Efeito: a mensagem desse ramo nunca sai.
- **Espera que nunca chega.** Sinal: `appointment_waits_out_of_order`; espera relativa ao
  compromisso já vencida quando o contato chega nela. Efeito: o lembrete da visita pula, e o
  cliente falta.
- **Notificação para ninguém.** Sinal: `notify_owner_after_unassign`; aviso para o dono do
  contato num caminho que tirou o dono. Efeito: ninguém da equipe fica sabendo do lead.
- **Sobra de IA ou de integração desligada ainda publicada.** Sinal: `ai_leftover_published`;
  webhook para serviço que não existe mais; ficha com passo que ninguém da equipe reconhece.
  Efeito: custo, mensagem estranha ao cliente ou dado do cliente indo para fora.
- **Workflow fora de pasta.** Sinal: `published_outside_folder`. Efeito: a equipe não acha o
  workflow no app e não sabe que ele roda.
- **Chave exposta.** Sinal: `exposed_secret`. Efeito: qualquer pessoa com acesso à subconta usa
  a chave; é urgente revogar e mover para um lugar protegido.
- **Fila de tarefa manual que só cresce.** Sinal: `anotacoes` (`o=buscar`, `tipo=tarefa`,
  `concluidas=false`) com centenas de abertas e a mais antiga de meses; workflow que cria tarefa
  todo dia. Efeito: a tarefa vira ruído e a equipe para de olhar, inclusive a que importa.
- **Inscritos congelados em rascunho.** Sinal: `workflows_ao_vivo` (`o=dentro`) com gente num
  workflow em rascunho. Efeito: se alguém republicar, todos recebem a mensagem de uma vez, fora
  de hora.

## 4. Lições aprendidas

Da auditoria numa subconta de concessionária, que deu origem a esta skill.

**Canal que não entrega invalida ajuste de fluxo.** Antes de mexer em texto, espera ou ramo,
confira pela `conversas` que as mensagens automáticas chegam. Lá, uma tarde inteira de ajustes
foi feita numa linha que não enviava nada: nenhum ajuste podia ser visto funcionando.

**"Parar quando responder" não reage a resposta que chega por provedor próprio de SMS.** A
configuração só enxerga resposta pelos canais nativos. Com provedor próprio, a saída da cadência
tem que ser outro workflow (resposta recebida, remover da cadência). Confira na `conversas` se
houve mensagem da cadência depois da resposta do cliente.

**Formulário ou agenda "sem uso" pode ter sido aposentado de propósito.** Zero submissões e
nenhum gatilho não provam abandono: o formulário pode estar fora do site porque o cliente
trocou de fornecedor, ou a agenda pode ter sido trocada por outra. Item sem uso entra no
relatório como pergunta ("ainda serve?"), nunca como pedido de ligar o gatilho ou apagar.

**Mudança só conta como feita depois de ver tráfego real.** Publicar não prova que funciona. No
relatório, a ordem sugerida diz como cada etapa vai ser conferida: o contato de teste e, depois,
os primeiros contatos reais passando pelo caminho novo (`workflows_ao_vivo` e `conversas`).

## 5. Modelo do relatório

Arquivo `docs/<cliente>-auditoria-AAAA-MM-DD.md`. Abre com o título ("<Cliente> — auditoria das
automações e proposta de reestruturação"), a data, quantos workflows (publicados, rascunho), as
fontes com data e hora (dump, leituras ao vivo) e a frase "Nada foi alterado durante a
auditoria". Escrito para o Luccas: direto, com nome de workflow entre aspas, número com a fonte.
O relatório é interno e pode citar nome de workflow, etapa e usuário; o manual do cliente não.

### 1. Resumo

Um parágrafo sobre o estado geral e os três a cinco problemas que mais custam venda, cada um com
o número que prova ("180 cards abertos contra 6.400 abandonados"). Se o canal não entrega, é a
primeira frase.

### 2. Urgente

Tabela `#`, `O quê`, `Por quê`, com U1, U2… Entra o que dá prejuízo hoje, independente da
reestruturação: canal sem entregar, chave exposta, lead que chega sem aviso, mensagem errada
indo ao cliente, contato que pode ser apagado por mensagem.

### 3. Diagnóstico por área

Uma subseção por área que existe: entrada de lead e atribuição, atendimento por canal, funil e
follow-up, agenda, integrações, lixo e ruído. Em cada uma, um bloco por workflow relevante: nome,
execuções em 30 dias e quantos dentro agora, o que faz em uma linha e os problemas em itens, cada
um com a evidência. Itens "sem uso" e regras por aproximação ainda não confirmadas terminam com a
pergunta ao Luccas.

### 4. Proposta de estrutura

O princípio (um responsável por assunto: cada coisa acontece num lugar só, e nada desfaz o que
outro workflow fez), as pastas e os nomes, e uma subseção por área com o desenho proposto.

Pastas, só as que a subconta usa: `01 Entrada`, `02 Atendimento`, `03 Funil`, `04 Agenda`,
`05 Financiamento e cobrança`, `06 Integrações e log`, `99 Arquivo` (rascunhos parados, nunca
apagados sem confirmação). Nomes no padrão `[Área] Gatilho → Ação`, como
`[Entrada] Formulário do site → rodízio e card` ou `[Funil] Card perdido → limpa cadências`.

### 5. Ordem sugerida

Etapas numeradas (em geral semanas): a primeira é o Urgente; depois entrada sem duplicado, funil,
atendimento e organização. Cada etapa diz o que entra, o que sai e como vai ser conferida: teste
com contato de teste antes de publicar e tráfego real depois. Workflow substituído vai para
`99 Arquivo` em rascunho, sem ser apagado.

### 6. Números de referência

Últimos 30 dias, com a fonte: tabela `Workflow`, `Execuções` (entradas de `o=dentro`), em ordem
decrescente; o funil hoje (abertos, ganhos, perdidos, abandonados); compromissos por agenda;
submissões por formulário; tarefas abertas. São a base para comparar depois das correções.
