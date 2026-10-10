// Comando mínimo que garante o processo de fundo e sai: prova que os pipes de quem chama
// não ficam presos ao processo de fundo (decisão A21/A50).
// Uso: tsx test/fixtures/sobe-e-sai.ts <dir> <lock> <main>
import { garantirFundo } from "../../src/fundo/cliente.js";
import { caminhosDaSessao } from "../../src/fundo/comum.js";

const [dir, lock, main] = process.argv.slice(2);
await garantirFundo({
  caminhos: caminhosDaSessao(dir),
  lock,
  main,
  perfil: "perfil-x",
  versao: process.env.FUNDO_FALSO_VERSAO ?? "falsa",
  esperaSubidaMs: 15000,
  avisoMs: 5000,
  corteMs: 5000,
  log: console.log,
});
console.log("pronto");
