# Agenda e calendários no MCP automaster — design

Data: 2026-09-19. Área: `calendars` do GoHighLevel, via API interna e sessão Chrome.

## Problema

O MCP cobre workflows, contatos, conversas e oportunidades. Agenda é invisível: o dump só
guarda nome e id de calendário, o bastante para resolver referência de workflow. Sem
agenda, oportunidade não tem o evento que move o card — a reunião marcada.

## Decomposição

A referência offline (`~/Documents/2. ZOI/ghl-docs/ghl/calendars/`, 70 arquivos) é da API
pública v3. Serve de mapa de conceitos, não de contrato: o projeto chama a API interna, e
o contrato real sai da sondagem ao vivo.

Quatro sub-projetos, cada um com seu ciclo spec-flow completo e sua versão do plugin:

1. **0.7.0 — compromissos e disponibilidade.** Calendários (lista), slots livres,
   compromissos: ver, marcar, remarcar, mudar status, cancelar, notas. **Esta spec.**
2. **0.8.0 — configuração de calendário.** Criar/editar/apagar calendário, schedules de
   disponibilidade, blocked slots, notificações de evento.
3. **0.9.0 — grupos e recursos.** Grupos de calendário, slug, salas e equipamentos.
4. **0.10.0 — serviços e bookings.** Catálogo de serviços, service bookings, service
   locations. Produto separado do GHL; confirmar que a Instaltech usa antes de investir.

Cada sub-projeto só começa depois do anterior validado ao vivo e liberado.

## Escopo desta spec (sub-projeto 1)

Leitura: listar calendários da subconta; slots livres de um calendário num intervalo;
compromissos por calendário, por contato e por período; detalhe de um compromisso; notas
de um compromisso.

Escrita: marcar compromisso; remarcar (data/hora, calendário, dono); mudar situação;
cancelar; criar, editar e apagar nota.

`remarcar` e `situacao` são a mesma rota com corpos diferentes, e continuam separadas na
CLI e na tool: a intenção fica explícita e o rastro grava qual das duas foi.

A situação é um enum fechado — `new`, `confirmed`, `cancelled`, `showed`, `noshow`,
`invalid`, `completed`, `active` — validado antes da chamada, com a lista na mensagem de
erro. Não existe "remarcado": remarcar é mudar o horário, e o servidor decide o resto.

`marcar` **exige** situação explícita. Sem ela, o compromisso herda o padrão do calendário,
que varia de calendário para calendário e, em pelo menos um relato, faz a confirmação não
sair.

Compromisso recorrente entra por inteiro. `marcar` aceita a regra de repetição (RFC 5545) e
liga sozinho a chave que desliga a validação de horário livre quando ela vier — sem essa
chave a regra é ignorada pelo servidor —, avisando na saída que o horário não foi conferido
e pode ter caído em cima de outro compromisso.

`remarcar`, `situacao` e `cancelar` **exigem o alvo** quando o compromisso é de uma série:
só aquela ocorrência ou a série inteira. A API distingue pelo identificador enviado (id da
instância contra `masterEventId`); escolher por conta própria arrisca remarcar o ano todo
no lugar de um dia. Sem o alvo, a tool recusa. "A partir daqui" só entra se a sondagem
mostrar que a API suporta.

Bloqueio de agenda (intervalo indisponível, sem contato) vive na mesma coleção dos
compromissos e a documentação não diz qual campo os separa. A sondagem descobre o campo e a
leitura marca cada item como compromisso ou bloqueio; sem isso a ferramenta devolveria os
dois misturados. Criar bloqueio fica para o sub-projeto 2.

Fora: tudo dos sub-projetos 2 a 4, e qualquer regra de auditoria sobre agenda.

## Fonte do dado

Tudo ao vivo, como em oportunidades. Agenda muda por minuto; snapshot de dump envelhece
antes de ser lido. O dump continua servindo só para resolver referência de calendário em
workflow.

## Arquitetura

Segue o padrão fixo do repo, sem exceção:

- `extractor/src/api/calendars.ts` — funções puras sobre `GhlClient`, uma por operação.
- `extractor/src/cli.ts` — dois comandos, `agenda` (leitura) e `agenda-acao` (escrita),
  ambos com `--json`; entradas em `package.json` como `npm run agenda` / `npm run agenda-acao`.
- `auditor/src/automaster_audit/mcp_server.py` — duas tools, `agenda` e `agenda_acao`,
  que chamam a CLI por `_run_extractor`. Total sobe de 21 para 23 tools.

Nada toca `loader.py`, `flow.py` nem `rules/`.

Recorte das tools espelha oportunidades: leitura numa tool, escrita noutra. Notas não
ganham tool própria — são operações de `agenda`/`agenda_acao`, porque nota é acessório do
compromisso, não entidade que se navega sozinha.

## Auth e a fase zero de sondagem

Nenhuma rota de agenda está provada neste projeto. O calendário que o extractor lê hoje vem
de `backend.leadconnectorhq.com` (`extractor/src/api/entities.ts:38`), e a rota de
compromissos em `services.leadconnectorhq.com` já foi testada e **recusada** com os tokens
da sessão (`docs/endpoints.md:111-113`) — a timeline do contato degrada com aviso por causa
disso. A referência pública v3 descreve uma API que talvez não possamos chamar.

Por isso o plano começa por uma **fase zero de sondagem**, antes de qualquer linha do
módulo:

1. Ler o pacote JavaScript público do aplicativo
   (`appcdn.leadconnectorhq.com/crm/<app>/<build>/static/js/*.js`, com UA de browser — sem
   ele responde 403) e extrair as rotas de agenda que o app realmente chama. Foi o caminho
   que funcionou para conversas.
2. Confirmar ao vivo, só com leitura, quais dessas rotas aceitam os dois tokens da sessão, e
   com qual esquema (Bearer sozinho ou Bearer mais `token-id`).
3. Registrar o contrato observado em `docs/endpoints.md`, seção `## Agenda`.

Se nenhuma rota de leitura de compromisso aceitar os tokens, a sondagem **para** e volta ao
usuário. Não se escreve o módulo contra documentação não confirmada, e não se escreve nada
na subconta antes de a leitura estar provada.

## Guardas de escrita

`confirmo=true` obrigatório em toda escrita. Leitura nunca confirma. Sem desfazer.

Rastro em `<dumps>/_agenda/<locationId>/<appointmentId>/<ts>.json`, com snapshot do estado
anterior sempre que a operação altera compromisso que já existia.

**Notificação ao contato.** Marcar, remarcar e cancelar falam com o cliente e disparam
automação. A única chave de silêncio documentada (`toNotify`) desliga as duas coisas juntas
e nem promete calar o e-mail de confirmação — quem decide esse e-mail é a configuração de
notificação do calendário, com seis gatilhos próprios (marcado, confirmado, cancelado,
remarcado, lembrete, acompanhamento).

Decisão: a ferramenta se comporta como a interface, notificando por padrão. A proteção é
aviso, não flag — a descrição da tool e a mensagem de recusa sem confirmação dizem, em
palavras, que a operação fala com o cliente, dispara automação e não tem desfazer. Quem
quiser silêncio passa a flag explícita, e a mensagem avisa que ela também desliga os
workflows.

## Validação ao vivo

Instaltech `Xb9gDxwxYhdqtprGcb5E`, contato de teste `uWqujqll20tRuglV3mLt`, em calendário
descartável criado e apagado na mesma rodada. Nenhum calendário de produção tocado.

Criar calendário é operação do sub-projeto 2, usada aqui só como andaime da sondagem. Se a
subconta não permitir criá-lo pela API, a sondagem para e volta ao usuário antes de
qualquer escrita — não se testa em agenda real.

Armadilhas confirmadas em oportunidades, a checar aqui: filtro de busca em snake_case
enquanto o corpo é camelCase; `locationId` na query do PUT e no corpo do POST.

## Datas

A API mistura convenções: a busca de horário livre usa milissegundos desde 1970 com o fuso
em campo separado e teto de 31 dias no intervalo, enquanto o corpo do compromisso usa texto
ISO com o fuso embutido e nenhum campo de fuso. Há bug relatado do próprio GoHighLevel
quando o fuso não vem explícito.

A CLI e as tools aceitam **uma forma só**, texto ISO com fuso (`2026-10-02T14:00:00-03:00`),
e convertem internamente conforme a operação. Data sem fuso é recusada com mensagem clara —
nunca completada com o fuso da máquina, que marca reunião no horário errado sem avisar.

## Testes

`auditor/tests/test_mcp_tools.py`, com `_run_extractor` fingido, no padrão das três tools
de oportunidade: cada operação monta o comando certo, leitura recusa `confirmo`, escrita
recusa sem ele. Contrato de rota não se testa offline — quem valida é a rodada ao vivo.

## Entregáveis

Módulo, dois comandos, duas tools, testes, `docs/endpoints.md` com seção `## Agenda` e o
que foi ou não exercitado ao vivo, `skills/automaster-leitura/SKILL.md` atualizada,
`CHANGELOG.md` e `plugin.json` na 0.7.0.

## Decisões do grill

Dossiê: `docs/superpowers/research/2026-09-19-agenda-research.md`.

- **A1, A2** — a seção de auth foi refeita e o plano ganhou uma fase zero de sondagem.
  Motivo: o calendário que o extractor lê hoje vem de `backend`, e a rota de compromissos em
  `services` já foi testada e recusada com os tokens da sessão (`docs/endpoints.md:111-113`).
  Nenhuma rota de agenda está provada; a referência pública descreve uma API que talvez não
  possamos chamar. Reusar `fetchContactAppointments` (`extractor/src/api/audit.ts:42-53`)
  deixou de ser opção porque ela não funciona — a timeline degrada com aviso.
- **A3, A4** — abandonado o silêncio por padrão; a proteção virou aviso. Motivo: a única
  chave documentada desliga notificação e automação juntas, e o e-mail de confirmação é
  decidido pela configuração do calendário, não pela chamada. Silenciar deixaria o registro
  certo e o processo errado, sem garantia de calar o e-mail.
- **A5** — `remarcar` e `situacao` continuam separadas, sobre a mesma rota; enum validado
  antes da chamada. Motivo: a intenção fica explícita no rastro, e "remarcado" não existe
  como situação.
- **A6** — `marcar` exige situação explícita. Motivo: sem ela o compromisso herda o padrão
  do calendário e a confirmação pode não sair.
- **A7** — uma forma só de data na entrada, ISO com fuso, sem completar fuso ausente.
  Motivo: a API usa duas convenções e há bug relatado de fuso implícito.
- **A8** — a leitura marca cada item como compromisso ou bloqueio; o campo sai da sondagem.
  Motivo: as duas coisas vivem na mesma coleção e viriam misturadas.
- **A14** — recorrência entra inteira, contra a recomendação inicial de deixar fora, por
  decisão do usuário. `marcar` liga sozinho a validação desligada quando há regra de
  repetição e avisa; as escritas exigem o alvo (instância ou série).
- **A9, A10, A12, A13** — mantidos como registro, sem mudança na spec. São o padrão do repo
  que a implementação copia: rastro em duas fases com `snapshot:` no stderr, leitura
  envelopada e escrita mesclada no MCP, agenda desacoplada de regras, e nenhum teste no
  extractor.
- **A11** — mantida a checagem de snake_case na sondagem, rebaixada de suspeita principal.
  Motivo: as rotas públicas são todas camelCase, mas a API interna é outra e não foi vista.
