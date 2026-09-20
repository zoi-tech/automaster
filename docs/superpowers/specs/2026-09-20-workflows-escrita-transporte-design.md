# Escrita de workflows — Parte A: transporte e edição cirúrgica

Data: 2026-09-20
Status: spec aprovada no brainstorming, pendente de pesquisa e grill

## Contexto

O projeto lê workflows desde a primeira versão e, na 0.13.0, passou a escrever o que
cerca um workflow: publicar, despublicar, inscrever, remover e retomar contato. Nunca
escreveu o workflow em si — nome, pasta, triggers ou steps.

O bundle do editor (`client-app-automation-workflows.leadconnectorhq.com`, arquivo
`assets/index-*.js`) expõe um CRUD completo sobre `.../workflow/<locationId>`:

    POST   /<loc>                       criar
    PUT    /<loc>/<wid>                 salvar o workflow inteiro
    PUT    /<loc>/<wid>/auto-save       salvar rascunho automático
    PUT    /<loc>/only-triggers/<wid>   salvar só os triggers
    PUT    /<loc>/rename-workflow/<wid> renomear
    PUT    /<loc>/move-directory/<wid>  mover de pasta
    POST   /<loc>/<wid>/copy-workflow   duplicar
    DELETE /<loc>/<wid>?userId=         apagar
    PUT    /<loc>/<wid>/recover         restaurar apagado
    GET    /<loc>/<wid>/history         histórico de versões
    GET    /<loc>/<wid>/history-by-number/<n>

O corpo do PUT de salvar carrega `workflowData`, e dentro dele `templates` — exatamente o
array de steps que hoje só lemos do Firebase. **O Firebase é cache de leitura, não a fonte
de escrita.** Isso derruba a premissa antiga de que escrever steps exigiria gravar no
Cloud Storage.

## Decomposição

A escrita de workflow foi dividida em três sub-projetos com dependência linear. Cada um
roda o ciclo spec → pesquisa → grill → plano por conta própria.

- **A (esta spec) — transporte e edição cirúrgica.** Rotas, guardas, e edição por operação
  sobre o JSON que veio do servidor. Fecha sozinha o caso de uso "corrigir achado da
  auditoria".
- **B — DSL.** YAML legível que compila para `workflowData` e decompila de volta, com os
  15 tipos de ação mais usados em primeira classe e passthrough verbatim no resto. Fecha
  "construir automação do zero por comando".
- **C — clonagem entre subcontas.** Resolver referência por nome no destino e criar o que
  faltar. Depende de A e B.

## Escopo de A

Oito operações de escrita e uma de leitura:

1. criar workflow vazio (nome, pasta opcional)
2. renomear
3. mover de pasta
4. duplicar
5. apagar
6. restaurar apagado
7. editar só os triggers
8. editar o corpo (`workflowData` inteiro, gerado por operação cirúrgica)
9. ler histórico de versões (leitura, mas pertence a A: é a saída de emergência)

### Edição cirúrgica

A não traduz workflow para formato nenhum. Ela lê o JSON do servidor, aplica uma operação
sobre ele e regrava o documento inteiro. As operações são:

- **trocar referência** — substitui um id por outro em todo o workflow, em qualquer step ou
  trigger: tag, custom field, pipeline, estágio, usuário, workflow, custom value, template
- **remover step** por id
- **alterar atributo de step** por caminho (`<stepId>.attributes.<campo>`)
- **adicionar, remover ou editar trigger**
- **renomear workflow**

Essas cinco cobrem as 18 regras de auditoria: as sete `broken_*_ref` e `stale_email_template`
saem por troca de referência, `unreachable_step` e `dead_end_draft` por remoção,
`uncovered_condition` e `broken_goto` por alteração de atributo, `workflow_unreachable` por
trigger, `naming_convention` por renomeação.

## Arquitetura

A divisão do projeto se mantém: o extractor é transporte burro, o auditor decide.

**`extractor/src/api/workflows-write.ts`** — uma função por rota, sem lógica de negócio.
Recebe o corpo pronto, devolve a resposta crua.

**`extractor/src/cli/workflow-editar.ts`** — comando novo em arquivo próprio. O `cli.ts`
já está com 2.371 linhas; ele passa a despachar para esse arquivo em vez de crescer de
novo. Nenhum comando existente é movido — só o novo nasce fora.

**Tool MCP `workflow_editar`** (auditor) — o cérebro. Lê o workflow ao vivo pelo comando
do extractor, aplica a operação, roda as regras, monta o diff e só então manda gravar.
Importa o auditor como biblioteca, nunca lê o dump direto, como as outras 30 tools.

## Guardas

Na ordem, antes de cada escrita que toque corpo ou triggers:

1. **Snapshot.** O workflow inteiro vai para `<dumps>/_workflows/<loc>/<wid>/<ts>-antes.json`
   e `-depois.json`, no mesmo molde já usado em contato e mensagem. Permite desfazer à mão.
2. **Diff.** Steps e triggers somados, removidos e alterados, campo a campo, impressos antes
   de qualquer escrita.
3. **Validação.** As 18 regras rodam sobre o dump mais recente da subconta com o workflow
   editado no lugar do antigo. A escrita é recusada se **introduzir** um ERROR novo. ERROR
   que já existia não bloqueia — senão nenhum workflow com achado poderia ser corrigido. A
   idade do dump é impressa junto, porque a validação vale o que o dump vale.
4. **`--confirmo`.**

### Workflow publicado

Workflow publicado é editável, por decisão explícita. A guarda é informativa e redobrada:
o comando conta quantos contatos estão dentro agora (reusando a busca de inscritos da
0.13.0, descartando as linhas `finished`), avisa, e exige `--publicado` junto do `--confirmo`.
Só `--confirmo` não basta.

## Testes

Unitários no extractor: montagem de cada corpo, e a aplicação de cada operação cirúrgica
sobre fixtures de workflow reais tirados dos dumps em disco.

Unitários no auditor: o diff, a comparação de achados antes/depois, e a recusa por ERROR
novo.

Ao vivo na Instaltech (`Xb9gDxwxYhdqtprGcb5E`), sobre workflow descartável criado e apagado
na hora. Os 72 workflows reais não são tocados.

## Pergunta aberta para a pesquisa

A meta do workflow traz `version` (um inteiro; `version: 10` no workflow de teste da
0.13.0). Não se sabe se o PUT exige esse número de volta como trava de concorrência. Se
exigir, gravar sobre um workflow que outra pessoa alterou falha — o desejável. Se não
exigir, duas edições simultâneas se sobrescrevem em silêncio, e o comando precisa comparar
`version` por conta própria antes de gravar.

Também sem resposta: se `auto-save` e `update` têm efeitos diferentes sobre o histórico de
versões, e qual dos dois o comando deve usar. A hipótese é `update`, que é o salvamento
explícito do botão.

## Fora de escopo em A

Reordenar o fluxo, criar step do zero, e qualquer tradução entre o JSON do GHL e um formato
legível — tudo isso é B. Resolver referência entre subcontas é C. Escrita em lote sobre
vários workflows fica fora das três.

A regra de escrita serial do projeto continua valendo: o perfil persistente do Chrome é
único, e dois comandos de escrita ao vivo em paralelo travam no `SingletonLock`.
