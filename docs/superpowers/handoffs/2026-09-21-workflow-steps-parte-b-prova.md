# Parte B (steps do canvas) — o que a prova ao vivo mediu

Plugin 0.18.0. Instaltech `Xb9gDxwxYhdqtprGcb5E`, workflow descartável `test.cmd [review]`
(`457e3101-9aa4-4733-acaa-9f7a90bf6f90`), em `draft`, mais uma cópia criada e apagada para a
prova destrutiva. **Zero resíduo**: o `test.cmd [review]` voltou ao estado original e a cópia
foi apagada.

Sete gravações e duas recusas, pela porta com validação (`automaster-audit workflow-editar`),
uma por vez — o perfil do Chrome é único.

## O que caiu (premissas do plano que a prova derrubou)

**A pergunta do canvas fechou em SIM, sem código.** O plano previa que, se a caixa aparecesse
fora do lugar, seria preciso copiar `advanceCanvasMeta.position` da âncora com deslocamento em
`y`. Não foi preciso: o step criado sem o campo apareceu exatamente entre a âncora e o step
seguinte, com as setas certas. O editor calcula o layout.

**A guarda de ciclo do `step-mover` não existe, e não devia existir.** O plano a previa via
descendência. Numa linha a→b→c, `c` é descendente de `b`, e mover `b` para depois de `c` é
troca de ordem legítima — a guarda a recusava. Um step simples não leva descendentes quando
sai: a cauda dele é reparentada no pai antigo. Sobrou só a recusa de âncora igual ao alvo.

**Duplicar PRESERVA os ids dos steps.** A doc dizia "copia steps e triggers, com ids novos".
Os seis steps da cópia vieram com exatamente os mesmos ids do original. O id dos triggers não
foi conferido.

## O que a conferência mostrou

A recostura é mínima e legível no diff. Inserir um step depois de X alterou dois campos em
dois steps: o `next` de X e o `parentKey` do que vinha depois. Mover alterou cinco steps, que
é o esperado (sai de um lugar, entra em outro). Remover container com subárvore tirou quatro
steps e alterou um. `conferirEscrita` devolveu residual nulo nas quatro gravações de step.

As duas recusas saíram com a mensagem certa e sem tocar em nada: ramo (`transition`) mandando
remover o container, e container sem a flag dizendo quantos steps sairiam.

## Achado de fora do inventário, corrigido junto

A dica "A escrita pode ter sido parcialmente aplicada" saía em TODA falha do extractor,
inclusive na de uma prévia que não escreveu nada — foi assim que ela apareceu nas duas
recusas acima. Agora só sai quando a invocação pedia gravação (`--confirmo`, ou
`contato-editar`, que grava direto por não ter prévia). Dois testes fixam os dois lados.

## O que continua fora, por decisão

**Mover container.** A cauda de um container pende dos ramos, não dele: "o que emenda onde"
não tem resposta única, e qualquer escolha seria semântica inventada.

**Remover um ramo isolado.** Pelo mesmo motivo — ramo é estrutura do container, indexada por
`attributes.branches` e pelo `sibling[]` dos irmãos.

**Criar container.** `step-criar` aceita qualquer JSON, então tecnicamente dá para mandar um
`if_else` com ramos; mas isso exigiria montar à mão o condition-node, os nós de ramo e o
`attributes.branches` coerentes entre si, e nada disso foi exercitado. Quem tentar, tente numa
cópia descartável.

**Nenhuma das três ações foi exercitada em workflow PUBLICADO.** A guarda existe
(`guardaPublicado` exige `--publicado`), e é a mesma das ações da parte A, já provada. Mas
mexer no canvas de workflow publicado move gente que está dentro dele, e isso não se testa na
base de um cliente.

**`step-criar` nunca foi exercitado com um tipo que tenha configuração pesada** (e-mail,
voice_ai, custom_code). Só `add_contact_tag`. O contrato é o mesmo — o comando não olha o
`attributes` —, mas um tipo cujo editor exija campo que o molde não trouxe abriria a caixa
incompleta no app.
