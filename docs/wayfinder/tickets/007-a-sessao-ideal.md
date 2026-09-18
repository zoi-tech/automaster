# 007 — A sessão ideal

Map: [Automaster como plugin do Claude Code](../map-plugin-claude-code.md)
Type: `wayfinder:prototype`
Status: fechado (2026-09-18)
Assignee: claude
Blocked by: 004, 005, 006

## Pergunta

Escrever à mão o transcript de uma sessão real usando as tools decididas: o usuário pergunta
"o que acontece quando o contato ganha a tag X?", e cada chamada de tool aparece com a
resposta que ela devolveria.

É o teste barato da superfície: tool que nunca aparece no transcript não precisa existir;
passo em que o agente tem que ler arquivo bruto é tool faltando.

Fazer para as perguntas que sobreviverem ao 006.

## Resolução

Quatro transcripts em
[prototipo-007-a-sessao-ideal.md](../prototipo-007-a-sessao-ideal.md), escritos contra as
oito tools do 004 e do 006. As respostas foram extraídas do dump real da Instaltech rodando
o auditor como biblioteca, não inventadas — inclusive as erradas.

**Uma tool sai.** `validacao` não apareceu em nenhum transcript, e o código explica:
`_camada1` é literalmente `rules.run_all(ctx)`, o mesmo que `achados` devolve; `_camada2` é
`enumerate_paths` por workflow, o mesmo que `workflow` devolve; `camada3` são os contratos,
7 tokens e vazia sem a pasta `contracts/`. Confirmado com o usuário em 2026-09-18: **tirar**,
e o `validation.html` continua como entrega para humano. Isso emenda o 004, que a incluiu
antes de a sobreposição ter sido medida. A decisão de incluir `jornada` continua de pé — o
transcript 3 a sustenta, e nenhuma outra tool entrega o que ela entrega.

**Uma tool está errada, e o erro já está em produção.** `buscar("recuperacao-reativacao")`
devolve `orphan: true` para uma tag que dispara um workflow **publicado**. O índice reverso
do `build_dashboard` só varre os steps (`_wf_refs`), nunca os triggers. **6 das 59 tags que
o dashboard chama de órfãs são gatilhos de workflow**: `form-custom-site`,
`gestor de follow up`, `ia manual`, `ia-teste`, `indicacao-rodrigo`,
`recuperacao-reativacao`.

Consertar isso é a primeira rachadura na tese do 001 de que o MCP é só recorte do que já
existe: `buscar` precisa de papel — dispara, adiciona, remove, testa em condição — e o
índice precisa varrer triggers. É código novo, pequeno, num lugar que já estava quebrado.

Quatro ajustes de forma, todos vindos de resposta real:

- `achados` precisa **agrupar** por `(rule, workflow, detail)`, não só filtrar: o mesmo
  campo quebrado aparece quatro vezes no mesmo workflow. E devolver `counts` mesmo com
  filtro, senão o agente não sabe o que não pediu.
- `workflow` precisa de **teto na árvore de caminhos**: mediana 173 tokens, mas o workflow
  do transcript 1 custa 6.772 e o maior do dump custa 18.665.
- `inventario` precisa devolver o **`summary` por default** (82 tokens), fatias sob demanda.
- `contato` precisa **resolver `sourceId` para nome de workflow** na própria resposta. É o
  campo que costura a tool ao vivo às outras: o agente lê "tag adicionada por
  WORKFLOW_NEW/9fd53332" e chama `workflow()` para explicar o porquê. Sem resolver, a
  resposta é uma lista de ids.

**Nenhuma tool nova apareceu.** Sete sobrevivem: `dumps`, `inventario`, `workflow`,
`achados`, `buscar`, `jornada`, `contato`.

O transcript 4 não pôde ser escrito com números: o comando abre sessão autenticada em
produção e não foi executado. A lacuna é a mesma que o 006 registrou.

## Verificação

Na seção `## Verificação` do documento do protótipo.
