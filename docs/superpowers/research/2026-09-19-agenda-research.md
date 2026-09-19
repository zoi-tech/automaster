# Pesquisa — agenda e calendários no MCP

Spec: `docs/superpowers/specs/2026-09-19-agenda-mcp-design.md`

Quatro frentes: reuso no repo, blast radius e testes, referência offline de `calendars`,
busca externa. As quatro voltaram.

## Achados

### A1 — `fetchCalendars` já existe e fala com o host `backend`, não `services`
- Fonte: `extractor/src/api/entities.ts:38`, host em `entities.ts:3`
- Contradiz a spec: sim
- Pergunta: a spec aposta que agenda usa o mesmo host de oportunidades. O calendário que o
  extractor já lê hoje mora no outro host. Ou agenda está partida entre os dois hosts, e a
  sondagem precisa descobrir a divisão antes do módulo assumir qualquer coisa, ou o módulo
  novo reusa o host que já funciona e a spec corrige a seção de auth.

### A2 — o extractor já chama `calendars/events` para a timeline do contato
- Fonte: `extractor/src/api/audit.ts:42-53`
- Contradiz a spec: parcial
- Pergunta: parte do trabalho já está feita e a spec não sabe. Essa chamada usa o host
  `services` e já traz compromissos de um contato. Reusar ou duplicar? Duplicar significa
  duas rotas para a mesma coisa que podem divergir na próxima quebra da API.

### A3 — `toNotify` desliga notificação e automação juntas, sem meio-termo
- Fonte: `~/Documents/2. ZOI/ghl-docs/ghl/calendars/create-appointment.md:111-117`;
  https://marketplace.gohighlevel.com/docs/ghl/calendars/create-appointment/
- Contradiz a spec: parcial
- Pergunta: a spec previu "flag de silêncio" como se fosse só sobre a mensagem ao contato.
  A flag real também impede os workflows de rodarem. Marcar um compromisso em silêncio
  numa subconta real deixa o contato sem a automação que deveria ter disparado — o dado
  fica certo e o processo fica errado. Silenciar por padrão ainda é a escolha segura?

### A4 — a documentação não promete que `toNotify: false` cale o e-mail de confirmação
- Fonte: o texto oficial só fala em "automations"; quem manda o e-mail é a configuração de
  notificação do calendário, com seis gatilhos próprios
  (https://help.gohighlevel.com/support/solutions/articles/155000003441)
- Contradiz a spec: sim
- Pergunta: a guarda que a spec deixou pendente pode não existir como parâmetro. Se o
  e-mail for decidido pelo calendário e não pela chamada, a única forma de não falar com
  pessoa real é só escrever em calendário de teste — o que muda a guarda de "flag no
  payload" para "a tool avisa e o usuário assume".

### A5 — não existe status "remarcado"; remarcar é mudar horário e o servidor decide o resto
- Fonte: enum fechado `new, confirmed, cancelled, showed, noshow, invalid, completed, active`
  (`create-appointment.md:83`); https://ideas.gohighlevel.com/scheduling-calendar/p/reschedule-appointment-doesnt-trigger-notification
- Contradiz a spec: parcial
- Pergunta: a spec lista "remarcar" e "mudar status" como operações distintas. Na API é o
  mesmo PUT. Vale manter duas operações na CLI por clareza de intenção, ou vira uma só?

### A6 — omitir o status na criação pode fazer a confirmação não sair
- Fonte: https://github.com/connectwithdevjerry/yashaya/pull/19
- Contradiz a spec: não
- Pergunta: registro. Sem status explícito, o compromisso herda o default do calendário e o
  comportamento muda de calendário para calendário — a tool deve exigir status explícito?

### A7 — buscar horário livre e marcar usam convenções de data diferentes
- Fonte: `get-slots.md:52-78` (epoch em milissegundos mais fuso IANA separado, teto de 31
  dias) contra corpo do appointment em ISO com offset e sem campo de fuso
- Contradiz a spec: não
- Pergunta: registro, mas é a fonte de bug mais provável do módulo. O usuário passa uma
  data e a CLI precisa convertê-la duas vezes de jeitos diferentes conforme a operação.

### A8 — compromisso e bloqueio de agenda são a mesma coleção, sem discriminador documentado
- Fonte: `get-blocked-slots.md` tem query e resposta idênticas a `get-calendar-events.md`
- Contradiz a spec: parcial
- Pergunta: a spec só fala de compromisso. Se as duas leituras devolvem a mesma lista, a
  tool pode devolver bloqueio misturado com compromisso e o usuário não distinguir. Qual
  campo separa? Só a sondagem responde.

### A9 — o padrão de rastro tem duas fases e nenhum helper faz as duas
- Fonte: `extractor/src/cli.ts:502-510` (o helper), `cli.ts:603-612` (a reescrita
  `aplicado: false` para `true` feita à mão), `cli.ts:387-397` (o `log("snapshot: …")` que o
  servidor MCP lê em `mcp_server.py:258-261` para reportar timeout)
- Contradiz a spec: não
- Pergunta: registro. Copiar só o helper perde o rastro se o processo morrer no meio da
  escrita, que é exatamente o caso que o aviso de timeout do MCP descreve.

### A10 — leitura e escrita devolvem formatos diferentes no MCP, de propósito
- Fonte: `mcp_server.py:568` envelopa em `resultado`; `mcp_server.py:602` faz merge
- Contradiz a spec: não
- Pergunta: registro. É o erro mais fácil de cometer numa tool nova, e os testes fixam os
  dois formatos.

### A11 — tudo em camelCase; a armadilha de snake_case das oportunidades não se repete aqui
- Fonte: as dezesseis rotas do sub-projeto 1 na referência offline
- Contradiz a spec: parcial
- Pergunta: a spec manda checar snake_case. Segundo a documentação pública, não há. Mas a
  documentação é da API pública e o projeto chama a interna — a checagem continua valendo
  na sondagem, só deixa de ser a suspeita principal.

### A12 — nada no auditor depende de agenda além do inventário
- Fonte: `loader.py:80,156`, `dashboard.py:185-189`, `theme.py:291`, `mcp_server.py:32`;
  nenhuma regra em `rules/` menciona calendário
- Contradiz a spec: não
- Pergunta: registro. Confirma que dá para não tocar `loader.py`, `flow.py` nem `rules/`.

### A13 — o extractor não tem teste nenhum
- Fonte: `extractor/package.json` sem runner; `CLAUDE.md:62`
- Contradiz a spec: não
- Pergunta: registro. Todo comportamento asserido mora do lado Python, testando o comando
  que a tool monta. O TypeScript é coberto por typecheck e pela rodada ao vivo.

### A14 — recorrência exige a flag que desliga a validação de horário livre
- Fonte: `create-appointment.md:119-123` — a regra de repetição só vale com
  `ignoreFreeSlotValidation` ligada
- Contradiz a spec: não
- Pergunta: a spec não menciona compromisso recorrente. Fica de fora desta rodada?

## Fila do grill

Ordenada por dependência.

1. A1 — qual host serve agenda, e a divisão entre os dois (trava A2, A8, A11)
2. A3 — silenciar também desliga automação: ainda se silencia por padrão? (trava A4)
3. A4 — se o e-mail é decisão do calendário, a guarda vira aviso em vez de flag
4. A2 — reusar a chamada que a timeline já faz, ou duplicar
5. A5 — remarcar e mudar status são a mesma rota: duas operações ou uma
6. A8 — separar compromisso de bloqueio de agenda na leitura
7. A11 — camelCase confirmado na pública; o que ainda precisa ser checado na interna
8. A14 — compromisso recorrente entra ou fica fora
9. A6 — exigir status explícito na criação
