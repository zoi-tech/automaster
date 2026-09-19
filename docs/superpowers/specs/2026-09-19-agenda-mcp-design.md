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

Escrita: marcar compromisso; remarcar (data/hora, calendário, dono); mudar status
(confirmado, cancelado, no-show, etc., conforme o enum que a sondagem devolver); cancelar;
criar, editar e apagar nota.

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

## Auth

Sessão Chrome, dois tokens. `calendars/*` fica no mesmo host de `opportunities/*`
(`services.leadconnectorhq.com`), então a expectativa é Bearer + `token-id`. **Expectativa,
não contrato** — a sondagem confirma antes de o módulo assumir.

## Guardas de escrita

`confirmo=true` obrigatório em toda escrita. Leitura nunca confirma. Sem desfazer.

Rastro em `<dumps>/_agenda/<locationId>/<appointmentId>/<ts>.json`, com snapshot do estado
anterior sempre que a operação altera compromisso que já existia.

**Guarda extra, pendente de sondagem:** marcar ou remarcar compromisso provavelmente
dispara e-mail/SMS de confirmação ao contato. Se a sondagem achar flag de silêncio no
payload, a CLI manda notificação desligada por padrão e só notifica com flag explícita; a
diferença fica documentada em `docs/endpoints.md`. Se não houver flag, a escrita fica
marcada como "fala com pessoa real" na descrição da tool e na skill de leitura.

## Validação ao vivo

Instaltech `Xb9gDxwxYhdqtprGcb5E`, contato de teste `uWqujqll20tRuglV3mLt`, em calendário
descartável criado e apagado na mesma rodada. Nenhum calendário de produção tocado.

Criar calendário é operação do sub-projeto 2, usada aqui só como andaime da sondagem. Se a
subconta não permitir criá-lo pela API, a sondagem para e volta ao usuário antes de
qualquer escrita — não se testa em agenda real.

Armadilhas confirmadas em oportunidades, a checar aqui: filtro de busca em snake_case
enquanto o corpo é camelCase; `locationId` na query do PUT e no corpo do POST.

## Testes

`auditor/tests/test_mcp_tools.py`, com `_run_extractor` fingido, no padrão das três tools
de oportunidade: cada operação monta o comando certo, leitura recusa `confirmo`, escrita
recusa sem ele. Contrato de rota não se testa offline — quem valida é a rodada ao vivo.

## Entregáveis

Módulo, dois comandos, duas tools, testes, `docs/endpoints.md` com seção `## Agenda` e o
que foi ou não exercitado ao vivo, `skills/automaster-leitura/SKILL.md` atualizada,
`CHANGELOG.md` e `plugin.json` na 0.7.0.
