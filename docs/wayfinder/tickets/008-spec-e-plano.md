# 008 — Spec e plano

Map: [Automaster como plugin do Claude Code](../map-plugin-claude-code.md)
Type: `wayfinder:task`
Status: fechado (2026-09-18)
Assignee: claude
Blocked by: 007

## Pergunta

Escrever a spec do plugin e o plano de implementação, a partir do que os sete tickets
decidiram. Sai em `docs/superpowers/specs/` e `docs/superpowers/plans/`, como o resto do
projeto.

Nada a decidir aqui: se aparecer decisão nova, ela é ticket, não parágrafo da spec.

## Resolução

Spec em
[`docs/superpowers/specs/2026-09-18-automaster-plugin-design.md`](../../superpowers/specs/2026-09-18-automaster-plugin-design.md)
e plano em
[`docs/superpowers/plans/2026-09-18-automaster-plugin-plan.md`](../../superpowers/plans/2026-09-18-automaster-plugin-plan.md),
escritos a partir dos sete tickets anteriores. Seis fases, na ordem em que cada uma
destrava a seguinte.

A Fase 1 é o conserto do índice reverso, e vem primeiro de propósito: é o único código novo
de verdade que o mapa encontrou, e conserta um erro que já está em produção no
`dashboard.html`. As tools `buscar` e `workflow` dependem dele.

Duas decisões que faltavam foram fechadas com o usuário antes de escrever, porque estavam
em `## Ainda não especificado` e a spec não podia sair sem elas:

**Idade do dump:** toda tool devolve `_snapshot` com `extractedAt` e `idade_dias`, e o
agente decide se a idade importa para a pergunta. Sem limiar e sem aviso automático, que
seriam chute até haver uso real.

**Skill x descrição:** uma skill `automaster-leitura` ensina o domínio — draft é normal,
`naming_convention` é ruído, ciclo de chamadas pode ser desenho — e as descrições das tools
ficam secas, dizendo o que devolvem e quanto custam. Descrição de tool é lida sempre, mesmo
quando a tool não é chamada; skill não.

Outros dois itens de `## Ainda não especificado` já tinham sido resolvidos pelos tickets, e
foram só registrados: `contracts/` fica fora do MCP na v1 (saiu junto com a `validacao`, no
007) e o MCP serve várias subcontas na mesma sessão (raiz por `env`, subconta por argumento,
004 e 005).

Nenhuma decisão nova apareceu durante a escrita.

A lacuna do 006 entrou no plano como primeiro passo da Fase 3.2, explicitamente: medir
tokens e segundos de uma timeline real antes de dimensionar a tool `contato`.
