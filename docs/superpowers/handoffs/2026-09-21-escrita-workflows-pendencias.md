# Escrita de workflows 0.15.0 — o que ficou aberto

Fechamento da execução do plano `2026-09-20-workflows-escrita-transporte.md`. As nove
tarefas entraram, mais duas provas ao vivo e duas ondas de correção. Este arquivo existe
para que as pendências sobrevivam ao fim da sessão.

Detalhe do que o servidor faz e do que caiu nas provas:
`2026-09-20-workflows-escrita-prova.md`.

## O achado que vale mais que esta entrega

> **FECHADO em 2026-09-21 (plugin 0.16.1).** E a premissa abaixo estava meio errada: `parent`
> EXISTE no dump — 3.788 dos 4.017 steps da Instaltech o têm. O problema é que `parentKey`
> cobre mais steps e discorda dele em 1.017. `flow.parent_of()` agora lê `parentKey` com
> fallback no `parent` legado. Efeito: 229 → 71 entradas de fluxo na Instaltech, `paths.md`
> de 4.827 para 3.364 caminhos. `unreachable_step` continua em zero lá porque a subconta não
> tem step órfão, não por causa do bug; em todos os dumps em disco ele vê 3.


**O auditor inteiro ainda lê `parent`.** `auditor/src/automaster_audit/flow.py:38` procura
os steps "sem `parent`" para achar as entradas do fluxo. A prova ao vivo demonstrou que o
campo não existe — o servidor usa `parentKey`. Consequência medida no dump da Instaltech:
`roots()` devolve todo step como raiz, `reachable()` devolve tudo, e a regra
`unreachable_step` **nunca dispara** (zero ocorrências no `report.json`).

`roots()` e `reachable()` alimentam `journey.py`, `simulate.py`, `path_report.py` e
`enumerate_paths`. Ou seja: `paths.md`, `journey.html` e as camadas 2 e 3 do
`validation.html` estão computados sobre a premissa de que todo step é uma entrada.

Ficou fora da 0.15.0 de propósito: é trabalho próprio, com saídas próprias para revalidar,
e o portão de gravação desta entrega só recusa por ERROR, enquanto `unreachable_step` é
WARN — segurá-lo aqui não tornaria a escrita mais segura. O lado do extractor já foi
corrigido, então hoje os dois lados discordam.

## Guardas sem prova, e por quê

**Apagar trigger não incrementa o `version` do workflow.** Achado da segunda prova. Logo
`--versao-esperada` e a guarda de concorrência não detectam outra remoção de trigger na
janela entre a leitura e a escrita; só a releitura da lista autoritativa protege esse
caminho. Não há contador alternativo conhecido. Está comentado no código.

**A conferência de escrita está provada contra falso positivo, não contra falso negativo.**
Cinco gravações ao vivo devolveram `aplicado: true` com residual nulo, inclusive num
workflow de 579 steps — a comparação não vira ruído. Mas nunca se viu ela pegar uma escrita
que o servidor fingiu ter feito: a única rota com esse defeito conhecido (`only-triggers`)
saiu do código, e não se achou outra forma de fazer o servidor mentir.

**A corrida real entre prévia e gravação continua sem prova direta.** Provar exige uma
pessoa salvando pelo builder do GHL enquanto o comando roda.

**O comando de CLI não passa pelas 18 regras.** Essa guarda mora só na tool MCP. Quem roda
`npm run workflow-editar -- ... --confirmo` escreve sem validação. Está dito no CHANGELOG;
mover a guarda para o CLI é trabalho da parte B.

## Achados menores que sobraram

- `_normalizar_detalhe` (`validacao_escrita.py`) só cobre a fraseologia `step '...'`. Regra
  ERROR futura com outro texto traz de volta o falso positivo em renomeação. Degrada para o
  lado seguro: recusa a mais, nunca gravação indevida.
- `test_confirmo_true_passa_a_flag_para_o_extractor` não injeta `_load`; passa porque não
  existe dump da subconta literal `L1` em disco. Dívida de duas linhas.
- `camposDiferentes` não detalha o que mudou dentro de um array — reordenação aparece como
  o campo inteiro alterado. Só afeta o texto do diff.
- A prévia de `trigger` faz três chamadas de rede e nenhuma delas degrada com elegância: se
  uma falhar, a prévia inteira falha.
- Os testes da tool MCP cobriam só `trocar-tag`, e foi por isso que a ação `trigger` passou
  meses de execução sem validação sem ninguém notar. Ação com formato de saída próprio
  precisa de teste próprio — vale para cada ação nova da parte B.

## O que a parte A não faz, por decisão

Remover step vivo (exige recosturar `next`), criar step do zero, reordenar fluxo, restaurar
versão do histórico, adicionar ou substituir trigger. A rota `/recover` foi mapeada do
bundle e nunca exercitada; o código que a implementava saiu para que ninguém a reencontre e
acredite que existe desfazer.
