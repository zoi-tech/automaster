import { Command } from "commander";
import {
  listCalendars, getCalendar, freeSlots, listEvents, getAppointment, listNotes, AGENDA_SITUACOES,
  isoComFuso, createAppointment, updateAppointment, createBlockSlot, updateBlockSlot,
  listBlockedSlots, createNote, updateNote, deleteNote
} from "../api/calendars.js";
import fs from "node:fs";
import { withClient, registroEscrita } from "./shared.js";
import { emitir, falhar } from "../saida.js";

const AGENDA_LEITURA = ["calendarios", "calendario", "livres", "eventos", "bloqueios", "ver", "notas"];

/** Fora da faixa 1..20 (incluindo não numérico) cai para 20, com aviso via `log`. */
function clampLimite(v: string | undefined, log: (msg: string) => void): number {
  const n = Number(v);
  const valido = Number.isFinite(n) && n >= 1 && n <= 20;
  if (!valido) {
    log(`aviso: --limite ${v ?? ""} inválido ou fora de 1..20, ajustado para 20.`);
    return 20;
  }
  return Math.trunc(n);
}

/** --pagina não numérico vira offset NaN sem esta coerção; abaixo de 1 cai para 1. */
function clampPagina(v: string | undefined, log: (msg: string) => void): number {
  if (v === undefined) return 1;
  const n = Number(v);
  const valido = Number.isFinite(n) && n >= 1;
  if (!valido) {
    log(`aviso: --pagina ${v} inválido, ajustado para 1.`);
    return 1;
  }
  return Math.trunc(n);
}

/**
 * O que separa compromisso de bloqueio é o `status` (observado ao vivo em 2026-09-19 com um
 * bloqueio de verdade): `unavailable` no bloqueio, `booked` no compromisso. Não é a presença
 * de `contactId` — e, de todo modo, `/calendars/events` nem devolve bloqueio: ele só aparece
 * em `/calendars/blocked-slots`.
 */
function marcarTipo(e: Record<string, unknown>): Record<string, unknown> {
  return { ...e, _tipo: e.status === "unavailable" ? "bloqueio" : "compromisso" };
}

async function runAgenda(opts: {
  location: string; o: string; id?: string; calendario?: string; usuario?: string;
  grupo?: string; contato?: string; inicio?: string; fim?: string; timezone?: string;
  limite?: string; pagina?: string; json?: boolean;
}): Promise<void> {
  const log = opts.json ? console.error : console.log;
  if (!AGENDA_LEITURA.includes(opts.o)) {
    throw new Error(`-o inválido: ${opts.o}. Aceitos: ${AGENDA_LEITURA.join(", ")}`);
  }
  if (["livres", "eventos", "bloqueios"].includes(opts.o) && !(opts.inicio && opts.fim)) {
    throw new Error(`${opts.o} exige --inicio e --fim em ISO com fuso`);
  }
  if (opts.o === "livres" && !opts.calendario) throw new Error("livres exige --calendario");
  if ((opts.o === "calendario" || opts.o === "ver" || opts.o === "notas") && !opts.id) {
    throw new Error(`${opts.o} exige --id`);
  }
  if (opts.o === "bloqueios" && opts.contato) {
    throw new Error("bloqueios não filtra por contato: bloqueio não tem contato");
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
        out = { events: (r.events ?? []).map(marcarTipo) };
        break;
      }
      case "bloqueios": {
        const r = await listBlockedSlots(client, opts.location, {
          inicio: opts.inicio!, fim: opts.fim!, calendario: opts.calendario,
          usuario: opts.usuario, grupo: opts.grupo,
        }) as { events?: Record<string, unknown>[] };
        out = { events: (r.events ?? []).map(marcarTipo) };
        break;
      }
      case "ver":
        out = await getAppointment(client, opts.id!);
        break;
      case "notas": {
        const limite = clampLimite(opts.limite, log);
        const pagina = clampPagina(opts.pagina, log);
        out = await listNotes(client, opts.id!, limite, (pagina - 1) * limite);
        break;
      }
    }
    emitir(opts.json, out);
  });
}

const AGENDA_ACOES = [
  "marcar", "remarcar", "situacao", "cancelar", "bloquear", "bloqueio-editar",
  "nota-criar", "nota-editar", "nota-apagar",
];

/** Bloqueio não tem contato nem situação: a rota não aceita esses campos. */
const AGENDA_ACOES_BLOQUEIO = ["bloquear", "bloqueio-editar"];

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
  } else if (opts.acao === "bloquear") {
    if (!(opts.inicio && opts.fim)) {
      throw new Error("bloquear exige --inicio e --fim");
    }
    // 400 ao vivo com --calendario de calendário comum: "The calendar is not an event
    // calendar." O bloqueio normal é do dono da agenda, não de um calendário de captação.
    if (!opts.dono) throw new Error("bloquear exige --dono: o bloqueio é da agenda de um usuário");
  } else if (opts.acao === "bloqueio-editar") {
    if (!opts.id) throw new Error("bloqueio-editar exige --id");
    // bloqueio-editar monta o mesmo corpo de bloquear, e o PUT do servidor trata campo
    // ausente como remoção (substituição, não merge): sem --inicio/--fim/--dono o bloqueio
    // perde horário e dono. Exigir os três aqui evita repetir o 422/perda de dado ao vivo.
    if (!(opts.inicio && opts.fim && opts.dono)) {
      throw new Error("bloqueio-editar exige --inicio, --fim e --dono além de --id: o PUT substitui o bloqueio inteiro, campo ausente é perdido");
    }
  } else if (!opts.id) {
    throw new Error(`${opts.acao} exige --id`);
  }
  if (AGENDA_ACOES_BLOQUEIO.includes(opts.acao) && (opts.contato || opts.situacao)) {
    throw new Error("bloqueio não tem contato nem situação: a rota não aceita esses campos");
  }
  if (AGENDA_ACOES_BLOQUEIO.includes(opts.acao) && opts.calendario) {
    // 400 ao vivo: "The calendar is not an event calendar." Bloqueio é sempre da agenda do
    // --dono, nunca de um --calendario específico.
    throw new Error("bloqueio não aceita --calendario: a rota recusa com 400 The calendar is not an event calendar");
  }
  if (opts.acao === "remarcar" && !opts.inicio) {
    throw new Error("remarcar exige --inicio");
  }
  if (opts.acao === "situacao" && !opts.situacao) {
    throw new Error("situacao exige --situacao");
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
  // 422 observado ao vivo: "A team member needs to be selected. assignedUserId is missing".
  // Só a série exige dono; compromisso avulso o servidor resolve sozinho.
  if (opts.repeticao && !opts.dono) {
    throw new Error("--repeticao exige --dono: o servidor recusa série sem responsável");
  }
  // mesmo 422, observado ao vivo também com --forcar: sem checar horário livre o servidor
  // não escolhe o responsável sozinho. remarcar liga o mesmo ignoreFreeSlotValidation e
  // pode dar o mesmo 422; mais barato exigir --dono aqui do que descobrir em produção.
  if (opts.forcar && (opts.acao === "marcar" || opts.acao === "remarcar") && !opts.dono) {
    throw new Error(`--forcar exige --dono: sem a checagem de horário o servidor recusa ${opts.acao} sem responsável`);
  }

  await withClient(opts.location, log, async (client) => {
    // série: a API distingue pelo id enviado. Sem --alvo a tool recusa em vez de adivinhar.
    let alvoId = opts.id;
    if (["remarcar", "situacao", "cancelar"].includes(opts.acao)) {
      const atual = await getAppointment(client, opts.id!).catch((e) => {
        // guarda falha aberta se devolver null incondicionalmente: 401/429/rede fariam a
        // execução seguir para o PUT sem saber se é série. Só aceitamos seguir cego quando
        // o usuário já declarou --alvo explicitamente.
        if (!opts.alvo) throw e;
        if (opts.alvo === "serie") {
          // --alvo serie precisa do masterEventId, que só vem dessa leitura. Sem ele o PUT
          // iria na ocorrência (opts.id) em vez da série — o oposto do pedido, sem desfazer.
          throw new Error(
            `--alvo serie foi pedido mas não deu para checar ${opts.id} (${String(e)}); ` +
            "sem essa leitura não há como achar o id-mestre da série. Tente de novo.",
          );
        }
        log(`aviso: não deu para checar se ${opts.id} é série (${String(e)}); seguindo com --alvo ${opts.alvo}, como pedido.`);
        return null;
      }) as Record<string, unknown> | null;
      // a rota devolve `{appointment:{...}}` (observado ao vivo); `{event:...}` nunca
      // apareceu, mas custa uma linha aceitar os dois.
      const ev = (atual?.appointment ?? atual?.event ?? atual) as
        Record<string, unknown> | null;
      const serie = ev?.masterEventId as string | undefined;
      if (ev?.isRecurring || serie) {
        if (!opts.alvo) {
          throw new Error(
            "este compromisso faz parte de uma série que se repete. Diga o alvo: " +
            "--alvo instancia (destaca só este dia, virando compromisso solto) ou " +
            "--alvo serie (todas). Sem isso a chamada pode remarcar o ano inteiro.",
          );
        }
        if (opts.alvo === "serie") {
          if (!serie) {
            throw new Error(
              "--alvo serie foi pedido mas este compromisso não tem id-mestre " +
              "(masterEventId) para achar a série; confira o --id.",
            );
          }
          alvoId = serie;
        }
      }
    }
    if (opts.alvo === "instancia") {
      log("aviso: --alvo instancia DESTACA a ocorrência — o servidor devolve um id novo " +
          "avulso e a série perde aquele dia para sempre. Não é 'edita só esta e mantém a " +
          "série igual', é remover do recorrente e criar um compromisso independente.");
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

    const bloqueio = AGENDA_ACOES_BLOQUEIO.includes(opts.acao);
    const corpoBloqueio: Record<string, unknown> = {
      ...(opts.calendario ? { calendarId: opts.calendario } : {}),
      locationId: opts.location,
      ...(opts.inicio ? { startTime: isoComFuso(opts.inicio) } : {}),
      ...(opts.fim ? { endTime: isoComFuso(opts.fim) } : {}),
      ...(opts.titulo ? { title: opts.titulo } : {}),
      ...(opts.dono ? { assignedUserId: opts.dono } : {}),
    };

    const chave = alvoId ?? "novo";
    const antes = alvoId ? await getAppointment(client, alvoId).catch(() => null) : null;
    const registro = registroEscrita(opts.location, "_agenda", chave, {
      acao: opts.acao, alvo: opts.alvo ?? null, corpo: bloqueio ? corpoBloqueio : corpo,
      antes, aplicado: false,
    });
    log(`snapshot: ${registro}`);

    let r: unknown;
    try {
      switch (opts.acao) {
        case "marcar": r = await createAppointment(client, corpo); break;
        case "remarcar":
        case "situacao":
        case "cancelar": r = await updateAppointment(client, alvoId!, corpo); break;
        case "bloquear": r = await createBlockSlot(client, corpoBloqueio); break;
        case "bloqueio-editar":
          r = await updateBlockSlot(client, opts.id!, corpoBloqueio); break;
        case "nota-criar": r = await createNote(client, opts.id!, opts.texto!, opts.dono); break;
        case "nota-editar": r = await updateNote(client, opts.id!, opts.nota!, opts.texto!); break;
        case "nota-apagar": r = await deleteNote(client, opts.id!, opts.nota!); break;
      }
    } catch (e) {
      fs.writeFileSync(registro, JSON.stringify({
        em: new Date().toISOString(), acao: opts.acao, alvo: opts.alvo ?? null,
        corpo: bloqueio ? corpoBloqueio : corpo, antes, aplicado: false, erro: String(e),
      }, null, 2));
      throw e;
    }
    fs.writeFileSync(registro, JSON.stringify({
      em: new Date().toISOString(), acao: opts.acao, alvo: opts.alvo ?? null,
      corpo: bloqueio ? corpoBloqueio : corpo, antes, aplicado: true, resposta: r,
    }, null, 2));
    const out = { aplicado: true, acao: opts.acao, resposta: r, registro };
    if (opts.json) emitir(true, out);
    else log(`ok — ${opts.acao}; registro em ${registro}`);
  });
}

export function registrarAgenda(program: Command): void {
  program
    .command("agenda")
    .description("Leitura ao vivo de calendários, horários livres e compromissos")
    .requiredOption("-l, --location <id>", "locationId da subconta")
    .option("-o, --o <op>", "calendarios | calendario | livres | eventos | bloqueios | ver | notas", "calendarios")
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
    .action((o) => runAgenda(o).catch(falhar));

  program
    .command("agenda-acao")
    .description("ESCREVE: marca, remarca, muda a situação ou cancela compromisso; bloqueia horário; notas")
    .requiredOption("-l, --location <id>", "locationId da subconta")
    .requiredOption("--acao <a>", "marcar | remarcar | situacao | cancelar | bloquear | bloqueio-editar | nota-criar | nota-editar | nota-apagar")
    .option("-i, --id <id>", "id do compromisso ou do bloqueio (tudo menos marcar e bloquear)")
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
    .action((o) => runAgendaAcao(o).catch(falhar));
}
