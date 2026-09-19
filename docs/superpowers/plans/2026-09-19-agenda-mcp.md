# Agenda e calendários no MCP — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dar ao MCP automaster leitura e escrita da agenda de uma subconta GoHighLevel —
calendários, horários livres, compromissos (inclusive recorrentes) e notas.

**Architecture:** módulo `extractor/src/api/calendars.ts` com funções puras sobre
`GhlClient`; dois comandos na CLI (`agenda` para leitura, `agenda-acao` para escrita), ambos
com `--json`; duas tools em `mcp_server.py` que chamam a CLI por `_run_extractor`. Tudo ao
vivo, nada lê o dump. Nada toca `loader.py`, `flow.py` nem `rules/`.

**Tech Stack:** TypeScript + tsx + commander (extractor), Python 3.12 + pytest (auditor).

**Spec:** `docs/superpowers/specs/2026-09-19-agenda-mcp-design.md`
**Pesquisa:** `docs/superpowers/research/2026-09-19-agenda-research.md`

## Global Constraints

- **Nenhuma rota de agenda está provada neste projeto.** A rota pública
  `services.leadconnectorhq.com/calendars/events` já foi testada e **recusada** com os
  tokens da sessão (`docs/endpoints.md:111-113`). A Tarefa 1 é uma sondagem com gate humano;
  nenhuma linha do módulo se escreve antes dela.
- Auth: sessão Chrome, dois tokens (`authorization: Bearer` + `token-id`), UA de browser
  obrigatório. O cliente já cuida disso — use `withClient`.
- Escrita exige `--confirmo` na CLI e `confirmo=true` na tool. A mensagem de recusa da CLI
  diz `--confirmo`; a do MCP diz `confirmo=true` (o teste asserta essa string literal).
- Rastro de escrita em `<dumps>/_agenda/<loc>/<chave>/<ts>.json`, gravado **antes** da
  chamada com `aplicado: false` e reescrito depois com `aplicado: true` e a resposta.
- Com `--json`, **só a última linha do stdout** pode ser JSON. Todo o resto vai para stderr:
  `const log = opts.json ? console.error : console.log;`
- Retorno das tools: leitura envelopa (`{"resultado": ..., "_snapshot": meta}`), escrita
  mescla (`_run_extractor(...) | {"_snapshot": meta}`). Os testes fixam os dois formatos.
- Toda tool chama `_, meta = _load(loc, snapshot)` mesmo sendo 100% ao vivo.
- Só `ToolError` vira erro de tool; qualquer outra exceção derruba a chamada.
- Datas na entrada: **uma forma só**, ISO com fuso (`2026-10-02T14:00:00-03:00`). Data sem
  fuso é recusada, nunca completada com o fuso da máquina.
- Situação do compromisso: enum fechado `new`, `confirmed`, `cancelled`, `showed`, `noshow`,
  `invalid`, `completed`, `active`. Não existe "remarcado".
- Subconta de validação: Instaltech `Xb9gDxwxYhdqtprGcb5E`; contato de teste
  `uWqujqll20tRuglV3mLt`. Nunca escrever em calendário de produção.
- Testes só do lado Python (`auditor/tests/test_mcp_tools.py`); o extractor não tem runner,
  só `npx tsc --noEmit`. Rodar a suíte de dentro de `auditor/`: `.venv/bin/python -m pytest -q`.

## Estrutura de arquivos

- Criar: `extractor/src/api/calendars.ts` — rotas de agenda, funções puras sobre `GhlClient`.
- Modificar: `extractor/src/cli.ts` — `runAgenda`, `runAgendaAcao`, dois blocos `program.command`.
- Modificar: `extractor/package.json` — dois scripts.
- Modificar: `auditor/src/automaster_audit/mcp_server.py` — `agenda`, `agenda_acao`, entradas em `TOOLS`.
- Modificar: `auditor/tests/test_mcp_tools.py` — testes das duas tools.
- Modificar: `docs/endpoints.md` — seção `## Agenda`.
- Modificar: `skills/automaster-leitura/SKILL.md`, `CHANGELOG.md`, `.claude-plugin/plugin.json`.

---

### Tarefa 1: Sondagem — achar as rotas reais de agenda

Descoberta, não TDD. Entregável: contrato observado em `docs/endpoints.md`. **Gate humano no
fim: sem rota de leitura funcionando, o plano para aqui.**

**Files:**
- Modify: `docs/endpoints.md` (nova seção `## Agenda`)

**Interfaces:**
- Consumes: nada.
- Produces: para as tarefas 2 e 4 — o host base (`backend.leadconnectorhq.com` ou
  `services.leadconnectorhq.com`), o caminho de cada rota, o case dos parâmetros, o formato
  de data aceito, e o campo que separa compromisso de bloqueio de agenda.

- [ ] **Passo 1: baixar o pacote JavaScript do aplicativo**

O app responde 403 sem UA de browser. Descubra o build corrente abrindo o HTML e extraindo
os `src` de script:

```bash
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
mkdir -p /tmp/ghl-bundle && cd /tmp/ghl-bundle
curl -sA "$UA" https://app.gohighlevel.com/ -o index.html
grep -oE 'https://appcdn\.leadconnectorhq\.com/[^"]+\.js' index.html | sort -u | tee urls.txt
xargs -n1 -P4 curl -sA "$UA" -O < urls.txt
```

Se `index.html` não listar chunk de calendário, procure o chunk pelo nome — para conversas
o chunk era `contacts-highrise`; para agenda tente `calendar`, `appointment`, `scheduling`:

```bash
curl -sA "$UA" https://app.gohighlevel.com/ | grep -oE '[a-z-]*calendar[a-z-]*'
```

- [ ] **Passo 2: extrair as rotas de agenda do pacote**

```bash
cd /tmp/ghl-bundle
grep -ohE '"[^"]*(calendars|appointments|free-slots|blocked-slots)[^"]*"' *.js | sort -u > rotas.txt
grep -ohE '(backend|services)\.leadconnectorhq\.com[^"`]*calendar[^"`]*' *.js | sort -u >> rotas.txt
cat rotas.txt
```

Anote, para cada rota candidata: host, caminho, método (procure o `axios`/`fetch` em volta),
e o case dos parâmetros.

- [ ] **Passo 3: confirmar ao vivo, só leitura**

Use o comando `discover` para observar os requests reais do app enquanto você navega até a
agenda da Instaltech:

```bash
cd extractor && npm run discover -- --location Xb9gDxwxYhdqtprGcb5E
```

Abra o calendário na janela do Chrome, navegue entre semanas, abra um compromisso. Cada
request ao backend sai no terminal com URL, método e headers. É a fonte mais confiável:
mostra o esquema de auth que o app usa de fato.

- [ ] **Passo 4: registrar o contrato e parar no gate**

Escreva em `docs/endpoints.md` uma seção `## Agenda` com, por rota: método, caminho, host,
parâmetros com case exato, exemplo de resposta abreviado, e qual esquema de auth funcionou
(`Bearer` sozinho ou `Bearer` + `token-id`). Marque cada linha com ✓ (confirmado ao vivo) ou
✗ (não exercitado).

Responda explicitamente, na mesma seção, estas quatro perguntas:

1. Qual host serve agenda? Os dois?
2. Qual campo distingue compromisso de bloqueio de agenda na listagem?
3. O corpo aceita `toNotify`, `ignoreFreeSlotValidation`, `ignoreDateRange`? Com esses nomes?
4. Datas: milissegundos desde 1970, ou texto ISO? Por rota.

**PARE E VOLTE AO USUÁRIO.** Se nenhuma rota de leitura de compromisso aceitou os tokens da
sessão, não siga para a Tarefa 2 — relate o que foi tentado e o que respondeu.

- [ ] **Passo 5: commit**

```bash
git add docs/endpoints.md
git commit -m "docs(agenda): contrato das rotas de agenda observado ao vivo"
```

---

### Tarefa 2: Módulo `calendars.ts` — leitura

**Files:**
- Create: `extractor/src/api/calendars.ts`

**Interfaces:**
- Consumes: o contrato da Tarefa 1; `GhlClient` de `./client.js`; `fetchCalendars` de
  `./entities.js`.
- Produces: `listCalendars(client, locationId)`, `getCalendar(client, calendarId)`,
  `freeSlots(client, calendarId, f: SlotFiltro)`, `listEvents(client, locationId, f: EventoFiltro)`,
  `getAppointment(client, eventId)`, `listNotes(client, appointmentId, limit?, offset?)`,
  `isoComFuso(v: string): string`, `epochMs(iso: string): number`, `AGENDA_SITUACOES`.

- [ ] **Passo 1: escrever o módulo**

Substitua `BASE` pelo host que a Tarefa 1 confirmou, e os caminhos pelos que ela registrou.
Se a sondagem mostrou hosts diferentes por rota, declare duas constantes e use a certa em
cada função — não force um host só.

```ts
import type { GhlClient } from "./client.js";
import { fetchCalendars } from "./entities.js";

/**
 * Rotas de agenda. Host e caminhos vêm da sondagem registrada em
 * docs/endpoints.md § Agenda — não da referência pública, que já recusou nossos tokens.
 */
const BASE = "https://services.leadconnectorhq.com";

/** Situações que o servidor aceita. Não existe "remarcado": remarcar é mudar o horário. */
export const AGENDA_SITUACOES = [
  "new", "confirmed", "cancelled", "showed", "noshow", "invalid", "completed", "active",
] as const;

/** Aceita só ISO com fuso. Fuso implícito marca reunião no horário errado sem avisar. */
export function isoComFuso(v: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)$/.test(v)) {
    throw new Error(
      `data sem fuso ou malformada: ${v}. Use ISO com fuso, ex.: 2026-10-02T14:00:00-03:00`,
    );
  }
  return v;
}

/** Milissegundos desde 1970, para as rotas que não aceitam texto ISO. */
export function epochMs(iso: string): number {
  return Date.parse(isoComFuso(iso));
}

export interface SlotFiltro {
  inicio: string;        // ISO com fuso
  fim: string;           // ISO com fuso
  timezone?: string;     // IANA, ex.: America/Sao_Paulo
  usuario?: string;
}

export interface EventoFiltro {
  inicio: string;
  fim: string;
  calendario?: string;
  usuario?: string;
  grupo?: string;
  contato?: string;
}

/** Calendários da subconta. Reusa o que o extractor já faz no dump. */
export function listCalendars(client: GhlClient, locationId: string): Promise<unknown> {
  return fetchCalendars(client, locationId);
}

export function getCalendar(client: GhlClient, calendarId: string): Promise<unknown> {
  return client.getJson(`${BASE}/calendars/${encodeURIComponent(calendarId)}`);
}

/** Horários livres. Esta rota usa epoch e fuso em campo separado; o corpo do
 * compromisso usa ISO. A diferença é da API, não nossa. */
export function freeSlots(
  client: GhlClient, calendarId: string, f: SlotFiltro,
): Promise<unknown> {
  const inicio = epochMs(f.inicio);
  const fim = epochMs(f.fim);
  if (fim - inicio > 31 * 86_400_000) {
    throw new Error("o intervalo de horários livres não pode passar de 31 dias");
  }
  const p = new URLSearchParams({ startDate: String(inicio), endDate: String(fim) });
  if (f.timezone) p.set("timezone", f.timezone);
  if (f.usuario) p.set("userId", f.usuario);
  return client.getJson(
    `${BASE}/calendars/${encodeURIComponent(calendarId)}/free-slots?${p.toString()}`,
  );
}

/** Compromissos e bloqueios do período. Exige um de calendário, usuário ou grupo. */
export function listEvents(
  client: GhlClient, locationId: string, f: EventoFiltro,
): Promise<unknown> {
  if (!f.calendario && !f.usuario && !f.grupo) {
    throw new Error("a listagem exige --calendario, --usuario ou --grupo");
  }
  const p = new URLSearchParams({
    locationId,
    startTime: String(epochMs(f.inicio)),
    endTime: String(epochMs(f.fim)),
  });
  if (f.calendario) p.set("calendarId", f.calendario);
  if (f.usuario) p.set("userId", f.usuario);
  if (f.grupo) p.set("groupId", f.grupo);
  if (f.contato) p.set("contactId", f.contato);
  return client.getJson(`${BASE}/calendars/events?${p.toString()}`);
}

export function getAppointment(client: GhlClient, eventId: string): Promise<unknown> {
  return client.getJson(
    `${BASE}/calendars/events/appointments/${encodeURIComponent(eventId)}`,
  );
}

export function listNotes(
  client: GhlClient, appointmentId: string, limit = 20, offset = 0,
): Promise<unknown> {
  const p = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  return client.getJson(
    `${BASE}/calendars/appointments/${encodeURIComponent(appointmentId)}/notes?${p.toString()}`,
  );
}
```

- [ ] **Passo 2: typecheck**

Run: `cd extractor && npx tsc --noEmit`
Expected: sem erro. Se `client.getJson` exigir parâmetro de tipo, anote `getJson<unknown>`.

- [ ] **Passo 3: commit**

```bash
git add extractor/src/api/calendars.ts
git commit -m "feat(agenda): modulo de leitura da agenda"
```

---

### Tarefa 3: Comando `agenda` (leitura) na CLI

**Files:**
- Modify: `extractor/src/cli.ts` (nova função `runAgenda` perto de `runOportunidades`; novo
  bloco `program.command("agenda")` junto dos outros)
- Modify: `extractor/package.json` (script `agenda`)

**Interfaces:**
- Consumes: tudo que a Tarefa 2 exporta.
- Produces: para a Tarefa 5 — o comando `agenda` com as flags `-l`, `-o`, `-i`,
  `--calendario`, `--usuario`, `--grupo`, `--contato`, `--inicio`, `--fim`, `--timezone`,
  `--limite`, `--pagina`, `--json`; operações `calendarios`, `calendario`, `livres`,
  `eventos`, `ver`, `notas`.

- [ ] **Passo 1: importar e declarar as operações**

No bloco de imports de `cli.ts`, junto dos outros `./api/*.js`:

```ts
import {
  listCalendars, getCalendar, freeSlots, listEvents, getAppointment, listNotes,
} from "./api/calendars.js";
```

Perto de `const OPP_ACOES` (`cli.ts:512`):

```ts
const AGENDA_LEITURA = ["calendarios", "calendario", "livres", "eventos", "ver", "notas"];
```

- [ ] **Passo 2: escrever `runAgenda`**

```ts
async function runAgenda(opts: {
  location: string; o: string; id?: string; calendario?: string; usuario?: string;
  grupo?: string; contato?: string; inicio?: string; fim?: string; timezone?: string;
  limite?: string; pagina?: string; json?: boolean;
}): Promise<void> {
  const log = opts.json ? console.error : console.log;
  if (!AGENDA_LEITURA.includes(opts.o)) {
    throw new Error(`-o inválido: ${opts.o}. Aceitos: ${AGENDA_LEITURA.join(", ")}`);
  }
  if ((opts.o === "livres" || opts.o === "eventos") && !(opts.inicio && opts.fim)) {
    throw new Error(`${opts.o} exige --inicio e --fim em ISO com fuso`);
  }
  if (opts.o === "livres" && !opts.calendario) throw new Error("livres exige --calendario");
  if ((opts.o === "calendario" || opts.o === "ver" || opts.o === "notas") && !opts.id) {
    throw new Error(`${opts.o} exige --id`);
  }
  await withClient(opts.location, log, async (client) => {
    let out: unknown;
    switch (opts.o) {
      case "calendarios":
        out = await listCalendars(client, opts.location);
        break;
      case "calendario":
        out = await getCalendar(client, opts.id!);
        break;
      case "livres":
        out = await freeSlots(client, opts.calendario!, {
          inicio: opts.inicio!, fim: opts.fim!,
          timezone: opts.timezone, usuario: opts.usuario,
        });
        break;
      case "eventos": {
        const r = await listEvents(client, opts.location, {
          inicio: opts.inicio!, fim: opts.fim!, calendario: opts.calendario,
          usuario: opts.usuario, grupo: opts.grupo, contato: opts.contato,
        }) as { events?: Record<string, unknown>[] };
        // compromisso e bloqueio vivem na mesma lista; marcamos cada um para o leitor
        out = {
          events: (r.events ?? []).map((e) => ({
            ...e, _tipo: e.contactId ? "compromisso" : "bloqueio",
          })),
        };
        break;
      }
      case "ver":
        out = await getAppointment(client, opts.id!);
        break;
      case "notas":
        out = await listNotes(
          client, opts.id!,
          opts.limite ? Number(opts.limite) : 20,
          opts.pagina ? (Number(opts.pagina) - 1) * 20 : 0,
        );
        break;
    }
    if (opts.json) console.log(JSON.stringify(out));
    else console.log(JSON.stringify(out, null, 2));
  });
}
```

O campo `_tipo` é a resposta provisória a "qual campo separa compromisso de bloqueio".
Se a Tarefa 1 tiver achado um discriminador de verdade na resposta, use-o aqui e apague
a heurística do `contactId`.

- [ ] **Passo 3: registrar o comando**

Junto dos outros `program.command`, depois de `oportunidades`:

```ts
program
  .command("agenda")
  .description("Leitura ao vivo de calendários, horários livres e compromissos")
  .requiredOption("-l, --location <id>", "locationId da subconta")
  .option("-o, --o <op>", "calendarios | calendario | livres | eventos | ver | notas", "calendarios")
  .option("-i, --id <id>", "id do calendário, compromisso ou dono das notas")
  .option("--calendario <id>", "filtra por calendário")
  .option("--usuario <id>", "filtra pelo dono")
  .option("--grupo <id>", "filtra por grupo de calendários")
  .option("--contato <id>", "filtra pelos compromissos de um contato")
  .option("--inicio <iso>", "início do período, ISO com fuso: 2026-10-02T00:00:00-03:00")
  .option("--fim <iso>", "fim do período, ISO com fuso")
  .option("--timezone <tz>", "fuso IANA para os horários livres, ex.: America/Sao_Paulo")
  .option("--limite <n>", "quantas notas trazer, até 20")
  .option("--pagina <n>", "página das notas, a partir de 1")
  .option("--json", "imprime o resultado em JSON no stdout")
  .action((o) => runAgenda(o).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); }));
```

- [ ] **Passo 4: registrar o script**

Em `extractor/package.json`, em `scripts`, junto de `"pipeline"`:

```json
"agenda": "tsx src/cli.ts agenda"
```

- [ ] **Passo 5: typecheck e fumaça**

```bash
cd extractor && npx tsc --noEmit
npm run agenda -- --help
```
Expected: typecheck limpo; `--help` lista as flags acima.

- [ ] **Passo 6: commit**

```bash
git add extractor/src/cli.ts extractor/package.json
git commit -m "feat(agenda): comando de leitura na CLI"
```

---

### Tarefa 4: Escrita no módulo e comando `agenda-acao`

**Files:**
- Modify: `extractor/src/api/calendars.ts`
- Modify: `extractor/src/cli.ts`
- Modify: `extractor/package.json`

**Interfaces:**
- Consumes: `isoComFuso`, `AGENDA_SITUACOES`, `getAppointment` da Tarefa 2;
  `registroEscrita` (`cli.ts:502`), `withClient`.
- Produces: para a Tarefa 5 — o comando `agenda-acao` com `--acao` em
  `marcar | remarcar | situacao | cancelar | nota-criar | nota-editar | nota-apagar`.

- [ ] **Passo 1: acrescentar as funções de escrita ao módulo**

No fim de `extractor/src/api/calendars.ts`:

```ts
export interface CompromissoCorpo {
  calendarId?: string;
  locationId?: string;
  contactId?: string;
  startTime?: string;
  endTime?: string;
  title?: string;
  description?: string;
  address?: string;
  appointmentStatus?: string;
  assignedUserId?: string;
  toNotify?: boolean;
  ignoreDateRange?: boolean;
  ignoreFreeSlotValidation?: boolean;
  rrule?: string;
}

export function createAppointment(
  client: GhlClient, corpo: CompromissoCorpo,
): Promise<unknown> {
  return client.postJson(`${BASE}/calendars/events/appointments`, corpo);
}

export function updateAppointment(
  client: GhlClient, eventId: string, corpo: CompromissoCorpo,
): Promise<unknown> {
  return client.putJson(
    `${BASE}/calendars/events/appointments/${encodeURIComponent(eventId)}`, corpo,
  );
}

export function deleteEvent(client: GhlClient, eventId: string): Promise<unknown> {
  return client.deleteJson(`${BASE}/calendars/events/${encodeURIComponent(eventId)}`);
}

export function createNote(
  client: GhlClient, appointmentId: string, body: string, userId?: string,
): Promise<unknown> {
  return client.postJson(
    `${BASE}/calendars/appointments/${encodeURIComponent(appointmentId)}/notes`,
    { body, ...(userId ? { userId } : {}) },
  );
}

export function updateNote(
  client: GhlClient, appointmentId: string, noteId: string, body: string,
): Promise<unknown> {
  return client.putJson(
    `${BASE}/calendars/appointments/${encodeURIComponent(appointmentId)}` +
    `/notes/${encodeURIComponent(noteId)}`,
    { body },
  );
}

export function deleteNote(
  client: GhlClient, appointmentId: string, noteId: string,
): Promise<unknown> {
  return client.deleteJson(
    `${BASE}/calendars/appointments/${encodeURIComponent(appointmentId)}` +
    `/notes/${encodeURIComponent(noteId)}`,
  );
}
```

Confira em `extractor/src/api/client.ts` os nomes reais dos métodos de escrita
(`postJson`/`putJson`/`deleteJson` ou equivalentes) e ajuste — o resto do arquivo é o
contrato, esses nomes são do cliente.

- [ ] **Passo 2: escrever `runAgendaAcao`**

Em `cli.ts`, perto de `runOportunidadeAcao`:

```ts
const AGENDA_ACOES = [
  "marcar", "remarcar", "situacao", "cancelar", "nota-criar", "nota-editar", "nota-apagar",
];

async function runAgendaAcao(opts: {
  location: string; acao: string; id?: string; calendario?: string; contato?: string;
  inicio?: string; fim?: string; titulo?: string; descricao?: string; endereco?: string;
  situacao?: string; dono?: string; repeticao?: string; alvo?: string; nota?: string;
  texto?: string; silenciar?: boolean; forcar?: boolean;
  confirmo?: boolean; json?: boolean;
}): Promise<void> {
  const log = opts.json ? console.error : console.log;
  if (!AGENDA_ACOES.includes(opts.acao)) {
    throw new Error(`--acao inválida: ${opts.acao}. Aceitas: ${AGENDA_ACOES.join(", ")}`);
  }
  if (!opts.confirmo) {
    throw new Error(
      "Isto muda a agenda de verdade: fala com o cliente por e-mail ou SMS, acorda as " +
      "automações ligadas ao compromisso e não tem desfazer. Repita com --confirmo.",
    );
  }
  if (opts.acao === "marcar") {
    if (!(opts.calendario && opts.contato && opts.inicio && opts.situacao)) {
      throw new Error("marcar exige --calendario, --contato, --inicio e --situacao");
    }
  } else if (!opts.id) {
    throw new Error(`${opts.acao} exige --id`);
  }
  if (opts.situacao && !AGENDA_SITUACOES.includes(opts.situacao as never)) {
    throw new Error(
      `--situacao inválida: ${opts.situacao}. Aceitas: ${AGENDA_SITUACOES.join(", ")}. ` +
      `"remarcado" não existe: remarcar é mudar o horário com --acao remarcar.`,
    );
  }
  if (opts.acao.startsWith("nota-") && opts.acao !== "nota-apagar" && !opts.texto) {
    throw new Error(`${opts.acao} exige --texto`);
  }
  if ((opts.acao === "nota-editar" || opts.acao === "nota-apagar") && !opts.nota) {
    throw new Error(`${opts.acao} exige --nota com o id da nota`);
  }
  if (opts.alvo && !["instancia", "serie"].includes(opts.alvo)) {
    throw new Error("--alvo aceita instancia ou serie");
  }

  await withClient(opts.location, log, async (client) => {
    // série: a API distingue pelo id enviado. Sem --alvo a tool recusa em vez de adivinhar.
    let alvoId = opts.id;
    if (["remarcar", "situacao", "cancelar"].includes(opts.acao)) {
      const atual = await getAppointment(client, opts.id!).catch(() => null) as
        { event?: Record<string, unknown> } | Record<string, unknown> | null;
      const ev = (atual && "event" in (atual as object)
        ? (atual as { event?: Record<string, unknown> }).event
        : atual) as Record<string, unknown> | null;
      const serie = ev?.masterEventId as string | undefined;
      if (ev?.isRecurring || serie) {
        if (!opts.alvo) {
          throw new Error(
            "este compromisso faz parte de uma série que se repete. Diga o alvo: " +
            "--alvo instancia (só esta ocorrência) ou --alvo serie (todas). " +
            "Sem isso a chamada pode remarcar o ano inteiro.",
          );
        }
        if (opts.alvo === "serie" && serie) alvoId = serie;
      }
    }

    const corpo: Record<string, unknown> = {
      ...(opts.calendario ? { calendarId: opts.calendario } : {}),
      ...(opts.acao === "marcar" ? { locationId: opts.location, contactId: opts.contato } : {}),
      ...(opts.inicio ? { startTime: isoComFuso(opts.inicio) } : {}),
      ...(opts.fim ? { endTime: isoComFuso(opts.fim) } : {}),
      ...(opts.titulo ? { title: opts.titulo } : {}),
      ...(opts.descricao ? { description: opts.descricao } : {}),
      ...(opts.endereco ? { address: opts.endereco } : {}),
      ...(opts.situacao ? { appointmentStatus: opts.situacao } : {}),
      ...(opts.acao === "cancelar" ? { appointmentStatus: "cancelled" } : {}),
      ...(opts.dono ? { assignedUserId: opts.dono } : {}),
      ...(opts.silenciar ? { toNotify: false } : {}),
      // a regra de repetição só vale com a validação de horário livre desligada
      ...(opts.repeticao ? { rrule: opts.repeticao, ignoreFreeSlotValidation: true } : {}),
      ...(opts.forcar ? { ignoreFreeSlotValidation: true, ignoreDateRange: true } : {}),
    };

    if (opts.silenciar) {
      log("aviso: --silenciar também desliga os workflows ligados a este compromisso, " +
          "e pode não impedir o e-mail que a configuração do calendário manda sozinha.");
    }
    if (opts.repeticao) {
      log("aviso: com --repeticao o horário NÃO é conferido — o compromisso pode cair " +
          "em cima de outro que já existe.");
    }

    const chave = alvoId ?? "novo";
    const antes = alvoId ? await getAppointment(client, alvoId).catch(() => null) : null;
    const registro = registroEscrita(opts.location, "_agenda", chave, {
      acao: opts.acao, alvo: opts.alvo ?? null, corpo, antes, aplicado: false,
    });
    log(`snapshot: ${registro}`);

    let r: unknown;
    switch (opts.acao) {
      case "marcar": r = await createAppointment(client, corpo); break;
      case "remarcar":
      case "situacao":
      case "cancelar": r = await updateAppointment(client, alvoId!, corpo); break;
      case "nota-criar": r = await createNote(client, opts.id!, opts.texto!, opts.dono); break;
      case "nota-editar": r = await updateNote(client, opts.id!, opts.nota!, opts.texto!); break;
      case "nota-apagar": r = await deleteNote(client, opts.id!, opts.nota!); break;
    }
    fs.writeFileSync(registro, JSON.stringify({
      em: new Date().toISOString(), acao: opts.acao, alvo: opts.alvo ?? null,
      corpo, antes, aplicado: true, resposta: r,
    }, null, 2));
    const out = { aplicado: true, acao: opts.acao, resposta: r, registro };
    if (opts.json) console.log(JSON.stringify(out));
    else log(`ok — ${opts.acao}; registro em ${registro}`);
  });
}
```

Acrescente ao import do módulo, no topo de `cli.ts`:

```ts
import {
  AGENDA_SITUACOES, isoComFuso, createAppointment, updateAppointment,
  createNote, updateNote, deleteNote,
} from "./api/calendars.js";
```

`cancelar` usa o PUT com situação `cancelled`, não o DELETE: apagar o evento some com o
histórico, cancelar deixa o rastro que o CRM espera. `deleteEvent` fica exportado no módulo
sem uso na CLI desta rodada.

- [ ] **Passo 3: registrar o comando**

```ts
program
  .command("agenda-acao")
  .description("ESCREVE: marca, remarca, muda a situação ou cancela compromisso; notas")
  .requiredOption("-l, --location <id>", "locationId da subconta")
  .requiredOption("--acao <a>", "marcar | remarcar | situacao | cancelar | nota-criar | nota-editar | nota-apagar")
  .option("-i, --id <id>", "id do compromisso (tudo menos marcar)")
  .option("--calendario <id>", "calendário do compromisso")
  .option("--contato <id>", "contato, só em marcar")
  .option("--inicio <iso>", "início, ISO com fuso: 2026-10-02T14:00:00-03:00")
  .option("--fim <iso>", "fim, ISO com fuso")
  .option("--titulo <texto>", "título do compromisso")
  .option("--descricao <texto>", "descrição")
  .option("--endereco <texto>", "local")
  .option("--situacao <s>", "new | confirmed | cancelled | showed | noshow | invalid | completed | active")
  .option("--dono <id>", "usuário responsável")
  .option("--repeticao <rrule>", "regra de repetição RFC 5545; desliga a checagem de horário")
  .option("--alvo <a>", "instancia | serie — obrigatório em compromisso que se repete")
  .option("--nota <id>", "id da nota (nota-editar, nota-apagar)")
  .option("--texto <texto>", "corpo da nota")
  .option("--silenciar", "não notifica — também desliga os workflows do compromisso")
  .option("--forcar", "marca fora da disponibilidade, sem checar horário livre")
  .option("--confirmo", "obrigatório: fala com o cliente e não tem desfazer")
  .option("--json", "imprime o resultado em JSON no stdout")
  .action((o) => runAgendaAcao(o).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); }));
```

E em `extractor/package.json`:

```json
"agenda-acao": "tsx src/cli.ts agenda-acao"
```

- [ ] **Passo 4: typecheck**

Run: `cd extractor && npx tsc --noEmit`
Expected: sem erro.

- [ ] **Passo 5: commit**

```bash
git add extractor/src/api/calendars.ts extractor/src/cli.ts extractor/package.json
git commit -m "feat(agenda): escrita de compromisso e notas na CLI"
```

---

### Tarefa 5: Tools `agenda` e `agenda_acao` no MCP

**Files:**
- Modify: `auditor/src/automaster_audit/mcp_server.py`
- Test: `auditor/tests/test_mcp_tools.py`

**Interfaces:**
- Consumes: os comandos das Tarefas 3 e 4; `_run_extractor`, `_load`, `ToolError`, `_LOC`, `_SNAP`.
- Produces: `agenda(...)`, `agenda_acao(...)` e duas entradas em `TOOLS` — 23 no total.

- [ ] **Passo 1: escrever os testes que falham**

No fim de `auditor/tests/test_mcp_tools.py`:

```python
def test_agenda_recusa_operacao_invalida(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(srv, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError, match="inválido"):
        srv.agenda(LOC, o="inventar")


def test_agenda_eventos_exige_periodo(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(srv, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError, match="inicio"):
        srv.agenda(LOC, o="eventos", calendario="c1")


def test_agenda_eventos_passa_periodo_ao_extractor(root, monkeypatch):
    root(workflows=[wf()])
    visto = {}
    monkeypatch.setattr(srv, "_run_extractor", lambda *a: visto.update(args=a) or {"events": []})
    r = srv.agenda(LOC, o="eventos", calendario="c1",
                   inicio="2026-10-01T00:00:00-03:00", fim="2026-10-08T00:00:00-03:00")
    assert r["resultado"] == {"events": []}
    assert "--inicio" in visto["args"] and "2026-10-01T00:00:00-03:00" in visto["args"]
    assert "--calendario" in visto["args"] and "c1" in visto["args"]


def test_agenda_acao_recusa_sem_confirmo(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(srv, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError, match="confirmo=true"):
        srv.agenda_acao(LOC, acao="cancelar", id="e1")


def test_agenda_acao_marcar_exige_situacao(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(srv, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError, match="situacao"):
        srv.agenda_acao(LOC, acao="marcar", calendario="c1", contato="k1",
                        inicio="2026-10-02T14:00:00-03:00", confirmo=True)


def test_agenda_acao_recusa_situacao_fora_do_enum(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(srv, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError, match="remarcado"):
        srv.agenda_acao(LOC, acao="situacao", id="e1", situacao="remarcado", confirmo=True)


def test_agenda_acao_remarcar_chama_o_extractor(root, monkeypatch):
    root(workflows=[wf()])
    visto = {}
    monkeypatch.setattr(srv, "_run_extractor", lambda *a: visto.update(args=a) or {"aplicado": True})
    r = srv.agenda_acao(LOC, acao="remarcar", id="e1", alvo="instancia",
                        inicio="2026-10-03T15:00:00-03:00", confirmo=True)
    assert r["aplicado"] is True
    assert "--alvo" in visto["args"] and "instancia" in visto["args"]
    assert "--confirmo" in visto["args"]
```

- [ ] **Passo 2: rodar e ver falhar**

Run: `cd auditor && .venv/bin/python -m pytest tests/test_mcp_tools.py -q -k agenda`
Expected: FAIL — `module 'automaster_audit.mcp_server' has no attribute 'agenda'`.

- [ ] **Passo 3: escrever as duas tools**

Em `mcp_server.py`, depois de `pipeline(...)`:

```python
AGENDA_LEITURA = ("calendarios", "calendario", "livres", "eventos", "ver", "notas")
AGENDA_ACOES = ("marcar", "remarcar", "situacao", "cancelar",
                "nota-criar", "nota-editar", "nota-apagar")
AGENDA_SITUACOES = ("new", "confirmed", "cancelled", "showed",
                    "noshow", "invalid", "completed", "active")


def agenda(loc: str, o: str = "calendarios", id: str | None = None,
           calendario: str | None = None, usuario: str | None = None,
           grupo: str | None = None, contato: str | None = None,
           inicio: str | None = None, fim: str | None = None,
           timezone: str | None = None, limite: int | None = None,
           pagina: int | None = None, snapshot: str | None = None) -> dict:
    """Leitura ao vivo de calendários, horários livres e compromissos da subconta."""
    if o not in AGENDA_LEITURA:
        raise ToolError(f"o inválido: {o}. Aceitos: {', '.join(AGENDA_LEITURA)}")
    if o in ("livres", "eventos") and not (inicio and fim):
        raise ToolError(f"o={o} exige inicio e fim em ISO com fuso, ex.: 2026-10-02T00:00:00-03:00")
    if o == "livres" and not calendario:
        raise ToolError("o=livres exige calendario")
    if o in ("calendario", "ver", "notas") and not id:
        raise ToolError(f"o={o} exige id")
    _, meta = _load(loc, snapshot)
    args = ["agenda", "-l", loc, "-o", o]
    for flag, val in (("-i", id), ("--calendario", calendario), ("--usuario", usuario),
                      ("--grupo", grupo), ("--contato", contato), ("--inicio", inicio),
                      ("--fim", fim), ("--timezone", timezone),
                      ("--limite", str(limite) if limite else None),
                      ("--pagina", str(pagina) if pagina else None)):
        if val:
            args += [flag, val]
    return {"resultado": _run_extractor(*args, "--json"), "_snapshot": meta}


def agenda_acao(loc: str, acao: str, id: str | None = None, calendario: str | None = None,
                contato: str | None = None, inicio: str | None = None, fim: str | None = None,
                titulo: str | None = None, descricao: str | None = None,
                endereco: str | None = None, situacao: str | None = None,
                dono: str | None = None, repeticao: str | None = None,
                alvo: str | None = None, nota: str | None = None, texto: str | None = None,
                silenciar: bool = False, forcar: bool = False,
                confirmo: bool = False, snapshot: str | None = None) -> dict:
    """ESCREVE: marca, remarca, muda a situação ou cancela compromisso; cria e edita notas."""
    if acao not in AGENDA_ACOES:
        raise ToolError(f"acao inválida: {acao}. Aceitas: {', '.join(AGENDA_ACOES)}")
    if not confirmo:
        raise ToolError(
            "Isto muda a agenda de verdade: fala com o cliente por e-mail ou SMS, acorda as "
            "automações ligadas ao compromisso e não tem desfazer. Repita com confirmo=true.")
    if acao == "marcar":
        if not (calendario and contato and inicio and situacao):
            raise ToolError("marcar exige calendario, contato, inicio e situacao")
    elif not id:
        raise ToolError(f"{acao} exige o id do compromisso")
    if situacao and situacao not in AGENDA_SITUACOES:
        raise ToolError(
            f"situacao inválida: {situacao}. Aceitas: {', '.join(AGENDA_SITUACOES)}. "
            '"remarcado" não existe: remarcar é mudar o horário, com acao=remarcar.')
    if acao in ("nota-criar", "nota-editar") and not texto:
        raise ToolError(f"{acao} exige texto")
    if acao in ("nota-editar", "nota-apagar") and not nota:
        raise ToolError(f"{acao} exige nota com o id da nota")
    if alvo and alvo not in ("instancia", "serie"):
        raise ToolError("alvo aceita instancia ou serie")
    _, meta = _load(loc, snapshot)
    args = ["agenda-acao", "-l", loc, "--acao", acao, "--confirmo"]
    for flag, val in (("-i", id), ("--calendario", calendario), ("--contato", contato),
                      ("--inicio", inicio), ("--fim", fim), ("--titulo", titulo),
                      ("--descricao", descricao), ("--endereco", endereco),
                      ("--situacao", situacao), ("--dono", dono),
                      ("--repeticao", repeticao), ("--alvo", alvo),
                      ("--nota", nota), ("--texto", texto)):
        if val:
            args += [flag, val]
    if silenciar:
        args += ["--silenciar"]
    if forcar:
        args += ["--forcar"]
    return _run_extractor(*args, "--json") | {"_snapshot": meta}
```

- [ ] **Passo 4: registrar as duas em `TOOLS`**

Depois da entrada `"pipeline"`:

```python
    "agenda": (agenda, "Leitura ao vivo da agenda (abre Chrome, não usa o dump): "
               "`calendarios` (os calendários da subconta), `calendario` (um pelo id), "
               "`livres` (horários livres de um calendário num período, teto de 31 dias), "
               "`eventos` (compromissos e bloqueios do período — cada item vem marcado em "
               "`_tipo`), `ver` (um compromisso pelo id), `notas` (as notas de um "
               "compromisso). Datas em ISO com fuso: 2026-10-02T14:00:00-03:00.",
               {"loc": _LOC, "o": {"type": "string", "enum": list(AGENDA_LEITURA),
                                   "default": "calendarios"},
                "id": {"type": "string", "description": "id do calendário ou do compromisso"},
                "calendario": {"type": "string"}, "usuario": {"type": "string"},
                "grupo": {"type": "string"},
                "contato": {"type": "string", "description": "só os compromissos deste contato"},
                "inicio": {"type": "string", "description": "ISO com fuso"},
                "fim": {"type": "string", "description": "ISO com fuso"},
                "timezone": {"type": "string", "description": "IANA, ex.: America/Sao_Paulo"},
                "limite": {"type": "integer"}, "pagina": {"type": "integer"},
                "snapshot": _SNAP},
               ["loc"]),
    "agenda_acao": (agenda_acao, "ESCREVE EM PRODUÇÃO E FALA COM O CLIENTE: marca, remarca, "
                    "muda a situação ou cancela um compromisso, e cria, edita ou apaga notas. "
                    "Marcar, remarcar e cancelar disparam e-mail ou SMS para o contato e "
                    "acordam as automações do compromisso; não há desfazer. Exige "
                    "confirmo=true; registro em <dumps>/_agenda/. Em compromisso que se "
                    "repete, `alvo` é obrigatório: instancia (só aquele dia) ou serie (todos). "
                    "`silenciar` evita a notificação mas também desliga os workflows, e pode "
                    "não impedir o e-mail que o próprio calendário manda.",
                    {"loc": _LOC, "acao": {"type": "string", "enum": list(AGENDA_ACOES)},
                     "id": {"type": "string", "description": "id do compromisso (tudo menos marcar)"},
                     "calendario": {"type": "string"}, "contato": {"type": "string",
                                                                   "description": "só em marcar"},
                     "inicio": {"type": "string", "description": "ISO com fuso"},
                     "fim": {"type": "string", "description": "ISO com fuso"},
                     "titulo": {"type": "string"}, "descricao": {"type": "string"},
                     "endereco": {"type": "string"},
                     "situacao": {"type": "string", "enum": list(AGENDA_SITUACOES)},
                     "dono": {"type": "string", "description": "usuário responsável"},
                     "repeticao": {"type": "string",
                                   "description": "regra RFC 5545; desliga a checagem de horário"},
                     "alvo": {"type": "string", "enum": ["instancia", "serie"]},
                     "nota": {"type": "string"}, "texto": {"type": "string"},
                     "silenciar": {"type": "boolean", "default": False},
                     "forcar": {"type": "boolean", "default": False},
                     "confirmo": {"type": "boolean", "default": False},
                     "snapshot": _SNAP},
                    ["loc", "acao"]),
```

- [ ] **Passo 5: rodar os testes**

```bash
cd auditor && .venv/bin/python -m pytest tests/test_mcp_tools.py -q -k agenda
.venv/bin/python -m pytest -q
```
Expected: os 7 novos passam; a suíte inteira passa (176 testes).

- [ ] **Passo 6: commit**

```bash
git add auditor/src/automaster_audit/mcp_server.py auditor/tests/test_mcp_tools.py
git commit -m "feat(agenda): tools agenda e agenda_acao no MCP"
```

---

### Tarefa 6: Validação ao vivo na Instaltech

Nada aqui é opcional. O contrato só existe depois de o servidor responder.

**Files:**
- Modify: `extractor/src/api/calendars.ts`, `extractor/src/cli.ts`,
  `auditor/src/automaster_audit/mcp_server.py` (conforme os erros do servidor mandarem)
- Modify: `docs/endpoints.md`

- [ ] **Passo 1: leitura primeiro, sem escrever nada**

```bash
cd extractor
npm run agenda -- -l Xb9gDxwxYhdqtprGcb5E -o calendarios --json
```
Anote os ids dos calendários. Escolha um **descartável** — se não houver, crie um pela
interface do GHL e anote que ele precisa ser apagado no fim.

```bash
npm run agenda -- -l Xb9gDxwxYhdqtprGcb5E -o livres --calendario <CAL> \
  --inicio 2026-10-01T00:00:00-03:00 --fim 2026-10-08T00:00:00-03:00 --json
npm run agenda -- -l Xb9gDxwxYhdqtprGcb5E -o eventos --calendario <CAL> \
  --inicio 2026-10-01T00:00:00-03:00 --fim 2026-10-31T00:00:00-03:00 --json
```

Cada 4xx corrige o código: leia a mensagem do servidor, ajuste a rota ou o case, rode de
novo. Foi assim que oportunidades achou três contratos errados.

- [ ] **Passo 2: exercitar o ciclo de escrita no calendário descartável**

```bash
npm run agenda-acao -- -l Xb9gDxwxYhdqtprGcb5E --acao marcar --calendario <CAL> \
  --contato uWqujqll20tRuglV3mLt --inicio 2026-10-02T14:00:00-03:00 \
  --fim 2026-10-02T15:00:00-03:00 --titulo "teste automaster" --situacao confirmed \
  --silenciar --confirmo --json
```

Depois, sobre o id devolvido: `remarcar` (outro horário), `situacao` (`showed`),
`nota-criar`, `nota-editar`, `nota-apagar`, `cancelar`. Confira cada resultado com
`-o ver`.

- [ ] **Passo 3: exercitar a série e o alvo**

Marque um compromisso com `--repeticao "FREQ=WEEKLY;COUNT=3"`, confirme com `-o eventos`
que as três ocorrências existem, e prove as duas guardas: `remarcar` sem `--alvo` deve
recusar; `--alvo instancia` deve mexer em uma só; `--alvo serie` nas três.

- [ ] **Passo 4: conferir o rastro**

```bash
ls -R ~/.automaster/dumps/_agenda/Xb9gDxwxYhdqtprGcb5E/
```
Cada escrita tem um arquivo com `antes`, `corpo` e `aplicado: true`.

- [ ] **Passo 5: limpar**

Cancele e apague os compromissos de teste; apague o calendário descartável se você o criou.
Confirme com `-o eventos` que o período está limpo. Anote qualquer resíduo que não deu para
remover.

- [ ] **Passo 6: registrar o que foi e o que não foi exercitado**

Em `docs/endpoints.md`, na seção `## Agenda`, marque cada rota com ✓ ou ✗ e escreva em uma
frase o que o servidor ensinou (o equivalente aos três 422 das oportunidades). Responda:
`--silenciar` impediu mesmo a mensagem ao contato?

- [ ] **Passo 7: commit**

```bash
git add -A extractor auditor docs
git commit -m "fix(agenda): contratos corrigidos pela validacao ao vivo"
```

---

### Tarefa 7: Documentação e release 0.7.0

**Files:**
- Modify: `skills/automaster-leitura/SKILL.md`, `CLAUDE.md`, `CHANGELOG.md`,
  `.claude-plugin/plugin.json`

- [ ] **Passo 1: skill de leitura**

Em `skills/automaster-leitura/SKILL.md`, acrescente `agenda` e `agenda_acao` à lista de
tools do frontmatter (`:3`) e escreva, no formato dos parágrafos de oportunidade (`:67-84`),
cada um abrindo com a afirmação em negrito:

```markdown
**As tools de agenda não leem o dump — elas abrem o Chrome.** O dump só guarda nome e id de
calendário, para resolver referência de workflow. Compromisso não está lá.

**Marcar ou cancelar fala com o cliente.** A escrita dispara o e-mail ou SMS que o
calendário tem configurado e acorda as automações ligadas ao compromisso. `silenciar`
desliga as automações junto, e pode não impedir o e-mail — não é um botão de "sem efeito".

**Compromisso que se repete exige dizer o alvo.** Sem `alvo`, a tool recusa em vez de
escolher: a mesma chamada remarca uma terça ou o ano inteiro, conforme o id enviado.

**A lista de eventos mistura compromisso e bloqueio de agenda.** O campo `_tipo` separa os
dois; bloqueio não tem contato e não é reunião com ninguém.
```

- [ ] **Passo 2: CLAUDE.md**

Acrescente as duas linhas de comando ao bloco do extractor e some 2 à contagem de tools
("vinte e uma" vira "vinte e três"), e atualize a contagem de testes.

- [ ] **Passo 3: CHANGELOG e versão**

`.claude-plugin/plugin.json`: `0.6.0` vira `0.7.0`. Em `CHANGELOG.md`, entrada `## 0.7.0`
com: duas tools novas de agenda, o que foi validado ao vivo, e a advertência de que a
escrita fala com o cliente.

- [ ] **Passo 4: suíte inteira e typecheck**

```bash
cd auditor && .venv/bin/python -m pytest -q
cd ../extractor && npx tsc --noEmit
```
Expected: tudo verde.

- [ ] **Passo 5: instalar e conferir as 23 tools**

```bash
cd .. && claude plugin marketplace add . && claude plugin install automaster@zoi
```

- [ ] **Passo 6: commit**

```bash
git add -A
git commit -m "chore(release): plugin 0.7.0 com agenda"
```

---

## Sub-projetos seguintes

Fora desta rodada, cada um com seu próprio ciclo spec-flow, e só depois desta validada:
0.8.0 configuração de calendário; 0.9.0 grupos e recursos; 0.10.0 serviços e bookings.
