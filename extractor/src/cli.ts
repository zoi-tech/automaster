/**
 * Ponto de entrada da CLI. Cada domínio registra os próprios comandos; o que
 * todos usam (sessão, raiz dos dumps, rastro de escrita) mora em `cli/shared.ts`.
 *
 * Importar este arquivo EXECUTA o programa — módulo de comando nunca importa daqui.
 */
import { Command } from "commander";
import { registrarExtract } from "./cli/extract.js";
import { registrarContato } from "./cli/contato.js";
import { registrarConversas } from "./cli/conversas.js";
import { registrarMensageria } from "./cli/mensageria.js";
import { registrarAgenda } from "./cli/agenda.js";
import { registrarOportunidades } from "./cli/oportunidades.js";
import { registrarFormularios } from "./cli/formularios.js";
import { registrarDashboards } from "./cli/dashboards.js";
import { registrarAnotacoes } from "./cli/anotacoes.js";
import { registrarWorkflows } from "./cli/workflows.js";
import { registrarWorkflowEditar } from "./cli/workflow-editar.js";
import { registrarSmoke } from "./cli/smoke.js";
import { registrarSessao } from "./cli/sessao.js";
import { falhar } from "./saida.js";

const program = new Command();
program.name("automaster-extract").description("Extrai workflows GHL via API interna");

registrarExtract(program);
registrarContato(program);
registrarConversas(program);
registrarMensageria(program);
registrarAgenda(program);
registrarOportunidades(program);
registrarFormularios(program);
registrarDashboards(program);
registrarAnotacoes(program);
registrarWorkflows(program);
registrarWorkflowEditar(program);
registrarSmoke(program);
registrarSessao(program);

program.parseAsync(process.argv).catch(falhar);
